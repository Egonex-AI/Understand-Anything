---
name: understand-anything
description: Turn any codebase into an interactive knowledge graph you can explore, search, and ask questions about.
keywords:
  - codebase
  - knowledge graph
  - architecture
  - understand code
  - code analysis
  - code exploration
  - onboarding
  - code structure
  - dependency graph
  - business logic
  - domain model
  - code walkthrough
  - guided tour
  - diff impact
  - code visualization
---

# Understand Anything

Turn any codebase, knowledge base, or docs into an interactive knowledge graph you can explore, search, and ask questions about.

## Onboarding

When this power is first activated, verify the plugin is available:

1. Check if the plugin root exists at any of these paths (use the first match):
   - `~/.understand-anything-plugin/`
   - `~/.understand-anything/repo/understand-anything-plugin/`
   - `~/.kiro/powers/understand-anything/understand-anything-plugin/`

2. If no plugin root is found, clone the repository:
   ```bash
   git clone https://github.com/Lum1104/Understand-Anything.git ~/.understand-anything/repo
   ln -sfn ~/.understand-anything/repo/understand-anything-plugin ~/.understand-anything-plugin
   ```

3. Install dependencies:
   ```bash
   cd ~/.understand-anything-plugin && pnpm install --frozen-lockfile 2>/dev/null || pnpm install
   ```

## Available Commands

| Command | Description | When to use |
|---------|-------------|-------------|
| `/understand` | Analyze a codebase and build a knowledge graph | User wants to analyze, index, or understand a project |
| `/understand-dashboard` | Launch interactive visualization | User wants to explore, visualize, or see the graph |
| `/understand-chat` | Ask questions about the codebase | User asks "how does X work?", "where is Y?", "explain Z" |
| `/understand-diff` | Analyze impact of code changes | User is about to commit or wants to understand change impact |
| `/understand-domain` | Extract business domain knowledge | User asks about business logic, flows, or domain concepts |
| `/understand-explain` | Deep-dive into a specific file or function | User wants detailed explanation of a specific piece of code |
| `/understand-onboard` | Generate onboarding guide | User is new to the codebase or wants to onboard someone |
| `/understand-knowledge` | Analyze a wiki-style knowledge base | User has a markdown wiki they want to graph |

## Workflow Steering

Load the appropriate steering file based on the user's current task:

- When analyzing a codebase: load `steering/codebase-analysis.md`
- When exploring or visualizing: load `steering/dashboard-exploration.md`
- When asking questions about code: load `steering/code-query.md`
- When working with diffs or changes: load `steering/diff-analysis.md`
- When exploring business domains: load `steering/domain-analysis.md`

## Graph Structure Reference

The knowledge graph at `.understand-anything/knowledge-graph.json` has this structure:

- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}
