package api

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/ymhhh/go-common/logger"
	"github.com/ymhhh/vibecoding/internal/autodev"
	"github.com/ymhhh/vibecoding/internal/db"
	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
)

type Server struct {
	Store  *db.Store
	LLM    *llm.Client
	Runner *autodev.Runner
	Hub    *autodev.Hub
	Static fs.FS
	Token  string // when set, /api/* (except health/OPTIONS) requires auth
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)

	mux.HandleFunc("GET /api/settings/model", s.handleGetModel)
	mux.HandleFunc("PUT /api/settings/model", s.handlePutModel)
	mux.HandleFunc("POST /api/settings/models", s.handleListModels)
	mux.HandleFunc("GET /api/settings/executor", s.handleGetExecutor)
	mux.HandleFunc("PUT /api/settings/executor", s.handlePutExecutor)
	mux.HandleFunc("GET /api/executors", s.handleListExecutors)
	mux.HandleFunc("GET /api/ui-prefs", s.handleGetUIPrefs)
	mux.HandleFunc("PUT /api/ui-prefs", s.handlePutUIPrefs)

	mux.HandleFunc("GET /api/projects", s.handleListProjects)
	mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	mux.HandleFunc("PUT /api/projects/{id}", s.handleUpdateProject)
	mux.HandleFunc("DELETE /api/projects/{id}", s.handleDeleteProject)
	mux.HandleFunc("GET /api/projects/{id}/commits", s.handleListProjectCommits)

	mux.HandleFunc("GET /api/issues", s.handleListIssues)
	mux.HandleFunc("POST /api/issues", s.handleCreateIssue)
	mux.HandleFunc("GET /api/issues/{id}", s.handleGetIssue)
	mux.HandleFunc("PUT /api/issues/{id}", s.handleUpdateIssue)
	mux.HandleFunc("DELETE /api/issues/{id}", s.handleDeleteIssue)
	mux.HandleFunc("POST /api/issues/{id}/approve-merge", s.handleApproveMerge)
	mux.HandleFunc("GET /api/issues/{id}/diff", s.handleIssueDiff)
	mux.HandleFunc("GET /api/issues/{id}/branches", s.handleIssueBranches)
	mux.HandleFunc("POST /api/issues/{id}/rebase", s.handleIssueRebase)
	mux.HandleFunc("POST /api/issues/{id}/publish-remote", s.handleIssuePublishRemote)
	mux.HandleFunc("POST /api/issues/{id}/open-editor", s.handleOpenEditor)

	mux.HandleFunc("POST /api/repos/validate", s.handleValidateRepo)

	mux.HandleFunc("POST /api/chat", s.handleChat)
	mux.HandleFunc("POST /api/test-openapi", s.handleTestOpenAPI)
	mux.HandleFunc("POST /api/issues/{id}/spec", s.handleGenerateSpec)
	mux.HandleFunc("POST /api/issues/{id}/req-doc", s.handleGenerateReqDoc)
	mux.HandleFunc("POST /api/issues/{id}/req-doc/from-brief", s.handleReqDocFromBrief)
	mux.HandleFunc("POST /api/issues/{id}/accept-requirement", s.handleAcceptRequirement)
	mux.HandleFunc("POST /api/issues/{id}/accept-design", s.handleAcceptDesign)
	mux.HandleFunc("GET /api/issues/{id}/export-spec", s.handleExportSpec)
	mux.HandleFunc("GET /api/issues/{id}/export-req", s.handleExportReqDoc)
	mux.HandleFunc("POST /api/export-file", s.handleExportFile)
	mux.HandleFunc("POST /api/issues/{id}/split", s.handleSplitIssue)

	mux.HandleFunc("POST /api/auto-dev/start", s.handleAutoDevStart)
	mux.HandleFunc("GET /api/auto-dev/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("GET /api/auto-dev/jobs/{id}/events", s.handleJobEvents)
	mux.HandleFunc("POST /api/auto-dev/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("POST /api/issues/{id}/cancel-auto-dev", s.handleCancelAutoDevByIssue)

	if s.Static != nil {
		fileServer := http.FileServer(http.FS(s.Static))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.NotFound(w, r)
				return
			}
			// SPA fallback
			path := strings.TrimPrefix(r.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}
			f, err := s.Static.Open(path)
			if err != nil {
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
				return
			}
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
		})
	}

	return withAccessLog(withCORS(withAuth(s.Token, mux)))
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		// Skip noisy static/health probes; keep /api/* (except health at debug).
		path := r.URL.Path
		if !strings.HasPrefix(path, "/api/") {
			return
		}
		fields := logger.Fields{
			"method":      r.Method,
			"path":        path,
			"status":      sw.status,
			"bytes":       sw.bytes,
			"duration_ms": time.Since(start).Milliseconds(),
		}
		entry := logger.L().WithFields(fields)
		switch {
		case path == "/api/health":
			entry.Debug("http")
		case sw.status >= 500:
			entry.Error("http")
		case sw.status >= 400:
			entry.Warn("http")
		default:
			entry.Info("http")
		}
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Vibecoding-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withAuth requires Bearer / X-Vibecoding-Token / ?token= when token is non-empty.
// GET /api/health and OPTIONS are always allowed so the UI can discover authRequired.
func withAuth(token string, next http.Handler) http.Handler {
	token = strings.TrimSpace(token)
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		got := requestAPIToken(r)
		if got == "" || got != token {
			writeErr(w, http.StatusUnauthorized, "unauthorized: provide Authorization: Bearer <token> or X-Vibecoding-Token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestAPIToken(r *http.Request) string {
	if h := strings.TrimSpace(r.Header.Get("X-Vibecoding-Token")); h != "" {
		return h
	}
	if auth := strings.TrimSpace(r.Header.Get("Authorization")); auth != "" {
		const prefix = "Bearer "
		if strings.HasPrefix(auth, prefix) {
			return strings.TrimSpace(auth[len(prefix):])
		}
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			return strings.TrimSpace(auth[7:])
		}
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	if status >= 500 {
		logger.L().WithField("status", status).Error(msg)
	} else if status >= 400 {
		logger.L().WithField("status", status).Warn(msg)
	}
	writeJSON(w, status, map[string]string{"error": msg})
}

func wantsStream(r *http.Request) bool {
	if r.URL.Query().Get("stream") == "1" {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/event-stream")
}

type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func newSSE(w http.ResponseWriter) (*sseWriter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming unsupported")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return &sseWriter{w: w, flusher: flusher}, nil
}

func (s *sseWriter) event(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", b); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

func decodeJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	// Attachments are stored as data URLs in the issue JSON (PDF cap 10 MiB
	// becomes ~14 MiB encoded, plus other files). 10 MiB was too small.
	dec := json.NewDecoder(io.LimitReader(r.Body, 64<<20))
	return dec.Decode(dest)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	cfg, _ := s.Store.GetModelConfig()
	configured, _ := model.MaskKey(cfg.OpenAIAPIKey)
	writeJSON(w, 200, map[string]any{
		"status":        "ok",
		"timestamp":     time.Now().UTC().Format(time.RFC3339),
		"llmConfigured": configured,
		"authRequired":  strings.TrimSpace(s.Token) != "",
	})
}
