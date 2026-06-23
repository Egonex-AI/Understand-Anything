# Understand Anything — Phase 3 (Learn Mode) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the "Learn Mode" layer — tour generation, contextual explanations, language-specific lessons, and persona modes (non-technical / junior / experienced).

**Architecture:** Extends the existing monorepo. Core gets tour generation and language lesson prompt builders. Dashboard gets a new LearnPanel component, persona selector, and enhanced node explanation. The existing 4-panel layout becomes persona-adaptive.

**Tech Stack:** No new dependencies required. Uses existing react-markdown, @anthropic-ai/sdk, zustand, @xyflow/react, tailwindcss.

---

## Dependency Graph

```
Task 1 (Tour Gen Core) ──────────────┐
                                      ├─→ Task 3 (Tour Player + Highlights)
Task 2 (LearnPanel + Store) ─────────┘          │
                                                 │
Task 4 (Node Explanations) ─── (independent) ───┤
                                                 │
Task 5 (Language Lesson Core) ───────────────────┤
                                                 ├─→ Task 7 (Persona Modes)
Task 6 (Language Lesson Display) ────────────────┘
```

Tasks 1, 2, 4, 5 can be developed in any order. Task 3 depends on Task 2. Task 6 depends on Task 5. Task 7 depends on Tasks 2+3+6 being complete.

---

## Task 1: Tour Generation Engine (Core)

**Files:**
- Create: `packages/core/src/analyzer/tour-generator.ts`
- Create: `packages/core/src/__tests__/tour-generator.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The `TourStep` schema already exists in `packages/core/src/types.ts` (order, title, description, nodeIds, languageLesson?). The sample `knowledge-graph.json` already has 6 tour steps with language lessons. This task builds the engine that GENERATES those tours: an LLM prompt builder + response parser, and a heuristic fallback that creates tours without an LLM by using graph topology (entry-point detection → topological sort → group by layers).

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/tour-generator.test.ts
import { describe, it, expect } from "vitest";
import {
  buildTourGenerationPrompt,
  parseTourGenerationResponse,
  generateHeuristicTour,
} from "../analyzer/tour-generator.js";
import type { KnowledgeGraph } from "../types.js";

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
    {
      id: "file:src/index.ts",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      summary: "Application entry point",
      tags: ["entry", "server"],
      complexity: "simple",
    },
    {
      id: "file:src/routes.ts",
      type: "file",
      name: "routes.ts",
      filePath: "src/routes.ts",
      summary: "Route definitions",
      tags: ["routes", "api"],
      complexity: "moderate",
    },
    {
      id: "file:src/service.ts",
      type: "file",
      name: "service.ts",
      filePath: "src/service.ts",
      summary: "Business logic",
      tags: ["service"],
      complexity: "complex",
    },
    {
      id: "file:src/db.ts",
      type: "file",
      name: "db.ts",
      filePath: "src/db.ts",
      summary: "Database connection",
      tags: ["database"],
      complexity: "simple",
    },
    {
      id: "concept:auth-flow",
      type: "concept",
      name: "Auth Flow",
      summary: "Authentication concept",
      tags: ["concept", "auth"],
      complexity: "moderate",
    },
  ],
  edges: [
    { source: "file:src/index.ts", target: "file:src/routes.ts", type: "imports", direction: "forward", weight: 0.9 },
    { source: "file:src/routes.ts", target: "file:src/service.ts", type: "calls", direction: "forward", weight: 0.8 },
    { source: "file:src/service.ts", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.7 },
  ],
  layers: [
    { id: "layer:api", name: "API Layer", description: "HTTP routes", nodeIds: ["file:src/index.ts", "file:src/routes.ts"] },
    { id: "layer:service", name: "Service Layer", description: "Business logic", nodeIds: ["file:src/service.ts"] },
    { id: "layer:data", name: "Data Layer", description: "Database", nodeIds: ["file:src/db.ts"] },
  ],
  tour: [],
};

describe("tour-generator", () => {
  describe("buildTourGenerationPrompt", () => {
    it("includes project name and description", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("test-project");
      expect(prompt).toContain("A test project");
    });

    it("includes all node summaries", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("index.ts");
      expect(prompt).toContain("routes.ts");
      expect(prompt).toContain("service.ts");
    });

    it("includes layer information", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("API Layer");
      expect(prompt).toContain("Service Layer");
    });

    it("requests JSON output format", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("JSON");
    });
  });

  describe("parseTourGenerationResponse", () => {
    it("parses valid JSON response with tour steps", () => {
      const response = JSON.stringify({
        steps: [
          { order: 1, title: "Entry Point", description: "Start here", nodeIds: ["file:src/index.ts"] },
          { order: 2, title: "Routing", description: "Routes next", nodeIds: ["file:src/routes.ts"], languageLesson: "Express uses middleware" },
        ],
      });
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(2);
      expect(steps[0].title).toBe("Entry Point");
      expect(steps[1].languageLesson).toBe("Express uses middleware");
    });

    it("extracts JSON from markdown code blocks", () => {
      const response = "Here is the tour:\n```json\n" + JSON.stringify({
        steps: [{ order: 1, title: "Step 1", description: "Desc", nodeIds: ["n1"] }],
      }) + "\n```";
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(1);
    });

    it("returns empty array for unparseable response", () => {
      const steps = parseTourGenerationResponse("not json at all");
      expect(steps).toEqual([]);
    });

    it("filters out steps with missing required fields", () => {
      const response = JSON.stringify({
        steps: [
          { order: 1, title: "Valid", description: "OK", nodeIds: ["n1"] },
          { order: 2, description: "Missing title", nodeIds: ["n2"] },
          { order: 3, title: "Missing desc", nodeIds: ["n3"] },
        ],
      });
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe("Valid");
    });
  });

  describe("generateHeuristicTour", () => {
    it("starts with entry-point nodes", () => {
      const tour = generateHeuristicTour(sampleGraph);
      expect(tour.length).toBeGreaterThan(0);
      // index.ts has no incoming edges → entry point
      expect(tour[0].nodeIds).toContain("file:src/index.ts");
    });

    it("follows topological order", () => {
      const tour = generateHeuristicTour(sampleGraph);
      const allNodeIds = tour.flatMap((s) => s.nodeIds);
      const indexPos = allNodeIds.indexOf("file:src/index.ts");
      const routesPos = allNodeIds.indexOf("file:src/routes.ts");
      const servicePos = allNodeIds.indexOf("file:src/service.ts");
      // entry → routes → service (topological order)
      expect(indexPos).toBeLessThan(routesPos);
      expect(routesPos).toBeLessThan(servicePos);
    });

    it("includes concept nodes in separate steps", () => {
      const tour = generateHeuristicTour(sampleGraph);
      const conceptStep = tour.find((s) =>
        s.nodeIds.includes("concept:auth-flow"),
      );
      expect(conceptStep).toBeDefined();
    });

    it("assigns order numbers sequentially", () => {
      const tour = generateHeuristicTour(sampleGraph);
      tour.forEach((step, i) => {
        expect(step.order).toBe(i + 1);
      });
    });

    it("groups nodes by layer when layers exist", () => {
      const tour = generateHeuristicTour(sampleGraph);
      // Steps should roughly follow layer boundaries
      expect(tour.length).toBeGreaterThanOrEqual(3);
    });

    it("produces valid TourStep objects", () => {
      const tour = generateHeuristicTour(sampleGraph);
      for (const step of tour) {
        expect(step).toHaveProperty("order");
        expect(step).toHaveProperty("title");
        expect(step).toHaveProperty("description");
        expect(step).toHaveProperty("nodeIds");
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(0);
        expect(step.nodeIds.length).toBeGreaterThan(0);
      }
    });

    it("handles graph with no edges gracefully", () => {
      const isolated = { ...sampleGraph, edges: [] };
      const tour = generateHeuristicTour(isolated);
      expect(tour.length).toBeGreaterThan(0);
    });

    it("handles graph with no layers", () => {
      const noLayers = { ...sampleGraph, layers: [] };
      const tour = generateHeuristicTour(noLayers);
      expect(tour.length).toBeGreaterThan(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/tour-generator.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement tour-generator.ts**

```typescript
// packages/core/src/analyzer/tour-generator.ts
import type { KnowledgeGraph, TourStep, GraphNode, GraphEdge } from "../types.js";

/**
 * Build an LLM prompt that asks for a guided tour of the project.
 */
export function buildTourGenerationPrompt(graph: KnowledgeGraph): string {
  const { project, nodes, edges, layers } = graph;

  const nodeList = nodes
    .map((n) => `- [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`)
    .join("\n");

  const edgeList = edges
    .slice(0, 50) // cap to avoid overly long prompts
    .map((e) => {
      const src = nodes.find((n) => n.id === e.source)?.name ?? e.source;
      const tgt = nodes.find((n) => n.id === e.target)?.name ?? e.target;
      return `- ${src} --[${e.type}]--> ${tgt}`;
    })
    .join("\n");

  const layerList = layers.length > 0
    ? layers.map((l) => `- ${l.name}: ${l.description} (${l.nodeIds.length} nodes)`).join("\n")
    : "No layers defined";

  return [
    `You are generating a guided tour for a software project called "${project.name}".`,
    ``,
    `Project description: ${project.description}`,
    `Languages: ${project.languages.join(", ")}`,
    `Frameworks: ${project.frameworks.join(", ")}`,
    ``,
    `## Nodes`,
    nodeList,
    ``,
    `## Relationships`,
    edgeList,
    ``,
    `## Layers`,
    layerList,
    ``,
    `## Instructions`,
    `Create a guided tour of this project. Each step should:`,
    `1. Focus on 1-4 nodes that belong together conceptually`,
    `2. Have a clear, engaging title (like "Where It All Begins" not "Step 1")`,
    `3. Explain in plain English what these components do and WHY they exist`,
    `4. Follow the natural execution flow (entry point → routing → business logic → data)`,
    `5. Include a languageLesson field for steps that use language-specific concepts`,
    `   (e.g., middleware, generics, async/await, decorators — explain them simply)`,
    ``,
    `Return JSON in exactly this format:`,
    `\`\`\`json`,
    `{`,
    `  "steps": [`,
    `    {`,
    `      "order": 1,`,
    `      "title": "Engaging Step Title",`,
    `      "description": "Markdown explanation of what these nodes do.",`,
    `      "nodeIds": ["node-id-1", "node-id-2"],`,
    `      "languageLesson": "Optional: explain a language concept used here"`,
    `    }`,
    `  ]`,
    `}`,
    `\`\`\``,
    ``,
    `Create 4-8 steps covering the full project. Use actual node IDs from the list above.`,
  ].join("\n");
}

/**
 * Parse the LLM response into TourStep[].
 * Handles raw JSON, JSON in markdown code blocks, and graceful fallback.
 */
export function parseTourGenerationResponse(response: string): TourStep[] {
  let json: string = response;

  // Extract from markdown code blocks if present
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    json = codeBlockMatch[1];
  }

  try {
    const parsed = JSON.parse(json);
    const rawSteps: unknown[] = Array.isArray(parsed) ? parsed : parsed?.steps;
    if (!Array.isArray(rawSteps)) return [];

    return rawSteps.filter((s): s is TourStep => {
      if (typeof s !== "object" || s === null) return false;
      const step = s as Record<string, unknown>;
      return (
        typeof step.order === "number" &&
        typeof step.title === "string" &&
        step.title.length > 0 &&
        typeof step.description === "string" &&
        step.description.length > 0 &&
        Array.isArray(step.nodeIds) &&
        step.nodeIds.length > 0
      );
    }).map((s) => ({
      order: s.order,
      title: s.title,
      description: s.description,
      nodeIds: s.nodeIds,
      ...(s.languageLesson ? { languageLesson: s.languageLesson } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Generate a tour using heuristics only (no LLM required).
 *
 * Strategy:
 * 1. Find entry-point nodes (no incoming edges, or named index/main/app)
 * 2. Topological sort from entry points
 * 3. Group by layer (if layers exist) or by execution depth
 * 4. Add concept nodes as separate explanatory steps
 */
export function generateHeuristicTour(graph: KnowledgeGraph): TourStep[] {
  const { nodes, edges, layers } = graph;

  // Separate concept nodes from code nodes
  const codeNodes = nodes.filter((n) => n.type !== "concept");
  const conceptNodes = nodes.filter((n) => n.type === "concept");

  // Build adjacency info
  const incomingCount = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of codeNodes) {
    incomingCount.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!incomingCount.has(edge.source) || !incomingCount.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  // Find entry points: nodes with 0 incoming edges
  const entryPoints = codeNodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0);

  // Topological sort (Kahn's algorithm)
  const sorted: GraphNode[] = [];
  const queue = [...entryPoints];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    sorted.push(node);

    for (const targetId of adjacency.get(node.id) ?? []) {
      const count = (incomingCount.get(targetId) ?? 1) - 1;
      incomingCount.set(targetId, count);
      const targetNode = codeNodes.find((n) => n.id === targetId);
      if (targetNode && count <= 0 && !visited.has(targetId)) {
        queue.push(targetNode);
      }
    }
  }

  // Add any unvisited nodes (cycles or disconnected)
  for (const node of codeNodes) {
    if (!visited.has(node.id)) {
      sorted.push(node);
    }
  }

  // Group sorted nodes into tour steps
  const steps: TourStep[] = [];

  if (layers.length > 0) {
    // Group by layer, in topological order of first appearance
    const layerOrder: string[] = [];
    const layerNodes = new Map<string, string[]>();
    const nodeToLayer = new Map<string, string>();

    for (const layer of layers) {
      layerNodes.set(layer.id, []);
      for (const nid of layer.nodeIds) {
        nodeToLayer.set(nid, layer.id);
      }
    }

    // Determine layer order based on topological sort
    for (const node of sorted) {
      const lid = nodeToLayer.get(node.id);
      if (lid) {
        if (!layerOrder.includes(lid)) layerOrder.push(lid);
        layerNodes.get(lid)!.push(node.id);
      }
    }

    // Unlayered nodes
    const unlayered = sorted.filter((n) => !nodeToLayer.has(n.id)).map((n) => n.id);

    for (const lid of layerOrder) {
      const layer = layers.find((l) => l.id === lid)!;
      const nids = layerNodes.get(lid) ?? [];
      if (nids.length === 0) continue;

      steps.push({
        order: steps.length + 1,
        title: layer.name,
        description: `${layer.description}. This layer contains: ${nids.map((id) => nodes.find((n) => n.id === id)?.name ?? id).join(", ")}.`,
        nodeIds: nids,
      });
    }

    if (unlayered.length > 0) {
      steps.push({
        order: steps.length + 1,
        title: "Supporting Components",
        description: `Additional components that support the main architecture: ${unlayered.map((id) => nodes.find((n) => n.id === id)?.name ?? id).join(", ")}.`,
        nodeIds: unlayered,
      });
    }
  } else {
    // No layers: group by depth/batch (up to 3 nodes per step)
    const batchSize = 3;
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      const names = batch.map((n) => n.name).join(", ");
      steps.push({
        order: steps.length + 1,
        title: i === 0 ? "Entry Points" : `Components: ${names}`,
        description: batch.map((n) => `**${n.name}** — ${n.summary}`).join("\n\n"),
        nodeIds: batch.map((n) => n.id),
      });
    }
  }

  // Add concept nodes as a final explanatory step
  if (conceptNodes.length > 0) {
    steps.push({
      order: steps.length + 1,
      title: "Key Concepts",
      description: conceptNodes
        .map((n) => `**${n.name}** — ${n.summary}`)
        .join("\n\n"),
      nodeIds: conceptNodes.map((n) => n.id),
    });
  }

  return steps;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/tour-generator.test.ts
```

Expected: All tests PASS

**Step 5: Add exports to index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export {
  buildTourGenerationPrompt,
  parseTourGenerationResponse,
  generateHeuristicTour,
} from "./analyzer/tour-generator.js";
```

**Step 6: Verify build**

```bash
cd packages/core && pnpm build
```

**Step 7: Commit**

```bash
git add packages/core/src/analyzer/tour-generator.ts packages/core/src/__tests__/tour-generator.test.ts packages/core/src/index.ts
git commit -m "feat(core): add tour generation engine with heuristic and LLM strategies"
```

---

## Task 2: LearnPanel Component + Tour Store State (Dashboard)

**Files:**
- Create: `packages/dashboard/src/components/LearnPanel.tsx`
- Modify: `packages/dashboard/src/store.ts` (add tour state + actions)
- Modify: `packages/dashboard/src/App.tsx` (replace bottom-right NodeInfo with tabbed panel)

**Context:** The dashboard currently has a 4-panel layout: GraphView (top-left), CodeViewer (top-right), ChatPanel (bottom-left), NodeInfo (bottom-right). This task adds tour state to the Zustand store and creates a LearnPanel component. The bottom-right panel becomes a tabbed view switching between NodeInfo and LearnPanel. The LearnPanel shows the tour step list and current step content.

**Step 1: Add tour state to the Zustand store**

In `packages/dashboard/src/store.ts`, add to the `DashboardStore` interface:

```typescript
// Add these fields to the interface
tourActive: boolean;
currentTourStep: number;
tourHighlightedNodeIds: string[];

// Add these actions
startTour: () => void;
stopTour: () => void;
setTourStep: (step: number) => void;
nextTourStep: () => void;
prevTourStep: () => void;
```

Add to the store implementation:

```typescript
tourActive: false,
currentTourStep: 0,
tourHighlightedNodeIds: [],

startTour: () => {
  const graph = get().graph;
  if (!graph || graph.tour.length === 0) return;
  const firstStep = graph.tour[0];
  set({
    tourActive: true,
    currentTourStep: 0,
    tourHighlightedNodeIds: firstStep.nodeIds,
    selectedNodeId: null,
  });
},

stopTour: () => set({
  tourActive: false,
  currentTourStep: 0,
  tourHighlightedNodeIds: [],
}),

setTourStep: (step) => {
  const graph = get().graph;
  if (!graph || step < 0 || step >= graph.tour.length) return;
  set({
    currentTourStep: step,
    tourHighlightedNodeIds: graph.tour[step].nodeIds,
  });
},

nextTourStep: () => {
  const { graph, currentTourStep } = get();
  if (!graph) return;
  const next = currentTourStep + 1;
  if (next < graph.tour.length) {
    set({
      currentTourStep: next,
      tourHighlightedNodeIds: graph.tour[next].nodeIds,
    });
  }
},

prevTourStep: () => {
  const { graph, currentTourStep } = get();
  if (!graph) return;
  const prev = currentTourStep - 1;
  if (prev >= 0) {
    set({
      currentTourStep: prev,
      tourHighlightedNodeIds: graph.tour[prev].nodeIds,
    });
  }
},
```

**Step 2: Create the LearnPanel component**

```tsx
// packages/dashboard/src/components/LearnPanel.tsx
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";

export default function LearnPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const currentTourStep = useDashboardStore((s) => s.currentTourStep);
  const startTour = useDashboardStore((s) => s.startTour);
  const stopTour = useDashboardStore((s) => s.stopTour);
  const setTourStep = useDashboardStore((s) => s.setTourStep);
  const nextTourStep = useDashboardStore((s) => s.nextTourStep);
  const prevTourStep = useDashboardStore((s) => s.prevTourStep);

  const tourSteps = graph?.tour ?? [];

  if (tourSteps.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-800 rounded-lg">
        <p className="text-gray-400 text-sm">No tour available for this project</p>
      </div>
    );
  }

  if (!tourActive) {
    return (
      <div className="h-full w-full bg-gray-800 rounded-lg flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-center">
          <h3 className="text-lg font-bold text-white mb-2">Project Tour</h3>
          <p className="text-sm text-gray-400 mb-1">
            {tourSteps.length} steps to understand this codebase
          </p>
          <p className="text-xs text-gray-500">
            Follow a guided walkthrough of the project architecture
          </p>
        </div>
        <button
          onClick={startTour}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors font-medium"
        >
          Start Tour
        </button>
        {/* Step list preview */}
        <div className="w-full mt-2 space-y-1">
          {tourSteps.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-400"
            >
              <span className="text-gray-600 font-mono w-5 text-right">{step.order}.</span>
              <span>{step.title}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const step = tourSteps[currentTourStep];
  const isFirst = currentTourStep === 0;
  const isLast = currentTourStep === tourSteps.length - 1;

  return (
    <div className="h-full w-full bg-gray-800 rounded-lg flex flex-col overflow-hidden">
      {/* Header with progress */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Tour
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">
            {currentTourStep + 1} / {tourSteps.length}
          </span>
          <button
            onClick={stopTour}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-700 shrink-0">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${((currentTourStep + 1) / tourSteps.length) * 100}%` }}
        />
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <h2 className="text-base font-bold text-white mb-3">{step.title}</h2>

        <div className="text-sm text-gray-300 leading-relaxed tour-markdown">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
              code: ({ children }) => (
                <code className="bg-gray-900 rounded px-1 py-0.5 text-[12px]">{children}</code>
              ),
              ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
            }}
          >
            {step.description}
          </ReactMarkdown>
        </div>

        {/* Language lesson */}
        {step.languageLesson && (
          <div className="mt-4 bg-indigo-900/30 border border-indigo-700/50 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">
              Language Concept
            </h4>
            <p className="text-sm text-indigo-200 leading-relaxed">
              {step.languageLesson}
            </p>
          </div>
        )}

        {/* Referenced nodes */}
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Referenced Components
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {step.nodeIds.map((nodeId) => {
              const node = graph?.nodes.find((n) => n.id === nodeId);
              return (
                <span
                  key={nodeId}
                  className="text-[11px] bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full"
                >
                  {node?.name ?? nodeId}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step navigation */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-700 shrink-0">
        {/* Step dots */}
        <div className="flex gap-1 flex-1 justify-center">
          {tourSteps.map((_, i) => (
            <button
              key={i}
              onClick={() => setTourStep(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentTourStep
                  ? "bg-blue-500"
                  : i < currentTourStep
                    ? "bg-blue-800"
                    : "bg-gray-600"
              }`}
              title={tourSteps[i].title}
            />
          ))}
        </div>

        {/* Prev/Next buttons */}
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={prevTourStep}
            disabled={isFirst}
            className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Prev
          </button>
          <button
            onClick={nextTourStep}
            disabled={isLast}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Add tabbed bottom-right panel to App.tsx**

Replace the bottom-right panel in `packages/dashboard/src/App.tsx`. Add import for `LearnPanel` and a `useState` for the active tab. The bottom-right `<div>` becomes:

```tsx
import LearnPanel from "./components/LearnPanel";
// ... in App component, add state:
const hasTour = (graph?.tour ?? []).length > 0;

// Replace the bottom-right panel div:
{/* Bottom-right: Node Info / Learn Panel */}
<div className="min-h-0 min-w-0 flex flex-col">
  {hasTour && (
    <div className="flex border-b border-gray-700 bg-gray-800 rounded-t-lg shrink-0">
      <button
        onClick={() => useDashboardStore.getState().stopTour()}
        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
          !useDashboardStore.getState().tourActive
            ? "text-white border-b-2 border-blue-500"
            : "text-gray-400 hover:text-gray-300"
        }`}
      >
        Details
      </button>
      <button
        onClick={() => useDashboardStore.getState().startTour()}
        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
          useDashboardStore.getState().tourActive
            ? "text-white border-b-2 border-blue-500"
            : "text-gray-400 hover:text-gray-300"
        }`}
      >
        Tour
      </button>
    </div>
  )}
  <div className="flex-1 min-h-0">
    {useDashboardStore.getState().tourActive ? <LearnPanel /> : <NodeInfo />}
  </div>
</div>
```

Note: The implementer should use the Zustand store selectors properly with `useDashboardStore((s) => s.tourActive)` instead of `getState()` — the above is a sketch. The tab state should be reactive.

**Step 4: Verify dashboard compiles and renders**

```bash
cd packages/dashboard && pnpm build
```

**Step 5: Commit**

```bash
git add packages/dashboard/src/components/LearnPanel.tsx packages/dashboard/src/store.ts packages/dashboard/src/App.tsx
git commit -m "feat(dashboard): add LearnPanel component with tour state management"
```

---

## Task 3: Tour Player — Graph Highlighting + Node Focus

**Files:**
- Modify: `packages/dashboard/src/components/GraphView.tsx` (highlight tour nodes)
- Modify: `packages/dashboard/src/components/CustomNode.tsx` (tour highlight style)

**Context:** When a tour is active, the GraphView must visually distinguish the nodes referenced by the current tour step. This task adds a `isTourHighlighted` prop to CustomNode and wires it through GraphView using the `tourHighlightedNodeIds` from the store. Tour-highlighted nodes get a distinct pulsing blue ring (different from search highlights which are yellow).

**Step 1: Add isTourHighlighted to CustomNode data**

In `packages/dashboard/src/components/CustomNode.tsx`, add to `CustomNodeData`:

```typescript
export interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  summary: string;
  complexity: string;
  isHighlighted: boolean;
  searchScore?: number;
  isSelected: boolean;
  isTourHighlighted: boolean; // NEW
}
```

Add tour highlight ring logic (takes priority over search highlight but not selection):

```typescript
let ringClass = "";
if (data.isSelected) {
  ringClass = "ring-2 ring-white";
} else if (data.isTourHighlighted) {
  ringClass = "ring-2 ring-blue-400 animate-pulse";
} else if (data.isHighlighted) {
  const score = data.searchScore ?? 1;
  if (score <= 0.1) {
    ringClass = "ring-2 ring-yellow-300";
  } else if (score <= 0.3) {
    ringClass = "ring-2 ring-yellow-400";
  } else {
    ringClass = "ring-2 ring-yellow-500/60";
  }
}
```

**Step 2: Pass tourHighlightedNodeIds through GraphView**

In `packages/dashboard/src/components/GraphView.tsx`, add the store selector:

```typescript
const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
```

Add `tourHighlightedNodeIds` to the `useMemo` dependency array. In the `flowNodes` mapping, add:

```typescript
isTourHighlighted: tourHighlightedNodeIds.includes(node.id),
```

**Step 3: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm build
```

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/GraphView.tsx packages/dashboard/src/components/CustomNode.tsx
git commit -m "feat(dashboard): highlight tour-referenced nodes in graph view"
```

---

## Task 4: Contextual Node Explanation (Dashboard)

**Files:**
- Modify: `packages/dashboard/src/store.ts` (add explanation state + action)
- Modify: `packages/dashboard/src/components/NodeInfo.tsx` (add Explain button + display)

**Context:** Users should be able to click "Explain" on any node to get a detailed plain-English explanation generated by Claude. This reuses the same Anthropic SDK pattern from the ChatPanel but targets a single node. The explanation includes what the node does, why it exists, how it connects to the rest of the project, and any notable patterns. The explanation is cached per node ID to avoid re-calling the API.

**Step 1: Add explanation state to the store**

In `packages/dashboard/src/store.ts`, add to the interface:

```typescript
nodeExplanation: string | null;
nodeExplanationLoading: boolean;
nodeExplanationCache: Record<string, string>;
explainNode: (nodeId: string) => Promise<void>;
```

Add to the implementation:

```typescript
nodeExplanation: null,
nodeExplanationLoading: false,
nodeExplanationCache: {},

explainNode: async (nodeId) => {
  const { apiKey, graph, nodeExplanationCache } = get();
  if (!apiKey || !graph) return;

  // Check cache first
  if (nodeExplanationCache[nodeId]) {
    set({ nodeExplanation: nodeExplanationCache[nodeId] });
    return;
  }

  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  set({ nodeExplanationLoading: true, nodeExplanation: null });

  try {
    const connections = graph.edges.filter(
      (e) => e.source === nodeId || e.target === nodeId,
    );
    const connDetails = connections
      .map((e) => {
        const isSource = e.source === nodeId;
        const otherId = isSource ? e.target : e.source;
        const otherNode = graph.nodes.find((n) => n.id === otherId);
        return `${isSource ? "->" : "<-"} [${e.type}] ${otherNode?.name ?? otherId}`;
      })
      .join("\n");

    const layer = graph.layers.find((l) => l.nodeIds.includes(nodeId));

    const prompt = [
      `Explain the following code component in plain English. Be thorough but accessible.`,
      ``,
      `**Component:** ${node.name}`,
      `**Type:** ${node.type}`,
      `**File:** ${node.filePath ?? "N/A"}`,
      `**Summary:** ${node.summary}`,
      `**Complexity:** ${node.complexity}`,
      `**Tags:** ${node.tags.join(", ") || "none"}`,
      layer ? `**Layer:** ${layer.name} — ${layer.description}` : "",
      ``,
      `**Connections:**`,
      connDetails || "  none",
      ``,
      `Explain:`,
      `1. What this component does and WHY it exists`,
      `2. How it fits into the larger architecture`,
      `3. Key relationships with other components`,
      `4. Any patterns or concepts worth understanding`,
      ``,
      `Keep the explanation concise (2-4 paragraphs). Use markdown formatting.`,
    ].join("\n");

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text"
      ? response.content[0].text
      : "Unable to generate explanation.";

    set((state) => ({
      nodeExplanation: text,
      nodeExplanationLoading: false,
      nodeExplanationCache: { ...state.nodeExplanationCache, [nodeId]: text },
    }));
  } catch (err) {
    set({
      nodeExplanation: `Error: ${err instanceof Error ? err.message : "Failed to generate explanation"}`,
      nodeExplanationLoading: false,
    });
  }
},
```

Don't forget to add `import Anthropic from "@anthropic-ai/sdk"` if not already imported (it is in the current store.ts).

Also add to `selectNode` action — clear explanation when switching nodes:

```typescript
selectNode: (nodeId) => set({ selectedNodeId: nodeId, nodeExplanation: null }),
```

**Step 2: Add Explain button and display to NodeInfo**

In `packages/dashboard/src/components/NodeInfo.tsx`, add store selectors and the UI:

```typescript
const apiKey = useDashboardStore((s) => s.apiKey);
const nodeExplanation = useDashboardStore((s) => s.nodeExplanation);
const nodeExplanationLoading = useDashboardStore((s) => s.nodeExplanationLoading);
const explainNode = useDashboardStore((s) => s.explainNode);
```

Add after the summary paragraph, before tags:

```tsx
{/* Explain button + explanation */}
{apiKey && (
  <div className="mb-4">
    {!nodeExplanation && !nodeExplanationLoading && (
      <button
        onClick={() => explainNode(node.id)}
        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-500 transition-colors"
      >
        Explain This
      </button>
    )}
    {nodeExplanationLoading && (
      <div className="text-xs text-gray-400 animate-pulse">
        Generating explanation...
      </div>
    )}
    {nodeExplanation && (
      <div className="bg-gray-700/50 rounded-lg p-3 text-sm text-gray-300 leading-relaxed">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
            code: ({ children }) => (
              <code className="bg-gray-900 rounded px-1 py-0.5 text-[11px]">{children}</code>
            ),
          }}
        >
          {nodeExplanation}
        </ReactMarkdown>
      </div>
    )}
  </div>
)}
```

Don't forget to add `import ReactMarkdown from "react-markdown"` to NodeInfo.

**Step 3: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm build
```

**Step 4: Commit**

```bash
git add packages/dashboard/src/store.ts packages/dashboard/src/components/NodeInfo.tsx
git commit -m "feat(dashboard): add contextual node explanation with Claude API"
```

---

## Task 5: Language Lesson Prompt Builder (Core)

**Files:**
- Create: `packages/core/src/analyzer/language-lesson.ts`
- Create: `packages/core/src/__tests__/language-lesson.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The `languageNotes` field on `GraphNode` and `languageLesson` field on `TourStep` are designed for language-specific teaching. This task builds the LLM prompt templates that generate these lessons — explaining language concepts (async/await, generics, middleware patterns, decorators, etc.) in the context of the user's actual code. This is what makes "Learn Mode" unique: you learn Go/Rust/TypeScript concepts by seeing them explained in YOUR project.

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/language-lesson.test.ts
import { describe, it, expect } from "vitest";
import {
  buildLanguageLessonPrompt,
  parseLanguageLessonResponse,
  detectLanguageConcepts,
} from "../analyzer/language-lesson.js";
import type { GraphNode, GraphEdge } from "../types.js";

const sampleNode: GraphNode = {
  id: "func:auth:verifyToken",
  type: "function",
  name: "verifyToken",
  filePath: "src/auth/verify.ts",
  lineRange: [10, 35],
  summary: "Verifies JWT tokens and extracts user payload using async/await",
  tags: ["auth", "jwt", "async"],
  complexity: "moderate",
};

const sampleEdges: GraphEdge[] = [
  { source: "func:auth:verifyToken", target: "file:src/config.ts", type: "reads_from", direction: "forward", weight: 0.6 },
  { source: "file:src/middleware.ts", target: "func:auth:verifyToken", type: "calls", direction: "forward", weight: 0.8 },
];

describe("language-lesson", () => {
  describe("buildLanguageLessonPrompt", () => {
    it("includes the node name and summary", () => {
      const prompt = buildLanguageLessonPrompt(sampleNode, sampleEdges, "typescript");
      expect(prompt).toContain("verifyToken");
      expect(prompt).toContain("JWT tokens");
    });

    it("includes the target language", () => {
      const prompt = buildLanguageLessonPrompt(sampleNode, sampleEdges, "typescript");
      expect(prompt).toContain("TypeScript");
    });

    it("includes relationship context", () => {
      const prompt = buildLanguageLessonPrompt(sampleNode, sampleEdges, "typescript");
      expect(prompt).toContain("reads_from");
    });

    it("requests JSON output", () => {
      const prompt = buildLanguageLessonPrompt(sampleNode, sampleEdges, "typescript");
      expect(prompt).toContain("JSON");
    });
  });

  describe("parseLanguageLessonResponse", () => {
    it("parses a valid response", () => {
      const response = JSON.stringify({
        languageNotes: "This function uses async/await for non-blocking JWT verification.",
        concepts: [
          { name: "async/await", explanation: "TypeScript's way of handling asynchronous operations." },
        ],
      });
      const result = parseLanguageLessonResponse(response);
      expect(result.languageNotes).toContain("async/await");
      expect(result.concepts).toHaveLength(1);
    });

    it("extracts JSON from code blocks", () => {
      const response = "```json\n" + JSON.stringify({
        languageNotes: "Uses generics.",
        concepts: [],
      }) + "\n```";
      const result = parseLanguageLessonResponse(response);
      expect(result.languageNotes).toContain("generics");
    });

    it("returns empty result for invalid response", () => {
      const result = parseLanguageLessonResponse("not json");
      expect(result.languageNotes).toBe("");
      expect(result.concepts).toEqual([]);
    });
  });

  describe("detectLanguageConcepts", () => {
    it("detects async patterns from tags", () => {
      const concepts = detectLanguageConcepts(sampleNode, "typescript");
      expect(concepts).toContain("async/await");
    });

    it("detects middleware pattern", () => {
      const node: GraphNode = {
        ...sampleNode,
        tags: ["middleware", "express"],
        summary: "Express middleware that validates requests",
      };
      const concepts = detectLanguageConcepts(node, "typescript");
      expect(concepts).toContain("middleware pattern");
    });

    it("returns empty for nodes with no detectable concepts", () => {
      const node: GraphNode = {
        ...sampleNode,
        tags: ["config"],
        summary: "Simple configuration file",
      };
      const concepts = detectLanguageConcepts(node, "typescript");
      expect(concepts.length).toBeLessThanOrEqual(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/language-lesson.test.ts
```

**Step 3: Implement language-lesson.ts**

```typescript
// packages/core/src/analyzer/language-lesson.ts
import type { GraphNode, GraphEdge } from "../types.js";

export interface LanguageLessonResult {
  languageNotes: string;
  concepts: Array<{ name: string; explanation: string }>;
}

// Concept detection patterns — maps keywords/tags to concept names
const CONCEPT_PATTERNS: Record<string, string[]> = {
  "async/await": ["async", "await", "promise", "asynchronous"],
  "middleware pattern": ["middleware", "interceptor", "pipe"],
  "generics": ["generic", "type parameter", "template"],
  "decorators": ["decorator", "@", "annotation"],
  "dependency injection": ["inject", "provider", "container", "di"],
  "observer pattern": ["subscribe", "publish", "event", "observable", "listener"],
  "singleton": ["singleton", "instance", "shared client"],
  "type guards": ["type guard", "is", "narrowing", "discriminated union"],
  "higher-order functions": ["callback", "factory", "higher-order", "closure"],
  "error handling": ["try/catch", "error boundary", "exception", "Result type"],
  "streams": ["stream", "pipe", "transform", "readable", "writable"],
  "concurrency": ["goroutine", "channel", "thread", "worker", "mutex"],
};

/**
 * Detect language concepts likely used in a node based on tags and summary.
 */
export function detectLanguageConcepts(node: GraphNode, language: string): string[] {
  const text = [
    ...node.tags,
    node.summary.toLowerCase(),
    node.languageNotes?.toLowerCase() ?? "",
  ].join(" ");

  const detected: string[] = [];
  for (const [concept, keywords] of Object.entries(CONCEPT_PATTERNS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      detected.push(concept);
    }
  }

  return detected;
}

/**
 * Build an LLM prompt to generate language-specific lessons for a node.
 */
export function buildLanguageLessonPrompt(
  node: GraphNode,
  edges: GraphEdge[],
  language: string,
): string {
  const capitalLang = language.charAt(0).toUpperCase() + language.slice(1);
  const detectedConcepts = detectLanguageConcepts(node, language);

  const edgeContext = edges
    .map((e) => {
      const dir = e.source === node.id ? "->" : "<-";
      const other = e.source === node.id ? e.target : e.source;
      return `  ${dir} [${e.type}] ${other}`;
    })
    .join("\n");

  return [
    `You are a programming teacher. Explain the ${capitalLang} concepts used in this code component.`,
    `The reader may not know ${capitalLang} — explain concepts as if teaching them for the first time,`,
    `but in the context of THIS specific code, not abstractly.`,
    ``,
    `## Component`,
    `- Name: ${node.name}`,
    `- Type: ${node.type}`,
    `- File: ${node.filePath ?? "N/A"}`,
    `- Summary: ${node.summary}`,
    `- Tags: ${node.tags.join(", ")}`,
    ``,
    `## Relationships`,
    edgeContext || "  none",
    ``,
    detectedConcepts.length > 0
      ? `## Detected Concepts (explain these)\n${detectedConcepts.map((c) => `- ${c}`).join("\n")}`
      : `## Note\nIdentify and explain any ${capitalLang}-specific patterns used in this component.`,
    ``,
    `Return JSON:`,
    `\`\`\`json`,
    `{`,
    `  "languageNotes": "2-3 sentence summary of language concepts used here",`,
    `  "concepts": [`,
    `    { "name": "concept name", "explanation": "1-2 sentence explanation in context of this code" }`,
    `  ]`,
    `}`,
    `\`\`\``,
  ].join("\n");
}

/**
 * Parse the LLM response into a LanguageLessonResult.
 */
export function parseLanguageLessonResponse(response: string): LanguageLessonResult {
  let json = response;
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    json = codeBlockMatch[1];
  }

  try {
    const parsed = JSON.parse(json);
    return {
      languageNotes: typeof parsed.languageNotes === "string" ? parsed.languageNotes : "",
      concepts: Array.isArray(parsed.concepts)
        ? parsed.concepts.filter(
            (c: unknown): c is { name: string; explanation: string } =>
              typeof c === "object" &&
              c !== null &&
              typeof (c as Record<string, unknown>).name === "string" &&
              typeof (c as Record<string, unknown>).explanation === "string",
          )
        : [],
    };
  } catch {
    return { languageNotes: "", concepts: [] };
  }
}
```

**Step 4: Run tests**

```bash
cd packages/core && pnpm test -- --reporter verbose src/__tests__/language-lesson.test.ts
```

**Step 5: Add exports to index.ts**

```typescript
export {
  buildLanguageLessonPrompt,
  parseLanguageLessonResponse,
  detectLanguageConcepts,
  type LanguageLessonResult,
} from "./analyzer/language-lesson.js";
```

**Step 6: Build + full test suite**

```bash
cd packages/core && pnpm build && pnpm test
```

**Step 7: Commit**

```bash
git add packages/core/src/analyzer/language-lesson.ts packages/core/src/__tests__/language-lesson.test.ts packages/core/src/index.ts
git commit -m "feat(core): add language lesson prompt builder and concept detector"
```

---

## Task 6: Enhanced Language Lesson Display (Dashboard)

**Files:**
- Modify: `packages/dashboard/src/components/NodeInfo.tsx` (enhanced languageNotes display)
- Modify: `packages/dashboard/src/components/LearnPanel.tsx` (rich language lesson in tour)

**Context:** The `languageNotes` field on nodes and `languageLesson` on tour steps already exist in the data. NodeInfo currently shows `languageNotes` as plain text in a blue box. This task upgrades both displays: NodeInfo gets a collapsible "Language Concepts" section with detected concept pills, and LearnPanel's language lesson section gets a more structured layout with concept cards.

**Step 1: Enhance NodeInfo languageNotes display**

Replace the existing `languageNotes` section in `packages/dashboard/src/components/NodeInfo.tsx` with:

```tsx
{node.languageNotes && (
  <div className="mb-4">
    <button
      onClick={() => setLanguageExpanded(!languageExpanded)}
      className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2 hover:text-indigo-300 transition-colors"
    >
      <svg
        className={`w-3 h-3 transition-transform ${languageExpanded ? "rotate-90" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      Language Concepts
    </button>
    {languageExpanded && (
      <div className="bg-indigo-900/30 border border-indigo-700/50 rounded-lg p-3">
        <p className="text-sm text-indigo-200 leading-relaxed">
          {node.languageNotes}
        </p>
      </div>
    )}
  </div>
)}
```

Add `const [languageExpanded, setLanguageExpanded] = useState(true);` at the top of the component.

**Step 2: Enhance LearnPanel language lesson display**

The `languageLesson` section in LearnPanel is already created in Task 2. Make sure it matches this enhanced styling with an icon and visual distinction. No changes needed if Task 2 was implemented correctly.

**Step 3: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm build
```

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/NodeInfo.tsx packages/dashboard/src/components/LearnPanel.tsx
git commit -m "feat(dashboard): enhance language lesson display with collapsible sections"
```

---

## Task 7: Persona Mode System (Dashboard)

**Files:**
- Create: `packages/dashboard/src/components/PersonaSelector.tsx`
- Modify: `packages/dashboard/src/store.ts` (add persona state)
- Modify: `packages/dashboard/src/App.tsx` (persona-adaptive layout)
- Modify: `packages/dashboard/src/components/GraphView.tsx` (filter nodes by persona)

**Context:** The design doc specifies three persona modes that change what the dashboard shows. This is the largest task in Phase 3, as it affects the layout, node filtering, and panel visibility. The three modes are:

1. **Non-technical** — Hide CodeViewer, show only concept + module nodes in graph, expand LearnPanel to full right side. For PMs, designers, stakeholders.
2. **Junior dev** — Full 4-panel layout with LearnPanel prominent (instead of NodeInfo). Show all nodes with complexity indicators. For developers learning the codebase.
3. **Experienced dev** — Full 4-panel layout with CodeViewer and ChatPanel prominent, NodeInfo instead of LearnPanel. For senior devs doing deep dives.

**Step 1: Add persona state to the store**

In `packages/dashboard/src/store.ts`:

```typescript
// Add to interface
persona: "non-technical" | "junior" | "experienced";
setPersona: (persona: "non-technical" | "junior" | "experienced") => void;

// Add to implementation
persona: "junior", // sensible default
setPersona: (persona) => set({ persona }),
```

**Step 2: Create PersonaSelector component**

```tsx
// packages/dashboard/src/components/PersonaSelector.tsx
import { useDashboardStore } from "../store";

const personas = [
  {
    id: "non-technical" as const,
    label: "Overview",
    description: "High-level architecture view",
  },
  {
    id: "junior" as const,
    label: "Learn",
    description: "Full dashboard with guided learning",
  },
  {
    id: "experienced" as const,
    label: "Deep Dive",
    description: "Code-focused with chat",
  },
];

export default function PersonaSelector() {
  const persona = useDashboardStore((s) => s.persona);
  const setPersona = useDashboardStore((s) => s.setPersona);

  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
      {personas.map((p) => (
        <button
          key={p.id}
          onClick={() => setPersona(p.id)}
          title={p.description}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            persona === p.id
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-300 hover:bg-gray-700"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Add PersonaSelector to App.tsx header**

Import `PersonaSelector` and add it to the header bar, between the project info and search.

**Step 4: Make App.tsx layout persona-adaptive**

The 4-panel grid changes based on persona:

```tsx
const persona = useDashboardStore((s) => s.persona);
const tourActive = useDashboardStore((s) => s.tourActive);

// Non-technical: 2-column layout (graph + learn panel, no code viewer)
// Junior: 4-panel with LearnPanel in bottom-right
// Experienced: 4-panel with NodeInfo in bottom-right

{persona === "non-technical" ? (
  <div className="flex-1 grid grid-cols-2 gap-1 p-1 min-h-0">
    <div className="min-h-0 min-w-0">
      <GraphView />
    </div>
    <div className="min-h-0 min-w-0 flex flex-col gap-1">
      <div className="flex-1 min-h-0">
        <LearnPanel />
      </div>
      <div className="flex-1 min-h-0">
        <ChatPanel />
      </div>
    </div>
  </div>
) : (
  <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-1 p-1 min-h-0">
    <div className="min-h-0 min-w-0">
      <GraphView />
    </div>
    <div className="min-h-0 min-w-0">
      <CodeViewer />
    </div>
    <div className="min-h-0 min-w-0">
      <ChatPanel />
    </div>
    <div className="min-h-0 min-w-0">
      {persona === "junior" || tourActive ? <LearnPanel /> : <NodeInfo />}
    </div>
  </div>
)}
```

**Step 5: Filter graph nodes by persona in GraphView**

In `packages/dashboard/src/components/GraphView.tsx`, add persona-based node filtering:

```typescript
const persona = useDashboardStore((s) => s.persona);

// Inside the useMemo, after creating flowNodes:
const filteredGraphNodes = persona === "non-technical"
  ? graph.nodes.filter((n) => n.type === "concept" || n.type === "module" || n.type === "file")
  : graph.nodes;

// Use filteredGraphNodes instead of graph.nodes for building flowNodes
```

For non-technical mode, only show concept, module, and file-level nodes (skip function/class for simplicity). Also filter edges to only include those where both source and target are in the filtered set.

**Step 6: Verify dashboard compiles**

```bash
cd packages/dashboard && pnpm build
```

**Step 7: Commit**

```bash
git add packages/dashboard/src/components/PersonaSelector.tsx packages/dashboard/src/store.ts packages/dashboard/src/App.tsx packages/dashboard/src/components/GraphView.tsx
git commit -m "feat(dashboard): add persona mode system (Overview / Learn / Deep Dive)"
```

---

## Verification Checklist

After all tasks are complete:

1. `cd packages/core && pnpm build && pnpm test` — all tests pass (existing 92 + new ~20)
2. `cd packages/dashboard && pnpm build` — compiles without errors
3. `pnpm dev:dashboard` — tour works end-to-end with sample data:
   - Start Tour button appears in bottom-right
   - Steps navigate with Prev/Next
   - Graph nodes highlight per step
   - Language lessons display in tour steps
4. Persona selector in header switches layouts correctly:
   - Non-technical: 2-column, no CodeViewer, only high-level nodes
   - Junior/Learn: 4-panel with LearnPanel
   - Experienced/Deep Dive: 4-panel with NodeInfo
5. "Explain This" button on NodeInfo generates contextual explanation via Claude API
6. All existing Phase 1 + Phase 2 features still work (search, chat, layers, dagre layout)
