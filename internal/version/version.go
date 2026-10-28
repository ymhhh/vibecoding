// Package version holds the app version stamped into history and /api/health.
package version

// Version is overridden at link time:
//
//	go build -ldflags "-X github.com/ymhhh/vibecoding/internal/version.Version=1.2.3"
var Version = "0.1.0"
