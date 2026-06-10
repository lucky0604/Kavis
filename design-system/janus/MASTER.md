# Janus 极简设计系统 (Design System MASTER)

> 💡 **核心理念：** 借鉴 Cursor 与 Claude Desktop 的设计美学，追求**极简、干净、高质感、内容优先**。去除一切繁杂的边框、大面积高饱和度卡片和刺眼的投影，通过精致的微弱冷色调、极细边框（1px border）、优雅的排版（Typography-first）和细腻的微动效，打造专业级 IDE 与 AI 助手的桌面级质感。

---

**项目名称:** Janus (AI 编码助手)  
**更新时间:** 2026-06-10  
**设计风格:** 极简主义冷色调 (Minimalist Calm & Deep-Ink)  
**目标竞品:** Cursor, Claude Desktop, Linear  

---

## 1. 核心设计原则 (Core Principles)

1. **内容即界面 (Content as Interface)**  
   减少不必要的装饰性卡片和边框。让 AI 生成的代码、文本和用户的输入成为视觉重心。
2. **精致的物理质感 (Subtle Texture)**  
   使用极细的 1px 边框（`border-color` 采用半透明或极淡的冷灰色），以及高扩散、低浓度的弥散阴影（`shadow`），营造出如实体纸张或精致毛玻璃般的层级感。
3. **克制的色彩 (Restrained Colors)**  
   以深邃的墨黑、深炭灰（暗色）和极净的灰白、纯白（亮色）为基调。强调色（Accent）采用优雅的青绿（Teal）或冷蓝，且仅在激活状态、发送按钮等关键触点上克制地使用。
4. **平滑的微动效 (Calm Transitions)**  
   所有的悬浮（Hover）、聚焦（Focus）和切换状态都必须带有 `150ms-200ms ease-out` 的平滑过渡，杜绝瞬间闪烁或过大范围的变形，保持界面的沉静感。

---

## 2. 全局设计 Token (Global Tokens)

### 2.1 色彩系统 (Color Palette)

| 角色 | 暗黑模式 (Dark Mode) | 亮色模式 (Light Mode) | CSS 变量 | 设计意图 |
| :--- | :--- | :--- | :--- | :--- |
| **主背景** | `#0B0F17` (深墨黑) | `#F8FAFC` (灰白) | `--color-bg-primary` | 侧边栏和底层背景，深邃沉静 |
| **场景背景** | `#0F1420` (深炭灰) | `#FFFFFF` (纯白) | `--color-bg-scene` | 聊天区域和主工作区，高对比度 |
| **悬浮背景** | `rgba(255,255,255,0.03)` | `rgba(0,0,0,0.02)` | `--color-bg-hover` | 极其轻微的悬浮反馈 |
| **激活背景** | `rgba(13,148,136,0.08)` | `rgba(13,148,136,0.05)` | `--color-bg-active` | 淡淡的青色或灰色激活态 |
| **默认边框** | `#1E293B` (深灰) | `#E2E8F0` (浅灰) | `--color-border-default` | 极细的分割线，低存在感 |
| **微妙边框** | `#161E2E` (极暗灰) | `#F1F5F9` (极浅灰) | `--color-border-subtle` | 侧边栏内部或次要分割线 |
| **主要文字** | `#F8FAFC` (高亮白) | `#0F172A` (深板岩) | `--color-text-primary` | 极高的易读性，舒适不刺眼 |
| **次要文字** | `#94A3B8` (冷灰) | `#475569` (深灰) | `--color-text-secondary` | 描述、元数据、旁白文字 |
| **静音文字** | `#64748B` (暗灰) | `#94A3B8` (浅灰) | `--color-text-muted` | 占位符、时间戳、禁用状态 |
| **强调色-500** | `#0D9488` (优雅青) | `#0D9488` (优雅青) | `--color-accent-500` | 核心品牌色，用于关键触点 |
| **强调色-400** | `#14B8A6` (亮青) | `#0F766E` (深青) | `--color-accent-400` | 悬浮或高亮时的强调色 |

### 2.2 阴影与圆角 (Shadows & Radius)

- **圆角 (Border Radius)**：
  - `var(--radius-sm)`: `6px`（小按钮、标签、小药丸）
  - `var(--radius-md)`: `8px`（Session 项、中等按钮）
  - `var(--radius-lg)`: `12px`（Composer 输入框、Message 气泡）
  - `var(--radius-xl)`: `16px`（弹窗、大卡片）
  *（注：相比之前 10px/16px/24px 的大圆角，缩小圆角能让界面显得更硬朗、精致、专业）*

- **阴影 (Shadows)**：
  - `var(--shadow-sm)`: `0 1px 2px rgba(0, 0, 0, 0.02)`（普通卡片）
  - `var(--shadow-md)`: `0 4px 16px rgba(0, 0, 0, 0.04)`（输入框悬浮）
  - `var(--shadow-lg)`: `0 8px 32px rgba(0, 0, 0, 0.06)`（下拉菜单、弹窗）

---

## 3. 关键面板与组件美化规范 (Component Specifications)

### 3.1 侧边栏与会话列表 (NavBar & Session List)

*借鉴 Claude Desktop 的左侧栏设计，极致干净，去除一切喧宾夺主的元素。*

- **当前简陋设计的问题**：
  - New Chat 按钮采用虚线边框，显得廉价且不稳重。
  - Session 激活态（`sessionItemActive`）使用了极深的青色背景（`--color-accent-900`）和亮色文字，色块过重，割裂了左侧栏的整体感。
  - 删除按钮（Delete）样式粗糙，容易误触。
- **优化美化规范**：
  - **New Chat 按钮**：去除虚线边框，改用无边框或极细的实线边框。背景采用透明，悬浮时呈现极其微弱的冷灰背景（`var(--color-bg-hover)`）。左侧带有一个精致的 `+` 号。
  - **Session 列表项**：
    - 默认状态：完全透明背景，文字为次要文字（`var(--color-text-secondary)`）。
    - 悬浮状态：背景变为极淡的冷灰（`var(--color-bg-hover)`），文字变亮。
    - 激活状态：背景采用极淡的青色半透明（`rgba(13, 148, 136, 0.08)`）或精致的冷灰，**左侧边缘带有一条 2px 宽、12px 高的精致青色垂直指示线**。文字高亮为主要文字，不再使用大面积深色块。
  - **删除按钮**：默认完全隐藏（`opacity: 0`），仅在 Session 项处于 Hover 状态时才以 `opacity: 0.4` 渐显。鼠标悬浮在删除按钮上时，变为红色（`var(--color-error)`）且 `opacity: 1`。

### 3.2 智能输入框 (Composer / ChatInput)

*借鉴 Cursor 的悬浮 Composer 设计，像一个精致的文本编辑器。*

- **当前简陋设计的问题**：
  - 输入框是一个普通的圆角盒子，边框较粗，聚焦时直接套用亮色 focus ring，缺乏精致感。
  - 内部的 `textarea` 样式和高度自适应不够平滑。
  - 角色选择器（`RoleSelector`）和发送按钮布局紧凑，没有呼吸感。
- **优化美化规范**：
  - **外层容器 (ComposerInner)**：
    - 背景采用稍微亮一点的深色（`var(--color-bg-scene)` 或 `var(--color-bg-elevated)`），带有 `1px solid var(--color-border-default)` 极细边框。
    - 带有微弱的弥散阴影（`var(--shadow-md)`），使其微微悬浮于聊天区上方。
    - 聚焦时（`:focus-within`），边框平滑过渡到 `var(--color-accent-500)`（青色），但**不使用粗暴的 outline**，而是使用极淡的青色阴影（`0 0 0 3px rgba(13, 148, 136, 0.15)`）进行发光。
  - **输入文本域 (Textarea)**：
    - 完全去除边框和 outline，背景完全透明。
    - 字体使用系统默认的高级无衬线字体，字号为 `14px`，行高 `1.5`。
    - 自适应高度过渡平滑，最大高度限制在 `200px`，超出时显示精致的滚动条。
  - **发送/停止按钮**：
    - 默认禁用状态下，发送按钮为透明背景，文字为静音灰色，不显眼。
    - 有输入内容时，发送按钮激活，背景变为精致的青色（`var(--color-accent-500)`），文字为白色，带有平滑的 Hover 缩放/变亮效果。
    - 停止按钮（Streaming 状态）采用淡红色半透明背景，中间是一个精致的实心小方块，悬浮时变红。

### 3.3 消息列表与气泡 (Message List & Bubbles)

*借鉴 Claude Desktop 的 Typography-first 理念，去除助手消息的卡片感，让阅读代码和文本极其流畅。*

- **当前简陋设计的问题**：
  - 用户消息气泡使用了非常深的青色背景（`--color-accent-900`），在暗色模式下显得沉闷，且文字对比度不够高。
  - 助手消息虽然没有卡片，但 Markdown 的排版（标题、列表、段落间距）不够精致，代码块（pre/code）的背景和边框不够细腻。
  - 工具调用块（`ToolCallBlock`）和系统事件卡片占用面积过大，图标和文字排版不够紧凑。
- **优化美化规范**：
  - **用户消息气泡 (User Message)**：
    - 不再使用深色高饱和度背景。
    - 改用**极简的冷灰/深灰气泡**：暗色模式下使用背景 `#1E293B`（或 `rgba(255,255,255,0.04)`）和极细边框 `1px solid var(--color-border-default)`；亮色模式下使用背景 `#F1F5F9` 和边框 `1px solid var(--color-border-default)`。
    - 文字颜色为主要文字（`var(--color-text-primary)`），保持极高的易读性和冷淡的高级感。
  - **助手消息 (Assistant Message)**：
    - 保持无卡片设计，纯文本排版。
    - **Markdown 优化**：
      - 标题（h1, h2, h3）字重设为 `500` 或 `600`（不要过粗），颜色为高亮白/深板岩，段前间距适中。
      - 列表（ul, ol）缩进精致，行间距紧凑。
      - 段落（p）行高设为 `1.6`，字间距（letter-spacing）微调，阅读体验极佳。
      - 行内代码（inline code）采用淡淡的背景色（`rgba(255,255,255,0.05)`）和极细的边框，字体为 `JetBrains Mono`。
      - 代码块（code block pre）背景采用极深的黑色（`#090D13`），带有 `1px solid var(--color-border-default)` 边框，圆角为 `8px`，带有平滑的横向滚动。
  - **工具调用块 (ToolCallBlock) & 事件卡片**：
    - 采用**极简的“小药丸”或“微型卡片”设计**。
    - 背景与聊天区背景融为一体，仅用极细的边框区分。
    - 图标和文字字号缩小（`12px`），Spinner 采用极细的 1.5px 线条，使其在界面中处于“静音”状态，不打扰用户的阅读视线。

---

## 4. 交互与动效规范 (Interaction & Motion)

### 4.1 鼠标指针与反馈 (Cursor & Feedback)

- 任何可点击、可交互的元素（按钮、Session 项、Mode 切换项、折叠面板）都**必须**显式加上 `cursor: pointer`。
- 悬浮反馈必须是平滑的颜色渐变（`transition: background var(--duration-fast), border-color var(--duration-fast)`），过渡时间统一为 `150ms`。
- 严禁使用会导致布局抖动（Layout Shift）的 Hover 样式（例如在 Hover 时改变 border 宽度、改变 font-weight、或者改变外边距）。

### 4.2 键盘导航与聚焦 (Focus States)

- 聚焦状态（Focus Ring）必须清晰可见，但要优雅。
- 统一使用 `outline: none`，并用 `box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.2)` 或平滑改变 `border-color` 来表示聚焦。

---

## 5. 防加戏与去 Slop 规范 (Anti-Slop Guidelines)

- ❌ **严禁使用 Emoji 作为 UI 图标**：在 Session 列表、NavBar、按钮等界面中，一律使用精致的 SVG 线条图标（如 Lucide、Heroicons），绝不使用 🎨 🚀 ⚙️ 等 Emoji。
- ❌ **严禁使用粗暴的大投影**：所有阴影必须是弥散、高扩散、低浓度的（如 alpha 值为 0.02 - 0.05），避免出现脏、黑的阴影边缘。
- ❌ **严禁使用纯饱和度色彩**：所有的背景色和文字色都必须经过冷色调调和（如加入微弱的蓝色、灰色或青色底色），避免使用纯黑（#000）或纯白（#FFF，除了亮色主背景外）。

---

> 🎯 **执行承诺：** Janus 的前端代码将严格按照此 MASTER 规范进行重构，确保视觉效果达到 Cursor / Claude Desktop 的一流水准。
