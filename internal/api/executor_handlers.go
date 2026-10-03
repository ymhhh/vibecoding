package api

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/executor"
	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Server) handleGetExecutor(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Store.GetExecutorConfig()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, cfg.Normalize())
}

func (s *Server) handlePutExecutor(w http.ResponseWriter, r *http.Request) {
	var cfg model.ExecutorConfig
	if err := decodeJSON(r, &cfg); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	cfg = cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := s.Store.PutExecutorConfig(cfg); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	saved, _ := s.Store.GetExecutorConfig()
	writeJSON(w, 200, saved)
}

func (s *Server) handleListExecutors(w http.ResponseWriter, r *http.Request) {
	mc, _ := s.Store.GetModelConfig()
	configured, _ := model.MaskKey(mc.OpenAIAPIKey)
	writeJSON(w, 200, map[string]any{
		"executors": executor.Probe(executor.ProbeOptions{LLMConfigured: configured}),
		"current":   executor.DisplayName(mustExecutorConfig(s)),
	})
}

func mustExecutorConfig(s *Server) model.ExecutorConfig {
	cfg, _ := s.Store.GetExecutorConfig()
	return cfg.Normalize()
}

type issueDiffResponse struct {
	IssueID    string             `json:"issueId"`
	BranchName string             `json:"branchName"`
	BaseBranch string             `json:"baseBranch,omitempty"`
	Executor   string             `json:"executor,omitempty"`
	Quality    *model.QualityGate `json:"quality,omitempty"`
	Repos      []repoDiff         `json:"repos"`
}

type repoDiff struct {
	RepoID     string            `json:"repoId"`
	RepoName   string            `json:"repoName"`
	BaseBranch string            `json:"baseBranch"`
	Stats      model.DiffStats   `json:"stats"`
	Ahead      int               `json:"ahead"`
	Behind     int               `json:"behind"`
	Files      []gitx.DiffFile   `json:"files"`
	Commits    []gitx.DiffCommit `json:"commits"`
	Error      string            `json:"error,omitempty"`
}

func (s *Server) handleIssueDiff(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	if issue.PRInfo == nil || strings.TrimSpace(issue.PRInfo.BranchName) == "" {
		writeErr(w, 400, "issue has no Auto-Dev branch yet")
		return
	}
	proj, err := s.Store.GetProject(issue.ProjectID)
	if err != nil || proj == nil {
		writeErr(w, 404, "project not found")
		return
	}
	resp := issueDiffResponse{
		IssueID:    issue.ID,
		BranchName: issue.PRInfo.BranchName,
		BaseBranch: issue.PRInfo.BaseBranch,
		Executor:   issue.PRInfo.Executor,
		Quality:    issue.PRInfo.Quality,
	}
	repoBases := parseRepoBases(r)
	singleBase := ""
	if len(issue.AssociatedRepoIDs) == 1 {
		singleBase = gitx.SanitizeBranchName(r.URL.Query().Get("base"))
		if singleBase != "" {
			resp.BaseBranch = singleBase
		}
	}
	for _, rid := range issue.AssociatedRepoIDs {
		for _, gr := range proj.GitRepos {
			if gr.ID != rid {
				continue
			}
			base := repoBases[gr.ID]
			if base == "" {
				base = singleBase
			}
			if base == "" {
				base = issue.PRInfo.BaseBranch
			}
			if base == "" {
				base = gr.DefaultBranch
			}
			rd := repoDiff{
				RepoID:     gr.ID,
				RepoName:   gr.Name,
				BaseBranch: base,
			}
			if base != "" {
				ok, err := localBranchExists(gr.Path, base)
				if err != nil {
					rd.Error = err.Error()
					resp.Repos = append(resp.Repos, rd)
					continue
				}
				if !ok {
					rd.Error = fmt.Sprintf("branch %q does not exist", base)
					resp.Repos = append(resp.Repos, rd)
					continue
				}
			}
			stats, files, commits, ahead, behind, derr := gitx.DiffBetween(gr.Path, base, issue.PRInfo.BranchName)
			rd.Stats = stats
			rd.Ahead = ahead
			rd.Behind = behind
			rd.Files = files
			rd.Commits = commits
			if derr != nil {
				rd.Error = derr.Error()
			}
			resp.Repos = append(resp.Repos, rd)
		}
	}
	writeJSON(w, 200, resp)
}

// parseRepoBases reads repeated repoBase=repoId:branch query values.
// A value applies only to that repo.
func parseRepoBases(r *http.Request) map[string]string {
	out := map[string]string{}
	for _, raw := range r.URL.Query()["repoBase"] {
		repoID, branch, ok := strings.Cut(raw, ":")
		repoID = strings.TrimSpace(repoID)
		branch = gitx.SanitizeBranchName(branch)
		if !ok || repoID == "" || branch == "" {
			continue
		}
		out[repoID] = branch
	}
	return out
}

func localBranchExists(dir, name string) (bool, error) {
	names, err := gitx.ListLocalBranches(dir)
	if err != nil {
		return false, err
	}
	for _, n := range names {
		if n == name {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) handleIssueRebase(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	switch issue.Status {
	case model.StatusInReview, model.StatusBacklog:
	default:
		writeErr(w, 400, "rebase is only available in review or backlog")
		return
	}
	if issue.PRInfo == nil || strings.TrimSpace(issue.PRInfo.BranchName) == "" {
		writeErr(w, 400, "issue has no Auto-Dev branch yet")
		return
	}
	if len(issue.PRInfo.Worktrees) == 0 {
		writeErr(w, 400, "no worktree available; run Auto-Dev first")
		return
	}
	var body struct {
		RepoID string `json:"repoId"`
		Base   string `json:"base"`
	}
	_ = decodeJSON(r, &body)
	base := strings.TrimSpace(issue.PRInfo.BaseBranch)
	repoID := strings.TrimSpace(body.RepoID)
	repoBase := gitx.SanitizeBranchName(body.Base)
	type repoResult struct {
		RepoID   string `json:"repoId"`
		RepoName string `json:"repoName"`
		Ahead    int    `json:"ahead"`
		Behind   int    `json:"behind"`
		Error    string `json:"error,omitempty"`
	}
	var results []repoResult
	matched := repoID == ""
	for _, wt := range issue.PRInfo.Worktrees {
		if repoID != "" && wt.RepoID != repoID {
			continue
		}
		matched = true
		if st, err := os.Stat(wt.Path); err != nil || !st.IsDir() {
			results = append(results, repoResult{RepoID: wt.RepoID, RepoName: wt.RepoName, Error: "worktree missing"})
			continue
		}
		wtBase := base
		if repoID != "" && repoBase != "" {
			wtBase = repoBase
		}
		if wtBase == "" {
			wtBase = "HEAD"
		}
		if wtBase != "HEAD" {
			ok, err := localBranchExists(wt.Path, wtBase)
			if err != nil {
				writeErr(w, 400, fmt.Sprintf("%s: %v", wt.RepoName, err))
				return
			}
			if !ok {
				writeErr(w, 400, fmt.Sprintf("%s: branch %q does not exist", wt.RepoName, wtBase))
				return
			}
		}
		if err := gitx.RebaseOnto(wt.Path, wtBase); err != nil {
			var conflict *gitx.RebaseConflictError
			if errors.As(err, &conflict) {
				writeJSON(w, 400, map[string]any{
					"error":     conflict.Error(),
					"conflicts": conflict.Files,
					"repoId":    wt.RepoID,
					"repoName":  wt.RepoName,
				})
				return
			}
			writeErr(w, 400, fmt.Sprintf("%s: %v", wt.RepoName, err))
			return
		}
		_, _, _, ahead, behind, _ := gitx.DiffBetween(wt.Path, wtBase, "HEAD")
		results = append(results, repoResult{RepoID: wt.RepoID, RepoName: wt.RepoName, Ahead: ahead, Behind: behind})
	}
	if !matched {
		writeErr(w, 400, "repoId not found in worktrees")
		return
	}
	respBase := base
	if repoID != "" && repoBase != "" {
		respBase = repoBase
	}
	writeJSON(w, 200, map[string]any{"ok": true, "baseBranch": respBase, "repos": results})
}

func (s *Server) handleIssuePublishRemote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	switch issue.Status {
	case model.StatusInReview, model.StatusBacklog:
	default:
		writeErr(w, 400, "publish is only available in review or backlog")
		return
	}
	if issue.PRInfo == nil || strings.TrimSpace(issue.PRInfo.BranchName) == "" {
		writeErr(w, 400, "issue has no Auto-Dev branch yet")
		return
	}
	if len(issue.PRInfo.Worktrees) == 0 {
		writeErr(w, 400, "no worktree available; run Auto-Dev first")
		return
	}
	branch := issue.PRInfo.BranchName
	base := issue.PRInfo.BaseBranch
	title := issue.PRInfo.Title
	if strings.TrimSpace(title) == "" {
		title = issue.Title
	}
	body := issue.PRInfo.Description
	var warnings []string
	pushed := 0
	prURL := ""
	for _, wt := range issue.PRInfo.Worktrees {
		if st, err := os.Stat(wt.Path); err != nil || !st.IsDir() {
			warnings = append(warnings, wt.RepoName+": worktree missing")
			continue
		}
		if !gitx.HasOrigin(wt.Path) {
			warnings = append(warnings, wt.RepoName+": no origin remote")
			continue
		}
		if err := gitx.PushOrigin(wt.Path, branch); err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: push failed: %v", wt.RepoName, err))
			continue
		}
		pushed++
		if prURL == "" {
			url, err := createGitHubPR(wt.Path, firstNonEmptyAPI(base, "main"), branch, title, body)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("%s: gh pr: %v", wt.RepoName, err))
			} else {
				prURL = url
			}
		}
	}
	if pushed == 0 && prURL == "" {
		msg := "nothing published"
		if len(warnings) > 0 {
			msg = strings.Join(warnings, "; ")
		}
		writeJSON(w, 200, map[string]any{"ok": false, "warnings": warnings, "error": msg, "issue": issue})
		return
	}
	if issue.PRInfo != nil && prURL != "" {
		issue.PRInfo.RemoteURL = prURL
	}
	issue.AutoDevLogs = append(issue.AutoDevLogs, model.AutoDevLog{
		ID:        "log-" + uuid.NewString()[:8],
		Timestamp: time.Now().Format("15:04:05"),
		Phase:     "completed",
		Message:   fmt.Sprintf("Published to origin (%d repo(s))%s", pushed, publishSuffix(prURL)),
	})
	issue.UpdatedAt = model.NowISO()
	_ = s.Store.UpsertIssue(*issue)
	writeJSON(w, 200, map[string]any{
		"ok":       true,
		"pushed":   pushed,
		"prUrl":    prURL,
		"warnings": warnings,
		"issue":    issue,
	})
}

func publishSuffix(prURL string) string {
	if strings.TrimSpace(prURL) == "" {
		return ""
	}
	return "; PR " + prURL
}

func firstNonEmptyAPI(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func createGitHubPR(dir, base, head, title, body string) (string, error) {
	if _, err := exec.LookPath("gh"); err != nil {
		return "", fmt.Errorf("gh CLI not found on PATH")
	}
	cmd := exec.Command("gh", "pr", "create", "--base", base, "--head", head, "--title", title, "--body", body)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s == "" {
			s = err.Error()
		}
		return "", fmt.Errorf("%s", s)
	}
	lines := strings.Split(s, "\n")
	return strings.TrimSpace(lines[len(lines)-1]), nil
}

type openEditorBody struct {
	App    string `json:"app"` // cursor | vscode
	RepoID string `json:"repoId,omitempty"`
}

func (s *Server) handleOpenEditor(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	if issue.PRInfo == nil || len(issue.PRInfo.Worktrees) == 0 {
		writeErr(w, 400, "no worktree available; run Auto-Dev first")
		return
	}
	var body openEditorBody
	_ = decodeJSON(r, &body)
	app := strings.ToLower(strings.TrimSpace(body.App))
	if app == "" {
		app = "cursor"
	}
	bin := ""
	switch app {
	case "cursor":
		bin = "cursor"
	case "vscode", "code":
		bin = "code"
		app = "vscode"
	default:
		writeErr(w, 400, "app must be cursor or vscode")
		return
	}
	if _, err := exec.LookPath(bin); err != nil {
		writeErr(w, 400, fmt.Sprintf("%s CLI not found on PATH", bin))
		return
	}
	target := issue.PRInfo.Worktrees[0]
	if body.RepoID != "" {
		found := false
		for _, wt := range issue.PRInfo.Worktrees {
			if wt.RepoID == body.RepoID {
				target = wt
				found = true
				break
			}
		}
		if !found {
			writeErr(w, 400, "repoId not found in worktrees")
			return
		}
	}
	if st, err := os.Stat(target.Path); err != nil || !st.IsDir() {
		writeErr(w, 400, "worktree path missing on disk")
		return
	}
	cmd := exec.Command(bin, target.Path)
	if err := cmd.Start(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = cmd.Process.Release()
	writeJSON(w, 200, map[string]any{"ok": true, "app": app, "path": target.Path})
}

// approveMergeSafe merges via MergeBranchAt and cleans worktrees.
// targets maps repo ID to that repo's merge branch. fallback is the legacy
// single targetBranch, used only when a repo has no entry of its own.
func (s *Server) approveMergeSafe(issue *model.Issue, repos []model.GitRepo, targets map[string]string, fallback string) error {
	branch := issue.PRInfo.BranchName
	var merged []string
	same := ""
	allSame := true
	for _, repo := range repos {
		base := gitx.SanitizeBranchName(targets[repo.ID])
		if base == "" {
			base = gitx.SanitizeBranchName(fallback)
		}
		if base == "" {
			base = issue.PRInfo.BaseBranch
		}
		if base == "" {
			base = repo.DefaultBranch
		}
		if base == "" {
			return fmt.Errorf("%s: merge target branch required", repo.Name)
		}
		if base == branch {
			return fmt.Errorf("%s: cannot merge %s into itself", repo.Name, branch)
		}
		ok, err := localBranchExists(repo.Path, base)
		if err != nil {
			return fmt.Errorf("%s: %w", repo.Name, err)
		}
		if !ok {
			return fmt.Errorf("%s: branch %q does not exist", repo.Name, base)
		}
		if err := gitx.MergeBranchAt(repo.Path, base, branch); err != nil {
			return fmt.Errorf("%s: %w", repo.Name, err)
		}
		merged = append(merged, repo.Name+":"+base)
		if same == "" {
			same = base
		} else if same != base {
			allSame = false
		}
	}
	for _, wt := range issue.PRInfo.Worktrees {
		for _, repo := range repos {
			if repo.ID == wt.RepoID || repo.Name == wt.RepoName {
				_ = gitx.RemoveWorktree(repo.Path, wt.Path)
			}
		}
	}
	issue.PRInfo.Worktrees = nil
	issue.PRInfo.Status = "merged"
	into := ""
	if allSame && same != "" {
		issue.PRInfo.BaseBranch = same
		into = same
	} else if len(merged) > 0 {
		into = strings.Join(merged, ", ")
	}
	if into == "" {
		into = "target branch"
	}
	issue.Status = model.StatusCompleted
	issue.AutoDevLogs = append(issue.AutoDevLogs, model.AutoDevLog{
		ID:        "log-" + uuid.NewString()[:8],
		Timestamp: time.Now().Format("15:04:05"),
		Phase:     "completed",
		Message:   fmt.Sprintf("Developer approved; merged into %s (worktrees removed).", into),
	})
	issue.UpdatedAt = model.NowISO()
	return s.Store.UpsertIssue(*issue)
}

func (s *Server) handleIssueBranches(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	proj, err := s.Store.GetProject(issue.ProjectID)
	if err != nil || proj == nil {
		writeErr(w, 404, "project not found")
		return
	}
	feature := ""
	if issue.PRInfo != nil {
		feature = issue.PRInfo.BranchName
	}
	type repoBranches struct {
		RepoID   string   `json:"repoId"`
		RepoName string   `json:"repoName"`
		Default  string   `json:"default"`
		Branches []string `json:"branches"`
	}
	var repos []repoBranches
	for _, rid := range issue.AssociatedRepoIDs {
		for _, gr := range proj.GitRepos {
			if gr.ID != rid {
				continue
			}
			names, err := gitx.ListLocalBranches(gr.Path)
			if err != nil {
				writeErr(w, 500, fmt.Sprintf("%s: %v", gr.Name, err))
				return
			}
			var branches []string
			for _, n := range names {
				if n == feature {
					continue
				}
				branches = append(branches, n)
			}
			if branches == nil {
				branches = []string{}
			}
			def := gr.DefaultBranch
			if def == "" && issue.PRInfo != nil {
				def = issue.PRInfo.BaseBranch
			}
			repos = append(repos, repoBranches{
				RepoID:   gr.ID,
				RepoName: gr.Name,
				Default:  def,
				Branches: branches,
			})
		}
	}
	resp := map[string]any{
		"repos":   repos,
		"feature": feature,
	}
	if len(repos) == 1 {
		resp["branches"] = repos[0].Branches
		resp["default"] = repos[0].Default
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handleApproveMerge(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	issue, err := s.Store.GetIssue(id)
	if err != nil || issue == nil {
		writeErr(w, 404, "issue not found")
		return
	}
	if issue.PRInfo == nil || issue.PRInfo.BranchName == "" {
		writeErr(w, 400, "no PR/branch to merge")
		return
	}
	var body struct {
		TargetBranch string `json:"targetBranch"`
		Targets      []struct {
			RepoID string `json:"repoId"`
			Branch string `json:"branch"`
		} `json:"targets"`
	}
	_ = decodeJSON(r, &body)
	targets := map[string]string{}
	for _, t := range body.Targets {
		id := strings.TrimSpace(t.RepoID)
		br := gitx.SanitizeBranchName(t.Branch)
		if id != "" && br != "" {
			targets[id] = br
		}
	}
	proj, err := s.Store.GetProject(issue.ProjectID)
	if err != nil || proj == nil {
		writeErr(w, 404, "project not found")
		return
	}
	var repos []model.GitRepo
	for _, rid := range issue.AssociatedRepoIDs {
		for _, gr := range proj.GitRepos {
			if gr.ID == rid {
				repos = append(repos, gr)
			}
		}
	}
	if err := s.approveMergeSafe(issue, repos, targets, body.TargetBranch); err != nil {
		// Dirty default branch / merge conflicts surface as 409-ish client errors.
		msg := err.Error()
		status := 500
		if strings.Contains(msg, "uncommitted changes") {
			status = 409
		}
		if strings.Contains(msg, "does not exist") {
			status = 400
		}
		writeErr(w, status, msg)
		return
	}
	writeJSON(w, 200, issue)
}
