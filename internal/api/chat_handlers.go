package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Server) handleValidateRepo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Path) == "" {
		writeErr(w, 400, "path required")
		return
	}
	info, err := gitx.ValidateRepo(body.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, info)
}

func (s *Server) resolveModel(projectID string) (model.ModelConfig, error) {
	cfg, err := s.Store.GetModelConfig()
	if err != nil {
		return cfg, err
	}
	if projectID == "" {
		return cfg, nil
	}
	p, err := s.Store.GetProject(projectID)
	if err != nil || p == nil {
		return cfg, nil
	}
	if p.UseCustomModelConfig && p.CustomModelConfig != nil && strings.TrimSpace(p.CustomModelConfig.OpenAIAPIKey) != "" {
		return *p.CustomModelConfig, nil
	}
	return cfg, nil
}

type chatBody struct {
	Prompt           string              `json:"prompt"`
	Messages         []model.ChatMessage `json:"messages"`
	IssueTitle       string              `json:"issueTitle"`
	IssueDescription string              `json:"issueDescription"`
	AssociatedRepos  []repoRef           `json:"associatedRepos"`
	GenerateSpec     bool                `json:"generateSpec"`
	ProjectID        string              `json:"projectId"`
	IssueID          string              `json:"issueId"`
	ResumePartial    string              `json:"resumePartial,omitempty"`
	FreshStart       bool                `json:"freshStart,omitempty"`
	Resume           bool                `json:"resume,omitempty"`
}

type repoRef struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	DefaultBranch string `json:"defaultBranch"`
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	var body chatBody
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	cfg, err := s.resolveModel(body.ProjectID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	repos := s.resolveChatRepos(body.ProjectID, body.IssueID, body.AssociatedRepos)
	query := chatQueryText(body.IssueTitle, body.IssueDescription, body.Prompt, body.Messages)

	systemBase := `You are a Senior VibeCoding AI Architect & Staff Software Engineer.
Assist with requirements analysis and clarifying questions.
When SOURCE EXCERPTS or a repository index are included in the user message, treat them as real local reads from associated repositories on this machine. Cite concrete paths/symbols from that material. Do NOT claim you cannot read the repo or that you have "no source snippets" when excerpts/index are present.
If excerpts are empty but an index of candidate paths is present, use the candidate list and ask for a specific path only when needed.
When the user is brainstorming without asking to extract a document, reply in natural language — do not rewrite Dev Specs unless they explicitly ask.

Issue Context:
- Title: ` + body.IssueTitle + `
- Description: ` + body.IssueDescription + `
- Associated Local Repositories: ` + formatRepoList(repos)

	if body.GenerateSpec {
		systemBase += `

When asked to create/update a Dev Spec, respond with helpful analysis in markdown.
Prefer structured sections: Summary, Architecture, Target Files, Implementation Steps, Test Cases.`
	}

	buildMsgs := func(excerptBlock string) []llm.ChatMessage {
		msgs := make([]llm.ChatMessage, 0, len(body.Messages)+2)
		for _, m := range body.Messages {
			role := "assistant"
			if m.Sender == "user" {
				role = "user"
			} else if m.Sender == "system" {
				role = "system"
			}
			msgs = append(msgs, llm.ChatMessage{Role: role, Content: m.Text})
		}
		prompt := strings.TrimSpace(body.Prompt)
		if prompt != "" && (body.Resume || body.FreshStart || strings.TrimSpace(body.ResumePartial) != "") {
			prompt = llm.ApplyResumeHint(body.Prompt, body.ResumePartial, body.FreshStart)
		}
		if prompt != "" && excerptBlock != "" {
			msgs = append(msgs, llm.ChatMessage{Role: "user", Content: prompt + "\n\n" + excerptBlock})
		} else if prompt != "" {
			msgs = append(msgs, llm.ChatMessage{Role: "user", Content: prompt})
		} else if excerptBlock != "" {
			msgs = append(msgs, llm.ChatMessage{Role: "user", Content: excerptBlock})
		}
		return msgs
	}

	if wantsStream(r) {
		sse, err := newSSE(w)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		var excerptBlock string
		var sourceFiles int
		if len(repos) > 0 {
			_ = sse.event(map[string]any{"type": "status", "message": "indexing"})
			excerptBlock, sourceFiles, err = loadRepoExcerptsForQuery(repos, query)
			if err != nil {
				_ = sse.event(map[string]any{"type": "error", "error": "scan associated repos: " + err.Error()})
				return
			}
			_ = sse.event(map[string]any{
				"type":    "status",
				"message": fmt.Sprintf("reading %d files", sourceFiles),
			})
		}
		chatReq := llm.ChatRequest{
			ModelConfig: cfg,
			System:      systemBase,
			Messages:    buildMsgs(excerptBlock),
			Temperature: cfg.Temperature,
		}
		ctx, cancel := context.WithTimeout(r.Context(), llm.RequestTimeout)
		defer cancel()
		_ = sse.event(map[string]any{"type": "status", "message": "calling_model"})
		text, err := s.LLM.ChatStream(ctx, chatReq, func(delta string) {
			_ = sse.event(map[string]any{"type": "delta", "text": delta})
		})
		if err != nil {
			_ = sse.event(map[string]any{"type": "error", "error": err.Error()})
			return
		}
		_ = sse.event(map[string]any{"type": "done", "text": text, "sourceFilesRead": sourceFiles})
		return
	}

	var excerptBlock string
	var sourceFiles int
	if len(repos) > 0 {
		excerptBlock, sourceFiles, err = loadRepoExcerptsForQuery(repos, query)
		if err != nil {
			writeErr(w, 500, "scan associated repos: "+err.Error())
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), llm.RequestTimeout)
	defer cancel()
	text, err := s.LLM.Chat(ctx, llm.ChatRequest{
		ModelConfig: cfg,
		System:      systemBase,
		Messages:    buildMsgs(excerptBlock),
		Temperature: cfg.Temperature,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"text": text, "sourceFilesRead": sourceFiles})
}

func (s *Server) handleTestOpenAPI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OpenAIBaseURL string `json:"openAIBaseUrl"`
		OpenAIAPIKey  string `json:"openAIApiKey"`
		OpenAIModel   string `json:"openAIModel"`
		ProjectID     string `json:"projectId"`
		APIProtocol   string `json:"apiProtocol"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	key := strings.TrimSpace(body.OpenAIAPIKey)
	baseURL := strings.TrimSpace(body.OpenAIBaseURL)
	modelName := strings.TrimSpace(body.OpenAIModel)
	// Blank key: prefer project custom config when projectId is set, else global.
	if key == "" {
		if body.ProjectID != "" {
			if p, _ := s.Store.GetProject(body.ProjectID); p != nil &&
				p.UseCustomModelConfig && p.CustomModelConfig != nil &&
				strings.TrimSpace(p.CustomModelConfig.OpenAIAPIKey) != "" {
				key = p.CustomModelConfig.OpenAIAPIKey
				if baseURL == "" {
					baseURL = p.CustomModelConfig.OpenAIBaseURL
				}
				if modelName == "" {
					modelName = p.CustomModelConfig.OpenAIModel
				}
			}
		}
		if key == "" {
			cfg, _ := s.Store.GetModelConfig()
			key = cfg.OpenAIAPIKey
			if baseURL == "" {
				baseURL = cfg.OpenAIBaseURL
			}
			if modelName == "" {
				modelName = cfg.OpenAIModel
			}
		}
	}
	// Connectivity test shares OpenAPI retries (10) for 429 rate limits.
	ctx, cancel := context.WithTimeout(r.Context(), llm.RequestTimeout)
	defer cancel()
	reply, err := s.LLM.TestOpenAPI(ctx, baseURL, key, modelName, body.APIProtocol)
	if err != nil {
		writeJSON(w, 400, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": reply})
}
