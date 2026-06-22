# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-06-22

### Added
- Multi-CLI session management: native session ID tracking enables session resume across restarts for Claude Code, Codex, and OpenCode.
- Automatic handoff context assembly when switching between different CLI agents, preserving conversation history.
- Model compatibility checking warns users when a CLI-model combination is known to fail (e.g., Codex + DeepSeek).
- Resume mode with automatic fallback: if native resume fails, the system retries in fresh mode without user intervention.
- InspectorPane now supports three tabs (Tools, Raw Events, Context) for real-time debugging of CLI execution.
- CLI badge on assistant messages shows which agent generated each response.

### Changed
- Subprocess runner now deduplicates stream-json output (text_final vs text_delta), preventing duplicated content.
- Session store uses snapshot mode for Code Mode, avoiding duplicate messages on reload.
- Non-git project support: git operations are skipped gracefully when workspace lacks a `.git` directory.

### Fixed
- Race condition in CLI session tracker: file writes now use atomic write-then-rename to prevent data loss under concurrent access.
- Stored prompt injection risk: handoff context now includes a warning boundary to prevent adversarial instructions from replaying across agents.
- Extracted magic numbers to named constants and migrated inline styles to CSS modules for maintainability.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="bash">
<｜｜DSML｜｜parameter name="command" string="true">git add VERSION CHANGELOG.md && git commit -m "chore: bump version to 0.3.0 and update CHANGELOG"

### Added
- Bing search as third fallback engine for `web_search` tool (works where DuckDuckGo is blocked, e.g. China). Falls through: Tavily → DuckDuckGo → Bing.

### Changed
- `resolveToolPath` now falls back to `process.cwd()` when no workspace is configured, so file tools work out of the box in packaged AppImage builds without manual workspace setup.

### Fixed
- `workspacePath.trim()` crashes when the client omits `workspacePath` from the JSON request body.
- Sensitive path patterns (`.ssh`, `.aws`, `.gpg`, credentials) now checked on relative paths resolved against any workspace root, not just absolute paths.
- Symlink escape: sensitive path patterns re-checked after symlink resolution to prevent bypass via symlinks within workspace.
- Stale `main.js` build artifact (55k lines of bundled JS) removed from repo root, added to `.gitignore`.

### Security
- `validatePath()` now applies `BLOCKED_ABSOLUTE_PREFIXES` and `SENSITIVE_PATH_PATTERNS` checks for parity with `resolveAbsolutePath()`.
- Bing search HTTP error path properly destroys connection to prevent socket leaks.

## [0.2.7] - 2026-06-19

### Fixed
- AppImage 打包后启动白屏：修复 esbuild 将 npm 包（openai, better-sqlite3 等）打包进 ESM bundle 导致 Dynamic require 失败
- `better-sqlite3` 升级至 12.11.1，兼容 Electron 42 的 V8 API 变更
- `vite build` 默认 `emptyOutDir` 清空 tsc 服务端编译产物 → 设置 `emptyOutDir: false`
- 导入路径错误：`../server/prod.js`（tsx 引导脚本）→ `../dist/server/prod.js`（编译产物）
- Prompt 文件在打包后路径漂移 → `createJanusServer` 新增 `promptsDir` 参数，从 `app.getAppPath()` 传入
- GPU vaapi/Vulkan 错误日志噪音 → 添加 `app.disableHardwareAcceleration()`
- Dev 模式下 agent 注册缺失 → `configureApiRoutes` 中补充 `registerAllAgents` 调用
- 版本号格式 `0.2.6.0` 修正为 semver 兼容的 `0.2.7`

### Changed
- esbuild 构建添加 `--packages=external`，服务端应用代码打包但 npm 依赖保持外部引用
- 生产模式启动失败改为弹框提示，方便诊断

## [0.2.6.0] - 2026-06-18

### Added
- Session auto-naming: conversations now get descriptive titles instead of "Session xxxxxxxx"
- Two-layer naming: instant snippet from first message (20 chars), then LLM-generated title (3-6 words)
- `nameSource` field on SessionMeta to track name provenance and prevent overwrites
- `POST /api/sessions/{id}/regenerate-title` endpoint for code mode title generation

### Fixed
- `saveSession` no longer overwrites session names on every turn (now delegates to `upsertSession`)

## [0.2.5.0] - 2026-06-12

### Added
- Code Mode with multi-agent CLI relay architecture (Claude Code, OpenCode, Codex)
- Code Mode frontend scenes: ComposerConsole with bottom-sheet pickers, OnboardingDashboard
- CLI detection and management via `server/code-mode/cli-registry.ts`
- Git auto-syncing for Code Mode sessions (stash/sync/restore via `git-syncer.ts`)
- Subprocess-based CLI runner with PTY support (`server/code-mode/subprocess-runner.ts`)
- Multi-agent handoff with context preservation (todos, stash, commit anchoring) via `handoff-helper.ts`
- SSE streaming relay from external CLIs via `server/code-mode/stream-routes.ts`
- Onboarding API (`/onboarding/status`) for workspace Git status, CLI availability, and API key checks
- Terminal Spike exploration scene for interactive terminal access
- Narrow-screen responsive picker sheets for CLI and model selection (<768px)
- Electron PTY shell support with IPC bridge (`electron/pty-manager.ts`)

### Changed
- Operating mode + agent role architecture replaces legacy agentId system
- App layout refactored for scene-based routing (welcome, chat, code_mode, terminal_spike, settings)
- Session sidebar redesigned for Work Mode / Code Mode session contexts
- Server routes restructured with `createJanusServer` factory for standalone + Electron
- Chat store extended with `mode`/`role` state management and ProviderConfig
- Session persistence expanded with `agentType`, `projectPath`, and scope-based listing

### Security
- Session ID validation enforces UUID v4 format for all session route parameters

---

## [0.2.4.0] - 2026-06-12

### Added
- Code Mode Onboarding Dashboard showing workspace Git status, CLI availability, and API key configuration
- Runtime validation for API responses to prevent crashes from malformed JSON
- Narrow-screen responsive picker sheets for CLI and model selection (<768px)
- Approval card UI with tool write confirmation, content preview, and timeout handling

### Changed
- Removed empty state placeholder when no session exists — replaced by OnboardingDashboard
- Enhanced ComposerConsole with bottom-sheet picker pattern for mobile devices

---

## [0.2.3.0] - 2026-06-10

### Added
- Chat UI redesign with modern visual hierarchy and enhanced accessibility
- ARIA attributes on all interactive buttons for screen reader support
- Code blocks with copy functionality and syntax highlighting (light + dark themes)
- Message avatars system with sender badges ("You" / "Janus Agent")
- Suggested prompt cards in empty state for quick task initiation
- Sleek pulsing dots thinking loader replacing static text

### Changed
- Removed 6 `!important` CSS declarations from chat input textarea
- Refactored focus ring to outer container instead of fighting browser defaults
- Enhanced theme palette with better contrast ratios (dark: deep ink, light: soft gray)
- Improved message spacing and typography for readability
- Toolbar layout at bottom of composer with keyboard shortcut hints

---

## [0.2.2.0] - 2026-06-10

### Added
- Operating mode + agent role architecture: Work Mode (纯工具) / Code Mode (Agentic/Plan/Ask/Debug)
- Session sidebar: 260px 左侧边栏取代原 48px 图标栏 — 品牌标识、新建聊天、会话历史列表、删除按钮
- Sessions API: list, load, delete session 完整 CRUD
- ModeSelector: Work/Code segmented control in ChatPane 顶部
- RoleSelector: Code role upward dropdown in ChatInput
- Keyboard shortcut: Cmd+. / Ctrl+. 快速切换 Code roles
- `/mode` 和 `/role` 斜杠命令

### Changed
- Chat store 发送 mode+role 替代旧一维 agentId
- ChatPane placeholder 根据 mode/role 动态变化
- 切换 mode/role 保留全部消息历史；`/clear` 才清空会话

### Fixed
- `extractPathSegment()` 目录遍历漏洞修复 — 添加 UUID v4 格式校验
- NavBar 嵌套 `<button>` 修复 — 外层改为 `div[role=button]` + 键盘事件
- 删除 AgentsScene 及相关路由

### Security
- API path segment 参数强制 UUID 格式校验，防止路径遍历攻击

### Added
- Memory system: persistent SQLite/FTS5 memory with session observation, per-turn recall, and background consolidation
- Self-evolution: pattern detector, nudge engine, skill crafting with user review gate
- Electron desktop shell with embedded HTTP server and IPC bridge
- Event cards in chat UI: memory recall, skill review, evolution event notifications
- MCP server config (codegraph) and opencode integration

### Changed
- Server refactored into createJanusServer factory pattern for standalone/Electron dual use
- Agent loop now integrates memory (resident prompt injection + per-turn recall) and evolution (nudge-driven skill crafting)
- npm start now uses tsx to run TypeScript directly
- SSE stream events extended with memory_recall, skill_review, evolution_event

### Fixed
- SPA fallback Content-Type header corrected from 'Content' to 'Content-Type'
- ESM __dirname crash in persistent-memory.ts (fileURLToPath import)
- Circular self-import in server/prod.js
- Missing Electron IPC handlers (select-folder, get-version)
- DB file handle leak in /memory/status endpoint (finally close)
- Evolution system error logs now visible via console.error
- Agent loop MemoryContext properly passed to evolve tool

## [0.2.0] - 2026-06-08

### Added
- Web search tool with Tavily API + DuckDuckGo HTML fallback
- Web fetch tool with SSRF protection, content extraction, and redirect chain validation
- URL validator with DNS resolution, private IP detection, and protocol/domain blocklist
- Content extractor using article-extractor with HTML fallback
- Agent registry with configurable system prompts (work-mode.md)
- Tool UI cards in MessageList: search results with source links, fetch with title/expand
- Tool status indicators (running spinner, done checkmark, error badge)
- Shared ToolMeta type for rich tool rendering

### Fixed
- Repeated "Thinking..." skeleton after tool calls — assistant messages now created on-demand per round
- accumulatedContent cross-round corruption — removed global variable, append delta directly
- DNS TOCTOU vulnerability — lookup callback re-checks private IP at request time
- DuckDuckGo HTML parsing — replaced fragile regex with linkedom DOM parser
- Tavily error message leak — sanitized to avoid exposing API details
- ToolMeta duplicate definition — unified import from shared/types
- Hardcoded color in toolStatusOk — now uses CSS variable with fallback
