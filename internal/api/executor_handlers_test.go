package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/autodev"
	"github.com/ymhhh/vibecoding/internal/db"
	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/model"
)

func testServer(t *testing.T) (*Server, *db.Store) {
	t.Helper()
	store, err := db.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	hub := autodev.NewHub()
	return &Server{Store: store, Hub: hub, Runner: &autodev.Runner{Store: store, Hub: hub}}, store
}

func initRepo(t *testing.T, dir, branch string) {
	t.Helper()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-b", branch)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-m", "init")
}

func TestExecutorSettingsRoundTrip(t *testing.T) {
	srv, _ := testServer(t)
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/settings/executor", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("GET status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got model.ExecutorConfig
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "llm" {
		t.Fatalf("default type=%q", got.Type)
	}

	body := `{"type":"agent","preset":"claude","timeoutSec":600,"maxHeal":1}`
	req = httptest.NewRequest(http.MethodPut, "/api/settings/executor", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("PUT status=%d body=%s", rr.Code, rr.Body.String())
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "agent" || got.Preset != "claude" || got.TimeoutSec != 600 || got.MaxHeal != 1 {
		t.Fatalf("%+v", got)
	}

	// bad custom rejected
	bad := `{"type":"agent","preset":"custom","command":"echo"}`
	req = httptest.NewRequest(http.MethodPut, "/api/settings/executor", strings.NewReader(bad))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code < 400 {
		t.Fatalf("expected 4xx for bad custom, got %d", rr.Code)
	}
}

func TestListExecutors(t *testing.T) {
	srv, _ := testServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/executors", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status=%d %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	list, ok := resp["executors"].([]any)
	if !ok || len(list) < 3 {
		t.Fatalf("executors=%v", resp["executors"])
	}
}

func TestListExecutorsMarksLLMWhenKeyConfigured(t *testing.T) {
	srv, store := testServer(t)
	if err := store.PutModelConfig(model.ModelConfig{
		OpenAIAPIKey: "sk-test-key-for-probe",
		OpenAIModel:  "gpt-test",
	}); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/executors", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status=%d %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Executors []executor.ProbeResult `json:"executors"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	var llm executor.ProbeResult
	for _, e := range resp.Executors {
		if e.ID == "llm" {
			llm = e
		}
	}
	if !llm.Available {
		t.Fatalf("llm should be available when API key set: %+v", llm)
	}
}

func TestIssueDiffAndApproveDirty(t *testing.T) {
	srv, store := testServer(t)
	repoDir := t.TempDir()
	initRepo(t, repoDir, "main")

	// Feature branch with an extra commit.
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repoDir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("checkout", "-b", "ai-dev/issue-test")
	if err := os.WriteFile(filepath.Join(repoDir, "feat.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-m", "feat")
	run("checkout", "main")

	repo := model.GitRepo{ID: "r1", Name: "demo", Path: repoDir, DefaultBranch: "main"}
	proj := model.Project{ID: "p1", Name: "p", GitRepos: []model.GitRepo{repo}, CreatedAt: model.NowISO(), UpdatedAt: model.NowISO()}
	if err := store.UpsertProject(proj); err != nil {
		t.Fatal(err)
	}
	issue := model.Issue{
		ID: "i1", ProjectID: "p1", Title: "t", Status: model.StatusInReview,
		AssociatedRepoIDs: []string{"r1"},
		PRInfo: &model.PRInfo{
			ID: "pr1", BranchName: "ai-dev/issue-test", Title: "t", Status: "open",
			BaseBranch: "main", Author: "bot", CreatedAt: model.NowISO(),
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/issues/i1/diff", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("diff status=%d %s", rr.Code, rr.Body.String())
	}
	var diff issueDiffResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &diff); err != nil {
		t.Fatal(err)
	}
	if len(diff.Repos) != 1 || diff.Repos[0].Stats.FilesChanged < 1 {
		t.Fatalf("diff=%+v", diff)
	}
	if diff.Repos[0].Ahead < 1 {
		t.Fatalf("expected ahead>=1 got %+v", diff.Repos[0])
	}

	// Dirty main on default branch → approve must 4xx.
	if err := os.WriteFile(filepath.Join(repoDir, "dirty.txt"), []byte("nope\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/issues/i1/approve-merge", bytes.NewReader(nil))
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code < 400 {
		t.Fatalf("expected merge rejection on dirty main, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestApproveMergeSuccessRemovesWorktrees(t *testing.T) {
	srv, store := testServer(t)
	repoDir := t.TempDir()
	initRepo(t, repoDir, "main")

	run := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	wtPath := filepath.Join(t.TempDir(), "issue-ok", "r1")
	run(repoDir, "worktree", "add", "-b", "ai-dev/issue-ok", wtPath, "main")
	if err := os.WriteFile(filepath.Join(wtPath, "feat.txt"), []byte("merged\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(wtPath, "add", ".")
	run(wtPath, "commit", "-m", "feat")

	repo := model.GitRepo{ID: "r1", Name: "demo", Path: repoDir, DefaultBranch: "main"}
	proj := model.Project{ID: "p1", Name: "p", GitRepos: []model.GitRepo{repo}, CreatedAt: model.NowISO(), UpdatedAt: model.NowISO()}
	if err := store.UpsertProject(proj); err != nil {
		t.Fatal(err)
	}
	issue := model.Issue{
		ID: "i-ok", ProjectID: "p1", Title: "t", Status: model.StatusInReview,
		AssociatedRepoIDs: []string{"r1"},
		PRInfo: &model.PRInfo{
			ID: "pr-ok", BranchName: "ai-dev/issue-ok", Title: "t", Status: "open",
			BaseBranch: "main", Author: "bot", CreatedAt: model.NowISO(),
			Worktrees: []model.WorktreeRef{{RepoID: "r1", RepoName: "demo", Path: wtPath}},
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/issues/i-ok/approve-merge", bytes.NewReader(nil))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve status=%d %s", rr.Code, rr.Body.String())
	}
	var got model.Issue
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != model.StatusCompleted || got.PRInfo == nil || got.PRInfo.Status != "merged" {
		t.Fatalf("issue after approve: status=%s pr=%+v", got.Status, got.PRInfo)
	}
	if len(got.PRInfo.Worktrees) != 0 {
		t.Fatalf("worktrees should be cleared: %+v", got.PRInfo.Worktrees)
	}
	if _, err := os.Stat(filepath.Join(repoDir, "feat.txt")); err != nil {
		t.Fatalf("expected feat.txt on default branch after merge: %v", err)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("worktree path should be removed, stat err=%v", err)
	}
}

func TestApproveMergeIntoChosenBranch(t *testing.T) {
	srv, store := testServer(t)
	repoDir := t.TempDir()
	initRepo(t, repoDir, "main")
	run := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run(repoDir, "checkout", "-b", "hotfix_1")
	run(repoDir, "checkout", "main")
	wtPath := filepath.Join(t.TempDir(), "issue-hot", "r1")
	run(repoDir, "worktree", "add", "-b", "ai-dev/issue-hot", wtPath, "main")
	if err := os.WriteFile(filepath.Join(wtPath, "feat.txt"), []byte("hot\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(wtPath, "add", ".")
	run(wtPath, "commit", "-m", "feat")

	repo := model.GitRepo{ID: "r1", Name: "demo", Path: repoDir, DefaultBranch: "main"}
	proj := model.Project{ID: "p1", Name: "p", GitRepos: []model.GitRepo{repo}, CreatedAt: model.NowISO(), UpdatedAt: model.NowISO()}
	if err := store.UpsertProject(proj); err != nil {
		t.Fatal(err)
	}
	issue := model.Issue{
		ID: "i-hot", ProjectID: "p1", Title: "t", Status: model.StatusInReview,
		AssociatedRepoIDs: []string{"r1"},
		PRInfo: &model.PRInfo{
			ID: "pr-hot", BranchName: "ai-dev/issue-hot", Title: "t", Status: "open",
			BaseBranch: "main", Author: "bot", CreatedAt: model.NowISO(),
			Worktrees: []model.WorktreeRef{{RepoID: "r1", RepoName: "demo", Path: wtPath}},
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"targetBranch": "hotfix_1"})
	req := httptest.NewRequest(http.MethodPost, "/api/issues/i-hot/approve-merge", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve status=%d %s", rr.Code, rr.Body.String())
	}
	var got model.Issue
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.PRInfo == nil || got.PRInfo.BaseBranch != "hotfix_1" {
		t.Fatalf("baseBranch=%v", got.PRInfo)
	}
	out, err := exec.Command("git", "-C", repoDir, "show", "hotfix_1:feat.txt").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "hot") {
		t.Fatalf("hotfix_1:feat.txt %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(repoDir, "feat.txt")); !os.IsNotExist(err) {
		t.Fatal("main working tree should not have received the merge")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/issues/i-hot/branches", nil)
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("branches status=%d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "hotfix_1") {
		t.Fatalf("expected hotfix_1 in branches: %s", rr.Body.String())
	}
}

func TestIssueRebaseRejectedWhenInProgress(t *testing.T) {
	srv, store := testServer(t)
	issue := model.Issue{
		ID: "i-rebase", ProjectID: "p1", Title: "t", Status: model.StatusInProgress,
		PRInfo: &model.PRInfo{
			BranchName: "ai-dev/x", BaseBranch: "main", Status: "open",
			Worktrees: []model.WorktreeRef{{RepoID: "r1", Path: t.TempDir()}},
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/issues/i-rebase/rebase", strings.NewReader("{}"))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestIssuePublishRemoteNoOriginWarns(t *testing.T) {
	srv, store := testServer(t)
	wt := t.TempDir()
	initRepo(t, wt, "main")
	issue := model.Issue{
		ID: "i-pub", ProjectID: "p1", Title: "t", Status: model.StatusInReview,
		PRInfo: &model.PRInfo{
			BranchName: "ai-dev/x", BaseBranch: "main", Status: "open", Title: "t",
			Worktrees: []model.WorktreeRef{{RepoID: "r1", RepoName: "demo", Path: wt}},
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/issues/i-pub/publish-remote", strings.NewReader("{}"))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != false {
		t.Fatalf("%v", resp)
	}
}

func TestIssuePublishRemoteRejectedWhenInProgress(t *testing.T) {
	srv, store := testServer(t)
	issue := model.Issue{
		ID: "i-pub2", Title: "t", Status: model.StatusInProgress,
		PRInfo:    &model.PRInfo{BranchName: "ai-dev/x", Worktrees: []model.WorktreeRef{{Path: t.TempDir()}}},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/issues/i-pub2/publish-remote", strings.NewReader("{}"))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("status=%d %s", rr.Code, rr.Body.String())
	}
}

func TestMultiRepoReviewTargetsStaySeparate(t *testing.T) {
	srv, store := testServer(t)
	git := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	setup := func(extraBranch string) (repoDir, wt string) {
		t.Helper()
		repoDir = t.TempDir()
		initRepo(t, repoDir, "main")
		git(repoDir, "checkout", "-b", extraBranch)
		git(repoDir, "checkout", "main")
		wt = filepath.Join(t.TempDir(), "wt")
		git(repoDir, "worktree", "add", "-b", "ai-dev/multi", wt, "main")
		if err := os.WriteFile(filepath.Join(wt, "feat.txt"), []byte(extraBranch+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		git(wt, "add", ".")
		git(wt, "commit", "-m", "feat")
		return repoDir, wt
	}
	dirA, wtA := setup("release")
	dirB, wtB := setup("develop")
	proj := model.Project{
		ID: "p1", Name: "p", CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
		GitRepos: []model.GitRepo{
			{ID: "ra", Name: "alpha", Path: dirA, DefaultBranch: "main"},
			{ID: "rb", Name: "beta", Path: dirB, DefaultBranch: "main"},
		},
	}
	if err := store.UpsertProject(proj); err != nil {
		t.Fatal(err)
	}
	issue := model.Issue{
		ID: "i-multi", ProjectID: "p1", Title: "t", Status: model.StatusInReview,
		AssociatedRepoIDs: []string{"ra", "rb"},
		PRInfo: &model.PRInfo{
			ID: "pr", BranchName: "ai-dev/multi", Title: "t", Status: "open",
			BaseBranch: "main", Author: "bot", CreatedAt: model.NowISO(),
			Worktrees: []model.WorktreeRef{
				{RepoID: "ra", RepoName: "alpha", Path: wtA},
				{RepoID: "rb", RepoName: "beta", Path: wtB},
			},
		},
		CreatedAt: model.NowISO(), UpdatedAt: model.NowISO(),
	}
	if err := store.UpsertIssue(issue); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/issues/i-multi/branches", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("branches %d %s", rr.Code, rr.Body.String())
	}
	var branches struct {
		Branches []string `json:"branches"`
		Repos    []struct {
			RepoID   string   `json:"repoId"`
			Branches []string `json:"branches"`
			Default  string   `json:"default"`
		} `json:"repos"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &branches); err != nil {
		t.Fatal(err)
	}
	if len(branches.Branches) != 0 {
		t.Fatalf("multi-repo response should not union branches: %+v", branches.Branches)
	}
	if len(branches.Repos) != 2 {
		t.Fatalf("repos=%+v", branches.Repos)
	}
	has := func(list []string, name string) bool {
		for _, n := range list {
			if n == name {
				return true
			}
		}
		return false
	}
	if !has(branches.Repos[0].Branches, "release") || has(branches.Repos[0].Branches, "develop") {
		t.Fatalf("alpha branches=%v", branches.Repos[0].Branches)
	}
	if !has(branches.Repos[1].Branches, "develop") || has(branches.Repos[1].Branches, "release") {
		t.Fatalf("beta branches=%v", branches.Repos[1].Branches)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/issues/i-multi/diff?base=release&repoBase=ra:release&repoBase=rb:develop", nil)
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("diff %d %s", rr.Code, rr.Body.String())
	}
	var diff struct {
		Repos []struct {
			RepoID     string `json:"repoId"`
			BaseBranch string `json:"baseBranch"`
			Error      string `json:"error"`
		} `json:"repos"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &diff); err != nil {
		t.Fatal(err)
	}
	gotBase := map[string]string{}
	for _, r := range diff.Repos {
		if r.Error != "" {
			t.Fatalf("diff %s: %s", r.RepoID, r.Error)
		}
		gotBase[r.RepoID] = r.BaseBranch
	}
	if gotBase["ra"] != "release" || gotBase["rb"] != "develop" {
		t.Fatalf("bases=%v", gotBase)
	}

	bad, _ := json.Marshal(map[string]any{
		"targets": []map[string]string{{"repoId": "ra", "branch": "develop"}, {"repoId": "rb", "branch": "develop"}},
	})
	req = httptest.NewRequest(http.MethodPost, "/api/issues/i-multi/approve-merge", bytes.NewReader(bad))
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 400 || !strings.Contains(rr.Body.String(), "alpha") {
		t.Fatalf("missing branch status=%d %s", rr.Code, rr.Body.String())
	}
	out, err := exec.Command("git", "-C", dirB, "show", "develop:feat.txt").CombinedOutput()
	if err == nil {
		t.Fatalf("beta should not have been merged: %s", out)
	}

	okBody, _ := json.Marshal(map[string]any{
		"targets": []map[string]string{{"repoId": "ra", "branch": "release"}, {"repoId": "rb", "branch": "develop"}},
	})
	req = httptest.NewRequest(http.MethodPost, "/api/issues/i-multi/approve-merge", bytes.NewReader(okBody))
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("approve %d %s", rr.Code, rr.Body.String())
	}
	for _, pair := range []struct{ dir, branch, want string }{
		{dirA, "release", "release"},
		{dirB, "develop", "develop"},
	} {
		out, err := exec.Command("git", "-C", pair.dir, "show", pair.branch+":feat.txt").CombinedOutput()
		if err != nil || !strings.Contains(string(out), pair.want) {
			t.Fatalf("%s %s: %v %s", pair.dir, pair.branch, err, out)
		}
	}
}
