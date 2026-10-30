package executor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/ymhhh/vibecoding/internal/model"
)

// CommandRunner starts a process; injectable for tests.
type CommandRunner func(ctx context.Context, name string, args []string, dir string, stdin io.Reader) *exec.Cmd

// AgentExecutor runs an external coding CLI inside the worktree.
type AgentExecutor struct {
	Cfg      model.ExecutorConfig
	LookPath func(string) (string, error)
	Runner   CommandRunner
	// PipeGrace bounds how long Run waits for output after the process has
	// exited, in case a descendant inherited the pipe and lingers. Defaults
	// to agentPipeGrace; tests shorten it.
	PipeGrace time.Duration
}

// agentPipeGrace is how long Run keeps reading output after the process exits,
// in case a descendant inherited the output pipe and lingers.
const agentPipeGrace = 10 * time.Second

func NewAgentExecutor(cfg model.ExecutorConfig) *AgentExecutor {
	return &AgentExecutor{Cfg: cfg.Normalize()}
}

func (e *AgentExecutor) Name() string {
	cfg := e.Cfg.Normalize()
	if cfg.Preset != "" {
		return "agent:" + cfg.Preset
	}
	return "agent"
}

func (e *AgentExecutor) Run(ctx context.Context, req CodingRequest, emit Emit) (Result, error) {
	emit = ensureEmit(emit)
	if strings.TrimSpace(req.RepoPath) == "" {
		return Result{}, fmt.Errorf("agent executor: empty RepoPath")
	}
	resolved, err := ResolvePreset(e.Cfg, e.LookPath)
	if err != nil {
		return Result{}, err
	}
	prompt := BuildAgentPrompt(req)
	args, usedPH := ExpandArgs(resolved.Args, prompt, req.Resume)
	useStdin := resolved.PromptStdin || (!usedPH && e.Cfg.PromptStdin)
	if !usedPH && !useStdin {
		// Presets always include {prompt}; custom may rely on stdin only.
		if e.Cfg.Preset == "custom" && e.Cfg.PromptStdin {
			useStdin = true
		} else if !usedPH {
			return Result{}, fmt.Errorf("agent executor: prompt not passed (need {prompt} or promptStdin)")
		}
	}

	timeout := time.Duration(e.Cfg.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 1800 * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var stdin io.Reader
	if useStdin {
		stdin = strings.NewReader(prompt)
	}

	emit("agent", fmt.Sprintf("Starting %s in %s", resolved.DisplayName, req.RepoName), resolved.Command+" "+strings.Join(args, " "))

	cmd := e.startCmd(runCtx, resolved.Command, args, req.RepoPath, stdin)
	// Own the output pipes instead of using StdoutPipe/StderrPipe: Cmd.Wait
	// closes those parent ends as soon as the process exits, which races the
	// scanners below and truncates output they have not read yet.
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		return Result{}, err
	}
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		stdoutR.Close()
		stdoutW.Close()
		return Result{}, err
	}
	cmd.Stdout = stdoutW
	cmd.Stderr = stderrW
	if err := cmd.Start(); err != nil {
		stdoutR.Close()
		stdoutW.Close()
		stderrR.Close()
		stderrW.Close()
		return Result{}, fmt.Errorf("start %s: %w", resolved.Command, err)
	}
	// Drop the parent's write ends so the scanners can observe EOF.
	stdoutW.Close()
	stderrW.Close()

	var stderrBuf bytes.Buffer
	doneOut := make(chan struct{})
	doneErr := make(chan struct{})
	sessionCh := make(chan string, 1)
	go func() {
		defer close(doneOut)
		sessionCh <- scanAgentOutput(stdoutR, emit, resolved.DisplayName)
	}()
	go func() {
		defer close(doneErr)
		sc := bufio.NewScanner(io.TeeReader(stderrR, &stderrBuf))
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if strings.TrimSpace(line) != "" {
				emit("agent", line, "")
			}
		}
	}()

	// Wait for the process and for the scanners to drain. These pipes are
	// ours, so Cmd.Wait does not close them; the scanners see EOF only once
	// every writer — including a descendant that inherited the pipe — is
	// gone. A lingering descendant is bounded by PipeGrace.
	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()
	drained := make(chan struct{})
	go func() {
		<-doneOut
		<-doneErr
		close(drained)
	}()

	grace := e.PipeGrace
	if grace <= 0 {
		grace = agentPipeGrace
	}
	var waitErr error
	select {
	case waitErr = <-waitCh:
		select {
		case <-drained:
		case <-time.After(grace):
			// A descendant still holds the pipes open; keep the output read
			// so far and stop waiting (bounded instead of hanging forever).
			stdoutR.Close()
			stderrR.Close()
			<-drained
			emit("agent", fmt.Sprintf("%s output truncated: a descendant still holds the output pipe after %s", resolved.DisplayName, grace), "")
		}
	case <-drained:
		waitErr = <-waitCh
	}
	stdoutR.Close()
	stderrR.Close()
	sessionID := <-sessionCh

	// Prefer the controlling context over raw "signal: killed" from
	// CommandContext: cancel/timeout both SIGKILL the child, which otherwise
	// looks like an unexplained hard failure and skips JobCancelled handling.
	if err := runCtx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return Result{SessionID: sessionID}, fmt.Errorf("agent %s timed out after %s", resolved.DisplayName, timeout)
		}
		return Result{SessionID: sessionID}, context.Canceled
	}
	if waitErr != nil {
		msg := strings.TrimSpace(stderrBuf.String())
		if msg == "" {
			msg = waitErr.Error()
		}
		if isSignalKilled(waitErr) {
			return Result{SessionID: sessionID}, fmt.Errorf(
				"agent %s was killed (SIGKILL — often OOM, host limit, or external kill): %s",
				resolved.DisplayName, truncate(msg, 2000),
			)
		}
		return Result{SessionID: sessionID}, fmt.Errorf("agent %s failed: %s", resolved.DisplayName, truncate(msg, 2000))
	}
	emit("agent", fmt.Sprintf("%s finished", resolved.DisplayName), "")
	return Result{SessionID: sessionID}, nil
}

func isSignalKilled(err error) bool {
	if err == nil {
		return false
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		if status, ok := ee.Sys().(syscall.WaitStatus); ok {
			return status.Signaled() && status.Signal() == syscall.SIGKILL
		}
	}
	return strings.Contains(err.Error(), "signal: killed")
}

// IsKilled reports whether err (possibly wrapped) is a SIGKILL / host kill of the agent.
func IsKilled(err error) bool {
	if err == nil {
		return false
	}
	if isSignalKilled(err) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "was killed") || strings.Contains(msg, "signal: killed")
}

func (e *AgentExecutor) startCmd(ctx context.Context, name string, args []string, dir string, stdin io.Reader) *exec.Cmd {
	runner := e.Runner
	if runner == nil {
		runner = defaultRunner
	}
	return runner(ctx, name, args, dir, stdin)
}

func defaultRunner(ctx context.Context, name string, args []string, dir string, stdin io.Reader) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = os.Environ() // do not inject app OpenAPI keys
	if stdin != nil {
		cmd.Stdin = stdin
	}
	return cmd
}

func scanAgentOutput(r io.Reader, emit Emit, preset string) string {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	sessionID := ""
	var think strings.Builder
	flushThink := func() {
		if s := strings.TrimSpace(think.String()); s != "" {
			emit("agent", truncate(s, 500), "")
		}
		think.Reset()
	}
	for sc.Scan() {
		line := sc.Text()
		if sid := sessionIDFromJSONLine(line); sid != "" {
			sessionID = sid
		}
		msg, kind, handled := classifyAgentLine(line)
		if handled {
			if kind == "thinking" {
				think.WriteString(msg)
				continue
			}
			flushThink()
			if msg != "" {
				emit("agent", msg, "")
			}
			continue
		}
		flushThink()
		if strings.TrimSpace(line) != "" {
			emit("agent", truncate(line, 500), "")
		}
	}
	flushThink()
	return sessionID
}

func sessionIDFromJSONLine(line string) string {
	line = strings.TrimSpace(line)
	if line == "" || line[0] != '{' {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		return ""
	}
	for _, k := range []string{"session_id", "sessionId"} {
		if s, ok := obj[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// summarizeStreamJSON extracts a short tool/message line from Claude/Cursor stream-json.
func summarizeStreamJSON(line string) string {
	msg, _, handled := classifyAgentLine(line)
	if handled {
		return msg
	}
	return ""
}

// classifyAgentLine parses one CLI stdout line.
// handled=true means it is stream-json (never dump the raw payload).
func classifyAgentLine(line string) (msg, kind string, handled bool) {
	line = strings.TrimSpace(line)
	if line == "" || line[0] != '{' {
		return "", "", false
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		return "", "", false
	}
	t, _ := obj["type"].(string)
	switch t {
	case "user", "system":
		return "", t, true
	case "thinking", "thinking_delta":
		return extractText(obj), "thinking", true
	case "assistant", "result":
		if s := extractText(obj); s != "" {
			return truncate(s, 400), t, true
		}
		return "", t, true
	case "tool_use", "tool_call", "tool_result":
		name, _ := obj["name"].(string)
		if name == "" {
			if tool, ok := obj["tool"].(map[string]any); ok {
				name, _ = tool["name"].(string)
			}
		}
		if name != "" {
			return "tool: " + name, "tool", true
		}
		return "", "tool", true
	}
	if t != "" {
		if s := extractText(obj); s != "" {
			return truncate(s, 400), t, true
		}
		return "", t, true
	}
	return "", "", false
}

func extractText(obj map[string]any) string {
	if s, ok := obj["text"].(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	if s, ok := obj["message"].(string); ok && s != "" {
		return s
	}
	if s, ok := obj["result"].(string); ok && s != "" {
		return s
	}
	if content, ok := obj["message"].(map[string]any); ok {
		if s := contentString(content["content"]); s != "" {
			return s
		}
		if s, ok := content["text"].(string); ok && s != "" {
			return s
		}
	}
	return contentString(obj["content"])
}

func contentString(v any) string {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		var b strings.Builder
		for _, item := range c {
			switch it := item.(type) {
			case string:
				b.WriteString(it)
			case map[string]any:
				if s, _ := it["text"].(string); s != "" {
					b.WriteString(s)
				}
			}
		}
		return b.String()
	default:
		return ""
	}
}

func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
