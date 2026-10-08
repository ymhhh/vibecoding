package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/repocontext"
)

func (s *Server) generateDesignWithSource(
	w http.ResponseWriter,
	r *http.Request,
	cfg model.ModelConfig,
	issue *model.Issue,
	proj *model.Project,
	subID string,
	prompt string,
	msgs []llm.ChatMessage,
) {
	if !issue.RequirementAccepted() {
		writeErr(w, 400, "accept the requirement document before generating design")
		return
	}
	repos := s.associatedRepos(issue, proj)
	if len(repos) == 0 {
		writeErr(w, 400, "associate at least one repository before generating design")
		return
	}

	var sub *model.SubRequirement
	if issue.HasSubRequirements() {
		if strings.TrimSpace(subID) == "" {
			writeErr(w, 400, "pick a sub-requirement to design (design is scoped; do not generate all at once)")
			return
		}
		sub = issue.SubByID(subID)
		if sub == nil {
			writeErr(w, 400, "sub-requirement not found")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), llm.RequestTimeout)
	defer cancel()

	var sse *sseWriter
	if wantsStream(r) {
		var err error
		sse, err = newSSE(w)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = sse.event(map[string]any{"type": "status", "message": "indexing"})
	}

	query := reqQueryText(issue, sub)
	if strings.TrimSpace(prompt) != "" {
		query = query + "\n\n" + prompt
	}
	idx, err := repocontext.BuildDesignIndex(repos, query)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}

	pass1System := `You are a Senior VibeCoding AI Architect locating source files to read.
The excerpts below are a local read-only index of associated repositories (directories + candidate paths). You CAN use this local context — do not say you cannot read the repo.

Return ONLY JSON:
- chatReply: optional short note
- wantedFiles: array of up to 12 items {repoName, filePath, hintLine?}
  Only pick paths from the candidate list (or path-like creates under known repos).
  Prefer files that implement the current requirement scope.`

	pass1User := fmt.Sprintf(`Issue: %s
Requirement / scope text:
%s

%s

Pick wantedFiles to read next.`,
		issue.Title, query, repocontext.FormatDesignIndexForPrompt(idx))

	pass1Msgs := append(append([]llm.ChatMessage{}, msgs...), llm.ChatMessage{Role: "user", Content: pass1User})
	pass1Text, err := s.completeLLMJSON(ctx, cfg, pass1System, pass1Msgs, nil)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}
	wantedRefs, _, err := llm.ParseWantedFilesJSON(pass1Text)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}
	wanted := make([]repocontext.WantedFile, 0, len(wantedRefs))
	for _, wref := range wantedRefs {
		wanted = append(wanted, repocontext.WantedFile{
			RepoName: wref.RepoName,
			FilePath: wref.FilePath,
			HintLine: wref.HintLine,
		})
	}
	// If model returned nothing, fall back to top candidates.
	if len(wanted) == 0 && idx != nil {
		for _, ri := range idx.Repos {
			for _, c := range ri.Candidates {
				wanted = append(wanted, repocontext.WantedFile{RepoName: ri.Name, FilePath: c.Path, HintLine: c.HitLine})
				if len(wanted) >= 8 {
					break
				}
			}
			if len(wanted) >= 8 {
				break
			}
		}
	}
	wanted = repocontext.CapWantedFiles(wanted, 12)

	if sse != nil {
		_ = sse.event(map[string]any{
			"type":    "status",
			"message": fmt.Sprintf("reading %d files", len(wanted)),
		})
	}

	excerpts, err := repocontext.ReadDesignExcerpts(repos, wanted, idx)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}

	// Optional second locate round if Pass-1 asked for files we could not read.
	if nFiles(excerpts) == 0 && len(wanted) > 0 {
		if sse != nil {
			_ = sse.event(map[string]any{"type": "status", "message": "retry_locate"})
		}
	}

	if sse != nil {
		_ = sse.event(map[string]any{"type": "status", "message": "writing_spec"})
	}

	scopeLabel := "parent issue"
	prevSpec := ""
	titleFallback := issue.Title
	if sub != nil {
		scopeLabel = fmt.Sprintf("sub-requirement %s (%s)", sub.ID, sub.Title)
		titleFallback = sub.Title
		if sub.DevSpec != nil {
			prevSpec = sub.DevSpec.RawMarkdown
		}
	} else if issue.DevSpec != nil {
		prevSpec = issue.DevSpec.RawMarkdown
	}

	devTemplate := ""
	if proj != nil {
		devTemplate = proj.DevSpecPromptTemplate
	}
	pass2System := llm.DevSpecSystem(devTemplate, scopeLabel)

	pass2User := fmt.Sprintf(`Issue: %s
Scope: %s
Requirement:
%s

Latest user message:
%s

Previous Dev Spec (may be empty):
-----
%s
-----

%s

Write the Dev Spec JSON now.`,
		issue.Title, scopeLabel, query, prompt, prevSpec, repocontext.FormatDesignExcerptsForPrompt(excerpts))

	pass2Msgs := append(append([]llm.ChatMessage{}, msgs...), llm.ChatMessage{Role: "user", Content: pass2User})

	var processBuf strings.Builder
	onDelta := func(delta string) {
		processBuf.WriteString(delta)
		if sse != nil && delta != "" {
			_ = sse.event(map[string]any{"type": "delta", "text": delta})
		}
	}
	pass2Text, err := s.completeLLMJSON(ctx, cfg, pass2System, pass2Msgs, onDelta)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}

	spec, chatReply, err := llm.ParseDevSpecJSON(pass2Text, titleFallback)
	if err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}
	spec.FileChanges = model.VerifyFileChanges(spec.FileChanges, repoRoots(repos))
	spec.UpdatedAt = model.NowISO()

	if sub != nil {
		target := issue.SubByID(subID)
		if target == nil {
			writeErrOrSSE(w, sse, 400, "sub-requirement not found")
			return
		}
		target.DevSpec = spec
		if spec.Title != "" {
			target.Title = spec.Title
		}
		if target.Status != model.SubReqInProgress && target.Status != model.SubReqDone {
			target.Status = model.SubReqReady
		}
	} else {
		issue.DevSpec = spec
	}
	issue.DocPhase = model.DocPhaseDesign
	issue.UpdatedAt = model.NowISO()
	if err := s.Store.UpsertIssue(*issue); err != nil {
		writeErrOrSSE(w, sse, 500, err.Error())
		return
	}
	saved, _ := s.Store.GetIssue(issue.ID)
	if saved != nil {
		issue = saved
	}

	payload := specDonePayload(spec, chatReply, firstNonEmpty(processBuf.String(), pass2Text), issue)
	payload["sourceFilesRead"] = nFiles(excerpts)
	if sse != nil {
		_ = sse.event(payload)
		return
	}
	writeJSON(w, 200, payload)
}

func nFiles(ex *repocontext.DesignExcerpt) int {
	if ex == nil {
		return 0
	}
	n := 0
	for _, r := range ex.Repos {
		n += len(r.Files)
	}
	return n
}

func writeErrOrSSE(w http.ResponseWriter, sse *sseWriter, status int, msg string) {
	if sse != nil {
		_ = sse.event(map[string]any{"type": "error", "error": msg})
		return
	}
	writeErr(w, status, msg)
}
