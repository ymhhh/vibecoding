package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ymhhh/go-common/logger"
	"github.com/ymhhh/vibecoding/internal/model"
)

type Client struct {
	HTTP *http.Client
}

func New() *Client {
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   20 * time.Second,
		ResponseHeaderTimeout: 3 * time.Minute, // first token may be slow on gateway models
		IdleConnTimeout:       90 * time.Second,
		ForceAttemptHTTP2:     true,
	}
	return &Client{HTTP: &http.Client{
		Timeout:   0, // body/SSE is bounded by the request context (handlers use RequestTimeout)
		Transport: transport,
	}}
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	ModelConfig     model.ModelConfig
	System          string
	Messages        []ChatMessage
	Temperature     float64
	JSONMode        bool
	OmitTemperature bool // some models (e.g. joybuilder) only accept default temperature
}

func (c *Client) Chat(ctx context.Context, req ChatRequest) (string, error) {
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
		if cfg.EffectiveAPIProtocol() == model.APIProtocolResponses {
			text, err = c.chatResponses(ctx, req)
		} else {
			text, err = c.chatOpenAI(ctx, req)
		}
	case os.Getenv("GEMINI_API_KEY") != "":
		provider = "gemini"
		modelName = "gemini-2.0-flash"
		text, err = c.chatGemini(ctx, os.Getenv("GEMINI_API_KEY"), req)
	default:
		err = fmt.Errorf("no LLM configured: set OpenAPI Base URL + API Key in settings, or GEMINI_API_KEY")
	}
	fields := logger.Fields{
		"provider":    provider,
		"model":       modelName,
		"json_mode":   req.JSONMode,
		"msg_count":   len(req.Messages),
		"duration_ms": time.Since(start).Milliseconds(),
	}
	if provider == "openai" {
		fields["url"] = completionsURL(cfg.OpenAIBaseURL)
	}
	entry := logger.L().WithFields(fields)
	if err != nil {
		entry.WithError(err).Warn("llm chat failed")
		return "", err
	}
	entry.WithField("reply_chars", len(text)).Info("llm chat ok")
	return text, nil
}

func ValidateBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("base URL required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("URL scheme must be http or https")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return fmt.Errorf("URL host required")
	}
	// Block obvious SSRF targets for a local app that may later bind beyond localhost.
	if host == "metadata.google.internal" || strings.HasSuffix(host, ".internal") {
		return fmt.Errorf("host not allowed")
	}
	return nil
}

// completionsURL returns the configured chat-completions endpoint as-is (trimmed).
// Callers must store the full path in settings; nothing is appended here.
func completionsURL(base string) string {
	return model.NormalizeOpenAIBaseURL(base)
}

func openAIEndpoint(cfg model.ModelConfig) (url, modelName string) {
	return completionsURL(cfg.OpenAIBaseURL), firstNonEmpty(cfg.OpenAIModel, "gpt-4o")
}

// formatOpenAPIErr includes the request URL and model so failures are diagnosable in UI/logs.
func formatOpenAPIErr(url, modelName string, status int, detail string) error {
	if status > 0 {
		return fmt.Errorf("OpenAPI request failed [%d] url=%s model=%s: %s", status, url, modelName, detail)
	}
	return fmt.Errorf("OpenAPI request failed url=%s model=%s: %s", url, modelName, detail)
}

func (c *Client) chatOpenAI(ctx context.Context, req ChatRequest) (string, error) {
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
	}
	if !req.OmitTemperature {
		body["temperature"] = temp
	}
	if req.JSONMode {
		body["response_format"] = map[string]string{"type": "json_object"}
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
				"model":    body["model"],
				"messages": body["messages"],
			}
			if req.JSONMode {
				retryBody["response_format"] = body["response_format"]
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
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", formatOpenAPIErr(endpoint, modelName, 0, fmt.Sprintf("parse response: %v", err))
	}
	if len(parsed.Choices) == 0 {
		return "", formatOpenAPIErr(endpoint, modelName, 0, "no response generated")
	}
	return parsed.Choices[0].Message.Content, nil
}

func (c *Client) chatGemini(ctx context.Context, apiKey string, req ChatRequest) (string, error) {
	var b strings.Builder
	if req.System != "" {
		b.WriteString(req.System)
		b.WriteString("\n\n")
	}
	for _, m := range req.Messages {
		b.WriteString(strings.ToUpper(m.Role))
		b.WriteString(": ")
		b.WriteString(m.Content)
		b.WriteString("\n")
	}
	payload := map[string]any{
		"contents": []map[string]any{
			{"parts": []map[string]string{{"text": b.String()}}},
		},
	}
	rawBody, _ := json.Marshal(payload)
	endpoint := "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("Gemini request failed [%d]: %s", resp.StatusCode, truncate(string(raw), 300))
	}
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no response generated")
	}
	return parsed.Candidates[0].Content.Parts[0].Text, nil
}

func (c *Client) TestOpenAPI(ctx context.Context, baseURL, apiKey, modelName, apiProtocol string) (string, error) {
	if err := ValidateBaseURL(baseURL); err != nil {
		return "", err
	}
	if strings.TrimSpace(apiKey) == "" {
		return "", fmt.Errorf("API key required")
	}
	cfg := model.ModelConfig{
		UseCustomOpenAI: true,
		OpenAIBaseURL:   baseURL,
		OpenAIAPIKey:    apiKey,
		OpenAIModel:     firstNonEmpty(modelName, "gpt-4o-mini"),
		APIProtocol:     apiProtocol,
		Temperature:     1,
	}
	// Omit temperature: some models (e.g. GPT-*-joybuilder) reject 0 and only allow default.
	return c.Chat(ctx, ChatRequest{
		ModelConfig: cfg,
		Messages: []ChatMessage{
			{Role: "system", Content: "You are a test assistant."},
			{Role: "user", Content: "Reply with the word OK if you receive this message."},
		},
		OmitTemperature: true,
	})
}

// modelsURL derives the GET /v1/models listing endpoint from a configured
// chat-completions or responses URL. The convention: strip the trailing
// "/chat/completions", "/responses", or legacy "/completions" path segment
// and append "/models", so "https://api.openai.com/v1/chat/completions"
// becomes "https://api.openai.com/v1/models". If the URL already ends with
// "/models" it is used as-is.
func modelsURL(completions string) (string, error) {
	base := strings.TrimSpace(completions)
	if base == "" {
		return "", fmt.Errorf("base URL required")
	}
	base = strings.TrimRight(base, "/")
	for _, suffix := range []string{"/chat/completions", "/responses", "/completions"} {
		if strings.HasSuffix(base, suffix) {
			return strings.TrimSuffix(base, suffix) + "/models", nil
		}
	}
	if strings.HasSuffix(base, "/models") {
		return base, nil
	}
	// Unknown shape (e.g. a gateway route): try "<base>/models" next to it.
	return base + "/models", nil
}

// ListOpenAIModels fetches the model list from the provider's /v1/models
// endpoint, derived from the configured chat-completions URL.
func (c *Client) ListOpenAIModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	if err := ValidateBaseURL(baseURL); err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("API key required")
	}
	endpoint, err := modelsURL(baseURL)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("OpenAPI models request failed [%d] url=%s: %s",
			resp.StatusCode, endpoint, truncate(string(raw), 300))
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parse models response: %v", err)
	}
	seen := make(map[string]struct{}, len(parsed.Data))
	models := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		models = append(models, id)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("no models returned by %s", endpoint)
	}
	sort.Strings(models)
	return models, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ParseDevSpecJSON extracts a DevSpec (+ optional chatReply) from model JSON
// or recovers Markdown from imperfect / envelope-shaped model output.
func ParseDevSpecJSON(raw string, titleFallback string) (*model.DevSpec, string, error) {
	raw = unwrapJSONObject(raw)
	if raw == "" {
		return nil, "", fmt.Errorf("empty model response")
	}

	var parsed struct {
		ChatReply           string                 `json:"chatReply"`
		Title               string                 `json:"title"`
		Summary             string                 `json:"summary"`
		ArchitectureDesign  string                 `json:"architectureDesign"`
		FileChanges         []model.SpecFileChange `json:"fileChanges"`
		ImplementationSteps []string               `json:"implementationSteps"`
		TestCases           []string               `json:"testCases"`
		RawMarkdown         string                 `json:"rawMarkdown"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		repaired := repairLooseJSON(raw)
		if err2 := json.Unmarshal([]byte(repaired), &parsed); err2 != nil {
			// Keep array fields if repaired JSON still parses partially via extract + rebuild.
			var arraysOnly struct {
				FileChanges         []model.SpecFileChange `json:"fileChanges"`
				ImplementationSteps []string               `json:"implementationSteps"`
				TestCases           []string               `json:"testCases"`
			}
			_ = json.Unmarshal([]byte(repaired), &arraysOnly)
			parsed.FileChanges = arraysOnly.FileChanges
			parsed.ImplementationSteps = arraysOnly.ImplementationSteps
			parsed.TestCases = arraysOnly.TestCases
			parsed.RawMarkdown, _ = extractJSONStringField(raw, "rawMarkdown")
			parsed.ChatReply, _ = extractJSONStringField(raw, "chatReply")
			parsed.Title, _ = extractJSONStringField(raw, "title")
			parsed.Summary, _ = extractJSONStringField(raw, "summary")
			parsed.ArchitectureDesign, _ = extractJSONStringField(raw, "architectureDesign")
		}
	}
	if parsed.Title == "" {
		parsed.Title = titleFallback
	}
	if parsed.FileChanges == nil {
		parsed.FileChanges = []model.SpecFileChange{}
	}
	if parsed.ImplementationSteps == nil {
		parsed.ImplementationSteps = []string{}
	}
	if parsed.TestCases == nil {
		parsed.TestCases = []string{}
	}
	md := CoerceReqMarkdown(strings.TrimSpace(parsed.RawMarkdown))
	if md == "" || looksLikeReqDocJSONEnvelope(md) {
		md = buildMarkdown(parsed.Title, parsed.Summary, parsed.ArchitectureDesign, parsed.FileChanges, parsed.ImplementationSteps, parsed.TestCases)
	}
	// Normalize: ensure document starts with a title heading when missing.
	if parsed.Title != "" && md != "" && !strings.HasPrefix(strings.TrimSpace(md), "#") {
		md = "# " + parsed.Title + "\n\n" + md
	}
	chatReply := strings.TrimSpace(parsed.ChatReply)
	if chatReply == "" {
		chatReply = "已更新待开发文档，可在「待开发文档」页查看。"
	}
	return &model.DevSpec{
		Title:               parsed.Title,
		Summary:             parsed.Summary,
		ArchitectureDesign:  parsed.ArchitectureDesign,
		FileChanges:         parsed.FileChanges,
		ImplementationSteps: parsed.ImplementationSteps,
		TestCases:           parsed.TestCases,
		RawMarkdown:         md,
		UpdatedAt:           model.NowISO(),
	}, chatReply, nil
}

func buildMarkdown(title, summary, arch string, files []model.SpecFileChange, steps, tests []string) string {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(title)
	b.WriteString("\n\n## Executive Summary\n")
	b.WriteString(summary)
	b.WriteString("\n\n## Architecture Design\n")
	b.WriteString(arch)
	b.WriteString("\n\n## Target Files & Changes\n")
	for _, f := range files {
		b.WriteString(fmt.Sprintf("- [%s] %s/%s — %s\n", f.Action, f.RepoName, f.FilePath, f.Summary))
	}
	b.WriteString("\n## Implementation Steps\n")
	for i, s := range steps {
		b.WriteString(fmt.Sprintf("%d. %s\n", i+1, s))
	}
	b.WriteString("\n## Test Cases\n")
	for _, t := range tests {
		b.WriteString("- ")
		b.WriteString(t)
		b.WriteString("\n")
	}
	return b.String()
}

type parsedSpecFields struct {
	ID                  string                 `json:"id"`
	Title               string                 `json:"title"`
	Description         string                 `json:"description"`
	Summary             string                 `json:"summary"`
	ArchitectureDesign  string                 `json:"architectureDesign"`
	FileChanges         []model.SpecFileChange `json:"fileChanges"`
	ImplementationSteps []string               `json:"implementationSteps"`
	TestCases           []string               `json:"testCases"`
	RawMarkdown         string                 `json:"rawMarkdown"`
}

func specFromFields(p parsedSpecFields, titleFallback string) *model.DevSpec {
	if p.Title == "" {
		p.Title = titleFallback
	}
	if p.FileChanges == nil {
		p.FileChanges = []model.SpecFileChange{}
	}
	if p.ImplementationSteps == nil {
		p.ImplementationSteps = []string{}
	}
	if p.TestCases == nil {
		p.TestCases = []string{}
	}
	md := strings.TrimSpace(p.RawMarkdown)
	if md == "" {
		md = buildMarkdown(p.Title, p.Summary, p.ArchitectureDesign, p.FileChanges, p.ImplementationSteps, p.TestCases)
	}
	if p.Title != "" && !strings.HasPrefix(md, "#") {
		md = "# " + p.Title + "\n\n" + md
	}
	return &model.DevSpec{
		Title:               p.Title,
		Summary:             p.Summary,
		ArchitectureDesign:  p.ArchitectureDesign,
		FileChanges:         p.FileChanges,
		ImplementationSteps: p.ImplementationSteps,
		TestCases:           p.TestCases,
		RawMarkdown:         md,
		UpdatedAt:           model.NowISO(),
	}
}

func unwrapJSONObject(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```JSON")
		raw = strings.TrimPrefix(raw, "```")
		if i := strings.LastIndex(raw, "```"); i >= 0 {
			raw = raw[:i]
		}
		raw = strings.TrimSpace(raw)
	}
	if !strings.HasPrefix(raw, "{") {
		if i := strings.Index(raw, "{"); i >= 0 {
			if j := strings.LastIndex(raw, "}"); j > i {
				raw = raw[i : j+1]
			}
		}
	}
	return raw
}

// SplitResult is the LLM output when breaking a large issue into sub-requirements.
type SplitResult struct {
	ChatReply        string
	OverviewMarkdown string
	OverviewSpec     *model.DevSpec
	SubRequirements  []model.SubRequirement
}

func ParseSplitJSON(raw string, titleFallback string) (*SplitResult, error) {
	raw = unwrapJSONObject(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty model response")
	}
	var parsed struct {
		ChatReply        string             `json:"chatReply"`
		OverviewMarkdown string             `json:"overviewMarkdown"`
		Title            string             `json:"title"`
		Summary          string             `json:"summary"`
		RawMarkdown      string             `json:"rawMarkdown"`
		SubRequirements  []parsedSpecFields `json:"subRequirements"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("parse split response: %w", err)
	}
	if len(parsed.SubRequirements) == 0 {
		return nil, fmt.Errorf("model returned no subRequirements")
	}
	overviewMD := strings.TrimSpace(parsed.OverviewMarkdown)
	if overviewMD == "" {
		overviewMD = strings.TrimSpace(parsed.RawMarkdown)
	}
	overviewTitle := parsed.Title
	if overviewTitle == "" {
		overviewTitle = titleFallback
	}
	if overviewMD == "" {
		var b strings.Builder
		b.WriteString("# ")
		b.WriteString(overviewTitle)
		b.WriteString("\n\n## 子需求拆分 / Sub-requirements\n\n")
		for i, sub := range parsed.SubRequirements {
			title := sub.Title
			if title == "" {
				title = fmt.Sprintf("Sub %d", i+1)
			}
			b.WriteString(fmt.Sprintf("%d. **%s** — %s\n", i+1, title, firstNonEmpty(sub.Description, sub.Summary)))
		}
		overviewMD = b.String()
	}
	overview := &model.DevSpec{
		Title:               overviewTitle,
		Summary:             parsed.Summary,
		ArchitectureDesign:  "",
		FileChanges:         []model.SpecFileChange{},
		ImplementationSteps: []string{},
		TestCases:           []string{},
		RawMarkdown:         overviewMD,
		UpdatedAt:           model.NowISO(),
	}
	subs := make([]model.SubRequirement, 0, len(parsed.SubRequirements))
	for i, fields := range parsed.SubRequirements {
		title := fields.Title
		if title == "" {
			title = fmt.Sprintf("%s (%d)", titleFallback, i+1)
		}
		spec := specFromFields(fields, title)
		id := strings.TrimSpace(fields.ID)
		if id == "" {
			id = fmt.Sprintf("sub-%s-%d", shortID(titleFallback), i+1)
		}
		status := model.SubReqPending
		if spec != nil && strings.TrimSpace(spec.RawMarkdown) != "" {
			status = model.SubReqReady
		}
		subs = append(subs, model.SubRequirement{
			ID:           id,
			Title:        title,
			Description:  firstNonEmpty(fields.Description, fields.Summary),
			Order:        i + 1,
			Status:       status,
			DevSpec:      spec,
			ChatMessages: []model.ChatMessage{},
			AutoDevLogs:  []model.AutoDevLog{},
		})
	}
	reply := strings.TrimSpace(parsed.ChatReply)
	if reply == "" {
		reply = fmt.Sprintf("已将需求拆分为 %d 个子需求，可分别或全局修改待开发文档。", len(subs))
	}
	return &SplitResult{
		ChatReply:        reply,
		OverviewMarkdown: overviewMD,
		OverviewSpec:     overview,
		SubRequirements:  subs,
	}, nil
}

// MultiSubSpecResult is a global (all-subs) spec revision.
type MultiSubSpecResult struct {
	ChatReply       string
	OverviewSpec    *model.DevSpec
	SubRequirements []parsedSpecFields
}

func ParseMultiSubSpecJSON(raw string, titleFallback string) (*MultiSubSpecResult, error) {
	raw = unwrapJSONObject(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty model response")
	}
	var parsed struct {
		ChatReply        string             `json:"chatReply"`
		OverviewMarkdown string             `json:"overviewMarkdown"`
		Title            string             `json:"title"`
		RawMarkdown      string             `json:"rawMarkdown"`
		SubRequirements  []parsedSpecFields `json:"subRequirements"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("parse multi-spec response: %w", err)
	}
	out := &MultiSubSpecResult{
		ChatReply:       strings.TrimSpace(parsed.ChatReply),
		SubRequirements: parsed.SubRequirements,
	}
	if out.ChatReply == "" {
		out.ChatReply = "已根据全局描述更新全部子需求待开发文档。"
	}
	overviewMD := strings.TrimSpace(parsed.OverviewMarkdown)
	if overviewMD == "" {
		overviewMD = strings.TrimSpace(parsed.RawMarkdown)
	}
	if overviewMD != "" {
		title := parsed.Title
		if title == "" {
			title = titleFallback
		}
		out.OverviewSpec = &model.DevSpec{
			Title:               title,
			Summary:             "",
			ArchitectureDesign:  "",
			FileChanges:         []model.SpecFileChange{},
			ImplementationSteps: []string{},
			TestCases:           []string{},
			RawMarkdown:         overviewMD,
			UpdatedAt:           model.NowISO(),
		}
	}
	return out, nil
}

func ApplyMultiSubSpec(issue *model.Issue, parsed *MultiSubSpecResult) {
	if issue == nil || parsed == nil {
		return
	}
	if parsed.OverviewSpec != nil {
		issue.DevSpec = parsed.OverviewSpec
	}
	if len(parsed.SubRequirements) == 0 {
		return
	}
	used := make([]bool, len(issue.SubRequirements))
	for i, fields := range parsed.SubRequirements {
		idx := -1
		if id := strings.TrimSpace(fields.ID); id != "" {
			for j := range issue.SubRequirements {
				if issue.SubRequirements[j].ID == id {
					idx = j
					break
				}
			}
		}
		if idx < 0 && i < len(issue.SubRequirements) && !used[i] {
			idx = i
		}
		if idx < 0 || idx >= len(issue.SubRequirements) {
			continue
		}
		used[idx] = true
		title := fields.Title
		if title == "" {
			title = issue.SubRequirements[idx].Title
		}
		spec := specFromFields(fields, title)
		issue.SubRequirements[idx].Title = title
		if d := strings.TrimSpace(fields.Description); d != "" {
			issue.SubRequirements[idx].Description = d
		}
		issue.SubRequirements[idx].DevSpec = spec
		if spec != nil && strings.TrimSpace(spec.RawMarkdown) != "" &&
			issue.SubRequirements[idx].Status != model.SubReqInProgress &&
			issue.SubRequirements[idx].Status != model.SubReqDone {
			issue.SubRequirements[idx].Status = model.SubReqReady
		}
	}
}

func shortID(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "item"
	}
	var b strings.Builder
	n := 0
	for _, r := range s {
		if n >= 8 {
			break
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			n++
		}
	}
	if b.Len() == 0 {
		return "item"
	}
	return strings.ToLower(b.String())
}
