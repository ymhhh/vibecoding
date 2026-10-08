# Vibecoding

**English** | [简体中文](./README.zh-CN.md)

Local-first AI Auto-Dev board: manage projects and issues on a Kanban, generate Specs with an LLM, then let Auto-Dev create a branch, patch code, run tests, and commit for review.

Default data directory: `~/.vibecoding/` (SQLite + settings + worktrees).

## Screenshots

Sample project **演示商城** with one issue in each Kanban stage (requirements → backlog → in progress → review → completed):

![Kanban with all stages](./docs/images/kanban-stages.png)

Opening a requirements-stage issue to chat and extract Specs:

![Requirements-stage issue](./docs/images/issue-requirements-stage.png)

---

## Which mode?

There are two binaries. Same data and same `/api`, different entry:

| Mode | Build / run | Binary | What you get |
|------|-------------|--------|--------------|
| **Browser (recommended day-to-day)** | `make serve` | `./vibecoding-server` | HTTP on `http://127.0.0.1:8090`, **no** desktop window |
| **Desktop** | `make run` | `./vibecoding` | Native window (Wails). Also listens on `:8090` so a browser can open the same UI |

Names differ on purpose — building one does not overwrite the other.

Use **Server** for Docker / CI / “just open the browser”. Use **Desktop** if you want a native app window.

---

## Requirements

### Always

- Go 1.21+ (macOS 15+ needs **Go 1.23.3+**; this repo targets Go 1.25.x)
- Node.js 18+ to build the web UI
- `git` on PATH
- An OpenAI-compatible API key (configured in the app)

### Desktop only

Install Wails once, then check the machine:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
# ensure $(go env GOPATH)/bin is on PATH
make doctor
```

| OS | Need |
|----|------|
| **macOS** | Xcode Command Line Tools (`xcode-select --install`); built-in WKWebView |
| **Windows** 10/11 | [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually already installed) |
| **Linux** | GTK3 + WebKit2GTK. `make doctor` prints the exact apt/dnf/pacman lines |

Linux runtime examples (end users, not `-dev`):

- Debian 12 / Ubuntu 22.04+: `apt install libgtk-3-0 libwebkit2gtk-4.1-0`
- Older Debian/Ubuntu 4.0: `apt install libgtk-3-0 libwebkit2gtk-4.0-37` — or prefer Server mode / build with `-tags webkit2_40`

Desktop Linux defaults to WebKit2GTK **4.1**. See [Wails Linux distro support](https://wails.io/docs/guides/linux-distro-support/).

### Server only

No WebView / CGO. A browser is optional (`--open`, or open the URL yourself).

---

## Quick start

### Browser (no desktop app)

```bash
make serve           # build + listen on :8090 + open browser
make serve-bg        # same, but do not open browser — visit http://127.0.0.1:8090
```

Full frontend + server rebuild:

```bash
make build-server
./vibecoding-server          # listen only
./vibecoding-server --open   # listen + open browser
# or: make run-server
```

Without Make:

```bash
cd web && npm install && npm run build && cd ..
make sync-web
CGO_ENABLED=0 go build -tags server -o vibecoding-server ./cmd/vibecoding
./vibecoding-server --open
```

### Desktop

```bash
make doctor   # once
make build    # → ./vibecoding
./vibecoding  # native window + http://127.0.0.1:8090
# or: make run
```

Without Make (macOS also needs `CGO_LDFLAGS="-framework UniformTypeIdentifiers"`):

```bash
cd web && npm install && npm run build && cd ..
CGO_ENABLED=1 go build -tags "desktop,production" -o vibecoding .
./vibecoding
```

Health check:

```bash
curl -s http://127.0.0.1:8090/api/health
```

### Flags

| Flag | Default | Notes |
|------|---------|-------|
| `--addr` | `127.0.0.1:8090` | HTTP listen address (both modes) |
| `--data-dir` | `~/.vibecoding` | SQLite, settings, worktrees |
| `--open` | off | Server: open system browser after start |
| `--token` | empty | Required when `--addr` is not loopback; or env `VIBECODING_TOKEN` |
| `--log-level` | `info` | `debug` / `info` / `warn` / `error` |
| `--log-format` | `text` | `text` / `json` |
| `--log-output` | `stdout` | `stdout` / `stderr` / `discard` / file path |

---

## How to use the product

1. Open **LLM settings** — save the full chat-completions URL and API key (stored only in local SQLite).
2. Optionally pick a **coding executor**: built-in LLM (VibeBot) by default, or Claude Code / Cursor / Codex / custom CLI if installed and logged in on this machine.
3. Create a **Project**, add a local git repository path, click **Validate path**. Optionally customize requirement / design **doc prompt templates** in project settings (see below).
4. Create an **Issue**, chat with the AI, extract the **requirement document**, then the **Dev Spec**. Large issues can be split into sub-requirements (each with its own Spec).
5. **Accept Spec → Backlog**, then **Start Auto-Dev**. Work runs in isolated git worktrees under `{data-dir}/worktrees/{issueID}/{repoID}/` so your main checkout stays untouched. One commit per sub-requirement when split.
6. Watch live logs. On success the issue moves to **In Review** with a real file tree, unified diff, and quality-gate results. Failed tests may auto-heal a few rounds; still failing → back to Backlog, worktree kept for inspection.
7. **Approve & Merge** merges the feature branch into the repo default branch locally (refuses if that branch is checked out and dirty). Optional **Publish to remote** pushes and may run `gh pr create` when `gh` is installed.

Design notes: [docs/autodev-isolation-executor-review.md](./docs/autodev-isolation-executor-review.md). Follow-ups: [docs/review-loop-executor-override.md](./docs/review-loop-executor-override.md).

### Project-level doc prompt templates

Projects often need different section structures and terminology for requirement docs and Dev Specs. In **Project settings → Doc prompt templates**, you can set two optional templates:

| Template | When it applies |
|----------|-----------------|
| Requirement document prompt | Extracting / revising the requirement doc (`POST /api/issues/{id}/req-doc`) |
| Development spec prompt | Generating / revising the design doc (design pass 2) |

- **Empty** = built-in default (same behavior as before).
- Templates live on the **project** and apply to every issue in that project. No per-issue override; no per-repo copies.
- Only the matching **system prompt** is replaced. Source excerpts, chat context, and the JSON write-back / parse flow stay the same.
- Keep the JSON contract (`chatReply`, `rawMarkdown`, and structured fields) or extract/design will fail. Use **Restore default** to reload the built-in text, or **Clear** to fall back to built-in without storing a copy.
- In the design template, `{{scope}}` is replaced with the current scope label (parent issue or a sub-requirement). If the placeholder is missing, the server appends a scope rule.
- **Not configured here:** brainstorm chat, requirement split, design file-locate pass 1, or Auto-Dev / executor prompts (executor is global settings; repo conventions use `AGENTS.md` below).

### Tell Auto-Dev about your repo (`AGENTS.md`)

There is **no in-app setting**. Put a file at the **root of each associated git repository**:

| File | When |
|------|------|
| `AGENTS.md` | Preferred — test/lint commands, naming rules, folders not to touch, etc. |
| `CLAUDE.md` | Used only if `AGENTS.md` is missing |
| `README.md` | A short excerpt is also included when present |

On Auto-Dev, Vibecoding reads these from the local repo path and injects them into the coding prompt. Edit and commit in the repo; the next run picks up the change. See a sample at [`docs/demo-repo/AGENTS.md`](./docs/demo-repo/AGENTS.md).

### Coding executors (optional)

| Preset | Binary | Notes |
|--------|--------|-------|
| Built-in LLM | (app settings) | Default. Uses your OpenAI-compatible key. |
| Claude | `claude` | Install/login Claude Code yourself. |
| Cursor | `cursor-agent` or `agent` | Do **not** pass Cursor’s `--worktree` — Auto-Dev already uses its own worktree as cwd. |
| Codex | `codex` | OpenAI Codex CLI. |
| Custom | your command | Args must include `{prompt}`, and/or enable stdin. |

Skip-permissions / YOLO flags are only used because cwd is the **isolated worktree**, not your primary tree. Vibecoding does not forward its LLM API key into these CLIs.

---

## Development

Desktop hot reload:

```bash
make doctor
make dev-desktop
```

Server + Vite (browser against local API):

```bash
# Terminal 1
make backend && ./vibecoding-server

# Terminal 2
make dev   # http://localhost:3000 — /api proxies to :8090
```

---

## Docker (server image)

```bash
docker build -t vibecoding .
docker run --rm -p 8090:8090 \
  -e VIBECODING_TOKEN=change-me \
  -v "$HOME/.vibecoding:/data" \
  -v "$HOME/Codes:/Codes" \
  vibecoding --addr 0.0.0.0:8090 --data-dir /data
```

- UI: `http://127.0.0.1:8090` (enter the same token when prompted)
- Repo paths in the app must be paths **inside** the container (e.g. `/Codes/...`)

---

## Release

```bash
make release
```

Under `dist/release/`: cross-compiled `vibecoding-server-*` for common platforms, plus one `vibecoding-desktop-<host-os>-<arch>` for the machine that ran the command. Desktop is not reliably cross-compiled here — build it on each target OS.

---

## Security

- Default bind is localhost (`127.0.0.1`). Use `0.0.0.0` only when you intend remote access.
- Non-loopback bind **requires** `--token` or `VIBECODING_TOKEN`. Send `Authorization: Bearer <token>` or `X-Vibecoding-Token` (EventSource may use `?token=`).
- API keys live in local SQLite under `--data-dir`, not in the frontend.
- Auto-Dev writes only inside `{data-dir}/worktrees/...` on feature branches; it does not checkout your primary working tree.
- Merge refuses when the default branch is checked out and dirty — commit or stash first.

## License

[MIT](./LICENSE) © 2026 Henry Huang
