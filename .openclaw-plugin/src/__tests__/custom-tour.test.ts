import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core";
import { generateCustomTour } from "../custom-tour.js";
import type { LlmCaller } from "../llm.js";

function makeGraph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "p", languages: ["typescript"], frameworks: [], description: "d", analyzedAt: new Date(0).toISOString(), gitCommitHash: "x" },
    nodes: [
      { id: "file:auth.ts", type: "file", name: "auth.ts", filePath: "auth.ts", summary: "Handles login.", tags: [], complexity: "moderate" },
      { id: "file:session.ts", type: "file", name: "session.ts", filePath: "session.ts", summary: "Session tokens.", tags: [], complexity: "simple" },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

describe("generateCustomTour", () => {
  it("rejects an empty node selection without calling the LLM", async () => {
    const stubLlm: LlmCaller = async () => {
      throw new Error("should not be called");
    };
    const result = await generateCustomTour(makeGraph(), [], "explain auth", stubLlm);
    expect(result.steps).toEqual([]);
    expect(result.error).toMatch(/no nodes selected/i);
  });

  it("rejects an empty prompt without calling the LLM", async () => {
    const stubLlm: LlmCaller = async () => {
      throw new Error("should not be called");
    };
    const result = await generateCustomTour(makeGraph(), ["file:auth.ts"], "  ", stubLlm);
    expect(result.error).toMatch(/prompt is empty/i);
  });

  it("rejects node ids that don't exist in the graph", async () => {
    const stubLlm: LlmCaller = async () => {
      throw new Error("should not be called");
    };
    const result = await generateCustomTour(makeGraph(), ["file:does-not-exist.ts"], "explain this", stubLlm);
    expect(result.error).toMatch(/none.*found/i);
  });

  it("grounds the prompt in only the selected nodes and returns parsed steps", async () => {
    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return JSON.stringify({
        steps: [{ order: 1, title: "Auth flow", description: "Login then session.", nodeIds: ["file:auth.ts", "file:session.ts"] }],
      });
    };

    const result = await generateCustomTour(makeGraph(), ["file:auth.ts", "file:session.ts"], "walk me through the auth flow", stubLlm);

    expect(capturedPrompt).toContain("walk me through the auth flow");
    expect(capturedPrompt).toContain("file:auth.ts");
    expect(result.error).toBeUndefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].nodeIds).toEqual(["file:auth.ts", "file:session.ts"]);
  });
});
