package issueimport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var githubIssuePath = regexp.MustCompile(`(?i)^/([^/]+)/([^/]+)/issues/(\d+)/?$`)
var githubPullPath = regexp.MustCompile(`(?i)^/([^/]+)/([^/]+)/pulls?/\d+/?$`)

type GitHubHost struct {
	APIBase string // default https://api.github.com
}

func (h GitHubHost) Name() string { return "GitHub" }

func (h GitHubHost) apiBase() string {
	if strings.TrimSpace(h.APIBase) == "" {
		return "https://api.github.com"
	}
	return strings.TrimRight(h.APIBase, "/")
}

func (h GitHubHost) Match(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	if host != "github.com" && host != "www.github.com" {
		return false
	}
	path := u.EscapedPath()
	return githubIssuePath.MatchString(path) || githubPullPath.MatchString(path)
}

func (h GitHubHost) Fetch(ctx context.Context, u *url.URL, tokens Tokens, client *http.Client) (*FetchedIssue, error) {
	path := u.EscapedPath()
	if githubPullPath.MatchString(path) {
		return nil, errNotAnIssue("GitHub", "a pull-request URL is not an issue import")
	}
	m := githubIssuePath.FindStringSubmatch(path)
	if m == nil {
		return nil, errNotAnIssue("GitHub", "expected /owner/repo/issues/N")
	}
	owner, repo, num := m[1], m[2], m[3]
	apiURL := fmt.Sprintf("%s/repos/%s/%s/issues/%s", h.apiBase(), url.PathEscape(owner), url.PathEscape(repo), num)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, errFetch("GitHub", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "vibecoding-issue-import")
	if tok := strings.TrimSpace(tokens.GitHub); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, errFetch("GitHub", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		if strings.TrimSpace(tokens.GitHub) == "" {
			return nil, errNeedsToken("GitHub")
		}
		return nil, errFetch("GitHub", fmt.Errorf("HTTP %d", res.StatusCode))
	}
	if res.StatusCode >= 300 {
		return nil, errFetch("GitHub", fmt.Errorf("HTTP %d: %s", res.StatusCode, truncate(string(body), 200)))
	}
	var payload struct {
		Title        string          `json:"title"`
		Body         string          `json:"body"`
		HTMLURL      string          `json:"html_url"`
		PullRequest  json.RawMessage `json:"pull_request"`
		Number       int             `json:"number"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errFetch("GitHub", err)
	}
	if len(payload.PullRequest) > 0 && string(payload.PullRequest) != "null" {
		return nil, errNotAnIssue("GitHub", "a pull-request URL is not an issue import")
	}
	n := payload.Number
	if n == 0 {
		n, _ = strconv.Atoi(num)
	}
	canonical := payload.HTMLURL
	if strings.TrimSpace(canonical) == "" {
		canonical = fmt.Sprintf("https://github.com/%s/%s/issues/%d", owner, repo, n)
	}
	return &FetchedIssue{
		Title:        strings.TrimSpace(payload.Title),
		Body:         strings.TrimSpace(payload.Body),
		CanonicalURL: canonical,
		Host:         "GitHub",
	}, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
