package model

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateQuote(t *testing.T) {
	t.Parallel()
	if TruncateQuote("short") != "short" {
		t.Fatal()
	}
	long := strings.Repeat("你", QuoteMaxRunes+10)
	got := TruncateQuote(long)
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("missing ellipsis: %q", got[len(got)-3:])
	}
	if utf8.RuneCountInString(strings.TrimSuffix(got, "…")) != QuoteMaxRunes {
		t.Fatalf("rune count=%d", utf8.RuneCountInString(strings.TrimSuffix(got, "…")))
	}
}

func TestFormatReviewComments(t *testing.T) {
	t.Parallel()
	if FormatReviewComments(nil, nil) != "" {
		t.Fatal("empty comments should yield empty prompt")
	}
	out := FormatReviewComments([]DiffComment{{
		RepoID:    "repo-1",
		Path:      "internal/foo.go",
		Side:      "new",
		StartLine: 42,
		EndLine:   58,
		Quote:     "+timeout := 20 * time.Minute",
		Body:      "把超时错误映射到 LLMRecoveryBar，不要改重试次数。",
	}}, func(id string) string {
		if id == "repo-1" {
			return "ziya"
		}
		return id
	})
	for _, need := range []string{
		"Review comments (fix these hunks; do not unrelated refactors):",
		"[ziya] internal/foo.go:new:42-58",
		"+timeout := 20 * time.Minute",
		"把超时错误映射到 LLMRecoveryBar，不要改重试次数。",
	} {
		if !strings.Contains(out, need) {
			t.Fatalf("missing %q in:\n%s", need, out)
		}
	}
}

func TestCommentStatusAndBlocking(t *testing.T) {
	t.Parallel()
	if CommentStatus(DiffComment{}) != CommentOpen {
		t.Fatal("empty status is open")
	}
	comments := []DiffComment{
		{ID: "1", Status: CommentOpen, Body: "a"},
		{ID: "2", Status: CommentFixed, Body: "b"},
	}
	if !HasBlockingReviewComments(comments) {
		t.Fatal("open comment should block")
	}
	fixedOnly := MarkFixingCommentsFixed(MarkNonFixedCommentsFixing(comments))
	if HasBlockingReviewComments(fixedOnly) {
		t.Fatalf("after fix should not block: %+v", fixedOnly)
	}
	if FormatReviewComments([]DiffComment{{Status: CommentFixed, Body: "x", Path: "a.go"}}, nil) != "" {
		t.Fatal("fixed comments omitted from prompt")
	}
}

func TestIsReviewRepair(t *testing.T) {
	t.Parallel()
	iss := &Issue{}
	if iss.IsReviewRepair() {
		t.Fatal()
	}
	iss.ReviewFeedback = "please fix"
	if !iss.IsReviewRepair() {
		t.Fatal("feedback marks repair")
	}
	iss.ReviewFeedback = ""
	iss.ReviewComments = []DiffComment{{Status: CommentFixing}}
	if !iss.IsReviewRepair() {
		t.Fatal("fixing comment marks repair")
	}
}

func TestFormatReviewCommentsTruncatesQuote(t *testing.T) {
	t.Parallel()
	raw := strings.Repeat("x", QuoteMaxRunes+50)
	out := FormatReviewComments([]DiffComment{{
		RepoID: "r", Path: "a.go", Side: "old", StartLine: 1, EndLine: 1,
		Quote: raw,
		Body:  "please fix",
	}}, nil)
	if strings.Contains(out, raw) {
		t.Fatal("full quote should not appear")
	}
	if !strings.Contains(out, "…") {
		t.Fatal("expected ellipsis")
	}
}
