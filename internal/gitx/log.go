package gitx

import (
	"fmt"
	"strings"
)

const maxRecentCommits = 50

// RepoCommit is one local git commit for the activity timeline.
type RepoCommit struct {
	RepoName string `json:"repoName"`
	Branch   string `json:"branch"`
	SHA      string `json:"sha"`
	Author   string `json:"author"`
	Time     string `json:"time"`
	Subject  string `json:"subject"`
}

// RecentCommits returns the newest local commits for a repo (HEAD history only, no remotes).
func RecentCommits(repoPath, repoName string, limit int) ([]RepoCommit, error) {
	repoPath = strings.TrimSpace(repoPath)
	if repoPath == "" {
		return nil, fmt.Errorf("repo path is required")
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > maxRecentCommits {
		limit = maxRecentCommits
	}
	if !HasCommits(repoPath) {
		return []RepoCommit{}, nil
	}
	branch, err := CurrentBranch(repoPath)
	if err != nil {
		branch = ""
	}
	if branch == "HEAD" {
		branch = ""
	}
	out, err := run(repoPath, "log", fmt.Sprintf("--max-count=%d", limit), "--format=%h%x1f%an%x1f%aI%x1f%s%x1e")
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(repoName)
	if name == "" {
		name = repoPath
	}
	var commits []RepoCommit
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimSpace(strings.Trim(rec, "\n"))
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\x1f", 4)
		if len(parts) < 4 {
			continue
		}
		commits = append(commits, RepoCommit{
			RepoName: name,
			Branch:   branch,
			SHA:      strings.TrimSpace(parts[0]),
			Author:   strings.TrimSpace(parts[1]),
			Time:     strings.TrimSpace(parts[2]),
			Subject:  strings.TrimSpace(parts[3]),
		})
	}
	return commits, nil
}
