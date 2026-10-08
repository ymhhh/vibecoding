package model

import (
	"strings"
	"testing"
)

func TestPromptDescriptionIncludesAttachmentText(t *testing.T) {
	iss := &Issue{
		Description: "支持将订单导出为 CSV",
		Attachments: []IssueAttachment{
			{Name: "prd.md", Kind: "text", Text: "# PRD\n方案一"},
			{Name: "ui.png", Kind: "image"},
			{Name: "notes.bin", Kind: "file"},
			{Name: "spec.pdf", Kind: "pdf"},
		},
	}
	got := iss.PromptDescription()
	for _, want := range []string{
		"支持将订单导出为 CSV",
		"----- Attached file: prd.md -----",
		"# PRD\n方案一",
		"[Attached image: ui.png]",
		"[Attached file: notes.bin]",
		"[Attached file: spec.pdf]",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("PromptDescription missing %q in %q", want, got)
		}
	}
}

func TestPromptDescriptionNilSafe(t *testing.T) {
	var iss *Issue
	if iss.PromptDescription() != "" {
		t.Fatal("nil issue should yield empty prompt description")
	}
}
