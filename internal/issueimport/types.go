package issueimport

import (
	"context"
	"net/http"
	"net/url"
)

// FetchedIssue is the title/body extracted from an external host.
type FetchedIssue struct {
	Title        string
	Body         string
	CanonicalURL string
	Host         string
}

// Tokens are read-only host credentials used only for fetching private issues.
// They never switch a project's review mode.
type Tokens struct {
	GitHub string `json:"github,omitempty"`
	Gitee  string `json:"gitee,omitempty"`
	Linear string `json:"linear,omitempty"`
	// KeyConfigured / hints are filled on Public() responses only.
	GitHubConfigured bool   `json:"githubConfigured,omitempty"`
	GitHubHint       string `json:"githubHint,omitempty"`
	GiteeConfigured  bool   `json:"giteeConfigured,omitempty"`
	GiteeHint        string `json:"giteeHint,omitempty"`
	LinearConfigured bool   `json:"linearConfigured,omitempty"`
	LinearHint       string `json:"linearHint,omitempty"`
}

// Host recognizes a URL shape and fetches title/body. Additional hosts Register into the same importer.
type Host interface {
	Name() string
	// Match reports whether this host owns the URL (including PR URLs it will reject on Fetch).
	Match(u *url.URL) bool
	Fetch(ctx context.Context, u *url.URL, tokens Tokens, client *http.Client) (*FetchedIssue, error)
}
