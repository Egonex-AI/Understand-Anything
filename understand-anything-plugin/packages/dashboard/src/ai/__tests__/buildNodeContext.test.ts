import { describe, expect, it } from "vitest";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { buildNodeContext, buildSystemPrompt, sourceExcerpt } from "../buildNodeContext";

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type: "function", name: id, summary: `summary of ${id}`, tags: [], complexity: "simple", ...extra,
});

const graph: KnowledgeGraph = {
  version: "1",
  project: { name: "demo", languages: [], frameworks: [], description: "a demo", analyzedAt: "", gitCommitHash: "" },
  nodes: [node("login", { filePath: "src/auth.ts", lineRange: [3, 4] }), node("hash"), node("route")],
  edges: [
    { source: "login", target: "hash", type: "calls", direction: "forward", weight: 1 },
    { source: "route", target: "login", type: "calls", direction: "forward", weight: 1 },
  ],
  layers: [],
  tour: [],
};

describe("buildNodeContext", () => {
  it("includes the node, notes, relationships and numbered source", () => {
    const ctx = buildNodeContext({
      graph, node: graph.nodes[0], source: "a\nb\nfunction login() {\n}\n", userNote: "check rate limit", userTags: ["auth"], localeKey: "zh",
    });
    expect(ctx).toContain("# Node: login");
    expect(ctx).toContain("- file: src/auth.ts:3-4");
    expect(ctx).toContain("- my tags: auth");
    expect(ctx).toContain("check rate limit");
    expect(ctx).toContain("→ calls function hash");
    expect(ctx).toContain("← calls function route");
    expect(ctx).toContain("    3  function login() {");
  });

  it("caps the source excerpt around the line range", () => {
    const source = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n");
    const { text, startLine, truncated } = sourceExcerpt(source, [1000, 1010]);
    expect(startLine).toBe(985);
    expect(text).toContain(" 1025  line 1025");
    expect(text).not.toContain("line 1026");
    expect(truncated).toBe(true);
  });

  it("asks for the dashboard's language", () => {
    expect(buildSystemPrompt("ja")).toContain("Answer in Japanese");
  });
});
