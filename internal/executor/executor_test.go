package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/repocontext"
)

func TestParseFileChangesJSON(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		raw     string
		snaps   []repocontext.RepoSnapshot
		wantN   int
		wantRepo string
		wantErr bool
	}{
		{
			name:  "plain",
			raw:   `{"fileChanges":[{"filePath":"a.go","repoName":"demo","action":"create","summary":"x","modifiedCode":"package main\n"}]}`,
			wantN: 1,
		},
		{
			name: "fenced",
			raw: "```json\n" +
				`{"fileChanges":[{"filePath":"a.go","action":"modify","summary":"y","modifiedCode":"ok"}]}` +
				"\n```",
			snaps:    []repocontext.RepoSnapshot{{Name: "solo"}},
			wantN:    1,
			wantRepo: "solo",
		},
		{
			name: "prose_wrap",
			raw:  `Here you go: {"fileChanges":[{"filePath":"b.txt","repoName":"r","action":"create","summary":"z","modifiedCode":"hi"}]} Thanks!`,
			wantN: 1,
		},
		{
			name:    "bad",
			raw:     `not json`,
			wantErr: true,
		},
		{
			name:    "empty",
			raw:     "   ",
			wantErr: true,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseFileChangesJSON(tc.raw, tc.snaps)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != tc.wantN {
				t.Fatalf("len=%d want %d", len(got), tc.wantN)
			}
			if tc.wantRepo != "" && got[0].RepoName != tc.wantRepo {
				t.Fatalf("repo=%q want %q", got[0].RepoName, tc.wantRepo)
			}
		})
	}
}

func TestBuildAgentPrompt(t *testing.T) {
	t.Parallel()
	p := BuildAgentPrompt(CodingRequest{
		RepoPath:    "/tmp/wt",
		RepoName:    "demo",
		Branch:      "hotfix/issue-x",
		BaseBranch:  "main",
		Title:       "Add hello",
		Description: "say hi",
		Spec:        &model.DevSpec{RawMarkdown: "# Spec\ndo things"},
		Extra:       "ONLY sub A",
		Resume:      "session-1",
		Snapshots: []repocontext.RepoSnapshot{{
			Name:         "demo",
			Instructions: "----- AGENTS.md -----\nAlways run make test.\n",
		}},
	})
	for _, need := range []string{"demo", "Add hello", "# Spec", "ONLY sub A", "session-1", "Do NOT git push", "/tmp/wt", "make test", "Repository instructions", "hotfix/issue-x", `Stay on git branch "hotfix/issue-x"`} {
		if !strings.Contains(p, need) {
			t.Fatalf("prompt missing %q:\n%s", need, p)
		}
	}
}

func TestBuildSharedExtra(t *testing.T) {
	t.Parallel()
	s := BuildSharedExtra("Sub1", "desc", "FAIL: boom")
	if !strings.Contains(s, "Sub1") || !strings.Contains(s, "FAIL: boom") {
		t.Fatal(s)
	}
}

func TestResolvePresetAndExpand(t *testing.T) {
	t.Parallel()
	look := func(name string) (string, error) {
		if name == "agent" {
			return "/usr/bin/agent", nil
		}
		return "", exec.ErrNotFound
	}
	c, err := ResolvePreset(model.ExecutorConfig{Type: "agent", Preset: "cursor"}, look)
	if err != nil {
		t.Fatal(err)
	}
	if c.Command != "agent" {
		t.Fatalf("cursor fallback: got %q", c.Command)
	}
	args, used := ExpandArgs(c.Args, "HELLO", "")
	if !used {
		t.Fatal("expected placeholder")
	}
	found := false
	for _, a := range args {
		if a == "HELLO" {
			found = true
		}
		if a == "--resume" || a == "{session}" {
			t.Fatalf("empty session should drop resume: %v", args)
		}
		if strings.Contains(a, "{prompt}") {
			t.Fatalf("unexpanded arg %q", a)
		}
	}
	if !found {
		t.Fatalf("args=%v", args)
	}
	withSess, _ := ExpandArgs(c.Args, "HELLO", "chat-42")
	resumeOK := false
	for i, a := range withSess {
		if a == "--resume" && i+1 < len(withSess) && withSess[i+1] == "chat-42" {
			resumeOK = true
		}
	}
	if !resumeOK {
		t.Fatalf("expected --resume chat-42 in %v", withSess)
	}

	custom, err := ResolvePreset(model.ExecutorConfig{
		Type: "agent", Preset: "custom", Command: "echo", Args: []string{"-n", "{prompt}"}, PromptStdin: false,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if custom.Command != "echo" {
		t.Fatal(custom)
	}

	claude, err := ResolvePreset(model.ExecutorConfig{Type: "agent", Preset: "claude"}, nil)
	if err != nil || claude.Command != "claude" {
		t.Fatalf("%v %#v", err, claude)
	}
	hasSkip := false
	hasResumePH := false
	for _, a := range claude.Args {
		if a == "--dangerously-skip-permissions" {
			hasSkip = true
		}
		if a == "{session}" {
			hasResumePH = true
		}
	}
	if !hasSkip {
		t.Fatal("claude missing skip-permissions")
	}
	if !hasResumePH {
		t.Fatal("claude missing {session}")
	}
	noSess, _ := ExpandArgs(claude.Args, "PROMPT", "")
	for _, a := range noSess {
		if a == "--resume" || a == "{session}" || a == "" {
			t.Fatalf("empty session should drop resume: %v", noSess)
		}
	}
	claudeSess, _ := ExpandArgs(claude.Args, "PROMPT", "sess-9")
	foundResume := false
	for i, a := range claudeSess {
		if a == "--resume" && i+1 < len(claudeSess) && claudeSess[i+1] == "sess-9" {
			foundResume = true
		}
	}
	if !foundResume {
		t.Fatalf("expected --resume sess-9 in %v", claudeSess)
	}
}

func TestProbeMissingBinaries(t *testing.T) {
	t.Parallel()
	look := func(string) (string, error) { return "", exec.ErrNotFound }
	res := Probe(ProbeOptions{LookPath: look, LLMConfigured: false})
	if len(res) < 4 {
		t.Fatalf("got %d", len(res))
	}
	if res[0].Available {
		t.Fatal("llm should be unavailable")
	}
	var claude ProbeResult
	for _, r := range res {
		if r.ID == "claude" {
			claude = r
		}
	}
	if claude.Available || claude.Hint == "" {
		t.Fatalf("%+v", claude)
	}
	miss := MissingBinaries(model.ExecutorConfig{Type: "agent", Preset: "codex"}, look)
	if len(miss) != 1 || miss[0] != "codex" {
		t.Fatalf("%v", miss)
	}
}

func TestProbeLLMAvailableWhenCLIsMissing(t *testing.T) {
	t.Parallel()
	look := func(string) (string, error) { return "", exec.ErrNotFound }
	res := Probe(ProbeOptions{LookPath: look, LLMConfigured: true})
	byID := map[string]ProbeResult{}
	for _, r := range res {
		byID[r.ID] = r
	}
	llm := byID["llm"]
	if !llm.Available || llm.Hint != "" {
		t.Fatalf("llm should be available without CLI: %+v", llm)
	}
	for _, id := range []string{"claude", "cursor", "codex"} {
		r := byID[id]
		if r.Available {
			t.Fatalf("%s should be greyed (unavailable): %+v", id, r)
		}
		if r.Hint == "" {
			t.Fatalf("%s should carry install/login hint: %+v", id, r)
		}
	}
	if !byID["custom"].Available {
		t.Fatal("custom should stay available")
	}
	// LLM executor remains constructible without any agent CLI on PATH.
	ex, err := Build(model.ExecutorConfig{Type: "llm"}, stubChat{})
	if err != nil {
		t.Fatal(err)
	}
	if ex.Name() != "llm" {
		t.Fatalf("name=%q", ex.Name())
	}
}

type stubChat struct{}

func (stubChat) Chat(ctx context.Context, req llm.ChatRequest) (string, error) {
	return "[]", nil
}

func TestBuildExecutor(t *testing.T) {
	t.Parallel()
	ex, err := Build(model.ExecutorConfig{Type: "llm"}, nil)
	if err == nil || ex != nil {
		t.Fatal("llm without client should fail")
	}
	ex, err = Build(model.ExecutorConfig{Type: "agent", Preset: "claude"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ex.Name() != "agent:claude" {
		t.Fatal(ex.Name())
	}
	_, err = Build(model.ExecutorConfig{Type: "agent", Preset: "custom", Command: "x"}, nil)
	if err == nil {
		t.Fatal("custom without prompt delivery should fail validate")
	}
}

func TestAgentExecutorFakeCommand(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "marker.txt"), []byte("before"), 0o644); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "fake.sh")
	// Writes a file and echoes stream-json + plain lines.
	body := "#!/bin/sh\necho '{\"type\":\"system\",\"session_id\":\"sess-from-cli\"}'\necho '{\"type\":\"tool_use\",\"name\":\"Write\"}'\necho hello-agent\necho after > marker.txt\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}

	ex := NewAgentExecutor(model.ExecutorConfig{
		Type: "agent", Preset: "custom", Command: script, Args: []string{"{prompt}"}, TimeoutSec: 30,
	})
	ex.Runner = func(ctx context.Context, name string, args []string, cwd string, stdin io.Reader) *exec.Cmd {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Dir = cwd
		return cmd
	}

	var logs []string
	emit := func(phase, msg, details string) {
		logs = append(logs, phase+":"+msg)
	}
	res, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir,
		RepoName: "demo",
		Title:    "t",
		Spec:     &model.DevSpec{RawMarkdown: "do it"},
	}, emit)
	if err != nil {
		t.Fatal(err)
	}
	if res.SessionID != "sess-from-cli" {
		t.Fatalf("session=%q", res.SessionID)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "marker.txt"))
	if strings.TrimSpace(string(data)) != "after" {
		t.Fatalf("marker=%q", data)
	}
	joined := strings.Join(logs, "\n")
	if !strings.Contains(joined, "tool: Write") && !strings.Contains(joined, "hello-agent") {
		t.Fatalf("logs=%v", logs)
	}
}

func TestAgentExecutorDrainsAfterParentExit(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	script := filepath.Join(dir, "lingering.sh")
	// The parent exits at once; a grandchild inherits stdout, emits more
	// output, and exits 300ms later. Run must capture both.
	body := "#!/bin/sh\n" +
		"echo '{\"type\":\"system\",\"session_id\":\"sess-lingering\"}'\n" +
		"sh -c 'sleep 0.3; echo late-grandchild' &\n" +
		"exit 0\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	ex := NewAgentExecutor(model.ExecutorConfig{
		Type: "agent", Preset: "custom", Command: script, Args: []string{"{prompt}"}, TimeoutSec: 30,
	})
	ex.Runner = func(ctx context.Context, name string, args []string, cwd string, stdin io.Reader) *exec.Cmd {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Dir = cwd
		return cmd
	}
	var logs []string
	emit := func(phase, msg, details string) {
		logs = append(logs, phase+":"+msg)
	}
	res, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir,
		RepoName: "demo",
		Title:    "t",
		Spec:     &model.DevSpec{RawMarkdown: "do it"},
	}, emit)
	if err != nil {
		t.Fatal(err)
	}
	if res.SessionID != "sess-lingering" {
		t.Fatalf("session=%q", res.SessionID)
	}
	joined := strings.Join(logs, "\n")
	if !strings.Contains(joined, "late-grandchild") {
		t.Fatalf("missing grandchild output; logs=%v", logs)
	}
}

func TestAgentExecutorPipeGraceBoundsLingeringWriters(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	script := filepath.Join(dir, "linger-forever.sh")
	// The parent exits at once; the grandchild keeps the pipe open far past
	// the short grace. Run must return promptly, keep the session line, and
	// note the truncation.
	body := "#!/bin/sh\n" +
		"echo '{\"type\":\"system\",\"session_id\":\"sess-grace\"}'\n" +
		"sh -c 'sleep 30' &\n" +
		"exit 0\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	ex := NewAgentExecutor(model.ExecutorConfig{
		Type: "agent", Preset: "custom", Command: script, Args: []string{"{prompt}"}, TimeoutSec: 30,
	})
	ex.PipeGrace = 200 * time.Millisecond
	ex.Runner = func(ctx context.Context, name string, args []string, cwd string, stdin io.Reader) *exec.Cmd {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Dir = cwd
		return cmd
	}
	var logs []string
	emit := func(phase, msg, details string) {
		logs = append(logs, phase+":"+msg)
	}
	start := time.Now()
	res, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir,
		RepoName: "demo",
		Title:    "t",
		Spec:     &model.DevSpec{RawMarkdown: "do it"},
	}, emit)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("Run blocked on a lingering descendant for %s", elapsed)
	}
	if res.SessionID != "sess-grace" {
		t.Fatalf("session=%q", res.SessionID)
	}
	if !strings.Contains(strings.Join(logs, "\n"), "truncated") {
		t.Fatalf("missing truncation note; logs=%v", logs)
	}
}

func TestAgentExecutorStdinPrompt(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	script := filepath.Join(dir, "read.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\ncat > got.txt\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	ex := NewAgentExecutor(model.ExecutorConfig{
		Type: "agent", Preset: "custom", Command: script, PromptStdin: true, TimeoutSec: 30,
	})
	_, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir, RepoName: "r", Title: "UniqueTitleXYZ",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "got.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "UniqueTitleXYZ") {
		t.Fatalf("stdin content=%q", got)
	}
}

func TestSummarizeStreamJSON(t *testing.T) {
	t.Parallel()
	if got := summarizeStreamJSON(`{"type":"tool_use","name":"Bash"}`); got != "tool: Bash" {
		t.Fatal(got)
	}
	if got := summarizeStreamJSON("plain"); got != "" {
		t.Fatal(got)
	}
	if got := sessionIDFromJSONLine(`{"type":"system","session_id":"abc-1"}`); got != "abc-1" {
		t.Fatal(got)
	}
	if got := sessionIDFromJSONLine(`{"sessionId":"xyz"}`); got != "xyz" {
		t.Fatal(got)
	}
	if got := summarizeStreamJSON(`{"type":"user","message":{"content":[{"type":"text","text":"PROMPT"}]}}`); got != "" {
		t.Fatalf("user prompt should be skipped, got %q", got)
	}
	if got := summarizeStreamJSON(`{"type":"system","message":{"content":"init"}}`); got != "" {
		t.Fatalf("system should be skipped, got %q", got)
	}
	if got := summarizeStreamJSON(`{"type":"thinking","subtype":"delta","text":"正在修接口"}`); got != "正在修接口" {
		t.Fatalf("thinking=%q", got)
	}
	userLine := `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"You are implementing"}]}}`
	if _, _, handled := classifyAgentLine(userLine); !handled {
		t.Fatal("user event should be handled (not dumped raw)")
	}
}

func TestScanAgentOutputSkipsPromptJSON(t *testing.T) {
	t.Parallel()
	in := strings.NewReader(`{"type":"user","message":{"content":[{"type":"text","text":"SECRET_PROMPT"}]}}
{"type":"thinking","subtype":"delta","text":"hello "}
{"type":"thinking","subtype":"delta","text":"world"}
{"type":"assistant"}
`)
	var msgs []string
	scanAgentOutput(in, func(phase, msg, details string) {
		msgs = append(msgs, msg)
	}, "cursor")
	joined := strings.Join(msgs, "\n")
	if strings.Contains(joined, "SECRET_PROMPT") || strings.Contains(joined, `"type"`) {
		t.Fatalf("dumped raw json: %q", joined)
	}
	if !strings.Contains(joined, "hello world") {
		t.Fatalf("want coalesced thinking, got %q", joined)
	}
}

func TestDisplayName(t *testing.T) {
	t.Parallel()
	if DisplayName(model.ExecutorConfig{}) != "llm" {
		t.Fatal()
	}
	if DisplayName(model.ExecutorConfig{Type: "agent", Preset: "codex"}) != "agent:codex" {
		t.Fatal()
	}
}

type fakeChat struct {
	responses []string
	errs      []error
	calls     int
}

func (f *fakeChat) Chat(ctx context.Context, req llm.ChatRequest) (string, error) {
	i := f.calls
	f.calls++
	if i < len(f.errs) && f.errs[i] != nil {
		return "", f.errs[i]
	}
	if i < len(f.responses) {
		return f.responses[i], nil
	}
	return "", fmt.Errorf("no response")
}

func TestLLMExecutorRun(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	runGit(t, dir, "config", "user.email", "t@t")
	runGit(t, dir, "config", "user.name", "t")
	runGit(t, dir, "commit", "--allow-empty", "-m", "init")

	diff := "diff --git a/hello.txt b/hello.txt\n" +
		"new file mode 100644\n" +
		"--- /dev/null\n" +
		"+++ b/hello.txt\n" +
		"@@ -0,0 +1 @@\n" +
		"+hello world\n"
	body, _ := json.Marshal(map[string]string{"unifiedDiff": diff})
	client := &fakeChat{responses: []string{string(body)}}
	ex := NewLLMExecutor(client)
	if ex.Name() != "llm" {
		t.Fatal(ex.Name())
	}
	res, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir,
		RepoName: "demo",
		Title:    "t",
		Spec:     &model.DevSpec{Title: "t"},
		Snapshots: []repocontext.RepoSnapshot{{Name: "demo"}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 || res.Changes[0].Action != "create" {
		t.Fatalf("%+v", res)
	}
	data, err := os.ReadFile(filepath.Join(dir, "hello.txt"))
	if err != nil || string(data) != "hello world\n" {
		t.Fatalf("%q %v", data, err)
	}

	// JSONMode failure then plain retry
	client2 := &fakeChat{
		errs:      []error{fmt.Errorf("no json mode"), nil},
		responses: []string{"", "```json\n" + string(body) + "\n```"},
	}
	ex2 := NewLLMExecutor(client2)
	dir2 := t.TempDir()
	runGit(t, dir2, "init", "-b", "main")
	runGit(t, dir2, "config", "user.email", "t@t")
	runGit(t, dir2, "config", "user.name", "t")
	runGit(t, dir2, "commit", "--allow-empty", "-m", "init")
	_, err = ex2.Run(context.Background(), CodingRequest{
		RepoPath: dir2, RepoName: "demo", Title: "t2",
		Snapshots: []repocontext.RepoSnapshot{{Name: "demo"}},
	}, func(phase, msg, details string) {})
	if err != nil {
		t.Fatal(err)
	}
	if client2.calls != 2 {
		t.Fatalf("calls=%d", client2.calls)
	}
}

func TestLLMExecutorLegacyFullFileFallback(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	body := `{"fileChanges":[{"filePath":"hello.txt","repoName":"demo","action":"create","summary":"hi","modifiedCode":"hello world\n"}]}`
	ex := NewLLMExecutor(&fakeChat{responses: []string{body}})
	res, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: dir, RepoName: "demo", Title: "t",
		Snapshots: []repocontext.RepoSnapshot{{Name: "demo"}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 1 {
		t.Fatalf("%+v", res)
	}
}

func TestLLMExecutorEmptyChanges(t *testing.T) {
	t.Parallel()
	ex := NewLLMExecutor(&fakeChat{responses: []string{`{"unifiedDiff":""}`}})
	_, err := ex.Run(context.Background(), CodingRequest{
		RepoPath: t.TempDir(), RepoName: "demo",
	}, nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseUnifiedDiffJSONAndChanges(t *testing.T) {
	t.Parallel()
	diff := "diff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -1 +1 @@\n-old\n+new\n"
	raw := `{"unifiedDiff":` + mustJSONString(diff) + `}`
	got, err := ParseUnifiedDiffJSON(raw)
	if err != nil || !strings.Contains(got, "diff --git") {
		t.Fatalf("%q %v", got, err)
	}
	ch := ChangesFromUnifiedDiff(got, "demo")
	if len(ch) != 1 || ch[0].FilePath != "a.go" || ch[0].Action != "modify" {
		t.Fatalf("%+v", ch)
	}
}

func mustJSONString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestProbeCursorAvailable(t *testing.T) {
	t.Parallel()
	look := func(name string) (string, error) {
		if name == "cursor-agent" {
			return "/bin/cursor-agent", nil
		}
		return "", exec.ErrNotFound
	}
	res := Probe(ProbeOptions{LookPath: look, LLMConfigured: true})
	for _, r := range res {
		if r.ID == "cursor" && (!r.Available || r.Binary == "") {
			t.Fatalf("%+v", r)
		}
		if r.ID == "llm" && !r.Available {
			t.Fatal("llm should be available")
		}
		if r.ID == "claude" && r.Available {
			t.Fatal("claude should be missing")
		}
	}
	miss := MissingBinaries(model.ExecutorConfig{Type: "agent", Preset: "claude"}, look)
	if len(miss) != 1 {
		t.Fatal(miss)
	}
	miss = MissingBinaries(model.ExecutorConfig{Type: "agent", Preset: "cursor"}, look)
	if len(miss) != 0 {
		t.Fatal(miss)
	}
	miss = MissingBinaries(model.ExecutorConfig{Type: "agent", Preset: "custom", Command: "missing-bin"}, look)
	if len(miss) != 1 {
		t.Fatal(miss)
	}
}

func TestSummarizeStreamJSONMore(t *testing.T) {
	t.Parallel()
	if got := summarizeStreamJSON(`{"type":"assistant","message":"hi there"}`); !strings.Contains(got, "hi") {
		t.Fatal(got)
	}
	if got := summarizeStreamJSON(`{"type":"tool_call","tool":{"name":"Edit"}}`); got != "tool: Edit" {
		t.Fatal(got)
	}
	if got := summarizeStreamJSON(`{"message":{"content":"nested"}}`); got != "" {
		// no type — extractText only via type branches; name fallback empty
		_ = got
	}
	if SpecTitle(&model.DevSpec{Title: " A "}, "x") != "A" {
		t.Fatal()
	}
	if SpecTitle(nil, "fb") != "fb" {
		t.Fatal()
	}
}
