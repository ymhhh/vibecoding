package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestModelsURLDerivation(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/models"},
		{"https://api.deepseek.com/v1/chat/completions/", "https://api.deepseek.com/v1/models"},
		{"https://api.openai.com/v1/completions", "https://api.openai.com/v1/models"},
		{"https://api.openai.com/v1/responses", "https://api.openai.com/v1/models"},
		{"https://api.openai.com/v1/responses/", "https://api.openai.com/v1/models"},
		{"https://api.openai.com/v1/models", "https://api.openai.com/v1/models"},
		{"https://gw.example.com/openai", "https://gw.example.com/openai/models"},
		{"  https://api.openai.com/v1/chat/completions  ", "https://api.openai.com/v1/models"},
	}
	for _, c := range cases {
		got, err := modelsURL(c.in)
		if err != nil {
			t.Fatalf("modelsURL(%q): %v", c.in, err)
		}
		if got != c.want {
			t.Fatalf("modelsURL(%q)=%q want %q", c.in, got, c.want)
		}
	}
	if _, err := modelsURL(""); err == nil {
		t.Fatal("empty base URL should error")
	}
}

func TestListOpenAIModels(t *testing.T) {
	var gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"b-model"},{"id":"a-model"},{"id":"a-model"},{"id":""},{"id":"c-model"}]}`))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	models, err := client.ListOpenAIModels(context.Background(), srv.URL+"/v1/chat/completions", "sk-test")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/models" {
		t.Fatalf("requested path=%q want /v1/models", gotPath)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("auth header=%q", gotAuth)
	}
	want := []string{"a-model", "b-model", "c-model"}
	if len(models) != len(want) {
		t.Fatalf("models=%v want %v", models, want)
	}
	for i := range want {
		if models[i] != want[i] {
			t.Fatalf("models=%v want %v", models, want)
		}
	}
}

func TestListOpenAIModelsErrors(t *testing.T) {
	client := &Client{HTTP: &http.Client{}}

	// missing key
	if _, err := client.ListOpenAIModels(context.Background(), "https://api.openai.com/v1/chat/completions", " "); err == nil {
		t.Fatal("blank key should error")
	}
	// bad URL
	if _, err := client.ListOpenAIModels(context.Background(), "ftp://x", "k"); err == nil {
		t.Fatal("invalid scheme should error")
	}

	// non-200 upstream
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":"bad key"}`))
	}))
	defer srv.Close()
	if _, err := client.ListOpenAIModels(context.Background(), srv.URL, "k"); err == nil {
		t.Fatal("401 should error")
	}

	// empty list
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer srv2.Close()
	if _, err := client.ListOpenAIModels(context.Background(), srv2.URL, "k"); err == nil {
		t.Fatal("empty data should error")
	}
}
