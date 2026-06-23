# Business Domain Knowledge Extraction — Design Spec

**Issue:** [#61](https://github.com/Egonex-AI/Understand-Anything/issues/61)
**Date:** 2026-04-01

## Problem

The current knowledge graph shows file-level dependency relationships, but this has limited value — you can already see imports in an IDE. When files are many, listing dependency edges doesn't reduce cognitive load; you still mentally reconstruct what the code *does*. What's needed is business domain knowledge: the logic and domain concepts embedded within the code, not the structural wiring.

## Solution Overview

A new `/understand-domain` skill that extracts business domain knowledge and renders it as a horizontal flow graph in the dashboard. Two viewing modes: a high-level **Domain view** (default when available) and the existing **Structural view**, with a toggle to switch between them.

## Architecture: Separate File, Shared Schema (Approach C)

Domain data lives in a **separate file** (`domain-graph.json`) using the **same `KnowledgeGraph` type system** — extended with new node/edge types. The dashboard detects both files and offers a view toggle. Domain nodes can reference structural nodes by ID for drill-down.

**Why separate files:**
- `/understand-domain` works standalone (lightweight) or alongside full graph
- Shared schema means search, validation, and filtering work for both
- No risk of polluting the structural graph
- Each file is independently valid

## Section 1: Domain Graph Schema

### Three-Level Hierarchy

1. **Business Domain** (top) — e.g., "Purchasing", "Logistics", "Warehouse Management"
2. **Business Flow** (mid) — e.g., "Create Order", "Process Refund"
3. **Business Step** (leaf) — e.g., "Validate input", "Check inventory", "Persist order"

### New Node Types (3)

| Type | Purpose | Example |
|------|---------|---------|
| `domain` | Business domain cluster | "Order Management", "Logistics" |
| `flow` | A business process within a domain | "Create Order", "Process Refund" |
| `step` | A single step in a flow | "Validate order input" |

### New Edge Types (4)

| Type | Purpose |
|------|---------|
| `contains_flow` | domain → flow |
| `flow_step` | flow → step (ordered via `weight` field, e.g., 0.1, 0.2, ...) |
| `cross_domain` | domain → domain (interaction between domains) |
| `implements` | step → file/function node ID (reference into structural graph) |

### Domain Node Structure

```typescript
// domain node
{
  id: "domain:order-management",
  type: "domain",
  name: "Order Management",
  summary: "Handles the complete order lifecycle...",
  tags: ["e-commerce", "core-business"],
  complexity: "complex",
  domainMeta?: {
    entities: ["Order", "LineItem", "OrderStatus"],
    businessRules: ["Orders require inventory check before confirmation"],
    crossDomainInteractions: ["Triggers Logistics on order confirmed", "Reads from Customer Service for buyer info"]
  }
}
```

### Flow Node Structure

```typescript
{
  id: "flow:create-order",
  type: "flow",
  name: "Create Order",
  summary: "Customer submits a new order through the API",
  tags: ["write-path", "api"],
  complexity: "moderate",
  domainMeta?: {
    entryPoint: "POST /api/orders",
    entryType: "http" | "cli" | "event" | "cron" | "manual"
  }
}
```

### Step Node Structure

```typescript
{
  id: "step:create-order:validate-input",
  type: "step",
  name: "Validate order input",
  summary: "Checks request body against order schema, rejects invalid payloads",
  tags: ["validation"],
  complexity: "simple",
  filePath: "src/validators/order-validator.ts",
  lineRange: [12, 45]
}
```

### File Output

Saved to `.understand-anything/domain-graph.json` — same `KnowledgeGraph` shape, valid on its own.

## Section 2: Analysis Pipeline

### Two Paths, Same Output

**Path 1: Lightweight scan (no existing graph)**

```
File tree scan
    → Static entry point detection (tree-sitter)
        → Route definitions, exported handlers, main(), event listeners, cron decorators
    → Feed to LLM: file tree + detected entry points + sampled file contents
        → LLM outputs: domains, flows, steps, cross-domain interactions
    → Build domain-graph.json
```

Token cost: ~10-20% of a full `/understand` scan.

**Path 2: Derive from existing graph**

```
Load knowledge-graph.json
    → Extract: all nodes, edges, layers, summaries, tour
    → Feed to LLM: graph data as structured context
        → LLM outputs: domains, flows, steps, cross-domain interactions
    → Build domain-graph.json
```

Very cheap — no file reading needed, LLM reasons over existing summaries and call edges.

**Path Selection:** `/understand-domain` checks if `.understand-anything/knowledge-graph.json` exists. If yes → Path 2. If no → Path 1.

### Agent Structure

One new agent: **`domain-analyzer`** (opus model). Handles both paths. For large codebases, can batch by detected entry point groups.

## Section 3: Preprocessing Script & Skill Integration

### Script: `understand-anything-plugin/skills/understand-domain/extract-domain-context.py`

Bundled with the skill (not in `scripts/` which is for development tooling). Runs before the LLM agent. Outputs `.understand-anything/intermediate/domain-context.json`:

```json
{
  "fileTree": ["src/api/orders.ts", "src/services/...", "..."],
  "entryPoints": [
    {
      "file": "src/api/orders.ts",
      "type": "http",
      "method": "POST",
      "path": "/api/orders",
      "handler": "createOrder",
      "lineRange": [15, 45],
      "snippet": "async function createOrder(req, res) { ... }"
    }
  ],
  "fileSignatures": {
    "src/services/order-service.ts": {
      "exports": ["createOrder", "cancelOrder", "getOrderById"],
      "imports": ["inventory-service", "pricing-service", "order-repo"],
      "summary": null
    }
  }
}
```

Python script (no heavy dependencies — uses `ast` for Python, regex for other languages). Uses:
- Walk the file tree (respecting `.gitignore`)
- Detect entry points by pattern: route decorators, `app.get/post`, `export default handler`, `main()`, event listeners
- Extract function signatures and import/export lists per file
- Keep code snippets short (signature + first few lines, not full bodies)

### Skill Integration

The `/understand-domain` skill markdown:

1. Runs `understand-anything-plugin/skills/understand-domain/extract-domain-context.py`
2. Checks for existing `knowledge-graph.json`
3. If exists → passes both `domain-context.json` + graph data to domain-analyzer agent
4. If not → passes only `domain-context.json`
5. Agent outputs `domain-graph.json`
6. Cleans up intermediate files
7. Auto-triggers `/understand-dashboard`

## Section 4: Dashboard — Domain View

### View Toggle

- Top-left corner: pill toggle — **"Domain" / "Structural"**
- Domain view is default when `domain-graph.json` exists
- If only one graph file exists, no toggle shown
- Switching views preserves sidebar state

### Horizontal Flow Layout

- **Layout engine:** Dagre with `rankdir: "LR"` (left-to-right)
- **Zoom levels:**
  - **Zoomed out:** Domain clusters as large rounded rectangles, `cross_domain` edges between them
  - **Click domain:** Expands to show flows as horizontal lanes
  - **Click flow:** Shows step-by-step trace left-to-right

### Domain Cluster Rendering

```
┌─────────────────────────────────────┐
│  Order Management                   │
│  "Handles the complete order..."    │
│                                     │
│  Entities: Order, LineItem, Status  │
│  Flows: Create Order, Cancel Order  │
│  Rules: "Requires inventory check"  │
└─────────────────────────────────────┘
          ──cross_domain──→  [Logistics]
```

- Gold/amber border for domain clusters (matches existing theme)
- Shows summary, entity list, flow count on the cluster face
- Cross-domain edges: thick dashed lines with labels

### Flow Trace Rendering

```
POST /api/orders
  ┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐
  │ Validate  │───→│ Check        │───→│ Calculate  │───→│ Persist   │───→│ Send       │
  │ Input     │    │ Inventory    │    │ Pricing    │    │ Order     │    │ Confirm    │
  └──────────┘    └──────────────┘    └───────────┘    └──────────┘    └────────────┘
```

- Steps connected left-to-right by `flow_step` edges (ordered by `weight`)
- Entry point label at the left as flow trigger
- Clicking a step → sidebar shows detail + link to structural view

### Sidebar Adaptations

**Domain node selected:** Summary, business rules, entities, cross-domain interactions, list of flows (clickable)

**Flow node selected:** Entry point info, step list in order, complexity

**Step node selected:** Description, "View in code" link (switches to structural view + navigates to file/function), previous/next step links

### Drill-Down: Domain → Structural

When a step has an `implements` edge referencing a structural node ID:
- "View implementation" button in sidebar
- Switches to structural view and navigates to that node
- Breadcrumb: `Domain: Order Management > Flow: Create Order > Step: Validate Input → [structural view]`

## Section 5: Skill Definition

### `/understand-domain` Skill

- **File:** `skills/understand-domain.md`
- **Arguments:** Optional `--full` flag to force Path 1 (rescan even if graph exists)

### Execution Flow

```
1. Run scripts/extract-domain-context.mjs
2. Check for .understand-anything/knowledge-graph.json
   ├── Exists → Path 2: load graph + domain-context.json
   └── Missing → Path 1: domain-context.json only
3. Invoke domain-analyzer agent (opus)
4. Validate output against schema
5. Save .understand-anything/domain-graph.json
6. Clean up intermediate/domain-context.json
7. Auto-trigger /understand-dashboard
```

### Domain Analyzer Agent

- **File:** `agents/domain-analyzer.md`
- **Model:** opus
- **Input:** Either (file tree + entry points) or (existing knowledge graph)
- **Output:** Complete domain graph JSON

### Change Map

| Area | Changes |
|------|---------|
| `packages/core/src/types.ts` | Add 3 node types, 4 edge types, `domainMeta` optional field |
| `packages/core/src/schema.ts` | Extend Zod schemas + aliases for new types |
| `packages/core/src/persistence/` | Add `loadDomainGraph()` / `saveDomainGraph()` |
| `understand-anything-plugin/skills/understand-domain/extract-domain-context.py` | New preprocessing script (bundled with skill) |
| `agents/domain-analyzer.md` | New agent definition |
| `skills/understand-domain.md` | New skill definition |
| `packages/dashboard/src/store.ts` | Add `domainGraph`, `viewMode` state |
| `packages/dashboard/src/components/` | New: `DomainGraphView.tsx`, `DomainClusterNode.tsx`, `FlowTraceNode.tsx`, `StepNode.tsx` |
| `packages/dashboard/src/components/` | Modify: `App.tsx` (view toggle), `NodeInfo.tsx` (domain sidebar), `FilterPanel.tsx` (domain filters) |
| `packages/dashboard/src/utils/` | New: `domain-layout.ts` (horizontal Dagre config) |

## Section 6: Error Tolerance

### Pipeline-Level Tolerance

| Stage | Error Handling |
|-------|---------------|
| Preprocessing script | If tree-sitter fails on a file, skip and continue. Log skipped files. Entry point detection is best-effort. |
| LLM output parsing | Same strategy as existing `parseTourGenerationResponse()` — extract JSON from markdown, handle partial responses. |
| Schema validation | Existing auto-fix pipeline: sanitize → normalize (aliases) → apply defaults → validate. Drop broken nodes/edges, don't fail the whole graph. |
| Cross-graph references | `implements` edges pointing to non-existent structural node IDs → keep edge but mark as `unresolved`. Dashboard shows step without drill-down link. |

### Domain-Specific Validation Rules

- **Domain with no flows:** Warn, keep (summary/entities still useful)
- **Flow with no steps:** Warn, keep (entry point info still valuable)
- **Steps with broken ordering:** Re-number sequentially by array position if `weight` values missing/duplicate
- **Orphan steps:** Steps not connected to any flow → attach to synthetic "Uncategorized" flow
- **Duplicate domains:** Merge by name similarity (fuzzy match), combine flows
- **Empty domain graph:** Error banner in dashboard: "Domain extraction failed — try running `/understand` first for richer context, then `/understand-domain`"

### Dashboard Resilience

- If `domainMeta` missing on a domain node, sidebar shows only summary/tags
- If `domain-graph.json` fails validation entirely, fall back to structural view with warning banner
- Partial graphs render what's valid

### Normalization Aliases for Domain Types

```typescript
// Node type aliases
"business_domain" → "domain"
"process" → "flow"
"workflow" → "flow"
"action" → "step"
"task" → "step"

// Edge type aliases
"has_flow" → "contains_flow"
"next_step" → "flow_step"
"interacts_with" → "cross_domain"
"implemented_by" → "implements"
```
