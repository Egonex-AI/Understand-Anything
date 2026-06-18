<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Turn any codebase, knowledge base, or docs into an interactive knowledge graph you can explore, search, and ask questions about.</strong>
  <br />
  <em>Works with Claude Code, Codex, Cursor, Copilot, Gemini CLI, and more.</em>
</p>

<p align="center">
  <strong>Understand Anything. <a href="https://egonex.ai">Understand Anyone.</a></strong>
  <br />
  <em>AI should help people, not replace them.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="READMEs/README.zh-CN.md">简体中文</a> | <a href="READMEs/README.zh-TW.md">繁體中文</a> | <a href="READMEs/README.ja-JP.md">日本語</a> | <a href="READMEs/README.ko-KR.md">한국어</a> | <a href="READMEs/README.es-ES.md">Español</a> | <a href="READMEs/README.tr-TR.md">Türkçe</a> | <a href="READMEs/README.ru-RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Homepage-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Live_Demo-00c853" alt="Live Demo" /></a>
  <a href="https://egonex.ai"><img src="https://img.shields.io/badge/Understand_Anyone-egonex.ai-d4a574" alt="Understand Anyone" /></a>
</p>

<p align="center">
  <img src="assets/hero.png" alt="Understand Anything — Turn any codebase into an interactive knowledge graph" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**You just joined a new team. The codebase is 200,000 lines of code. Where do you even start?**

Understand Anything is a [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference) that analyzes your project with a multi-agent pipeline, builds a knowledge graph of every file, function, class, and dependency, then gives you an interactive dashboard to explore it all visually. Stop reading code blind. Start seeing the big picture.

> **The goal isn't a graph that wows you with how complex your codebase is — it's a graph that quietly teaches you how every piece fits together.**

---

## ✨ Features

> [!NOTE]
> **Want to skip the reading?** Try the [live demo](https://understand-anything.com/demo/) in our [homepage](https://understand-anything.com/) — a fully interactive dashboard you can pan, zoom, search, and explore right in your browser.

### Explore the structural graph

Navigate your codebase as an interactive knowledge graph — every file, function, and class is a node you can click, search, and explore. Select any node to see plain-English summaries, relationships, and guided tours.

### Understand business logic

Switch to the domain view and see how your code maps to real business processes — domains, flows, and steps laid out as a horizontal graph.

### Analyze knowledge bases

Point `/understand-knowledge` at a [Karpathy-pattern LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) and get a force-directed knowledge graph with community clustering. The deterministic parser extracts wikilinks and categories from `index.md`, then LLM agents discover implicit relationships, extract entities, and surface claims — turning your wiki into a navigable graph of interconnected ideas.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Guided Tours</h3>
      <p>Auto-generated walkthroughs of the architecture, ordered by dependency. Learn the codebase in the right order.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Fuzzy & Semantic Search</h3>
      <p>Find anything by name or by meaning. Search "which parts handle auth?" and get relevant results across the graph.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Diff Impact Analysis</h3>
      <p>See which parts of the system your changes affect before you commit. Understand ripple effects across the codebase.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Persona-Adaptive UI</h3>
      <p>The dashboard adjusts its detail level based on who you are — junior dev, PM, or power user.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Layer Visualization</h3>
      <p>Automatic grouping by architectural layer — API, Service, Data, UI, Utility — with color-coded legend.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Language Concepts</h3>
      <p>12 programming patterns (generics, closures, decorators, etc.) explained in context wherever they appear.</p>
    </td>
  </tr>
</table>

---

## 🚀 Quick Start

### 1. Install the plugin

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### 2. Analyze your codebase

```bash
/understand
```

A multi-agent pipeline scans your project, extracts every file, function, class, and dependency, then builds a knowledge graph saved to `.understand-anything/knowledge-graph.json`.

**Localized output:** Use `--language` to generate content in your preferred language:

```bash
# Generate Chinese content (知识图节点描述和 Dashboard UI)
/understand --language zh

# Supported languages: en (default), zh, zh-TW, ja, ko, ru
```

On the **first run** in a project — when you don't pass `--language` and no language is stored yet — `/understand` detects the language you're conversing in. If it isn't English, it asks you to confirm (or override) before generating; English conversations are unaffected. Your choice is saved to `.understand-anything/config.json` and reused on every later run.

The `--language` parameter affects:
- Node summaries and descriptions in the knowledge graph
- Dashboard UI labels, buttons, and tooltips
- Guided tour explanations

### 3. Explore the dashboard

```bash
/understand-dashboard
```

An interactive web dashboard opens with your codebase visualized as a graph — color-coded by architectural layer, searchable, and clickable. Select any node to see its code, relationships, and a plain-English explanation.

### 4. Keep learning

```bash
# Ask anything about the codebase
/understand-chat How does the payment flow work?

# Analyze impact of your current changes
/understand-diff

# Deep-dive into a specific file or function
/understand-explain src/auth/login.ts

# Generate an onboarding guide for new team members
/understand-onboard

# Extract business domain knowledge (domains, flows, steps)
/understand-domain

# Analyze a Karpathy-pattern LLM wiki knowledge base
/understand-knowledge ~/path/to/wiki

# Re-run anytime — incremental by default (only re-analyzes changed files)
/understand

# Auto-update on every commit via a post-commit hook
/understand --auto-update

# Scope to a subdirectory (for huge monorepos)
/understand src/frontend

# Quick overview mode — ~65-70% fewer tokens, file-level only
/understand --caveman
```

**Caveman mode (`--caveman`):** A reduced-token alternative for quick overviews or very large codebases. Skips function/class extraction, import resolution, and the LLM architecture and tour agents in favor of deterministic directory-pattern heuristics. You lose function-level detail, import edges, and curated tour narration; you keep the file-level graph, non-code edges (configures/documents/deploys/etc.), and a usable layered tour. Incompatible with `--review`; layer names and tour titles are English-only regardless of `--language`.

---

## 🌐 Multi-Platform Installation

Understand-Anything works across multiple AI coding platforms.

### Claude Code (Native)

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```


### One-line install (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Trae / Nanobot / Kiro)


**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# or skip the prompt by passing the platform:
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

The installer clones the repo to `~/.understand-anything/repo` and creates the right symlinks for the chosen platform. Restart your CLI/IDE afterwards.

- Supported `<platform>` values: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `trae`, `nanobot`, `kiro`
- Update later: `./install.sh --update`
- Uninstall: `./install.sh --uninstall <platform>`

### Cursor

Cursor auto-discovers the plugin via `.cursor-plugin/plugin.json` when this repo is cloned. No manual installation needed — just clone and open in Cursor.

If auto-discovery doesn't pick it up, install it manually: open **Cursor Settings → Plugins**, paste `https://github.com/Egonex-AI/Understand-Anything` into the search field, and add it from there.

### VS Code + GitHub Copilot

VS Code with GitHub Copilot (v1.108+) auto-discovers the plugin via `.copilot-plugin/plugin.json` when this repo is cloned. No manual installation needed — just clone and open in VS Code.

For personal skills (available across all projects), run the `install.sh` above with the `vscode` platform.

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

After installation:
- **Kiro CLI**: `kiro-cli chat --agent understand "Analyze this project"`
- **Kiro IDE**: The skills are symlinked into `~/.kiro/skills/` and the `understand` agent is written to `~/.kiro/agents/understand.json`, so both are available after restarting the IDE.

For personal skills (available across all projects), run the `install.sh` above with the `kiro` platform.

### Platform Compatibility

| Platform | Status | Install Method |
|----------|--------|----------------|
| Claude Code | ✅ Native | Plugin marketplace |
| Cursor | ✅ Supported | Auto-discovery |
| VS Code + GitHub Copilot | ✅ Supported | Auto-discovery |
| Copilot CLI | ✅ Supported | Plugin install |
| Codex | ✅ Supported | `install.sh codex` |
| OpenCode | ✅ Supported | `install.sh opencode` |
| OpenClaw | ✅ Supported | `install.sh openclaw` |
| Antigravity | ✅ Supported | `install.sh antigravity` |
| Gemini CLI | ✅ Supported | `install.sh gemini` |
| Pi Agent | ✅ Supported | `install.sh pi` |
| Vibe CLI | ✅ Supported | `install.sh vibe` |
| Hermes | ✅ Supported | `install.sh hermes` |
| Cline | ✅ Supported | `install.sh cline` |
| KIMI CLI | ✅ Supported | `install.sh kimi` |
| Trae | ✅ Supported | `install.sh trae` |
| Nanobot | ✅ Supported | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ Supported | `install.sh kiro` |


---

## 📦 Share the Graph with Your Team

The graph is just JSON — **commit it once, and teammates skip the pipeline**. Good for onboarding, PR reviews, and docs-as-code.

> **Example:** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) — Go / Java / Python / Node reference with a committed graph.

**What to commit:** everything in `.understand-anything/` *except* `intermediate/` and `diff-overlay.json` (those are local scratch).

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

**Keep it fresh:** enable `/understand --auto-update` — a post-commit hook incrementally patches the graph so each commit lands with a matching graph. Or re-run `/understand` manually before releases.

**Large graphs (10 MB+):** track with **git-lfs**.

```bash
git lfs install
git lfs track ".understand-anything/*.json"
git add .gitattributes .understand-anything/
```

---

## 🔧 Under the Hood

### Tree-sitter + LLM hybrid

Static analysis and LLMs do what each does best:

- **Tree-sitter (deterministic)** — parses source into a concrete syntax tree and extracts structural facts: imports, exports, function/class definitions, call sites, inheritance. Pre-resolved into an `importMap` during the scan phase and passed to file-analyzers so they don't re-derive imports from source. Same input → same output, every run. Also powers fingerprint-based change detection for incremental updates.
- **LLM (semantic)** — reads the parsed structure alongside the original source to produce what parsers can't: plain-English summaries, tags, architectural layer assignments, business-domain mapping, guided tours, language concept callouts.

This split is why the graph is reproducible on the structural side (the same code always yields the same edges) while still capturing intent on the semantic side (what a file is *for*, not just what it imports).

### Multi-Agent Pipeline

The `/understand` command orchestrates 5 specialized agents, and `/understand-domain` adds a 6th:

| Agent | Role |
|-------|------|
| `project-scanner` | Discover files, detect languages and frameworks |
| `file-analyzer` | Extract functions, classes, imports; produce graph nodes and edges |
| `architecture-analyzer` | Identify architectural layers |
| `tour-builder` | Generate guided learning tours |
| `graph-reviewer` | Validate graph completeness and referential integrity (runs inline by default; use `--review` for full LLM review) |
| `domain-analyzer` | Extract business domains, flows, and process steps (used by `/understand-domain`) |
| `article-analyzer` | Extract entities, claims, and implicit relationships from wiki articles (used by `/understand-knowledge`) |

File analyzers run in parallel (up to 5 concurrent, 20-30 files per batch). Supports incremental updates — only re-analyzes files that changed since the last run.

---

## 🎥 Community

A community-made walkthrough by **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Community walkthrough by Better Stack — watch on YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Watch on YouTube &rarr;</a></em>
</p>

Made a video, blog post, or tutorial? Open an issue or PR — happy to feature it here.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run the tests (`pnpm --filter @understand-anything/core test`)
4. Commit your changes and open a pull request

Please open an issue first for major changes so we can discuss the approach.

---

<p align="center">
  <strong>Stop reading code blind. Start understanding everything.</strong>
</p>

## Star History

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Thanks to everyone who's used and contributed — knowing this saves people time is what made it worth building.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
