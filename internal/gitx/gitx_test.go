package gitx

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveBaseBranchEmptyRepo(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	_, err := ResolveBaseBranch(dir, "main")
	if err == nil {
		t.Fatal("expected error for repo with no commits")
	}
}

func TestEnsureInitialCommitEmptyRepo(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")

	base, inited, err := EnsureInitialCommit(dir, "main")
	if err != nil {
		t.Fatal(err)
	}
	if !inited {
		t.Fatal("expected initialized=true")
	}
	if base != "main" {
		t.Fatalf("base=%q", base)
	}
	if !HasCommits(dir) {
		t.Fatal("expected commits after init")
	}

	base2, inited2, err := EnsureInitialCommit(dir, "main")
	if err != nil {
		t.Fatal(err)
	}
	if inited2 {
		t.Fatal("second call should not re-init")
	}
	if base2 != "main" {
		t.Fatalf("base2=%q", base2)
	}
}

func TestCheckoutBranchEmptyRepoAutoInit(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init") // unborn HEAD, often master/main depending on git version

	if err := CheckoutBranch(dir, "main", "ai-dev/issue-empty"); err != nil {
		t.Fatal(err)
	}
	cur, err := CurrentBranch(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cur != "ai-dev/issue-empty" {
		t.Fatalf("current=%q", cur)
	}
	if !HasCommits(dir) {
		t.Fatal("expected initial commit")
	}
}

func TestResolveBaseBranchUsesConfiguredAndFallback(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "develop")
	writeFile(t, filepath.Join(dir, "README.md"), "hi\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init")

	base, err := ResolveBaseBranch(dir, "main")
	if err != nil {
		t.Fatal(err)
	}
	if base != "develop" {
		t.Fatalf("want develop fallback, got %q", base)
	}

	base, err = ResolveBaseBranch(dir, "develop")
	if err != nil {
		t.Fatal(err)
	}
	if base != "develop" {
		t.Fatalf("want configured develop, got %q", base)
	}
}

func TestListLocalBranches(t *testing.T) {
	dir := initRepo(t, "main")
	runGit(t, dir, "checkout", "-b", "hotfix_1")
	names, err := ListLocalBranches(dir)
	if err != nil {
		t.Fatal(err)
	}
	foundMain, foundHot := false, false
	for _, n := range names {
		if n == "main" {
			foundMain = true
		}
		if n == "hotfix_1" {
			foundHot = true
		}
	}
	if !foundMain || !foundHot {
		t.Fatalf("branches=%v", names)
	}
	if SanitizeBranchName("hotfix_1") != "hotfix_1" || SanitizeBranchName("../x") != "" {
		t.Fatal("SanitizeBranchName")
	}
}

func TestCheckoutBranchFromMaster(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "master")
	writeFile(t, filepath.Join(dir, "a.txt"), "a\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init")

	if err := CheckoutBranch(dir, "main", "ai-dev/issue-test"); err != nil {
		t.Fatal(err)
	}
	cur, err := CurrentBranch(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cur != "ai-dev/issue-test" {
		t.Fatalf("current=%q", cur)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func initRepo(t *testing.T, branch string) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", branch)
	runGit(t, dir, "config", "user.email", "t@t")
	runGit(t, dir, "config", "user.name", "t")
	writeFile(t, filepath.Join(dir, "README.md"), "hi\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "init")
	return dir
}

func TestAddWorktreeLeavesMainDirtyAndHEAD(t *testing.T) {
	dir := initRepo(t, "main")
	writeFile(t, filepath.Join(dir, "dirty.txt"), "dirty\n")
	headBefore, err := HeadSHA(dir)
	if err != nil {
		t.Fatal(err)
	}
	branchBefore, err := CurrentBranch(dir)
	if err != nil {
		t.Fatal(err)
	}
	wt := filepath.Join(t.TempDir(), "wt1")
	if err := AddWorktree(dir, wt, "main", "ai-dev/issue-1"); err != nil {
		t.Fatal(err)
	}
	headAfter, _ := HeadSHA(dir)
	branchAfter, _ := CurrentBranch(dir)
	if headAfter != headBefore || branchAfter != branchBefore {
		t.Fatalf("main tree changed: head %s→%s branch %s→%s", headBefore, headAfter, branchBefore, branchAfter)
	}
	dirty, _ := IsDirty(dir)
	if !dirty {
		t.Fatal("expected main tree to stay dirty")
	}
	cur, err := CurrentBranch(wt)
	if err != nil || cur != "ai-dev/issue-1" {
		t.Fatalf("worktree branch=%q err=%v", cur, err)
	}
}

func TestAddWorktreeParallelBranches(t *testing.T) {
	dir := initRepo(t, "main")
	wt1 := filepath.Join(t.TempDir(), "a")
	wt2 := filepath.Join(t.TempDir(), "b")
	if err := AddWorktree(dir, wt1, "main", "ai-dev/one"); err != nil {
		t.Fatal(err)
	}
	if err := AddWorktree(dir, wt2, "main", "ai-dev/two"); err != nil {
		t.Fatal(err)
	}
	b1, _ := CurrentBranch(wt1)
	b2, _ := CurrentBranch(wt2)
	if b1 != "ai-dev/one" || b2 != "ai-dev/two" {
		t.Fatalf("got %q and %q", b1, b2)
	}
}

func TestAddWorktreeReuseSamePath(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "reuse")
	if err := AddWorktree(dir, wt, "main", "ai-dev/rework"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "f.txt"), "x\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "wip")
	if err := AddWorktree(dir, wt, "main", "ai-dev/rework"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(wt, "f.txt")); err != nil {
		t.Fatal("expected reused worktree to keep files")
	}
}

func TestAddWorktreeReplacesLeftoverDirectory(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "stale")
	if err := os.MkdirAll(wt, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "junk.txt"), "leftover\n")
	if err := AddWorktree(dir, wt, "main", "ai-dev/retry"); err != nil {
		t.Fatal(err)
	}
	cur, err := CurrentBranch(wt)
	if err != nil || cur != "ai-dev/retry" {
		t.Fatalf("worktree branch=%q err=%v", cur, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "junk.txt")); !os.IsNotExist(err) {
		t.Fatal("expected leftover files to be replaced")
	}
}

func TestAddWorktreeRecoversDetachedHEAD(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "detach")
	if err := AddWorktree(dir, wt, "main", "ai-dev/detach"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "keep.txt"), "keep\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "keep")
	runGit(t, wt, "checkout", "--detach")
	if err := AddWorktree(dir, wt, "main", "ai-dev/detach"); err != nil {
		t.Fatal(err)
	}
	cur, err := CurrentBranch(wt)
	if err != nil || cur != "ai-dev/detach" {
		t.Fatalf("worktree branch=%q err=%v", cur, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "keep.txt")); err != nil {
		t.Fatal("expected recovered worktree to keep committed files")
	}
}

func TestEnforceFeatureBranchMovesCommitsOffBase(t *testing.T) {
	dir := initRepo(t, "main")
	runGit(t, dir, "checkout", "-b", "wip")
	wt := filepath.Join(t.TempDir(), "wt")
	if err := AddWorktree(dir, wt, "main", "hotfix/issue-x"); err != nil {
		t.Fatal(err)
	}
	baseBefore, err := RefSHA(dir, "refs/heads/main")
	if err != nil {
		t.Fatal(err)
	}

	runGit(t, wt, "checkout", "main")
	writeFile(t, filepath.Join(wt, "fix.txt"), "x\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat: on base")
	runGit(t, wt, "checkout", "-B", "hotfix/issue-x")

	relocated, err := EnforceFeatureBranch(dir, wt, "main", "hotfix/issue-x", baseBefore)
	if err != nil {
		t.Fatal(err)
	}
	if !relocated {
		t.Fatal("expected relocated=true")
	}
	mainNow, _ := RefSHA(dir, "refs/heads/main")
	if mainNow != baseBefore {
		t.Fatalf("main not restored")
	}
	featNow, _ := RefSHA(dir, "refs/heads/hotfix/issue-x")
	if featNow == baseBefore {
		t.Fatal("feature should keep the commit")
	}
	cur, err := CurrentBranch(wt)
	if err != nil || cur != "hotfix/issue-x" {
		t.Fatalf("worktree branch=%q err=%v", cur, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "fix.txt")); err != nil {
		t.Fatal("expected commit files on the feature worktree")
	}
	mainB, _ := CurrentBranch(dir)
	if mainB != "wip" {
		t.Fatalf("main working tree branch=%s", mainB)
	}
}

func TestRemoveWorktree(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "gone")
	if err := AddWorktree(dir, wt, "main", "ai-dev/gone"); err != nil {
		t.Fatal(err)
	}
	if err := RemoveWorktree(dir, wt); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("worktree path still exists: %v", err)
	}
	out, err := run(dir, "worktree", "list", "--porcelain")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, wt) {
		t.Fatalf("worktree list still mentions path:\n%s", out)
	}
	// Missing path should be fine.
	if err := RemoveWorktree(dir, wt); err != nil {
		t.Fatal(err)
	}
}

func TestMergeBranchAtCleanOnBase(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/feat"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "feat.txt"), "feat\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat")
	// Main is on main and clean.
	if err := MergeBranchAt(dir, "main", "ai-dev/feat"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "feat.txt")); err != nil {
		t.Fatal("expected merge result on main")
	}
}

func TestMergeBranchAtDirtyOnBaseRefuses(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/feat2"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "feat.txt"), "feat\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat")
	writeFile(t, filepath.Join(dir, "dirty.txt"), "x\n")
	err := MergeBranchAt(dir, "main", "ai-dev/feat2")
	if err == nil {
		t.Fatal("expected refuse dirty base")
	}
}

func TestMergeBranchAtFromOtherBranch(t *testing.T) {
	dir := initRepo(t, "main")
	runGit(t, dir, "checkout", "-b", "topic")
	writeFile(t, filepath.Join(dir, "topic.txt"), "t\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "topic")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/feat3"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "feat.txt"), "feat\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat")
	curBefore, _ := CurrentBranch(dir)
	if curBefore != "topic" {
		t.Fatalf("want topic, got %s", curBefore)
	}
	if err := MergeBranchAt(dir, "main", "ai-dev/feat3"); err != nil {
		t.Fatal(err)
	}
	curAfter, _ := CurrentBranch(dir)
	if curAfter != "topic" {
		t.Fatalf("main tree branch changed to %s", curAfter)
	}
	// Verify main branch tip has the file via show.
	out, err := run(dir, "show", "main:feat.txt")
	if err != nil || strings.TrimSpace(out) != "feat" {
		t.Fatalf("main branch missing merge: %v %q", err, out)
	}
}

func TestDiffBetween(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/diff"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "new.go"), "package n\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "add new.go")
	stats, files, commits, ahead, behind, err := DiffBetween(dir, "main", "ai-dev/diff")
	if err != nil {
		t.Fatal(err)
	}
	if ahead < 1 || behind != 0 {
		t.Fatalf("ahead=%d behind=%d", ahead, behind)
	}
	if stats.FilesChanged < 1 || len(files) < 1 || len(commits) < 1 {
		t.Fatalf("stats=%+v files=%d commits=%d", stats, len(files), len(commits))
	}
	if !strings.Contains(files[0].Patch, "new.go") && files[0].Path != "new.go" {
		t.Fatalf("unexpected file %+v", files[0])
	}
}

func TestRebaseOntoFastForwardBase(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/rebase"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "feat.txt"), "feat\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat")

	writeFile(t, filepath.Join(dir, "base.txt"), "from main\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "main ahead")

	_, _, _, ahead, behind, err := DiffBetween(dir, "main", "ai-dev/rebase")
	if err != nil {
		t.Fatal(err)
	}
	if behind < 1 || ahead < 1 {
		t.Fatalf("before rebase ahead=%d behind=%d", ahead, behind)
	}
	if err := RebaseOnto(wt, "main"); err != nil {
		t.Fatal(err)
	}
	_, _, _, ahead2, behind2, err := DiffBetween(dir, "main", "ai-dev/rebase")
	if err != nil {
		t.Fatal(err)
	}
	if behind2 != 0 {
		t.Fatalf("after rebase behind=%d ahead=%d", behind2, ahead2)
	}
	if _, err := os.Stat(filepath.Join(wt, "base.txt")); err != nil {
		t.Fatalf("expected base.txt in worktree: %v", err)
	}
}

func TestRebaseOntoConflictLeavesWorktree(t *testing.T) {
	dir := initRepo(t, "main")
	wt := filepath.Join(t.TempDir(), "feat")
	if err := AddWorktree(dir, wt, "main", "ai-dev/conflict"); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "README.md"), "feature line\n")
	runGit(t, wt, "add", ".")
	runGit(t, wt, "commit", "-m", "feat edit")

	writeFile(t, filepath.Join(dir, "README.md"), "main line\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "main edit")

	err := RebaseOnto(wt, "main")
	if err == nil {
		t.Fatal("expected conflict")
	}
	var conflict *RebaseConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("got %T %v", err, err)
	}
	if len(conflict.Files) == 0 {
		t.Fatalf("expected conflict files, got %+v", conflict)
	}
	data, _ := os.ReadFile(filepath.Join(wt, "README.md"))
	if !strings.Contains(string(data), "<<<<<<") && !strings.Contains(string(data), ">>>>>>") && !strings.Contains(string(data), "======") {
		t.Fatalf("expected conflict markers in worktree file: %q", data)
	}
}

func TestPushOriginToBareRemote(t *testing.T) {
	dir := initRepo(t, "main")
	bare := t.TempDir()
	runGit(t, bare, "init", "--bare")
	if HasOrigin(dir) {
		t.Fatal("did not expect origin yet")
	}
	runGit(t, dir, "remote", "add", "origin", bare)
	if !HasOrigin(dir) {
		t.Fatal("expected origin")
	}
	runGit(t, dir, "checkout", "-b", "ai-dev/pub")
	writeFile(t, filepath.Join(dir, "pub.txt"), "ok\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "pub")
	if err := PushOrigin(dir, "ai-dev/pub"); err != nil {
		t.Fatal(err)
	}
	if err := PushOrigin(dir, ""); err == nil {
		t.Fatal("empty branch should fail")
	}
}

func TestCommitAllUsesLocalIdentity(t *testing.T) {
	dir := initRepo(t, "main")
	writeFile(t, filepath.Join(dir, "a.txt"), "a\n")
	if err := CommitAll(dir, "feat: add a\n\nIssue: abcdef12"); err != nil {
		t.Fatal(err)
	}
	if UserName(dir) != "t" {
		t.Fatalf("user.name=%q", UserName(dir))
	}
	log, err := run(dir, "log", "-1", "--pretty=%an <%ae>")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log, "t <t@t>") {
		t.Fatalf("author=%q", log)
	}
	msg, err := run(dir, "log", "-1", "--pretty=%B")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "Issue: abcdef12") {
		t.Fatalf("message=%q", msg)
	}
}

func TestCommitAllFailsWithoutIdentity(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	// Isolate from the developer's global git config.
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	runGit(t, dir, "-c", "user.name=bootstrap", "-c", "user.email=b@b", "commit", "--allow-empty", "-m", "init")
	// Clear local identity if any was inherited; do not set user.*
	_ = exec.Command("git", "-C", dir, "config", "--unset-all", "user.name").Run()
	_ = exec.Command("git", "-C", dir, "config", "--unset-all", "user.email").Run()
	writeFile(t, filepath.Join(dir, "x.txt"), "x\n")
	err := CommitAll(dir, "feat: no identity")
	if err == nil {
		t.Fatal("expected commit to fail without user.email")
	}
	if !strings.Contains(err.Error(), "git commit:") {
		t.Fatalf("err=%v", err)
	}
}

func TestApplyUnifiedDiffCreateModifyDelete(t *testing.T) {
	dir := initRepo(t, "main")
	writeFile(t, filepath.Join(dir, "keep.txt"), "line1\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "base")

	create := "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+created\n"
	if err := ApplyUnifiedDiff(dir, create); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "new.txt"))
	if string(data) != "created\n" {
		t.Fatalf("%q", data)
	}

	modify := "diff --git a/keep.txt b/keep.txt\n--- a/keep.txt\n+++ b/keep.txt\n@@ -1 +1 @@\n-line1\n+line2\n"
	if err := ApplyUnifiedDiff(dir, modify); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(filepath.Join(dir, "keep.txt"))
	if string(data) != "line2\n" {
		t.Fatalf("%q", data)
	}

	del := "diff --git a/new.txt b/new.txt\ndeleted file mode 100644\n--- a/new.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-created\n"
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "stage new")
	if err := ApplyUnifiedDiff(dir, del); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected deleted: %v", err)
	}
}

func TestApplyUnifiedDiffRejectsEscape(t *testing.T) {
	dir := initRepo(t, "main")
	bad := "diff --git a/../evil b/../evil\n--- a/../evil\n+++ b/../evil\n@@ -0,0 +1 @@\n+x\n"
	if err := ApplyUnifiedDiff(dir, bad); err == nil || !strings.Contains(err.Error(), "unsafe") {
		t.Fatalf("err=%v", err)
	}
}

func TestApplyUnifiedDiffBadHunk(t *testing.T) {
	dir := initRepo(t, "main")
	writeFile(t, filepath.Join(dir, "a.txt"), "hello\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "a")
	bad := "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-not-the-content\n+world\n"
	if err := ApplyUnifiedDiff(dir, bad); err == nil {
		t.Fatal("expected apply failure")
	}
}

func TestRecentCommitsLocalOnly(t *testing.T) {
	dir := initRepo(t, "main")
	writeFile(t, filepath.Join(dir, "a.txt"), "one\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "add a")

	list, err := RecentCommits(dir, "alpha", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) < 2 {
		t.Fatalf("commits=%d", len(list))
	}
	if list[0].Subject != "add a" {
		t.Fatalf("newest subject=%q", list[0].Subject)
	}
	if list[0].RepoName != "alpha" || list[0].Branch != "main" {
		t.Fatalf("meta=%+v", list[0])
	}
	if list[0].SHA == "" || list[0].Author == "" || list[0].Time == "" {
		t.Fatalf("incomplete %+v", list[0])
	}

	capped, err := RecentCommits(dir, "alpha", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(capped) != 1 {
		t.Fatalf("limit 1 got %d", len(capped))
	}

	empty := t.TempDir()
	runGit(t, empty, "init", "-b", "main")
	none, err := RecentCommits(empty, "empty", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Fatalf("empty repo commits=%d", len(none))
	}
}
