<h1 align="center">Understand Anything</h1>
<p align="center">
  <strong>将任意代码库、知识库或文档转化为可探索、可搜索、可对话的交互式知识图谱</strong>
  <br />
  <em>支持 Claude Code、Codex、Cursor、Copilot、Gemini CLI 等多平台。</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.vi-VN.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="#-快速开始"><img src="https://img.shields.io/badge/快速开始-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/许可证-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/项目主页-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/在线演示-00c853" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — 将任何代码库转换为交互式知识图谱" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**当你刚加入一个新团队，面对 20 万行代码，你从哪里开始？**

Understand Anything 是一个 [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference)，通过多智能体（multi-agent）架构分析你的项目，构建包含文件、函数、类以及依赖关系的知识图谱，并提供一个可视化交互界面，帮助你理解整个系统。不再”盲读代码”，而是从全局视角理解系统结构。

> **目标不是用代码库的复杂程度来惊艳你 —— 而是默默告诉你每一块是怎么拼在一起的。**

---

## ✨ 核心功能

> [!NOTE]
> **想直接体验？** 在我们的[主页](https://understand-anything.com/)试试[在线演示](https://understand-anything.com/demo/) — 一个可以平移、缩放、搜索和探索的全交互式仪表盘。

### 探索代码结构图

将你的代码库以交互式知识图谱的形式呈现——每个文件、函数和类都是可点击、可搜索、可探索的节点。选择任意节点即可查看通俗易懂的摘要、依赖关系和引导式学习路径。

### 理解业务逻辑

切换到领域视图，查看代码如何映射到真实的业务流程——以水平图的形式展示领域、流程和步骤。

### 分析知识库

将 `/understand-knowledge` 指向一个 [Karpathy 模式的 LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，即可获得带有社区聚类的力导向知识图谱。确定性解析器从 `index.md` 中提取 wikilinks 和分类，然后 LLM 代理发现隐式关系、提取实体并挖掘论断——将你的 wiki 转化为可导航的互联思想图谱。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 引导式学习</h3>
      <p>自动生成架构学习路径，按依赖顺序学习。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 语义搜索</h3>
      <p>支持模糊搜索 + 语义搜索，例如搜索"哪些部分处理身份验证？"即可在整个图中获取相关结果。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 变更影响分析</h3>
      <p>提交更改前，查看更改会影响系统的哪些部分。了解更改对整个代码库的连锁反应。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 用户角色自适应 UI</h3>
      <p>根据用户类型（初级开发 / 项目经理 / 高级用户）调整其详细程度。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ 层级可视化</h3>
      <p>按架构层级自动分组 — API，服务，数据，UI, 系统工具 — 并附有颜色编码图例。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 语言概念</h3>
      <p>12 种编程模式（泛型、闭包、装饰器等）将在上下文中逐一解释。</p>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

### 1. 安装插件

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

> **使用本地模型？** 出于隐私或企业需求，可以将你的平台指向本地模型提供方，例如 [Ollama](https://docs.ollama.com/integrations) —— 按照其集成指南更改模型提供方。

### 2. 分析你的代码库

```bash
/understand
```

多智能体（multi-agent）架构会：扫描你的项目，提取函数 / 类 / 依赖，构建知识图谱保存至`.ua/knowledge-graph.json`。（已经有 `.understand-anything/` 目录的项目会继续使用它——存在时它仍是数据目录，因此无需迁移。）

> **关于 Token 消耗的提醒：** 首次运行 `/understand` 会分析整个代码库，在大型项目上可能消耗大量 token。建议在有 token 套餐 / 订阅的情况下运行，或在初始化时使用本地模型（见上文）。后续运行默认是增量式的——只重新分析变更过的文件——因此消耗的 token 大幅减少。

**本地化输出：** 使用 `--language` 参数生成中文内容：

```bash
# 生成中文内容（知识图节点描述和 Dashboard UI）
/understand --language zh

# 支持的语言：en（默认）、zh、zh-TW、ja、ko、ru
```

`--language` 参数会影响：
- 知识图谱中的节点摘要和描述
- Dashboard UI 的标签、按钮和提示
- 导览路线的解释说明

### 3. 打开数据看板

```bash
/understand-dashboard
```

打开交互式网页数据看板，您的代码库将以图表形式呈现 — 按架构层级进行颜色编码，支持搜索和点击。选择任意节点即可查看其代码、关系以及简明易懂的解释。

### 4. 深度使用

```bash
# 询问任意代码库的问题
/understand-chat How does the payment flow work?

# 分析当前修改的影响
/understand-diff

# 深入理解某个文件
/understand-explain src/auth/login.ts

# 为新团队成员生成指南
/understand-onboard

# 提取业务领域知识（领域、流程、步骤）
/understand-domain

# 分析 Karpathy 模式的 LLM Wiki 知识库
/understand-knowledge ~/path/to/wiki

# 直接重跑即可 —— 默认增量更新，只分析变更的文件
/understand

# 安装 post-commit 钩子，每次提交自动增量更新
/understand --auto-update

# 大型 monorepo？把分析范围限定到某个子目录
/understand src/frontend
```

---

## 🌐 多平台支持

Understand-Anything 可在多个 AI 编码平台上运行。

### Claude Code（原生）

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### 一行命令安装（Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Nanobot / Kiro）

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# 也可以直接传入平台名跳过交互提示：
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows（PowerShell）：**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

安装脚本会将仓库克隆到 `~/.understand-anything/repo`，并为所选平台创建相应的符号链接。安装完成后请重启 CLI 或 IDE。

> **关于技能调用方式：** 不同平台的调用前缀不同。大多数平台使用斜杠命令（`/understand`），但 **Codex 使用 `$`** —— 请输入 `$understand`，而不是 `/understand`。如果两种前缀都不被识别，直接用自然语言请求即可：*“使用 understand 技能分析这个项目”*。

- 支持的 `<platform>` 取值：`gemini`、`codex`、`opencode`、`pi`、`openclaw`、`antigravity`、`vibe`、`vscode`、`hermes`、`cline`、`kimi`、`nanobot`、`kiro`
- 后续更新：`./install.sh --update`
- 卸载：`./install.sh --uninstall <platform>`

### Cursor

克隆此仓库后，Cursor 会自动通过 `.cursor-plugin/plugin.json`文件发现插件。无需手动安装 — 只需克隆并在 Cursor 中打开即可。

若自动发现未生效，可手动安装：打开 **Cursor Settings → Plugins**，在搜索框中粘贴 `https://github.com/Egonex-AI/Understand-Anything` 并添加。

### VS Code + GitHub Copilot

安装 GitHub Copilot 扩展（v1.108+）后，VS Code 会通过 `.copilot-plugin/plugin.json` 自动发现插件，克隆后直接在 VS Code 中打开即可，无需手动安装。

若需要在所有项目中使用（个人技能），运行上面的 `install.sh` 并选择 `vscode` 平台即可。

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

安装完成后：
- **Kiro CLI**：`kiro-cli chat --agent understand "分析这个项目"`
- **Kiro IDE**：技能会被符号链接到 `~/.kiro/skills/`，`understand` agent 会被写入 `~/.kiro/agents/understand.json`，重启 IDE 后两者均可使用。

若需要在所有项目中使用（个人技能），运行上面的 `install.sh` 并选择 `kiro` 平台即可。

### 多平台兼容

| 平台 | 状态 | 安装方式 |
|----------|--------|----------------|
| Claude Code | ✅ 原生 | 插件市场 |
| Cursor | ✅ 支持 | 自动发现 |
| VS Code + GitHub Copilot | ✅ 支持 | 自动发现 |
| Copilot CLI | ✅ 支持 | 插件安装 |
| Codex | ✅ 支持 | `install.sh codex` |
| OpenCode | ✅ 支持 | `install.sh opencode` |
| OpenClaw | ✅ 支持 | `install.sh openclaw` |
| Antigravity | ✅ 支持 | `install.sh antigravity` |
| Gemini CLI | ✅ 支持 | `install.sh gemini` |
| Pi Agent | ✅ 支持 | `install.sh pi` |
| Vibe CLI | ✅ 支持 | `install.sh vibe` |
| Hermes | ✅ 支持 | `install.sh hermes` |
| Cline | ✅ 支持 | `install.sh cline` |
| KIMI CLI | ✅ 支持 | `install.sh kimi` |
| Nanobot | ✅ 支持 | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ 支持 | `install.sh kiro` |

---

## 📦 与团队共享知识图谱

图谱就是一份 JSON 文件——**提交一次，团队成员就可以跳过整条流水线**。适合新人上手、PR 评审和 docs-as-code 工作流。

> **示例：** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) —— 包含已提交图谱的 Go / Java / Python / Node 多语言参考项目。

**需要提交的内容：** `.ua/` 下的全部文件，*除了* `intermediate/` 和 `diff-overlay.json`（这些是本地临时文件）。（旧项目使用 `.understand-anything/`——如果存在的是该目录，请将下方的目录名替换为它。）

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

**保持最新：** 启用 `/understand --auto-update` —— 一个 post-commit 钩子会增量更新图谱，每次提交都能得到匹配的图谱版本。也可以在发布前手动重跑 `/understand`。

**大型图谱（10 MB 以上）：** 使用 **git-lfs** 跟踪。

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### 无需 Claude Code 也能查看仪表盘

图谱生成并提交后，团队中的任何人只需一条命令即可打开它 —— 无需 Claude Code，无需 LLM，无需 API 密钥，只需要 Node.js（>= 18）：

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /path/to/analyzed/project
```

终端会打印一个带令牌的 URL（`http://127.0.0.1:5173/?token=…`），并在浏览器中打开完整的交互式仪表盘。项目目录（默认：当前目录）必须包含已提交的数据目录（`.ua/`，或旧版 `.understand-anything/`）。所有内容都从本地磁盘以只读方式提供 —— 没有 LLM 调用，也不会有任何数据离开你的机器。

如果你是从克隆的仓库工作：先执行 `pnpm install && pnpm --filter @understand-anything/core build`，再运行 `GRAPH_DIR=/path/to/analyzed/project pnpm dev:dashboard`，即可通过 Vite 开发服务器实现同样的效果。

---

## 🔧 技术原理

### Tree-sitter + LLM 混合分析

把确定性的事情交给静态分析，把需要语义理解的事情交给 LLM：

- **Tree-sitter（确定性）** —— 将源码解析为具体语法树，提取结构性事实：导入、导出、函数 / 类定义、调用点、继承关系。在 scan 阶段预先解析为 `importMap` 并传给 file-analyzer，避免它们再从源码推导一次 import。同样的输入永远得到同样的输出，并作为增量更新的指纹基础。
- **LLM（语义）** —— 读取解析后的结构以及原始源码，生成解析器做不了的事：plain-English 摘要、标签、架构层归属、业务领域映射、引导路径、语言概念标注。

正因为这个分工，图谱在结构层面是可复现的（同样的代码总是产生同样的边），同时在语义层面又能捕捉意图（一个文件是「为了什么」存在，而不仅仅是它 import 了什么）。

### 多智能体架构

`/understand` 命令调用 5 个 agent，`/understand-domain` 额外增加第 6 个：

| Agent | 职责 |
|-------|------|
| `project-scanner` | 扫描项目文件，检测语言和框架 |
| `file-analyzer` | 提取代码结构（函数、类和导入），生成图节点和边 |
| `architecture-analyzer` | 识别架构层 |
| `tour-builder` | 生成引导式学习路径 |
| `graph-reviewer` | 验证图的完整性和引用完整性 |
| `domain-analyzer` | 提取业务领域、流程和处理步骤（由 `/understand-domain` 使用） |
| `article-analyzer` | 从 wiki 文章中提取实体、论断和隐式关系（由 `/understand-knowledge` 使用） |

文件分析器并行运行（最多 3 个并发）。支持增量更新 — 仅重新分析自上次运行以来发生更改的文件。

---

## 🎥 社区

由 **Better Stack** 制作的社区视频教程。

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Better Stack 制作的社区视频教程 —— 点击在 YouTube 观看" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">在 YouTube 上观看 &rarr;</a></em>
</p>

写过视频、博客或教程?提个 issue 或 PR —— 我们很乐意把它放在这里。

---

## 🤝 贡献

欢迎贡献！以下是贡献指南：

1. Fork 项目
2. 新建分支 (`git checkout -b feature/my-feature`)
3. 运行测试 (`pnpm --filter @understand-anything/core test`)
4. 提交更改并创建一个PR请求

对于重大变更，请先提交 issue，以便我们讨论解决方案。

---

<p align="center">
  <strong>不再盲读代码，而是理解整个系统</strong>
</p>

## Star 历史记录

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>感谢每一位使用过、贡献过的朋友 —— 知道它替你们省下了一些时间，就是当初做它最值得的理由。</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
