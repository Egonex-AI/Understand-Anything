# Homepage Update Design — 2026-03-29

## Goal

Update the Astro homepage (`homepage/`) to reflect features added across v1.2.0, v1.3.0, and v2.0.0 releases. The README and homepage structure/layout stay unchanged.

## Scope

Three areas to update:

### 1. Features Section — Expand from 3 to 6 Cards

Current (3 cards):
- Interactive Knowledge Graph
- Plain-English Summaries
- Guided Tours

Updated (6 cards, 2 rows of 3):

| # | Title | Icon | Description |
|---|-------|------|-------------|
| 1 | Interactive Knowledge Graph | `◈` | Visualize files, functions, and dependencies as an explorable graph with hierarchical drill-down and smart layout. |
| 2 | Beyond Code Analysis | `⬡` | Analyze your entire project — Dockerfiles, Terraform, SQL, Markdown, and 26+ file types mapped into one unified graph. |
| 3 | Smart Filtering & Search | `⊘` | Filter by node type, complexity, layer, or edge category. Fuzzy and semantic search to find anything instantly. |
| 4 | Export & Share | `⎙` | Export your knowledge graph as high-quality PNG, SVG, or filtered JSON — ready for docs, presentations, or further analysis. |
| 5 | Dependency Path Finder | `⟿` | Find the shortest path between any two components. Understand how parts of your system connect at a glance. |
| 6 | Guided Tours & Onboarding | `⟐` | AI-generated walkthroughs that teach the codebase step by step, plus onboarding guides for new team members. |

### 2. Install Section

Update the note from Claude Code-only to multi-platform:
- Before: "Works with Claude Code — Anthropic's official CLI for Claude."
- After: "Works with Claude Code, Codex, OpenCode, Gemini CLI, and more."

### 3. Footer

Update tagline:
- Before: "Built as a Claude Code plugin"
- After: "Built for AI coding assistants"

## Files to Modify

- `homepage/src/components/Features.astro` — replace 3 cards with 6
- `homepage/src/components/Install.astro` — update platform note
- `homepage/src/components/Footer.astro` — update tagline

## Out of Scope

- README.md updates
- Showcase section / screenshot
- Nav component
- Hero section
- Layout / global CSS structure changes
