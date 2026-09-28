package model

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityMedium Priority = "medium"
	PriorityHigh   Priority = "high"
	PriorityUrgent Priority = "urgent"
)

// IssueKind classifies the work item and maps to a git branch prefix.
type IssueKind string

const (
	IssueKindFeature IssueKind = "feature" // 开发需求 → featurePrefix
	IssueKindBugfix  IssueKind = "bugfix"  // 缺陷修复 → bugfixPrefix
	IssueKindHotfix  IssueKind = "hotfix"  // 紧急修复 → hotfixPrefix
)

// NormalizeIssueKind returns a valid kind; empty/unknown → feature.
func NormalizeIssueKind(k IssueKind) IssueKind {
	switch IssueKind(strings.TrimSpace(string(k))) {
	case IssueKindBugfix:
		return IssueKindBugfix
	case IssueKindHotfix:
		return IssueKindHotfix
	default:
		return IssueKindFeature
	}
}

type IssueStatus string

const (
	StatusRequirements IssueStatus = "requirements"
	StatusBacklog      IssueStatus = "backlog"
	StatusInProgress   IssueStatus = "in_progress"
	StatusInReview     IssueStatus = "in_review"
	StatusCompleted    IssueStatus = "completed"
)

type GitRepo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	DefaultBranch string `json:"defaultBranch"`
	Language      string `json:"language"`
	Description   string `json:"description,omitempty"`
	FilesCount    int    `json:"filesCount,omitempty"`
	URL           string `json:"url,omitempty"`
	SetupCommand  string `json:"setupCommand,omitempty"`
	TestCommand   string `json:"testCommand,omitempty"`
	LintCommand   string `json:"lintCommand,omitempty"`
}

type ModelConfig struct {
	UseCustomOpenAI bool    `json:"useCustomOpenAI"`
	OpenAIBaseURL   string  `json:"openAIBaseUrl"`
	OpenAIAPIKey    string  `json:"openAIApiKey"`
	OpenAIModel     string  `json:"openAIModel"`
	Temperature     float64 `json:"temperature"`
	// APIProtocol selects the wire protocol for the OpenAI-compatible endpoint:
	// "chat_completions" (default) or "responses".
	APIProtocol string `json:"apiProtocol,omitempty"`
	// KeyConfigured is set on API responses when a key exists server-side.
	KeyConfigured bool   `json:"keyConfigured,omitempty"`
	KeyHint       string `json:"keyHint,omitempty"`
}

type BranchPrefixConfig struct {
	FeaturePrefix  string `json:"featurePrefix"`
	BugfixPrefix   string `json:"bugfixPrefix"`
	HotfixPrefix   string `json:"hotfixPrefix"`
	RefactorPrefix string `json:"refactorPrefix"`
	AutoDevPrefix  string `json:"autoDevPrefix"`
	ReleasePrefix  string `json:"releasePrefix"`
}

func DefaultBranchPrefix() BranchPrefixConfig {
	return BranchPrefixConfig{
		FeaturePrefix:  "feature/",
		BugfixPrefix:   "fix/",
		HotfixPrefix:   "hotfix/",
		RefactorPrefix: "refactor/",
		AutoDevPrefix:  "ai-dev/",
		ReleasePrefix:  "release/",
	}
}

// PrefixForKind returns the configured branch prefix for an issue kind.
func (c *BranchPrefixConfig) PrefixForKind(kind IssueKind) string {
	def := DefaultBranchPrefix()
	if c == nil {
		return def.PrefixForKind(kind)
	}
	switch NormalizeIssueKind(kind) {
	case IssueKindBugfix:
		if p := strings.TrimSpace(c.BugfixPrefix); p != "" {
			return p
		}
		return def.BugfixPrefix
	case IssueKindHotfix:
		if p := strings.TrimSpace(c.HotfixPrefix); p != "" {
			return p
		}
		return def.HotfixPrefix
	default:
		if p := strings.TrimSpace(c.FeaturePrefix); p != "" {
			return p
		}
		return def.FeaturePrefix
	}
}

// BranchNameForIssue builds "{prefix}issue-{shortId}".
func BranchNameForIssue(prefix, issueID string) string {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "feature/"
	}
	shortID := strings.TrimSpace(issueID)
	if len(shortID) > 8 {
		shortID = shortID[len(shortID)-8:]
	}
	if shortID == "" {
		shortID = "unknown"
	}
	return prefix + "issue-" + shortID
}

func DefaultModelConfig() ModelConfig {
	return ModelConfig{
		UseCustomOpenAI: true,
		OpenAIBaseURL:   "https://api.openai.com/v1/chat/completions",
		OpenAIAPIKey:    "",
		OpenAIModel:     "gpt-4o",
		Temperature:     0.7,
	}
}

// API protocol identifiers stored in ModelConfig.APIProtocol.
const (
	APIProtocolChatCompletions = "chat_completions"
	APIProtocolResponses       = "responses"
)

// EffectiveAPIProtocol returns the protocol to use for a config: the stored
// value when valid; otherwise inferred from the endpoint URL (an URL ending
// in /responses selects the Responses API); empty/unrecognized values fall
// back to chat_completions.
func (m ModelConfig) EffectiveAPIProtocol() string {
	switch strings.TrimSpace(m.APIProtocol) {
	case APIProtocolResponses:
		return APIProtocolResponses
	case APIProtocolChatCompletions:
		return APIProtocolChatCompletions
	default:
		// unset or unknown: infer from the endpoint URL
		u := strings.ToLower(strings.TrimRight(strings.TrimSpace(m.OpenAIBaseURL), "/"))
		if strings.HasSuffix(u, "/responses") {
			return APIProtocolResponses
		}
		return APIProtocolChatCompletions
	}
}

// NormalizeOpenAIBaseURL trims the configured chat-completions URL.
// The value is used as-is for HTTP calls (no path is appended in the client).
func NormalizeOpenAIBaseURL(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

// UpgradeLegacyOpenAIBaseURL migrates old API-root values (e.g. ".../v1") to the
// full chat completions path so existing installs keep working after the UI
// started requiring a complete endpoint URL.
func UpgradeLegacyOpenAIBaseURL(raw string) string {
	u := NormalizeOpenAIBaseURL(raw)
	if u == "" {
		return u
	}
	if strings.Contains(strings.ToLower(u), "/chat/completions") {
		return u
	}
	return u + "/chat/completions"
}

type Project struct {
	ID                   string              `json:"id"`
	Name                 string              `json:"name"`
	Description          string              `json:"description"`
	GitRepos             []GitRepo           `json:"gitRepos"`
	BranchPrefixConfig   *BranchPrefixConfig `json:"branchPrefixConfig,omitempty"`
	CustomModelConfig    *ModelConfig        `json:"customModelConfig,omitempty"`
	UseCustomModelConfig bool                `json:"useCustomModelConfig"`
	CreatedAt            string              `json:"createdAt"`
	UpdatedAt            string              `json:"updatedAt"`
}

type ChatMessage struct {
	ID        string `json:"id"`
	Sender    string `json:"sender"` // user | ai | system
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
}

type SpecFileChange struct {
	FilePath     string `json:"filePath"`
	RepoName     string `json:"repoName"`
	Action       string `json:"action"` // create | modify | delete
	Summary      string `json:"summary"`
	Symbol       string `json:"symbol,omitempty"`
	Verified     bool   `json:"verified,omitempty"`
	OriginalCode string `json:"originalCode,omitempty"`
	ModifiedCode string `json:"modifiedCode,omitempty"`
}

// DocPhase selects which document chat/actions default to writing.
type DocPhase string

const (
	DocPhaseRequirement DocPhase = "requirement"
	DocPhaseDesign      DocPhase = "design"
)

// ReqDoc is the product requirement document (what to build), separate from DevSpec.
type ReqDoc struct {
	Title       string `json:"title,omitempty"`
	Summary     string `json:"summary,omitempty"`
	Scope       string `json:"scope,omitempty"`
	NonGoals    string `json:"nonGoals,omitempty"`
	Acceptance  string `json:"acceptance,omitempty"`
	Constraints string `json:"constraints,omitempty"`
	RawMarkdown string `json:"rawMarkdown"`
	AcceptedAt  string `json:"acceptedAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

type DevSpec struct {
	Title               string           `json:"title"`
	Summary             string           `json:"summary"`
	ArchitectureDesign  string           `json:"architectureDesign"`
	FileChanges         []SpecFileChange `json:"fileChanges"`
	ImplementationSteps []string         `json:"implementationSteps"`
	TestCases           []string         `json:"testCases"`
	RawMarkdown         string           `json:"rawMarkdown"`
	AcceptedAt          string           `json:"acceptedAt,omitempty"`
	UpdatedAt           string           `json:"updatedAt"`
}

type SubRequirementStatus string

const (
	SubReqPending    SubRequirementStatus = "pending"
	SubReqReady      SubRequirementStatus = "ready"
	SubReqInProgress SubRequirementStatus = "in_progress"
	SubReqDone       SubRequirementStatus = "done"
	SubReqFailed     SubRequirementStatus = "failed"
)

// SubRequirement is a slice of a large issue, each with its own Dev Spec.
type SubRequirement struct {
	ID             string               `json:"id"`
	Title          string               `json:"title"`
	Description    string               `json:"description"`
	Order          int                  `json:"order"`
	Status         SubRequirementStatus `json:"status"`
	DevSpec        *DevSpec             `json:"devSpec,omitempty"`
	ChatMessages   []ChatMessage        `json:"chatMessages"`
	AutoDevLogs    []AutoDevLog         `json:"autoDevLogs"`
	CommitSHA      string               `json:"commitSha,omitempty"`
	ReviewFeedback string               `json:"reviewFeedback,omitempty"`
}

type AutoDevLog struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Details   string `json:"details,omitempty"`
}

type WorktreeRef struct {
	RepoID   string `json:"repoId"`
	RepoName string `json:"repoName"`
	Path     string `json:"path"`
}

type QualityGate struct {
	TestsRan     bool   `json:"testsRan"`
	TestsPassed  bool   `json:"testsPassed"`
	TestsOutput  string `json:"testsOutput,omitempty"`
	LintRan      bool   `json:"lintRan"`
	LintPassed   bool   `json:"lintPassed"`
	LintOutput   string `json:"lintOutput,omitempty"`
	RepairRounds int    `json:"repairRounds"`
}

// ExecutorConfig selects how Auto-Dev produces code.
type ExecutorConfig struct {
	Type        string   `json:"type"`   // "llm" (default) | "agent"
	Preset      string   `json:"preset"` // claude | cursor | codex | custom
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"` // may contain {prompt}
	PromptStdin bool     `json:"promptStdin,omitempty"`
	TimeoutSec  int      `json:"timeoutSec"` // default 1800
	MaxHeal     int      `json:"maxHeal"`    // default 2
}

func DefaultExecutorConfig() ExecutorConfig {
	return ExecutorConfig{
		Type:       "llm",
		TimeoutSec: 1800,
		MaxHeal:    2,
	}
}

// Normalize fills defaults and clamps invalid values without mutating secrets.
func (c ExecutorConfig) Normalize() ExecutorConfig {
	out := c
	if out.Type != "agent" {
		out.Type = "llm"
	}
	if out.TimeoutSec <= 0 {
		out.TimeoutSec = 1800
	}
	if out.MaxHeal < 0 {
		out.MaxHeal = 0
	}
	if out.MaxHeal > 5 {
		out.MaxHeal = 5
	}
	if out.Type == "agent" && out.Preset == "" {
		out.Preset = "claude"
	}
	return out
}

// Validate reports whether an agent config is usable.
func (c ExecutorConfig) Validate() error {
	c = c.Normalize()
	if c.Type != "agent" {
		return nil
	}
	switch c.Preset {
	case "claude", "cursor", "codex":
		return nil
	case "custom":
		if strings.TrimSpace(c.Command) == "" {
			return fmt.Errorf("custom executor requires command")
		}
		hasPlaceholder := false
		for _, a := range c.Args {
			if strings.Contains(a, "{prompt}") {
				hasPlaceholder = true
				break
			}
		}
		if !hasPlaceholder && !c.PromptStdin {
			return fmt.Errorf("custom executor requires {prompt} in args or promptStdin")
		}
		return nil
	default:
		return fmt.Errorf("unknown executor preset %q", c.Preset)
	}
}

type DiffStats struct {
	Additions    int `json:"additions"`
	Deletions    int `json:"deletions"`
	FilesChanged int `json:"filesChanged"`
}

type PRInfo struct {
	ID          string        `json:"id"`
	BranchName  string        `json:"branchName"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Author      string        `json:"author"`
	CreatedAt   string        `json:"createdAt"`
	Status      string        `json:"status"` // open | merged | rejected
	DiffStats   DiffStats     `json:"diffStats"`
	Worktrees   []WorktreeRef `json:"worktrees,omitempty"`
	BaseBranch  string        `json:"baseBranch,omitempty"`
	Quality     *QualityGate  `json:"quality,omitempty"`
	Executor    string        `json:"executor,omitempty"`
	RemoteURL   string        `json:"remoteUrl,omitempty"`
}

type IssueAttachment struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	MIME    string `json:"mime,omitempty"`
	Size    int64  `json:"size"`
	Kind    string `json:"kind"` // text | image | file
	Text    string `json:"text,omitempty"`
	DataURL string `json:"dataUrl,omitempty"`
}

// PendingLLMSession remembers a timed-out / failed analysis so the user can
// retry the same conversation or regenerate from scratch.
type PendingLLMSession struct {
	Prompt     string `json:"prompt"`
	Scope      string `json:"scope,omitempty"`
	Split      bool   `json:"split,omitempty"`
	SyncSpec   bool   `json:"syncSpec,omitempty"`
	SyncReqDoc bool   `json:"syncReqDoc,omitempty"`
	Partial    string `json:"partial,omitempty"`
	Error      string `json:"error,omitempty"`
	Attempts   int    `json:"attempts,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

type Issue struct {
	ID                string             `json:"id"`
	ProjectID         string             `json:"projectId"`
	Title             string             `json:"title"`
	Description       string             `json:"description"`
	Attachments       []IssueAttachment  `json:"attachments,omitempty"`
	Priority          Priority           `json:"priority"`
	Kind              IssueKind          `json:"kind,omitempty"` // feature | bugfix | hotfix
	Status            IssueStatus        `json:"status"`
	AssociatedRepoIDs []string           `json:"associatedRepoIds"`
	Assignee          string             `json:"assignee"`
	ChatMessages      []ChatMessage      `json:"chatMessages"`
	ReqDoc            *ReqDoc            `json:"reqDoc,omitempty"`
	DocPhase          DocPhase           `json:"docPhase,omitempty"`
	DevSpec           *DevSpec           `json:"devSpec,omitempty"`
	SubRequirements   []SubRequirement   `json:"subRequirements,omitempty"`
	CurrentSubID      string             `json:"currentSubId,omitempty"`
	ReworkSubID       string             `json:"reworkSubId,omitempty"`
	AutoDevLogs       []AutoDevLog       `json:"autoDevLogs"`
	AutoDevProgress   int                `json:"autoDevProgress"`
	PRInfo            *PRInfo            `json:"prInfo,omitempty"`
	ReviewFeedback    string             `json:"reviewFeedback,omitempty"`
	ReviewComments    []DiffComment      `json:"reviewComments,omitempty"`
	AgentSessionID    string             `json:"agentSessionId,omitempty"`
	PendingLLM        *PendingLLMSession `json:"pendingLlm,omitempty"`
	CreatedAt         string             `json:"createdAt"`
	UpdatedAt         string             `json:"updatedAt"`
}

// DiffComment is a line-anchored review note on a real unified diff.
type DiffComment struct {
	ID        string `json:"id"`
	RepoID    string `json:"repoId"`
	Path      string `json:"path"`
	Side      string `json:"side"` // "new" | "old"
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
	Quote     string `json:"quote,omitempty"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

func (iss *Issue) HasSubRequirements() bool {
	return iss != nil && len(iss.SubRequirements) > 0
}

// PromptDescription is the issue brief plus extracted attachment text for LLM prompts.
func (iss *Issue) PromptDescription() string {
	if iss == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString(iss.Description)
	for _, a := range iss.Attachments {
		name := strings.TrimSpace(a.Name)
		if name == "" {
			name = "unnamed"
		}
		switch {
		case strings.TrimSpace(a.Text) != "":
			fmt.Fprintf(&b, "\n\n----- Attached file: %s -----\n%s", name, a.Text)
		case a.Kind == "image":
			fmt.Fprintf(&b, "\n\n[Attached image: %s]", name)
		default:
			fmt.Fprintf(&b, "\n\n[Attached file: %s]", name)
		}
	}
	return b.String()
}

// HasReqDoc reports whether a non-empty requirement document exists.
func (iss *Issue) HasReqDoc() bool {
	return iss != nil && iss.ReqDoc != nil && strings.TrimSpace(iss.ReqDoc.RawMarkdown) != ""
}

// LegacySpecOnly is true for older issues that have a Dev Spec but never got a ReqDoc.
// Those stay usable without the new requirement/design gate.
func (iss *Issue) LegacySpecOnly() bool {
	return iss != nil && !iss.HasReqDoc() && iss.HasDevSpecMarkdown()
}

func (iss *Issue) HasDevSpecMarkdown() bool {
	if iss == nil {
		return false
	}
	if iss.HasSubRequirements() {
		for _, sub := range iss.SubRequirements {
			if sub.DevSpec == nil || strings.TrimSpace(sub.DevSpec.RawMarkdown) == "" {
				return false
			}
		}
		return len(iss.SubRequirements) > 0
	}
	return iss.DevSpec != nil && strings.TrimSpace(iss.DevSpec.RawMarkdown) != ""
}

func (iss *Issue) hasNonEmptyFileChanges() bool {
	if iss == nil {
		return false
	}
	if iss.HasSubRequirements() {
		for _, sub := range iss.SubRequirements {
			if sub.DevSpec == nil || len(sub.DevSpec.FileChanges) == 0 {
				return false
			}
		}
		return len(iss.SubRequirements) > 0
	}
	return iss.DevSpec != nil && len(iss.DevSpec.FileChanges) > 0
}

// RequirementAccepted reports whether the requirement doc is confirmed
// (or this is a legacy issue that only has a Dev Spec).
func (iss *Issue) RequirementAccepted() bool {
	if iss == nil {
		return false
	}
	if !iss.HasReqDoc() {
		return iss.HasDevSpecMarkdown()
	}
	if strings.TrimSpace(iss.ReqDoc.AcceptedAt) == "" {
		return false
	}
	// Unconfirmed edits after accept: UpdatedAt is later than AcceptedAt.
	if strings.TrimSpace(iss.ReqDoc.UpdatedAt) != "" &&
		iss.ReqDoc.UpdatedAt > iss.ReqDoc.AcceptedAt {
		return false
	}
	return true
}

// DesignStale is true when the requirement was edited after the Dev Spec was written.
// Legacy issues (no ReqDoc) are never considered stale.
func (iss *Issue) DesignStale() bool {
	if iss == nil || !iss.HasReqDoc() {
		return false
	}
	reqTouch := strings.TrimSpace(iss.ReqDoc.UpdatedAt)
	if reqTouch == "" {
		return false
	}
	if iss.HasSubRequirements() {
		for _, sub := range iss.SubRequirements {
			if sub.DevSpec == nil {
				continue
			}
			if strings.TrimSpace(sub.DevSpec.UpdatedAt) != "" && reqTouch > sub.DevSpec.UpdatedAt {
				return true
			}
			if strings.TrimSpace(sub.DevSpec.UpdatedAt) == "" && strings.TrimSpace(sub.DevSpec.RawMarkdown) != "" {
				return true
			}
		}
		return false
	}
	if iss.DevSpec == nil || strings.TrimSpace(iss.DevSpec.RawMarkdown) == "" {
		return false
	}
	if strings.TrimSpace(iss.DevSpec.UpdatedAt) == "" {
		return true
	}
	return reqTouch > iss.DevSpec.UpdatedAt
}

// AcceptRequirement marks the current ReqDoc as confirmed.
func (iss *Issue) AcceptRequirement() {
	if iss == nil || iss.ReqDoc == nil {
		return
	}
	now := NowISO()
	if strings.TrimSpace(iss.ReqDoc.UpdatedAt) == "" {
		iss.ReqDoc.UpdatedAt = now
	}
	iss.ReqDoc.AcceptedAt = now
	if iss.ReqDoc.UpdatedAt > iss.ReqDoc.AcceptedAt {
		iss.ReqDoc.AcceptedAt = iss.ReqDoc.UpdatedAt
	}
	iss.DocPhase = DocPhaseDesign
}

// TouchReqDoc sets UpdatedAt and clears acceptance when the requirement body changes.
func (iss *Issue) TouchReqDoc() {
	if iss == nil || iss.ReqDoc == nil {
		return
	}
	iss.ReqDoc.UpdatedAt = NowISO()
	iss.ReqDoc.AcceptedAt = ""
	iss.DocPhase = DocPhaseRequirement
}

// DesignAccepted reports whether the Dev Spec has been explicitly confirmed
// via AcceptedAt (ignores Issue.Status — callers that grandfather backlog+
// must do so separately, e.g. SpecReadyForDev).
func (iss *Issue) DesignAccepted() bool {
	if iss == nil {
		return false
	}
	if iss.LegacySpecOnly() {
		return true
	}
	if !iss.HasDevSpecMarkdown() {
		return false
	}
	if iss.HasSubRequirements() {
		for _, sub := range iss.SubRequirements {
			if sub.DevSpec == nil {
				return false
			}
			acceptedAt := strings.TrimSpace(sub.DevSpec.AcceptedAt)
			if acceptedAt == "" {
				return false
			}
			updatedAt := strings.TrimSpace(sub.DevSpec.UpdatedAt)
			if updatedAt != "" && updatedAt > acceptedAt {
				return false
			}
		}
		return true
	}
	if iss.DevSpec == nil {
		return false
	}
	acceptedAt := strings.TrimSpace(iss.DevSpec.AcceptedAt)
	if acceptedAt == "" {
		return false
	}
	updatedAt := strings.TrimSpace(iss.DevSpec.UpdatedAt)
	if updatedAt != "" && updatedAt > acceptedAt {
		return false
	}
	return true
}

// AcceptDesign marks the current Dev Spec (or all sub-specs) as confirmed.
func (iss *Issue) AcceptDesign() {
	if iss == nil {
		return
	}
	now := NowISO()
	acceptOne := func(spec *DevSpec) {
		if spec == nil {
			return
		}
		if strings.TrimSpace(spec.UpdatedAt) == "" {
			spec.UpdatedAt = now
		}
		spec.AcceptedAt = now
		if spec.UpdatedAt > spec.AcceptedAt {
			spec.AcceptedAt = spec.UpdatedAt
		}
	}
	if iss.HasSubRequirements() {
		for i := range iss.SubRequirements {
			acceptOne(iss.SubRequirements[i].DevSpec)
		}
	} else {
		acceptOne(iss.DevSpec)
	}
	iss.DocPhase = DocPhaseDesign
}

// TouchDevSpec bumps UpdatedAt and clears design acceptance when the Spec body changes.
func (iss *Issue) TouchDevSpec() {
	if iss == nil {
		return
	}
	now := NowISO()
	if iss.HasSubRequirements() {
		for i := range iss.SubRequirements {
			if iss.SubRequirements[i].DevSpec == nil {
				continue
			}
			iss.SubRequirements[i].DevSpec.UpdatedAt = now
			iss.SubRequirements[i].DevSpec.AcceptedAt = ""
		}
		return
	}
	if iss.DevSpec == nil {
		return
	}
	iss.DevSpec.UpdatedAt = now
	iss.DevSpec.AcceptedAt = ""
}

// SpecReadyForDev reports whether Auto-Dev / backlog can proceed.
// Legacy (Dev Spec only): markdown present.
// New flow: accepted ReqDoc, non-stale design, accepted design, and design markdown.
// Issues already stored in backlog+ without AcceptedAt are grandfathered so
// Auto-Dev keeps working on pre-gate data (status transition validation must
// call DesignAccepted explicitly and must not rely on this grandfather alone).
func (iss *Issue) SpecReadyForDev() bool {
	if iss == nil {
		return false
	}
	if !iss.HasDevSpecMarkdown() {
		return false
	}
	if iss.LegacySpecOnly() {
		return true
	}
	if !iss.RequirementAccepted() || iss.DesignStale() {
		return false
	}
	if iss.DesignAccepted() {
		return true
	}
	switch iss.Status {
	case StatusBacklog, StatusInProgress, StatusInReview, StatusCompleted:
		return true
	}
	return false
}

// HasUnverifiedModifies is true when any modify/delete change is not verified against disk.
// Create actions are allowed without an existing file; UI may warn but server does not hard-block.
func (iss *Issue) HasUnverifiedModifies() bool {
	for _, ch := range iss.AggregatedFileChanges() {
		action := strings.ToLower(strings.TrimSpace(ch.Action))
		if action == "create" || action == "" {
			continue
		}
		if !ch.Verified {
			return true
		}
	}
	return false
}

// FileExistsInRepos reports whether rel path exists under any associated repo root.
// repoRoots maps repoName → absolute path on disk.
func FileExistsInRepos(repoRoots map[string]string, repoName, filePath string) bool {
	filePath = filepath.Clean(strings.TrimSpace(filePath))
	if filePath == "" || filePath == "." || strings.HasPrefix(filePath, "..") {
		return false
	}
	if repoName != "" {
		if root, ok := repoRoots[repoName]; ok {
			return fileExistsUnder(root, filePath)
		}
		return false
	}
	for _, root := range repoRoots {
		if fileExistsUnder(root, filePath) {
			return true
		}
	}
	return false
}

func fileExistsUnder(root, rel string) bool {
	full := filepath.Join(root, rel)
	st, err := os.Stat(full)
	return err == nil && !st.IsDir()
}

// VerifyFileChanges sets Verified on each change:
// - create: verified if path is non-empty and repoName is known (file need not exist)
// - modify/delete: verified only if the file exists under the named repo
func VerifyFileChanges(changes []SpecFileChange, repoRoots map[string]string) []SpecFileChange {
	out := make([]SpecFileChange, len(changes))
	copy(out, changes)
	for i := range out {
		path := strings.TrimSpace(out[i].FilePath)
		repo := strings.TrimSpace(out[i].RepoName)
		action := strings.ToLower(strings.TrimSpace(out[i].Action))
		if path == "" {
			out[i].Verified = false
			continue
		}
		clean := filepath.Clean(path)
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			out[i].Verified = false
			continue
		}
		switch action {
		case "create":
			if repo == "" {
				out[i].Verified = len(repoRoots) == 1
			} else if _, ok := repoRoots[repo]; ok {
				out[i].Verified = true
			} else {
				out[i].Verified = false
			}
		default: // modify, delete, unknown
			out[i].Verified = FileExistsInRepos(repoRoots, repo, clean)
		}
	}
	return out
}

func (iss *Issue) NormalizeSubs() {
	if iss == nil {
		return
	}
	if iss.SubRequirements == nil {
		iss.SubRequirements = []SubRequirement{}
		return
	}
	for i := range iss.SubRequirements {
		if iss.SubRequirements[i].ChatMessages == nil {
			iss.SubRequirements[i].ChatMessages = []ChatMessage{}
		}
		if iss.SubRequirements[i].AutoDevLogs == nil {
			iss.SubRequirements[i].AutoDevLogs = []AutoDevLog{}
		}
		if iss.SubRequirements[i].Order == 0 {
			iss.SubRequirements[i].Order = i + 1
		}
		if iss.SubRequirements[i].Status == "" {
			if iss.SubRequirements[i].DevSpec != nil && strings.TrimSpace(iss.SubRequirements[i].DevSpec.RawMarkdown) != "" {
				iss.SubRequirements[i].Status = SubReqReady
			} else {
				iss.SubRequirements[i].Status = SubReqPending
			}
		}
	}
	sort.SliceStable(iss.SubRequirements, func(i, j int) bool {
		return iss.SubRequirements[i].Order < iss.SubRequirements[j].Order
	})
}

func (iss *Issue) SubByID(id string) *SubRequirement {
	if iss == nil || id == "" {
		return nil
	}
	for i := range iss.SubRequirements {
		if iss.SubRequirements[i].ID == id {
			return &iss.SubRequirements[i]
		}
	}
	return nil
}

func (iss *Issue) AggregatedFileChanges() []SpecFileChange {
	if iss == nil {
		return nil
	}
	if !iss.HasSubRequirements() {
		if iss.DevSpec == nil {
			return nil
		}
		return iss.DevSpec.FileChanges
	}
	var out []SpecFileChange
	for _, sub := range iss.SubRequirements {
		if sub.DevSpec != nil {
			out = append(out, sub.DevSpec.FileChanges...)
		}
	}
	return out
}

func (iss *Issue) ReadySubCount() (ready, total int) {
	if iss == nil {
		return 0, 0
	}
	total = len(iss.SubRequirements)
	for _, sub := range iss.SubRequirements {
		if sub.DevSpec != nil && strings.TrimSpace(sub.DevSpec.RawMarkdown) != "" {
			ready++
		}
	}
	return ready, total
}

type UIPrefs struct {
	Language        string `json:"language"`
	ThemeStyle      string `json:"themeStyle"`
	ActiveProjectID string `json:"activeProjectId"`
}

type AutoDevJobStatus string

const (
	JobQueued    AutoDevJobStatus = "queued"
	JobRunning   AutoDevJobStatus = "running"
	JobCompleted AutoDevJobStatus = "completed"
	JobFailed    AutoDevJobStatus = "failed"
	JobCancelled AutoDevJobStatus = "cancelled"
)

type AutoDevJob struct {
	ID             string           `json:"id"`
	IssueID        string           `json:"issueId"`
	Status         AutoDevJobStatus `json:"status"`
	Progress       int              `json:"progress"`
	Phase          string           `json:"phase,omitempty"`
	Error          string           `json:"error,omitempty"`
	PRInfo         *PRInfo          `json:"prInfo,omitempty"`
	Executor       string           `json:"executor,omitempty"`
	ExecutorConfig *ExecutorConfig  `json:"executorConfig,omitempty"`
	CreatedAt      string           `json:"createdAt"`
	UpdatedAt      string           `json:"updatedAt"`
}

type JobEvent struct {
	Type             string      `json:"type"` // log | progress | status | done | error
	Phase            string      `json:"phase,omitempty"`
	Message          string      `json:"message,omitempty"`
	Details          string      `json:"details,omitempty"`
	Progress         int         `json:"progress,omitempty"`
	Status           string      `json:"status,omitempty"`
	Log              *AutoDevLog `json:"log,omitempty"`
	PRInfo           *PRInfo     `json:"prInfo,omitempty"`
	Error            string      `json:"error,omitempty"`
	SubRequirementID string      `json:"subRequirementId,omitempty"`
	SubTitle         string      `json:"subTitle,omitempty"`
	SubIndex         int         `json:"subIndex,omitempty"`
	SubTotal         int         `json:"subTotal,omitempty"`
}

func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func MaskKey(key string) (configured bool, hint string) {
	key = trimSpace(key)
	if key == "" {
		return false, ""
	}
	if len(key) <= 4 {
		return true, "****"
	}
	return true, "****" + key[len(key)-4:]
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}

// PublicModel strips secrets for API responses.
func (m ModelConfig) Public() ModelConfig {
	out := m
	configured, hint := MaskKey(m.OpenAIAPIKey)
	out.OpenAIAPIKey = ""
	out.KeyConfigured = configured
	out.KeyHint = hint
	return out
}
