# /understand-knowledge — Personal Knowledge Base Plugin Design

## Overview

A new `/understand-knowledge` skill within the existing Understand Anything plugin that takes any folder of markdown notes and produces an interactive knowledge graph visualized in the existing dashboard.

Inspired by Andrej Karpathy's LLM Wiki pattern — where an LLM compiles and maintains a structured wiki from raw sources — this plugin goes further by adding typed relationship discovery and interactive graph visualization that tools like Obsidian and Logseq cannot provide.

### Goals

- Accept any markdown-based knowledge base (Obsidian vault, Logseq graph, Dendron workspace, Foam, Karpathy-style LLM wiki, Zettelkasten, or plain markdown)
- Auto-detect the format and adapt parsing accordingly
- Use LLM analysis to discover implicit relationships beyond explicit links
- Produce a knowledge graph with typed nodes and edges
- Visualize in the existing dashboard with knowledge-specific layout, sidebar, and reading mode

### Non-Goals

- Real-time sync with the knowledge base tool (Obsidian, Logseq, etc.)
- Replacing the user's existing PKM tool — this is a visualization/analysis layer on top
- Supporting non-markdown formats (PDFs, bookmarks) in v1

---

## Schema Extensions

### New Node Types (5)

Added to the existing `NodeType` union (currently 16 types):

```typescript
export type NodeType =
  // existing (16)
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  // knowledge (5 new → 21 total)
  | "article" | "entity" | "topic" | "claim" | "source";
```

| Type | What it represents | Example |
|------|-------------------|---------|
| `article` | A wiki/note page — the primary content unit | "LLM Knowledge Bases.md" |
| `entity` | A named thing: person, tool, paper, org, project | "Andrej Karpathy", "Obsidian" |
| `topic` | A thematic cluster grouping related articles | "Personal Knowledge Management" |
| `claim` | A specific assertion, insight, or takeaway | "RAG loses context at chunk boundaries" |
| `source` | Raw/reference material that articles are compiled from | A paper URL, a raw PDF reference |

### New Edge Types (6)

Added to the existing `EdgeType` union (currently 29 types):

```typescript
export type EdgeType =
  // existing (29)
  | ...
  // knowledge (6 new → 35 total)
  | "cites" | "contradicts" | "builds_on"
  | "exemplifies" | "categorized_under" | "authored_by";
```

| Type | Direction | Meaning |
|------|-----------|---------|
| `cites` | article → source | References or draws from |
| `contradicts` | claim → claim | Conflicts or disagrees with |
| `builds_on` | article → article | Extends, refines, or deepens |
| `exemplifies` | entity → concept/topic | Is a concrete example of |
| `categorized_under` | article/entity → topic | Belongs to this theme |
| `authored_by` | article → entity | Written or created by |

### New Metadata Interface

```typescript
export interface KnowledgeMeta {
  format?: "obsidian" | "logseq" | "dendron" | "foam" | "karpathy" | "zettelkasten" | "plain";
  wikilinks?: string[];
  backlinks?: string[];
  frontmatter?: Record<string, unknown>;
  sourceUrl?: string;
  confidence?: number; // 0-1, for LLM-inferred relationships
}
```

Added as an optional field on `GraphNode`:

```typescript
export interface GraphNode {
  // ...existing fields
  knowledgeMeta?: KnowledgeMeta;
}
```

### Graph-Level Kind Flag

```typescript
export interface KnowledgeGraph {
  version: string;
  kind: "codebase" | "knowledge"; // NEW
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}
```

The `kind` field tells the dashboard which layout, sidebar, and visual styling to use. For backward compatibility, graphs without a `kind` field default to `"codebase"`.

---

## Format Detection & Format Guides

### Auto-Detection Logic

Scans the target directory for signature files/patterns. Priority order (first match wins):

| Priority | Signal | Detected Format |
|----------|--------|----------------|
| 1 | `.obsidian/` directory | Obsidian |
| 2 | `logseq/` + `pages/` directories | Logseq |
| 3 | `.dendron.yml` or `*.schema.yml` | Dendron |
| 4 | `.foam/` or `.vscode/foam.json` | Foam |
| 5 | `raw/` + `wiki/` + `index.md` | Karpathy |
| 6 | `[[wikilinks]]` + unique ID prefixes in filenames | Zettelkasten |
| 7 | Fallback | Plain markdown |

### Format Guides

Located at `skills/understand-knowledge/formats/`. Each guide tells the LLM agents how to parse that format:

```
skills/understand-knowledge/
  SKILL.md
  formats/
    obsidian.md        — [[wikilinks]], [[note|alias]], [[note#heading]],
                         #tags, YAML frontmatter, .obsidian/ config,
                         dataview annotations, canvas files
    logseq.md          — block-based outliner, ((block-refs)),
                         journals/YYYY_MM_DD.md, pages/,
                         property:: value syntax, TODO/DONE states
    dendron.md         — dot-delimited hierarchy (a.b.c.md),
                         .schema.yml for structure validation,
                         cross-vault links, refactoring rules
    foam.md            — [[wikilinks]] + link reference definitions
                         at file bottom, .foam/config, placeholder links
    karpathy.md        — raw/ → wiki/ pipeline, index.md master map,
                         log.md append-only record, _meta/ state,
                         LLM-maintained cross-references
    zettelkasten.md    — atomic notes, unique ID prefixes (timestamps),
                         typed semantic links, one idea per note
    plain.md           — standard [markdown](links), folder hierarchy,
                         heading structure, no special conventions
```

Each format guide covers:
- How to parse links (wikilinks vs standard vs block refs)
- Where metadata lives (frontmatter vs inline properties vs block properties)
- What the folder structure means (journals/ = daily notes, pages/ = permanent notes)
- What conventions to respect vs what to infer

### Format Guide Authoring Process

Format guides must be research-backed. During implementation, the agent building each format guide must:
1. Read the official documentation for that format (Obsidian Help, Logseq docs, Dendron wiki, Foam docs, etc.)
2. Study real-world examples of that format's structure
3. Write the guide based on verified behavior, not assumptions

---

## Agent Pipeline

```
knowledge-scanner → format-detector → article-analyzer → relationship-builder → graph-reviewer
```

### Agent Definitions

| Agent | Input | Output | Model |
|-------|-------|--------|-------|
| `knowledge-scanner` | Target directory path | File manifest: all `.md` files with paths, sizes, first 20 lines preview | `inherit` |
| `format-detector` | File manifest + directory structure | Detected format + format-specific parsing hints | `inherit` |
| `article-analyzer` | Individual `.md` file + format guide | Per-file nodes (article, entities, claims) + explicit edges (wikilinks, tags) | `inherit` |
| `relationship-builder` | All per-file results | Cross-file implicit edges (builds_on, contradicts, categorized_under) + topic clustering + layers | `inherit` |
| `graph-reviewer` | Assembled graph | Validated graph — deduped entities, consistent edge weights, orphan detection | `inherit` |

### Key Differences from Codebase Pipeline

- **No tree-sitter** — markdown parsing is simpler, mostly regex + LLM interpretation
- **format-detector** replaces framework detection — picks the right format guide
- **article-analyzer** replaces file-analyzer — extracts knowledge concepts instead of code structure
- **relationship-builder** is the heavy LLM step — discovers implicit connections across files that explicit links miss
- **graph-reviewer** stays similar — validates the assembled graph for consistency

### Intermediate Files

Same pattern as codebase analysis:

```
.understand-anything/intermediate/
  knowledge-manifest.json      — scanner output
  format-detection.json        — detected format + hints
  article-*.json               — per-file analysis
  relationships.json           — cross-file edges
  knowledge-graph.json         — final assembled graph
```

Intermediate files are cleaned up after graph assembly (same as codebase flow).

### Incremental Mode (`--ingest`)

When the user runs `/understand-knowledge --ingest path/to/new-source.md`:

1. **knowledge-scanner** — runs on just the new file(s)
2. **format-detector** — skipped (format already known from initial scan)
3. **article-analyzer** — processes only new/changed files
4. **relationship-builder** — runs on new nodes against the existing graph, finds connections to what's already there
5. **graph-reviewer** — validates the merged result

Existing nodes are preserved; only new nodes/edges are added or updated.

---

## Dashboard Changes

All changes are scoped to graphs with `"kind": "knowledge"`.

### Vertical Flow Layout

- Default to top-down vertical layout (like existing domain/business flow view)
- Topics at top → articles in middle → entities/claims/sources at bottom
- Reads like a knowledge hierarchy: broad themes flow down into specifics
- User can still switch to horizontal or force-directed layout via controls

### Knowledge Sidebar

Replaces NodeInfo when a knowledge graph is loaded:

| Selection | Sidebar Shows |
|-----------|---------------|
| Nothing selected | ProjectOverview: format detected, total articles/entities/topics/claims/sources |
| Article node | Title, summary, tags, frontmatter metadata, backlinks list (clickable), outgoing links, related topics |
| Entity node | Name, type (person/tool/paper/org), articles that mention it, relationships to other entities |
| Topic node | Description, child articles, child entities, cross-topic connections |
| Claim node | Assertion text, supporting articles, contradicting claims (if any), confidence score |
| Source node | Original URL/path, articles that cite it, ingestion date |

### Reading Mode

- Clicking an article node triggers a reading panel that slides up from the bottom (same pattern as current code viewer overlay)
- Shows the full compiled markdown rendered as HTML
- Includes a mini backlinks sidebar within the panel
- Clicking a `[[wikilink]]` or entity reference in the reading panel navigates the graph to that node

### Node Visual Styling

| Node Type | Shape | Color Accent |
|-----------|-------|-------------|
| `article` | Rounded rectangle | Warm amber |
| `entity` | Circle | Soft blue |
| `topic` | Large rounded rectangle | Muted gold |
| `claim` | Diamond | Green/red depending on contradictions |
| `source` | Small square | Gray |

### Edge Visual Styling

| Edge Type | Style |
|-----------|-------|
| `cites` | Dashed line |
| `contradicts` | Red line |
| `builds_on` | Solid with arrow |
| `categorized_under` | Thin gray |
| `authored_by` | Dotted blue |
| `exemplifies` | Dotted green |

---

## Skill Interface

### Usage

```bash
# Full scan — first time or rescan
/understand-knowledge

# Point at a specific directory
/understand-knowledge path/to/my-notes

# Incremental ingest — add new sources to existing graph
/understand-knowledge --ingest path/to/new-note.md
/understand-knowledge --ingest path/to/new-folder/
```

### Behavior

1. Auto-detects format (Obsidian, Logseq, Karpathy, etc.)
2. Announces: "Detected Obsidian vault with 342 notes. Scanning..."
3. Runs the agent pipeline (scanner → detector → analyzer → relationship-builder → reviewer)
4. Writes `knowledge-graph.json` to `.understand-anything/` with `"kind": "knowledge"`
5. Auto-triggers `/understand-dashboard` after completion

### File Structure

```
skills/understand-knowledge/
  SKILL.md                     — skill entry point, orchestration logic
  formats/
    obsidian.md
    logseq.md
    dendron.md
    foam.md
    karpathy.md
    zettelkasten.md
    plain.md
```

### Coexistence with `/understand`

- `/understand` produces `"kind": "codebase"` graphs
- `/understand-knowledge` produces `"kind": "knowledge"` graphs
- Both write to `.understand-anything/knowledge-graph.json`
- Running one replaces the other
- To scope knowledge analysis to a subdirectory (e.g., `docs/` within a code repo), use `/understand-knowledge path/to/docs`

---

## What This Enables That Nothing Else Does

| Existing Tools | Limitation | Our Advantage |
|---------------|-----------|---------------|
| Obsidian graph view | Untyped edges — all links look the same | Typed edges: cites, contradicts, builds_on |
| Logseq graph | Only shows explicit links | LLM discovers implicit relationships |
| All PKM tools | Single-format only | Cross-format support with auto-detection |
| Karpathy LLM Wiki | Flat text wiki, no visualization | Interactive graph dashboard with guided tours |
| None | No knowledge graph tours | Tour mode walks through a knowledge base step by step |
