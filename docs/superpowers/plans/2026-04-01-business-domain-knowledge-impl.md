# Business Domain Knowledge Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/understand-domain` skill that extracts business domain knowledge from codebases and renders it as an interactive horizontal flow graph in the dashboard.

**Architecture:** Separate `domain-graph.json` file using extended `KnowledgeGraph` schema (3 new node types, 4 new edge types, optional `domainMeta` field). Two analysis paths: lightweight scan (no existing graph) or derivation from existing graph. Dashboard shows domain view by default when available, with pill toggle to switch to structural view.

**Tech Stack:** TypeScript, Zod, React Flow (dagre LR layout), Zustand, Vitest, web-tree-sitter

**Design Spec:** `docs/plans/2026-04-01-business-domain-knowledge-design.md`

---

## Task 1: Extend Core Types

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`

- [ ] **Step 1: Write failing test for new node types**

Create test file:

```typescript
// understand-anything-plugin/packages/core/src/__tests__/domain-types.test.ts
import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: [],
    description: "A test project",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:order-management",
      type: "domain",
      name: "Order Management",
      summary: "Handles order lifecycle",
      tags: ["core"],
      complexity: "complex",
    },
    {
      id: "flow:create-order",
      type: "flow",
      name: "Create Order",
      summary: "Customer submits a new order",
      tags: ["write-path"],
      complexity: "moderate",
      domainMeta: {
        entryPoint: "POST /api/orders",
        entryType: "http",
      },
    },
    {
      id: "step:create-order:validate",
      type: "step",
      name: "Validate Input",
      summary: "Checks request body",
      tags: ["validation"],
      complexity: "simple",
      filePath: "src/validators/order.ts",
      lineRange: [10, 30],
    },
  ],
  edges: [
    {
      source: "domain:order-management",
      target: "flow:create-order",
      type: "contains_flow",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "flow:create-order",
      target: "step:create-order:validate",
      type: "flow_step",
      direction: "forward",
      weight: 0.1,
    },
  ],
  layers: [],
  tour: [],
};

describe("domain graph types", () => {
  it("validates a domain graph with domain/flow/step node types", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(3);
    expect(result.data!.edges).toHaveLength(2);
  });

  it("validates contains_flow edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("contains_flow");
  });

  it("validates flow_step edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[1].type).toBe("flow_step");
  });

  it("validates cross_domain edge type", () => {
    const graph = structuredClone(domainGraph);
    graph.nodes.push({
      id: "domain:logistics",
      type: "domain",
      name: "Logistics",
      summary: "Handles shipping",
      tags: [],
      complexity: "moderate",
    });
    graph.edges.push({
      source: "domain:order-management",
      target: "domain:logistics",
      type: "cross_domain",
      direction: "forward",
      description: "Triggers on order confirmed",
      weight: 0.6,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });

  it("normalizes domain type aliases", () => {
    const graph = structuredClone(domainGraph);
    (graph.nodes[0] as any).type = "business_domain";
    (graph.nodes[1] as any).type = "workflow";
    (graph.nodes[2] as any).type = "action";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("domain");
    expect(result.data!.nodes[1].type).toBe("flow");
    expect(result.data!.nodes[2].type).toBe("step");
  });

  it("normalizes domain edge type aliases", () => {
    const graph = structuredClone(domainGraph);
    (graph.edges[0] as any).type = "has_flow";
    (graph.edges[1] as any).type = "next_step";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("contains_flow");
    expect(result.data!.edges[1].type).toBe("flow_step");
  });

  it("preserves domainMeta on nodes through validation", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    // domainMeta is passthrough — schema uses .passthrough()
    const flowNode = result.data!.nodes.find((n) => n.id === "flow:create-order");
    expect((flowNode as any).domainMeta).toEqual({
      entryPoint: "POST /api/orders",
      entryType: "http",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-types.test.ts`

Expected: FAIL — "domain" is not a valid NodeType enum value

- [ ] **Step 3: Add domain/flow/step to NodeType union**

In `understand-anything-plugin/packages/core/src/types.ts`, update the `NodeType` union (lines 1-5):

```typescript
// Node types (16 total: 5 code + 8 non-code + 3 domain)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step";
```

Update `EdgeType` union (lines 7-15):

```typescript
// Edge types (30 total in 7 categories)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain";                 // Domain
```

Add `DomainMeta` interface after `GraphNode` (after line 28):

```typescript
// Optional domain metadata for domain/flow/step nodes
export interface DomainMeta {
  // For domain nodes
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  // For flow nodes
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}
```

- [ ] **Step 4: Update Zod schemas in schema.ts**

In `understand-anything-plugin/packages/core/src/schema.ts`:

Update `EdgeTypeSchema` (lines 4-12) to add the 4 new edge types:

```typescript
export const EdgeTypeSchema = z.enum([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "reads_from", "writes_to", "transforms", "validates",
  "depends_on", "tested_by", "configures",
  "related", "similar_to",
  "deploys", "serves", "provisions", "triggers",
  "migrates", "documents", "routes", "defines_schema",
  "contains_flow", "flow_step", "cross_domain",
]);
```

Add domain aliases to `NODE_TYPE_ALIASES` (after line 52):

```typescript
  // Domain aliases
  business_domain: "domain",
  process: "flow",
  workflow: "flow",
  action: "step",
  task: "step",
```

Note: This overwrites the existing `workflow: "pipeline"` and `action: "pipeline"` mappings. Since domain extraction is the newer, higher-priority feature, the domain aliases take precedence. The LLM prompt for structural analysis already uses `"pipeline"` directly.

Add domain edge aliases to `EDGE_TYPE_ALIASES` (after line 81):

```typescript
  // Domain edge aliases
  has_flow: "contains_flow",
  next_step: "flow_step",
  interacts_with: "cross_domain",
  implemented_by: "implements",
```

Update `GraphNodeSchema` (lines 310-324) to add domain types and use `.passthrough()`:

```typescript
export const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource",
    "domain", "flow", "step",
  ]),
  name: z.string(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  summary: z.string(),
  tags: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"]),
  languageNotes: z.string().optional(),
}).passthrough();
```

The `.passthrough()` allows `domainMeta` and other extra fields to survive validation without needing to define them in Zod (keeps the schema simple and forward-compatible).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-types.test.ts`

Expected: All 7 tests PASS

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run`

Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts \
       understand-anything-plugin/packages/core/src/schema.ts \
       understand-anything-plugin/packages/core/src/__tests__/domain-types.test.ts
git commit -m "feat(core): add domain/flow/step node types and domain edge types for business domain knowledge"
```

---

## Task 2: Add Domain Graph Persistence

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`

- [ ] **Step 1: Write failing test for domain graph persistence**

```typescript
// understand-anything-plugin/packages/core/src/__tests__/domain-persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveDomainGraph, loadDomainGraph } from "../persistence/index.js";
import type { KnowledgeGraph } from "../types.js";

const testRoot = join(tmpdir(), "ua-domain-persist-test");

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test",
    languages: ["typescript"],
    frameworks: [],
    description: "test",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:orders",
      type: "domain" as any,
      name: "Orders",
      summary: "Order management",
      tags: [],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("domain graph persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads domain graph", () => {
    saveDomainGraph(testRoot, domainGraph);
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes[0].id).toBe("domain:orders");
  });

  it("returns null when no domain graph exists", () => {
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).toBeNull();
  });

  it("saves to domain-graph.json, not knowledge-graph.json", () => {
    saveDomainGraph(testRoot, domainGraph);
    const domainPath = join(testRoot, ".understand-anything", "domain-graph.json");
    const structuralPath = join(testRoot, ".understand-anything", "knowledge-graph.json");
    expect(existsSync(domainPath)).toBe(true);
    expect(existsSync(structuralPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-persistence.test.ts`

Expected: FAIL — `saveDomainGraph` is not exported

- [ ] **Step 3: Implement saveDomainGraph and loadDomainGraph**

Add to `understand-anything-plugin/packages/core/src/persistence/index.ts` (after `loadConfig` function, before end of file):

```typescript
const DOMAIN_GRAPH_FILE = "domain-graph.json";

export function saveDomainGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseFilePaths(graph, projectRoot);
  writeFileSync(
    join(dir, DOMAIN_GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadDomainGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, DOMAIN_GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid domain graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}
```

- [ ] **Step 4: Export from core index**

Add to `understand-anything-plugin/packages/core/src/index.ts` (after the existing persistence re-exports on line 2):

The existing line 2 is `export * from "./persistence/index.js";` which will auto-export the new functions. No change needed — the wildcard export picks up `saveDomainGraph` and `loadDomainGraph` automatically.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-persistence.test.ts`

Expected: All 3 tests PASS

- [ ] **Step 6: Run all core tests for regressions**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run`

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/persistence/index.ts \
       understand-anything-plugin/packages/core/src/__tests__/domain-persistence.test.ts
git commit -m "feat(core): add saveDomainGraph/loadDomainGraph persistence functions"
```

---

## Task 3: Update Normalize Graph for Domain ID Prefixes

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/analyzer/normalize-graph.ts`

- [ ] **Step 1: Write failing test for domain ID normalization**

```typescript
// understand-anything-plugin/packages/core/src/__tests__/domain-normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeNodeId } from "../analyzer/normalize-graph.js";

describe("domain node ID normalization", () => {
  it("normalizes domain node IDs", () => {
    const result = normalizeNodeId("domain:order-management", {
      type: "domain",
      name: "Order Management",
    });
    expect(result).toBe("domain:order-management");
  });

  it("normalizes flow node IDs", () => {
    const result = normalizeNodeId("flow:create-order", {
      type: "flow",
      name: "Create Order",
    });
    expect(result).toBe("flow:create-order");
  });

  it("normalizes step node IDs with filePath", () => {
    const result = normalizeNodeId("step:create-order:validate", {
      type: "step",
      name: "Validate",
      filePath: "src/validators/order.ts",
    });
    expect(result).toBe("step:src/validators/order.ts:validate");
  });

  it("normalizes step node IDs without filePath", () => {
    const result = normalizeNodeId("step:validate", {
      type: "step",
      name: "Validate",
    });
    expect(result).toBe("step:validate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-normalize.test.ts`

Expected: FAIL — "domain" is not a valid prefix in `VALID_PREFIXES`

- [ ] **Step 3: Add domain prefixes to normalize-graph.ts**

In `understand-anything-plugin/packages/core/src/analyzer/normalize-graph.ts`:

Add `"domain"`, `"flow"`, `"step"` to `VALID_PREFIXES` (lines 1-5):

```typescript
const VALID_PREFIXES = new Set([
  "file", "func", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
  "domain", "flow", "step",
]);
```

Add to `TYPE_TO_PREFIX` map (lines 7-21):

```typescript
  domain: "domain",
  flow: "flow",
  step: "step",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/domain-normalize.test.ts`

Expected: All 4 tests PASS

- [ ] **Step 5: Run all core tests**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/analyzer/normalize-graph.ts \
       understand-anything-plugin/packages/core/src/__tests__/domain-normalize.test.ts
git commit -m "feat(core): add domain/flow/step prefixes to node ID normalization"
```

---

## Task 4: Build Core Package and Verify

**Files:**
- None (build verification)

- [ ] **Step 1: Build core package**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`

Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run`

Expected: All tests PASS

- [ ] **Step 3: Commit (if any build config changes were needed)**

Only commit if build required changes. Otherwise skip.

---

## Task 5: Dashboard Store — Add Domain State

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`

- [ ] **Step 1: Add ViewMode type and domain state to store**

In `understand-anything-plugin/packages/dashboard/src/store.ts`:

Add `ViewMode` type after the existing type definitions (after line 14):

```typescript
export type ViewMode = "structural" | "domain";
```

Update `NodeType` (line 12) to include domain types:

```typescript
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step";
```

Update `ALL_NODE_TYPES` (line 23):

```typescript
export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step"];
```

Add domain edge category to `EDGE_CATEGORY_MAP` (after line 33):

```typescript
export const EDGE_CATEGORY_MAP: Record<EdgeCategory, string[]> = {
  structural: ["imports", "exports", "contains", "inherits", "implements"],
  behavioral: ["calls", "subscribes", "publishes", "middleware"],
  "data-flow": ["reads_from", "writes_to", "transforms", "validates"],
  dependencies: ["depends_on", "tested_by", "configures"],
  semantic: ["related", "similar_to"],
};

export const DOMAIN_EDGE_TYPES = ["contains_flow", "flow_step", "cross_domain"];
```

Add to `DashboardStore` interface (after line 93):

```typescript
  // Domain view
  viewMode: ViewMode;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

  setDomainGraph: (graph: KnowledgeGraph) => void;
  setViewMode: (mode: ViewMode) => void;
  navigateToDomain: (domainId: string) => void;
```

- [ ] **Step 2: Implement domain state in the create() block**

In the `create<DashboardStore>()` call (after line 183):

```typescript
  viewMode: "structural",
  domainGraph: null,
  activeDomainId: null,

  setDomainGraph: (graph) => {
    set({ domainGraph: graph, viewMode: "domain" });
  },

  setViewMode: (mode) => {
    set({
      viewMode: mode,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
    });
  },

  navigateToDomain: (domainId) => {
    set({
      activeDomainId: domainId,
      selectedNodeId: null,
      focusNodeId: null,
    });
  },
```

- [ ] **Step 3: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/store.ts
git commit -m "feat(dashboard): add domain view state to store (viewMode, domainGraph, activeDomainId)"
```

---

## Task 6: Dashboard — View Mode Toggle

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

- [ ] **Step 1: Add domain graph loading to Dashboard component**

In `understand-anything-plugin/packages/dashboard/src/App.tsx`, add store selectors (after line 81):

```typescript
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
```

Add a `useEffect` to load `domain-graph.json` (after the diff-overlay useEffect, ~line 265):

```typescript
  useEffect(() => {
    fetch(tokenUrl("/domain-graph.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        }
      })
      .catch(() => {
        // Silently ignore — domain graph is optional
      });
  }, [setDomainGraph]);
```

- [ ] **Step 2: Add view mode toggle pill to header**

In the header left section (after PersonaSelector, around line 290), add the toggle pill. Only show when both graphs exist:

```typescript
          {graph && domainGraph && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode("domain")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "domain"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Domain
                </button>
                <button
                  onClick={() => setViewMode("structural")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "structural"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Structural
                </button>
              </div>
            </>
          )}
```

- [ ] **Step 3: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/App.tsx
git commit -m "feat(dashboard): add domain graph loading and view mode toggle pill"
```

---

## Task 7: Dashboard — Domain Cluster Node Component

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/DomainClusterNode.tsx`

- [ ] **Step 1: Create the DomainClusterNode component**

```typescript
// understand-anything-plugin/packages/dashboard/src/components/DomainClusterNode.tsx
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface DomainClusterData {
  label: string;
  summary: string;
  entities?: string[];
  flowCount: number;
  businessRules?: string[];
  domainId: string;
}

export type DomainClusterFlowNode = Node<DomainClusterData, "domain-cluster">;

function DomainClusterNode({ data, id }: NodeProps<DomainClusterFlowNode>) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const isSelected = selectedNodeId === data.domainId;

  return (
    <div
      className={`rounded-xl border-2 px-5 py-4 min-w-[280px] max-w-[360px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10 shadow-lg shadow-accent/10"
          : "border-accent/40 bg-surface hover:border-accent/70"
      }`}
      onClick={() => selectNode(data.domainId)}
      onDoubleClick={() => navigateToDomain(data.domainId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      <div className="font-serif text-sm text-accent font-semibold mb-1 truncate">
        {data.label}
      </div>
      <div className="text-[11px] text-text-secondary line-clamp-2 mb-2">
        {data.summary}
      </div>

      {data.entities && data.entities.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Entities</div>
          <div className="flex flex-wrap gap-1">
            {data.entities.slice(0, 5).map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-text-secondary">
                {e}
              </span>
            ))}
            {data.entities.length > 5 && (
              <span className="text-[10px] text-text-muted">+{data.entities.length - 5}</span>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-text-muted">
        {data.flowCount} flow{data.flowCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default memo(DomainClusterNode);
```

- [ ] **Step 2: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/DomainClusterNode.tsx
git commit -m "feat(dashboard): add DomainClusterNode component for domain view"
```

---

## Task 8: Dashboard — Flow and Step Node Components

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/FlowNode.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/StepNode.tsx`

- [ ] **Step 1: Create the FlowNode component**

```typescript
// understand-anything-plugin/packages/dashboard/src/components/FlowNode.tsx
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface FlowNodeData {
  label: string;
  summary: string;
  entryPoint?: string;
  entryType?: string;
  stepCount: number;
  flowId: string;
}

export type FlowFlowNode = Node<FlowNodeData, "flow-node">;

function FlowNode({ data }: NodeProps<FlowFlowNode>) {
  const selectNode = useDashboardStore((s) => s.selectNode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const isSelected = selectedNodeId === data.flowId;

  return (
    <div
      className={`rounded-lg border px-4 py-3 min-w-[240px] max-w-[320px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-medium bg-surface hover:border-accent/50"
      }`}
      onClick={() => selectNode(data.flowId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      {data.entryPoint && (
        <div className="text-[9px] font-mono text-accent/70 mb-1 truncate">
          {data.entryPoint}
        </div>
      )}
      <div className="text-xs font-semibold text-text-primary mb-1 truncate">
        {data.label}
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      <div className="text-[9px] text-text-muted mt-1">
        {data.stepCount} step{data.stepCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default memo(FlowNode);
```

- [ ] **Step 2: Create the StepNode component**

```typescript
// understand-anything-plugin/packages/dashboard/src/components/StepNode.tsx
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface StepNodeData {
  label: string;
  summary: string;
  filePath?: string;
  stepId: string;
  order: number;
}

export type StepFlowNode = Node<StepNodeData, "step-node">;

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const selectNode = useDashboardStore((s) => s.selectNode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const isSelected = selectedNodeId === data.stepId;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 min-w-[180px] max-w-[240px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-subtle bg-elevated hover:border-accent/40"
      }`}
      onClick={() => selectNode(data.stepId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-text-muted/40 !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Right} className="!bg-text-muted/40 !w-1.5 !h-1.5" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-mono text-accent/60 shrink-0">
          {data.order}
        </span>
        <span className="text-[11px] font-medium text-text-primary truncate">
          {data.label}
        </span>
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      {data.filePath && (
        <div className="text-[9px] font-mono text-text-muted mt-1 truncate">
          {data.filePath}
        </div>
      )}
    </div>
  );
}

export default memo(StepNode);
```

- [ ] **Step 3: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/FlowNode.tsx \
       understand-anything-plugin/packages/dashboard/src/components/StepNode.tsx
git commit -m "feat(dashboard): add FlowNode and StepNode components for domain view"
```

---

## Task 9: Dashboard — Domain Graph View

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/DomainGraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

- [ ] **Step 1: Create the DomainGraphView component**

```typescript
// understand-anything-plugin/packages/dashboard/src/components/DomainGraphView.tsx
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import DomainClusterNode from "./DomainClusterNode";
import type { DomainClusterFlowNode } from "./DomainClusterNode";
import FlowNode from "./FlowNode";
import type { FlowFlowNode } from "./FlowNode";
import StepNode from "./StepNode";
import type { StepFlowNode } from "./StepNode";
import { useDashboardStore } from "../store";
import { useTheme } from "../themes/index.ts";
import { applyDagreLayout } from "../utils/layout";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

const nodeTypes = {
  "domain-cluster": DomainClusterNode,
  "flow-node": FlowNode,
  "step-node": StepNode,
};

// Dimensions for domain-specific nodes
const DOMAIN_NODE_DIMENSIONS = new Map<string, { width: number; height: number }>();

function getDomainMeta(node: GraphNode): Record<string, unknown> | undefined {
  return (node as any).domainMeta;
}

function buildDomainOverview(graph: KnowledgeGraph): { nodes: Node[]; edges: Edge[] } {
  const domainNodes = graph.nodes.filter((n) => n.type === "domain");
  const flowNodes = graph.nodes.filter((n) => n.type === "flow");

  // Count flows per domain
  const flowCountMap = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "contains_flow") {
      flowCountMap.set(edge.source, (flowCountMap.get(edge.source) ?? 0) + 1);
    }
  }

  const rfNodes: Node[] = domainNodes.map((node) => {
    const meta = getDomainMeta(node);
    const data = {
      label: node.name,
      summary: node.summary,
      entities: meta?.entities as string[] | undefined,
      flowCount: flowCountMap.get(node.id) ?? 0,
      businessRules: meta?.businessRules as string[] | undefined,
      domainId: node.id,
    };
    DOMAIN_NODE_DIMENSIONS.set(node.id, { width: 320, height: 180 });
    return {
      id: node.id,
      type: "domain-cluster" as const,
      position: { x: 0, y: 0 },
      data,
    };
  });

  const rfEdges: Edge[] = graph.edges
    .filter((e) => e.type === "cross_domain")
    .map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: e.description ?? "",
      style: { stroke: "var(--color-accent)", strokeDasharray: "6 3", strokeWidth: 2 },
      labelStyle: { fill: "var(--color-text-muted)", fontSize: 10 },
      animated: true,
    }));

  return applyDagreLayout(rfNodes, rfEdges, "LR", DOMAIN_NODE_DIMENSIONS);
}

function buildDomainDetail(
  graph: KnowledgeGraph,
  domainId: string,
): { nodes: Node[]; edges: Edge[] } {
  // Find flows for this domain
  const flowIds = new Set(
    graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === domainId)
      .map((e) => e.target),
  );

  const flowNodes = graph.nodes.filter((n) => flowIds.has(n.id));
  const stepEdges = graph.edges.filter(
    (e) => e.type === "flow_step" && flowIds.has(e.source),
  );
  const stepIds = new Set(stepEdges.map((e) => e.target));
  const stepNodes = graph.nodes.filter((n) => stepIds.has(n.id));

  // Build step order map
  const stepOrderMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepOrderMap.set(edge.target, edge.weight);
  }

  // Count steps per flow
  const stepCountMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepCountMap.set(edge.source, (stepCountMap.get(edge.source) ?? 0) + 1);
  }

  const dims = new Map<string, { width: number; height: number }>();

  const rfNodes: Node[] = [
    ...flowNodes.map((node) => {
      const meta = getDomainMeta(node);
      dims.set(node.id, { width: 260, height: 120 });
      return {
        id: node.id,
        type: "flow-node" as const,
        position: { x: 0, y: 0 },
        data: {
          label: node.name,
          summary: node.summary,
          entryPoint: meta?.entryPoint as string | undefined,
          entryType: meta?.entryType as string | undefined,
          stepCount: stepCountMap.get(node.id) ?? 0,
          flowId: node.id,
        },
      };
    }),
    ...stepNodes.map((node) => {
      dims.set(node.id, { width: 200, height: 90 });
      return {
        id: node.id,
        type: "step-node" as const,
        position: { x: 0, y: 0 },
        data: {
          label: node.name,
          summary: node.summary,
          filePath: node.filePath,
          stepId: node.id,
          order: Math.round((stepOrderMap.get(node.id) ?? 0) * 10),
        },
      };
    }),
  ];

  const rfEdges: Edge[] = stepEdges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: "var(--color-border-medium)", strokeWidth: 1.5 },
    animated: false,
  }));

  return applyDagreLayout(rfNodes, rfEdges, "LR", dims);
}

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const navigateToOverview = useDashboardStore((s) => s.navigateToOverview);
  const theme = useTheme();

  const { nodes, edges } = useMemo(() => {
    if (!domainGraph) return { nodes: [], edges: [] };
    if (activeDomainId) {
      return buildDomainDetail(domainGraph, activeDomainId);
    }
    return buildDomainOverview(domainGraph);
  }, [domainGraph, activeDomainId]);

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "domain-cluster" && node.data && "domainId" in node.data) {
        navigateToDomain(node.data.domainId as string);
      }
    },
    [navigateToDomain],
  );

  if (!domainGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No domain graph available. Run /understand-domain to generate one.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {activeDomainId && (
        <div className="absolute top-3 left-3 z-10">
          <button
            onClick={() => {
              useDashboardStore.setState({ activeDomainId: null });
            }}
            className="px-3 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
          >
            Back to domains
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-subtle)"
        />
        <Controls
          showInteractive={false}
          style={{ bottom: 16, left: 16 }}
        />
        <MiniMap
          nodeColor={() => theme.colors?.accent ?? "#d4a574"}
          maskColor="rgba(0,0,0,0.7)"
          style={{ bottom: 16, right: 16, width: 160, height: 100 }}
        />
      </ReactFlow>
    </div>
  );
}

export default function DomainGraphView() {
  return (
    <ReactFlowProvider>
      <DomainGraphViewInner />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: Wire DomainGraphView into App.tsx**

In `understand-anything-plugin/packages/dashboard/src/App.tsx`:

Add import at top:

```typescript
import DomainGraphView from "./components/DomainGraphView";
```

Replace the graph area section (around lines 394-400) to conditionally render:

```typescript
        {/* Graph area */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          {viewMode === "domain" && domainGraph ? (
            <DomainGraphView />
          ) : (
            <GraphView />
          )}
          <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
            Press <kbd className="kbd">?</kbd> for keyboard shortcuts
          </div>
        </div>
```

- [ ] **Step 3: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/DomainGraphView.tsx \
       understand-anything-plugin/packages/dashboard/src/App.tsx
git commit -m "feat(dashboard): add DomainGraphView with domain overview and detail views"
```

---

## Task 10: Dashboard — Domain-Aware NodeInfo Sidebar

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`

- [ ] **Step 1: Add domain-aware sections to NodeInfo**

Read the existing NodeInfo.tsx first, then add domain-specific rendering. After the existing connection sections, add handling for domain/flow/step node types.

The key changes:
1. Read `viewMode` and `domainGraph` from store
2. When `viewMode === "domain"`, look up the selected node in `domainGraph` instead of `graph`
3. For `domain` nodes: show entities, business rules, cross-domain interactions, list of flows
4. For `flow` nodes: show entry point, step list in order
5. For `step` nodes: show description, file path, "View in code" link

Add a helper function above the component:

```typescript
function DomainNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const meta = (node as any).domainMeta as Record<string, unknown> | undefined;

  if (node.type === "domain") {
    const flows = graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter(Boolean);

    return (
      <div className="space-y-3">
        {meta?.entities && (meta.entities as string[]).length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Entities</h4>
            <div className="flex flex-wrap gap-1">
              {(meta.entities as string[]).map((e) => (
                <span key={e} className="text-[11px] px-2 py-0.5 rounded bg-elevated text-text-secondary">{e}</span>
              ))}
            </div>
          </div>
        )}
        {meta?.businessRules && (meta.businessRules as string[]).length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Business Rules</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {(meta.businessRules as string[]).map((r, i) => (
                <li key={i} className="flex gap-1.5"><span className="text-accent shrink-0">-</span>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {meta?.crossDomainInteractions && (meta.crossDomainInteractions as string[]).length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Cross-Domain</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {(meta.crossDomainInteractions as string[]).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {flows.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Flows</h4>
            <div className="space-y-1">
              {flows.map((f) => (
                <button
                  key={f!.id}
                  onClick={() => { navigateToDomain(node.id); selectNode(f!.id); }}
                  className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors"
                >
                  {f!.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "flow") {
    const steps = graph.edges
      .filter((e) => e.type === "flow_step" && e.source === node.id)
      .sort((a, b) => a.weight - b.weight)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter(Boolean);

    return (
      <div className="space-y-3">
        {meta?.entryPoint && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Entry Point</h4>
            <div className="text-[11px] font-mono text-accent">{meta.entryPoint as string}</div>
          </div>
        )}
        {steps.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Steps</h4>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={s!.id}>
                  <button
                    onClick={() => selectNode(s!.id)}
                    className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] transition-colors"
                  >
                    <span className="text-accent/60 mr-1.5">{i + 1}.</span>
                    <span className="text-text-secondary hover:text-accent">{s!.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "step") {
    return (
      <div className="space-y-3">
        {node.filePath && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Implementation</h4>
            <div className="text-[11px] font-mono text-text-secondary">
              {node.filePath}
              {node.lineRange && <span className="text-text-muted">:{node.lineRange[0]}-{node.lineRange[1]}</span>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
```

Then in the main NodeInfo component, add domain-aware rendering. After getting the `node` from the graph, add logic to also check `domainGraph`:

```typescript
  const viewMode = useDashboardStore((s) => s.viewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);

  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  const node = activeGraph?.nodes.find((n) => n.id === selectedNodeId);
```

And after the summary section, add:

```typescript
        {/* Domain-specific details */}
        {activeGraph && node && (node.type === "domain" || node.type === "flow" || node.type === "step") && (
          <DomainNodeDetails node={node} graph={activeGraph} />
        )}
```

- [ ] **Step 2: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx
git commit -m "feat(dashboard): add domain-aware NodeInfo sidebar for domain/flow/step nodes"
```

---

## Task 11: Dashboard — Update GraphView NODE_TYPE_TO_CATEGORY

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`

- [ ] **Step 1: Add domain types to NODE_TYPE_TO_CATEGORY**

In `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`, update `NODE_TYPE_TO_CATEGORY` (lines 53-59):

```typescript
const NODE_TYPE_TO_CATEGORY: Record<NodeType, NodeCategory> = {
  file: "code", function: "code", class: "code", module: "code", concept: "code",
  config: "config",
  document: "docs",
  service: "infra", resource: "infra", pipeline: "infra",
  table: "data", endpoint: "data", schema: "data",
  // Domain types — categorized as "code" for filtering purposes
  domain: "code", flow: "code", step: "code",
} as const;
```

- [ ] **Step 2: Verify dashboard builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx
git commit -m "feat(dashboard): add domain node types to NODE_TYPE_TO_CATEGORY mapping"
```

---

## Task 12: Create Domain Analyzer Agent

**Files:**
- Create: `understand-anything-plugin/agents/domain-analyzer.md`

- [ ] **Step 1: Create the agent definition**

```markdown
---
name: domain-analyzer
description: |
  Analyzes codebases to extract business domain knowledge — domains, business flows, and process steps. Produces a domain-graph.json that maps how business logic flows through the code.
model: opus
---

# Domain Analyzer Agent

You are a business domain analysis expert. Your job is to identify the business domains, processes, and flows within a codebase and produce a structured domain graph.

## Your Task

Analyze the provided context (either a preprocessed domain context file OR an existing knowledge graph) and produce a complete domain graph JSON.

## Three-Level Hierarchy

1. **Business Domain** — High-level business areas (e.g., "Order Management", "User Authentication", "Payment Processing")
2. **Business Flow** — Specific processes within a domain (e.g., "Create Order", "Process Refund")
3. **Business Step** — Individual actions within a flow (e.g., "Validate input", "Check inventory")

## Output Schema

Produce a JSON object with this exact structure:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<project name>",
    "languages": ["<detected languages>"],
    "frameworks": ["<detected frameworks>"],
    "description": "<project description focused on business purpose>",
    "analyzedAt": "<ISO timestamp>",
    "gitCommitHash": "<commit hash>"
  },
  "nodes": [
    {
      "id": "domain:<kebab-case-name>",
      "type": "domain",
      "name": "<Human Readable Domain Name>",
      "summary": "<2-3 sentences about what this domain handles>",
      "tags": ["<relevant-tags>"],
      "complexity": "simple|moderate|complex",
      "domainMeta": {
        "entities": ["<key domain objects>"],
        "businessRules": ["<important constraints/invariants>"],
        "crossDomainInteractions": ["<how this domain interacts with others>"]
      }
    },
    {
      "id": "flow:<kebab-case-name>",
      "type": "flow",
      "name": "<Flow Name>",
      "summary": "<what this flow accomplishes>",
      "tags": ["<relevant-tags>"],
      "complexity": "simple|moderate|complex",
      "domainMeta": {
        "entryPoint": "<trigger, e.g. POST /api/orders>",
        "entryType": "http|cli|event|cron|manual"
      }
    },
    {
      "id": "step:<flow-name>:<step-name>",
      "type": "step",
      "name": "<Step Name>",
      "summary": "<what this step does>",
      "tags": ["<relevant-tags>"],
      "complexity": "simple|moderate|complex",
      "filePath": "<relative path to implementing file>",
      "lineRange": [<start>, <end>]
    }
  ],
  "edges": [
    { "source": "domain:<name>", "target": "flow:<name>", "type": "contains_flow", "direction": "forward", "weight": 1.0 },
    { "source": "flow:<name>", "target": "step:<flow>:<step>", "type": "flow_step", "direction": "forward", "weight": 0.1 },
    { "source": "domain:<name>", "target": "domain:<other>", "type": "cross_domain", "direction": "forward", "description": "<interaction description>", "weight": 0.6 }
  ],
  "layers": [],
  "tour": []
}
```

## Rules

1. **flow_step weight encodes order**: First step = 0.1, second = 0.2, etc.
2. **Every flow must connect to a domain** via `contains_flow` edge
3. **Every step must connect to a flow** via `flow_step` edge
4. **Cross-domain edges** describe how domains interact
5. **File paths** on step nodes should be relative to project root
6. **Be specific, not generic** — use the actual business terminology from the code
7. **Don't invent flows that aren't in the code** — only document what exists

Respond ONLY with the JSON object, no additional text or markdown fences.
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/agents/domain-analyzer.md
git commit -m "feat(agents): add domain-analyzer agent for business domain extraction"
```

---

## Task 13: Create /understand-domain Skill

**Files:**
- Create: `understand-anything-plugin/skills/understand-domain/SKILL.md`

- [ ] **Step 1: Create the skill directory and SKILL.md**

```bash
mkdir -p understand-anything-plugin/skills/understand-domain
```

```markdown
---
name: understand-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /understand knowledge graph.
argument-hint: [--full]
---

# /understand-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and produces an interactive horizontal flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists (`.understand-anything/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists, performs a lightweight scan: file tree + entry point detection + sampled files
- Use `--full` flag to force a fresh scan even if a knowledge graph exists

## Instructions

### Phase 1: Detect Existing Graph

1. Check if `.understand-anything/knowledge-graph.json` exists in the current project
2. If it exists AND `--full` was NOT passed → proceed to Phase 3 (derive from graph)
3. Otherwise → proceed to Phase 2 (lightweight scan)

### Phase 2: Lightweight Scan (Path 1)

1. Run the preprocessing script bundled with this skill:
   ```
   python understand-anything-plugin/skills/understand-domain/extract-domain-context.py <project-root>
   ```
   This outputs `.understand-anything/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
2. Read the generated `domain-context.json` as context for Phase 4
3. Proceed to Phase 4

### Phase 3: Derive from Existing Graph (Path 2)

1. Read `.understand-anything/knowledge-graph.json`
2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
   - Tour steps if available
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 4

### Phase 4: Domain Analysis

1. Read the domain-analyzer agent prompt from `agents/domain-analyzer.md`
2. Dispatch a subagent with the domain-analyzer prompt + the context from Phase 2 or 3
3. The agent writes its output to `.understand-anything/intermediate/domain-analysis.json`

### Phase 5: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/flow/step types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. Save to `.understand-anything/domain-graph.json`
5. Clean up `.understand-anything/intermediate/domain-analysis.json`

### Phase 6: Launch Dashboard

1. Auto-trigger `/understand-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/SKILL.md
git commit -m "feat(skills): add /understand-domain skill for business domain knowledge extraction"
```

---

## Task 14: Dashboard — Serve domain-graph.json

**Files:**
- Modify: `understand-anything-plugin/skills/understand-dashboard/SKILL.md`

- [ ] **Step 1: Read the existing understand-dashboard skill**

Read `understand-anything-plugin/skills/understand-dashboard/SKILL.md` to understand how the dashboard server is configured, then add `domain-graph.json` to the list of served files.

The dashboard server serves files from `.understand-anything/`. The domain graph file (`domain-graph.json`) needs to be served alongside `knowledge-graph.json` and `meta.json`.

Update the skill to mention that `domain-graph.json` should also be served if it exists. The exact change depends on how the server is configured in the skill — typically it serves the entire `.understand-anything/` directory, so `domain-graph.json` should be automatically available. Verify this is the case.

- [ ] **Step 2: Commit (if changes needed)**

Only commit if the skill needed updating.

---

## Task 15: Full Build and Integration Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Build core package**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`

Expected: Build succeeds

- [ ] **Step 2: Run all core tests**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run`

Expected: All tests PASS

- [ ] **Step 3: Build dashboard**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`

Expected: Build succeeds

- [ ] **Step 4: Run linter**

Run: `cd understand-anything-plugin && pnpm lint`

Expected: No errors (warnings acceptable)

- [ ] **Step 5: Final commit (if any lint fixes needed)**

Fix any lint issues and commit.

---

## Summary of All Files

### New Files
- `understand-anything-plugin/packages/core/src/__tests__/domain-types.test.ts`
- `understand-anything-plugin/packages/core/src/__tests__/domain-persistence.test.ts`
- `understand-anything-plugin/packages/core/src/__tests__/domain-normalize.test.ts`
- `understand-anything-plugin/packages/dashboard/src/components/DomainClusterNode.tsx`
- `understand-anything-plugin/packages/dashboard/src/components/FlowNode.tsx`
- `understand-anything-plugin/packages/dashboard/src/components/StepNode.tsx`
- `understand-anything-plugin/packages/dashboard/src/components/DomainGraphView.tsx`
- `understand-anything-plugin/agents/domain-analyzer.md`
- `understand-anything-plugin/skills/understand-domain/SKILL.md`
- `understand-anything-plugin/skills/understand-domain/extract-domain-context.py`

### Modified Files
- `understand-anything-plugin/packages/core/src/types.ts` — 3 new node types, 3 new edge types, DomainMeta interface
- `understand-anything-plugin/packages/core/src/schema.ts` — Zod schemas + aliases for domain types
- `understand-anything-plugin/packages/core/src/persistence/index.ts` — saveDomainGraph/loadDomainGraph
- `understand-anything-plugin/packages/core/src/analyzer/normalize-graph.ts` — domain ID prefixes
- `understand-anything-plugin/packages/dashboard/src/store.ts` — viewMode, domainGraph, activeDomainId
- `understand-anything-plugin/packages/dashboard/src/App.tsx` — domain graph loading, view toggle, conditional rendering
- `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx` — domain-aware sidebar
- `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx` — NODE_TYPE_TO_CATEGORY update
