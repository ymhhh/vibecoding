package issueimport

import "fmt"

// Error is a user-facing import failure.
type Error struct {
	Code    string // unsupported_host | not_an_issue | needs_token | fetch_failed | invalid_url
	Message string
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func errUnsupported(raw string) *Error {
	return &Error{
		Code:    "unsupported_host",
		Message: fmt.Sprintf("unsupported issue link host: %q is not recognized yet", raw),
	}
}

func errNotAnIssue(host, reason string) *Error {
	return &Error{
		Code:    "not_an_issue",
		Message: fmt.Sprintf("%s: %s", host, reason),
	}
}

func errNeedsToken(host string) *Error {
	return &Error{
		Code:    "needs_token",
		Message: fmt.Sprintf("a read-only %s token is required to import this private issue", host),
	}
}

func errFetch(host string, err error) *Error {
	return &Error{
		Code:    "fetch_failed",
		Message: fmt.Sprintf("%s: %v", host, err),
	}
}

func errInvalidURL(msg string) *Error {
	return &Error{Code: "invalid_url", Message: msg}
}
