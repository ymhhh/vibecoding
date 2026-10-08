package autodev

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ymhhh/go-common/logger"
	"github.com/ymhhh/vibecoding/internal/db"
	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/llm"
	"github.com/ymhhh/vibecoding/internal/model"
)

type Runner struct {
	Store        *db.Store
	LLM          *llm.Client
	Hub          *Hub
	WorktreeRoot string // e.g. ~/.vibecoding/worktrees
	// NewExecutor builds the coding executor; nil uses executor.Build with Store config + LLM.
	NewExecutor func(cfg model.ExecutorConfig) (executor.Executor, error)
}

// RunSync executes a job on the calling goroutine (tests / sync callers).
func (r *Runner) RunSync(ctx context.Context, jobID string) error {
	return r.run(ctx, jobID)
}

func (r *Runner) Start(jobID string) {
	ctx, cancel := context.WithCancel(context.Background())
	r.Hub.mu.Lock()
	r.Hub.cancels[jobID] = cancel
	r.Hub.mu.Unlock()

	logger.L().WithField("job_id", jobID).Info("autodev started")

	go func() {
		defer func() {
			r.Hub.mu.Lock()
			delete(r.Hub.cancels, jobID)
			r.Hub.mu.Unlock()
			cancel()
		}()
		if err := r.run(ctx, jobID); err != nil {
			job, _ := r.Store.GetJob(jobID)
			if job == nil {
				return
			}
			if errors.Is(err, context.Canceled) || job.Status == model.JobCancelled {
				job.Status = model.JobCancelled
				job.Error = "cancelled"
				job.Phase = "cancelled"
				_ = r.Store.UpdateJob(job)
				_ = r.resetIssueToBacklog(job.IssueID)
				r.Hub.Publish(jobID, model.JobEvent{Type: "status", Status: string(model.JobCancelled), Message: "cancelled"})
				logger.L().WithField("job_id", jobID).Info("autodev cancelled")
				return
			}
			job.Status = model.JobFailed
			job.Error = err.Error()
			job.Phase = "failed"
			_ = r.Store.UpdateJob(job)
			_ = r.appendLog(job, "failed", err.Error(), "")
			_ = r.resetIssueToBacklog(job.IssueID)
			r.Hub.Publish(jobID, model.JobEvent{Type: "error", Phase: "failed", Error: err.Error(), Status: string(model.JobFailed)})
			logger.L().WithFields(logger.Fields{
				"job_id":   jobID,
				"issue_id": job.IssueID,
			}).WithError(err).Error("autodev failed")
		}
	}()
}

// resetIssueToBacklog moves a stuck in_progress issue back after fail/cancel.
// Review-repair runs stay in_review and reopen fixing comments instead of backlog.
func (r *Runner) resetIssueToBacklog(issueID string) error {
	issue, err := r.Store.GetIssue(issueID)
	if err != nil || issue == nil {
		return err
	}
	if issue.Status != model.StatusInProgress {
		return nil
	}
	if issue.IsReviewRepair() {
		issue.Status = model.StatusInReview
		issue.ReviewComments = model.MarkFixingCommentsOpen(issue.ReviewComments)
	} else {
		issue.Status = model.StatusBacklog
	}
	issue.UpdatedAt = model.NowISO()
	return r.Store.UpsertIssue(*issue)
}

func (r *Runner) run(ctx context.Context, jobID string) error {
	job, err := r.Store.GetJob(jobID)
	if err != nil || job == nil {
		return fmt.Errorf("job not found")
	}
	job.Status = model.JobRunning
	job.Phase = "analyzing"
	_ = r.Store.UpdateJob(job)

	issue, err := r.Store.GetIssue(job.IssueID)
	if err != nil || issue == nil {
		return fmt.Errorf("issue not found")
	}
	proj, err := r.Store.GetProject(issue.ProjectID)
	if err != nil || proj == nil {
		return fmt.Errorf("project not found")
	}
	if !issue.SpecReadyForDev() {
		return fmt.Errorf("issue has no Dev Spec")
	}

	var repos []model.GitRepo
	for _, rid := range issue.AssociatedRepoIDs {
		for _, gr := range proj.GitRepos {
			if gr.ID == rid {
				repos = append(repos, gr)
			}
		}
	}
	if len(repos) == 0 {
		return fmt.Errorf("no associated repositories")
	}
	for _, repo := range repos {
		if _, err := gitx.ValidateRepo(repo.Path); err != nil {
			return fmt.Errorf("repo %s: %w", repo.Name, err)
		}
	}

	job.Status = model.JobRunning
	_ = r.Store.UpdateJob(job)

	cfg, _ := r.Store.GetModelConfig()
	if proj.UseCustomModelConfig && proj.CustomModelConfig != nil && strings.TrimSpace(proj.CustomModelConfig.OpenAIAPIKey) != "" {
		cfg = *proj.CustomModelConfig
	}

	execCfg, _ := r.Store.GetExecutorConfig()
	if job.ExecutorConfig != nil {
		execCfg = *job.ExecutorConfig
	}
	execCfg = execCfg.Normalize()
	execName := executor.DisplayName(execCfg)
	job.Executor = execName
	if job.ExecutorConfig == nil {
		cfgCopy := execCfg
		job.ExecutorConfig = &cfgCopy
	}
	_ = r.Store.UpdateJob(job)

	prefix := "feature/"
	if proj.BranchPrefixConfig != nil {
		prefix = proj.BranchPrefixConfig.PrefixForKind(issue.Kind)
	} else {
		bp := model.DefaultBranchPrefix()
		prefix = bp.PrefixForKind(issue.Kind)
	}
	branchName := model.BranchNameForIssue(prefix, issue.ID)

	progress := func(p int, phase, msg string) error {
		if ctx.Err() != nil {
			job.Status = model.JobCancelled
			job.Error = "cancelled"
			job.Phase = "cancelled"
			_ = r.Store.UpdateJob(job)
			_ = r.resetIssueToBacklog(issue.ID)
			r.Hub.Publish(jobID, model.JobEvent{Type: "status", Status: string(model.JobCancelled), Message: "cancelled"})
			return context.Canceled
		}
		job.Progress = p
		job.Phase = phase
		_ = r.Store.UpdateJob(job)
		_ = r.appendLog(job, phase, msg, "")
		issue.AutoDevProgress = p
		issue.Status = model.StatusInProgress
		_ = r.Store.UpsertIssue(*issue)
		r.Hub.Publish(jobID, model.JobEvent{Type: "progress", Phase: phase, Message: msg, Progress: p, Status: string(model.JobRunning)})
		logger.L().WithFields(logger.Fields{
			"job_id":   jobID,
			"issue_id": issue.ID,
			"phase":    phase,
			"progress": p,
		}).Info(msg)
		return nil
	}

	if err := progress(10, "analyzing", "Analyzing Dev Spec and sampling repository context..."); err != nil {
		return err
	}

	if err := progress(25, "branching", fmt.Sprintf("Preparing isolated worktrees for %s", branchName)); err != nil {
		return err
	}
	sessions, baseBranch, err := r.prepareWorktrees(repos, issue.ID, branchName)
	if err != nil {
		return err
	}
	for _, s := range sessions {
		_ = r.appendLog(job, "branching", fmt.Sprintf("[%s] worktree %s (base=%s, branch=%s)", s.Repo.Name, s.WTPath, s.Base, s.Branch), "")
	}
	if hasSetupCommand(sessions) {
		if err := progress(28, "setup", "Running worktree setup commands..."); err != nil {
			return err
		}
		if err := r.runSetupCommands(ctx, job, sessions); err != nil {
			return err
		}
	}
	wtRepos := sessionsToRepos(sessions)

	var quality *model.QualityGate
	if issue.HasSubRequirements() {
		quality, err = r.developSubs(ctx, job, issue, sessions, cfg, execCfg, progress)
		if err != nil {
			return err
		}
	} else {
		quality, err = r.developOne(ctx, job, issue, sessions, cfg, execCfg, issue.DevSpec, issue.Title, issue.PromptDescription(), withReviewFeedback(issue, ""), 40, 90, true, progress)
		if err != nil {
			return err
		}
	}

	author := "VibeBot"
	if len(wtRepos) > 0 {
		if n := gitx.UserName(wtRepos[0].Path); n != "" {
			author = n
		}
	}
	pr := &model.PRInfo{
		ID:          "pr-" + uuid.NewString()[:8],
		BranchName:  branchName,
		Title:       "feat: " + issue.Title,
		Description: r.prDescription(*issue),
		Author:      author,
		CreatedAt:   model.NowISO(),
		Status:      "open",
		DiffStats:   r.collectDiffStats(wtRepos),
		Worktrees:   sessionsToRefs(sessions),
		BaseBranch:  baseBranch,
		Quality:     quality,
		Executor:    execName,
	}
	job.Executor = execName
	job.Status = model.JobCompleted
	job.Progress = 100
	job.Phase = "completed"
	job.PRInfo = pr
	_ = r.Store.UpdateJob(job)

	fresh, _ := r.Store.GetIssue(issue.ID)
	if fresh != nil {
		issue = fresh
	}
	issue.Status = model.StatusInReview
	issue.AutoDevProgress = 100
	issue.PRInfo = pr
	issue.CurrentSubID = ""
	issue.ReworkSubID = ""
	if issue.IsReviewRepair() || model.HasBlockingReviewComments(issue.ReviewComments) {
		issue.ReviewComments = model.MarkFixingCommentsFixed(issue.ReviewComments)
		issue.ReviewFeedback = ""
	}
	issue.UpdatedAt = model.NowISO()
	_ = r.appendLog(job, "completed", "Code committed; issue moved to in_review", "")
	logs, _ := r.Store.ListJobLogs(job.ID)
	if len(logs) > 0 {
		issue.AutoDevLogs = append(issue.AutoDevLogs, logs...)
	}
	if issue.HasSubRequirements() && issue.DevSpec != nil {
		issue.DevSpec.FileChanges = issue.AggregatedFileChanges()
	}
	_ = r.Store.UpsertIssue(*issue)

	logger.L().WithFields(logger.Fields{
		"job_id":   jobID,
		"issue_id": issue.ID,
		"branch":   branchName,
	}).Info("autodev completed")

	r.Hub.Publish(jobID, model.JobEvent{
		Type:     "done",
		Phase:    "completed",
		Message:  "Auto-dev completed",
		Progress: 100,
		Status:   string(model.JobCompleted),
		PRInfo:   pr,
	})
	return nil
}

func (r *Runner) appendLog(job *model.AutoDevJob, phase, message, details string) error {
	log := model.AutoDevLog{
		ID:        "log-" + uuid.NewString()[:10],
		Timestamp: time.Now().Format("15:04:05"),
		Phase:     phase,
		Message:   message,
		Details:   details,
	}
	if err := r.Store.AppendJobLog(job.ID, job.IssueID, log); err != nil {
		return err
	}
	// Also persist onto issue for UI convenience
	iss, _ := r.Store.GetIssue(job.IssueID)
	if iss != nil {
		iss.AutoDevLogs = append(iss.AutoDevLogs, log)
		_ = r.Store.UpsertIssue(*iss)
	}
	r.Hub.Publish(job.ID, model.JobEvent{Type: "log", Phase: phase, Message: message, Details: details, Log: &log, Progress: job.Progress})
	return nil
}
