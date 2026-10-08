package autodev

import (
	"context"
	"fmt"
	"strings"

	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/repocontext"
)

func (r *Runner) developSubs(
	ctx context.Context,
	job *model.AutoDevJob,
	issue *model.Issue,
	sessions []worktreeSession,
	cfg model.ModelConfig,
	execCfg model.ExecutorConfig,
	progress func(int, string, string) error,
) (*model.QualityGate, error) {
	issue.NormalizeSubs()
	indices := make([]int, 0, len(issue.SubRequirements))
	reworkID := strings.TrimSpace(issue.ReworkSubID)
	if reworkID != "" {
		found := false
		for i, sub := range issue.SubRequirements {
			if sub.ID == reworkID {
				indices = append(indices, i)
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("rework sub-requirement %s not found", reworkID)
		}
	} else {
		for i := range issue.SubRequirements {
			indices = append(indices, i)
		}
	}
	n := len(indices)
	if n == 0 {
		return nil, fmt.Errorf("no sub-requirements to develop")
	}

	var lastQuality *model.QualityGate
	for k, idx := range indices {
		sub := &issue.SubRequirements[idx]
		if sub.DevSpec == nil {
			return nil, fmt.Errorf("sub-requirement %q has no Dev Spec", sub.Title)
		}
		sub.Status = model.SubReqInProgress
		issue.CurrentSubID = sub.ID
		issue.UpdatedAt = model.NowISO()
		_ = r.Store.UpsertIssue(*issue)

		pStart := 20 + 70*k/n
		pEnd := 20 + 70*(k+1)/n
		label := fmt.Sprintf("[%d/%d] %s", k+1, n, sub.Title)
		if err := progress(pStart, "coding", "Developing sub-requirement "+label); err != nil {
			return nil, err
		}
		r.Hub.Publish(job.ID, model.JobEvent{
			Type:             "progress",
			Phase:            "coding",
			Message:          "Developing " + label,
			Progress:         pStart,
			Status:           string(model.JobRunning),
			SubRequirementID: sub.ID,
			SubTitle:         sub.Title,
			SubIndex:         k + 1,
			SubTotal:         n,
		})

		var extra strings.Builder
		extra.WriteString(fmt.Sprintf("This is sub-requirement %d of %d for parent issue %q.\n", sub.Order, len(issue.SubRequirements), issue.Title))
		extra.WriteString("Implement ONLY this sub-requirement. Do not undo earlier sub-requirement work.\n")
		if reworkID != "" {
			extra.WriteString("This is a REWORK pass: previous code is already on the branch. Update this sub's files.\n")
		}
		for _, sib := range issue.SubRequirements {
			if sib.ID == sub.ID {
				continue
			}
			extra.WriteString(fmt.Sprintf("- sibling [%d] %s (%s)\n", sib.Order, sib.Title, sib.Status))
		}

		q, err := r.developOne(ctx, job, issue, sessions, cfg, execCfg, sub.DevSpec, sub.Title, firstNonEmpty(sub.Description, issue.PromptDescription()), withReviewFeedback(issue, extra.String()), pStart, pEnd, k == n-1, progress)
		if err != nil {
			sub.Status = model.SubReqFailed
			issue.UpdatedAt = model.NowISO()
			_ = r.Store.UpsertIssue(*issue)
			return q, fmt.Errorf("sub-requirement %q: %w", sub.Title, err)
		}
		lastQuality = q

		sha := ""
		if len(sessions) > 0 {
			sha, _ = gitx.HeadSHA(sessions[0].WTPath)
		}
		if fresh, err := r.Store.GetIssue(issue.ID); err == nil && fresh != nil {
			*issue = *fresh
		}
		if target := issue.SubByID(sub.ID); target != nil {
			target.Status = model.SubReqDone
			target.CommitSHA = sha
		}
		issue.CurrentSubID = sub.ID
		issue.UpdatedAt = model.NowISO()
		_ = r.Store.UpsertIssue(*issue)
		_ = r.appendLog(job, "committing", fmt.Sprintf("Completed sub-requirement %s", label), sha)
	}

	issue.ReworkSubID = ""
	issue.CurrentSubID = ""
	issue.UpdatedAt = model.NowISO()
	_ = r.Store.UpsertIssue(*issue)
	return lastQuality, nil
}

func (r *Runner) buildExecutor(execCfg model.ExecutorConfig) (executor.Executor, error) {
	if r.NewExecutor != nil {
		return r.NewExecutor(execCfg)
	}
	return executor.Build(execCfg, r.LLM)
}

func (r *Runner) developOne(
	ctx context.Context,
	job *model.AutoDevJob,
	issue *model.Issue,
	sessions []worktreeSession,
	cfg model.ModelConfig,
	execCfg model.ExecutorConfig,
	spec *model.DevSpec,
	title, desc, extra string,
	pStart, pEnd int,
	withLint bool,
	progress func(int, string, string) error,
) (*model.QualityGate, error) {
	if spec == nil {
		return nil, fmt.Errorf("missing Dev Spec")
	}
	repos := sessionsToRepos(sessions)
	baseSHAs := make([]string, len(sessions))
	for i, s := range sessions {
		sha, err := gitx.RefSHA(s.MainPath, "refs/heads/"+s.Base)
		if err != nil {
			return nil, fmt.Errorf("snapshot base %s: %w", s.Repo.Name, err)
		}
		baseSHAs[i] = sha
	}
	span := pEnd - pStart
	if span < 8 {
		span = 8
	}
	pCode := pStart
	pTest := pStart + span*50/100
	pLint := pStart + span*75/100
	pCommit := pEnd
	if pTest <= pCode {
		pTest = pCode + 1
	}

	ex, err := r.buildExecutor(execCfg)
	if err != nil {
		return nil, err
	}
	emit := func(phase, msg, details string) {
		_ = r.appendLog(job, phase, msg, details)
	}

	maxHeal := execCfg.Normalize().MaxHeal
	quality := &model.QualityGate{}
	healExtra := extra
	sessionID := strings.TrimSpace(issue.AgentSessionID)
	if sessionID != "" {
		_ = r.appendLog(job, "coding", fmt.Sprintf("Resuming prior executor session %s", sessionID), "")
	}

	for round := 0; round <= maxHeal; round++ {
		if round > 0 {
			quality.RepairRounds = round
			if err := progress(pCode, "coding", fmt.Sprintf("Repair round %d/%d for %s...", round, maxHeal, title)); err != nil {
				return quality, err
			}
			_ = r.appendLog(job, "testing", fmt.Sprintf("tests failed, repair round %d/%d", round, maxHeal), "")
		} else if err := progress(pCode, "coding", fmt.Sprintf("Generating code for %s via %s...", title, ex.Name())); err != nil {
			return quality, err
		}

		var allChanges []model.SpecFileChange
		for _, s := range sessions {
			repo := s.Repo
			snaps, err := repocontext.Collect([]model.GitRepo{repo}, spec.FileChanges)
			if err != nil {
				return quality, err
			}
			req := executor.CodingRequest{
				RepoPath:    s.WTPath,
				RepoName:    repo.Name,
				Branch:      s.Branch,
				BaseBranch:  s.Base,
				Title:       title,
				Description: desc,
				Spec:        spec,
				Extra:       healExtra,
				Snapshots:   snaps,
				Resume:      sessionID,
				ModelConfig: cfg,
			}
			res, err := ex.Run(ctx, req, emit)
			if err != nil {
				return quality, fmt.Errorf("executor %s on %s: %w", ex.Name(), repo.Name, err)
			}
			if res.SessionID != "" {
				sessionID = res.SessionID
				r.persistAgentSession(issue, sessionID)
			}
			allChanges = append(allChanges, res.Changes...)
		}

		if len(allChanges) > 0 {
			spec.FileChanges = allChanges
			spec.UpdatedAt = model.NowISO()
			if issue.HasSubRequirements() {
				if fresh, e := r.Store.GetIssue(issue.ID); e == nil && fresh != nil {
					*issue = *fresh
				}
				if target := issue.SubByID(issue.CurrentSubID); target != nil && target.DevSpec != nil {
					target.DevSpec.FileChanges = allChanges
					target.DevSpec.UpdatedAt = spec.UpdatedAt
				}
			} else if issue.DevSpec != nil {
				issue.DevSpec.FileChanges = allChanges
				issue.DevSpec.UpdatedAt = spec.UpdatedAt
			}
			_ = r.Store.UpsertIssue(*issue)
		}

		if err := progress(pTest, "testing", fmt.Sprintf("Running tests after %s...", title)); err != nil {
			return quality, err
		}
		testFailed := false
		var failBuf strings.Builder
		for _, repo := range repos {
			out, how, skipped, err := runTests(repo)
			if skipped {
				msg := fmt.Sprintf("[%s] no test command detected — skipped", repo.Name)
				if how != "" {
					msg = fmt.Sprintf("[%s] %s — skipped", repo.Name, how)
				}
				_ = r.appendLog(job, "testing", msg, out)
				continue
			}
			quality.TestsRan = true
			_ = r.appendLog(job, "testing", fmt.Sprintf("[%s] running %s", repo.Name, how), "")
			if err != nil {
				testFailed = true
				quality.TestsPassed = false
				failBuf.WriteString(fmt.Sprintf("[%s]\n%s\n", repo.Name, out))
				_ = r.appendLog(job, "testing", fmt.Sprintf("[%s] tests failed", repo.Name), truncate(out, 1500))
				continue
			}
			_ = r.appendLog(job, "testing", fmt.Sprintf("[%s] tests passed", repo.Name), truncate(out, 800))
		}
		if !testFailed {
			if quality.TestsRan {
				quality.TestsPassed = true
			}
			quality.TestsOutput = ""
			break
		}
		quality.TestsOutput = truncate(failBuf.String(), 4000)
		if round == maxHeal {
			return quality, fmt.Errorf("tests failed after %d repair round(s):\n%s", maxHeal, truncate(quality.TestsOutput, 1500))
		}
		healExtra = extra
		if healExtra != "" {
			healExtra += "\n\n"
		}
		healExtra += "Previous tests failed. Fix the failures using this output:\n" + quality.TestsOutput
	}

	if withLint {
		if err := progress(pLint, "linting", "Running lightweight static checks..."); err != nil {
			return quality, err
		}
		var lintBuf strings.Builder
		lintFailed := false
		for _, repo := range repos {
			out, how, skipped, err := runLint(repo)
			if skipped {
				msg := fmt.Sprintf("[%s] no lint command detected — skipped", repo.Name)
				if how != "" {
					msg = fmt.Sprintf("[%s] %s — skipped", repo.Name, how)
				}
				_ = r.appendLog(job, "linting", msg, "")
				continue
			}
			quality.LintRan = true
			_ = r.appendLog(job, "linting", fmt.Sprintf("[%s] running %s", repo.Name, how), "")
			if err != nil {
				lintFailed = true
				lintBuf.WriteString(fmt.Sprintf("[%s]\n%s\n", repo.Name, out))
				_ = r.appendLog(job, "linting", fmt.Sprintf("[%s] lint warnings (non-blocking): %v", repo.Name, err), truncate(out, 600))
			} else {
				_ = r.appendLog(job, "linting", fmt.Sprintf("[%s] lint ok", repo.Name), truncate(out, 400))
			}
		}
		quality.LintPassed = quality.LintRan && !lintFailed
		quality.LintOutput = truncate(lintBuf.String(), 2000)
	}

	if err := progress(pCommit, "committing", fmt.Sprintf("Committing %s...", title)); err != nil {
		return quality, err
	}
	for i, s := range sessions {
		relocated, err := gitx.EnforceFeatureBranch(s.MainPath, s.WTPath, s.Base, s.Branch, baseSHAs[i])
		if err != nil {
			return quality, fmt.Errorf("isolate branch %s: %w", s.Repo.Name, err)
		}
		if relocated {
			_ = r.appendLog(job, "committing", fmt.Sprintf("[%s] moved commits off %s onto %s and restored the base branch", s.Repo.Name, s.Base, s.Branch), "")
		}
	}
	for _, repo := range repos {
		dirty, err := gitx.IsDirty(repo.Path)
		if err != nil {
			return quality, fmt.Errorf("dirty check %s: %w", repo.Name, err)
		}
		if !dirty {
			_ = r.appendLog(job, "committing", fmt.Sprintf("[%s] nothing to commit for %s", repo.Name, title), "")
			continue
		}
		msg := fmt.Sprintf("feat: %s\n\nIssue: %s", title, issueShortID(issue.ID))
		if extra != "" {
			msg = fmt.Sprintf("feat: %s\n\nIssue: %s\nSub-requirement of %s.", title, issueShortID(issue.ID), issue.Title)
		}
		if err := gitx.CommitAll(repo.Path, msg); err != nil {
			return quality, fmt.Errorf("commit %s: %w", repo.Name, err)
		}
		_ = r.appendLog(job, "committing", fmt.Sprintf("[%s] committed %s", repo.Name, title), "")
	}
	if sessionID != "" {
		r.persistAgentSession(issue, sessionID)
	}
	return quality, nil
}

// withReviewFeedback appends in-review repair notes so Auto-Dev can fix code
// without rewriting the Dev Spec first.
func withReviewFeedback(issue *model.Issue, base string) string {
	fb := ""
	if issue != nil {
		fb = strings.TrimSpace(issue.ReviewFeedback)
	}
	if fb == "" {
		return base
	}
	part := "Reviewer rework feedback (fix these issues on the existing branch; do not unrelated refactors):\n" + fb
	if strings.TrimSpace(base) == "" {
		return part
	}
	return strings.TrimSpace(base) + "\n\n" + part
}

func issueShortID(issueID string) string {
	id := strings.TrimSpace(issueID)
	if len(id) > 8 {
		return id[len(id)-8:]
	}
	if id == "" {
		return "unknown"
	}
	return id
}

func (r *Runner) persistAgentSession(issue *model.Issue, sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if issue == nil || sessionID == "" || issue.AgentSessionID == sessionID {
		return
	}
	issue.AgentSessionID = sessionID
	issue.UpdatedAt = model.NowISO()
	_ = r.Store.UpsertIssue(*issue)
}
