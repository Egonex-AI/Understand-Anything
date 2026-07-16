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
