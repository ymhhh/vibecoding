package llm

import (
	"strings"
	"testing"
)

func TestResolveDocSystem(t *testing.T) {
	builtin := "BUILTIN"
	cases := []struct {
		name   string
		custom string
		want   string
	}{
		{"empty", "", builtin},
		{"whitespace", "  \n\t ", builtin},
		{"custom", "CUSTOM", "CUSTOM"},
		{"custom trimmed uses full string", "  keep spaces inside  ", "keep spaces inside"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveDocSystem(tc.custom, builtin)
			if got != tc.want {
				t.Fatalf("ResolveDocSystem(%q) = %q, want %q", tc.custom, got, tc.want)
			}
		})
	}
}

func TestReqDocSystemFallsBack(t *testing.T) {
	if got := ReqDocSystem(""); got != DefaultReqDocSystem {
		t.Fatalf("empty template should use default")
	}
	if got := ReqDocSystem("  my req template  "); got != "my req template" {
		t.Fatalf("got %q", got)
	}
}

func TestDevSpecSystemScope(t *testing.T) {
	got := DevSpecSystem("", "sub-requirement abc")
	if !strings.Contains(got, "sub-requirement abc") {
		t.Fatalf("default should include scope label: %s", got)
	}
	if strings.Contains(got, "{{scope}}") {
		t.Fatalf("placeholder should be replaced")
	}

	custom := "Write a design.\nScope: {{scope}}\nReturn ONLY JSON."
	got = DevSpecSystem(custom, "parent issue")
	if got != "Write a design.\nScope: parent issue\nReturn ONLY JSON." {
		t.Fatalf("got %q", got)
	}

	noPlaceholder := "Custom without placeholder"
	got = DevSpecSystem(noPlaceholder, "parent issue")
	if !strings.Contains(got, "Stay within THIS scope only: parent issue") {
		t.Fatalf("should append scope rule: %s", got)
	}
}
