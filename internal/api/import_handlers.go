package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/issueimport"
	"github.com/ymhhh/vibecoding/internal/model"
)

type importIssueRequest struct {
	ProjectID         string          `json:"projectId"`
	URL               string          `json:"url"`
	AssociatedRepoIDs []string        `json:"associatedRepoIds"`
	Priority          model.Priority  `json:"priority"`
	Kind              model.IssueKind `json:"kind"`
	Assignee          string          `json:"assignee"`
}

type importIssueResponse struct {
	Issue   *model.Issue `json:"issue"`
	Created bool         `json:"created"`
}

func (s *Server) handleImportIssue(w http.ResponseWriter, r *http.Request) {
	var body importIssueRequest
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	projectID := strings.TrimSpace(body.ProjectID)
	if projectID == "" {
		writeErr(w, 400, "projectId required")
		return
	}
	proj, err := s.Store.GetProject(projectID)
	if err != nil || proj == nil {
		writeErr(w, 404, "project not found")
		return
	}
	reviewBefore := model.NormalizeReviewMode(proj.ReviewMode)

	tokensCfg, _ := s.Store.GetIssueImportTokens()
	tokens := issueimport.Tokens{
		GitHub: tokensCfg.GitHub,
		Gitee:  tokensCfg.Gitee,
		Linear: tokensCfg.Linear,
	}

	fetched, err := issueimport.Import(r.Context(), body.URL, tokens, nil)
	if err != nil {
		var ie *issueimport.Error
		if errors.As(err, &ie) {
			status := 400
			if ie.Code == "needs_token" || ie.Code == "fetch_failed" {
				status = 422
			}
			writeJSON(w, status, map[string]any{"error": ie.Message, "code": ie.Code})
			return
		}
		writeErr(w, 400, err.Error())
		return
	}

	canonical := fetched.CanonicalURL
	if existing, _ := s.Store.FindIssueBySourceURL(projectID, canonical); existing != nil {
		writeJSON(w, 200, importIssueResponse{Issue: existing, Created: false})
		return
	}
	// Also match the raw pasted URL if it differs only by slash/case.
	if alt := issueimport.CanonicalSourceURL(body.URL); alt != canonical {
		if existing, _ := s.Store.FindIssueBySourceURL(projectID, alt); existing != nil {
			writeJSON(w, 200, importIssueResponse{Issue: existing, Created: false})
			return
		}
	}

	repoIDs := body.AssociatedRepoIDs
	if repoIDs == nil {
		repoIDs = []string{}
	}
	if len(repoIDs) == 0 {
		for _, gr := range proj.GitRepos {
			repoIDs = append(repoIDs, gr.ID)
		}
	}

	title := strings.TrimSpace(fetched.Title)
	if title == "" {
		title = "Imported issue"
	}
	desc := strings.TrimSpace(fetched.Body)
	if desc == "" {
		desc = "No description provided."
	}
	now := model.NowISO()
	iss := model.Issue{
		ID:                "ISSUE-" + uuid.NewString()[:4],
		ProjectID:         projectID,
		Title:             title,
		Description:       desc,
		Status:            model.StatusRequirements,
		Priority:          model.NormalizePriority(body.Priority),
		Kind:              model.NormalizeIssueKind(body.Kind),
		Assignee:          strings.TrimSpace(body.Assignee),
		AssociatedRepoIDs: repoIDs,
		SourceURL:         canonical,
		CreatedAt:         now,
		UpdatedAt:         now,
		ChatMessages: []model.ChatMessage{{
			ID:        "msg-" + uuid.NewString()[:8],
			Sender:    "system",
			Text:      "Imported from " + fetched.Host + ": " + canonical + ". Confirm the requirement and design before Auto-Dev.",
			Timestamp: now,
		}},
		AutoDevLogs: []model.AutoDevLog{},
	}
	if err := s.Store.UpsertIssue(iss); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Import must not change review mode.
	if again, _ := s.Store.GetProject(projectID); again != nil {
		if model.NormalizeReviewMode(again.ReviewMode) != reviewBefore {
			again.ReviewMode = reviewBefore
			_ = s.Store.UpsertProject(*again)
		}
	}

	saved, _ := s.Store.GetIssue(iss.ID)
	writeJSON(w, 201, importIssueResponse{Issue: saved, Created: true})
}

func (s *Server) handleGetImportTokens(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Store.GetIssueImportTokens()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, cfg.Public())
}

func (s *Server) handlePutImportTokens(w http.ResponseWriter, r *http.Request) {
	var cfg model.IssueImportTokens
	if err := decodeJSON(r, &cfg); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	if err := s.Store.PutIssueImportTokens(cfg); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	saved, _ := s.Store.GetIssueImportTokens()
	writeJSON(w, 200, saved.Public())
}
