package api

import (
	"strings"

	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/version"
)

func (s *Server) currentModelName(projectID string) string {
	cfg, err := s.resolveModel(projectID)
	if err != nil {
		if g, e := s.Store.GetModelConfig(); e == nil {
			return strings.TrimSpace(g.OpenAIModel)
		}
		return ""
	}
	return strings.TrimSpace(cfg.OpenAIModel)
}

func (s *Server) currentExecutorName() string {
	cfg, err := s.Store.GetExecutorConfig()
	if err != nil {
		return ""
	}
	return executor.DisplayName(cfg)
}

func (s *Server) recordIssueHistory(issue *model.Issue, eventType, modelName string, extra map[string]any) {
	if s == nil || s.Store == nil || issue == nil {
		return
	}
	if modelName == "" {
		modelName = s.currentModelName(issue.ProjectID)
	}
	payload := map[string]any{
		"status":                     string(issue.Status),
		"docPhase":                   string(issue.DocPhase),
		"executor":                   s.currentExecutorName(),
		"requirementRevisionId":      issue.CurrentRequirementRevisionID,
		"developmentRevisionId":      issue.CurrentDevelopmentRevisionID,
		"designRequirementRevisionId": issue.DesignRequirementRevisionID,
	}
	for k, v := range extra {
		payload[k] = v
	}
	_, _ = s.Store.AppendHistoryEvent(model.HistoryEvent{
		IssueID:    issue.ID,
		EventType:  eventType,
		Model:      modelName,
		AppVersion: version.Version,
		Payload:    payload,
	})
}

func (s *Server) recordGlobalHistory(eventType, modelName string, extra map[string]any) {
	if s == nil || s.Store == nil {
		return
	}
	if modelName == "" {
		modelName = s.currentModelName("")
	}
	payload := map[string]any{
		"executor": s.currentExecutorName(),
	}
	for k, v := range extra {
		payload[k] = v
	}
	_, _ = s.Store.AppendHistoryEvent(model.HistoryEvent{
		IssueID:    "",
		EventType:  eventType,
		Model:      modelName,
		AppVersion: version.Version,
		Payload:    payload,
	})
}
