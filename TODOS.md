# Kavis Code Mode — UI/UX Design Debt TODOS

以下是经过 `/plan-design-review` 奢华视觉与交互评审后，确定并追加的 UI/UX 设计债务与交互待办事项（TODOS）。这些待办项将由后续的研发人员在实现 Code Mode 时参考并贯彻。

**状态说明：** ✅ 已完成 | 🔧 进行中 | ⏳ 待开始

---

## 1. ✅ 审批栏 Focus Trap 焦点捕获与键盘命令响应

> **实现于:** `src/app/scenes/code-mode/useFocusTrap.ts` + `InspectorPane.tsx`
>
> `useFocusTrap` hook 已集成到 `ApprovalCard`，支持 Tab 焦点循环、Y/N/Escape 快捷键、
> 焦点激活时的脉冲动画视觉反馈，以及 `focus-visible` 按钮轮廓。

---

## 2. ✅ 窄屏自适应 Dual-Dropdown 垂直堆叠与防截断适配

> **实现于:** `src/app/scenes/code-mode/ComposerConsole.tsx` + `ComposerConsole.module.css`
>
> - `@container (max-width: 1024px)` 触发垂直堆叠
> - `@media (max-width: 768px)` 标签隐藏 + 紧凑样式
> - `useIsNarrow()` hook + `PickerSheet` 全屏浮层组件，底部滑入式选择面板

---

## 3. ✅ Onboarding 首次加载环境健康度看板 [已完成]

> **实现于:** `server/code-mode/onboarding-routes.ts` + `src/app/scenes/code-mode/OnboardingDashboard.tsx` + `CodeModeScene.tsx`
>
> - 后端 `/api/onboarding/status` 端点：检测 workspace Git 状态、CLI 可用性与版本、API Key 配置
> - 前端 `OnboardingDashboard` 组件：展示工作区路径/分支、CLI 网格卡片、环境变量状态、CTA 按钮
> - `CodeModeScene` 在无会话时自动展示 Onboarding Dashboard
> - API 响应运行时校验防止畸形 JSON 崩溃
>
> **Completed:** v0.2.4.0 (2026-06-12)

---

## 4. ✅ Git 物理接力协议的数据安全性保护机制 (Engineering Task) [已完成]

> **实现于:** `server/code-mode/git-syncer.ts` + `server/code-mode/handoff-helper.ts`
>
> 已完整实现：`stashActiveChanges()` 执行 `git stash create` → `git reset --hard HEAD` → `git clean -fd`；
> `applyStashedChanges()` 使用 HEAD 校验 + `--ff-only` 合并 + 冲突检测回滚；
> `.janus/handoff.json` 写前日志原子写入。

---

## 5. ✅ node-pty 原生模块主进程隔离与 IPC 优化 (Architecture Task) [已完成]

> **实现于:** `electron/pty-manager.ts` + `electron/preload.ts`
>
> 已完整实现：`node-pty` 仅在主进程通过 `createRequire` 加载；
> IPC 通道 `pty:create/write/resize/kill` 完整；~30fps 输出节流；
> 进程组级别 kill 确保无僵尸进程。

---

## 6. ✅ 独立的布局状态存储 useLayoutStore (Zustand) [已完成]

> **实现于:** `src/stores/app-stores.ts`
>
> 已完整实现：`useLayoutStore`（sidebarWidth/inspectorWidth/ptyHeight）和 `useCodeModeStore`
> 均已从 `useChatStore` 独立为单独的 Zustand store，localStorage 持久化。

---

## 7. ⏳ 前端 Unified Diff 预览 (Unified Diff Preview) [待开始]

> **计划于:** Phase B 之后

- **What**: 在审批卡片中展示高亮的 Git-style 差异对比，而非纯文本预览。
- **Why**: 提升用户在审批 `patch_file` 时的体验，能够极其直观地看清每一行代码的增删改动，防止误操作。
- **Pros**: 极佳的开发者体验 (DX)，建立更强的 AI 信任感。
- **Cons**: 需要在前端引入 diff 解析和高亮渲染组件，增加前端包体积。


