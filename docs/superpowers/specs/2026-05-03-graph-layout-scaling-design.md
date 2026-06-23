# Dashboard Graph Layout Scaling — Design

## Problem

When a structural-graph layer contains many nodes, the current `applyDagreLayout` (TB direction) places same-rank nodes in a single horizontal row. With 50+ nodes per rank, the row stretches into thousands of pixels and the view becomes unreadable: nodes shrink, labels disappear, edges tangle, and there are no visual anchors to orient the reader.

This design replaces dagre with ELK across all structural-style views, introduces folder/community-based **containers** for the layer-detail view, and computes layout in **two lazy stages** — a single-pass over containers, then per-container child layout on demand.

The graph schema and pipeline output (`graph.json`) are unchanged. All improvements derive from existing data.

## Goals

- Eliminate horizontal sprawl in layer-detail views at ≤100 nodes per layer (current target), and remain workable up to 1000+ nodes (future scaling).
- Give each layer-detail view explicit visual anchors so structure is readable at a glance.
- Aggregate cross-cluster edges by default; surface individual edges on demand.
- Keep visual style continuous with the existing layer-cluster (overview-level) presentation.
- Treat layout failures with the same `GraphIssue` model already used for schema validation.

## Non-Goals

- No regeneration of `graph.json`. All grouping is derived client-side.
- No change to KnowledgeGraphView (already force-directed; out of scope).
- No multi-level container nesting (single depth only in v1).
- No remote error reporting (Sentry-style) — open-source plugin, no default telemetry.
- No persona-specific grouping behavior beyond the existing node-type filter.

## Scope

Three views are affected:

| View | Change |
|---|---|
| Overview (layer clusters) | Replace dagre → ELK. No new grouping (layers are already groups). |
| DomainGraphView | Replace dagre → ELK with domain-as-parent of flow/step. |
| Layer-detail | Replace dagre → ELK + new folder/community containers + edge aggregation + lazy two-stage layout. |

KnowledgeGraphView remains on `applyForceLayout` and is not touched.

---

## §1. Architecture

```
existing graph (immutable)
    │
    ▼
deriveContainers(nodes, edges)           // §2 — folder strategy with community fallback
    │
    ▼
buildCompoundGraph()                     // §4 — aggregate inter-container edges, keep intra-container
    │
    ▼
runStage1Layout(containers, aggEdges)    // §6 — ELK on containers only; uses size memory
    │
    ▼   ┌──────────────────────────────┐
    │   │   render: containers laid    │
    │   │   out, children unrendered   │
    │   └──────────────────────────────┘
    │
    │   triggered by: click | zoom > 1.0 | search/focus/tour hit child
    ▼
runStage2Layout(container)               // §6 — ELK on one container's children; cached
    │
    ▼
React Flow render (parentId for parent-child) + visual overlay (selection/diff/search/tour)
```

Two invariants preserved from current code:

1. **Layout computation is pure and memoized.** It only re-runs when graph topology / persona / diff / focus / nodeTypeFilters change.
2. **Visual state is a separate O(n) overlay pass.** Selection, search highlight, tour highlight, hover do not trigger relayout.

This matches the existing `useLayerDetailTopology` / `useLayerDetailGraph` split in `GraphView.tsx`.

---

## §2. Container Derivation (Layer-Detail Only)

### 2.1 Folder strategy (default)

1. Collect every node's `filePath` in the layer.
2. Compute longest common prefix (LCP) across all paths and strip it.
3. Group by the **first path segment after the LCP**.
   - `auth/login.go` → container `auth`
   - `auth/handlers/oauth.go` → container `auth`
   - `cart/cart.go` → container `cart`
4. Single-depth grouping only; no recursive nesting in v1.
5. Nodes with no `filePath` (e.g. `concept` type) → container `~` (rendered as `(root)`, dimmed).

### 2.2 Community fallback (Louvain)

Triggered when **any** of:

- All nodes share the same single folder after LCP stripping.
- Bucket count (folders + rooted) `< 2`.
- Any single bucket (folder or rooted) holds `> 70%` of nodes.

Run Louvain modularity-based community detection on the layer's internal edges. Each community becomes a container. Names are placeholders (`Cluster A`, `Cluster B`, ...) since no semantic name is available.

Implementation: use `graphology` + `graphology-communities-louvain` (~30KB total). Pure JS, no native deps, runs on main thread synchronously for layer-internal edges.

### 2.3 Edge cases

| Case | Behavior |
|---|---|
| Container has 1 child (only when layer total ≥ 3) | No container box rendered; child becomes a top-level node in Stage 1 layout |
| Container has 2 children | Container rendered; label dimmed |
| All nodes lack `filePath` | All go to `~` container; if it would become single-child, fall back to flat |

### 2.4 Function signature

```ts
function deriveContainers(
  nodes: GraphNode[],
  edges: GraphEdge[],
): {
  containers: Array<{
    id: string;                        // e.g. "container:auth" or "container:cluster-0"
    name: string;                       // "auth" or "Cluster A"
    nodeIds: string[];
    strategy: "folder" | "community";
  }>;
  ungrouped: string[];                  // nodes that bypass containerization
};
```

The `strategy` field is exposed in the UI ("Grouped by folder" vs "Grouped by edge density") so the user knows how a particular layer was organized.

---

## §3. ELK Integration

### 3.1 Package

- `elkjs` ^0.9 (~250KB gzipped). Use `elk.bundled.js`, not the worker variant.
- Promise-based API. Runs on main thread for graphs ≤500 nodes; <100ms typical.

### 3.2 Configuration

```ts
{
  algorithm: "layered",
  "elk.direction": "DOWN",                                 // matches dagre TB
  "elk.layered.spacing.nodeNodeBetweenLayers": 80,
  "elk.spacing.nodeNode": 60,
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.compaction.postCompaction.strategy": "LEFT",
  "elk.padding": "[top=40,left=20,right=20,bottom=20]",   // container internal padding
}
```

`hierarchyHandling: INCLUDE_CHILDREN` is **not** used — the two-stage approach (§6) issues separate ELK calls for top-level containers and per-container children, so a single compound graph is never assembled.

### 3.3 Per-view input shaping

| View | ELK input |
|---|---|
| Overview | Flat. Children = layer-cluster nodes. |
| DomainGraphView | Flat in v1 (domain stays as the only grouping; flow/step nodes positioned within). |
| Layer-detail Stage 1 | Flat. Children = containers (treated as opaque atoms). |
| Layer-detail Stage 2 | Flat per container. Children = files within. |

A single `runElk(input): Promise<positioned>` function services all four cases.

### 3.4 Boundaries with existing `utils/layout.ts`

| Function | Status |
|---|---|
| `applyDagreLayout` | Kept temporarily; removed in the version after layout migration is verified stable |
| `applyForceLayout` | Untouched (KnowledgeGraphView only) |
| `applyElkLayout` (new) | Wrapper that handles repair → ELK → result coercion |

### 3.5 Async + loading state

Stage 1 runs in a `useEffect` with cancellation on dependency change:

```ts
useEffect(() => {
  let cancelled = false;
  setLayoutStatus("computing");
  applyElkLayout(input).then(result => {
    if (!cancelled) {
      setLayout(result);
      setLayoutStatus("ready");
    }
  });
  return () => { cancelled = true };
}, [graph, activeLayerId, persona, diffMode, nodeTypeFilters]);
```

While `layoutStatus === "computing"`, render a `"Computing layout…"` overlay (semi-transparent, centered). Stale layout from the previous state is kept underneath so the viewport doesn't blink.

### 3.6 Failure handling — reuses existing GraphIssue model

Before invoking ELK, run `repairElkInput()` over the assembled input. Each repair emits a `GraphIssue` consumed by the existing `WarningBanner`.

| Repair function | Triggered by | Issue level |
|---|---|---|
| `ensureNodeDimensions` | Node missing width/height | `auto-corrected` |
| `dedupeNodeIds` | Duplicate child id under same parent | `auto-corrected` |
| `dropOrphanEdges` | Edge source/target not in node set | `dropped` |
| `dropOrphanChildren` | Child references a non-existent parent | `dropped` |
| `dropCircularContainment` | Container containment cycle | `dropped` |

If ELK still rejects after repair → emit a `fatal` `GraphIssue`, render an empty graph + the existing fatal banner. The fatal copy text is augmented with "this looks like a dashboard rendering bug — please file an issue with the copied error" so the user knows to direct the report at the dashboard, not the graph data.

### 3.7 Dev mode strict failures

Both `repairElkInput` and `runElk` accept a `strict: boolean`. In `import.meta.env.DEV`, strict is on — repairs and ELK errors throw immediately rather than producing graceful issues. This catches input-construction bugs during development before they ship as silent fallbacks.

---

## §4. Edge Aggregation

### 4.1 Algorithm

Performed inside `buildCompoundGraph()`, before either ELK stage.

```ts
function aggregateContainerEdges(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeToContainer: Map<string, string>,
): {
  intraContainer: Edge[];                       // preserved as-is
  interContainerAggregated: AggregatedEdge[];   // one per (sourceContainer, targetContainer)
};
```

Rules:

- For each edge, look up source/target containers.
- Same container → intra (unchanged).
- Different containers → bucket by `(sourceContainer, targetContainer)`. Direction matters: A→B and B→A are independent.
- Each aggregated edge carries `count` and `types` (set of edge types appearing in the bucket).

### 4.2 Visual

Reuse the styling pattern already in overview-level edge aggregation (`GraphView.tsx` line ~186):

- `strokeWidth: Math.min(1 + Math.log2(count + 1), 5)`
- Label: count number
- Color: existing `rgba(212,165,116,0.4)`

### 4.3 Expand / collapse

State (zustand store):

```ts
expandedContainers: Set<string>;   // currently expanded container ids
```

Triggers:

- **Click container** → toggle membership.
- **Click empty canvas** or `Esc` → clear all.
- **Multi-container expansion is allowed** (user comparing two folders' relationships).

When a container is expanded:

- Its inter-container aggregated edges (both directions) are replaced with the underlying file→file individual edges.
- Other containers' aggregated edges remain aggregated.
- Position re-layout is **not** triggered. Only React Flow's edge array changes.

### 4.4 Interactions with persona / diff

- **Persona filter** changes `count` (post-filter edges only). Aggregated edge re-derived in the memoized pipeline.
- **Diff mode**: aggregated edge containing any changed node → red stroke + animated; on expand, individual edges follow normal diff styling.

---

## §5. Container Visual

### 5.1 New component: `ContainerNode`

A new React Flow node type `"container"` registered alongside the existing `custom` / `layer-cluster` / `portal`.

It does **not** reuse `LayerClusterNode` because:

- Click semantics differ (`LayerClusterNode` drills into a layer; `ContainerNode` toggles edge expansion).
- Metadata differs (`ContainerNode` does not carry `aggregateComplexity`).

Visual language is shared: rounded translucent box, gold border, DM Serif title.

### 5.2 Spec

| Element | Style |
|---|---|
| Border (default) | `1px solid rgba(212,165,116,0.25)` |
| Border (hover / expanded) | `1.5px rgba(212,165,116,0.6)`, expanded adds chevron `▾` |
| Background | `rgba(255,255,255,0.02)` |
| Corner radius | `12px` |
| Title | DM Serif, 14px, `#d4a574`, top-left padding `12px 16px` |
| Child-count badge | top-right chip, `#a39787`, 11px |
| Internal padding (around children) | `40px top / 20px L,R,B` |

### 5.3 Color coding

Container index modulo 12-color palette (same palette used for `layerColorIndex` in `LayerClusterNode`). Hue is applied at low saturation to border + title only — never to the body fill — so the palette doesn't overpower individual nodes inside.

### 5.4 State styles

| State | Visual |
|---|---|
| `default` | Base spec |
| `hover` | Brighter border, title underline |
| `expanded` | 1.5px gold border + chevron `▾` |
| `search-hit-inside` | Search badge in title row showing match count |
| `diff-affected` | Border swaps to `rgba(224,82,82,0.5)` |
| `focused-via-child` | Same as expanded plus brightness boost |

### 5.5 Label source

| Strategy | Label |
|---|---|
| `folder` | First path segment after LCP (e.g. `auth`) |
| `community` | `Cluster A`, `Cluster B`, ... ordered by community id |
| `~` (root) | `(root)` in dimmed style |

---

## §6. Lazy Two-Stage Layout

### 6.1 State machine

```
[layer entered]
    │
    │ Stage 1: ELK on containers (always runs)
    ▼
[containers laid out, children unrendered]
    │
    ├── click container ─────┐
    ├── zoom > 1.0 in viewport (200ms debounce, hysteresis) ─┤
    └── search / focus / tour hit a child ─┘
                                            ▼
                            Stage 2 (per container)
                                            │
                                            ▼
                       [container expanded, children laid out + rendered]
```

### 6.2 Store extensions

```ts
expandedContainers: Set<string>;
containerLayoutCache: Map<string, {
  childPositions: Map<string, { x: number; y: number }>;
  actualSize: { width: number; height: number };
}>;
containerSizeMemory: Map<string, { width: number; height: number }>;
```

- `containerLayoutCache` invalidated by `(graphHash, containerId)`.
- `containerSizeMemory` persists across container collapses to prevent jitter on next expand.

### 6.3 Stage 1

```ts
async function runStage1Layout(containers, aggregatedInterEdges, sizeMemory) {
  const elkInput = {
    id: "root",
    children: containers.map(c => ({
      id: c.id,
      width: sizeMemory.get(c.id)?.width
        ?? Math.sqrt(c.nodeIds.length) * NODE_WIDTH * 1.2,
      height: sizeMemory.get(c.id)?.height
        ?? Math.sqrt(c.nodeIds.length) * NODE_HEIGHT * 1.2,
    })),
    edges: aggregatedInterEdges.map(toElkEdge),
  };
  return runElk(elkInput);
}
```

Container size is estimated from `sqrt(childCount)` so it grows sub-linearly with content. If memory has the actual size from a previous run, that wins.

### 6.4 Stage 2

```ts
async function runStage2Layout(container, intraEdges) {
  if (containerLayoutCache.has(container.id)) {
    return containerLayoutCache.get(container.id)!;
  }
  const elkInput = {
    id: container.id,
    children: container.nodeIds.map(toElkChild),
    edges: intraEdges.filter(e => isWithin(container, e)).map(toElkEdge),
  };
  const result = await runElk(elkInput);
  containerLayoutCache.set(container.id, result);
  containerSizeMemory.set(container.id, result.actualSize);
  return result;
}
```

If `result.actualSize` differs from the Stage 1 estimate by **> 20%** in either dimension, trigger a Stage 1 re-layout (full re-run; <100ms at this scale, so the user perceives a small reflow rather than two distinct layouts).

### 6.5 Auto-expand triggers

| Trigger | Implementation |
|---|---|
| Click | `onClick` toggles `expandedContainers` |
| Zoom | React Flow `onMove` listener (200ms debounce). When viewport zoom > 1.0, all containers in viewport added to `expandedContainers`. Hysteresis: containers don't auto-collapse until zoom < 0.6, preventing flapping. |
| Search / focus / tour | `useEffect` watches `searchResults` / `focusNodeId` / `tourHighlightedNodeIds`; finds the parent container of any matched leaf node and adds to `expandedContainers` |

### 6.6 Performance budget

| Operation | Target |
|---|---|
| Stage 1 (any layer) | < 100ms |
| Stage 2 (first expand of a container) | < 100ms |
| Stage 2 (cache hit) | < 5ms |
| Zoom-driven auto-expand | 200ms debounce |
| Stage 1 re-layout after >20% deviation | < 100ms (re-uses Stage 1 path) |

---

## §7. Interaction Matrix

| Existing feature | Behavior with new layout |
|---|---|
| Persona filter | Drives `nodeTypeFilters` dependency in Stage 1 memo. Filtered-out nodes don't enter container derivation; containers with all-filtered children disappear. |
| Diff mode | Container with a changed child gets red border (§5.4); aggregated edges containing a changed node animate red; on expand, individual diff styling applies. |
| Focus mode (1-hop) | Focus node's container auto-expands. Non-neighbor containers fade to opacity 0.2; their children remain unrendered. |
| Search | Container with a hit gets search badge in title; container does **not** auto-expand to avoid expanding many at once. Clicking the badge expands and `fitView`s. |
| Tour | Tour-highlighted child auto-expands its container. `TourFitView` fits to the highlighted leaf positions (cached after expand). |
| Drill-in (`overview → layer-detail`) | Unchanged. After drill-in, Stage 1 runs on the new layer's containers. |
| Breadcrumb | Containers do not enter the breadcrumb. Path remains `Project > LAYER`. |
| Code viewer | Unchanged. Click a file node inside a container → existing slide-up viewer. |
| WarningBanner | Layout repair issues feed the same banner. Fatal copy text augmented to differentiate render bugs from data bugs. |
| Export (PNG/SVG) | Captures current state including expanded containers. Filename includes layer name. |

---

## §8. Files & Test Plan

### 8.1 Files

```
packages/dashboard/src/
├── utils/
│   ├── layout.ts              [modify] add applyElkLayout export
│   ├── elk-layout.ts          [new]    runElk + repairElkInput + GraphIssue mapping
│   ├── containers.ts          [new]    deriveContainers (folder + community fallback)
│   ├── louvain.ts             [new]    thin wrapper around graphology-communities-louvain
│   └── edgeAggregation.ts     [modify] add aggregateContainerEdges
├── components/
│   ├── ContainerNode.tsx      [new]    container box visual
│   ├── GraphView.tsx          [modify] Stage 1 / Stage 2 wiring, expand state, auto-expand triggers
│   └── DomainGraphView.tsx    [modify] dagre → ELK
├── store.ts                   [modify] expandedContainers, containerLayoutCache, containerSizeMemory
└── package.json               [modify] add elkjs ^0.9, graphology, graphology-communities-louvain
```

### 8.2 Test matrix

| Type | Target | Cases |
|---|---|---|
| Unit | `deriveContainers` | folder grouping happy path; all-in-root fallback; <2 buckets fallback; >70% concentration fallback; no-`filePath` nodes; single-child container suppression (gated by layer ≥ 3) |
| Unit | `aggregateContainerEdges` | empty edges; multiple same-direction edges merge; bidirectional edges split; intra + inter mix; types deduped |
| Unit | `repairElkInput` | each repair function in isolation; validates correct `GraphIssue` level emitted |
| Unit | `runElk` | minimal valid input; dev-mode strict throw; production graceful fatal; cancellation on dependency change |
| Integration | Stage 1 + Stage 2 flow | 50-node fixture; click → cache miss; second click → cache hit; size-deviation >20% → re-layout |
| Integration | Persona / focus / search interactions | switching persona reruns Stage 1; focusing a child auto-expands its container; search hit adds badge without auto-expanding |
| Visual regression (optional) | Playwright + microservices-demo fixture | baseline screenshots for overview, layer-detail, domain views |

### 8.3 Performance benchmarks

Generate fixtures with `scripts/generate-large-graph.mjs` at 500 / 1000 / 3000 nodes. Verify:

- Stage 1 < 200ms at 500 nodes; < 500ms at 3000 nodes.
- Stage 2 any container < 100ms.

If 3000-node Stage 1 misses the budget, revisit container size estimation or ELK config — do not lower the budget.

---

## Open Questions

None at this point. All decisions made during brainstorming are captured above.

## Migration Notes

- `applyDagreLayout` is kept in the codebase for one release after this lands, then removed in the next. This gives a fallback path during the rollout and a clean uninstall once stable.
- No graph data migration needed.
- New dependencies (elkjs, graphology, graphology-communities-louvain) are pure JS, no native bindings — safe across the supported platform matrix.
