package issueimport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var giteeIssuePath = regexp.MustCompile(`(?i)^/([^/]+)/([^/]+)/issues/([^/]+)/?$`)
var giteePullPath = regexp.MustCompile(`(?i)^/([^/]+)/([^/]+)/pulls?/\d+/?$`)

type GiteeHost struct {
	APIBase string // default https://gitee.com/api/v5
}

func (h GiteeHost) Name() string { return "Gitee" }

func (h GiteeHost) apiBase() string {
	if strings.TrimSpace(h.APIBase) == "" {
		return "https://gitee.com/api/v5"
	}
	return strings.TrimRight(h.APIBase, "/")
}

func (h GiteeHost) Match(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	if host != "gitee.com" && host != "www.gitee.com" {
		return false
	}
	path := u.EscapedPath()
	return giteeIssuePath.MatchString(path) || giteePullPath.MatchString(path)
}

func (h GiteeHost) Fetch(ctx context.Context, u *url.URL, tokens Tokens, client *http.Client) (*FetchedIssue, error) {
	path := u.EscapedPath()
	if giteePullPath.MatchString(path) {
		return nil, errNotAnIssue("Gitee", "a pull-request URL is not an issue import")
	}
	m := giteeIssuePath.FindStringSubmatch(path)
	if m == nil {
		return nil, errNotAnIssue("Gitee", "expected /owner/repo/issues/<number>")
	}
	owner, repo, number := m[1], m[2], m[3]
	apiURL := fmt.Sprintf("%s/repos/%s/%s/issues/%s", h.apiBase(), url.PathEscape(owner), url.PathEscape(repo), url.PathEscape(number))
	if tok := strings.TrimSpace(tokens.Gitee); tok != "" {
		apiURL += "?access_token=" + url.QueryEscape(tok)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, errFetch("Gitee", err)
	}
	req.Header.Set("User-Agent", "vibecoding-issue-import")
	res, err := client.Do(req)
	if err != nil {
		return nil, errFetch("Gitee", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		if strings.TrimSpace(tokens.Gitee) == "" {
			return nil, errNeedsToken("Gitee")
		}
		return nil, errFetch("Gitee", fmt.Errorf("HTTP %d", res.StatusCode))
	}
	if res.StatusCode >= 300 {
		return nil, errFetch("Gitee", fmt.Errorf("HTTP %d: %s", res.StatusCode, truncate(string(body), 200)))
	}
	var payload struct {
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		Number  string `json:"number"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errFetch("Gitee", err)
	}
	canonical := payload.HTMLURL
	if strings.TrimSpace(canonical) == "" {
		n := payload.Number
		if n == "" {
			n = number
		}
		canonical = fmt.Sprintf("https://gitee.com/%s/%s/issues/%s", owner, repo, n)
	}
	return &FetchedIssue{
		Title:        strings.TrimSpace(payload.Title),
		Body:         strings.TrimSpace(payload.Body),
		CanonicalURL: canonical,
		Host:         "Gitee",
	}, nil
}
