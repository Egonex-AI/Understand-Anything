# Understand Anything — Design & Implementation Plan

## Context

AI coding tools have made writing code easy, but understanding code remains hard. Junior developers, non-programmers (PMs, designers), and even experienced devs working in unfamiliar languages struggle to comprehend codebases they didn't write — or that AI wrote for them. The only entity that "understands" the code is the AI itself.

**Understand Anything** bridges this gap: an open-source tool that combines LLM intelligence with static analysis to produce an interactive, multi-persona dashboard for understanding any codebase. It runs as a Claude Code skill (leveraging the active session) and serves a rich web dashboard.

---

## Architecture: Monorepo with Shared Core

```
understand-anything/
├── packages/
│   ├── core/              # Shared analysis engine
│   │   ├── analyzer/      # LLM + tree-sitter analysis
│   │   ├── graph/         # Knowledge graph builder & schema
│   │   ├── plugins/       # Plugin system for language analyzers
│   │   └── persistence/   # JSON read/write, staleness detection
│   ├── skill/             # Claude Code skill (5 commands)
│   └── dashboard/         # React + TypeScript multi-panel workspace
├── plugins/               # Built-in language analyzer plugins
│   └── tree-sitter/       # Tree-sitter based multi-language analyzer
├── docs/
│   └── plans/
├── package.json           # Monorepo root (pnpm workspaces)
├── tsconfig.json
└── .gitignore
```

**Key decisions:**
- **Monorepo** (pnpm workspaces) — skill and dashboard share the core analysis engine
- **JSON interchange** — knowledge graph is a JSON file, readable by both skill and dashboard
- **Committable + auto-sync** — graph persists in `.understand-anything/`, can be committed to git, auto-detects staleness via git diff

---

## Knowledge Graph Schema

```typescript
interface KnowledgeGraph {
  version: string;
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;           // LLM-generated project summary
  analyzedAt: string;            // ISO timestamp
  gitCommitHash: string;         // For staleness detection
}

interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "module" | "concept";
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;               // Plain-English description
  tags: string[];                // Searchable tags
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;        // Language-specific explanations
}

interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number;                // 0-1 importance
}

type EdgeType =
  // Structural
  | "imports" | "exports" | "contains" | "inherits" | "implements"
  // Behavioral
  | "calls" | "subscribes" | "publishes" | "middleware"
  // Data flow
  | "reads_from" | "writes_to" | "transforms" | "validates"
  // Dependencies
  | "depends_on" | "tested_by" | "configures"
  // Semantic
  | "related" | "similar_to";

interface Layer {
  id: string;
  name: string;                  // e.g., "API Layer", "Data Layer"
  description: string;
  nodeIds: string[];
}

interface TourStep {
  order: number;
  title: string;
  description: string;           // Markdown explanation
  nodeIds: string[];             // Nodes to highlight
  languageLesson?: string;       // Optional language concept explanation
}
```

---

## Dashboard: Multi-Panel Workspace (React + TypeScript)

```
┌─────────────────────────────────────────────────────────┐
│  🔍 Natural Language Search: "communication layer"      │
├──────────────────────┬──────────────────────────────────┤
│                      │                                  │
│   GRAPH VIEW         │   CODE VIEWER                    │
│   (React Flow)       │   (Monaco Editor, read-only)     │
│                      │                                  │
│   Interactive node   │   Source code + syntax highlight  │
│   graph. Click to    │   LLM annotations inline.        │
│   select. Search     │                                  │
│   highlights.        │                                  │
├──────────────────────┼──────────────────────────────────┤
│                      │                                  │
│   CHAT PANEL         │   LEARN PANEL                    │
│                      │                                  │
│   Context-aware Q&A  │   Tour mode + Contextual mode    │
│   about selected     │   Language lessons in context     │
│   nodes / project.   │   of YOUR code.                  │
│                      │                                  │
└──────────────────────┴──────────────────────────────────┘
```

**Tech stack:**
- React 18 + TypeScript + Vite
- React Flow — graph visualization (built for node graphs, better than raw D3 for this)
- Monaco Editor — code viewer with syntax highlighting (same as VS Code)
- TailwindCSS — styling
- Zustand — state management (lightweight, no boilerplate)

**Persona modes:**
- Non-technical: High-level concept nodes, code viewer hidden, learn panel expanded
- Junior dev: All panels, learn panel prominent, complexity indicators
- Experienced dev: Code viewer prominent, chat panel for deep dives

**Natural language search:**
- Searches against node `tags`, `summary`, and `name` fields
- Uses embedding similarity if available, falls back to keyword matching
- Highlights matching nodes in the graph, filters the list

---

## Claude Code Skill Commands

| Command | Description |
|---------|-------------|
| `/understand` | Full analysis (or incremental update if graph exists) + open dashboard |
| `/understand-chat "<query>"` | In-terminal Q&A using the knowledge graph |
| `/understand-diff` | Analyze current PR/diff — explain changes, affected areas, risks |
| `/understand-explain <path>` | Deep-dive explanation of a specific file or function |
| `/understand-onboard` | Generate structured onboarding guide for new team members |

**LLM strategy:**
- Inside Claude Code → uses the active Claude session (zero extra cost)
- Standalone dashboard → users provide Claude API key for chat features
- Graph browsing, search, and learn mode work offline (pre-generated data)

---

## Persistence & Staleness Detection

```
.understand-anything/
├── knowledge-graph.json       # The full graph (committable)
├── meta.json                  # Analysis metadata
│   {
│     "lastAnalyzedAt": "2026-03-14T...",
│     "gitCommitHash": "abc123",
│     "version": "1.0.0",
│     "analyzedFiles": 47
│   }
├── cache/                     # Per-file analysis cache
│   ├── src__index.ts.json
│   └── src__auth__login.ts.json
└── tours/
    └── default-tour.json
```

**Auto-sync flow:**
1. Skill starts → reads `meta.json` → gets last analyzed commit hash
2. Runs `git diff <last-hash>..HEAD --name-only` → gets changed files
3. If no changes → serves existing graph
4. If changes → re-analyzes only changed files → merges into existing graph → updates meta

---

## Plugin System

```typescript
interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
}
```

**Day 1: tree-sitter plugin** — uses `node-tree-sitter` with language grammars for:
- TypeScript/JavaScript, Python, Go, Java, Rust, C/C++
- Extracts: function/class boundaries, import/export statements, call sites
- Combined with LLM analysis for semantic understanding

**Future: community plugins** for language-specific deep analysis.

---

## Implementation Phases

### Phase 1: Foundation (MVP)
1. Project scaffolding — monorepo, TypeScript config, build setup
2. Core: Knowledge graph schema + JSON persistence
3. Core: LLM analysis engine (file-by-file analysis using prompts)
4. Core: tree-sitter integration for structural analysis
5. Skill: `/understand` command — analyze + persist graph
6. Dashboard: Basic React app that reads and renders the graph
7. Dashboard: Graph view with React Flow
8. Dashboard: Code viewer with Monaco Editor

### Phase 2: Intelligence
9. Natural language search across graph nodes
10. Skill: `/understand-chat` — terminal Q&A
11. Dashboard: Chat panel with context-aware Q&A
12. Staleness detection + incremental updates
13. Layer auto-detection (group nodes into logical layers)

### Phase 3: Learn Mode
14. Tour generation — guided project walkthrough
15. Contextual explanations — click-to-explain
16. Language-specific lessons in context of the user's code
17. Persona modes (non-technical / junior / experienced)

### Phase 4: Advanced
18. Skill: `/understand-diff` — PR/diff analysis
19. Skill: `/understand-explain` — deep-dive on specific files
20. Skill: `/understand-onboard` — onboarding guide generation
21. Community plugin system
22. Embedding-based semantic search (optional enhancement)

---

## Verification

### How to test end-to-end:
1. **Skill analysis**: Run `/understand` on a sample project → verify `.understand-anything/knowledge-graph.json` is generated with correct schema
2. **Incremental update**: Modify a file → run `/understand` again → verify only the changed file is re-analyzed
3. **Dashboard**: Open `http://localhost:5173` → verify graph renders, nodes are clickable, search works
4. **Chat**: Ask a question in the chat panel → verify it returns a relevant answer using the knowledge graph
5. **Learn mode**: Start the tour → verify it walks through the project step by step
6. **Tree-sitter**: Analyze a TypeScript file → verify function boundaries and import relationships match the actual code

### Test projects to validate against:
- A small TypeScript project (the tool itself)
- A Python Flask/Django API
- A Go microservice
- A mixed-language monorepo
