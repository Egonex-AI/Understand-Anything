# /understand-figma — Figma Ingestion & Structure (Foundation) Design

**Date**: 2026-06-24
**Status**: Approved
**Approach**: Foundation-first — this is **Sub-project 1 of 5**. It delivers Figma ingestion + structural analysis + a light design-system model. User flows (B), design↔code mapping (C), design-system audit (D), and planning-document analysis (E) are scoped here as a **roadmap**, each to get its own spec → plan → implementation cycle.

## Overview

A new `/understand-figma` skill within the existing Understand Anything plugin that takes a Figma file and produces an interactive knowledge graph — pages, screens, components, component sets, instances, and design tokens — visualized in the existing dashboard with a `kind: "design"` layout.

This mirrors how `/understand-knowledge` (wikis) and `/understand-domain` (business domains) extended the tool to non-code inputs: deterministic parsing builds a structural skeleton, an LLM agent adds semantics, a merge step assembles the same `knowledge-graph.json`, and the same dashboard renders it.

### Goals

- Ingest a Figma file via the **Figma REST API** (`GET /v1/files/:key`) behind a pluggable source-adapter seam, so an offline local-JSON source can be added later without rework.
- Produce a **shallow** structural graph: `page → screen → component / componentSet / instance`, plus a light **design-system model** (`token` nodes for color/type/spacing/effect styles, with `uses_token` relationships).
- Add semantic enrichment (summaries, tags, layer hints, screen purpose) via a new `design-analyzer` LLM agent.
- Reuse the existing schema, persistence, validation, and dashboard; add only a `kind: "design"` view and a sidebar thumbnail.
- Render with a **hybrid** strategy: lightweight text nodes in the graph; the selected node's thumbnail in the sidebar (on demand).
- Record forward-looking metadata (`prototypeTargets`, `componentKey`) during v1 parsing so roadmap items B and C can be enabled later without re-parsing.

### Non-Goals

- **Generating** design-system artifacts (code component libraries, token files, Storybook). This is analysis/modeling only — confirmed with the user (interpretation "i", not "ii").
- In-node thumbnail rendering in the graph canvas (perf/storage cost) — sidebar preview only in v1.
- Turning every Figma layer into a node (a screen can have hundreds of layers). Deeper layers are **read** (for `instance_of` links, token usage, future planning-text extraction) but not made nodes. "Deep-expand a screen" is a future enhancement.
- User flows (B), design↔code mapping (C), design-system audit (D), planning-document analysis (E) — these are the roadmap, not v1.
- Offline `.fig` parsing (proprietary binary). Offline support arrives later via a local-JSON source adapter.

---

## Scope Decomposition (why foundation-first)

The user wants all five capabilities. They layer on a shared foundation, so we build the foundation first:

```
                       ③ C  Design ↔ Code
                       (needs Figma graph + code graph + matching)
                          ▲
   ② B Flows   ② D Audit   ② E Planning-text     ← built on the parsed structure
          ▲          ▲            ▲
          └──────────┴────────────┘
                     │
   ① Foundation: Figma ingestion + structure (+ light design-system model)   ← THIS SPEC
```

- **A (this spec)** establishes ingestion, the `kind: "design"` schema, the parsing module, the skill skeleton, and the dashboard view — the prerequisite for everything else.
- **B / D / E** are additional extractions over the same parsed data.
- **C** is the capstone: it needs both a Figma graph (A) and a code graph (`/understand`) plus a matching strategy.

Each roadmap item gets its own spec → plan → implementation cycle.

---

## Schema Extensions

Same mechanism as the `domain` and `knowledge` extensions: the `NodeType`/`EdgeType` zod enums are **closed** (`validateGraph` drops unknown types), so new types are **added** to the enums, and alias-map entries normalize LLM vocabulary. `GraphNode` uses `.passthrough()`, so a typed `figmaMeta` field rides alongside `domainMeta`/`knowledgeMeta`.

### Graph-Level Kind Flag

```typescript
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge" | "design"; // add "design"
  // ...
}
```

Graphs without a `kind` default to `"codebase"` (unchanged). The dashboard switches layout/styling on `kind`.

### New Node Types (6) — 21 → 27

| Type | What it represents | Example | ID convention |
|------|-------------------|---------|---------------|
| `page` | A Figma page (canvas) | "Onboarding" | `page:<figmaNodeId>` |
| `screen` | A top-level frame / artboard (a UI screen) | "Login" | `screen:<figmaNodeId>` |
| `component` | A main component | "Button/Primary" | `component:<figmaNodeId>` |
| `componentSet` | A set of variants | "Button" | `componentSet:<figmaNodeId>` |
| `instance` | A use of a component | "Login › SignInBtn" | `instance:<figmaNodeId>` |
| `token` | A design token / published style (color, type, spacing, effect, grid) | "color/brand-500" | `token:<tokenKind>:<name>` |

Figma "styles" are folded into `token` (distinguished by `figmaMeta.tokenKind`) to keep the type count down.

### New Edge Types (3) — 35 → 38 (+ reuse `contains`)

| Type | Direction | Meaning |
|------|-----------|---------|
| `contains` *(reuse)* | page → screen, screen → instance, componentSet → component | Structural containment |
| `instance_of` *(new)* | instance → component | An instance of a component |
| `variant_of` *(new)* | component → componentSet | A variant within a set |
| `uses_token` *(new)* | component / screen / instance → token | Applies a token / published style |

**⚠️ `instance_of` alias conflict.** `instance_of` is currently an entry in `EDGE_TYPE_ALIASES` mapping to `exemplifies` (added for knowledge mode). For design it must be a first-class edge. Resolution: **promote `instance_of` to a canonical `EdgeType` and remove its alias entry.** Knowledge-mode agents emit `exemplifies` directly (the alias was only a safety net), so the impact is negligible. This change is called out explicitly here and must be covered by a schema test.

`navigates_to` (prototype links, screen → screen) is **not** added in v1 — it belongs to roadmap item B. Prototype link data is preserved in `figmaMeta.prototypeTargets` so B can emit those edges later without re-parsing.

### New Metadata Interface

```typescript
export interface FigmaMeta {
  fileKey?: string;
  nodeId?: string;            // Figma node id, e.g. "1:23"
  figmaType?: string;         // raw Figma type: FRAME | COMPONENT | COMPONENT_SET | INSTANCE | TEXT ...
  thumbnailUrl?: string;      // lazily filled from GET /v1/images
  dimensions?: { width: number; height: number };
  tokenKind?: "color" | "type" | "spacing" | "effect" | "grid";
  tokenValue?: string;        // e.g. "#0A84FF", "16px"
  prototypeTargets?: string[]; // for roadmap B (flows) — recorded in v1, edges later
  componentKey?: string;       // for roadmap C (design↔code) — recorded in v1
}
```

Added as an optional field on `GraphNode`:

```typescript
export interface GraphNode {
  // ...existing fields
  figmaMeta?: FigmaMeta;
}
```

### Alias-Map Additions

For LLM/vocabulary robustness in the merge step:

- `NODE_TYPE_ALIASES`: `frame → screen`, `artboard → screen`, `canvas → page`, `main_component → component`, `variant_set → componentSet`, `component_set → componentSet`, `design_token → token`, `style → token`.
- `EDGE_TYPE_ALIASES`: `instantiates → instance_of`, `variant → variant_of`, `styled_by → uses_token`, `applies_token → uses_token`. (Remove the existing `instance_of → exemplifies` entry per the note above.)

---

## Ingestion: Source Adapter

A pluggable seam isolates "where the Figma document comes from" from "how it is parsed."

```typescript
// packages/core/src/figma/source/types.ts
export interface FigmaSource {
  /** Returns the raw Figma document tree (shape of GET /v1/files/:key). */
  fetchDocument(): Promise<FigmaDocument>;
  /** Returns published styles metadata (shape of GET /v1/files/:key/styles). */
  fetchStyles(): Promise<FigmaStyles>;
  /** Renders thumbnails for the given node ids (GET /v1/images). */
  renderImages(nodeIds: string[]): Promise<Record<string, string>>;
}
```

**v1 implementation — `FigmaApiSource`** (`source/api-source.ts`, Node-only):
- Reads the token from `process.env.FIGMA_TOKEN`. If absent, the skill stops with a friendly message ("create a token at figma.com/settings, then `export FIGMA_TOKEN=…`").
- `GET https://api.figma.com/v1/files/:key` for the document tree; `GET /v1/files/:key/styles` for styles; `GET /v1/images/:key?ids=…` for thumbnails (on demand).
- Accepts a Figma URL or a bare file key (URL parsed for the key).

**Future — `LocalJsonSource`**: reads a pre-exported JSON document. Same `FigmaSource` interface, no token, no network. This is how the foundation evolves from API-only (A) toward "both" (C in the earlier input-source discussion).

The API client and any `fetch` usage live in the Node-only part of `core` and are **never** exported from the browser-safe subpaths (`./search`, `./types`, `./schema`). The dashboard shares only schema types.

---

## Parsing & Granularity

The deterministic parser (`packages/core/src/figma/parse/`) walks the document tree and emits the structural skeleton. Granularity is **shallow**:

- **Nodes:** `page`, `screen` (top-level frames), `component`, `componentSet`, `instance`, `token`.
- **Not nodes:** Figma "sections" are flattened in v1 (their child frames attach to the parent `page`); nested groups and text/vector/shape leaf layers are not nodes either.
- **Still read (not nodes):** deeper layers are traversed to resolve `instance_of` targets, collect `uses_token` usage, capture `prototypeTargets`/`componentKey` into `figmaMeta`, and (later, for E) read planning text.

Node granularity ≠ parse granularity: the parser reads the full tree but only promotes the shallow set to nodes.

**Tokens (bounded on purpose):** v1 promotes **published styles and variables** (color/text/effect/grid styles, design variables) to `token` nodes — this keeps the token set meaningful and prevents node explosion. Raw inline values (e.g. a one-off hex) are recorded on the consuming node's `figmaMeta` but are **not** promoted to `token` nodes unless they resolve to a published style/variable. Each `token` node carries `figmaMeta.tokenKind` + `tokenValue`; `uses_token` edges connect consumers.

Output: `scan-manifest.json` (deterministic, no LLM) — the structural base graph.

---

## Agent Pipeline

Four phases, mirroring `/understand-knowledge` (deterministic parse → LLM enrich → merge → save).

| Phase | Step | Where | Output |
|-------|------|-------|--------|
| 1 | FETCH & PARSE | `core/figma` (deterministic) | `scan-manifest.json` |
| 2 | ANALYZE | `design-analyzer` LLM subagents (batched) | `analysis-batch-*.json` |
| 3 | MERGE | `core/figma/merge` + reuse `validateGraph` | `assembled-graph.json` |
| 4 | SAVE & LAUNCH | skill + `/understand-dashboard` | `knowledge-graph.json` |

### New Agent

| Agent | Input | Output |
|-------|-------|--------|
| `design-analyzer` *(new, modeled on `article-analyzer`)* | Batch of manifest nodes (id, name, type, `figmaMeta`, child summary, token usage) + existing node IDs | Per-node enrichment (summary, tags, layer hint, screen purpose) + conservative `related` edges. **Does not** re-emit structural nodes/edges. |

No scanner agent is needed — scanning is the Phase-1 deterministic parser (same as the wiki parse script).

### Intermediate Files

`.understand-anything/intermediate/` (cleaned up after assembly): `figma-doc.json` (raw tree cache), `scan-manifest.json`, `analysis-batch-*.json`, `assembled-graph.json`.

### Layers & Tour

- **Layers:** one per Figma page, plus a dedicated "Design System" layer (components, component sets, tokens).
- **Tour:** "Design System first → key screens", reusing the existing tour structure.

### Incremental Mode

On re-run, compare the Figma file `version`/`lastModified` (from the API) stored in `meta.json`. Unchanged → skip. Changed → full re-analyze in v1 (node-level incremental by Figma `nodeId` is a future optimization). This is the Figma analog of `/understand`'s commit-hash incremental.

---

## Dashboard Changes

All changes are scoped to `kind: "design"`. Net-new work is four spots; everything else is reused.

1. **`kind: "design"` branch** in `App.tsx` — adds a design view (like `KnowledgeGraphView` was added). The structure is hierarchical, so reuse the existing dagre/ELK hierarchical layout (similar to `DomainGraphView`'s LR).
2. **Node styling by type** — extend `CustomNode` with a type→color map:

| Node | Accent | Note |
|------|--------|------|
| `page` | Container / neutral | groups screens (also forms a layer) |
| `screen` | Blue (accent) | |
| `instance` | Green | |
| `component` | Violet | |
| `componentSet` | Amber | |
| `token` | Neutral + **color swatch** | color tokens show their actual color |

3. **Sidebar (`NodeInfo`) thumbnail — the only net-new UI.** On selecting a figma node, show a thumbnail block (name, type, dimensions, tags, relationships), reusing the existing slide-up/NodeInfo panel pattern.
4. **Thumbnail supply** — reuse the existing token-gated + path-allowlist dev-server endpoint pattern (as used by the code viewer's `/file-content.json`) as a `/figma-image` endpoint serving thumbnails on demand; or store thumbnail URLs in the graph.

Legend and filter gain the new node-type entries. Layout, search, filter, theme, and export are reused unchanged.

---

## Skill Interface

### Usage

```bash
/understand-figma https://www.figma.com/file/<KEY>/<name>   # URL
/understand-figma <FILE_KEY>                                 # bare key
/understand-figma <KEY> --page "Onboarding"                  # scope to one page (optional)
/understand-figma <KEY> --language ko                        # reuse existing --language
```

### Behavior

1. Parse URL/key; verify `FIGMA_TOKEN` (friendly error if missing).
2. Phase 1 fetch & parse → announce ("found N pages, N screens, N components, N tokens").
3. Phase 2 `design-analyzer` batches (up to 5 concurrent, as in `/understand`; tolerate batch failure — the manifest is a solid base).
4. Phase 3 merge → normalize → `validateGraph` → `kind: "design"`.
5. Phase 4 write `knowledge-graph.json` + `meta.json` (with Figma file version) → auto-launch `/understand-dashboard`.

### File Structure

```
understand-anything-plugin/
  skills/understand-figma/
    SKILL.md                  — thin orchestration
  agents/
    design-analyzer.md        — new LLM agent
  packages/core/src/figma/
    source/
      types.ts                — FigmaSource interface (adapter seam)
      api-source.ts           — FigmaApiSource (REST, Node-only)
    parse/
      parse-document.ts       — tree → nodes/edges (deterministic, tested)
      tokens.ts               — token/style extraction
    merge.ts                  — manifest + analysis assembly
    index.ts                  — Node-only entry (not exposed to dashboard subpaths)
    __tests__/                — vitest unit tests
```

---

## Roadmap (B · C · D · E)

Each is a later spec → plan → implementation cycle, built on this foundation.

| Item | Capability | Adds on top of v1 | Main new work |
|------|-----------|-------------------|---------------|
| **B** | User flows | `figmaMeta.prototypeTargets` → `navigates_to` edges + flow view | `navigates_to` edge type; flow layout (reuse flow/step + `DomainGraphView`) |
| **C** | Design ↔ code | `figmaMeta.componentKey` ↔ code-graph components | Combine two graphs; matching strategy (name/structure/LLM); cross-graph edges |
| **D** | Design-system audit | Analyze instance/token usage → reuse rate, detached instances, inconsistencies | Deterministic audit rules; dashboard badges |
| **E** | Planning-document analysis | LLM reads Figma planning text → `claim`/`entity` nodes (reuse knowledge mode) | Deep text-layer reading; extend or add an analyzer |

v1 records `prototypeTargets`, `componentKey`, and reads deep layers, so B/C/E attach without re-parsing.

---

## Backward Compatibility, Coexistence & Security

### Backward Compatibility

- All new node/edge types are additive (enum additions). Existing codebase/knowledge/domain graphs remain valid.
- Graphs without `kind` default to `"codebase"`.
- `figmaMeta` is an optional passthrough field — existing nodes are unaffected.
- Removing the `instance_of → exemplifies` alias has negligible impact (knowledge agents emit `exemplifies` directly); covered by a schema test.

### Coexistence

- Like the other modes, `/understand-figma` writes the shared `.understand-anything/knowledge-graph.json`. Running one mode replaces the prior graph (existing policy).
- For mixed repos, a `figma-knowledge-graph.json` subdomain graph can be produced and merged via the existing `merge-subdomain-graphs.py` pattern.

### Security

- **`FIGMA_TOKEN` is read from the environment only.** It is never written to the graph, config, `meta.json`, logs, or intermediate files. Request headers (carrying the token) are never printed in errors or logs.
- The pipeline makes an **outbound network call** to `api.figma.com` — a departure from `/understand`'s fully-offline nature. This is surfaced to the user in the skill's output and documented.
- `figma-doc.json` (raw tree cache) and thumbnails are design data (not secrets) but `.understand-anything/` should remain git-ignored by default.
- The thumbnail endpoint follows the existing token-gate + path-allowlist pattern used by the code viewer.

---

## Open Questions / Future Enhancements

- **Deep-expand a screen:** on-demand promotion of a single screen's deeper layers to nodes.
- **In-node thumbnails:** opt-in richer rendering once the sidebar-thumbnail pipeline is proven.
- **Local-JSON source:** the `FigmaSource` seam's offline implementation (evolves A → "both").
- **Node-level incremental:** diff by Figma `nodeId` instead of full re-analyze on file change.
