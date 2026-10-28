package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/issueimport"
	"github.com/ymhhh/vibecoding/internal/model"
)

func TestImportIssueFromLink(t *testing.T) {
	srv, store := testServer(t)
	_ = store.UpsertProject(model.Project{
		ID: "p1", Name: "P", ReviewMode: model.ReviewModeLocal,
		GitRepos: []model.GitRepo{{ID: "r1", Name: "r", Path: "/tmp"}},
	})

	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"title": "From GH", "body": "Imported body",
			"html_url": "https://github.com/o/r/issues/7", "number": 7,
		})
	}))
	defer gh.Close()

	issueimport.ResetHosts()
	t.Cleanup(func() {
		issueimport.ResetHosts()
		issueimport.Register(issueimport.GitHubHost{})
		issueimport.Register(issueimport.GiteeHost{})
		issueimport.Register(issueimport.LinearHost{})
	})
	issueimport.Register(issueimport.GitHubHost{APIBase: gh.URL})

	req := httptest.NewRequest(http.MethodPost, "/api/issues/import", strings.NewReader(
		`{"projectId":"p1","url":"https://github.com/o/r/issues/7","associatedRepoIds":["r1"]}`,
	))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 201 {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp importIssueResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Created || resp.Issue == nil {
		t.Fatalf("%+v", resp)
	}
	if resp.Issue.Status != model.StatusRequirements {
		t.Fatalf("status=%s", resp.Issue.Status)
	}
	if resp.Issue.Title != "From GH" || resp.Issue.Description != "Imported body" {
		t.Fatalf("%+v", resp.Issue)
	}
	if resp.Issue.SourceURL != "https://github.com/o/r/issues/7" {
		t.Fatalf("sourceUrl=%q", resp.Issue.SourceURL)
	}
	// still needs req/design — not auto-accepted
	if resp.Issue.ReqDoc != nil && resp.Issue.ReqDoc.AcceptedAt != "" {
		t.Fatal("import must not accept requirement")
	}
	proj, _ := store.GetProject("p1")
	if model.NormalizeReviewMode(proj.ReviewMode) != model.ReviewModeLocal {
		t.Fatalf("review mode changed: %s", proj.ReviewMode)
	}

	// duplicate
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/issues/import", strings.NewReader(
		`{"projectId":"p1","url":"https://github.com/o/r/issues/7/","associatedRepoIds":["r1"]}`,
	))
	req2.Header.Set("Content-Type", "application/json")
	srv.Handler().ServeHTTP(rr2, req2)
	if rr2.Code != 200 {
		t.Fatalf("dup status=%d %s", rr2.Code, rr2.Body.String())
	}
	var resp2 importIssueResponse
	_ = json.Unmarshal(rr2.Body.Bytes(), &resp2)
	if resp2.Created || resp2.Issue.ID != resp.Issue.ID {
		t.Fatalf("dup %+v vs %+v", resp2, resp)
	}
	list, _ := store.ListIssues("p1")
	if len(list) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(list))
	}
}

func TestImportUnsupportedHost(t *testing.T) {
	srv, store := testServer(t)
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P"})
	req := httptest.NewRequest(http.MethodPost, "/api/issues/import", strings.NewReader(
		`{"projectId":"p1","url":"https://unknown.example/o/r/issues/1"}`,
	))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("status=%d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "not recognized") {
		t.Fatalf("%s", rr.Body.String())
	}
}

func TestImportTokensRoundTrip(t *testing.T) {
	srv, _ := testServer(t)
	req := httptest.NewRequest(http.MethodPut, "/api/settings/import-tokens", strings.NewReader(
		`{"github":"ghp_secret1234","gitee":"gee_tok","linear":"lin_tok_abcd"}`,
	))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var pub model.IssueImportTokens
	_ = json.Unmarshal(rr.Body.Bytes(), &pub)
	if pub.GitHub != "" || !pub.GitHubConfigured || !strings.Contains(pub.GitHubHint, "1234") {
		t.Fatalf("%+v", pub)
	}
	get := httptest.NewRequest(http.MethodGet, "/api/settings/import-tokens", nil)
	rr2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr2, get)
	_ = json.Unmarshal(rr2.Body.Bytes(), &pub)
	if pub.GitHub != "" || !pub.GitHubConfigured {
		t.Fatalf("%+v", pub)
	}
	// blank update keeps key
	req3 := httptest.NewRequest(http.MethodPut, "/api/settings/import-tokens", strings.NewReader(`{"github":""}`))
	req3.Header.Set("Content-Type", "application/json")
	rr3 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr3, req3)
	_ = json.Unmarshal(rr3.Body.Bytes(), &pub)
	if !pub.GitHubConfigured {
		t.Fatal("blank should keep token")
	}
}
