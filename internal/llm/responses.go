package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ymhhh/vibecoding/internal/model"
)

// chatResponses calls the OpenAI Responses API
// (POST {base}/responses — model + input, output items carry the text).
// Shares the retry/backoff policy with chatOpenAI.
func (c *Client) chatResponses(ctx context.Context, req ChatRequest) (string, error) {
	if err := ValidateBaseURL(req.ModelConfig.OpenAIBaseURL); err != nil {
		return "", err
	}
	endpoint, modelName := openAIEndpoint(req.ModelConfig)

	// Flatten the conversation into Responses-API input items.
	input := make([]map[string]string, 0, len(req.Messages)+1)
	if req.System != "" {
		input = append(input, map[string]string{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		input = append(input, map[string]string{"role": m.Role, "content": m.Content})
	}

	temp := req.Temperature
	if temp == 0 && req.ModelConfig.Temperature != 0 {
		temp = req.ModelConfig.Temperature
	}
	body := map[string]any{
		"model": modelName,
		"input": input,
	}
	if !req.OmitTemperature {
		body["temperature"] = temp
	}

	doReq := func(payload map[string]any) ([]byte, int, error) {
		b, _ := json.Marshal(payload)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
		if err != nil {
			return nil, 0, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+req.ModelConfig.OpenAIAPIKey)
		resp, err := c.HTTP.Do(httpReq)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		return raw, resp.StatusCode, nil
	}

	payload := body
	tempStripped := req.OmitTemperature
	var (
		raw    []byte
		status int
		err    error
	)
	for attempt := 1; attempt <= openAIMaxAttempts; attempt++ {
		raw, status, err = doReq(payload)
		if err != nil {
			max := attemptsFor(status, err)
			if attempt < max && isRetryableNetErr(err, ctx) {
				wait := retryBackoff(attempt, 0)
				logRetry(endpoint, modelName, attempt, max, 0, wait, err.Error())
				if sleepErr := sleepCtx(ctx, wait); sleepErr != nil {
					return "", formatOpenAPIErr(endpoint, modelName, 0, sleepErr.Error())
				}
				continue
			}
			return "", formatOpenAPIErr(endpoint, modelName, 0, err.Error())
		}
		// One-shot: strip temperature for models that only accept the default.
		if status >= 300 && !tempStripped && strings.Contains(strings.ToLower(string(raw)), "temperature") {
			retryBody := map[string]any{
				"model": body["model"],
				"input": body["input"],
			}
			payload = retryBody
			tempStripped = true
			logRetry(endpoint, modelName, attempt, openAIMaxAttempts, status, 0, "strip temperature and retry")
			continue
		}
		if status >= 300 && isRetryableHTTPStatus(status) && attempt < openAIMaxAttempts {
			wait := retryBackoff(attempt, status)
			logRetry(endpoint, modelName, attempt, openAIMaxAttempts, status, wait, truncate(string(raw), 160))
			if sleepErr := sleepCtx(ctx, wait); sleepErr != nil {
				return "", formatOpenAPIErr(endpoint, modelName, status, sleepErr.Error())
			}
			continue
		}
		break
	}
	if err != nil {
		return "", formatOpenAPIErr(endpoint, modelName, 0, err.Error())
	}
	if status >= 300 {
		return "", formatOpenAPIErr(endpoint, modelName, status, truncate(string(raw), 300))
	}
	text, err := parseResponsesOutput(raw)
	if err != nil {
		return "", formatOpenAPIErr(endpoint, modelName, 0, err.Error())
	}
	return text, nil
}

// parseResponsesOutput extracts the assistant text from a Responses API body:
// output_text convenience field, then output[].content[].text items.
func parseResponsesOutput(raw []byte) (string, error) {
	var conv struct {
		OutputText string `json:"output_text"`
		Error      *struct {
			Message string `json:"message"`
		} `json:"error"`
		Output []struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &conv); err != nil {
		return "", fmt.Errorf("parse responses body: %v", err)
	}
	if conv.Error != nil && conv.Error.Message != "" {
		return "", fmt.Errorf("responses error: %s", conv.Error.Message)
	}
	if conv.OutputText != "" {
		return conv.OutputText, nil
	}
	var b strings.Builder
	for _, item := range conv.Output {
		for _, c := range item.Content {
			b.WriteString(c.Text)
		}
	}
	if b.Len() == 0 {
		return "", fmt.Errorf("no response generated")
	}
	return b.String(), nil
}

// streamResponses streams the Responses API. The wire protocol is
// POST {base}/responses with stream:true; SSE events carry typed payloads:
// response.output_text.delta events hold incremental text, and
// response.completed holds the final aggregated output.
func (c *Client) streamResponses(ctx context.Context, req ChatRequest, onDelta func(string)) (string, error) {
	if err := ValidateBaseURL(req.ModelConfig.OpenAIBaseURL); err != nil {
		return "", err
	}
	endpoint, modelName := openAIEndpoint(req.ModelConfig)

	input := make([]map[string]string, 0, len(req.Messages)+1)
	if req.System != "" {
		input = append(input, map[string]string{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		input = append(input, map[string]string{"role": m.Role, "content": m.Content})
	}
	body := map[string]any{
		"model":  modelName,
		"input":  input,
		"stream": true,
	}

	b, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+req.ModelConfig.OpenAIAPIKey)
	httpReq.Header.Set("Accept", "text/event-stream")
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return "", formatOpenAPIErr(endpoint, modelName, 0, err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", formatOpenAPIErr(endpoint, modelName, resp.StatusCode, truncate(string(raw), 300))
	}
	// Some proxies return JSON errors with 200 — detect non-SSE briefly.
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "application/json") && !strings.Contains(ct, "event-stream") {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		return "", formatOpenAPIErr(endpoint, modelName, resp.StatusCode, "non-SSE JSON: "+truncate(string(raw), 300))
	}

	var full strings.Builder
	sc := bufio.NewScanner(resp.Body)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 2<<20)
	for sc.Scan() {
		line := sc.Text()
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var ev struct {
			Type    string `json:"type"`
			Delta   string `json:"delta"`
			Error   *struct {
				Message string `json:"message"`
			} `json:"error"`
			Response *struct {
				OutputText string `json:"output_text"`
				Output     []struct {
					Content []struct {
						Text string `json:"text"`
					} `json:"content"`
				} `json:"output"`
			} `json:"response"`
		}
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			continue
		}
		if ev.Error != nil && ev.Error.Message != "" {
			return full.String(), fmt.Errorf("OpenAPI stream error: %s", ev.Error.Message)
		}
		switch ev.Type {
		case "response.output_text.delta":
			if ev.Delta != "" {
				full.WriteString(ev.Delta)
				onDelta(ev.Delta)
			}
		case "response.completed":
			// If nothing streamed (e.g. no delta events), surface the final text.
			if full.Len() == 0 && ev.Response != nil {
				text := ev.Response.OutputText
				if text == "" {
					var b strings.Builder
					for _, item := range ev.Response.Output {
						for _, c := range item.Content {
							b.WriteString(c.Text)
						}
					}
					text = b.String()
				}
				if text != "" {
					full.WriteString(text)
					onDelta(text)
				}
			}
		case "response.failed":
			msg := "response failed"
			if ev.Response != nil {
				msg += ": " + ev.Response.OutputText
			}
			return full.String(), fmt.Errorf("OpenAPI stream error: %s", msg)
		}
	}
	if err := sc.Err(); err != nil {
		return full.String(), formatOpenAPIErr(endpoint, modelName, 0, err.Error())
	}
	if strings.TrimSpace(full.String()) == "" {
		return "", formatOpenAPIErr(endpoint, modelName, 0, "no response generated")
	}
	return full.String(), nil
}

// responsesProtocolCfg is used by tests to build a Responses-API ModelConfig.
func responsesProtocolCfg(baseURL, apiKey, modelName string) model.ModelConfig {
	return model.ModelConfig{
		UseCustomOpenAI: true,
		OpenAIBaseURL:   baseURL,
		OpenAIAPIKey:    apiKey,
		OpenAIModel:     modelName,
		APIProtocol:     model.APIProtocolResponses,
	}
}
