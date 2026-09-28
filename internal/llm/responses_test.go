package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"
)

func decodeBody(r *http.Request, dest *map[string]any) error {
	return json.NewDecoder(r.Body).Decode(dest)
}

func TestEffectiveAPIProtocol(t *testing.T) {
	cases := []struct {
		protocol, url, want string
	}{
		// Stored value wins.
		{"responses", "https://api.openai.com/v1/chat/completions", model.APIProtocolResponses},
		{"chat_completions", "https://api.openai.com/v1/responses", model.APIProtocolChatCompletions},
		// URL inference when unset / unknown.
		{"", "https://api.openai.com/v1/responses", model.APIProtocolResponses},
		{"bogus", "https://api.openai.com/v1/responses/", model.APIProtocolResponses},
		{"", "https://api.openai.com/v1/chat/completions", model.APIProtocolChatCompletions},
		{"", "https://gw.example.com/openai", model.APIProtocolChatCompletions},
	}
	for _, c := range cases {
		cfg := model.ModelConfig{APIProtocol: c.protocol, OpenAIBaseURL: c.url}
		if got := cfg.EffectiveAPIProtocol(); got != c.want {
			t.Fatalf("protocol=%q url=%q: got %q want %q", c.protocol, c.url, got, c.want)
		}
	}
}

func TestChatResponsesNonStream(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("path=%q want /v1/responses", r.URL.Path)
		}
		if err := decodeBody(r, &gotBody); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}]}`))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "sk-test", "gpt-5")
	text, err := client.Chat(context.Background(), ChatRequest{
		ModelConfig: cfg,
		System:      "be brief",
		Messages:    []ChatMessage{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if text != "hello" {
		t.Fatalf("text=%q", text)
	}
	// Wire shape: input items, not messages.
	input, ok := gotBody["input"].([]any)
	if !ok || len(input) != 2 {
		t.Fatalf("input=%#v", gotBody["input"])
	}
	first, _ := input[0].(map[string]any)
	if first["role"] != "system" || first["content"] != "be brief" {
		t.Fatalf("first input item=%#v", first)
	}
	if gotBody["model"] != "gpt-5" {
		t.Fatalf("model=%v", gotBody["model"])
	}
	if _, hasMessages := gotBody["messages"]; hasMessages {
		t.Fatal("responses request must not carry messages")
	}
}

func TestChatResponsesOutputTextShortcut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"output_text":"shortcut","output":[]}`))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "k", "m")
	text, err := client.Chat(context.Background(), ChatRequest{ModelConfig: cfg, Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	if text != "shortcut" {
		t.Fatalf("text=%q", text)
	}
}

func TestChatResponsesErrorSurfaced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"message":"Unknown parameter: temperature"}}`))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "k", "m")
	_, err := client.Chat(context.Background(), ChatRequest{ModelConfig: cfg, Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
	if err == nil || !strings.Contains(err.Error(), "temperature") {
		t.Fatalf("err=%v", err)
	}
}

func TestStreamResponsesDeltas(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := decodeBody(r, &body); err != nil {
			t.Errorf("decode: %v", err)
		}
		if body["stream"] != true {
			t.Fatalf("stream=%v", body["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"content\":[{\"text\":\"ignored-when-deltas-present\"}]}]}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "k", "m")
	var deltas []string
	text, err := client.ChatStream(context.Background(), ChatRequest{
		ModelConfig: cfg,
		Messages:    []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatal(err)
	}
	if text != "Hello" {
		t.Fatalf("text=%q", text)
	}
	if strings.Join(deltas, "|") != "Hel|lo" {
		t.Fatalf("deltas=%v", deltas)
	}
}

func TestStreamResponsesCompletedOnlyFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"final-only\",\"output\":[]}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "k", "m")
	var deltas []string
	text, err := client.ChatStream(context.Background(), ChatRequest{
		ModelConfig: cfg,
		Messages:    []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatal(err)
	}
	if text != "final-only" {
		t.Fatalf("text=%q", text)
	}
	if len(deltas) != 1 || deltas[0] != "final-only" {
		t.Fatalf("deltas=%v", deltas)
	}
}

// TestStreamResponsesFailedEvent pins the terminal-error path: the stream
// fails, and the non-stream fallback also fails — the surfaced error must be
// readable (SSE body must not be re-parsed as JSON).
func TestStreamResponsesFailedEvent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.failed\",\"response\":{\"output_text\":\"boom\"}}\n\n"))
	}))
	defer srv.Close()

	client := &Client{HTTP: srv.Client()}
	cfg := responsesProtocolCfg(srv.URL+"/v1/responses", "k", "m")
	_, err := client.ChatStream(context.Background(), ChatRequest{
		ModelConfig: cfg,
		Messages:    []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err=%v", err)
	}
}
