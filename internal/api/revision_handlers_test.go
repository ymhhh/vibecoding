package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"
)

func seedIssueWithDocs(t *testing.T, store interface {
	UpsertProject(model.Project) error
	UpsertIssue(model.Issue) error
}, id string) {
	t.Helper()
	_ = store.UpsertProject(model.Project{ID: "p-rev", Name: "P", GitRepos: []model.GitRepo{{ID: "r1", Name: "r", Path: "/tmp"}}})
	iss := model.Issue{
		ID: id, ProjectID: "p-rev", Title: "T", Description: "d",
		Status: model.StatusRequirements, AssociatedRepoIDs: []string{"r1"},
		SourceURL: "https://github.com/o/r/issues/1",
		ReqDoc: &model.ReqDoc{
			RawMarkdown: "# Req v1\n",
			UpdatedAt:   model.NowISO(),
		},
		DevSpec: &model.DevSpec{
			Title: "D", Summary: "s", ArchitectureDesign: "a",
			RawMarkdown: "# Design v1\n", UpdatedAt: model.NowISO(),
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(iss); err != nil {
		t.Fatal(err)
	}
}

func TestAcceptRequirementAppendsImmutableRevision(t *testing.T) {
	srv, store := testServer(t)
	seedIssueWithDocs(t, store, "ISSUE-REV-1")

	post := func() *model.Issue {
		req := httptest.NewRequest(http.MethodPost, "/api/issues/ISSUE-REV-1/accept-requirement", strings.NewReader("{}"))
		rr := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Fatalf("status=%d %s", rr.Code, rr.Body.String())
		}
		var iss model.Issue
		_ = json.Unmarshal(rr.Body.Bytes(), &iss)
		return &iss
	}

	first := post()
	if first.CurrentRequirementRevisionID == "" {
		t.Fatal("missing revision id")
	}
	listReq := httptest.NewRequest(http.MethodGet, "/api/issues/ISSUE-REV-1/revisions", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, listReq)
	var payload struct {
		RequirementRevisions []model.RequirementRevision `json:"requirementRevisions"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &payload)
	if len(payload.RequirementRevisions) != 1 {
		t.Fatalf("%+v", payload.RequirementRevisions)
	}
	if payload.RequirementRevisions[0].Source != "import" || payload.RequirementRevisions[0].SourceURL == "" {
		t.Fatalf("import provenance: %+v", payload.RequirementRevisions[0])
	}
	prevBody := payload.RequirementRevisions[0].RawMarkdown

	// Edit and accept again — previous revision unchanged
	iss, _ := store.GetIssue("ISSUE-REV-1")
	iss.ReqDoc.RawMarkdown = "# Req v2\n"
	iss.TouchReqDoc()
	_ = store.UpsertIssue(*iss)
	second := post()
	if second.CurrentRequirementRevisionID == first.CurrentRequirementRevisionID {
		t.Fatal("expected new revision id")
	}
	rr2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr2, httptest.NewRequest(http.MethodGet, "/api/issues/ISSUE-REV-1/revisions", nil))
	_ = json.Unmarshal(rr2.Body.Bytes(), &payload)
	if len(payload.RequirementRevisions) != 2 {
		t.Fatalf("want 2 got %d", len(payload.RequirementRevisions))
	}
	if payload.RequirementRevisions[0].RawMarkdown != prevBody {
		t.Fatal("previous revision mutated")
	}
}

func TestAcceptDesignLinksRequirementRevision(t *testing.T) {
	srv, store := testServer(t)
	seedIssueWithDocs(t, store, "ISSUE-REV-2")

	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/issues/ISSUE-REV-2/accept-requirement", strings.NewReader("{}")))
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var afterReq model.Issue
	_ = json.Unmarshal(rr.Body.Bytes(), &afterReq)

	rr2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr2, httptest.NewRequest(http.MethodPost, "/api/issues/ISSUE-REV-2/accept-design", strings.NewReader("{}")))
	if rr2.Code != 200 {
		t.Fatalf("%d %s", rr2.Code, rr2.Body.String())
	}
	var afterDes model.Issue
	_ = json.Unmarshal(rr2.Body.Bytes(), &afterDes)
	if afterDes.CurrentDevelopmentRevisionID == "" {
		t.Fatal("missing development revision")
	}
	if afterDes.DesignRequirementRevisionID != afterReq.CurrentRequirementRevisionID {
		t.Fatalf("design cites %q want %q", afterDes.DesignRequirementRevisionID, afterReq.CurrentRequirementRevisionID)
	}

	rr3 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr3, httptest.NewRequest(http.MethodGet, "/api/issues/ISSUE-REV-2/revisions", nil))
	var payload struct {
		DevelopmentRevisions []model.DevelopmentRevision `json:"developmentRevisions"`
	}
	_ = json.Unmarshal(rr3.Body.Bytes(), &payload)
	if len(payload.DevelopmentRevisions) != 1 {
		t.Fatalf("%+v", payload.DevelopmentRevisions)
	}
	if payload.DevelopmentRevisions[0].RequirementRevisionID != afterReq.CurrentRequirementRevisionID {
		t.Fatal("link missing")
	}

	// New requirement accept leaves old development revision readable
	iss, _ := store.GetIssue("ISSUE-REV-2")
	iss.ReqDoc.RawMarkdown = "# Req next\n"
	iss.TouchReqDoc()
	_ = store.UpsertIssue(*iss)
	rr4 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr4, httptest.NewRequest(http.MethodPost, "/api/issues/ISSUE-REV-2/accept-requirement", strings.NewReader("{}")))
	if rr4.Code != 200 {
		t.Fatal(rr4.Body.String())
	}
	var afterReq2 model.Issue
	_ = json.Unmarshal(rr4.Body.Bytes(), &afterReq2)
	if !afterReq2.DesignStale() {
		t.Fatal("design should be stale vs new requirement revision")
	}
	rr5 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr5, httptest.NewRequest(http.MethodGet, "/api/issues/ISSUE-REV-2/revisions", nil))
	_ = json.Unmarshal(rr5.Body.Bytes(), &payload)
	if len(payload.DevelopmentRevisions) != 1 {
		t.Fatalf("old design revision should remain: %d", len(payload.DevelopmentRevisions))
	}
}

func TestAttachDevelopmentCommitsForksOnRework(t *testing.T) {
	_, store := testServer(t)
	seedIssueWithDocs(t, store, "ISSUE-REV-3")
	iss, _ := store.GetIssue("ISSUE-REV-3")
	iss.AcceptRequirement()
	reqRev, err := store.AppendRequirementRevision(iss.ID, iss.ReqDoc.RawMarkdown, "manual", "")
	if err != nil {
		t.Fatal(err)
	}
	iss.CurrentRequirementRevisionID = reqRev.ID
	iss.AcceptDesign()
	devRev, err := store.AppendDevelopmentRevision(iss.ID, reqRev.ID, iss.DesignMarkdown())
	if err != nil {
		t.Fatal(err)
	}
	iss.CurrentDevelopmentRevisionID = devRev.ID
	iss.DesignRequirementRevisionID = reqRev.ID
	_ = store.UpsertIssue(*iss)

	if err := store.AttachDevelopmentCommits(iss, []model.DevelopmentRevisionCommit{{RepoID: "r1", SHA: "aaa111"}}); err != nil {
		t.Fatal(err)
	}
	firstID := iss.CurrentDevelopmentRevisionID
	got, _ := store.GetDevelopmentRevision(firstID)
	if len(got.Commits) != 1 || got.Commits[0].SHA != "aaa111" {
		t.Fatalf("%+v", got.Commits)
	}

	if err := store.AttachDevelopmentCommits(iss, []model.DevelopmentRevisionCommit{{RepoID: "r1", SHA: "bbb222"}}); err != nil {
		t.Fatal(err)
	}
	if iss.CurrentDevelopmentRevisionID == firstID {
		t.Fatal("rework should fork a new development revision")
	}
	prev, _ := store.GetDevelopmentRevision(firstID)
	if len(prev.Commits) != 1 || prev.Commits[0].SHA != "aaa111" {
		t.Fatalf("previous commits mutated: %+v", prev.Commits)
	}
	cur, _ := store.GetDevelopmentRevision(iss.CurrentDevelopmentRevisionID)
	if len(cur.Commits) != 1 || cur.Commits[0].SHA != "bbb222" {
		t.Fatalf("%+v", cur.Commits)
	}
}
