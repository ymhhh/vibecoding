package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/model"
)

func TestListProjectCommitsMergesRepos(t *testing.T) {
	srv, store := testServer(t)
	h := srv.Handler()

	a := t.TempDir()
	b := t.TempDir()
	initRepo(t, a, "main")
	initRepo(t, b, "main")
	if err := os.WriteFile(filepath.Join(b, "extra.txt"), []byte("later\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitAt(t, b, "add", ".")
	gitAt(t, b, "commit", "-m", "later change")

	p := model.Project{
		ID:   "proj-commits",
		Name: "Timeline",
		GitRepos: []model.GitRepo{
			{ID: "r1", Name: "alpha", Path: a, DefaultBranch: "main"},
			{ID: "r2", Name: "beta", Path: b, DefaultBranch: "main"},
			{ID: "r3", Name: "missing", Path: filepath.Join(t.TempDir(), "nope"), DefaultBranch: "main"},
		},
		CreatedAt: model.NowISO(),
		UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertProject(p); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/projects/proj-commits/commits?limit=10", nil))
	if rr.Code != 200 {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var body struct {
		Commits []gitx.RepoCommit `json:"commits"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Commits) < 2 {
		t.Fatalf("commits=%d body=%s", len(body.Commits), rr.Body.String())
	}
	names := map[string]bool{}
	subjects := map[string]bool{}
	for _, c := range body.Commits {
		names[c.RepoName] = true
		subjects[c.Subject] = true
		if c.SHA == "" || c.Author == "" {
			t.Fatalf("incomplete %+v", c)
		}
	}
	if !names["alpha"] || !names["beta"] {
		t.Fatalf("repos=%v", names)
	}
	if names["missing"] {
		t.Fatal("missing path should be skipped")
	}
	if !subjects["later change"] {
		t.Fatalf("subjects=%v", subjects)
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/projects/no-such/commits", nil))
	if rr.Code != 404 {
		t.Fatalf("missing project status=%d", rr.Code)
	}
}

func gitAt(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}
