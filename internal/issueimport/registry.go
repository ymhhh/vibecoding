package issueimport

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var (
	regMu sync.RWMutex
	hosts []Host
)

// Register adds a host parser to the shared importer. Extra hosts plug in here
// instead of growing a separate create flow.
func Register(h Host) {
	if h == nil {
		return
	}
	regMu.Lock()
	defer regMu.Unlock()
	hosts = append(hosts, h)
}

// Hosts returns a snapshot of registered parsers (for tests).
func Hosts() []Host {
	regMu.RLock()
	defer regMu.RUnlock()
	out := make([]Host, len(hosts))
	copy(out, hosts)
	return out
}

// ResetHosts clears the registry (tests only).
func ResetHosts() {
	regMu.Lock()
	hosts = nil
	regMu.Unlock()
}

// ParseURL normalizes and parses a raw issue link.
func ParseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errInvalidURL("url required")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, errInvalidURL("invalid issue URL")
	}
	u.Fragment = ""
	return u, nil
}

// CanonicalSourceURL returns a stable form for duplicate detection.
func CanonicalSourceURL(raw string) string {
	u, err := ParseURL(raw)
	if err != nil {
		return strings.TrimSpace(raw)
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimSuffix(u.Path, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// Import finds a matching host parser and fetches the external issue.
func Import(ctx context.Context, rawURL string, tokens Tokens, client *http.Client) (*FetchedIssue, error) {
	u, err := ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	regMu.RLock()
	snapshot := append([]Host(nil), hosts...)
	regMu.RUnlock()

	var matched Host
	for _, h := range snapshot {
		if h.Match(u) {
			matched = h
			break
		}
	}
	if matched == nil {
		return nil, errUnsupported(u.String())
	}
	got, err := matched.Fetch(ctx, u, tokens, client)
	if err != nil {
		return nil, err
	}
	if got == nil {
		return nil, errFetch(matched.Name(), fmtErr("empty fetch result"))
	}
	if strings.TrimSpace(got.CanonicalURL) == "" {
		got.CanonicalURL = CanonicalSourceURL(u.String())
	} else {
		got.CanonicalURL = CanonicalSourceURL(got.CanonicalURL)
	}
	if got.Host == "" {
		got.Host = matched.Name()
	}
	return got, nil
}

type plainErr string

func (e plainErr) Error() string { return string(e) }

func fmtErr(s string) error { return plainErr(s) }
