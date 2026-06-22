# Multi-Platform Skill Support — Simplified Design

**Date**: 2026-03-18
**Status**: Approved
**Goal**: Make Understand-Anything skills work across Codex, OpenClaw, OpenCode, and Cursor with zero build step — same files everywhere.

## Design Principles

Follows the [obra/superpowers](https://github.com/obra/superpowers) pattern:
1. **Same files, all platforms** — no template markers, no build step, no platform-specific variants
2. **`model: inherit`** — agents use the parent session's model, making them platform-agnostic
3. **AI-driven installation** — `.{platform}/INSTALL.md` files that the AI agent reads and executes
4. **Self-contained skills** — pipeline prompt templates live inside the skill directory, not in a separate `agents/` folder

## Change 1: Move Pipeline Agents Into Skill

The 5 pipeline agents (project-scanner, file-analyzer, architecture-analyzer, tour-builder, graph-reviewer) are used exclusively by the `/understand` skill. They become prompt templates co-located with the skill:

**Before:**
```
agents/
  project-scanner.md          # agent definition
  file-analyzer.md
  architecture-analyzer.md
  tour-builder.md
  graph-reviewer.md
skills/understand/
  SKILL.md                    # dispatches named agents
```

**After:**
```
skills/understand/
  SKILL.md                           # dispatches subagents using templates
  project-scanner-prompt.md          # prompt template (no agent frontmatter)
  file-analyzer-prompt.md
  architecture-analyzer-prompt.md
  tour-builder-prompt.md
  graph-reviewer-prompt.md
```

The prompt template files retain the full instruction content but drop the agent frontmatter (`name`, `tools`, `model`). The `SKILL.md` dispatch changes from "Dispatch the **project-scanner** agent" to "Dispatch a subagent using the template at `./project-scanner-prompt.md`".

### Context Cost

Reading templates through the main session adds ~11K tokens total (~5.5% of 200K context). This is sequential (one template at a time), and context compression reclaims earlier content. Acceptable trade-off for portability.

## Change 2: New Registered Agent — knowledge-graph-guide

Create a reusable agent that any skill or user can invoke to work with knowledge graphs:

```yaml
# agents/knowledge-graph-guide.md
---
name: knowledge-graph-guide
description: |
  Use this agent when users need help understanding, querying, or working
  with an Understand-Anything knowledge graph. Guides users through graph
  structure, node/edge relationships, layer architecture, tours, and
  dashboard usage.
model: inherit
---
```

This agent knows:
- The KnowledgeGraph JSON schema (nodes, edges, layers, tours)
- The 5 node types and 18 edge types
- How to navigate and query the graph
- How to use the interactive dashboard
- How to interpret architectural layers and guided tours

## Change 3: Platform Installation Files

Each platform gets an `INSTALL.md` that the AI agent can fetch and follow:

| File | Platform | Install Mechanism |
|------|----------|-------------------|
| `.codex/INSTALL.md` | Codex | `git clone` + symlink to `~/.agents/skills/` |
| `.opencode/INSTALL.md` | OpenCode | Plugin config in `opencode.json` |
| `.openclaw/INSTALL.md` | OpenClaw | `git clone` + symlink to `~/.openclaw/skills/` |
| `.cursor/INSTALL.md` | Cursor | `git clone` + symlink to `.cursor/plugins/` |

User tells the agent one line:
```
Fetch and follow instructions from https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/refs/heads/main/understand-anything-plugin/.codex/INSTALL.md
```

The agent executes the clone + symlink/config automatically.

## Change 4: README Update

Add a "Multi-Platform Installation" section to README.md with one-liner per platform.

## File Summary

| Action | Files |
|--------|-------|
| Delete | `agents/project-scanner.md`, `agents/file-analyzer.md`, `agents/architecture-analyzer.md`, `agents/tour-builder.md`, `agents/graph-reviewer.md` |
| Create | `skills/understand/project-scanner-prompt.md`, `skills/understand/file-analyzer-prompt.md`, `skills/understand/architecture-analyzer-prompt.md`, `skills/understand/tour-builder-prompt.md`, `skills/understand/graph-reviewer-prompt.md` |
| Create | `agents/knowledge-graph-guide.md` |
| Create | `.codex/INSTALL.md`, `.opencode/INSTALL.md`, `.openclaw/INSTALL.md`, `.cursor/INSTALL.md` |
| Modify | `skills/understand/SKILL.md` (dispatch references) |
| Modify | `README.md` (multi-platform section) |

## What We Don't Need

- ~~`platforms/platform-config.json`~~ — same files everywhere
- ~~`platforms/build.mjs`~~ — no build step
- ~~`{{MARKER}}` template markers~~ — no templating
- ~~`scripts/install-*.sh`~~ — AI agent follows INSTALL.md
- ~~`dist-platforms/`~~ — no generated output

## Platform Compatibility

| Platform | Install Method | Agent Discovery | Skill Discovery |
|----------|---------------|-----------------|-----------------|
| Claude Code | Marketplace (existing) | `agents/` dir | `skills/` dir |
| Codex | INSTALL.md → symlink | N/A (templates in skill) | `~/.agents/skills/` |
| OpenCode | INSTALL.md → plugin config | N/A (templates in skill) | Plugin auto-registers |
| OpenClaw | INSTALL.md → symlink | N/A (templates in skill) | `~/.openclaw/skills/` |
| Cursor | INSTALL.md → symlink | `agents/` dir | `.cursor/plugins/` |
