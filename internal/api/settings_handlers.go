package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Server) handleGetModel(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Store.GetModelConfig()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, cfg.Public())
}

func (s *Server) handlePutModel(w http.ResponseWriter, r *http.Request) {
	var cfg model.ModelConfig
	if err := decodeJSON(r, &cfg); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	if cfg.OpenAIBaseURL != "" {
		if err := llm.ValidateBaseURL(cfg.OpenAIBaseURL); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	prev, _ := s.Store.GetModelConfig()
	prevModel := strings.TrimSpace(prev.OpenAIModel)
	if err := s.Store.PutModelConfig(cfg); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	saved, _ := s.Store.GetModelConfig()
	newModel := strings.TrimSpace(saved.OpenAIModel)
	if prevModel != newModel {
		// Built-in client has no remote session; chat/docs stay on the issue (#36).
		s.recordGlobalHistory(model.HistoryModelChange, newModel, map[string]any{
			"previousModel": prevModel,
			"model":         newModel,
			"note":          "conversation continues from stored chat; no remote session to resume",
		})
		prefs, _ := s.Store.GetUIPrefs()
		if id := strings.TrimSpace(prefs.ActiveIssueID); id != "" {
			if iss, _ := s.Store.GetIssue(id); iss != nil {
				s.recordIssueHistory(iss, model.HistoryModelChange, newModel, map[string]any{
					"previousModel": prevModel,
					"model":         newModel,
					"note":          "conversation continues from stored chat; no remote session to resume",
				})
			}
		}
	}
	writeJSON(w, 200, saved.Public())
}

// handleListModels fetches available model IDs from the provider's
// /v1/models endpoint. Key resolution mirrors handleTestOpenAPI: the posted
// key wins; blank key falls back to the project custom config (when
// projectId is set) and then the global config. The posted base URL wins;
// otherwise the resolved config's URL is used.
func (s *Server) handleListModels(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OpenAIBaseURL string `json:"openAIBaseUrl"`
		OpenAIAPIKey  string `json:"openAIApiKey"`
		ProjectID     string `json:"projectId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	key := strings.TrimSpace(body.OpenAIAPIKey)
	baseURL := strings.TrimSpace(body.OpenAIBaseURL)
	if key == "" || baseURL == "" {
		if body.ProjectID != "" {
			if p, _ := s.Store.GetProject(body.ProjectID); p != nil &&
				p.UseCustomModelConfig && p.CustomModelConfig != nil {
				if key == "" && strings.TrimSpace(p.CustomModelConfig.OpenAIAPIKey) != "" {
					key = p.CustomModelConfig.OpenAIAPIKey
				}
				if baseURL == "" {
					baseURL = p.CustomModelConfig.OpenAIBaseURL
				}
			}
		}
		if key == "" || baseURL == "" {
			cfg, _ := s.Store.GetModelConfig()
			if key == "" {
				key = cfg.OpenAIAPIKey
			}
			if baseURL == "" {
				baseURL = cfg.OpenAIBaseURL
			}
		}
	}
	if baseURL == "" {
		writeErr(w, 400, "base URL required: set the API endpoint first or save the LLM config")
		return
	}
	if key == "" {
		writeErr(w, 400, "API key required: paste a key or save the config first")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	models, err := s.LLM.ListOpenAIModels(ctx, baseURL, key)
	if err != nil {
		writeJSON(w, 400, map[string]any{"models": []string{}, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"models": models})
}

func (s *Server) handleGetUIPrefs(w http.ResponseWriter, r *http.Request) {
	prefs, err := s.Store.GetUIPrefs()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, prefs)
}

func (s *Server) handlePutUIPrefs(w http.ResponseWriter, r *http.Request) {
	var prefs model.UIPrefs
	if err := decodeJSON(r, &prefs); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	if err := s.Store.PutUIPrefs(prefs); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, prefs)
}
