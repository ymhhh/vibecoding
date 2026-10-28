package issueimport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestUnsupportedHost(t *testing.T) {
	ResetHosts()
	t.Cleanup(func() {
		ResetHosts()
		Register(GitHubHost{})
		Register(GiteeHost{})
		Register(LinearHost{})
	})
	Register(GitHubHost{})
	_, err := Import(context.Background(), "https://example.com/x/y/issues/1", Tokens{}, nil)
	ie, ok := err.(*Error)
	if !ok || ie.Code != "unsupported_host" {
		t.Fatalf("got %#v", err)
	}
}

func TestRegisterAdditionalHost(t *testing.T) {
	ResetHosts()
	t.Cleanup(func() {
		ResetHosts()
		Register(GitHubHost{})
		Register(GiteeHost{})
		Register(LinearHost{})
	})
	Register(fakeHost{})
	got, err := Import(context.Background(), "https://forge.example/a/b/issues/9", Tokens{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "From fake" || got.Host != "fake" {
		t.Fatalf("%+v", got)
	}
}

type fakeHost struct{}

func (fakeHost) Name() string { return "fake" }
func (fakeHost) Match(u *url.URL) bool {
	return strings.Contains(u.Host, "forge.example")
}
func (fakeHost) Fetch(ctx context.Context, u *url.URL, tokens Tokens, client *http.Client) (*FetchedIssue, error) {
	return &FetchedIssue{Title: "From fake", Body: "body", CanonicalURL: u.String(), Host: "fake"}, nil
}

func TestGitHubPublicIssue(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/r/issues/12" {
			t.Fatalf("path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"title": "GH title", "body": "GH body",
			"html_url": "https://github.com/o/r/issues/12", "number": 12,
		})
	}))
	defer srv.Close()
	h := GitHubHost{APIBase: srv.URL}
	u, _ := url.Parse("https://github.com/o/r/issues/12")
	got, err := h.Fetch(context.Background(), u, Tokens{}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "GH title" || got.Body != "GH body" {
		t.Fatalf("%+v", got)
	}
}

func TestGitHubRejectsPullURL(t *testing.T) {
	h := GitHubHost{}
	u, _ := url.Parse("https://github.com/o/r/pull/3")
	if !h.Match(u) {
		t.Fatal("should match PR path to reject it")
	}
	_, err := h.Fetch(context.Background(), u, Tokens{}, http.DefaultClient)
	ie, ok := err.(*Error)
	if !ok || ie.Code != "not_an_issue" {
		t.Fatalf("got %#v", err)
	}
}

func TestGitHubNeedsTokenWhenPrivate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	h := GitHubHost{APIBase: srv.URL}
	u, _ := url.Parse("https://github.com/o/r/issues/1")
	_, err := h.Fetch(context.Background(), u, Tokens{}, srv.Client())
	ie, ok := err.(*Error)
	if !ok || ie.Code != "needs_token" {
		t.Fatalf("got %#v", err)
	}
}

func TestGiteePublicIssue(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"title": "Gitee title", "body": "Gitee body",
			"html_url": "https://gitee.com/o/r/issues/I1", "number": "I1",
		})
	}))
	defer srv.Close()
	h := GiteeHost{APIBase: srv.URL}
	u, _ := url.Parse("https://gitee.com/o/r/issues/I1")
	got, err := h.Fetch(context.Background(), u, Tokens{}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Gitee title" {
		t.Fatalf("%+v", got)
	}
}

func TestGiteeRejectsPull(t *testing.T) {
	h := GiteeHost{}
	u, _ := url.Parse("https://gitee.com/o/r/pulls/2")
	_, err := h.Fetch(context.Background(), u, Tokens{}, http.DefaultClient)
	ie, ok := err.(*Error)
	if !ok || ie.Code != "not_an_issue" {
		t.Fatalf("got %#v", err)
	}
}

func TestLinearNeedsToken(t *testing.T) {
	h := LinearHost{}
	u, _ := url.Parse("https://linear.app/acme/issue/ENG-42/slug")
	_, err := h.Fetch(context.Background(), u, Tokens{}, http.DefaultClient)
	ie, ok := err.(*Error)
	if !ok || ie.Code != "needs_token" {
		t.Fatalf("got %#v", err)
	}
}

func TestLinearFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Fatal("missing auth")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"title": "Lin title", "description": "Lin body",
						"url": "https://linear.app/acme/issue/ENG-42", "identifier": "ENG-42",
					}},
				},
			},
		})
	}))
	defer srv.Close()
	h := LinearHost{APIURL: srv.URL}
	u, _ := url.Parse("https://linear.app/acme/issue/ENG-42")
	got, err := h.Fetch(context.Background(), u, Tokens{Linear: "lin_key"}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Lin title" || got.CanonicalURL == "" {
		t.Fatalf("%+v", got)
	}
}
