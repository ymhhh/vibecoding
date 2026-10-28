package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Server) handleAutoDevStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IssueID          string                `json:"issueId"`
		SubRequirementID string                `json:"subRequirementId"`
		Executor         *model.ExecutorConfig `json:"executor,omitempty"`
	}
	if err := decodeJSON(r, &body); err != nil || body.IssueID == "" {
		writeErr(w, 400, "issueId required")
		return
	}
	issue, err := s.Store.GetIssue(body.IssueID)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	if !issue.SpecReadyForDev() {
		writeErr(w, 400, "Dev Spec required before Auto-Dev (all sub-requirements need specs when split)")
		return
	}
	if body.SubRequirementID != "" {
		if issue.SubByID(body.SubRequirementID) == nil {
			writeErr(w, 400, "sub-requirement not found")
			return
		}
		issue.ReworkSubID = body.SubRequirementID
	} else {
		issue.ReworkSubID = ""
	}
	if len(issue.AssociatedRepoIDs) == 0 {
		writeErr(w, 400, "associated repositories required")
		return
	}
	if active, _ := s.Store.ActiveJobForRepoIssue(body.IssueID); active != nil {
		writeErr(w, 409, "auto-dev already running for this issue")
		return
	}

	execCfg, err := s.resolveStartExecutor(body.Executor)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	execName := executor.DisplayName(execCfg)
	// Never reuse a prior CLI session when the executor identity changed (#37).
	prevExec := ""
	if issue.PRInfo != nil {
		prevExec = strings.TrimSpace(issue.PRInfo.Executor)
	}
	if issue.AgentSessionID != "" && prevExec != "" && prevExec != execName {
		issue.AgentSessionID = ""
	}
	if issue.AgentSessionID != "" && body.Executor != nil {
		// Explicit override that differs from the last run clears the session.
		if prevExec != "" && prevExec != execName {
			issue.AgentSessionID = ""
		}
	}

	issue.Status = model.StatusInProgress
	issue.AutoDevProgress = 5
	startMsg := fmt.Sprintf("Starting VibeBot Auto-Dev job (%s)...", execName)
	if issue.HasSubRequirements() {
		if issue.ReworkSubID != "" {
			title := issue.ReworkSubID
			if sub := issue.SubByID(issue.ReworkSubID); sub != nil {
				title = sub.Title
			}
			startMsg = fmt.Sprintf("Starting sequential Auto-Dev rework for sub-requirement: %s (%s)", title, execName)
		} else {
			startMsg = fmt.Sprintf("Starting sequential Auto-Dev for %d sub-requirement(s) (%s)...", len(issue.SubRequirements), execName)
		}
	}
	issue.AutoDevLogs = append(issue.AutoDevLogs, model.AutoDevLog{
		ID:        "log-" + uuid.NewString()[:8],
		Timestamp: time.Now().Format("15:04:05"),
		Phase:     "analyzing",
		Message:   startMsg,
	})
	_ = s.Store.UpsertIssue(*issue)

	job, err := s.Store.CreateJob(body.IssueID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	cfgCopy := execCfg
	job.ExecutorConfig = &cfgCopy
	job.Executor = execName
	if err := s.Store.UpdateJob(job); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.Runner.Start(job.ID)
	s.recordIssueHistory(issue, model.HistoryCodingStart, "", map[string]any{
		"jobId":          job.ID,
		"executor":       execName,
		"resumedSession": issue.AgentSessionID != "",
	})
	writeJSON(w, 202, job)
}

func (s *Server) resolveStartExecutor(override *model.ExecutorConfig) (model.ExecutorConfig, error) {
	cfg, _ := s.Store.GetExecutorConfig()
	if override != nil {
		cfg = *override
	}
	cfg = cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return cfg, err
	}
	if cfg.Type == "agent" {
		miss := executor.MissingBinaries(cfg, nil)
		if len(miss) > 0 {
			hint := "missing binary: " + strings.Join(miss, " / ")
			mc, _ := s.Store.GetModelConfig()
			configured, _ := model.MaskKey(mc.OpenAIAPIKey)
			for _, p := range executor.Probe(executor.ProbeOptions{LLMConfigured: configured}) {
				if p.Type == "agent" && p.Preset == cfg.Preset && strings.TrimSpace(p.Hint) != "" {
					hint = p.Hint
					break
				}
			}
			return cfg, fmt.Errorf("%s", hint)
		}
	}
	if override != nil && cfg.Type != "agent" {
		mc, _ := s.Store.GetModelConfig()
		configured, _ := model.MaskKey(mc.OpenAIAPIKey)
		if !configured {
			return cfg, fmt.Errorf("LLM API key not configured")
		}
	}
	return cfg, nil
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.Store.GetJob(r.PathValue("id"))
	if err != nil || job == nil {
		writeErr(w, 404, "job not found")
		return
	}
	logs, _ := s.Store.ListJobLogs(job.ID)
	writeJSON(w, 200, map[string]any{"job": job, "logs": logs})
}

func (s *Server) handleJobEvents(w http.ResponseWriter, r *http.Request) {
	jobID := r.PathValue("id")
	job, err := s.Store.GetJob(jobID)
	if err != nil || job == nil {
		writeErr(w, 404, "job not found")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, "streaming unsupported")
		return
	}

	// Replay existing logs
	logs, _ := s.Store.ListJobLogs(jobID)
	for _, log := range logs {
		ev := model.JobEvent{Type: "log", Phase: log.Phase, Message: log.Message, Details: log.Details, Log: &log, Progress: job.Progress}
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
	}
	flusher.Flush()

	if job.Status == model.JobCompleted || job.Status == model.JobFailed || job.Status == model.JobCancelled {
		ev := model.JobEvent{Type: "done", Status: string(job.Status), Progress: job.Progress, PRInfo: job.PRInfo, Error: job.Error, Phase: job.Phase}
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
		return
	}

	ch, unsub := s.Hub.Subscribe(jobID)
	defer unsub()

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(ev)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
			if ev.Type == "done" || ev.Type == "error" {
				return
			}
		case <-time.After(15 * time.Second):
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, err := s.Store.GetJob(id)
	if err != nil || job == nil {
		writeErr(w, 404, "job not found")
		return
	}
	ok := s.Hub.Cancel(id)
	if job.Status == model.JobQueued || job.Status == model.JobRunning {
		job.Status = model.JobCancelled
		job.Error = "cancelled by user"
		job.Phase = "cancelled"
		_ = s.Store.UpdateJob(job)
	}
	issue := s.resetIssueAutoDev(job.IssueID)
	s.Hub.Publish(id, model.JobEvent{Type: "status", Status: string(model.JobCancelled), Message: "cancelled"})
	writeJSON(w, 200, map[string]any{"ok": ok || issue != nil, "job": job, "issue": issue})
}

// handleCancelAutoDevByIssue cancels any active job and unsticks in_progress issues
// even after refresh (when the browser lost the in-memory job id).
func (s *Server) handleCancelAutoDevByIssue(w http.ResponseWriter, r *http.Request) {
	issueID := r.PathValue("id")
	issue, err := s.Store.GetIssue(issueID)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	var job *model.AutoDevJob
	if active, _ := s.Store.ActiveJobForRepoIssue(issueID); active != nil {
		job = active
		_ = s.Hub.Cancel(active.ID)
		active.Status = model.JobCancelled
		active.Error = "cancelled by user"
		active.Phase = "cancelled"
		_ = s.Store.UpdateJob(active)
		s.Hub.Publish(active.ID, model.JobEvent{Type: "status", Status: string(model.JobCancelled), Message: "cancelled"})
	}
	issue = s.resetIssueAutoDev(issueID)
	if issue == nil {
		writeErr(w, 500, "failed to update issue")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "job": job, "issue": issue})
}

func (s *Server) resetIssueAutoDev(issueID string) *model.Issue {
	issue, err := s.Store.GetIssue(issueID)
	if err != nil || issue == nil {
		return nil
	}
	if issue.Status == model.StatusInProgress {
		issue.Status = model.StatusBacklog
		issue.UpdatedAt = model.NowISO()
		if err := s.Store.UpsertIssue(*issue); err != nil {
			return nil
		}
	}
	return issue
}
