package db

import (
	"database/sql"
	"strings"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Store) AppendRequirementRevision(issueID, rawMarkdown, source, sourceURL string) (*model.RequirementRevision, error) {
	rev := &model.RequirementRevision{
		ID:          "reqrev-" + uuid.NewString()[:8],
		IssueID:     issueID,
		RawMarkdown: rawMarkdown,
		Source:      strings.TrimSpace(source),
		SourceURL:   strings.TrimSpace(sourceURL),
		CreatedAt:   model.NowISO(),
	}
	_, err := s.db.Exec(`
INSERT INTO requirement_revisions(id, issue_id, raw_markdown, source, source_url, created_at)
VALUES(?, ?, ?, ?, ?, ?)
`, rev.ID, rev.IssueID, rev.RawMarkdown, rev.Source, rev.SourceURL, rev.CreatedAt)
	if err != nil {
		return nil, err
	}
	return rev, nil
}

func (s *Store) ListRequirementRevisions(issueID string) ([]model.RequirementRevision, error) {
	rows, err := s.db.Query(`
SELECT id, issue_id, raw_markdown, source, source_url, created_at
FROM requirement_revisions WHERE issue_id = ? ORDER BY created_at ASC
`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.RequirementRevision
	for rows.Next() {
		var rev model.RequirementRevision
		if err := rows.Scan(&rev.ID, &rev.IssueID, &rev.RawMarkdown, &rev.Source, &rev.SourceURL, &rev.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rev)
	}
	if out == nil {
		out = []model.RequirementRevision{}
	}
	return out, rows.Err()
}

func (s *Store) GetRequirementRevision(id string) (*model.RequirementRevision, error) {
	var rev model.RequirementRevision
	err := s.db.QueryRow(`
SELECT id, issue_id, raw_markdown, source, source_url, created_at
FROM requirement_revisions WHERE id = ?
`, id).Scan(&rev.ID, &rev.IssueID, &rev.RawMarkdown, &rev.Source, &rev.SourceURL, &rev.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rev, nil
}

func (s *Store) AppendDevelopmentRevision(issueID, requirementRevisionID, rawMarkdown string) (*model.DevelopmentRevision, error) {
	rev := &model.DevelopmentRevision{
		ID:                    "devrev-" + uuid.NewString()[:8],
		IssueID:               issueID,
		RequirementRevisionID: strings.TrimSpace(requirementRevisionID),
		RawMarkdown:           rawMarkdown,
		CreatedAt:             model.NowISO(),
		Commits:               []model.DevelopmentRevisionCommit{},
	}
	_, err := s.db.Exec(`
INSERT INTO development_revisions(id, issue_id, requirement_revision_id, raw_markdown, created_at)
VALUES(?, ?, ?, ?, ?)
`, rev.ID, rev.IssueID, rev.RequirementRevisionID, rev.RawMarkdown, rev.CreatedAt)
	if err != nil {
		return nil, err
	}
	return rev, nil
}

func (s *Store) ListDevelopmentRevisions(issueID string) ([]model.DevelopmentRevision, error) {
	rows, err := s.db.Query(`
SELECT id, issue_id, requirement_revision_id, raw_markdown, created_at
FROM development_revisions WHERE issue_id = ? ORDER BY created_at ASC
`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.DevelopmentRevision
	for rows.Next() {
		var rev model.DevelopmentRevision
		if err := rows.Scan(&rev.ID, &rev.IssueID, &rev.RequirementRevisionID, &rev.RawMarkdown, &rev.CreatedAt); err != nil {
			return nil, err
		}
		rev.Commits = []model.DevelopmentRevisionCommit{}
		out = append(out, rev)
	}
	if out == nil {
		out = []model.DevelopmentRevision{}
	}
	for i := range out {
		commits, err := s.ListDevelopmentRevisionCommits(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Commits = commits
	}
	return out, rows.Err()
}

func (s *Store) GetDevelopmentRevision(id string) (*model.DevelopmentRevision, error) {
	var rev model.DevelopmentRevision
	err := s.db.QueryRow(`
SELECT id, issue_id, requirement_revision_id, raw_markdown, created_at
FROM development_revisions WHERE id = ?
`, id).Scan(&rev.ID, &rev.IssueID, &rev.RequirementRevisionID, &rev.RawMarkdown, &rev.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	commits, err := s.ListDevelopmentRevisionCommits(rev.ID)
	if err != nil {
		return nil, err
	}
	rev.Commits = commits
	return &rev, nil
}

func (s *Store) ListDevelopmentRevisionCommits(revisionID string) ([]model.DevelopmentRevisionCommit, error) {
	rows, err := s.db.Query(`
SELECT id, revision_id, repo_id, sha, created_at
FROM development_revision_commits WHERE revision_id = ? ORDER BY created_at ASC
`, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.DevelopmentRevisionCommit
	for rows.Next() {
		var c model.DevelopmentRevisionCommit
		if err := rows.Scan(&c.ID, &c.RevisionID, &c.RepoID, &c.SHA, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []model.DevelopmentRevisionCommit{}
	}
	return out, rows.Err()
}

// AttachDevelopmentCommits records per-repo SHAs on a development revision.
// If the revision already has commits (prior coding run), a new development revision is
// forked so the previous SHAs stay immutable, and issue.CurrentDevelopmentRevisionID is updated.
func (s *Store) AttachDevelopmentCommits(issue *model.Issue, commits []model.DevelopmentRevisionCommit) error {
	if issue == nil || len(commits) == 0 {
		return nil
	}
	revID := strings.TrimSpace(issue.CurrentDevelopmentRevisionID)
	if revID == "" {
		return nil
	}
	existing, err := s.ListDevelopmentRevisionCommits(revID)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		prev, err := s.GetDevelopmentRevision(revID)
		if err != nil || prev == nil {
			return err
		}
		forked, err := s.AppendDevelopmentRevision(issue.ID, prev.RequirementRevisionID, prev.RawMarkdown)
		if err != nil {
			return err
		}
		revID = forked.ID
		issue.CurrentDevelopmentRevisionID = forked.ID
	}
	now := model.NowISO()
	for _, c := range commits {
		repoID := strings.TrimSpace(c.RepoID)
		sha := strings.TrimSpace(c.SHA)
		if repoID == "" || sha == "" {
			continue
		}
		id := "drc-" + uuid.NewString()[:8]
		if _, err := s.db.Exec(`
INSERT INTO development_revision_commits(id, revision_id, repo_id, sha, created_at)
VALUES(?, ?, ?, ?, ?)
`, id, revID, repoID, sha, now); err != nil {
			return err
		}
	}
	return nil
}
