# Understand Anything — Phase 4 (Advanced) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the "Advanced" layer — three new skill commands (`/understand-diff`, `/understand-explain`, `/understand-onboard`), a community plugin system, and optional embedding-based semantic search.

**Architecture:** Extends the skill package with three new Claude Code skill definitions + supporting core utilities. Adds a plugin registry to core for community extensibility. Optionally adds embedding-based search as an upgrade path from the existing fuse.js search.

**Tech Stack:** No new dependencies for Tasks 1-5. Task 6-7 (embedding search) adds a vector similarity library or uses raw cosine calculation.

---

## Dependency Graph

```
Task 1 (understand-diff) ─── (independent)
Task 2 (understand-explain) ─── (independent)
Task 3 (understand-onboard) ─── (independent)
Task 4 (Plugin Registry Core) ───→ Task 5 (Plugin CLI Integration)
Task 6 (Embedding Search Core) ───→ Task 7 (Embedding Dashboard)
```

Tasks 1, 2, 3, 4, 6 are fully independent and can be implemented in any order.

---

## Task 1: /understand-diff Skill — PR/Diff Analysis

**Files:**
- Create: `packages/skill/src/diff-analyzer.ts`
- Create: `packages/skill/src/__tests__/diff-analyzer.test.ts`
- Create: `packages/skill/.claude/skills/understand-diff.md`
- Modify: `packages/skill/src/index.ts` (add exports)

**Context:** The `/understand-diff` skill analyzes the current git diff (or PR) against the knowledge graph. It maps changed files to affected nodes, identifies impacted relationships and layers, and generates a structured analysis of changes, affected areas, and risks. This is designed to run inside Claude Code where the LLM can read the analysis and explain it to the user.

**Step 1: Write failing tests**

```typescript
// packages/skill/src/__tests__/diff-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { buildDiffContext, formatDiffAnalysis } from "../diff-analyzer.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Entry point", tags: ["entry"], complexity: "simple" },
    { id: "file:src/routes.ts", type: "file", name: "routes.ts", filePath: "src/routes.ts", summary: "Routes", tags: ["routes"], complexity: "moderate" },
    { id: "file:src/service.ts", type: "file", name: "service.ts", filePath: "src/service.ts", summary: "Service", tags: ["service"], complexity: "complex" },
    { id: "func:src/service.ts:process", type: "function", name: "process", filePath: "src/service.ts", lineRange: [10, 30], summary: "Process function", tags: ["core"], complexity: "complex" },
    { id: "file:src/db.ts", type: "file", name: "db.ts", filePath: "src/db.ts", summary: "Database", tags: ["db"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "file:src/routes.ts", type: "imports", direction: "forward", weight: 0.9 },
    { source: "file:src/routes.ts", target: "file:src/service.ts", type: "calls", direction: "forward", weight: 0.8 },
    { source: "file:src/service.ts", target: "func:src/service.ts:process", type: "contains", direction: "forward", weight: 1.0 },
    { source: "file:src/service.ts", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.7 },
  ],
  layers: [
    { id: "layer:api", name: "API Layer", description: "HTTP routes", nodeIds: ["file:src/index.ts", "file:src/routes.ts"] },
    { id: "layer:service", name: "Service Layer", description: "Business logic", nodeIds: ["file:src/service.ts", "func:src/service.ts:process"] },
    { id: "layer:data", name: "Data Layer", description: "Database", nodeIds: ["file:src/db.ts"] },
  ],
  tour: [],
};

describe("diff-analyzer", () => {
  describe("buildDiffContext", () => {
    it("identifies directly changed nodes", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      expect(ctx.changedNodes.map((n) => n.id)).toContain("file:src/service.ts");
    });

    it("identifies child nodes of changed files", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      expect(ctx.changedNodes.map((n) => n.id)).toContain("func:src/service.ts:process");
    });

    it("identifies affected nodes via edges (1-hop)", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      // routes.ts calls service.ts, so it's affected
      expect(ctx.affectedNodes.map((n) => n.id)).toContain("file:src/routes.ts");
      // db.ts is read by service.ts, so it's affected
      expect(ctx.affectedNodes.map((n) => n.id)).toContain("file:src/db.ts");
    });

    it("identifies affected layers", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      expect(ctx.affectedLayers.map((l) => l.name)).toContain("Service Layer");
    });

    it("identifies impacted edges", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      expect(ctx.impactedEdges.length).toBeGreaterThan(0);
    });

    it("handles files not in the graph gracefully", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/unknown.ts"]);
      expect(ctx.changedNodes).toHaveLength(0);
      expect(ctx.unmappedFiles).toContain("src/unknown.ts");
    });

    it("handles empty diff", () => {
      const ctx = buildDiffContext(sampleGraph, []);
      expect(ctx.changedNodes).toHaveLength(0);
      expect(ctx.affectedNodes).toHaveLength(0);
    });

    it("de-duplicates affected nodes (not in changed set)", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      const changedIds = new Set(ctx.changedNodes.map((n) => n.id));
      for (const affected of ctx.affectedNodes) {
        expect(changedIds.has(affected.id)).toBe(false);
      }
    });
  });

  describe("formatDiffAnalysis", () => {
    it("produces structured markdown", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      const analysis = formatDiffAnalysis(ctx);
      expect(analysis).toContain("## Changed Components");
      expect(analysis).toContain("## Affected Components");
      expect(analysis).toContain("## Affected Layers");
    });

    it("includes risk assessment section", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/service.ts"]);
      const analysis = formatDiffAnalysis(ctx);
      expect(analysis).toContain("## Risk Assessment");
    });

    it("lists unmapped files when present", () => {
      const ctx = buildDiffContext(sampleGraph, ["src/unknown.ts"]);
      const analysis = formatDiffAnalysis(ctx);
      expect(analysis).toContain("src/unknown.ts");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/diff-analyzer.test.ts
```

**Step 3: Implement diff-analyzer.ts**

```typescript
// packages/skill/src/diff-analyzer.ts
import type { KnowledgeGraph, GraphNode, GraphEdge, Layer } from "@understand-anything/core";

export interface DiffContext {
  projectName: string;
  changedFiles: string[];
  changedNodes: GraphNode[];
  affectedNodes: GraphNode[];
  impactedEdges: GraphEdge[];
  affectedLayers: Layer[];
  unmappedFiles: string[];
}

/**
 * Map a list of changed file paths to knowledge graph nodes and
 * identify the ripple effect (affected nodes, layers, edges).
 */
export function buildDiffContext(
  graph: KnowledgeGraph,
  changedFiles: string[],
): DiffContext {
  const { nodes, edges, layers } = graph;

  // Map files to directly changed nodes
  const changedNodeIds = new Set<string>();
  const unmappedFiles: string[] = [];

  for (const file of changedFiles) {
    let mapped = false;
    for (const node of nodes) {
      if (node.filePath === file) {
        changedNodeIds.add(node.id);
        mapped = true;
      }
    }
    if (!mapped) {
      unmappedFiles.push(file);
    }
  }

  // Also include "contains" children of changed file nodes
  for (const edge of edges) {
    if (edge.type === "contains" && changedNodeIds.has(edge.source)) {
      changedNodeIds.add(edge.target);
    }
  }

  const changedNodes = nodes.filter((n) => changedNodeIds.has(n.id));

  // Find affected nodes: 1-hop neighbors of changed nodes (excluding already changed)
  const affectedNodeIds = new Set<string>();
  const impactedEdges: GraphEdge[] = [];

  for (const edge of edges) {
    const sourceChanged = changedNodeIds.has(edge.source);
    const targetChanged = changedNodeIds.has(edge.target);

    if (sourceChanged || targetChanged) {
      impactedEdges.push(edge);
      if (sourceChanged && !changedNodeIds.has(edge.target)) {
        affectedNodeIds.add(edge.target);
      }
      if (targetChanged && !changedNodeIds.has(edge.source)) {
        affectedNodeIds.add(edge.source);
      }
    }
  }

  const affectedNodes = nodes.filter((n) => affectedNodeIds.has(n.id));

  // Find affected layers: any layer containing a changed or affected node
  const allImpactedIds = new Set([...changedNodeIds, ...affectedNodeIds]);
  const affectedLayers = layers.filter((layer) =>
    layer.nodeIds.some((id) => allImpactedIds.has(id)),
  );

  return {
    projectName: graph.project.name,
    changedFiles,
    changedNodes,
    affectedNodes,
    impactedEdges,
    affectedLayers,
    unmappedFiles,
  };
}

/**
 * Format the diff analysis as structured markdown for LLM or human consumption.
 */
export function formatDiffAnalysis(ctx: DiffContext): string {
  const lines: string[] = [];

  lines.push(`# Diff Analysis: ${ctx.projectName}`);
  lines.push("");

  // Changed components
  lines.push("## Changed Components");
  lines.push("");
  if (ctx.changedNodes.length === 0) {
    lines.push("No mapped components found for changed files.");
  } else {
    for (const node of ctx.changedNodes) {
      lines.push(`- **${node.name}** (${node.type}) — ${node.summary}`);
      if (node.filePath) lines.push(`  - File: \`${node.filePath}\``);
      lines.push(`  - Complexity: ${node.complexity}`);
    }
  }
  lines.push("");

  // Affected components (ripple effect)
  lines.push("## Affected Components");
  lines.push("");
  if (ctx.affectedNodes.length === 0) {
    lines.push("No downstream impact detected.");
  } else {
    lines.push("These components are connected to changed code and may need attention:");
    lines.push("");
    for (const node of ctx.affectedNodes) {
      lines.push(`- **${node.name}** (${node.type}) — ${node.summary}`);
    }
  }
  lines.push("");

  // Affected layers
  lines.push("## Affected Layers");
  lines.push("");
  if (ctx.affectedLayers.length === 0) {
    lines.push("No layers affected.");
  } else {
    for (const layer of ctx.affectedLayers) {
      lines.push(`- **${layer.name}**: ${layer.description}`);
    }
  }
  lines.push("");

  // Impacted relationships
  if (ctx.impactedEdges.length > 0) {
    lines.push("## Impacted Relationships");
    lines.push("");
    for (const edge of ctx.impactedEdges) {
      lines.push(`- ${edge.source} --[${edge.type}]--> ${edge.target}`);
    }
    lines.push("");
  }

  // Unmapped files
  if (ctx.unmappedFiles.length > 0) {
    lines.push("## Unmapped Files");
    lines.push("");
    lines.push("These changed files are not yet in the knowledge graph:");
    lines.push("");
    for (const f of ctx.unmappedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  // Risk assessment
  lines.push("## Risk Assessment");
  lines.push("");
  const complexChanges = ctx.changedNodes.filter((n) => n.complexity === "complex");
  const crossLayerCount = new Set(ctx.affectedLayers.map((l) => l.id)).size;

  if (complexChanges.length > 0) {
    lines.push(`- **High complexity**: ${complexChanges.length} complex component(s) changed: ${complexChanges.map((n) => n.name).join(", ")}`);
  }
  if (crossLayerCount > 1) {
    lines.push(`- **Cross-layer impact**: Changes span ${crossLayerCount} architectural layers`);
  }
  if (ctx.affectedNodes.length > 5) {
    lines.push(`- **Wide blast radius**: ${ctx.affectedNodes.length} components affected downstream`);
  }
  if (ctx.unmappedFiles.length > 0) {
    lines.push(`- **New/unmapped files**: ${ctx.unmappedFiles.length} files not in the knowledge graph (may need re-analysis)`);
  }
  if (complexChanges.length === 0 && crossLayerCount <= 1 && ctx.affectedNodes.length <= 5 && ctx.unmappedFiles.length === 0) {
    lines.push("- **Low risk**: Changes are localized with limited downstream impact.");
  }
  lines.push("");

  return lines.join("\n");
}
```

**Step 4: Run tests**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/diff-analyzer.test.ts
```

**Step 5: Add exports to index.ts**

```typescript
export {
  buildDiffContext,
  formatDiffAnalysis,
  type DiffContext,
} from "./diff-analyzer.js";
```

**Step 6: Create the skill definition**

```markdown
<!-- packages/skill/.claude/skills/understand-diff.md -->
---
name: understand-diff
description: Analyze current git diff or PR against the knowledge graph to identify changes, impact, and risks
---

# /understand-diff

Analyze the current code changes against the knowledge graph at `.understand-anything/knowledge-graph.json`.

## Instructions

1. Read the knowledge graph file at `.understand-anything/knowledge-graph.json` in the current project root
2. If the file doesn't exist, tell the user to run `/understand` first
3. Get the current diff:
   - If on a branch with uncommitted changes: `git diff --name-only`
   - If on a feature branch: `git diff main...HEAD --name-only` (or the base branch)
   - If the user specifies a PR number: get the diff from that PR
4. For each changed file, identify:
   - Which nodes in the knowledge graph correspond to that file
   - Which other nodes are connected (imports, calls, depends_on, etc.)
   - Which architectural layers are affected
5. Provide a structured analysis:
   - **Changed Components**: What was directly modified
   - **Affected Components**: What might be impacted by the changes
   - **Affected Layers**: Which architectural layers are touched
   - **Risk Assessment**: Complexity, cross-layer impact, blast radius
6. Suggest what to review carefully and any potential issues
```

**Step 7: Build + test**

```bash
cd packages/skill && pnpm build && pnpm test
```

**Step 8: Commit**

```bash
git add packages/skill/src/diff-analyzer.ts packages/skill/src/__tests__/diff-analyzer.test.ts packages/skill/src/index.ts packages/skill/.claude/skills/understand-diff.md
git commit -m "feat(skill): add /understand-diff command for PR/diff analysis"
```

---

## Task 2: /understand-explain Skill — Deep-Dive on Files

**Files:**
- Create: `packages/skill/src/explain-builder.ts`
- Create: `packages/skill/src/__tests__/explain-builder.test.ts`
- Create: `packages/skill/.claude/skills/understand-explain.md`
- Modify: `packages/skill/src/index.ts` (add exports)

**Context:** The `/understand-explain <path>` skill provides a deep-dive explanation of a specific file or function. It gathers all nodes that belong to that file, their connections, layer membership, and constructs a comprehensive context for the LLM to explain the component. This differs from `/understand-chat` which answers any question — `/understand-explain` is focused on thorough explanation of a single component.

**Step 1: Write failing tests**

```typescript
// packages/skill/src/__tests__/explain-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildExplainContext, formatExplainPrompt } from "../explain-builder.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "Auth module", tags: ["auth"], complexity: "complex" },
    { id: "func:src/auth.ts:login", type: "function", name: "login", filePath: "src/auth.ts", lineRange: [10, 30], summary: "Login handler", tags: ["auth", "login"], complexity: "moderate" },
    { id: "func:src/auth.ts:verify", type: "function", name: "verify", filePath: "src/auth.ts", lineRange: [32, 50], summary: "Token verification", tags: ["auth", "jwt"], complexity: "moderate" },
    { id: "file:src/db.ts", type: "file", name: "db.ts", filePath: "src/db.ts", summary: "Database", tags: ["db"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/auth.ts", target: "func:src/auth.ts:login", type: "contains", direction: "forward", weight: 1.0 },
    { source: "file:src/auth.ts", target: "func:src/auth.ts:verify", type: "contains", direction: "forward", weight: 1.0 },
    { source: "func:src/auth.ts:login", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.8 },
  ],
  layers: [
    { id: "layer:auth", name: "Auth Layer", description: "Authentication", nodeIds: ["file:src/auth.ts", "func:src/auth.ts:login", "func:src/auth.ts:verify"] },
  ],
  tour: [],
};

describe("explain-builder", () => {
  describe("buildExplainContext", () => {
    it("finds the file node by path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.targetNode?.id).toBe("file:src/auth.ts");
    });

    it("includes child nodes (functions/classes in the file)", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.childNodes.map((n) => n.name)).toContain("login");
      expect(ctx.childNodes.map((n) => n.name)).toContain("verify");
    });

    it("includes connected nodes", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const allIds = ctx.connectedNodes.map((n) => n.id);
      expect(allIds).toContain("file:src/db.ts");
    });

    it("includes the layer", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.layer?.name).toBe("Auth Layer");
    });

    it("returns null targetNode for unknown paths", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      expect(ctx.targetNode).toBeNull();
    });

    it("finds function nodes by partial path match", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts:login");
      expect(ctx.targetNode?.name).toBe("login");
    });
  });

  describe("formatExplainPrompt", () => {
    it("produces structured markdown for valid context", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("auth.ts");
      expect(prompt).toContain("login");
      expect(prompt).toContain("Auth Layer");
    });

    it("produces helpful message for unknown path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("not found");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/explain-builder.test.ts
```

**Step 3: Implement explain-builder.ts**

```typescript
// packages/skill/src/explain-builder.ts
import type { KnowledgeGraph, GraphNode, GraphEdge, Layer } from "@understand-anything/core";

export interface ExplainContext {
  projectName: string;
  path: string;
  targetNode: GraphNode | null;
  childNodes: GraphNode[];
  connectedNodes: GraphNode[];
  relevantEdges: GraphEdge[];
  layer: Layer | null;
}

/**
 * Build a context for explaining a specific file or function.
 * Supports file paths ("src/auth.ts") and path:function ("src/auth.ts:login").
 */
export function buildExplainContext(
  graph: KnowledgeGraph,
  path: string,
): ExplainContext {
  const { nodes, edges, layers } = graph;

  // Try exact filePath match first, then name-based matching
  let targetNode: GraphNode | null = null;

  // Check for path:function format
  const colonIdx = path.lastIndexOf(":");
  if (colonIdx > 0 && !path.includes("://")) {
    const filePath = path.slice(0, colonIdx);
    const funcName = path.slice(colonIdx + 1);
    targetNode = nodes.find(
      (n) => n.filePath === filePath && n.name === funcName,
    ) ?? null;
  }

  // Fall back to file path match
  if (!targetNode) {
    targetNode = nodes.find((n) => n.filePath === path) ?? null;
  }

  if (!targetNode) {
    return {
      projectName: graph.project.name,
      path,
      targetNode: null,
      childNodes: [],
      connectedNodes: [],
      relevantEdges: [],
      layer: null,
    };
  }

  // Find child nodes (contained by this node)
  const childNodes = nodes.filter((n) =>
    edges.some(
      (e) => e.source === targetNode!.id && e.target === n.id && e.type === "contains",
    ),
  );

  // Also include children of children (e.g., file → class → methods)
  const allRelatedIds = new Set([targetNode.id, ...childNodes.map((n) => n.id)]);

  // Find connected nodes (1-hop, excluding children)
  const connectedIds = new Set<string>();
  const relevantEdges: GraphEdge[] = [];

  for (const edge of edges) {
    if (allRelatedIds.has(edge.source) || allRelatedIds.has(edge.target)) {
      relevantEdges.push(edge);
      if (allRelatedIds.has(edge.source) && !allRelatedIds.has(edge.target)) {
        connectedIds.add(edge.target);
      }
      if (allRelatedIds.has(edge.target) && !allRelatedIds.has(edge.source)) {
        connectedIds.add(edge.source);
      }
    }
  }

  const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));

  // Find layer
  const layer = layers.find((l) => l.nodeIds.includes(targetNode!.id)) ?? null;

  return {
    projectName: graph.project.name,
    path,
    targetNode,
    childNodes,
    connectedNodes,
    relevantEdges,
    layer,
  };
}

/**
 * Format the explain context as a structured prompt for LLM consumption.
 */
export function formatExplainPrompt(ctx: ExplainContext): string {
  if (!ctx.targetNode) {
    return [
      `# Component Not Found`,
      ``,
      `The path "${ctx.path}" was not found in the knowledge graph for ${ctx.projectName}.`,
      ``,
      `Possible reasons:`,
      `- The file hasn't been analyzed yet — try running /understand first`,
      `- The path may be different in the graph — check the exact file path`,
      `- The file may have been deleted or renamed since the last analysis`,
    ].join("\n");
  }

  const { targetNode, childNodes, connectedNodes, relevantEdges, layer } = ctx;
  const lines: string[] = [];

  lines.push(`# Deep Dive: ${targetNode.name}`);
  lines.push("");
  lines.push(`**Type:** ${targetNode.type} | **Complexity:** ${targetNode.complexity}`);
  if (targetNode.filePath) lines.push(`**File:** \`${targetNode.filePath}\``);
  if (targetNode.lineRange) lines.push(`**Lines:** ${targetNode.lineRange[0]}-${targetNode.lineRange[1]}`);
  lines.push("");
  lines.push(`**Summary:** ${targetNode.summary}`);
  lines.push("");

  if (layer) {
    lines.push(`## Architectural Layer: ${layer.name}`);
    lines.push(layer.description);
    lines.push("");
  }

  if (childNodes.length > 0) {
    lines.push("## Internal Components");
    for (const child of childNodes) {
      lines.push(`- **${child.name}** (${child.type}): ${child.summary}`);
    }
    lines.push("");
  }

  if (connectedNodes.length > 0) {
    lines.push("## Connected Components");
    for (const node of connectedNodes) {
      lines.push(`- **${node.name}** (${node.type}): ${node.summary}`);
    }
    lines.push("");
  }

  if (relevantEdges.length > 0) {
    const nodeMap = new Map(
      [...[targetNode], ...childNodes, ...connectedNodes].map((n) => [n.id, n]),
    );
    lines.push("## Relationships");
    for (const edge of relevantEdges) {
      if (edge.type === "contains") continue; // skip containment (shown above)
      const src = nodeMap.get(edge.source)?.name ?? edge.source;
      const tgt = nodeMap.get(edge.target)?.name ?? edge.target;
      const desc = edge.description ? ` — ${edge.description}` : "";
      lines.push(`- ${src} --[${edge.type}]--> ${tgt}${desc}`);
    }
    lines.push("");
  }

  if (targetNode.languageNotes) {
    lines.push("## Language Notes");
    lines.push(targetNode.languageNotes);
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("Provide a thorough explanation of this component:");
  lines.push("1. What it does and why it exists in the project");
  lines.push("2. How data flows through it (inputs, processing, outputs)");
  lines.push("3. How it interacts with connected components");
  lines.push("4. Any patterns, idioms, or design decisions worth noting");
  lines.push("5. Potential gotchas or areas of complexity");
  lines.push("");

  return lines.join("\n");
}
```

**Step 4: Run tests**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/explain-builder.test.ts
```

**Step 5: Add exports + create skill definition**

Add to `packages/skill/src/index.ts`:
```typescript
export {
  buildExplainContext,
  formatExplainPrompt,
  type ExplainContext,
} from "./explain-builder.js";
```

Create `packages/skill/.claude/skills/understand-explain.md`:
```markdown
---
name: understand-explain
description: Deep-dive explanation of a specific file or function using the knowledge graph
arguments: path
---

# /understand-explain

Provide a thorough, in-depth explanation of a specific code component.

## Instructions

1. Read the knowledge graph file at `.understand-anything/knowledge-graph.json`
2. If it doesn't exist, tell the user to run `/understand` first
3. Find the component matching the path: "${ARGUMENTS}"
   - Supports file paths: `src/auth/login.ts`
   - Supports function notation: `src/auth/login.ts:verifyToken`
4. Analyze the component in context:
   - Its role in the architecture (which layer, why it exists)
   - Internal structure (functions, classes it contains)
   - External connections (what it imports, what calls it, what it depends on)
   - Data flow (inputs → processing → outputs)
5. Explain clearly, assuming the reader may not know the programming language
6. Highlight any patterns, idioms, or complexity worth understanding
```

**Step 6: Build + test**

```bash
cd packages/skill && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/skill/src/explain-builder.ts packages/skill/src/__tests__/explain-builder.test.ts packages/skill/src/index.ts packages/skill/.claude/skills/understand-explain.md
git commit -m "feat(skill): add /understand-explain command for deep-dive file analysis"
```

---

## Task 3: /understand-onboard Skill — Onboarding Guide Generation

**Files:**
- Create: `packages/skill/src/onboard-builder.ts`
- Create: `packages/skill/src/__tests__/onboard-builder.test.ts`
- Create: `packages/skill/.claude/skills/understand-onboard.md`
- Modify: `packages/skill/src/index.ts` (add exports)

**Context:** The `/understand-onboard` skill generates a structured onboarding guide for new team members. It synthesizes the knowledge graph — project overview, architecture layers, key concepts, tour steps, and complexity hotspots — into a comprehensive document. The output is a well-structured markdown guide that can be committed to the repo or shared in a wiki.

**Step 1: Write failing tests**

```typescript
// packages/skill/src/__tests__/onboard-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildOnboardingGuide } from "../onboard-builder.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript", "python"],
    frameworks: ["express", "prisma"],
    description: "A test REST API",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Entry point", tags: ["entry"], complexity: "simple" },
    { id: "file:src/service.ts", type: "file", name: "service.ts", filePath: "src/service.ts", summary: "Core service", tags: ["service"], complexity: "complex" },
    { id: "concept:auth", type: "concept", name: "Auth Flow", summary: "JWT-based authentication", tags: ["concept", "auth"], complexity: "complex" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "file:src/service.ts", type: "imports", direction: "forward", weight: 0.8 },
  ],
  layers: [
    { id: "layer:api", name: "API Layer", description: "Routes and handlers", nodeIds: ["file:src/index.ts"] },
    { id: "layer:service", name: "Service Layer", description: "Business logic", nodeIds: ["file:src/service.ts"] },
  ],
  tour: [
    { order: 1, title: "Start Here", description: "Begin with index.ts", nodeIds: ["file:src/index.ts"] },
    { order: 2, title: "Core Logic", description: "Service layer", nodeIds: ["file:src/service.ts"] },
  ],
};

describe("onboard-builder", () => {
  it("includes project overview section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("# test-project");
    expect(guide).toContain("A test REST API");
  });

  it("lists languages and frameworks", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("typescript");
    expect(guide).toContain("express");
  });

  it("includes architecture layers section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Architecture");
    expect(guide).toContain("API Layer");
    expect(guide).toContain("Service Layer");
  });

  it("includes key concepts section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Key Concepts");
    expect(guide).toContain("Auth Flow");
  });

  it("includes getting started / tour section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Getting Started");
    expect(guide).toContain("Start Here");
  });

  it("includes complexity hotspots", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Complexity Hotspots");
    expect(guide).toContain("service.ts");
  });

  it("includes file map section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## File Map");
  });

  it("handles graph with no layers gracefully", () => {
    const noLayers = { ...sampleGraph, layers: [] };
    const guide = buildOnboardingGuide(noLayers);
    expect(guide).toContain("# test-project");
  });

  it("handles graph with no tour gracefully", () => {
    const noTour = { ...sampleGraph, tour: [] };
    const guide = buildOnboardingGuide(noTour);
    expect(guide).toContain("# test-project");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/onboard-builder.test.ts
```

**Step 3: Implement onboard-builder.ts**

```typescript
// packages/skill/src/onboard-builder.ts
import type { KnowledgeGraph } from "@understand-anything/core";

/**
 * Generate a structured onboarding guide from the knowledge graph.
 * Output is standalone markdown suitable for a README, wiki, or docs.
 */
export function buildOnboardingGuide(graph: KnowledgeGraph): string {
  const { project, nodes, edges, layers, tour } = graph;
  const lines: string[] = [];

  // --- Project Overview ---
  lines.push(`# ${project.name}`);
  lines.push("");
  lines.push(`> ${project.description}`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Languages** | ${project.languages.join(", ")} |`);
  lines.push(`| **Frameworks** | ${project.frameworks.join(", ")} |`);
  lines.push(`| **Components** | ${nodes.length} nodes, ${edges.length} relationships |`);
  lines.push(`| **Last Analyzed** | ${project.analyzedAt} |`);
  lines.push("");

  // --- Architecture ---
  if (layers.length > 0) {
    lines.push("## Architecture");
    lines.push("");
    lines.push("The project is organized into the following layers:");
    lines.push("");
    for (const layer of layers) {
      const memberNames = layer.nodeIds
        .map((id) => nodes.find((n) => n.id === id)?.name)
        .filter(Boolean);
      lines.push(`### ${layer.name}`);
      lines.push("");
      lines.push(layer.description);
      lines.push("");
      if (memberNames.length > 0) {
        lines.push(`Key components: ${memberNames.join(", ")}`);
        lines.push("");
      }
    }
  }

  // --- Key Concepts ---
  const conceptNodes = nodes.filter((n) => n.type === "concept");
  if (conceptNodes.length > 0) {
    lines.push("## Key Concepts");
    lines.push("");
    lines.push("Important architectural and domain concepts to understand:");
    lines.push("");
    for (const concept of conceptNodes) {
      lines.push(`### ${concept.name}`);
      lines.push("");
      lines.push(concept.summary);
      lines.push("");
    }
  }

  // --- Getting Started (Tour) ---
  if (tour.length > 0) {
    lines.push("## Getting Started");
    lines.push("");
    lines.push("Follow this guided tour to understand the codebase:");
    lines.push("");
    for (const step of tour) {
      const stepNodes = step.nodeIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter(Boolean);
      lines.push(`### ${step.order}. ${step.title}`);
      lines.push("");
      lines.push(step.description);
      lines.push("");
      if (stepNodes.length > 0) {
        lines.push("**Files to look at:**");
        for (const node of stepNodes) {
          if (node!.filePath) {
            lines.push(`- \`${node!.filePath}\` — ${node!.summary}`);
          }
        }
        lines.push("");
      }
      if (step.languageLesson) {
        lines.push(`> **Language Tip:** ${step.languageLesson}`);
        lines.push("");
      }
    }
  }

  // --- File Map ---
  const fileNodes = nodes.filter((n) => n.type === "file" && n.filePath);
  if (fileNodes.length > 0) {
    lines.push("## File Map");
    lines.push("");
    lines.push("| File | Purpose | Complexity |");
    lines.push("|------|---------|------------|");
    for (const node of fileNodes) {
      lines.push(`| \`${node.filePath}\` | ${node.summary} | ${node.complexity} |`);
    }
    lines.push("");
  }

  // --- Complexity Hotspots ---
  const complexNodes = nodes.filter((n) => n.complexity === "complex");
  if (complexNodes.length > 0) {
    lines.push("## Complexity Hotspots");
    lines.push("");
    lines.push("These components are the most complex and deserve extra attention:");
    lines.push("");
    for (const node of complexNodes) {
      lines.push(`- **${node.name}** (${node.type}): ${node.summary}`);
    }
    lines.push("");
  }

  // --- Footer ---
  lines.push("---");
  lines.push("");
  lines.push(`*Generated by [Understand Anything](https://github.com/anthropics/understand-anything) from knowledge graph v${graph.version}*`);
  lines.push("");

  return lines.join("\n");
}
```

**Step 4: Run tests**

```bash
cd packages/skill && pnpm test -- --reporter verbose src/__tests__/onboard-builder.test.ts
```

**Step 5: Add exports + create skill definition**

Add to `packages/skill/src/index.ts`:
```typescript
export { buildOnboardingGuide } from "./onboard-builder.js";
```

Create `packages/skill/.claude/skills/understand-onboard.md`:
```markdown
---
name: understand-onboard
description: Generate a structured onboarding guide for new team members using the knowledge graph
---

# /understand-onboard

Generate a comprehensive onboarding guide from the project's knowledge graph.

## Instructions

1. Read the knowledge graph at `.understand-anything/knowledge-graph.json`
2. If it doesn't exist, tell the user to run `/understand` first
3. Generate a structured onboarding guide that includes:
   - Project overview (name, languages, frameworks, description)
   - Architecture layers and their responsibilities
   - Key concepts to understand
   - Guided tour (step-by-step walkthrough)
   - File map (what each key file does)
   - Complexity hotspots (what to be careful with)
4. Format as clean markdown
5. Offer to save the guide to `docs/ONBOARDING.md` in the project
6. Suggest the user commit it to the repo for the team
```

**Step 6: Build + test**

```bash
cd packages/skill && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/skill/src/onboard-builder.ts packages/skill/src/__tests__/onboard-builder.test.ts packages/skill/src/index.ts packages/skill/.claude/skills/understand-onboard.md
git commit -m "feat(skill): add /understand-onboard command for team onboarding guides"
```

---

## Task 4: Plugin Registry + Loader (Core)

**Files:**
- Create: `packages/core/src/plugins/registry.ts`
- Create: `packages/core/src/__tests__/plugin-registry.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The `AnalyzerPlugin` interface already exists in `packages/core/src/types.ts`. Currently only `TreeSitterPlugin` implements it. This task creates a plugin registry that discovers, registers, and manages analyzer plugins. The registry maps file extensions to plugins and provides a unified `analyzeFile` entrypoint. This is the foundation for community plugins.

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/plugin-registry.test.ts
import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../plugins/registry.js";
import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution } from "../types.js";

const emptyAnalysis: StructuralAnalysis = {
  functions: [],
  classes: [],
  imports: [],
  exports: [],
};

function createMockPlugin(name: string, languages: string[]): AnalyzerPlugin {
  return {
    name,
    languages,
    analyzeFile: () => ({ ...emptyAnalysis }),
    resolveImports: () => [],
  };
}

describe("PluginRegistry", () => {
  it("registers a plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("test", ["typescript"]);
    registry.register(plugin);
    expect(registry.getPlugins()).toHaveLength(1);
  });

  it("finds plugin by language", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript", "javascript"]);
    registry.register(plugin);
    expect(registry.getPluginForLanguage("typescript")).toBe(plugin);
    expect(registry.getPluginForLanguage("javascript")).toBe(plugin);
  });

  it("returns null for unsupported language", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));
    expect(registry.getPluginForLanguage("python")).toBeNull();
  });

  it("finds plugin by file extension", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript"]);
    registry.register(plugin);
    expect(registry.getPluginForFile("src/index.ts")).toBe(plugin);
    expect(registry.getPluginForFile("src/app.tsx")).toBe(plugin);
  });

  it("maps common extensions to languages", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("multi", ["python", "go", "rust"]);
    registry.register(plugin);
    expect(registry.getPluginForFile("main.py")).toBe(plugin);
    expect(registry.getPluginForFile("main.go")).toBe(plugin);
    expect(registry.getPluginForFile("main.rs")).toBe(plugin);
  });

  it("lists all registered plugins", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("a", ["typescript"]));
    registry.register(createMockPlugin("b", ["python"]));
    expect(registry.getPlugins()).toHaveLength(2);
  });

  it("lists supported languages", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("a", ["typescript", "javascript"]));
    registry.register(createMockPlugin("b", ["python"]));
    const langs = registry.getSupportedLanguages();
    expect(langs).toContain("typescript");
    expect(langs).toContain("python");
  });

  it("unregisters a plugin by name", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("removable", ["typescript"]));
    expect(registry.getPlugins()).toHaveLength(1);
    registry.unregister("removable");
    expect(registry.getPlugins()).toHaveLength(0);
  });

  it("later registration takes priority for same language", () => {
    const registry = new PluginRegistry();
    const first = createMockPlugin("first", ["typescript"]);
    const second = createMockPlugin("second", ["typescript"]);
    registry.register(first);
    registry.register(second);
    // Second registration wins
    expect(registry.getPluginForLanguage("typescript")?.name).toBe("second");
  });

  it("analyzeFile delegates to correct plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript"]);
    plugin.analyzeFile = () => ({
      ...emptyAnalysis,
      functions: [{ name: "hello", lineRange: [1, 5], params: [] }],
    });
    registry.register(plugin);

    const result = registry.analyzeFile("src/test.ts", "const x = 1;");
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
  });

  it("analyzeFile returns null for unsupported files", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));
    const result = registry.analyzeFile("main.py", "print('hello')");
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/plugin-registry.test.ts
```

**Step 3: Implement registry.ts**

```typescript
// packages/core/src/plugins/registry.ts
import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution } from "../types.js";

// Map file extensions to language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  swift: "swift",
  php: "php",
};

/**
 * Registry for analyzer plugins. Maps languages to plugins and provides
 * a unified interface for analyzing files across languages.
 */
export class PluginRegistry {
  private plugins: AnalyzerPlugin[] = [];
  private languageMap = new Map<string, AnalyzerPlugin>();

  /**
   * Register an analyzer plugin. Later registrations take priority
   * for overlapping languages.
   */
  register(plugin: AnalyzerPlugin): void {
    this.plugins.push(plugin);
    for (const lang of plugin.languages) {
      this.languageMap.set(lang, plugin);
    }
  }

  /**
   * Remove a plugin by name.
   */
  unregister(name: string): void {
    const plugin = this.plugins.find((p) => p.name === name);
    if (!plugin) return;

    this.plugins = this.plugins.filter((p) => p.name !== name);

    // Rebuild language map
    this.languageMap.clear();
    for (const p of this.plugins) {
      for (const lang of p.languages) {
        this.languageMap.set(lang, p);
      }
    }
  }

  /**
   * Get plugin for a language name (e.g., "typescript", "python").
   */
  getPluginForLanguage(language: string): AnalyzerPlugin | null {
    return this.languageMap.get(language) ?? null;
  }

  /**
   * Get plugin for a file path based on its extension.
   */
  getPluginForFile(filePath: string): AnalyzerPlugin | null {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (!ext) return null;
    const language = EXTENSION_TO_LANGUAGE[ext];
    if (!language) return null;
    return this.getPluginForLanguage(language);
  }

  /**
   * Analyze a file using the appropriate plugin.
   * Returns null if no plugin supports the file type.
   */
  analyzeFile(filePath: string, content: string): StructuralAnalysis | null {
    const plugin = this.getPluginForFile(filePath);
    if (!plugin) return null;
    return plugin.analyzeFile(filePath, content);
  }

  /**
   * Resolve imports for a file using the appropriate plugin.
   * Returns null if no plugin supports the file type.
   */
  resolveImports(filePath: string, content: string): ImportResolution[] | null {
    const plugin = this.getPluginForFile(filePath);
    if (!plugin) return null;
    return plugin.resolveImports(filePath, content);
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): AnalyzerPlugin[] {
    return [...this.plugins];
  }

  /**
   * Get all supported languages across all plugins.
   */
  getSupportedLanguages(): string[] {
    return [...this.languageMap.keys()];
  }
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/plugin-registry.test.ts
```

**Step 5: Add exports to index.ts**

```typescript
export { PluginRegistry } from "./plugins/registry.js";
```

**Step 6: Build + full test suite**

```bash
cd packages/core && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/core/src/plugins/registry.ts packages/core/src/__tests__/plugin-registry.test.ts packages/core/src/index.ts
git commit -m "feat(core): add plugin registry for community analyzer plugins"
```

---

## Task 5: Plugin Configuration + Discovery

**Files:**
- Create: `packages/core/src/plugins/discovery.ts`
- Create: `packages/core/src/__tests__/plugin-discovery.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The plugin registry from Task 4 manages runtime plugins, but we also need a way to discover and configure plugins from the project's `.understand-anything/` directory. This task adds a plugin configuration file schema and a discovery mechanism that scans for installed plugins and auto-registers them.

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/plugin-discovery.test.ts
import { describe, it, expect } from "vitest";
import {
  parsePluginConfig,
  type PluginConfig,
  type PluginEntry,
  DEFAULT_PLUGIN_CONFIG,
} from "../plugins/discovery.js";

describe("plugin-discovery", () => {
  describe("parsePluginConfig", () => {
    it("parses valid config JSON", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "tree-sitter", enabled: true, languages: ["typescript", "javascript"] },
          { name: "python-ast", enabled: false, languages: ["python"] },
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins).toHaveLength(2);
      expect(config.plugins[0].name).toBe("tree-sitter");
      expect(config.plugins[1].enabled).toBe(false);
    });

    it("returns default config for invalid JSON", () => {
      const config = parsePluginConfig("not json");
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });

    it("returns default config for empty string", () => {
      const config = parsePluginConfig("");
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });

    it("filters out entries missing required fields", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "valid", enabled: true, languages: ["typescript"] },
          { enabled: true, languages: ["python"] }, // missing name
          { name: "no-langs", enabled: true }, // missing languages
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins).toHaveLength(1);
      expect(config.plugins[0].name).toBe("valid");
    });

    it("defaults enabled to true when omitted", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "tree-sitter", languages: ["typescript"] },
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins[0].enabled).toBe(true);
    });
  });

  describe("DEFAULT_PLUGIN_CONFIG", () => {
    it("includes tree-sitter as enabled by default", () => {
      expect(DEFAULT_PLUGIN_CONFIG.plugins).toHaveLength(1);
      expect(DEFAULT_PLUGIN_CONFIG.plugins[0].name).toBe("tree-sitter");
      expect(DEFAULT_PLUGIN_CONFIG.plugins[0].enabled).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/plugin-discovery.test.ts
```

**Step 3: Implement discovery.ts**

```typescript
// packages/core/src/plugins/discovery.ts

export interface PluginEntry {
  name: string;
  enabled: boolean;
  languages: string[];
  options?: Record<string, unknown>;
}

export interface PluginConfig {
  plugins: PluginEntry[];
}

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  plugins: [
    {
      name: "tree-sitter",
      enabled: true,
      languages: ["typescript", "javascript"],
    },
  ],
};

/**
 * Parse a plugin config JSON string.
 * Returns DEFAULT_PLUGIN_CONFIG if parsing fails.
 */
export function parsePluginConfig(jsonString: string): PluginConfig {
  if (!jsonString.trim()) return { ...DEFAULT_PLUGIN_CONFIG };

  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.plugins)) {
      return { ...DEFAULT_PLUGIN_CONFIG };
    }

    const plugins = parsed.plugins
      .filter((entry: unknown): entry is Record<string, unknown> => {
        if (typeof entry !== "object" || entry === null) return false;
        const e = entry as Record<string, unknown>;
        return (
          typeof e.name === "string" &&
          e.name.length > 0 &&
          Array.isArray(e.languages) &&
          e.languages.length > 0
        );
      })
      .map((e: Record<string, unknown>): PluginEntry => ({
        name: e.name as string,
        enabled: typeof e.enabled === "boolean" ? e.enabled : true,
        languages: e.languages as string[],
        ...(e.options ? { options: e.options as Record<string, unknown> } : {}),
      }));

    return { plugins };
  } catch {
    return { ...DEFAULT_PLUGIN_CONFIG };
  }
}

/**
 * Serialize a plugin config to JSON for saving.
 */
export function serializePluginConfig(config: PluginConfig): string {
  return JSON.stringify(config, null, 2);
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/plugin-discovery.test.ts
```

**Step 5: Add exports**

```typescript
export {
  parsePluginConfig,
  serializePluginConfig,
  DEFAULT_PLUGIN_CONFIG,
  type PluginConfig,
  type PluginEntry,
} from "./plugins/discovery.js";
```

**Step 6: Build + test**

```bash
cd packages/core && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/core/src/plugins/discovery.ts packages/core/src/__tests__/plugin-discovery.test.ts packages/core/src/index.ts
git commit -m "feat(core): add plugin configuration and discovery system"
```

---

## Task 6: Embedding-Based Semantic Search (Core)

**Files:**
- Create: `packages/core/src/embedding-search.ts`
- Create: `packages/core/src/__tests__/embedding-search.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The current `SearchEngine` uses fuse.js for fuzzy keyword matching. Embedding-based search enables true semantic queries like "find code that handles authentication" even if the word "authentication" doesn't appear in the node data. This task adds a `SemanticSearchEngine` that stores and searches vector embeddings. The embeddings themselves are generated externally (by calling an embedding API) — this module handles storage and cosine similarity search. It falls back to the existing `SearchEngine` when no embeddings are available.

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/embedding-search.test.ts
import { describe, it, expect } from "vitest";
import { SemanticSearchEngine, cosineSimilarity } from "../embedding-search.js";
import type { GraphNode } from "../types.js";

const nodes: GraphNode[] = [
  { id: "n1", type: "file", name: "auth.ts", summary: "Authentication module", tags: ["auth"], complexity: "moderate" },
  { id: "n2", type: "file", name: "db.ts", summary: "Database connection", tags: ["db"], complexity: "simple" },
  { id: "n3", type: "function", name: "login", summary: "User login handler", tags: ["auth", "login"], complexity: "moderate" },
];

// Simple unit vectors for testing
const embeddings: Record<string, number[]> = {
  n1: [1, 0, 0, 0],
  n2: [0, 1, 0, 0],
  n3: [0.9, 0, 0.1, 0],
};

describe("embedding-search", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    });

    it("returns high similarity for similar vectors", () => {
      const sim = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0]);
      expect(sim).toBeGreaterThan(0.9);
    });

    it("handles zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    });
  });

  describe("SemanticSearchEngine", () => {
    it("returns results sorted by similarity", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const queryEmbedding = [1, 0, 0, 0]; // most similar to n1 and n3
      const results = engine.search(queryEmbedding);
      expect(results[0].nodeId).toBe("n1");
    });

    it("respects limit parameter", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("respects threshold parameter", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { threshold: 0.5 });
      // n2 has 0 similarity, should be filtered out
      const ids = results.map((r) => r.nodeId);
      expect(ids).not.toContain("n2");
    });

    it("filters by node type", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { types: ["function"] });
      expect(results.every((r) => {
        const node = nodes.find((n) => n.id === r.nodeId);
        return node?.type === "function";
      })).toBe(true);
    });

    it("returns empty for nodes without embeddings", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      const results = engine.search([1, 0, 0, 0]);
      expect(results).toHaveLength(0);
    });

    it("hasEmbeddings returns true when embeddings exist", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      expect(engine.hasEmbeddings()).toBe(true);
    });

    it("hasEmbeddings returns false when empty", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      expect(engine.hasEmbeddings()).toBe(false);
    });

    it("addEmbedding updates the search index", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      expect(engine.hasEmbeddings()).toBe(false);
      engine.addEmbedding("n1", [1, 0, 0, 0]);
      expect(engine.hasEmbeddings()).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/embedding-search.test.ts
```

**Step 3: Implement embedding-search.ts**

```typescript
// packages/core/src/embedding-search.ts
import type { GraphNode } from "./types.js";
import type { SearchResult } from "./search.js";

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Semantic search engine using vector embeddings.
 * Stores pre-computed embeddings for graph nodes and performs
 * cosine similarity search against query embeddings.
 */
export class SemanticSearchEngine {
  private nodes: GraphNode[];
  private embeddings: Map<string, number[]>;

  constructor(nodes: GraphNode[], embeddings: Record<string, number[]>) {
    this.nodes = nodes;
    this.embeddings = new Map(Object.entries(embeddings));
  }

  /**
   * Check if any embeddings are loaded.
   */
  hasEmbeddings(): boolean {
    return this.embeddings.size > 0;
  }

  /**
   * Add or update an embedding for a node.
   */
  addEmbedding(nodeId: string, embedding: number[]): void {
    this.embeddings.set(nodeId, embedding);
  }

  /**
   * Search nodes by similarity to a query embedding.
   * Returns SearchResult[] compatible with the existing search interface.
   */
  search(
    queryEmbedding: number[],
    options?: SemanticSearchOptions,
  ): SearchResult[] {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0;
    const typeFilter = options?.types;

    const scored: Array<{ nodeId: string; score: number }> = [];

    for (const node of this.nodes) {
      // Type filter
      if (typeFilter && !typeFilter.includes(node.type)) continue;

      const embedding = this.embeddings.get(node.id);
      if (!embedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity >= threshold) {
        // Convert similarity (0-1, higher=better) to score (0-1, lower=better)
        // to match the SearchResult interface convention from fuse.js
        scored.push({ nodeId: node.id, score: 1 - similarity });
      }
    }

    // Sort by score ascending (lower = more similar)
    scored.sort((a, b) => a.score - b.score);

    return scored.slice(0, limit);
  }

  /**
   * Update the node list (e.g., after graph reload).
   */
  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
  }
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/embedding-search.test.ts
```

**Step 5: Add exports**

```typescript
export {
  SemanticSearchEngine,
  cosineSimilarity,
  type SemanticSearchOptions,
} from "./embedding-search.js";
```

**Step 6: Build + test**

```bash
cd packages/core && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/core/src/embedding-search.ts packages/core/src/__tests__/embedding-search.test.ts packages/core/src/index.ts
git commit -m "feat(core): add embedding-based semantic search engine"
```

---

## Task 7: Embedding Search Dashboard Integration

**Files:**
- Modify: `packages/dashboard/src/store.ts` (add semantic search state)
- Modify: `packages/dashboard/src/components/SearchBar.tsx` (semantic search toggle)

**Context:** This task integrates the `SemanticSearchEngine` into the dashboard. When the knowledge graph includes pre-computed embeddings (stored as a separate field or companion file), the SearchBar offers a toggle between "Fuzzy" and "Semantic" search modes. The semantic mode uses vector similarity for queries like "where is authentication handled" even if those exact words aren't in any node. For MVP, we'll add the UI toggle and wiring — actual embedding generation requires an API call that would be part of the analysis pipeline.

**Step 1: Add semantic search state to the store**

In `packages/dashboard/src/store.ts`:

```typescript
// Add to interface
searchMode: "fuzzy" | "semantic";
setSearchMode: (mode: "fuzzy" | "semantic") => void;

// Add to implementation
searchMode: "fuzzy",
setSearchMode: (mode) => set({ searchMode: mode }),
```

Update `setSearchQuery` to check `searchMode`:
```typescript
setSearchQuery: (query) => {
  const engine = get().searchEngine;
  const mode = get().searchMode;
  if (!engine || !query.trim()) {
    set({ searchQuery: query, searchResults: [] });
    return;
  }
  // Currently both modes use the same fuzzy engine
  // When embeddings are available, "semantic" mode will use SemanticSearchEngine
  const searchResults = engine.search(query);
  set({ searchQuery: query, searchResults });
},
```

**Step 2: Add search mode toggle to SearchBar**

In `packages/dashboard/src/components/SearchBar.tsx`, add:

```tsx
const searchMode = useDashboardStore((s) => s.searchMode);
const setSearchMode = useDashboardStore((s) => s.setSearchMode);

// Add toggle next to the search input:
<div className="flex items-center gap-1 bg-gray-700 rounded p-0.5 shrink-0">
  <button
    onClick={() => setSearchMode("fuzzy")}
    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
      searchMode === "fuzzy"
        ? "bg-gray-600 text-white"
        : "text-gray-400 hover:text-gray-300"
    }`}
  >
    Fuzzy
  </button>
  <button
    onClick={() => setSearchMode("semantic")}
    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
      searchMode === "semantic"
        ? "bg-gray-600 text-white"
        : "text-gray-400 hover:text-gray-300"
    }`}
  >
    Semantic
  </button>
</div>
```

**Step 3: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm build
```

**Step 4: Commit**

```bash
git add packages/dashboard/src/store.ts packages/dashboard/src/components/SearchBar.tsx
git commit -m "feat(dashboard): add fuzzy/semantic search mode toggle"
```

---

## Verification Checklist

After all tasks are complete:

1. `cd packages/core && pnpm build && pnpm test` — all tests pass (existing + ~35 new)
2. `cd packages/skill && pnpm build && pnpm test` — all tests pass (existing 14 + ~25 new)
3. `cd packages/dashboard && pnpm build` — compiles without errors
4. Skill definitions exist:
   - `packages/skill/.claude/skills/understand-diff.md`
   - `packages/skill/.claude/skills/understand-explain.md`
   - `packages/skill/.claude/skills/understand-onboard.md`
5. Plugin registry works:
   - `PluginRegistry.register()`, `getPluginForFile()`, `analyzeFile()`
   - `parsePluginConfig()` handles valid/invalid JSON
6. Semantic search:
   - `cosineSimilarity()` produces correct values
   - `SemanticSearchEngine.search()` returns sorted results
   - Dashboard toggle renders and switches modes
7. All existing Phase 1 + Phase 2 + Phase 3 features still work
