package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/model"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	sqldb.SetMaxOpenConns(1)
	s := &Store{db: sqldb}
	if err := s.migrate(); err != nil {
		_ = sqldb.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	schema := `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  review_mode TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  data TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  assignee TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_repos (
  issue_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  PRIMARY KEY (issue_id, repo_id)
);

CREATE TABLE IF NOT EXISTS requirement_revisions (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  raw_markdown TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS development_revisions (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  requirement_revision_id TEXT NOT NULL DEFAULT '',
  raw_markdown TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS development_revision_commits (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  repo_id TEXT NOT NULL DEFAULT '',
  sha TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autodev_jobs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  pr_info TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autodev_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_issue ON autodev_jobs(issue_id);
CREATE INDEX IF NOT EXISTS idx_logs_job ON autodev_logs(job_id);
`
	_, err := s.db.Exec(schema)
	if err != nil {
		return err
	}
	// Existing installs keep CREATE TABLE IF NOT EXISTS; add columns best-effort
	// before creating indexes that reference those columns.
	_, _ = s.db.Exec(`ALTER TABLE autodev_jobs ADD COLUMN executor TEXT NOT NULL DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE autodev_jobs ADD COLUMN executor_config TEXT`)
	_, _ = s.db.Exec(`ALTER TABLE projects ADD COLUMN name TEXT NOT NULL DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE projects ADD COLUMN review_mode TEXT NOT NULL DEFAULT 'local'`)
	_, _ = s.db.Exec(`ALTER TABLE issues ADD COLUMN title TEXT NOT NULL DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE issues ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature'`)
	_, _ = s.db.Exec(`ALTER TABLE issues ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'`)
	_, _ = s.db.Exec(`ALTER TABLE issues ADD COLUMN source_url TEXT NOT NULL DEFAULT ''`)
	_, _ = s.db.Exec(`ALTER TABLE issues ADD COLUMN assignee TEXT NOT NULL DEFAULT ''`)
	for _, idx := range []string{
		`CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_kind ON issues(kind)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority)`,
		`CREATE INDEX IF NOT EXISTS idx_issues_source_url ON issues(project_id, source_url)`,
		`CREATE INDEX IF NOT EXISTS idx_projects_review_mode ON projects(review_mode)`,
		`CREATE INDEX IF NOT EXISTS idx_issue_repos_repo ON issue_repos(repo_id)`,
		`CREATE INDEX IF NOT EXISTS idx_req_revisions_issue ON requirement_revisions(issue_id)`,
		`CREATE INDEX IF NOT EXISTS idx_dev_revisions_issue ON development_revisions(issue_id)`,
		`CREATE INDEX IF NOT EXISTS idx_dev_rev_commits_revision ON development_revision_commits(revision_id)`,
		`CREATE INDEX IF NOT EXISTS idx_history_events_issue ON history_events(issue_id)`,
	} {
		if _, err := s.db.Exec(idx); err != nil {
			return err
		}
	}
	if err := s.backfillQueryableColumns(); err != nil {
		return err
	}
	return nil
}

const queryableColumnsBackfillKey = "queryable_columns_backfill_v1"

func (s *Store) backfillQueryableColumns() error {
	var done bool
	ok, err := s.GetSetting(queryableColumnsBackfillKey, &done)
	if err != nil {
		return err
	}
	if ok && done {
		return nil
	}
	if err := s.backfillProjectColumns(); err != nil {
		return err
	}
	if err := s.backfillIssueColumns(); err != nil {
		return err
	}
	return s.PutSetting(queryableColumnsBackfillKey, true)
}

func (s *Store) backfillProjectColumns() error {
	rows, err := s.db.Query(`SELECT id, data FROM projects`)
	if err != nil {
		return err
	}
	type row struct {
		id, raw string
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.raw); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	// MaxOpenConns(1): finish the SELECT before writing.
	for _, r := range list {
		var p model.Project
		if err := json.Unmarshal([]byte(r.raw), &p); err != nil {
			continue
		}
		name := strings.TrimSpace(p.Name)
		mode := string(model.NormalizeReviewMode(p.ReviewMode))
		if _, err := s.db.Exec(`UPDATE projects SET name = ?, review_mode = ? WHERE id = ?`, name, mode, r.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) backfillIssueColumns() error {
	rows, err := s.db.Query(`SELECT id, data FROM issues`)
	if err != nil {
		return err
	}
	type row struct {
		id, raw string
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.raw); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, r := range list {
		var iss model.Issue
		if err := json.Unmarshal([]byte(r.raw), &iss); err != nil {
			continue
		}
		kind := string(model.NormalizeIssueKind(iss.Kind))
		priority := string(model.NormalizePriority(iss.Priority))
		status := string(iss.Status)
		if status == "" {
			status = string(model.StatusRequirements)
		}
		title := strings.TrimSpace(iss.Title)
		sourceURL := strings.TrimSpace(iss.SourceURL)
		assignee := strings.TrimSpace(iss.Assignee)
		if _, err := s.db.Exec(`
UPDATE issues SET title = ?, kind = ?, priority = ?, status = ?, source_url = ?, assignee = ? WHERE id = ?
`, title, kind, priority, status, sourceURL, assignee, r.id); err != nil {
			return err
		}
		if err := s.replaceIssueRepos(r.id, iss.AssociatedRepoIDs); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) replaceIssueRepos(issueID string, repoIDs []string) error {
	if _, err := s.db.Exec(`DELETE FROM issue_repos WHERE issue_id = ?`, issueID); err != nil {
		return err
	}
	seen := map[string]struct{}{}
	for _, repoID := range repoIDs {
		repoID = strings.TrimSpace(repoID)
		if repoID == "" {
			continue
		}
		if _, ok := seen[repoID]; ok {
			continue
		}
		seen[repoID] = struct{}{}
		if _, err := s.db.Exec(`INSERT OR IGNORE INTO issue_repos(issue_id, repo_id) VALUES(?, ?)`, issueID, repoID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetSetting(key string, dest any) (bool, error) {
	var raw string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&raw)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if dest == nil {
		return true, nil
	}
	return true, json.Unmarshal([]byte(raw), dest)
}

func (s *Store) PutSetting(key string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
INSERT INTO settings(key, value) VALUES(?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
`, key, string(b))
	return err
}

func (s *Store) GetModelConfig() (model.ModelConfig, error) {
	cfg := model.DefaultModelConfig()
	ok, err := s.GetSetting("global_model_config", &cfg)
	if err != nil {
		return cfg, err
	}
	if !ok {
		return model.DefaultModelConfig(), nil
	}
	if upgraded := upgradeModelConfigURLs(&cfg); upgraded {
		// Persist migrated full endpoint so the UI shows the real path.
		_ = s.PutSetting("global_model_config", cfg)
	}
	return cfg, nil
}

func (s *Store) PutModelConfig(cfg model.ModelConfig) error {
	existing, _ := s.GetModelConfig()
	// Preserve existing key when client sends empty (masked update).
	if strings.TrimSpace(cfg.OpenAIAPIKey) == "" && existing.OpenAIAPIKey != "" {
		cfg.OpenAIAPIKey = existing.OpenAIAPIKey
	}
	upgradeModelConfigURLs(&cfg)
	return s.PutSetting("global_model_config", cfg)
}

func upgradeModelConfigURLs(cfg *model.ModelConfig) bool {
	if cfg == nil {
		return false
	}
	next := model.UpgradeLegacyOpenAIBaseURL(cfg.OpenAIBaseURL)
	if next == cfg.OpenAIBaseURL {
		return false
	}
	cfg.OpenAIBaseURL = next
	return true
}

func (s *Store) GetUIPrefs() (model.UIPrefs, error) {
	prefs := model.UIPrefs{Language: "en", ThemeStyle: "light"}
	ok, err := s.GetSetting("ui_prefs", &prefs)
	if err != nil {
		return prefs, err
	}
	if !ok {
		return normalizeUIPrefs(prefs), nil
	}
	return normalizeUIPrefs(prefs), nil
}

func normalizeUIPrefs(prefs model.UIPrefs) model.UIPrefs {
	if prefs.Language == "" {
		prefs.Language = "en"
	}
	if prefs.ThemeStyle == "" {
		prefs.ThemeStyle = "light"
	}
	switch prefs.IssueShell {
	case "modal", "drawer", "fullscreen":
	default:
		prefs.IssueShell = "modal"
	}
	switch prefs.Density {
	case "comfortable", "compact":
	default:
		prefs.Density = "comfortable"
	}
	if prefs.ActivityOpen == nil {
		f := false
		prefs.ActivityOpen = &f
	}
	if prefs.ActivityWidth < 240 || prefs.ActivityWidth > 480 {
		prefs.ActivityWidth = 320
	}
	if prefs.CompletedColumnCollapsed == nil {
		f := false
		prefs.CompletedColumnCollapsed = &f
	}
	return prefs
}

func (s *Store) PutUIPrefs(prefs model.UIPrefs) error {
	return s.PutSetting("ui_prefs", prefs)
}

func hydrateProject(p *model.Project, name, reviewMode string) {
	if p == nil {
		return
	}
	if strings.TrimSpace(name) != "" {
		p.Name = name
	}
	if strings.TrimSpace(reviewMode) != "" {
		p.ReviewMode = model.NormalizeReviewMode(model.ReviewMode(reviewMode))
	} else {
		p.ReviewMode = model.NormalizeReviewMode(p.ReviewMode)
	}
	if p.CustomModelConfig != nil {
		upgradeModelConfigURLs(p.CustomModelConfig)
	}
}

func (s *Store) ListProjects() ([]model.Project, error) {
	rows, err := s.db.Query(`SELECT data, name, review_mode FROM projects ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Project
	for rows.Next() {
		var raw, name, reviewMode string
		if err := rows.Scan(&raw, &name, &reviewMode); err != nil {
			return nil, err
		}
		var p model.Project
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			return nil, err
		}
		hydrateProject(&p, name, reviewMode)
		out = append(out, p)
	}
	if out == nil {
		out = []model.Project{}
	}
	return out, rows.Err()
}

func (s *Store) GetProject(id string) (*model.Project, error) {
	var raw, name, reviewMode string
	err := s.db.QueryRow(`SELECT data, name, review_mode FROM projects WHERE id = ?`, id).Scan(&raw, &name, &reviewMode)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p model.Project
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil, err
	}
	hydrateProject(&p, name, reviewMode)
	return &p, nil
}

func (s *Store) UpsertProject(p model.Project) error {
	if p.ID == "" {
		p.ID = "proj-" + uuid.NewString()[:8]
	}
	now := model.NowISO()
	if p.CreatedAt == "" {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	if p.GitRepos == nil {
		p.GitRepos = []model.GitRepo{}
	}
	p.ReviewMode = model.NormalizeReviewMode(p.ReviewMode)

	var existingRaw string
	_ = s.db.QueryRow(`SELECT data FROM projects WHERE id = ?`, p.ID).Scan(&existingRaw)

	// Preserve project custom API key when the client sends a masked/blank value.
	// Also drop response-only fields (keyConfigured/keyHint) so they are not persisted.
	if existing, _ := s.GetProject(p.ID); existing != nil {
		p.CustomModelConfig = mergeCustomModelConfig(existing.CustomModelConfig, p.CustomModelConfig)
	} else {
		p.CustomModelConfig = sanitizeModelConfigForStore(p.CustomModelConfig)
	}

	merged, err := mergeTypedIntoDocument(existingRaw, p)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
INSERT INTO projects(id, data, name, review_mode, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  data = excluded.data,
  name = excluded.name,
  review_mode = excluded.review_mode,
  updated_at = excluded.updated_at
`, p.ID, merged, strings.TrimSpace(p.Name), string(p.ReviewMode), p.CreatedAt, p.UpdatedAt)
	return err
}

func mergeCustomModelConfig(existing, incoming *model.ModelConfig) *model.ModelConfig {
	if incoming == nil {
		// Client omitted custom config — keep whatever was stored.
		return sanitizeModelConfigForStore(existing)
	}
	out := *incoming
	if strings.TrimSpace(out.OpenAIAPIKey) == "" && existing != nil {
		out.OpenAIAPIKey = existing.OpenAIAPIKey
	}
	return sanitizeModelConfigForStore(&out)
}

func sanitizeModelConfigForStore(cfg *model.ModelConfig) *model.ModelConfig {
	if cfg == nil {
		return nil
	}
	out := *cfg
	out.KeyConfigured = false
	out.KeyHint = ""
	out.OpenAIBaseURL = model.UpgradeLegacyOpenAIBaseURL(out.OpenAIBaseURL)
	return &out
}

func (s *Store) DeleteProject(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	issueSub := `SELECT id FROM issues WHERE project_id = ?`
	for _, q := range []string{
		`DELETE FROM issue_repos WHERE issue_id IN (` + issueSub + `)`,
		`DELETE FROM development_revision_commits WHERE revision_id IN (
			SELECT id FROM development_revisions WHERE issue_id IN (` + issueSub + `))`,
		`DELETE FROM development_revisions WHERE issue_id IN (` + issueSub + `)`,
		`DELETE FROM requirement_revisions WHERE issue_id IN (` + issueSub + `)`,
		`DELETE FROM history_events WHERE issue_id IN (` + issueSub + `)`,
		`DELETE FROM autodev_logs WHERE issue_id IN (` + issueSub + `)`,
		`DELETE FROM autodev_jobs WHERE issue_id IN (` + issueSub + `)`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM issues WHERE project_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM projects WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func hydrateIssue(iss *model.Issue, title, kind, priority, status, sourceURL, assignee string) {
	if iss == nil {
		return
	}
	// Queryable columns are the source of truth when present.
	if strings.TrimSpace(title) != "" {
		iss.Title = title
	}
	if strings.TrimSpace(kind) != "" {
		iss.Kind = model.NormalizeIssueKind(model.IssueKind(kind))
	} else {
		iss.Kind = model.NormalizeIssueKind(iss.Kind)
	}
	if strings.TrimSpace(priority) != "" {
		iss.Priority = model.NormalizePriority(model.Priority(priority))
	} else {
		iss.Priority = model.NormalizePriority(iss.Priority)
	}
	if strings.TrimSpace(status) != "" {
		iss.Status = model.IssueStatus(status)
	}
	iss.SourceURL = strings.TrimSpace(sourceURL)
	iss.Assignee = strings.TrimSpace(assignee)
	if iss.ChatMessages == nil {
		iss.ChatMessages = []model.ChatMessage{}
	}
	if iss.AutoDevLogs == nil {
		iss.AutoDevLogs = []model.AutoDevLog{}
	}
	if iss.AssociatedRepoIDs == nil {
		iss.AssociatedRepoIDs = []string{}
	}
	iss.NormalizeSubs()
}

func (s *Store) ListIssues(projectID string) ([]model.Issue, error) {
	var rows *sql.Rows
	var err error
	const cols = `data, title, kind, priority, status, source_url, assignee`
	if projectID == "" {
		rows, err = s.db.Query(`SELECT ` + cols + ` FROM issues ORDER BY updated_at DESC`)
	} else {
		rows, err = s.db.Query(`SELECT `+cols+` FROM issues WHERE project_id = ? ORDER BY updated_at DESC`, projectID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Issue
	for rows.Next() {
		var raw, title, kind, priority, status, sourceURL, assignee string
		if err := rows.Scan(&raw, &title, &kind, &priority, &status, &sourceURL, &assignee); err != nil {
			return nil, err
		}
		var iss model.Issue
		if err := json.Unmarshal([]byte(raw), &iss); err != nil {
			return nil, err
		}
		hydrateIssue(&iss, title, kind, priority, status, sourceURL, assignee)
		out = append(out, iss)
	}
	if out == nil {
		out = []model.Issue{}
	}
	return out, rows.Err()
}

func (s *Store) GetIssue(id string) (*model.Issue, error) {
	var raw, title, kind, priority, status, sourceURL, assignee string
	err := s.db.QueryRow(`
SELECT data, title, kind, priority, status, source_url, assignee FROM issues WHERE id = ?
`, id).Scan(&raw, &title, &kind, &priority, &status, &sourceURL, &assignee)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var iss model.Issue
	if err := json.Unmarshal([]byte(raw), &iss); err != nil {
		return nil, err
	}
	hydrateIssue(&iss, title, kind, priority, status, sourceURL, assignee)
	return &iss, nil
}

// IssueIndexRow is a lightweight issue projection for column-only queries.
type IssueIndexRow struct {
	ID        string
	ProjectID string
	Title     string
	Kind      string
	Priority  string
	Status    string
	SourceURL string
	Assignee  string
	UpdatedAt string
}

// ListIssueIndex returns queryable issue columns without loading document bodies.
func (s *Store) ListIssueIndex(projectID string) ([]IssueIndexRow, error) {
	var rows *sql.Rows
	var err error
	const q = `SELECT id, project_id, title, kind, priority, status, source_url, assignee, updated_at FROM issues`
	if projectID == "" {
		rows, err = s.db.Query(q + ` ORDER BY updated_at DESC`)
	} else {
		rows, err = s.db.Query(q+` WHERE project_id = ? ORDER BY updated_at DESC`, projectID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IssueIndexRow
	for rows.Next() {
		var row IssueIndexRow
		if err := rows.Scan(
			&row.ID, &row.ProjectID, &row.Title, &row.Kind, &row.Priority,
			&row.Status, &row.SourceURL, &row.Assignee, &row.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if out == nil {
		out = []IssueIndexRow{}
	}
	return out, rows.Err()
}

func (s *Store) UpsertIssue(iss model.Issue) error {
	if iss.ID == "" {
		iss.ID = "issue-" + uuid.NewString()[:8]
	}
	now := model.NowISO()
	if iss.CreatedAt == "" {
		iss.CreatedAt = now
	}
	iss.UpdatedAt = now
	if iss.ChatMessages == nil {
		iss.ChatMessages = []model.ChatMessage{}
	}
	if iss.AutoDevLogs == nil {
		iss.AutoDevLogs = []model.AutoDevLog{}
	}
	if iss.AssociatedRepoIDs == nil {
		iss.AssociatedRepoIDs = []string{}
	}
	iss.Kind = model.NormalizeIssueKind(iss.Kind)
	iss.Priority = model.NormalizePriority(iss.Priority)
	iss.SourceURL = strings.TrimSpace(iss.SourceURL)
	iss.NormalizeSubs()

	var existingRaw string
	_ = s.db.QueryRow(`SELECT data FROM issues WHERE id = ?`, iss.ID).Scan(&existingRaw)
	merged, err := mergeTypedIntoDocument(existingRaw, iss)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
INSERT INTO issues(id, project_id, data, title, kind, priority, status, source_url, assignee, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  data = excluded.data,
  project_id = excluded.project_id,
  title = excluded.title,
  kind = excluded.kind,
  priority = excluded.priority,
  status = excluded.status,
  source_url = excluded.source_url,
  assignee = excluded.assignee,
  updated_at = excluded.updated_at
`, iss.ID, iss.ProjectID, merged, strings.TrimSpace(iss.Title), string(iss.Kind), string(iss.Priority),
		string(iss.Status), iss.SourceURL, strings.TrimSpace(iss.Assignee), iss.CreatedAt, iss.UpdatedAt)
	if err != nil {
		return err
	}
	return s.replaceIssueRepos(iss.ID, iss.AssociatedRepoIDs)
}

func (s *Store) DeleteIssue(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM issue_repos WHERE issue_id = ?`,
		`DELETE FROM development_revision_commits WHERE revision_id IN (SELECT id FROM development_revisions WHERE issue_id = ?)`,
		`DELETE FROM development_revisions WHERE issue_id = ?`,
		`DELETE FROM requirement_revisions WHERE issue_id = ?`,
		`DELETE FROM history_events WHERE issue_id = ?`,
		`DELETE FROM autodev_logs WHERE issue_id = ?`,
		`DELETE FROM autodev_jobs WHERE issue_id = ?`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	res, err := tx.Exec(`DELETE FROM issues WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) CreateJob(issueID string) (*model.AutoDevJob, error) {
	now := model.NowISO()
	job := &model.AutoDevJob{
		ID:        "job-" + uuid.NewString()[:12],
		IssueID:   issueID,
		Status:    model.JobQueued,
		Progress:  0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := s.db.Exec(`
INSERT INTO autodev_jobs(id, issue_id, status, progress, phase, error, pr_info, executor, executor_config, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?, NULL, '', NULL, ?, ?)
`, job.ID, job.IssueID, job.Status, job.Progress, "", "", job.CreatedAt, job.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Store) GetJob(id string) (*model.AutoDevJob, error) {
	var job model.AutoDevJob
	var prRaw sql.NullString
	var execName sql.NullString
	var execCfgRaw sql.NullString
	err := s.db.QueryRow(`
SELECT id, issue_id, status, progress, phase, error, pr_info, executor, executor_config, created_at, updated_at
FROM autodev_jobs WHERE id = ?
`, id).Scan(&job.ID, &job.IssueID, &job.Status, &job.Progress, &job.Phase, &job.Error, &prRaw, &execName, &execCfgRaw, &job.CreatedAt, &job.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if execName.Valid {
		job.Executor = execName.String
	}
	if prRaw.Valid && prRaw.String != "" {
		var pr model.PRInfo
		if err := json.Unmarshal([]byte(prRaw.String), &pr); err == nil {
			job.PRInfo = &pr
		}
	}
	if execCfgRaw.Valid && execCfgRaw.String != "" {
		var cfg model.ExecutorConfig
		if err := json.Unmarshal([]byte(execCfgRaw.String), &cfg); err == nil {
			n := cfg.Normalize()
			job.ExecutorConfig = &n
		}
	}
	return &job, nil
}

func (s *Store) UpdateJob(job *model.AutoDevJob) error {
	job.UpdatedAt = model.NowISO()
	var pr any
	if job.PRInfo != nil {
		b, _ := json.Marshal(job.PRInfo)
		pr = string(b)
	}
	var execCfg any
	if job.ExecutorConfig != nil {
		b, _ := json.Marshal(job.ExecutorConfig.Normalize())
		execCfg = string(b)
	}
	_, err := s.db.Exec(`
UPDATE autodev_jobs SET status=?, progress=?, phase=?, error=?, pr_info=?, executor=?, executor_config=?, updated_at=? WHERE id=?
`, job.Status, job.Progress, job.Phase, job.Error, pr, job.Executor, execCfg, job.UpdatedAt, job.ID)
	return err
}

func (s *Store) ActiveJobForRepoIssue(issueID string) (*model.AutoDevJob, error) {
	var id string
	err := s.db.QueryRow(`
SELECT id FROM autodev_jobs
WHERE issue_id = ? AND status IN ('queued','running')
ORDER BY created_at DESC LIMIT 1
`, issueID).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.GetJob(id)
}

// ListJobsByStatus returns jobs whose status is in statuses (any order).
func (s *Store) ListJobsByStatus(statuses ...model.AutoDevJobStatus) ([]model.AutoDevJob, error) {
	if len(statuses) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(statuses))
	args := make([]any, len(statuses))
	for i, st := range statuses {
		placeholders[i] = "?"
		args[i] = string(st)
	}
	q := fmt.Sprintf(`
SELECT id FROM autodev_jobs
WHERE status IN (%s)
ORDER BY created_at ASC
`, strings.Join(placeholders, ","))
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// Collect IDs first: MaxOpenConns=1, so nested GetJob while rows are open deadlocks.
	out := make([]model.AutoDevJob, 0, len(ids))
	for _, id := range ids {
		job, err := s.GetJob(id)
		if err != nil {
			return nil, err
		}
		if job != nil {
			out = append(out, *job)
		}
	}
	return out, nil
}

// FailOrphanJobs marks queued/running jobs as failed after a process restart
// and moves their in_progress issues back to backlog. Worktrees are left intact.
func (s *Store) FailOrphanJobs() (int, error) {
	jobs, err := s.ListJobsByStatus(model.JobQueued, model.JobRunning)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range jobs {
		job := jobs[i]
		job.Status = model.JobFailed
		job.Phase = "failed"
		job.Error = "interrupted: process restarted"
		if err := s.UpdateJob(&job); err != nil {
			return n, err
		}
		issue, err := s.GetIssue(job.IssueID)
		if err != nil {
			return n, err
		}
		if issue != nil && issue.Status == model.StatusInProgress {
			issue.Status = model.StatusBacklog
			issue.UpdatedAt = model.NowISO()
			if err := s.UpsertIssue(*issue); err != nil {
				return n, err
			}
		}
		n++
	}
	return n, nil
}

func (s *Store) AppendJobLog(jobID, issueID string, log model.AutoDevLog) error {
	if log.ID == "" {
		log.ID = "log-" + uuid.NewString()[:10]
	}
	if log.Timestamp == "" {
		log.Timestamp = time.Now().Format("15:04:05")
	}
	b, err := json.Marshal(log)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
INSERT INTO autodev_logs(id, job_id, issue_id, data, created_at) VALUES(?, ?, ?, ?, ?)
`, log.ID, jobID, issueID, string(b), model.NowISO())
	return err
}

func (s *Store) ListJobLogs(jobID string) ([]model.AutoDevLog, error) {
	rows, err := s.db.Query(`SELECT data FROM autodev_logs WHERE job_id = ? ORDER BY created_at ASC`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AutoDevLog
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var log model.AutoDevLog
		if err := json.Unmarshal([]byte(raw), &log); err != nil {
			return nil, err
		}
		out = append(out, log)
	}
	if out == nil {
		out = []model.AutoDevLog{}
	}
	return out, rows.Err()
}

func (s *Store) GetExecutorConfig() (model.ExecutorConfig, error) {
	cfg := model.DefaultExecutorConfig()
	ok, err := s.GetSetting("executor_config", &cfg)
	if err != nil {
		return cfg, err
	}
	if !ok {
		return model.DefaultExecutorConfig(), nil
	}
	return cfg.Normalize(), nil
}

func (s *Store) PutExecutorConfig(cfg model.ExecutorConfig) error {
	cfg = cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return err
	}
	return s.PutSetting("executor_config", cfg)
}
