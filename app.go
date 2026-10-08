//go:build desktop || bindings

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/ymhhh/go-common/logger"
	"github.com/ymhhh/vibecoding/internal/appbootstrap"
	"github.com/ymhhh/vibecoding/internal/config"
)

// Keep in sync with web/src/lib/attachments.ts MAX_ATTACHMENT_BYTES / MAX_PDF_ATTACHMENT_BYTES / MAX_ISSUE_ATTACHMENTS.
const (
	maxAttachmentBytes    = 2 * 1024 * 1024
	maxPdfAttachmentBytes = 10 * 1024 * 1024
	maxOpenAttachments    = 12
)

// OpenedAttachmentFile is a desktop file-picker result for issue attachments.
type OpenedAttachmentFile struct {
	Name string `json:"name"`
	Mime string `json:"mime"`
	Size int64  `json:"size"`
	Data string `json:"data"` // raw bytes, standard base64
}

// App is the Wails-bound application (lifecycle only; API stays on HTTP).
type App struct {
	ctx        context.Context
	boot       *appbootstrap.App
	cfg        *config.Config
	httpServer *http.Server
}

func NewApp(cfg *config.Config, boot *appbootstrap.App) *App {
	return &App{cfg: cfg, boot: boot}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startLocalHTTP()
}

func (a *App) shutdown(ctx context.Context) {
	if a.httpServer != nil {
		shCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = a.httpServer.Shutdown(shCtx)
	}
	if a.boot != nil {
		_ = a.boot.Close()
	}
}

// startLocalHTTP serves the same API + SPA on cfg.Addr so a system browser can
// open the board while the desktop window is running.
func (a *App) startLocalHTTP() {
	if a == nil || a.cfg == nil || a.boot == nil {
		return
	}
	addr := strings.TrimSpace(a.cfg.Addr)
	if addr == "" {
		return
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           a.boot.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	a.httpServer = srv
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		logger.L().WithError(err).WithField("addr", addr).Warn("browser HTTP listen skipped (desktop window still works)")
		a.httpServer = nil
		return
	}
	logger.L().WithField("addr", addr).Info("also listening for browser")
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			logger.L().WithError(err).Warn("browser HTTP server stopped")
		}
	}()
}

func sanitizeExportFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "dev-spec.md"
	}
	name = filepath.Base(name)
	var b strings.Builder
	lastDash := false
	for _, r := range name {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|':
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		default:
			b.WriteRune(r)
			lastDash = false
		}
	}
	out := strings.Trim(b.String(), "-. ")
	if out == "" {
		out = "dev-spec.md"
	}
	if !strings.HasSuffix(strings.ToLower(out), ".md") {
		out += ".md"
	}
	return out
}

func downloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, "Downloads")
	if st, err := os.Stat(dir); err == nil && st.IsDir() {
		return dir, nil
	}
	return home, nil
}

func uniquePath(dir, name string) string {
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err != nil {
		return path
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
		if _, err := os.Stat(candidate); err != nil {
			return candidate
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, time.Now().Unix(), ext))
}

// SaveTextFileToDownloads writes contents into ~/Downloads (no dialog).
// Preferred for the "导出下载" button: WKWebView save dialogs often open behind
// the Issue modal and look like a no-op when cancelled.
func (a *App) SaveTextFileToDownloads(defaultFilename, contents string) (string, error) {
	if a == nil {
		return "", fmt.Errorf("desktop app is not ready")
	}
	dir, err := downloadsDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := sanitizeExportFilename(defaultFilename)
	path := uniquePath(dir, name)
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// SaveTextFile opens a native save dialog and writes contents to the chosen path.
// An empty return path means the user cancelled.
func (a *App) SaveTextFile(defaultFilename, contents string) (string, error) {
	if a == nil || a.ctx == nil {
		return "", fmt.Errorf("desktop app is not ready")
	}
	name := sanitizeExportFilename(defaultFilename)
	opts := wailsruntime.SaveDialogOptions{
		Title:                "Export Dev Spec",
		DefaultFilename:      name,
		CanCreateDirectories: true,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	}
	if dir, err := downloadsDir(); err == nil {
		opts.DefaultDirectory = dir
	}
	// Bring the app forward so the sheet is not stuck behind the Issue modal.
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowUnminimise(a.ctx)
	path, err := wailsruntime.SaveFileDialog(a.ctx, opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(path) == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func attachmentByteLimit(path string) int64 {
	if strings.EqualFold(filepath.Ext(path), ".pdf") {
		return maxPdfAttachmentBytes
	}
	return maxAttachmentBytes
}

// OpenAttachmentFiles opens a native multi-select dialog and returns file
// contents as base64. Prefer this over <input type="file"> in WKWebView: HTML
// file pickers and Wails sheet dialogs often open as a blank white panel over
// the Issue modal and then dismiss / crash the window on macOS.
//
// An empty slice means the user cancelled.
func (a *App) OpenAttachmentFiles() ([]OpenedAttachmentFile, error) {
	if a == nil {
		return nil, fmt.Errorf("desktop app is not ready")
	}
	paths, err := a.pickAttachmentPaths()
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return []OpenedAttachmentFile{}, nil
	}
	if len(paths) > maxOpenAttachments {
		paths = paths[:maxOpenAttachments]
	}
	out := make([]OpenedAttachmentFile, 0, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		st, err := os.Stat(path)
		if err != nil {
			continue
		}
		if st.IsDir() || st.Size() <= 0 || st.Size() > attachmentByteLimit(path) {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		mime := http.DetectContentType(raw)
		if mime == "application/octet-stream" {
			ext := strings.ToLower(filepath.Ext(path))
			switch ext {
			case ".md", ".markdown", ".txt", ".log", ".csv", ".json", ".yaml", ".yml":
				mime = "text/plain; charset=utf-8"
			case ".png":
				mime = "image/png"
			case ".jpg", ".jpeg":
				mime = "image/jpeg"
			case ".gif":
				mime = "image/gif"
			case ".webp":
				mime = "image/webp"
			case ".svg":
				mime = "image/svg+xml"
			case ".pdf":
				mime = "application/pdf"
			}
		}
		out = append(out, OpenedAttachmentFile{
			Name: filepath.Base(path),
			Mime: mime,
			Size: st.Size(),
			Data: base64.StdEncoding.EncodeToString(raw),
		})
	}
	return out, nil
}

// pickAttachmentPaths returns filesystem paths from a platform file dialog.
// On macOS we deliberately avoid Wails OpenMultipleFilesDialog: that API uses
// beginSheetModalForWindow, which paints a blank white sheet over WKWebView
// modals. osascript "choose file" opens a separate app-modal dialog instead.
func (a *App) pickAttachmentPaths() ([]string, error) {
	if runtime.GOOS == "darwin" {
		return pickAttachmentPathsMacOS()
	}
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop app is not ready")
	}
	opts := wailsruntime.OpenDialogOptions{
		Title:                "Select attachments",
		CanCreateDirectories: false,
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "Common attachments",
				Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.pdf;*.md;*.txt;*.json;*.yaml;*.yml;*.csv;*.log",
			},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	}
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowUnminimise(a.ctx)
	paths, err := wailsruntime.OpenMultipleFilesDialog(a.ctx, opts)
	if err != nil {
		return nil, err
	}
	return paths, nil
}

func pickAttachmentPathsMacOS() ([]string, error) {
	// -128 = user cancelled. Return empty paths (not an error) so the UI stays put.
	const script = `
try
	set theFiles to choose file with prompt "选择附件" with multiple selections allowed
on error number -128
	return ""
end try
set out to ""
repeat with f in theFiles
	set out to out & (POSIX path of f) & linefeed
end repeat
return out
`
	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.Output()
	if err != nil {
		// Cancel / dialog failure → treat as no selection.
		return []string{}, nil
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return []string{}, nil
	}
	var paths []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths, nil
}

// RevealInFinder shows path in the system file manager (Finder / Explorer / file manager).
func (a *App) RevealInFinder(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("empty path")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// WindowToggleMaximise toggles the native desktop window maximize state.
func (a *App) WindowToggleMaximise() {
	if a == nil || a.ctx == nil {
		return
	}
	wailsruntime.WindowToggleMaximise(a.ctx)
}

// WindowIsMaximised reports whether the desktop window is currently maximised.
func (a *App) WindowIsMaximised() bool {
	if a == nil || a.ctx == nil {
		return false
	}
	return wailsruntime.WindowIsMaximised(a.ctx)
}
