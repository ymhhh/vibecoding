package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ymhhh/go-common/logger"
	"github.com/ymhhh/vibecoding/internal/model"
)

// ChatStream streams model tokens via onDelta (may be called many times).
// Returns the full concatenated text. Falls back to non-stream Chat when
// streaming is unavailable (e.g. Gemini) — then onDelta is invoked once.
func (c *Client) ChatStream(ctx context.Context, req ChatRequest, onDelta func(string)) (string, error) {
	if onDelta == nil {
		onDelta = func(string) {}
	}
	cfg := req.ModelConfig
	start := time.Now()
	provider := ""
	modelName := ""
	var (
		text string
		err  error
	)
	switch {
	case strings.TrimSpace(cfg.OpenAIBaseURL) != "" && strings.TrimSpace(cfg.OpenAIAPIKey) != "":
		provider = "openai"
		modelName = firstNonEmpty(cfg.OpenAIModel, "gpt-4o")
		chatFn := c.chatOpenAI
		streamFn := c.streamOpenAI
		if cfg.EffectiveAPIProtocol() == model.APIProtocolResponses {
			chatFn = c.chatResponses
			streamFn = c.streamResponses
		}
		var gotDelta bool
		text, err = streamFn(ctx, req, func(delta string) {
			if delta != "" {
				gotDelta = true
			}
			onDelta(delta)
		})
		// Some gateways reject stream or json+stream — fall back once (only if
		// nothing streamed, and only for non-terminal stream errors; terminal
		// failures like response.failed must surface as-is).
		if err != nil && !gotDelta && !isTerminalStreamErr(err) {
			logger.L().WithError(err).Warn("llm stream failed; falling back to non-stream")
			text, err = chatFn(ctx, req)
			if err == nil && text != "" {
				onDelta(text)
			}
		}
	case os.Getenv("GEMINI_API_KEY") != "":
		provider = "gemini"
		modelName = "gemini-2.0-flash"
		text, err = c.chatGemini(ctx, os.Getenv("GEMINI_API_KEY"), req)
		if err == nil && text != "" {
			onDelta(text)
		}
	default:
		err = fmt.Errorf("no LLM configured: set OpenAPI Base URL + API Key in settings, or GEMINI_API_KEY")
	}
	fields := logger.Fields{
		"provider":    provider,
		"model":       modelName,
		"json_mode":   req.JSONMode,
		"stream":      true,
		"msg_count":   len(req.Messages),
		"duration_ms": time.Since(start).Milliseconds(),
	}
	if provider == "openai" {
		fields["url"] = completionsURL(cfg.OpenAIBaseURL)
	}
	entry := logger.L().WithFields(fields)
	if err != nil {
		entry.WithError(err).Warn("llm chat stream failed")
		return "", err
	}
	entry.WithField("reply_chars", len(text)).Info("llm chat stream ok")
	return text, nil
}

func (c *Client) streamOpenAI(ctx context.Context, req ChatRequest, onDelta func(string)) (string, error) {
	if err := ValidateBaseURL(req.ModelConfig.OpenAIBaseURL); err != nil {
		return "", err
	}
	endpoint, modelName := openAIEndpoint(req.ModelConfig)
	msgs := make([]ChatMessage, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, ChatMessage{Role: "system", Content: req.System})
	}
	msgs = append(msgs, req.Messages...)

	temp := req.Temperature
	if temp == 0 && req.ModelConfig.Temperature != 0 {
		temp = req.ModelConfig.Temperature
	}
	body := map[string]any{
		"model":    modelName,
		"messages": msgs,
		"stream":   true,
	}
	if !req.OmitTemperature {
		body["temperature"] = temp
	}
	if req.JSONMode {
		body["response_format"] = map[string]string{"type": "json_object"}
	}

	doStream := func(payload map[string]any) (string, int, string, error) {
		b, _ := json.Marshal(payload)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
		if err != nil {
			return "", 0, "", err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+req.ModelConfig.OpenAIAPIKey)
		httpReq.Header.Set("Accept", "text/event-stream")

		resp, err := c.HTTP.Do(httpReq)
		if err != nil {
			return "", 0, "", err
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 300 {
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			return "", resp.StatusCode, string(raw), formatOpenAPIErr(endpoint, modelName, resp.StatusCode, truncate(string(raw), 300))
		}

		// Some proxies return JSON error with 200 — detect non-SSE briefly.
		ct := strings.ToLower(resp.Header.Get("Content-Type"))
		if strings.Contains(ct, "application/json") && !strings.Contains(ct, "event-stream") {
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
			return "", resp.StatusCode, string(raw), formatOpenAPIErr(endpoint, modelName, resp.StatusCode, "non-SSE JSON: "+truncate(string(raw), 300))
		}

		full, err := readOpenAISSE(resp.Body, onDelta)
		return full, resp.StatusCode, "", err
	}

	payload := body
	tempStripped := req.OmitTemperature
	var (
		full    string
		status  int
		errBody string
		err     error
	)
	for attempt := 1; attempt <= openAIMaxAttempts; attempt++ {
		full, status, errBody, err = doStream(payload)
		if err != nil {
			// Temperature reject: strip and retry immediately (does not consume backoff budget alone).
			if status >= 300 && !tempStripped && strings.Contains(strings.ToLower(errBody), "temperature") {
				retryBody := map[string]any{
					"model":    body["model"],
					"messages": body["messages"],
					"stream":   true,
				}
				if req.JSONMode {
					retryBody["response_format"] = body["response_format"]
				}
				payload = retryBody
				tempStripped = true
				logRetry(endpoint, modelName, attempt, openAIMaxAttempts, status, 0, "strip temperature and retry")
				continue
			}
			retryable := (status >= 300 && isRetryableHTTPStatus(status)) || isRetryableNetErr(err, ctx)
			max := attemptsFor(status, err)
			// Do not retry after SSE bytes were already delivered (would duplicate in the UI).
			if retryable && full == "" && attempt < max {
				wait := retryBackoff(attempt, status)
				logRetry(endpoint, modelName, attempt, max, status, wait, err.Error())
				if sleepErr := sleepCtx(ctx, wait); sleepErr != nil {
					return "", formatOpenAPIErr(endpoint, modelName, status, sleepErr.Error())
				}
				continue
			}
			if !strings.Contains(err.Error(), "url=") {
				return "", formatOpenAPIErr(endpoint, modelName, status, err.Error())
			}
			return "", err
		}
		break
	}
	if err != nil {
		if !strings.Contains(err.Error(), "url=") {
			return "", formatOpenAPIErr(endpoint, modelName, status, err.Error())
		}
		return "", err
	}
	if strings.TrimSpace(full) == "" {
		return "", formatOpenAPIErr(endpoint, modelName, 0, "no response generated")
	}
	_ = errBody
	return full, nil
}

func readOpenAISSE(r io.Reader, onDelta func(string)) (string, error) {
	sc := bufio.NewScanner(r)
	// Allow larger SSE lines (some gateways pack big chunks).
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 2<<20)

	var full strings.Builder
	for sc.Scan() {
		line := sc.Text()
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			if data == "[DONE]" {
				break
			}
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil && chunk.Error.Message != "" {
			return full.String(), fmt.Errorf("OpenAPI stream error: %s", chunk.Error.Message)
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			delta = chunk.Choices[0].Message.Content
		}
		if delta == "" {
			continue
		}
		full.WriteString(delta)
		onDelta(delta)
	}
	if err := sc.Err(); err != nil {
		return full.String(), err
	}
	return full.String(), nil
}

// isTerminalStreamErr reports whether a stream error is a definitive model
// failure (e.g. a response.failed event) — retrying or falling back to a
// non-stream call would only repeat the same failure.
func isTerminalStreamErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "OpenAPI stream error:")
}
