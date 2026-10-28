package issueimport

import (
	"bytes"
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

// https://linear.app/<workspace>/issue/<TEAM-NUMBER> optional /slug
var linearIssuePath = regexp.MustCompile(`(?i)^/([^/]+)/issue/([A-Za-z0-9]+)-(\d+)(?:/[^/]*)?/?$`)

type LinearHost struct {
	APIURL string // default https://api.linear.app/graphql
}

func (h LinearHost) Name() string { return "Linear" }

func (h LinearHost) apiURL() string {
	if strings.TrimSpace(h.APIURL) == "" {
		return "https://api.linear.app/graphql"
	}
	return h.APIURL
}

func (h LinearHost) Match(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	if host != "linear.app" && host != "www.linear.app" {
		return false
	}
	return linearIssuePath.MatchString(u.EscapedPath())
}

func (h LinearHost) Fetch(ctx context.Context, u *url.URL, tokens Tokens, client *http.Client) (*FetchedIssue, error) {
	m := linearIssuePath.FindStringSubmatch(u.EscapedPath())
	if m == nil {
		return nil, errNotAnIssue("Linear", "expected /workspace/issue/TEAM-NUMBER")
	}
	workspace, teamKey, numStr := m[1], strings.ToUpper(m[2]), m[3]
	number, err := strconv.Atoi(numStr)
	if err != nil {
		return nil, errNotAnIssue("Linear", "invalid issue number")
	}
	tok := strings.TrimSpace(tokens.Linear)
	if tok == "" {
		return nil, errNeedsToken("Linear")
	}
	query := `query($team: String!, $number: Float!) {
  issues(filter: { team: { key: { eq: $team } }, number: { eq: $number } }, first: 1) {
    nodes { title description url identifier }
  }
}`
	payload := map[string]any{
		"query": query,
		"variables": map[string]any{
			"team":   teamKey,
			"number": number,
		},
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.apiURL(), bytes.NewReader(raw))
	if err != nil {
		return nil, errFetch("Linear", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", tok)
	res, err := client.Do(req)
	if err != nil {
		return nil, errFetch("Linear", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return nil, errNeedsToken("Linear")
	}
	if res.StatusCode >= 300 {
		return nil, errFetch("Linear", fmt.Errorf("HTTP %d: %s", res.StatusCode, truncate(string(body), 200)))
	}
	var resp struct {
		Data struct {
			Issues struct {
				Nodes []struct {
					Title       string `json:"title"`
					Description string `json:"description"`
					URL         string `json:"url"`
					Identifier  string `json:"identifier"`
				} `json:"nodes"`
			} `json:"issues"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, errFetch("Linear", err)
	}
	if len(resp.Errors) > 0 {
		msg := resp.Errors[0].Message
		low := strings.ToLower(msg)
		if strings.Contains(low, "auth") || strings.Contains(low, "permission") || strings.Contains(low, "unauthorized") {
			return nil, errNeedsToken("Linear")
		}
		return nil, errFetch("Linear", fmt.Errorf("%s", msg))
	}
	if len(resp.Data.Issues.Nodes) == 0 {
		return nil, errNeedsToken("Linear")
	}
	iss := resp.Data.Issues.Nodes[0]
	canonical := iss.URL
	if strings.TrimSpace(canonical) == "" {
		id := iss.Identifier
		if id == "" {
			id = fmt.Sprintf("%s-%d", teamKey, number)
		}
		canonical = fmt.Sprintf("https://linear.app/%s/issue/%s", workspace, id)
	}
	return &FetchedIssue{
		Title:        strings.TrimSpace(iss.Title),
		Body:         strings.TrimSpace(iss.Description),
		CanonicalURL: canonical,
		Host:         "Linear",
	}, nil
}
