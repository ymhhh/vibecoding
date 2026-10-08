# Vibecoding

[English](./README.md) | **简体中文**

本地优先的 AI 自动开发看板：在看板上管理项目与需求，用大模型生成规格，再由 Auto-Dev 自动建分支、改代码、跑测试、提交，最后人工评审合并。

默认数据目录：`~/.vibecoding/`（SQLite、配置、worktree）。

## 界面预览

示例项目「演示商城」：看板上五个阶段各有一条需求（需求分析 → 待办 → 开发中 → 评审中 → 已完成）。

![看板五阶段示例](./docs/images/kanban-stages.png)

打开「需求分析」中的需求，可对话并提炼需求文档 / 开发设计：

![需求分析阶段示例](./docs/images/issue-requirements-stage.png)

---

## 用哪种模式？

两套二进制，数据和 `/api` 相同，启动方式不同：

| 模式 | 构建 / 启动 | 产物 | 得到什么 |
|------|-------------|------|----------|
| **浏览器（日常推荐）** | `make serve` | `./vibecoding-server` | 只起 HTTP：`http://127.0.0.1:8090`，**不**开桌面窗口 |
| **桌面版** | `make run` | `./vibecoding` | 原生窗口；同时也会监听 `:8090`，浏览器也能打开同一套界面 |

文件名故意分开，互相构建不会覆盖。

Docker / CI / 「只要打开网页」→ 用服务版；想要原生窗口 → 用桌面版。

---

## 环境要求

### 通用

- Go 1.21+（macOS 15+ 需 **Go 1.23.3+**；本仓库按 Go 1.25.x）
- Node.js 18+（编前端）
- `git` 在 PATH 里
- 兼容 OpenAI 的 API Key（在应用内配置）

### 仅桌面版

先装一次 Wails，再检查本机：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
# 确保 $(go env GOPATH)/bin 在 PATH 中
make doctor
```

| 系统 | 需要 |
|------|------|
| **macOS** | Xcode 命令行工具（`xcode-select --install`）；系统自带 WKWebView |
| **Windows** 10/11 | [WebView2 运行时](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（一般已预装） |
| **Linux** | GTK3 + WebKit2GTK。具体装什么：`make doctor` 会打印 apt/dnf/pacman 命令 |

Linux 运行时示例（终端用户，非 `-dev`）：

- Debian 12 / Ubuntu 22.04+：`apt install libgtk-3-0 libwebkit2gtk-4.1-0`
- 更老的 4.0 系：`apt install libgtk-3-0 libwebkit2gtk-4.0-37`——或改用服务版 / 用 `-tags webkit2_40` 编桌面版

桌面版 Linux 默认 WebKit2GTK **4.1**。详见 [Wails Linux 发行版支持](https://wails.io/docs/guides/linux-distro-support/)。

### 仅服务版

不需要 WebView / CGO。浏览器可选（`--open`，或自己打开网址）。

---

## 快速开始

### 浏览器（不启桌面 App）

```bash
make serve           # 构建 + 监听 :8090 + 打开浏览器
make serve-bg        # 同上但不自动打开 —— 自行访问 http://127.0.0.1:8090
```

完整重建前端 + 服务版：

```bash
make build-server
./vibecoding-server          # 只监听
./vibecoding-server --open   # 监听并打开浏览器
# 或：make run-server
```

不用 Make：

```bash
cd web && npm install && npm run build && cd ..
make sync-web
CGO_ENABLED=0 go build -tags server -o vibecoding-server ./cmd/vibecoding
./vibecoding-server --open
```

### 桌面版

```bash
make doctor   # 装好环境后跑一次
make build    # → ./vibecoding
./vibecoding  # 原生窗口 + http://127.0.0.1:8090
# 或：make run
```

不用 Make（macOS 还需 `CGO_LDFLAGS="-framework UniformTypeIdentifiers"`）：

```bash
cd web && npm install && npm run build && cd ..
CGO_ENABLED=1 go build -tags "desktop,production" -o vibecoding .
./vibecoding
```

探活：

```bash
curl -s http://127.0.0.1:8090/api/health
```

### 常用参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--addr` | `127.0.0.1:8090` | HTTP 监听地址（两种模式都有） |
| `--data-dir` | `~/.vibecoding` | SQLite、配置、worktree |
| `--open` | 关 | 服务版：启动后打开系统浏览器 |
| `--token` | 空 | 绑非本机地址时必填；也可用环境变量 `VIBECODING_TOKEN` |
| `--log-level` | `info` | `debug` / `info` / `warn` / `error` |
| `--log-format` | `text` | `text` / `json` |
| `--log-output` | `stdout` | `stdout` / `stderr` / `discard` / 文件路径 |

---

## 产品怎么用

1. 打开 **LLM 设置**，填完整的 chat-completions 地址和 API Key（只存在本地 SQLite）。
2. 可选：在同一设置里选 **编码执行器**——默认内置 LLM（VibeBot）；也可换本机已装好并登录的 Claude Code / Cursor / Codex / 自定义 CLI。
3. 创建 **项目**，添加本地 git 仓库路径，点 **Validate path** 校验。可选：在项目设置的 **文档提示词模板** 里自定义需求文档 / 开发设计的系统提示词（见下节）。
4. 创建 **需求（Issue）**，和 AI 对话，提炼 **需求文档**，再写 **开发设计（Dev Spec）**。大需求可拆成子需求，各自一份 Spec。
5. **确认规格 → Backlog → 启动自治开发**。编码在隔离 worktree：`{data-dir}/worktrees/{issueID}/{repoID}/`，不动你主仓库当前工作区。有子需求时按序实施，每个子需求一次提交。
6. 看实时日志。成功后进 **In Review**，有真实文件树、unified diff、质量门禁。测试失败会自愈若干轮；仍失败则回 Backlog，并保留 worktree 方便对照。
7. **Approve & Merge** 在本地把特性分支合进默认分支（若默认分支正被 checkout 且 dirty 会拒绝）。可选 **发布到远端**：push，本机有 `gh` 时再试着开 PR。

设计说明：[docs/autodev-isolation-executor-review.md](./docs/autodev-isolation-executor-review.md)。后续规划：[docs/review-loop-executor-override.md](./docs/review-loop-executor-override.md)。

### 项目级文档提示词模板

不同项目对需求文档、开发设计的章节结构与术语要求可能不同。可在 **项目设置 → 文档提示词模板** 配置两套可选模板：

| 模板 | 生效时机 |
|------|----------|
| 需求文档提示词 | 提炼 / 修订需求文档（`POST /api/issues/{id}/req-doc`） |
| 开发设计提示词 | 生成 / 修订开发设计（设计 pass 2） |

- **留空** = 使用内置默认提示词，行为与未配置时一致。
- 模板挂在**项目**上，该项目下所有 Issue 共用；不支持单条 Issue 覆盖，也不按仓库拆多套。
- 只替换对应的 **system prompt**；源码摘录、对话上下文、JSON 回写与解析流程不变。
- 自定义时须保留 JSON 契约字段（如 `chatReply`、`rawMarkdown` 及结构化字段），否则提炼/设计会失败。可用「恢复默认」一键回到内置文案，「清空」则改回使用内置。
- 开发设计模板可用 `{{scope}}` 表示当前范围标签（整单或某个子需求）；未写占位符时后端会自动追加一条 scope 约束。
- **不在此配置**：头脑风暴 Chat、拆分子需求、选文件 pass 1、以及 Auto-Dev / 执行器提示词（执行器用全局设置；仓库约定见下方 `AGENTS.md`）。

### 给仓库写约定（`AGENTS.md`）

**应用里没有这项配置。** 在每个关联 git 仓库的**根目录**放文件：

| 文件 | 说明 |
|------|------|
| `AGENTS.md` | 优先。写测试/ lint 怎么跑、命名规则、别动哪些目录等 |
| `CLAUDE.md` | 没有 `AGENTS.md` 时才用 |
| `README.md` | 有的话会额外带一段摘要 |

Auto-Dev 启动时从本地仓库路径读入并注入编码 prompt。在仓库里改好、提交，下次跑就会生效。仓库根目录示例见 [`docs/demo-repo/AGENTS.md`](./docs/demo-repo/AGENTS.md)。

### 编码执行器（可选）

| 预设 | 二进制 | 说明 |
|------|--------|------|
| 内置 LLM |（应用设置） | 默认，用你配的 OpenAI 兼容 Key |
| Claude | `claude` | 自行安装并登录 Claude Code |
| Cursor | `cursor-agent` 或 `agent` | **不要**再传 Cursor 的 `--worktree`——Auto-Dev 已把隔离 worktree 设为 cwd |
| Codex | `codex` | OpenAI Codex CLI |
| Custom | 自定义命令 | Args 里要有 `{prompt}`，和/或开 stdin |

跳过权限（YOLO）只因为 cwd 是**隔离 worktree**，不是你的主工作区。应用不会把自家 LLM Key 传给这些 CLI。

---

## 开发调试

桌面热重载：

```bash
make doctor
make dev-desktop
```

服务版 + Vite：

```bash
# 终端 1
make backend && ./vibecoding-server

# 终端 2
make dev   # http://localhost:3000 —— /api 代理到 :8090
```

---

## Docker（服务镜像）

```bash
docker build -t vibecoding .
docker run --rm -p 8090:8090 \
  -e VIBECODING_TOKEN=change-me \
  -v "$HOME/.vibecoding:/data" \
  -v "$HOME/Codes:/Codes" \
  vibecoding --addr 0.0.0.0:8090 --data-dir /data
```

- 访问：`http://127.0.0.1:8090`（提示时填同一 token）
- 应用里仓库路径填**容器内**看到的路径（例如 `/Codes/...`）

---

## 发版

```bash
make release
```

在 `dist/release/` 生成可交叉编译的 `vibecoding-server-*`，以及当前机器的一份 `vibecoding-desktop-<os>-<arch>`。桌面版这里不好交叉编译，请在目标系统上分别构建。

---

## 安全说明

- 默认只绑本机（`127.0.0.1`）。需要远程访问再用 `0.0.0.0`。
- 非本机地址**必须**带 `--token` 或 `VIBECODING_TOKEN`。请求加 `Authorization: Bearer <token>` 或 `X-Vibecoding-Token`（EventSource 可用 `?token=`）。
- API Key 存在 `--data-dir` 下的本地 SQLite，不写进前端。
- Auto-Dev 只在 `{data-dir}/worktrees/...` 的特性分支上写代码，不会 checkout 你的主工作区。
- 默认分支正被 checkout 且工作区 dirty 时，合并会拒绝——先 commit 或 stash。

## 许可证

[MIT](./LICENSE) © 2026 Henry Huang
