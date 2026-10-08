package model

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// QuoteMaxRunes truncates selected diff text stored on a DiffComment.
const QuoteMaxRunes = 2048

// TruncateQuote keeps at most QuoteMaxRunes runes, appending an ellipsis when cut.
func TruncateQuote(s string) string {
	s = strings.TrimRight(s, "\n")
	if utf8.RuneCountInString(s) <= QuoteMaxRunes {
		return s
	}
	runes := []rune(s)
	return string(runes[:QuoteMaxRunes]) + "…"
}

// FormatReviewComments builds the rework prompt appendix from inline diff comments.
func FormatReviewComments(comments []DiffComment, repoName func(repoID string) string) string {
	if len(comments) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("Review comments (fix these hunks; do not unrelated refactors):\n")
	wrote := 0
	for _, c := range comments {
		if CommentStatus(c) == CommentFixed {
			continue
		}
		wrote++
		name := strings.TrimSpace(c.RepoID)
		if repoName != nil {
			if n := strings.TrimSpace(repoName(c.RepoID)); n != "" {
				name = n
			}
		}
		if name == "" {
			name = "repo"
		}
		path := strings.TrimSpace(c.Path)
		if path == "" {
			path = "(unknown)"
		}
		side := strings.TrimSpace(c.Side)
		if side == "" {
			side = "new"
		}
		start, end := c.StartLine, c.EndLine
		if end < start {
			start, end = end, start
		}
		fmt.Fprintf(&b, "- [%s] %s:%s:%d-%d\n", name, path, side, start, end)
		if q := TruncateQuote(c.Quote); q != "" {
			fmt.Fprintf(&b, "  \"\"\"%s\"\"\"\n", q)
		}
		if body := strings.TrimSpace(c.Body); body != "" {
			fmt.Fprintf(&b, "  %s\n", body)
		}
	}
	if wrote == 0 {
		return ""
	}
	return strings.TrimRight(b.String(), "\n")
}
