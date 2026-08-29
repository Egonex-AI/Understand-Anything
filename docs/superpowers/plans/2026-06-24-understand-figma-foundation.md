# /understand-figma Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/understand-figma` skill that ingests a Figma file via the REST API and produces a `kind:"design"` knowledge graph (pages, screens, components, component sets, instances, design tokens) rendered in the existing dashboard.

**Architecture:** Deterministic Figma parsing lives in a typed, tested core module (`packages/core/src/figma/`) behind a `FigmaSource` adapter seam; an LLM `design-analyzer` agent adds semantics; a merge step assembles the existing `knowledge-graph.json` shape and reuses `validateGraph`. The dashboard gains a `kind:"design"` branch and a sidebar thumbnail. Net-new code is isolated; schema, persistence, validation, layout, search, and export are reused.

**Tech Stack:** TypeScript (ESM, strict), Zod (schema), Vitest (tests), Node ≥22 `fetch` (Figma REST API), React + React Flow (dashboard), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-24-understand-figma-foundation-design.md`

---

## Scope Check

This plan covers a single sub-project (the Figma **foundation**: ingestion + structure + light design-system model). Roadmap items B (flows), C (design↔code), D (audit), E (planning-text) are explicitly out of scope and will each get their own spec → plan. This plan produces working, testable software on its own: running `/understand-figma <key>` yields a valid `kind:"design"` graph that the dashboard renders.

---

## File Structure

**Core — new module `packages/core/src/figma/` (Node-only; never exported from browser-safe subpaths):**
- `source/types.ts` — `FigmaSource` interface + raw Figma response types (`FigmaDocument`, `FigmaStyles`).
- `source/api-source.ts` — `FigmaApiSource` (reads `FIGMA_TOKEN`, calls `GET /v1/files/:key`, `/styles`, `/images`), `parseFileKey(urlOrKey)`.
- `parse/parse-document.ts` — `parseDocument(doc, fileKey)` → `{ nodes, edges }` (page/screen/component/componentSet/instance + `contains`/`instance_of`/`variant_of`).
- `parse/tokens.ts` — `extractTokens(doc, styles)` → token nodes + `uses_token` edges.
- `merge.ts` — `mergeDesignGraph(manifest, analysisBatches, project)` → full `KnowledgeGraph` (`kind:"design"`), runs `validateGraph`.
- `index.ts` — Node-only barrel re-exporting the above.
- `__tests__/parse-document.test.ts`, `__tests__/tokens.test.ts`, `__tests__/merge.test.ts`, `__tests__/api-source.test.ts`.

**Core — modify (shared schema/types):**
- `packages/core/src/types.ts` — add `"design"` to `kind`; add 6 `NodeType`s; add 3 `EdgeType`s; add `FigmaMeta` + `figmaMeta?` on `GraphNode`.
- `packages/core/src/schema.ts` — mirror the enum additions in `EdgeTypeSchema`, `GraphNodeSchema.type`, `KnowledgeGraphSchema.kind`; add `FigmaMetaSchema`; add node/edge aliases; **remove** `instance_of → exemplifies` from `EDGE_TYPE_ALIASES`.
- `packages/core/src/__tests__/schema.test.ts` — add cases for the new types + `instance_of` promotion.

**Skill + agent — new:**
- `understand-anything-plugin/skills/understand-figma/SKILL.md` — orchestration (Phases 1–4).
- `understand-anything-plugin/agents/design-analyzer.md` — LLM enrichment agent.

**Dashboard — modify:**
- `packages/dashboard/src/App.tsx` — add `kind === "design"` branch.
- `packages/dashboard/src/components/CustomNode.tsx` — type→color map for the 6 design node types.
- `packages/dashboard/src/components/NodeInfo.tsx` — thumbnail block for `figmaMeta` nodes.
- dashboard dev server — `/figma-image` endpoint (token-gated, mirrors `/file-content.json`).

Each task below is self-contained and ends in a commit.

---

### Task 1: Add design types to the shared type definitions

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`

- [ ] **Step 1: Extend `NodeType` (add 6 design types)**

In `types.ts`, replace the `NodeType` union's trailing knowledge line so it ends with the design types:

```typescript
// Node types (27 total: 5 code + 8 non-code + 3 domain + 5 knowledge + 6 design)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source"
  | "page" | "screen" | "component" | "componentSet" | "instance" | "token";
```

- [ ] **Step 2: Extend `EdgeType` (add 3 design edges)**

Append a Design category to the `EdgeType` union (after the Knowledge line):

```typescript
  // Design (3 new → 38 total)
  | "instance_of" | "variant_of" | "uses_token";
```

- [ ] **Step 3: Add the `FigmaMeta` interface**

Add near `KnowledgeMeta`/`DomainMeta`:

```typescript
// Optional Figma metadata for page/screen/component/componentSet/instance/token nodes
export interface FigmaMeta {
  fileKey?: string;
  nodeId?: string;            // Figma node id, e.g. "1:23"
  figmaType?: string;         // FRAME | COMPONENT | COMPONENT_SET | INSTANCE | TEXT ...
  thumbnailUrl?: string;      // lazily filled from GET /v1/images
  dimensions?: { width: number; height: number };
  tokenKind?: "color" | "type" | "spacing" | "effect" | "grid";
  tokenValue?: string;        // e.g. "#0A84FF", "16px"
  prototypeTargets?: string[]; // roadmap B — recorded now, edges later
  componentKey?: string;       // roadmap C — recorded now
}
```

- [ ] **Step 4: Add `figmaMeta` to `GraphNode` and `"design"` to `KnowledgeGraph.kind`**

In `GraphNode`, add alongside `domainMeta`/`knowledgeMeta`:

```typescript
  figmaMeta?: FigmaMeta;
```

In `KnowledgeGraph`, widen `kind`:

```typescript
  kind?: "codebase" | "knowledge" | "design";
```

- [ ] **Step 5: Verify the package type-checks**

Run: `pnpm --filter @understand-anything/core build`
Expected: PASS (tsc emits with no errors).

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts
git commit -m "feat(core): add design NodeType/EdgeType/FigmaMeta + design kind"
```

---

### Task 2: Extend the Zod schema (accept design types, normalize aliases, promote instance_of)

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/schema.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema";

function designGraph() {
  return {
    version: "1.0.0",
    kind: "design",
    project: { name: "F", languages: ["figma"], frameworks: [], description: "d", analyzedAt: "t", gitCommitHash: "" },
    nodes: [
      { id: "screen:1:2", type: "screen", name: "Login", summary: "s", tags: ["auth"], complexity: "simple" },
      { id: "component:3:4", type: "component", name: "Button/Primary", summary: "s", tags: ["ds"], complexity: "simple" },
      { id: "instance:5:6", type: "instance", name: "SignInBtn", summary: "s", tags: ["use"], complexity: "simple" },
      { id: "token:color:brand", type: "token", name: "color/brand", summary: "s", tags: ["token"], complexity: "simple" },
    ],
    edges: [
      { source: "instance:5:6", target: "component:3:4", type: "instance_of", direction: "forward", weight: 0.8 },
      { source: "component:3:4", target: "token:color:brand", type: "uses_token", direction: "forward", weight: 0.5 },
    ],
    layers: [],
    tour: [],
  };
}

describe("design graph schema", () => {
  it("accepts design node and edge types", () => {
    const res = validateGraph(designGraph());
    expect(res.success).toBe(true);
    expect(res.data!.nodes).toHaveLength(4);
    expect(res.data!.edges).toHaveLength(2);
  });

  it("keeps instance_of as a first-class edge (NOT rewritten to exemplifies)", () => {
    const res = validateGraph(designGraph());
    const e = res.data!.edges.find((x) => x.source === "instance:5:6");
    expect(e!.type).toBe("instance_of");
  });

  it("normalizes figma node-type aliases (frame → screen)", () => {
    const g = designGraph();
    g.nodes[0].type = "frame";
    const res = validateGraph(g);
    expect(res.data!.nodes.find((n) => n.id === "screen:1:2")!.type).toBe("screen");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- schema`
Expected: FAIL — design types are dropped (invalid-node / invalid-edge) and `frame` is unknown.

- [ ] **Step 3: Add the design node types to `GraphNodeSchema`**

In `schema.ts`, extend the `type` enum in `GraphNodeSchema`:

```typescript
  type: z.enum([
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource",
    "domain", "flow", "step",
    "article", "entity", "topic", "claim", "source",
    "page", "screen", "component", "componentSet", "instance", "token",
  ]),
```

- [ ] **Step 4: Add the design edge types to `EdgeTypeSchema`**

Append to the `EdgeTypeSchema` enum array:

```typescript
  "instance_of", "variant_of", "uses_token", // Design
```

- [ ] **Step 5: Widen `KnowledgeGraphSchema.kind` and add `FigmaMetaSchema`**

```typescript
// add near DomainMetaSchema / KnowledgeMetaSchema
const FigmaMetaSchema = z.object({
  fileKey: z.string().optional(),
  nodeId: z.string().optional(),
  figmaType: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  tokenKind: z.enum(["color", "type", "spacing", "effect", "grid"]).optional(),
  tokenValue: z.string().optional(),
  prototypeTargets: z.array(z.string()).optional(),
  componentKey: z.string().optional(),
}).passthrough();
```

Add `figmaMeta: FigmaMetaSchema.optional(),` to `GraphNodeSchema`, and widen kind:

```typescript
  kind: z.enum(["codebase", "knowledge", "design"]).optional(),
```

- [ ] **Step 6: Add aliases and remove the instance_of→exemplifies alias**

In `NODE_TYPE_ALIASES` add:

```typescript
  frame: "screen",
  artboard: "screen",
  canvas: "page",
  main_component: "component",
  component_set: "componentSet",
  variant_set: "componentSet",
  design_token: "token",
  style: "token",
```

In `EDGE_TYPE_ALIASES` add the design aliases and **delete** the existing `instance_of: "exemplifies"` line:

```typescript
  instantiates: "instance_of",
  variant: "variant_of",
  styled_by: "uses_token",
  applies_token: "uses_token",
  // NOTE: the former `instance_of: "exemplifies"` entry is removed —
  // instance_of is now a first-class design edge.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- schema`
Expected: PASS (all three new tests green; existing schema tests still green).

- [ ] **Step 8: Commit**

```bash
git add understand-anything-plugin/packages/core/src/schema.ts understand-anything-plugin/packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): validate design node/edge types, figmaMeta, promote instance_of"
```

---

### Task 3: Figma source adapter (`FigmaSource` interface + `FigmaApiSource`)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/figma/source/types.ts`
- Create: `understand-anything-plugin/packages/core/src/figma/source/api-source.ts`
- Test: `understand-anything-plugin/packages/core/src/figma/__tests__/api-source.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `figma/__tests__/api-source.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseFileKey, FigmaApiSource } from "../source/api-source";

afterEach(() => { vi.restoreAllMocks(); delete process.env.FIGMA_TOKEN; });

describe("parseFileKey", () => {
  it("extracts key from a /file/ URL", () => {
    expect(parseFileKey("https://www.figma.com/file/ABC123/My-App")).toBe("ABC123");
  });
  it("extracts key from a /design/ URL with query", () => {
    expect(parseFileKey("https://www.figma.com/design/XYZ789/App?node-id=1-2")).toBe("XYZ789");
  });
  it("accepts a bare key", () => {
    expect(parseFileKey("ABC123")).toBe("ABC123");
  });
  it("throws on unparseable input", () => {
    expect(() => parseFileKey("not a key!!")).toThrow();
  });
});

describe("FigmaApiSource", () => {
  it("throws a friendly error when FIGMA_TOKEN is missing", () => {
    delete process.env.FIGMA_TOKEN;
    expect(() => new FigmaApiSource("ABC123")).toThrow(/FIGMA_TOKEN/);
  });
  it("fetches the document and sends the token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Doc", document: { id: "0:0", type: "DOCUMENT", name: "Doc", children: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const src = new FigmaApiSource("ABC123", "tok_secret");
    const doc = await src.fetchDocument();
    expect(doc.name).toBe("Doc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/files/ABC123");
    expect((init.headers as Record<string, string>)["X-Figma-Token"]).toBe("tok_secret");
  });
  it("never leaks the token in error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" }));
    const src = new FigmaApiSource("ABC123", "tok_secret");
    await expect(src.fetchDocument()).rejects.toThrow(/403/);
    await expect(src.fetchDocument()).rejects.not.toThrow(/tok_secret/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- api-source`
Expected: FAIL — module `../source/api-source` does not exist.

- [ ] **Step 3: Create the source types**

Create `figma/source/types.ts`:

```typescript
export interface FigmaNode {
  id: string;
  name: string;
  type: string; // DOCUMENT | CANVAS | FRAME | SECTION | COMPONENT | COMPONENT_SET | INSTANCE | TEXT | ...
  children?: FigmaNode[];
  componentId?: string;        // on INSTANCE → main component node id
  absoluteBoundingBox?: { width: number; height: number } | null;
  styles?: Record<string, string>; // styleType (fill/text/effect/grid) → style key
  transitionNodeID?: string | null; // prototype target node id
}

export interface FigmaDocument {
  name: string;
  document: FigmaNode; // root (DOCUMENT) whose children are CANVAS (pages)
  components?: Record<string, { key: string; name: string; componentSetId?: string }>;
  componentSets?: Record<string, { key: string; name: string }>;
}

export interface FigmaStyles {
  meta?: { styles?: Array<{ key: string; name: string; style_type: string }> };
}

export interface FigmaSource {
  fetchDocument(): Promise<FigmaDocument>;
  fetchStyles(): Promise<FigmaStyles>;
  renderImages(nodeIds: string[]): Promise<Record<string, string>>;
}
```

- [ ] **Step 4: Implement the API source**

Create `figma/source/api-source.ts`:

```typescript
import type { FigmaSource, FigmaDocument, FigmaStyles } from "./types";

const FIGMA_API = "https://api.figma.com/v1";

export function parseFileKey(urlOrKey: string): string {
  const m = urlOrKey.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]+$/.test(urlOrKey.trim())) return urlOrKey.trim();
  throw new Error(`Could not parse a Figma file key from: ${urlOrKey}`);
}

export class FigmaApiSource implements FigmaSource {
  private readonly token: string;

  constructor(private readonly fileKey: string, token: string | undefined = process.env.FIGMA_TOKEN) {
    if (!token) {
      throw new Error(
        "FIGMA_TOKEN is not set. Create a personal access token at " +
        "https://www.figma.com/settings, then run: export FIGMA_TOKEN=<token>",
      );
    }
    this.token = token;
  }

  private async get<T>(path: string): Promise<T> {
    // Token travels only in the header — never in the URL, never logged.
    const res = await fetch(`${FIGMA_API}${path}`, { headers: { "X-Figma-Token": this.token } });
    if (!res.ok) {
      throw new Error(`Figma API ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  fetchDocument(): Promise<FigmaDocument> {
    return this.get<FigmaDocument>(`/files/${this.fileKey}`);
  }

  fetchStyles(): Promise<FigmaStyles> {
    return this.get<FigmaStyles>(`/files/${this.fileKey}/styles`);
  }

  async renderImages(nodeIds: string[]): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};
    const ids = encodeURIComponent(nodeIds.join(","));
    const data = await this.get<{ images: Record<string, string> }>(
      `/images/${this.fileKey}?ids=${ids}&format=png&scale=1`,
    );
    return data.images ?? {};
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- api-source`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/source/ understand-anything-plugin/packages/core/src/figma/__tests__/api-source.test.ts
git commit -m "feat(core): FigmaSource adapter + FigmaApiSource (token via env, no leak)"
```

---

### Task 4: Deterministic document parser (`parseDocument`)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/figma/parse/parse-document.ts`
- Test: `understand-anything-plugin/packages/core/src/figma/__tests__/parse-document.test.ts`

- [ ] **Step 1: Write the failing test**

Create `figma/__tests__/parse-document.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDocument } from "../parse/parse-document";
import type { FigmaDocument } from "../source/types";

const doc: FigmaDocument = {
  name: "MyApp",
  document: {
    id: "0:0", name: "Document", type: "DOCUMENT", children: [
      { id: "1:0", name: "Onboarding", type: "CANVAS", children: [
        { id: "1:1", name: "Login", type: "FRAME", absoluteBoundingBox: { width: 375, height: 812 }, children: [
          { id: "1:2", name: "SignInBtn", type: "INSTANCE", componentId: "2:1", children: [] },
        ] },
      ] },
      { id: "1:9", name: "Components", type: "CANVAS", children: [
        { id: "2:0", name: "Button", type: "COMPONENT_SET", children: [
          { id: "2:1", name: "Primary", type: "COMPONENT", children: [] },
          { id: "2:2", name: "Secondary", type: "COMPONENT", children: [] },
        ] },
      ] },
    ],
  },
};

describe("parseDocument", () => {
  const { nodes, edges } = parseDocument(doc, "ABC123");
  const ids = nodes.map((n) => n.id);
  const has = (s: string, t: string, ty: string) =>
    edges.some((e) => e.source === s && e.target === t && e.type === ty);

  it("creates page/screen/instance/componentSet/component nodes", () => {
    expect(ids).toEqual(expect.arrayContaining([
      "page:1:0", "screen:1:1", "instance:1:2", "page:1:9", "componentSet:2:0", "component:2:1", "component:2:2",
    ]));
  });
  it("links containment, instance_of, and variant_of", () => {
    expect(has("page:1:0", "screen:1:1", "contains")).toBe(true);
    expect(has("screen:1:1", "instance:1:2", "contains")).toBe(true);
    expect(has("instance:1:2", "component:2:1", "instance_of")).toBe(true);
    expect(has("component:2:1", "componentSet:2:0", "variant_of")).toBe(true);
    expect(has("component:2:2", "componentSet:2:0", "variant_of")).toBe(true);
  });
  it("captures screen dimensions and fileKey in figmaMeta", () => {
    const screen = nodes.find((n) => n.id === "screen:1:1")!;
    expect(screen.figmaMeta?.dimensions?.width).toBe(375);
    expect(screen.figmaMeta?.fileKey).toBe("ABC123");
  });
  it("emits validateGraph-ready nodes (summary/tags/complexity present)", () => {
    expect(nodes.every((n) => n.summary && n.tags.length > 0 && n.complexity)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- parse-document`
Expected: FAIL — module `../parse/parse-document` does not exist.

- [ ] **Step 3: Implement the parser**

Create `figma/parse/parse-document.ts`:

```typescript
import type { GraphNode, GraphEdge } from "../../types";
import type { FigmaDocument, FigmaNode } from "../source/types";

function mkNode(
  type: GraphNode["type"],
  figmaId: string,
  name: string,
  figmaMeta: GraphNode["figmaMeta"],
): GraphNode {
  return {
    id: `${type}:${figmaId}`,
    type,
    name,
    summary: name, // placeholder; design-analyzer enriches in Phase 2
    tags: [type],
    complexity: "simple",
    figmaMeta,
  };
}

export function parseDocument(doc: FigmaDocument, fileKey: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const add = (n: GraphNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  const link = (source: string, target: string, type: GraphEdge["type"], weight: number) =>
    edges.push({ source, target, type, direction: "forward", weight });

  // Deep-read a screen subtree to find instances (shallow node set, but deep read).
  function collectInstances(n: FigmaNode, screenId: string) {
    for (const child of n.children ?? []) {
      if (child.type === "INSTANCE") {
        const inst = mkNode("instance", child.id, child.name, {
          fileKey, nodeId: child.id, figmaType: "INSTANCE",
          componentKey: child.componentId,
          prototypeTargets: child.transitionNodeID ? [child.transitionNodeID] : undefined,
        });
        add(inst);
        link(screenId, inst.id, "contains", 1.0);
        if (child.componentId) link(inst.id, `component:${child.componentId}`, "instance_of", 0.8);
      }
      if (child.children) collectInstances(child, screenId);
    }
  }

  function handlePageChild(child: FigmaNode, pageId: string) {
    switch (child.type) {
      case "FRAME": {
        const screen = mkNode("screen", child.id, child.name, {
          fileKey, nodeId: child.id, figmaType: "FRAME",
          dimensions: child.absoluteBoundingBox
            ? { width: child.absoluteBoundingBox.width, height: child.absoluteBoundingBox.height }
            : undefined,
        });
        add(screen);
        link(pageId, screen.id, "contains", 1.0);
        collectInstances(child, screen.id);
        break;
      }
      case "COMPONENT": {
        const comp = mkNode("component", child.id, child.name, { fileKey, nodeId: child.id, figmaType: "COMPONENT" });
        add(comp);
        link(pageId, comp.id, "contains", 1.0);
        break;
      }
      case "COMPONENT_SET": {
        const set = mkNode("componentSet", child.id, child.name, { fileKey, nodeId: child.id, figmaType: "COMPONENT_SET" });
        add(set);
        link(pageId, set.id, "contains", 1.0);
        for (const variant of child.children ?? []) {
          if (variant.type === "COMPONENT") {
            const comp = mkNode("component", variant.id, variant.name, { fileKey, nodeId: variant.id, figmaType: "COMPONENT" });
            add(comp);
            link(comp.id, set.id, "variant_of", 0.9);
          }
        }
        break;
      }
      case "SECTION": {
        for (const sub of child.children ?? []) handlePageChild(sub, pageId); // flatten sections in v1
        break;
      }
      default:
        break; // other top-level types are ignored in v1
    }
  }

  for (const canvas of doc.document.children ?? []) {
    if (canvas.type !== "CANVAS") continue;
    const page = mkNode("page", canvas.id, canvas.name, { fileKey, nodeId: canvas.id, figmaType: "CANVAS" });
    add(page);
    for (const child of canvas.children ?? []) handlePageChild(child, page.id);
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- parse-document`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/parse/parse-document.ts understand-anything-plugin/packages/core/src/figma/__tests__/parse-document.test.ts
git commit -m "feat(core): deterministic Figma document parser (pages/screens/components/instances)"
```

---

### Task 5: Token extraction (`extractTokens`)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/figma/parse/tokens.ts`
- Test: `understand-anything-plugin/packages/core/src/figma/__tests__/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `figma/__tests__/tokens.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractTokens } from "../parse/tokens";
import type { FigmaDocument, FigmaStyles } from "../source/types";
import type { GraphNode } from "../../types";

const doc: FigmaDocument = {
  name: "MyApp",
  document: {
    id: "0:0", name: "Document", type: "DOCUMENT", children: [
      { id: "1:9", name: "Components", type: "CANVAS", children: [
        { id: "2:1", name: "Primary", type: "COMPONENT", styles: { fill: "S_KEY" }, children: [] },
      ] },
    ],
  },
};
const styles: FigmaStyles = { meta: { styles: [{ key: "S_KEY", name: "color/brand-500", style_type: "FILL" }] } };
const structural: GraphNode[] = [
  { id: "component:2:1", type: "component", name: "Primary", summary: "Primary", tags: ["component"], complexity: "simple", figmaMeta: { fileKey: "ABC", nodeId: "2:1" } },
];

describe("extractTokens", () => {
  const { nodes, edges } = extractTokens(doc, styles, structural, "ABC");
  it("creates a token node per published style with tokenKind", () => {
    const token = nodes.find((n) => n.type === "token");
    expect(token).toBeTruthy();
    expect(token!.figmaMeta?.tokenKind).toBe("color");
    expect(token!.name).toBe("color/brand-500");
  });
  it("links consumers to tokens via uses_token", () => {
    const token = nodes.find((n) => n.type === "token")!;
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "component:2:1", target: token.id, type: "uses_token" }),
    ]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- tokens`
Expected: FAIL — module `../parse/tokens` does not exist.

- [ ] **Step 3: Implement token extraction**

Create `figma/parse/tokens.ts`:

```typescript
import type { GraphNode, GraphEdge, FigmaMeta } from "../../types";
import type { FigmaDocument, FigmaNode, FigmaStyles } from "../source/types";

const STYLE_KIND: Record<string, NonNullable<FigmaMeta["tokenKind"]>> = {
  FILL: "color", TEXT: "type", EFFECT: "effect", GRID: "grid",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function extractTokens(
  doc: FigmaDocument,
  styles: FigmaStyles,
  structuralNodes: GraphNode[],
  fileKey: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const tokenByStyleKey = new Map<string, string>();

  // Only published styles/variables become token nodes (bounded set).
  for (const s of styles.meta?.styles ?? []) {
    const kind = STYLE_KIND[s.style_type] ?? "color";
    const id = `token:${kind}:${slug(s.name)}`;
    if (!tokenByStyleKey.has(s.key)) tokenByStyleKey.set(s.key, id);
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id, type: "token", name: s.name, summary: s.name,
        tags: ["token", kind], complexity: "simple",
        figmaMeta: { fileKey, tokenKind: kind },
      });
    }
  }

  const graphIdByFigmaId = new Map<string, string>();
  for (const n of structuralNodes) {
    if (n.figmaMeta?.nodeId) graphIdByFigmaId.set(n.figmaMeta.nodeId, n.id);
  }

  const usesSeen = new Set<string>();
  function walk(n: FigmaNode) {
    const consumerId = graphIdByFigmaId.get(n.id);
    if (consumerId && n.styles) {
      for (const styleKey of Object.values(n.styles)) {
        const tokenId = tokenByStyleKey.get(styleKey);
        if (tokenId) {
          const dedupe = `${consumerId}|${tokenId}`;
          if (!usesSeen.has(dedupe)) {
            usesSeen.add(dedupe);
            edges.push({ source: consumerId, target: tokenId, type: "uses_token", direction: "forward", weight: 0.5 });
          }
        }
      }
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(doc.document);

  return { nodes, edges };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- tokens`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/parse/tokens.ts understand-anything-plugin/packages/core/src/figma/__tests__/tokens.test.ts
git commit -m "feat(core): extract design tokens from published styles + uses_token edges"
```

---

### Task 6: Merge manifest + analysis into a `kind:"design"` graph (`mergeDesignGraph`)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/figma/merge.ts`
- Test: `understand-anything-plugin/packages/core/src/figma/__tests__/merge.test.ts`

> **Note:** the existing `validateGraph` re-assembles its return object and **does not copy `kind`** through. `mergeDesignGraph` therefore re-attaches `kind:"design"` to the validated result. (A future cleanup could make `validateGraph` preserve `kind`; out of scope here.)

- [ ] **Step 1: Write the failing test**

Create `figma/__tests__/merge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeDesignGraph } from "../merge";
import type { GraphNode, GraphEdge, ProjectMeta } from "../../types";

const project: ProjectMeta = { name: "MyApp", languages: ["figma"], frameworks: [], description: "d", analyzedAt: "t", gitCommitHash: "" };
const manifest = {
  nodes: [
    { id: "page:1:0", type: "page", name: "Onboarding", summary: "Onboarding", tags: ["page"], complexity: "simple" },
    { id: "screen:1:1", type: "screen", name: "Login", summary: "Login", tags: ["screen"], complexity: "simple" },
    { id: "component:2:1", type: "component", name: "Primary", summary: "Primary", tags: ["component"], complexity: "simple" },
    { id: "token:color:brand", type: "token", name: "brand", summary: "brand", tags: ["token"], complexity: "simple" },
  ] as GraphNode[],
  edges: [
    { source: "page:1:0", target: "screen:1:1", type: "contains", direction: "forward", weight: 1 },
    { source: "component:2:1", target: "token:color:brand", type: "uses_token", direction: "forward", weight: 0.5 },
  ] as GraphEdge[],
};

describe("mergeDesignGraph", () => {
  it("produces a valid kind:design graph", () => {
    const res = mergeDesignGraph(manifest, [], project);
    expect(res.success).toBe(true);
    expect(res.data!.kind).toBe("design");
  });
  it("groups screens under their page layer and DS nodes under Design System", () => {
    const { data } = mergeDesignGraph(manifest, [], project);
    const ds = data!.layers.find((l) => l.id === "layer:design-system")!;
    expect(ds.nodeIds).toEqual(expect.arrayContaining(["component:2:1", "token:color:brand"]));
    const page = data!.layers.find((l) => l.name === "Onboarding")!;
    expect(page.nodeIds).toEqual(expect.arrayContaining(["page:1:0", "screen:1:1"]));
  });
  it("applies design-analyzer enrichment by id", () => {
    const { data } = mergeDesignGraph(manifest, [{ nodes: [{ id: "screen:1:1", summary: "The sign-in screen", tags: ["auth", "entry"] }] }], project);
    const screen = data!.nodes.find((n) => n.id === "screen:1:1")!;
    expect(screen.summary).toBe("The sign-in screen");
    expect(screen.tags).toEqual(["auth", "entry"]);
  });
  it("builds a tour that starts with the Design System", () => {
    const { data } = mergeDesignGraph(manifest, [], project);
    expect(data!.tour[0].title).toBe("Design System");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- merge`
Expected: FAIL — module `../merge` does not exist.

- [ ] **Step 3: Implement the merge**

Create `figma/merge.ts`:

```typescript
import type { KnowledgeGraph, GraphNode, GraphEdge, Layer, TourStep, ProjectMeta } from "../types";
import { validateGraph, type ValidationResult } from "../schema";

export interface DesignAnalysis {
  nodes?: Array<Pick<GraphNode, "id"> & Partial<Pick<GraphNode, "summary" | "tags">>>;
  edges?: GraphEdge[];
}

const DS_TYPES = new Set<GraphNode["type"]>(["component", "componentSet", "token"]);

export function mergeDesignGraph(
  manifest: { nodes: GraphNode[]; edges: GraphEdge[] },
  analyses: DesignAnalysis[],
  project: ProjectMeta,
): ValidationResult {
  // 1. index manifest nodes (clone so we can enrich)
  const byId = new Map<string, GraphNode>();
  for (const n of manifest.nodes) byId.set(n.id, { ...n });
  const edges: GraphEdge[] = [...manifest.edges];

  // 2. apply LLM enrichment; design-analyzer must not invent structural nodes
  for (const a of analyses) {
    for (const patch of a.nodes ?? []) {
      const base = byId.get(patch.id);
      if (!base) continue;
      if (patch.summary) base.summary = patch.summary;
      if (patch.tags && patch.tags.length) base.tags = patch.tags;
    }
    for (const e of a.edges ?? []) edges.push(e);
  }
  const nodes = [...byId.values()];

  // 3. layers: one per page (+ descendants), plus a Design System layer
  const parent = new Map<string, string>();
  for (const e of manifest.edges) if (e.type === "contains") parent.set(e.target, e.source);
  const pageOf = (id: string): string | undefined => {
    let cur: string | undefined = id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      if (byId.get(cur)?.type === "page") return cur;
      cur = parent.get(cur);
    }
    return undefined;
  };
  const layerMap = new Map<string, string[]>();
  const ds: string[] = [];
  for (const n of nodes) {
    if (DS_TYPES.has(n.type)) { ds.push(n.id); continue; }
    const key = n.type === "page" ? n.id : (pageOf(n.id) ?? "layer:unscoped");
    if (!layerMap.has(key)) layerMap.set(key, []);
    layerMap.get(key)!.push(n.id);
  }
  const layers: Layer[] = [];
  for (const [pageId, ids] of layerMap) {
    const pageNode = byId.get(pageId);
    layers.push({
      id: `layer:${pageId}`,
      name: pageNode?.name ?? "Unscoped",
      description: pageNode ? `Figma page: ${pageNode.name}` : "Nodes not under a page",
      nodeIds: ids,
    });
  }
  if (ds.length) {
    layers.push({ id: "layer:design-system", name: "Design System", description: "Components, variants, and design tokens", nodeIds: ds });
  }

  // 4. tour: Design System first, then each page
  const tour: TourStep[] = [];
  let order = 1;
  if (ds.length) tour.push({ order: order++, title: "Design System", description: "Shared components, variants, and tokens the screens are built from.", nodeIds: ds.slice(0, 8) });
  for (const l of layers) {
    if (l.id === "layer:design-system") continue;
    tour.push({ order: order++, title: l.name, description: `Screens on the "${l.name}" page.`, nodeIds: l.nodeIds.slice(0, 8) });
  }

  // 5. assemble + validate, then re-attach kind (validateGraph drops it)
  const graph: KnowledgeGraph = { version: "1.0.0", kind: "design", project, nodes, edges, layers, tour };
  const result = validateGraph(graph);
  if (result.success && result.data) {
    (result.data as KnowledgeGraph).kind = "design";
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- merge`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/merge.ts understand-anything-plugin/packages/core/src/figma/__tests__/merge.test.ts
git commit -m "feat(core): merge Figma manifest + analysis into kind:design graph with layers/tour"
```

---

### Task 7: Core barrel export for the Figma module

**Files:**
- Create: `understand-anything-plugin/packages/core/src/figma/index.ts`

- [ ] **Step 1: Create the Node-only barrel**

Create `figma/index.ts` (NOT referenced by the dashboard's browser-safe subpaths):

```typescript
export { parseFileKey, FigmaApiSource } from "./source/api-source";
export type { FigmaSource, FigmaDocument, FigmaStyles, FigmaNode } from "./source/types";
export { parseDocument } from "./parse/parse-document";
export { extractTokens } from "./parse/tokens";
export { mergeDesignGraph, type DesignAnalysis } from "./merge";
```

- [ ] **Step 2: Verify the package builds and all figma tests pass**

Run: `pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/core test -- figma`
Expected: PASS (build clean; api-source, parse-document, tokens, merge suites green).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/index.ts
git commit -m "feat(core): barrel export for the figma module"
```

---

### Task 8: `design-analyzer` agent definition

**Files:**
- Create: `understand-anything-plugin/agents/design-analyzer.md`

- [ ] **Step 1: Create the agent file**

Create `agents/design-analyzer.md`:

```markdown
---
name: design-analyzer
description: |
  Analyzes Figma structural nodes (pages, screens, components, instances, tokens) from a deterministic manifest and adds semantic enrichment — concise summaries, tags, and a screen's purpose — plus conservative `related` edges. Does NOT invent structural nodes or edges.
---

# Design Analyzer Agent

You enrich a Figma design graph. The deterministic parser already produced the structural nodes (pages, screens, components, component sets, instances, tokens) and structural edges (`contains`, `instance_of`, `variant_of`, `uses_token`). Your job is the semantic layer only.

## Input

A JSON batch of manifest nodes. Each has:
- `id`, `type` (page | screen | component | componentSet | instance | token), `name`
- `figmaMeta` (dimensions, tokenKind, componentKey, etc.)
- `childSummary`: names of notable children (for screens/components)
- `tokenUsage`: token names this node uses (if any)

You also receive the full list of existing node IDs so you can reference them.

## Task

For each node, produce an enrichment object:
- `summary`: one or two sentences — what the screen/component is FOR (purpose), not a description of pixels. For tokens, state the role (e.g., "Primary brand color used on CTAs").
- `tags`: 2–5 lowercase tags (feature area, role, state). Examples: `auth`, `entry`, `cta`, `list`, `empty-state`, `primary`.

Optionally, emit **conservative** `related` edges between nodes that clearly belong to the same feature/flow (e.g., two screens of the same onboarding flow). Only when names/structure make it obvious.

## Rules

1. **Do NOT** emit `page`/`screen`/`component`/`componentSet`/`instance`/`token` nodes — they already exist. Only enrichment + optional `related` edges.
2. **Do NOT** re-emit structural edges (`contains`, `instance_of`, `variant_of`, `uses_token`).
3. Use exact existing `id`s when emitting `related` edges.
4. Be concise. For a batch of ~15 nodes, expect ~15 enrichments and 0–8 `related` edges.

## Output Format

Write a JSON file to `$INTERMEDIATE_DIR/analysis-batch-$BATCH_NUM.json`:

```json
{
  "nodes": [
    { "id": "screen:1:1", "summary": "The sign-in screen where returning users authenticate.", "tags": ["auth", "entry"] }
  ],
  "edges": [
    { "source": "screen:1:1", "target": "screen:1:5", "type": "related", "direction": "forward", "weight": 0.5, "description": "Both part of the sign-in flow" }
  ]
}
```

Output ONLY enrichment objects (`id` + `summary`/`tags`) and optional `related` edges. Nothing else.
```

- [ ] **Step 2: Verify the file is valid markdown with frontmatter**

Run: `head -5 understand-anything-plugin/agents/design-analyzer.md`
Expected: shows the `---` frontmatter block with `name: design-analyzer`.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/agents/design-analyzer.md
git commit -m "feat(agents): add design-analyzer (semantic enrichment for Figma graphs)"
```

---

### Task 9: Skill wrapper scripts + core `./figma` subpath export

**Files:**
- Modify: `understand-anything-plugin/packages/core/package.json`
- Create: `understand-anything-plugin/skills/understand-figma/figma-scan.mjs`
- Create: `understand-anything-plugin/skills/understand-figma/figma-merge.mjs`

- [ ] **Step 1: Add the `./figma` subpath export to core**

In `packages/core/package.json`, add to the `exports` map (after `"./languages"`):

```json
    "./figma": {
      "types": "./dist/figma/index.d.ts",
      "default": "./dist/figma/index.js"
    }
```

- [ ] **Step 2: Create the Phase-1 scan script**

Create `skills/understand-figma/figma-scan.mjs`:

```javascript
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseFileKey, FigmaApiSource, parseDocument, extractTokens } from "@understand-anything/core/figma";

const [, , projectRoot, urlOrKey] = process.argv;
if (!projectRoot || !urlOrKey) {
  console.error("usage: figma-scan.mjs <projectRoot> <figmaUrlOrKey>");
  process.exit(1);
}

const fileKey = parseFileKey(urlOrKey);
const source = new FigmaApiSource(fileKey); // reads FIGMA_TOKEN from env; throws a friendly error if missing
const doc = await source.fetchDocument();
const styles = await source.fetchStyles().catch(() => ({ meta: { styles: [] } }));

const structural = parseDocument(doc, fileKey);
const tokens = extractTokens(doc, styles, structural.nodes, fileKey);
const nodes = [...structural.nodes, ...tokens.nodes];
const edges = [...structural.edges, ...tokens.edges];

const manifest = {
  project: {
    name: doc.name,
    languages: ["figma"],
    frameworks: [],
    description: `Figma design file: ${doc.name}`,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "",
  },
  fileKey,
  nodes,
  edges,
};

const interDir = join(projectRoot, ".understand-anything", "intermediate");
mkdirSync(interDir, { recursive: true });
writeFileSync(join(interDir, "scan-manifest.json"), JSON.stringify(manifest, null, 2));

const count = (t) => nodes.filter((n) => n.type === t).length;
console.error(
  `Figma scan: ${count("page")} pages, ${count("screen")} screens, ` +
  `${count("component")} components, ${count("componentSet")} sets, ` +
  `${count("instance")} instances, ${count("token")} tokens`,
);
```

- [ ] **Step 3: Create the Phase-3 merge script**

Create `skills/understand-figma/figma-merge.mjs`:

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mergeDesignGraph } from "@understand-anything/core/figma";

const [, , projectRoot] = process.argv;
const interDir = join(projectRoot, ".understand-anything", "intermediate");
const manifest = JSON.parse(readFileSync(join(interDir, "scan-manifest.json"), "utf8"));
const analyses = readdirSync(interDir)
  .filter((f) => /^analysis-batch-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(interDir, f), "utf8")));

const result = mergeDesignGraph(
  { nodes: manifest.nodes, edges: manifest.edges },
  analyses,
  manifest.project,
);
if (!result.success || !result.data) {
  console.error("Merge failed:", result.fatal ?? "unknown error");
  process.exit(1);
}

const outDir = join(projectRoot, ".understand-anything");
writeFileSync(join(outDir, "knowledge-graph.json"), JSON.stringify(result.data, null, 2));
writeFileSync(join(outDir, "meta.json"), JSON.stringify({
  lastAnalyzedAt: new Date().toISOString(),
  gitCommitHash: "",
  version: "1.0.0",
  analyzedFiles: result.data.nodes.length,
}, null, 2));

console.error(
  `Design graph: ${result.data.nodes.length} nodes, ${result.data.edges.length} edges, ` +
  `${result.data.layers.length} layers, ${result.data.tour.length} tour steps`,
);
for (const issue of result.issues) {
  if (issue.level !== "auto-corrected") console.error(`[${issue.level}] ${issue.message}`);
}
```

- [ ] **Step 4: Rebuild core and smoke-test the scan script offline**

Run: `pnpm --filter @understand-anything/core build`
Expected: PASS — `dist/figma/index.js` exists, so `@understand-anything/core/figma` resolves.

Run: `node understand-anything-plugin/skills/understand-figma/figma-scan.mjs /tmp/nope ABC123`
Expected: if `FIGMA_TOKEN` is unset, it exits with the friendly "FIGMA_TOKEN is not set…" error (this confirms wiring without making a real API call).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/package.json understand-anything-plugin/skills/understand-figma/figma-scan.mjs understand-anything-plugin/skills/understand-figma/figma-merge.mjs
git commit -m "feat(figma): core ./figma export + scan/merge wrapper scripts"
```

---

### Task 10: `/understand-figma` skill orchestration (`SKILL.md`)

**Files:**
- Create: `understand-anything-plugin/skills/understand-figma/SKILL.md`

- [ ] **Step 1: Create the skill file**

Create `skills/understand-figma/SKILL.md`:

````markdown
---
name: understand-figma
description: Analyze a Figma file via the Figma REST API and generate an interactive design knowledge graph (pages, screens, components, component sets, instances, design tokens) with a kind:"design" dashboard.
argument-hint: "<figma-file-url-or-key> [--language <lang>]"
---

# /understand-figma

Analyzes a Figma file and produces an interactive design knowledge graph in the existing dashboard.

## Prerequisites

- **`FIGMA_TOKEN`** environment variable — a Figma personal access token (create one at https://www.figma.com/settings). If it is missing, STOP and tell the user:
  > Set a Figma token first: create one at figma.com/settings, then `export FIGMA_TOKEN=<token>`.
- Node ≥ 22, pnpm ≥ 10.

> **Security:** the token is read only from the environment and travels only in the `X-Figma-Token` request header. Never write it to the graph, `meta.json`, logs, or intermediate files. This skill makes outbound calls to `api.figma.com` — unlike `/understand`, it is not fully offline. Tell the user this once.

## Phase 0 — Pre-flight

1. Parse `$ARGUMENTS` for a Figma URL or bare file key (the non-flag token) and an optional `--language <lang>`.
2. Resolve `PROJECT_ROOT` to the current working directory.
3. Resolve `PLUGIN_ROOT` and ensure core is built (same logic as `/understand` Phase 0.1.5). If `packages/core/dist/figma/index.js` is missing, run:
   ```bash
   cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
   ```
4. `mkdir -p $PROJECT_ROOT/.understand-anything/intermediate`.

## Phase 1 — FETCH & PARSE (deterministic)

Run the bundled scan script (`<SKILL_DIR>` is this skill's directory):

```bash
FIGMA_TOKEN="$FIGMA_TOKEN" node <SKILL_DIR>/figma-scan.mjs "$PROJECT_ROOT" "<url-or-key>"
```

It writes `.understand-anything/intermediate/scan-manifest.json` and prints the node counts. Relay the counts to the user. If it exits non-zero, relay stderr and STOP.

## Phase 2 — ANALYZE (LLM enrichment)

1. Read `scan-manifest.json`. Group nodes into batches of ~15, grouped by page when possible.
2. For each batch, dispatch a subagent using the `design-analyzer` agent definition (`agents/design-analyzer.md`). Pass:
   - the batch of nodes (`id`, `type`, `name`, `figmaMeta`, child names, token usage),
   - the full list of existing node IDs,
   - `$INTERMEDIATE_DIR = $PROJECT_ROOT/.understand-anything/intermediate`,
   - the batch number for output naming.
   The agent writes `analysis-batch-<N>.json`.
   Append `$LANGUAGE_DIRECTIVE` if `--language` was provided (reuse `/understand`'s directive text).
3. Run up to **5 batches concurrently**. If a batch fails, log a warning and continue — the manifest is a solid base.

## Phase 3 — MERGE

```bash
node <SKILL_DIR>/figma-merge.mjs "$PROJECT_ROOT"
```

It combines `scan-manifest.json` + `analysis-batch-*.json`, runs `mergeDesignGraph` (validates, re-attaches `kind:"design"`), and writes `knowledge-graph.json` + `meta.json`. Relay the printed stats and any non-`auto-corrected` issues.

## Phase 4 — SAVE & LAUNCH

1. Clean up intermediate files **except** `scan-manifest.json`:
   ```bash
   INTER="$PROJECT_ROOT/.understand-anything/intermediate"
   find "$INTER" -mindepth 1 -maxdepth 1 -not -name 'scan-manifest.json' -exec rm -rf {} +
   ```
2. Report a summary: project name, counts by node type, edges by type, layers, tour steps, and the path `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.
3. Auto-launch the dashboard by invoking the `/understand-dashboard` skill.
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -5 understand-anything-plugin/skills/understand-figma/SKILL.md`
Expected: shows the `---` frontmatter with `name: understand-figma`.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-figma/SKILL.md
git commit -m "feat(skill): /understand-figma orchestration (fetch/parse, analyze, merge, launch)"
```

---

### Task 11: Pre-fetch screen thumbnails into `figmaMeta.thumbnailUrl`

Figma's `/v1/images` returns pre-signed image URLs (no auth needed to load them in a browser), so v1 stores a screen's thumbnail URL on its node and the dashboard renders a plain `<img>`. (A dev-server proxy endpoint is a robust follow-up — see Open Questions.)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-figma/figma-scan.mjs`

- [ ] **Step 1: Add thumbnail pre-fetch after parsing**

In `figma-scan.mjs`, after the `extractTokens(...)` line and before building `manifest`, insert:

```javascript
// Pre-fetch thumbnails for screens only (bounded). URLs are pre-signed and
// may expire after a few hours — fine for view-after-generate; re-run to refresh.
const screens = structural.nodes.filter((n) => n.type === "screen");
try {
  const images = await source.renderImages(screens.map((n) => n.figmaMeta.nodeId));
  for (const s of screens) {
    const url = images[s.figmaMeta.nodeId];
    if (url) s.figmaMeta.thumbnailUrl = url;
  }
} catch {
  // thumbnails are optional — never fail the scan on image render
}
```

- [ ] **Step 2: Smoke-test (offline) still fails only on the token**

Run: `node understand-anything-plugin/skills/understand-figma/figma-scan.mjs /tmp/nope ABC123`
Expected: still exits with the friendly `FIGMA_TOKEN is not set…` error (no syntax errors introduced).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-figma/figma-scan.mjs
git commit -m "feat(figma): pre-fetch screen thumbnails into figmaMeta.thumbnailUrl"
```

---

### Task 12: Dashboard node colors for design node types

`typeColors` and `typeTextColors` in `CustomNode.tsx` are `Record<NodeType, ...>`; after Task 1 widened `NodeType`, the dashboard build FAILS until all 6 design keys are added. Reuse existing theme vars/classes (no new theme tokens in v1).

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx`

- [ ] **Step 1: Add the 6 design keys to `typeColors`**

In the `typeColors` object, after the `source:` line, add:

```typescript
  page: "var(--color-node-concept)",
  screen: "var(--color-node-service)",
  component: "var(--color-node-class)",
  componentSet: "var(--color-node-module)",
  instance: "var(--color-node-function)",
  token: "var(--color-node-config)",
```

- [ ] **Step 2: Add the 6 design keys to `typeTextColors`**

In the `typeTextColors` object, after the `source:` line, add:

```typescript
  page: "text-node-concept",
  screen: "text-node-service",
  component: "text-node-class",
  componentSet: "text-node-module",
  instance: "text-node-function",
  token: "text-node-config",
```

- [ ] **Step 3: Verify the dashboard type-checks**

Run: `pnpm --filter @understand-anything/dashboard build`
Expected: PASS — no "Property 'page' is missing in type Record<NodeType,...>" errors.

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx
git commit -m "feat(dashboard): node colors for design node types"
```

---

### Task 13: Sidebar thumbnail + design badges (`NodeInfo.tsx`)

`typeBadgeColors` is also `Record<NodeType, ...>`, so it needs the 6 keys. Then add a small thumbnail block shown whenever the selected node has `figmaMeta.thumbnailUrl`.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`

- [ ] **Step 1: Add the 6 design keys to `typeBadgeColors`**

After the `source:` entry in `typeBadgeColors`, add:

```typescript
  page: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  screen: "text-node-service border border-node-service/30 bg-node-service/10",
  component: "text-node-class border border-node-class/30 bg-node-class/10",
  componentSet: "text-node-module border border-node-module/30 bg-node-module/10",
  instance: "text-node-function border border-node-function/30 bg-node-function/10",
  token: "text-node-config border border-node-config/30 bg-node-config/10",
```

- [ ] **Step 2: Add the `FigmaThumbnail` component**

Near the top of the file (e.g., just before `function KnowledgeNodeDetails(`), add:

```typescript
function FigmaThumbnail({ node }: { node: GraphNode }) {
  const url = node.figmaMeta?.thumbnailUrl;
  if (!url) return null;
  return (
    <div className="mb-3 rounded-lg overflow-hidden border border-border-subtle bg-elevated">
      <img src={url} alt={node.name} className="w-full h-auto block" loading="lazy" />
    </div>
  );
}
```

- [ ] **Step 3: Render the thumbnail in the selected-node panel**

In the main `NodeInfo` component's selected-node render, immediately **below** the node title/type-badge header and **above** the summary paragraph, insert:

```tsx
<FigmaThumbnail node={node} />
```

(`node` is the currently selected `GraphNode` already in scope in that render. The block self-hides when there is no `figmaMeta.thumbnailUrl`, so it is inert for codebase/knowledge graphs.)

- [ ] **Step 4: Verify the dashboard type-checks**

Run: `pnpm --filter @understand-anything/dashboard build`
Expected: PASS (all `Record<NodeType>` maps complete; `FigmaThumbnail` compiles).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx
git commit -m "feat(dashboard): design badges + sidebar Figma thumbnail"
```

---

### Task 14: Full integration verification

No `App.tsx`/store change is required for v1: a `kind:"design"` graph loads through the existing `validateGraph` + structural (hierarchical) view, now that the schema accepts design types and the node/badge maps are complete. (A dedicated "Design" view mode and legend entries are optional polish — see Open Questions.)

**Files:** none (verification only).

- [ ] **Step 1: Build everything**

Run: `pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/dashboard build`
Expected: PASS (both packages compile).

- [ ] **Step 2: Run the full core test suite**

Run: `pnpm --filter @understand-anything/core test`
Expected: PASS — including the new `schema`, `api-source`, `parse-document`, `tokens`, and `merge` suites, with no regressions in existing suites.

- [ ] **Step 3: End-to-end smoke (requires a real token + small test file)**

Run:
```bash
export FIGMA_TOKEN=<your token>
node understand-anything-plugin/skills/understand-figma/figma-scan.mjs "$(pwd)" "<your-figma-file-url>"
node understand-anything-plugin/skills/understand-figma/figma-merge.mjs "$(pwd)"
```
Expected: `.understand-anything/knowledge-graph.json` is written with `"kind": "design"` and non-empty `nodes`/`layers`/`tour`. Open `/understand-dashboard` and confirm screens/components/tokens render and selecting a screen shows its thumbnail.

- [ ] **Step 4: Confirm no token leakage**

Run: `grep -ri "$FIGMA_TOKEN" .understand-anything/ || echo "clean"`
Expected: `clean` (the token never appears in the graph, meta, or any intermediate file).

- [ ] **Step 5: Commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test(figma): full build + suite green for design foundation"
```

---

### Task 15: Incremental skip via Figma file `version`

The Figma file response includes a `version` string. v1 incremental = if the stored version matches the current one, skip re-analysis (full re-analyze otherwise). This is the Figma analog of `/understand`'s commit-hash check.

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/figma/source/types.ts`
- Modify: `understand-anything-plugin/skills/understand-figma/figma-scan.mjs`
- Modify: `understand-anything-plugin/skills/understand-figma/figma-merge.mjs`
- Modify: `understand-anything-plugin/skills/understand-figma/SKILL.md`

- [ ] **Step 1: Add `version` to the `FigmaDocument` type**

In `figma/source/types.ts`, add to `FigmaDocument`:

```typescript
  version?: string;       // Figma file version (changes on every edit)
  lastModified?: string;  // ISO timestamp
```

- [ ] **Step 2: Scan compares version and can short-circuit**

In `figma-scan.mjs`, replace the manifest write block so it records the version and skips when unchanged. After `const doc = await source.fetchDocument();` add:

```javascript
import { readFileSync, existsSync } from "node:fs"; // (merge with existing node:fs import)

const metaPath = join(projectRoot, ".understand-anything", "meta.json");
const prevVersion = existsSync(metaPath)
  ? (JSON.parse(readFileSync(metaPath, "utf8")).figmaVersion ?? null)
  : null;
if (doc.version && prevVersion === doc.version && process.env.UNDERSTAND_FIGMA_FORCE !== "1") {
  console.error("UP_TO_DATE");
  process.exit(0);
}
```

And add `figmaVersion: doc.version ?? "",` to the `manifest` object.

- [ ] **Step 3: Merge persists the version into meta.json**

In `figma-merge.mjs`, change the `meta.json` write to include the version from the manifest:

```javascript
writeFileSync(join(outDir, "meta.json"), JSON.stringify({
  lastAnalyzedAt: new Date().toISOString(),
  gitCommitHash: "",
  figmaVersion: manifest.figmaVersion ?? "",
  version: "1.0.0",
  analyzedFiles: result.data.nodes.length,
}, null, 2));
```

- [ ] **Step 4: Skill honors the short-circuit**

In `SKILL.md` Phase 1, add after running `figma-scan.mjs`:

> If the scan prints `UP_TO_DATE` (and `--full` was not passed), report "Design graph is already up to date for this Figma file version" and STOP. Pass `--full` by setting `UNDERSTAND_FIGMA_FORCE=1` to force a rebuild.

- [ ] **Step 5: Verify build + offline smoke**

Run: `pnpm --filter @understand-anything/core build && node understand-anything-plugin/skills/understand-figma/figma-scan.mjs /tmp/nope ABC123`
Expected: build PASS; scan still exits on the `FIGMA_TOKEN` error (token check precedes the version check).

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/figma/source/types.ts understand-anything-plugin/skills/understand-figma/figma-scan.mjs understand-anything-plugin/skills/understand-figma/figma-merge.mjs understand-anything-plugin/skills/understand-figma/SKILL.md
git commit -m "feat(figma): incremental skip when file version is unchanged"
```

---

## Self-Review (performed)

- **Spec coverage:** ingestion/adapter (T3), token-no-leak (T3, T14·4), shallow node set (T4–5), `instance_of` promotion + aliases (T1–2), `figmaMeta` (T1–2), `kind:"design"` (T1–2, T6), design-analyzer (T8), pipeline/phases (T10), merge + page/DS layers + DS-first tour (T6), hybrid dashboard (T12–13), incremental (T15), backward-compat/coexistence/security (T2, T3, T14). No uncovered requirement remains.
- **Placeholders:** none — every code step contains complete code; `// ...` only marks elisions of pre-existing surrounding code.
- **Type consistency:** `parseDocument`/`extractTokens`/`mergeDesignGraph` signatures match their callers in `figma-scan.mjs`/`figma-merge.mjs`; `DesignAnalysis` matches `design-analyzer` output; the 6 new `NodeType`s appear consistently in `types.ts`, `schema.ts`, `CustomNode.tsx`, and `NodeInfo.tsx`.

## Open Questions / Future (not in this plan)

- Dedicated "Design" view mode + legend entries (v1 reuses the structural hierarchical view).
- Dev-server `/figma-image` proxy endpoint (robust thumbnails that never expire), replacing stored URLs.
- In-node thumbnails; deep-expand a screen; local-JSON `FigmaSource`; node-level incremental.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-understand-figma-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks (REQUIRED SUB-SKILL: subagent-driven-development).
2. **Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: executing-plans).

Which approach?
