package api

import (
	"net/http"
	"strings"
)

func (s *Server) handleListIssueRevisions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	reqRevs, err := s.Store.ListRequirementRevisions(issue.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	devRevs, err := s.Store.ListDevelopmentRevisions(issue.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"requirementRevisions": reqRevs,
		"developmentRevisions": devRevs,
		"currentRequirementRevisionId": issue.CurrentRequirementRevisionID,
		"currentDevelopmentRevisionId": issue.CurrentDevelopmentRevisionID,
	})
}

func (s *Server) handleGetRequirementRevision(w http.ResponseWriter, r *http.Request) {
	issueID := r.PathValue("id")
	revID := r.PathValue("revId")
	issue, err := s.Store.GetIssue(issueID)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	rev, err := s.Store.GetRequirementRevision(revID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if rev == nil || rev.IssueID != issue.ID {
		writeErr(w, 404, "requirement revision not found")
		return
	}
	devRevs, err := s.Store.ListDevelopmentRevisions(issue.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	linked := make([]any, 0)
	for _, d := range devRevs {
		if d.RequirementRevisionID == rev.ID {
			linked = append(linked, d)
		}
	}
	writeJSON(w, 200, map[string]any{
		"revision":              rev,
		"developmentRevisions":  linked,
	})
}

func (s *Server) handleGetDevelopmentRevision(w http.ResponseWriter, r *http.Request) {
	issueID := r.PathValue("id")
	revID := r.PathValue("revId")
	issue, err := s.Store.GetIssue(issueID)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	rev, err := s.Store.GetDevelopmentRevision(revID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if rev == nil || rev.IssueID != issue.ID {
		writeErr(w, 404, "development revision not found")
		return
	}
	var req any
	if strings.TrimSpace(rev.RequirementRevisionID) != "" {
		if rr, _ := s.Store.GetRequirementRevision(rev.RequirementRevisionID); rr != nil {
			req = rr
		}
	}
	writeJSON(w, 200, map[string]any{
		"revision":             rev,
		"requirementRevision":  req,
	})
}
