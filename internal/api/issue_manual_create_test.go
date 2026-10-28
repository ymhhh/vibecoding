package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"
)

func TestCreateIssueManualPathUnchanged(t *testing.T) {
	srv, store := testServer(t)
	_ = store.UpsertProject(model.Project{ID: "p1", Name: "P", GitRepos: []model.GitRepo{{ID: "r1", Name: "r", Path: "/tmp"}}} )
	body := `{"id":"ISSUE-manual","projectId":"p1","title":"Manual","description":"d","associatedRepoIds":["r1"],"priority":"medium","kind":"feature"}`
	req := httptest.NewRequest(http.MethodPost, "/api/issues", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 201 {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var iss model.Issue
	if err := json.Unmarshal(rr.Body.Bytes(), &iss); err != nil {
		t.Fatal(err)
	}
	if iss.Status != model.StatusRequirements {
		t.Fatalf("status=%s", iss.Status)
	}
	if iss.SourceURL != "" {
		t.Fatalf("manual create should not set sourceUrl: %q", iss.SourceURL)
	}
}

