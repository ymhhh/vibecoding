package llm

import (
	"strings"
	"testing"

	"github.com/ymhhh/vibecoding/internal/model"
)

func TestParseReqDocJSON(t *testing.T) {
	raw := `{
		"chatReply":"ok",
		"title":"Feature",
		"summary":"do X",
		"scope":"in",
		"nonGoals":"out",
		"acceptance":"pass",
		"constraints":"mysql",
		"rawMarkdown":"# Feature\n\n## 概述\ndo X"
	}`
	doc, reply, err := ParseReqDocJSON(raw, "Fallback")
	if err != nil {
		t.Fatal(err)
	}
	if reply != "ok" || doc.Title != "Feature" || !strings.Contains(doc.RawMarkdown, "do X") {
		t.Fatalf("%+v reply=%q", doc, reply)
	}
	if strings.Contains(doc.RawMarkdown, `"chatReply"`) {
		t.Fatalf("stored JSON envelope as markdown: %s", doc.RawMarkdown)
	}
}

func TestParseReqDocJSONTrailingCommaAndExtract(t *testing.T) {
	raw := `{
		"chatReply": "已整理需求",
		"rawMarkdown": "# 订单导出需求\n\n### 概述 / Summary\n\n导出记录\n",
	}`
	doc, reply, err := ParseReqDocJSON(raw, "Fallback")
	if err != nil {
		t.Fatal(err)
	}
	if reply != "已整理需求" {
		t.Fatalf("reply=%q", reply)
	}
	if !strings.Contains(doc.RawMarkdown, "# 订单导出需求") {
		t.Fatalf("md=%s", doc.RawMarkdown)
	}
	if strings.Contains(doc.RawMarkdown, `"rawMarkdown"`) {
		t.Fatalf("envelope leaked: %s", doc.RawMarkdown)
	}
}

func TestParseReqDocJSONRawNewlinesInString(t *testing.T) {
	// Invalid JSON: literal newlines inside the string value.
	raw := "{\n  \"chatReply\": \"ok\",\n  \"rawMarkdown\": \"# Title\n\n## 概述 / Summary\n\nbody text\"\n}"
	doc, _, err := ParseReqDocJSON(raw, "Fallback")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(doc.RawMarkdown, "# Title") || !strings.Contains(doc.RawMarkdown, "body text") {
		t.Fatalf("md=%s", doc.RawMarkdown)
	}
	if strings.HasPrefix(strings.TrimSpace(doc.RawMarkdown), "{") {
		t.Fatalf("still JSON: %s", doc.RawMarkdown)
	}
}

func TestCoerceReqMarkdownEnvelope(t *testing.T) {
	envelope := `{"chatReply":"hi","rawMarkdown":"# Real Doc\n\n## 范围 / Scope\n\n- a\n"}`
	got := CoerceReqMarkdown(envelope)
	if !strings.Contains(got, "# Real Doc") || strings.Contains(got, "chatReply") {
		t.Fatalf("got=%s", got)
	}
}

func TestParseWantedFilesJSON(t *testing.T) {
	files, _, err := ParseWantedFilesJSON(`{"wantedFiles":[{"repoName":"svc","filePath":"a.go","hintLine":10}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].FilePath != "a.go" || files[0].HintLine != 10 {
		t.Fatalf("%+v", files)
	}
}

func TestParseReqSplitJSONNoDevSpec(t *testing.T) {
	raw := `{
		"chatReply":"split",
		"overviewMarkdown":"# Parent\n\nTwo slices.",
		"subRequirements":[
			{"title":"API","description":"endpoint"},
			{"title":"UI","description":"form"}
		]
	}`
	got, err := ParseReqSplitJSON(raw, "Parent")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.SubRequirements) != 2 {
		t.Fatalf("subs=%d", len(got.SubRequirements))
	}
	for _, sub := range got.SubRequirements {
		if sub.DevSpec != nil {
			t.Fatalf("expected no DevSpec, got %+v", sub.DevSpec)
		}
	}
}

func TestBriefToReqMarkdown(t *testing.T) {
	md := BriefToReqMarkdown(&model.Issue{
		Title:       "Login",
		Description: "Users can sign in",
		Attachments: []model.IssueAttachment{
			{Name: "notes.txt", Text: "SSO only", Kind: "text"},
			{Name: "wire.png", Kind: "image"},
		},
	})
	for _, want := range []string{
		"# Login",
		"## 概述 / Summary",
		"Users can sign in",
		"## 附件原文 / Attached briefs",
		"SSO only",
		"## 附图 / Images",
		"wire.png",
		"## 验收标准 / Acceptance",
	} {
		if !strings.Contains(md, want) {
			t.Fatalf("missing %q in:\n%s", want, md)
		}
	}
}
