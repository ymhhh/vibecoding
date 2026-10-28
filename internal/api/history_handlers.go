package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/version"
)

func (s *Server) handleListIssueHistory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	limit := 200
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	list, err := s.Store.ListHistoryEvents(issue.ID, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"events":     list,
		"appVersion": version.Version,
	})
}

func (s *Server) handleSessionFocus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IssueID string `json:"issueId"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.IssueID) == "" {
		writeErr(w, 400, "issueId required")
		return
	}
	issue, err := s.Store.GetIssue(body.IssueID)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	prefs, _ := s.Store.GetUIPrefs()
	prefs.ActiveProjectID = issue.ProjectID
	prefs.ActiveIssueID = issue.ID
	_ = s.Store.PutUIPrefs(prefs)
	s.recordIssueHistory(issue, model.HistorySessionFocus, "", map[string]any{
		"projectId": issue.ProjectID,
	})
	writeJSON(w, 200, map[string]any{
		"ok":              true,
		"activeProjectId": issue.ProjectID,
		"activeIssueId":   issue.ID,
	})
}
