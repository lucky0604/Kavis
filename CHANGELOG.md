# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
