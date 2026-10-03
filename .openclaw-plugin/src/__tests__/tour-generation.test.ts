import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core";
import { generateModuleTour, rankNodesForReview, generateCodeReviewTour } from "../tour-generation.js";
import type { LlmCaller } from "../llm.js";

function makeGraph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "p", languages: ["typescript"], frameworks: [], description: "d", analyzedAt: new Date(0).toISOString(), gitCommitHash: "x" },
    nodes: [
      { id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", summary: "Simple entry point.", tags: [], complexity: "simple" },
      { id: "file:core.ts", type: "file", name: "core.ts", filePath: "core.ts", summary: "Complex core logic everything depends on.", tags: [], complexity: "complex" },
      { id: "file:leaf.ts", type: "file", name: "leaf.ts", filePath: "leaf.ts", summary: "Isolated leaf utility.", tags: [], complexity: "simple" },
    ],
    edges: [
      { source: "file:a.ts", target: "file:core.ts", type: "imports", direction: "forward", weight: 0.7 },
      { source: "file:leaf.ts", target: "file:core.ts", type: "imports", direction: "forward", weight: 0.7 },
    ],
    layers: [],
    tour: [],
  };
}

describe("generateModuleTour", () => {
  it("produces a non-empty, ordered tour for a graph with edges", () => {
    const tour = generateModuleTour(makeGraph());
    expect(tour.length).toBeGreaterThan(0);
    expect(tour[0].order).toBe(1);
  });
});

describe("rankNodesForReview", () => {
  it("ranks the complex, highly-connected node above simple/isolated ones", () => {
    const ranked = rankNodesForReview(makeGraph());
    expect(ranked[0].id).toBe("file:core.ts");
  });

  it("respects the limit parameter", () => {
    const ranked = rankNodesForReview(makeGraph(), 1);
    expect(ranked).toHaveLength(1);
  });
});

describe("generateCodeReviewTour", () => {
  it("returns an empty array when the graph has no code nodes", async () => {
    const emptyGraph: KnowledgeGraph = { ...makeGraph(), nodes: [] };
    const stubLlm: LlmCaller = async () => {
      throw new Error("should not be called");
    };
    const tour = await generateCodeReviewTour(emptyGraph, stubLlm);
    expect(tour).toEqual([]);
  });

  it("grounds the prompt in the ranked nodes and parses the LLM's step response", async () => {
    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return JSON.stringify({
        steps: [{ order: 1, title: "Start with core.ts", description: "Central and complex.", nodeIds: ["file:core.ts"] }],
      });
    };

    const tour = await generateCodeReviewTour(makeGraph(), stubLlm);

    expect(capturedPrompt).toContain("file:core.ts");
    expect(tour).toHaveLength(1);
    expect(tour[0].title).toBe("Start with core.ts");
    expect(tour[0].nodeIds).toEqual(["file:core.ts"]);
  });
});
