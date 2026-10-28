package db

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"

	_ "modernc.org/sqlite"
)

func TestQueryableColumnsDualWriteAndIndex(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "q.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	p := model.Project{
		ID:         "proj-1",
		Name:       "Demo",
		ReviewMode: model.ReviewModeLocalAndRemote,
		CreatedAt:  model.NowISO(),
	}
	if err := store.UpsertProject(p); err != nil {
		t.Fatal(err)
	}

	iss := model.Issue{
		ID:                "issue-1",
		ProjectID:         "proj-1",
		Title:             "Import me",
		Kind:              model.IssueKindBugfix,
		Priority:          model.PriorityUrgent,
		Status:            model.StatusBacklog,
		SourceURL:         "https://github.com/acme/app/issues/9",
		Assignee:          "alice",
		AssociatedRepoIDs: []string{"repo-a", "repo-b"},
		Description:       "body stays in document",
		CreatedAt:         model.NowISO(),
	}
	if err := store.UpsertIssue(iss); err != nil {
		t.Fatal(err)
	}

	var title, kind, priority, status, sourceURL string
	err = store.db.QueryRow(`
SELECT title, kind, priority, status, source_url FROM issues WHERE id = ?
`, "issue-1").Scan(&title, &kind, &priority, &status, &sourceURL)
	if err != nil {
		t.Fatal(err)
	}
	if title != "Import me" || kind != "bugfix" || priority != "urgent" || status != "backlog" || sourceURL != iss.SourceURL {
		t.Fatalf("columns=%q %q %q %q %q", title, kind, priority, status, sourceURL)
	}

	var name, reviewMode string
	if err := store.db.QueryRow(`SELECT name, review_mode FROM projects WHERE id = ?`, "proj-1").Scan(&name, &reviewMode); err != nil {
		t.Fatal(err)
	}
	if name != "Demo" || reviewMode != string(model.ReviewModeLocalAndRemote) {
		t.Fatalf("project columns name=%q mode=%q", name, reviewMode)
	}

	index, err := store.ListIssueIndex("proj-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != 1 {
		t.Fatalf("index len=%d", len(index))
	}
	if index[0].Kind != "bugfix" || index[0].SourceURL != iss.SourceURL || index[0].Title != "Import me" {
		t.Fatalf("index row=%+v", index[0])
	}

	var repoCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM issue_repos WHERE issue_id = ?`, "issue-1").Scan(&repoCount); err != nil {
		t.Fatal(err)
	}
	if repoCount != 2 {
		t.Fatalf("issue_repos count=%d", repoCount)
	}
}

func TestQueryableColumnsPreserveUnknownFields(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "preserve.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	legacy := map[string]any{
		"id":                "issue-legacy",
		"projectId":         "proj-legacy",
		"title":             "Legacy",
		"priority":          "high",
		"kind":              "feature",
		"status":            "requirements",
		"associatedRepoIds": []string{},
		"chatMessages":      []any{},
		"autoDevLogs":       []any{},
		"legacyCustomField": "keep-me",
		"createdAt":         model.NowISO(),
		"updatedAt":         model.NowISO(),
	}
	raw, _ := json.Marshal(legacy)
	_, err = store.db.Exec(`
INSERT INTO issues(id, project_id, data, title, kind, priority, status, source_url, assignee, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)
`, "issue-legacy", "proj-legacy", string(raw), "Legacy", "feature", "high", "requirements", model.NowISO(), model.NowISO())
	if err != nil {
		t.Fatal(err)
	}

	got, err := store.GetIssue("issue-legacy")
	if err != nil || got == nil {
		t.Fatalf("get: %v %#v", err, got)
	}
	got.Title = "Legacy renamed"
	got.SourceURL = "https://example.com/i/1"
	if err := store.UpsertIssue(*got); err != nil {
		t.Fatal(err)
	}

	var stored string
	if err := store.db.QueryRow(`SELECT data FROM issues WHERE id = ?`, "issue-legacy").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(stored), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["legacyCustomField"] != "keep-me" {
		t.Fatalf("unknown field dropped: %#v", doc["legacyCustomField"])
	}
	if doc["title"] != "Legacy renamed" {
		t.Fatalf("title not updated: %#v", doc["title"])
	}
	if doc["sourceUrl"] != "https://example.com/i/1" {
		t.Fatalf("sourceUrl missing: %#v", doc["sourceUrl"])
	}

	got.AgentSessionID = "sess-old"
	if err := store.UpsertIssue(*got); err != nil {
		t.Fatal(err)
	}
	got.AgentSessionID = ""
	if err := store.UpsertIssue(*got); err != nil {
		t.Fatal(err)
	}
	cleared, err := store.GetIssue("issue-legacy")
	if err != nil || cleared == nil {
		t.Fatalf("get after clear: %v %#v", err, cleared)
	}
	if cleared.AgentSessionID != "" {
		t.Fatalf("known field clear did not stick: %q", cleared.AgentSessionID)
	}
	if err := store.db.QueryRow(`SELECT data FROM issues WHERE id = ?`, "issue-legacy").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(stored), &doc); err != nil {
		t.Fatal(err)
	}
	if _, ok := doc["agentSessionId"]; ok {
		t.Fatalf("cleared known field still in document: %#v", doc["agentSessionId"])
	}
	if doc["legacyCustomField"] != "keep-me" {
		t.Fatalf("unknown field dropped after clear: %#v", doc["legacyCustomField"])
	}
}

func TestQueryableColumnsBackfillFromLegacyBlob(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	sqldb, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	_, err = sqldb.Exec(`
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)
	if err != nil {
		t.Fatal(err)
	}
	proj := model.Project{ID: "p1", Name: "Old Project", CreatedAt: model.NowISO(), UpdatedAt: model.NowISO()}
	pb, _ := json.Marshal(proj)
	_, err = sqldb.Exec(`INSERT INTO projects(id, data, created_at, updated_at) VALUES(?,?,?,?)`,
		proj.ID, string(pb), proj.CreatedAt, proj.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	iss := model.Issue{
		ID:        "i1",
		ProjectID: "p1",
		Title:     "Old Issue",
		Kind:      model.IssueKindHotfix,
		Priority:  model.PriorityLow,
		Status:    model.StatusInReview,
		SourceURL: "https://gitee.com/acme/x/issues/3",
		CreatedAt: model.NowISO(),
		UpdatedAt: model.NowISO(),
	}
	ib, _ := json.Marshal(iss)
	_, err = sqldb.Exec(`INSERT INTO issues(id, project_id, data, status, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
		iss.ID, iss.ProjectID, string(ib), string(iss.Status), iss.CreatedAt, iss.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	_ = sqldb.Close()

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var kind, priority, sourceURL, title string
	err = store.db.QueryRow(`SELECT title, kind, priority, source_url FROM issues WHERE id = ?`, "i1").
		Scan(&title, &kind, &priority, &sourceURL)
	if err != nil {
		t.Fatal(err)
	}
	if title != "Old Issue" || kind != "hotfix" || priority != "low" || sourceURL != iss.SourceURL {
		t.Fatalf("backfill issue columns: %q %q %q %q", title, kind, priority, sourceURL)
	}
	var name string
	if err := store.db.QueryRow(`SELECT name FROM projects WHERE id = ?`, "p1").Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Old Project" {
		t.Fatalf("backfill project name=%q", name)
	}

	// Revision / history tables exist for later milestones.
	for _, table := range []string{
		"requirement_revisions",
		"development_revisions",
		"development_revision_commits",
		"history_events",
		"issue_repos",
	} {
		var n int
		if err := store.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
			t.Fatalf("table %s missing: %v", table, err)
		}
	}
}
