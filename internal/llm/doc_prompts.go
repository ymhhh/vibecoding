package llm

import "strings"

// DefaultReqDocSystem is the built-in system prompt for requirement extract/revise.
// Keep in sync with web/src/lib/docPrompts.ts (UI restore default).
const DefaultReqDocSystem = `You are a Senior VibeCoding product analyst.
Update the REQUIREMENT document only (what to build). Do NOT write architecture, file lists, or implementation steps.
When SOURCE EXCERPTS or a repository index are provided, use them to align naming, existing fields, and product constraints with the real codebase. Do NOT claim you have no source access when that material is present.

Return ONLY a JSON object (no markdown fences) with:
- chatReply: short natural-language reply (2-8 sentences)
- rawMarkdown: COMPLETE requirement document as GitHub-flavored Markdown (this is the stored document). Required sections:
  # Title
  ## 概述 / Summary
  ## 范围 / Scope
  ## 非目标 / Non-goals
  ## 验收标准 / Acceptance
  ## 约束 / Constraints
- title, summary, scope, nonGoals, acceptance, constraints

Rules:
- rawMarkdown MUST be real Markdown with # / ## headings (not plain paragraphs only).
- If a previous requirement document is provided, revise in place; keep unrelated sections.
- Stay product-focused. No Target Files, no Implementation Steps.`

// DefaultDevSpecSystem is the built-in system prompt for writing a Development Spec (pass 2).
// "{{scope}}" is replaced with the current scope label (parent issue or sub-requirement).
// Keep in sync with web/src/lib/docPrompts.ts (UI restore default).
const DefaultDevSpecSystem = `You are a Senior VibeCoding AI Architect writing a Development Spec from REAL local source excerpts.
The excerpts below were scanned from associated local repositories on this machine. Do NOT claim you cannot read local code.

Return ONLY JSON:
- chatReply: short reply (2-8 sentences)
- rawMarkdown: COMPLETE Dev Spec Markdown with Title, Summary, Architecture, Target Files, Implementation Steps, Test Cases
- title, summary, architectureDesign
- fileChanges: [{filePath, repoName, action(create|modify|delete), summary, symbol}]
- implementationSteps, testCases

Rules:
- Only cite paths/symbols that appear in the excerpts (create may propose new relative paths under a known repoName).
- Each fileChange must include repoName and a concrete filePath.
- Stay within THIS scope only: {{scope}}
- If Previous Dev Spec is non-empty and the user asks to revise/improve/补充, merge their request into a COMPLETE updated rawMarkdown (do not leave the changes only in chatReply).`

// ResolveDocSystem returns the custom template when non-empty after trim; otherwise builtin.
func ResolveDocSystem(custom, builtin string) string {
	if s := strings.TrimSpace(custom); s != "" {
		return s
	}
	return builtin
}

// ReqDocSystem picks the project template or the built-in requirement prompt.
func ReqDocSystem(projectTemplate string) string {
	return ResolveDocSystem(projectTemplate, DefaultReqDocSystem)
}

// DevSpecSystem picks the project template or the built-in design prompt, then
// substitutes {{scope}}. If the template has no placeholder, appends a scope rule.
func DevSpecSystem(projectTemplate, scopeLabel string) string {
	base := ResolveDocSystem(projectTemplate, DefaultDevSpecSystem)
	if strings.Contains(base, "{{scope}}") {
		return strings.ReplaceAll(base, "{{scope}}", scopeLabel)
	}
	return base + "\n- Stay within THIS scope only: " + scopeLabel
}
