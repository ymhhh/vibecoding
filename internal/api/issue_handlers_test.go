package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"
)

func TestDeleteIssueRemovesRowAndJobs(t *testing.T) {
	srv, store := testServer(t)
	h := srv.Handler()

	iss := model.Issue{
		ID:        "ISSUE-2857",
		ProjectID: "proj-1",
		Title:     "订单导出",
		Status:    model.StatusBacklog,
		CreatedAt: model.NowISO(),
		UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(iss); err != nil {
		t.Fatal(err)
	}
	job, err := store.CreateJob(iss.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AppendJobLog(job.ID, iss.ID, model.AutoDevLog{Phase: "coding", Message: "hi"}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/issues/"+iss.ID, nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("DELETE status=%d body=%s", rr.Code, rr.Body.String())
	}
	var ok map[string]bool
	if err := json.Unmarshal(rr.Body.Bytes(), &ok); err != nil {
		t.Fatal(err)
	}
	if !ok["ok"] {
		t.Fatalf("body=%s", rr.Body.String())
	}

	got, err := store.GetIssue(iss.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("issue still present: %+v", got)
	}
	if leftover, err := store.GetJob(job.ID); err != nil {
		t.Fatal(err)
	} else if leftover != nil {
		t.Fatalf("job still present: %+v", leftover)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/issues/"+iss.ID, nil)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 404 {
		t.Fatalf("second DELETE status=%d body=%s", rr.Code, rr.Body.String())
	}
}
