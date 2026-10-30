package executor

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/ymhhh/vibecoding/internal/model"
)

const promptPlaceholder = "{prompt}"
const sessionPlaceholder = "{session}"

// ResolvedCmd is the concrete CLI invocation for an agent preset.
type ResolvedCmd struct {
	Command     string
	Args        []string
	PromptStdin bool
	DisplayName string
}

// ResolvePreset expands built-in or custom agent command templates.
// lookPath defaults to exec.LookPath when nil (injectable for tests).
func ResolvePreset(cfg model.ExecutorConfig, lookPath func(string) (string, error)) (ResolvedCmd, error) {
	cfg = cfg.Normalize()
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	switch cfg.Preset {
	case "claude":
		return ResolvedCmd{
			Command:     "claude",
			Args:        []string{"-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--resume", sessionPlaceholder, promptPlaceholder},
			DisplayName: "claude",
		}, nil
	case "cursor":
		bin := "cursor-agent"
		if _, err := lookPath(bin); err != nil {
			if _, err2 := lookPath("agent"); err2 == nil {
				bin = "agent"
			}
		}
		// --resume {session} matches Claude so heal / re-run Auto-Dev can continue
		// the prior Cursor chat after signal:killed or a failed test round.
		return ResolvedCmd{
			Command: bin,
			Args: []string{
				"--print", "--output-format", "stream-json", "--force",
				"--resume", sessionPlaceholder, promptPlaceholder,
			},
			DisplayName: "cursor",
		}, nil
	case "codex":
		return ResolvedCmd{
			Command:     "codex",
			Args:        []string{"exec", promptPlaceholder},
			DisplayName: "codex",
		}, nil
	case "custom":
		if strings.TrimSpace(cfg.Command) == "" {
			return ResolvedCmd{}, fmt.Errorf("custom preset requires command")
		}
		return ResolvedCmd{
			Command:     cfg.Command,
			Args:        append([]string(nil), cfg.Args...),
			PromptStdin: cfg.PromptStdin,
			DisplayName: "custom",
		}, nil
	default:
		return ResolvedCmd{}, fmt.Errorf("unknown preset %q", cfg.Preset)
	}
}

// ExpandArgs replaces {prompt} / {session} tokens.
// Empty {session} drops the placeholder and a preceding --resume / --session-id flag.
func ExpandArgs(args []string, prompt, session string) (expanded []string, usedPlaceholder bool) {
	expanded = make([]string, 0, len(args))
	session = strings.TrimSpace(session)
	for _, a := range args {
		if a == sessionPlaceholder || strings.TrimSpace(a) == sessionPlaceholder {
			if session == "" {
				expanded = dropTrailingSessionFlag(expanded)
				continue
			}
			expanded = append(expanded, session)
			continue
		}
		if strings.Contains(a, sessionPlaceholder) {
			if session == "" {
				replaced := strings.ReplaceAll(a, sessionPlaceholder, "")
				if strings.TrimSpace(replaced) == "" {
					expanded = dropTrailingSessionFlag(expanded)
					continue
				}
				a = replaced
			} else {
				a = strings.ReplaceAll(a, sessionPlaceholder, session)
			}
		}
		if strings.Contains(a, promptPlaceholder) {
			usedPlaceholder = true
			expanded = append(expanded, strings.ReplaceAll(a, promptPlaceholder, prompt))
			continue
		}
		expanded = append(expanded, a)
	}
	return expanded, usedPlaceholder
}

func dropTrailingSessionFlag(args []string) []string {
	if n := len(args); n > 0 {
		switch args[n-1] {
		case "--resume", "--session-id", "-r":
			return args[:n-1]
		}
	}
	return args
}
