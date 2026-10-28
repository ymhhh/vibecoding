package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/db"
	"github.com/ymhhh/vibecoding/internal/model"
)

func TestHistoryRecordsAcceptAndSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "h.db")
	store, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: store}
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P", GitRepos: []model.GitRepo{{ID: "r1", Name: "r", Path: "/tmp"}}})
	iss := model.Issue{
		ID: "ISSUE-H1", ProjectID: "p1", Title: "T", Description: "d",
		Status: model.StatusRequirements, AssociatedRepoIDs: []string{"r1"},
		ReqDoc: &model.ReqDoc{RawMarkdown: "# R\n", UpdatedAt: model.NowISO()},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	_ = store.UpsertIssue(iss)

	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/issues/ISSUE-H1/accept-requirement", strings.NewReader("{}")))
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}

	_ = store.Close()
	store2, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	evs, err := store2.ListHistoryEvents("ISSUE-H1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) == 0 || evs[0].EventType != model.HistoryAcceptRequirement {
		t.Fatalf("%+v", evs)
	}
	raw, _ := json.Marshal(evs[0])
	if strings.Contains(strings.ToLower(string(raw)), "sk-") || strings.Contains(string(raw), "apiKey") {
		t.Fatalf("history leaked secrets: %s", raw)
	}
	if evs[0].AppVersion == "" {
		t.Fatal("missing app version")
	}
}

func TestModelChangeKeepsIssueDocsAndRecordsHistory(t *testing.T) {
	srv, store := testServer(t)
	_ = store.PutModelConfig(model.ModelConfig{OpenAIModel: "old-model", OpenAIAPIKey: "sk-secret-keep"})
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P"})
	iss := model.Issue{
		ID: "ISSUE-M1", ProjectID: "p1", Title: "T", Description: "keep me",
		Status: model.StatusRequirements,
		ChatMessages: []model.ChatMessage{{ID: "c1", Sender: "user", Text: "hi"}},
		ReqDoc:       &model.ReqDoc{RawMarkdown: "# req", UpdatedAt: model.NowISO()},
		DevSpec:      &model.DevSpec{Title: "d", RawMarkdown: "# des", UpdatedAt: model.NowISO()},
		CreatedAt:    model.NowISO(), UpdatedAt: model.NowISO(),
	}
	_ = store.UpsertIssue(iss)
	_ = store.PutUIPrefs(model.UIPrefs{ActiveIssueID: "ISSUE-M1", ActiveProjectID: "p1", Language: "en", ThemeStyle: "light"})

	req := httptest.NewRequest(http.MethodPut, "/api/settings/model", strings.NewReader(
		`{"openAIModel":"new-model","openAIApiKey":"","openAIBaseUrl":"https://api.openai.com/v1/chat/completions","temperature":0.2}`,
	))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}

	got, _ := store.GetIssue("ISSUE-M1")
	if got == nil || len(got.ChatMessages) != 1 || got.ReqDoc == nil || got.DevSpec == nil {
		t.Fatalf("docs/chat cleared: %+v", got)
	}
	evs, _ := store.ListHistoryEvents("ISSUE-M1", 20)
	found := false
	for _, ev := range evs {
		if ev.EventType == model.HistoryModelChange {
			found = true
			if strings.Contains(strings.ToLower(ev.Model), "sk-") {
				t.Fatal("model field has key")
			}
		}
	}
	if !found {
		t.Fatalf("missing model_change: %+v", evs)
	}
}

func TestExecutorChangeClearsSessionKeepsHistory(t *testing.T) {
	srv, store := testServer(t)
	_ = store.PutExecutorConfig(model.ExecutorConfig{Type: "llm"})
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P"})
	iss := model.Issue{
		ID: "ISSUE-E1", ProjectID: "p1", Title: "T", Status: model.StatusInReview,
		AgentSessionID: "sess-old",
		PRInfo:         &model.PRInfo{Executor: "LLM (VibeBot)", BranchName: "ai-dev/x"},
		CreatedAt:      model.NowISO(), UpdatedAt: model.NowISO(),
	}
	_ = store.UpsertIssue(iss)
	_, _ = store.AppendHistoryEvent(model.HistoryEvent{IssueID: "ISSUE-E1", EventType: model.HistoryCodingFinish, Payload: map[string]any{}})
	_ = store.PutUIPrefs(model.UIPrefs{ActiveIssueID: "ISSUE-E1", Language: "en", ThemeStyle: "light"})

	body := `{"type":"agent","preset":"claude","timeoutSec":1800,"maxHeal":2}`
	req := httptest.NewRequest(http.MethodPut, "/api/settings/executor", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	got, _ := store.GetIssue("ISSUE-E1")
	if got.AgentSessionID != "" {
		t.Fatalf("session not cleared: %q", got.AgentSessionID)
	}
	evs, _ := store.ListHistoryEvents("ISSUE-E1", 50)
	if len(evs) < 2 {
		t.Fatalf("history lost: %+v", evs)
	}
}

func TestSessionFocusPersistsActiveIssue(t *testing.T) {
	srv, store := testServer(t)
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P"})
	_ = store.UpsertIssue(model.Issue{
		ID: "ISSUE-F1", ProjectID: "p1", Title: "T", Status: model.StatusRequirements,
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	})
	req := httptest.NewRequest(http.MethodPost, "/api/session/focus", strings.NewReader(`{"issueId":"ISSUE-F1"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	prefs, _ := store.GetUIPrefs()
	if prefs.ActiveIssueID != "ISSUE-F1" || prefs.ActiveProjectID != "p1" {
		t.Fatalf("%+v", prefs)
	}
	evs, _ := store.ListHistoryEvents("ISSUE-F1", 5)
	if len(evs) == 0 || evs[0].EventType != model.HistorySessionFocus {
		t.Fatalf("%+v", evs)
	}
}

func TestHealthReportsVersion(t *testing.T) {
	srv, _ := testServer(t)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	var body map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["version"] == nil || body["version"] == "" {
		t.Fatalf("%v", body)
	}
}
