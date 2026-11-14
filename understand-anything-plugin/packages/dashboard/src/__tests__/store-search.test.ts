import { beforeEach, describe, expect, it } from "vitest";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";

function node(id: string, name: string, summary: string): GraphNode {
  return { id, type: "function", name, summary, tags: [], complexity: "simple" };
}

function graph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "2026-07-03T00:00:00.000Z",
      gitCommitHash: "test",
    },
    nodes: [
      node("fn:token", "issueSessionToken", "Creates a signed JWT for the authenticated user."),
      node("fn:chart", "renderBarChart", "Draws a bar chart with axis labels."),
      node("fn:mail", "sendWelcomeEmail", "Sends the onboarding email to a new customer."),
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

describe("dashboard search modes", () => {
  beforeEach(() => {
    useDashboardStore.setState({ searchQuery: "", searchResults: [], searchMode: "semantic" });
    useDashboardStore.getState().setGraph(graph());
  });

  it("defaults to semantic mode and builds both engines on setGraph", () => {
    const s = useDashboardStore.getState();
    expect(s.searchMode).toBe("semantic");
    expect(s.searchEngine).not.toBeNull();
    expect(s.hybridEngine).not.toBeNull();
  });

  it("semantic mode finds a node by concept and returns reasons", () => {
    useDashboardStore.getState().setSearchQuery("login");
    const { searchResults } = useDashboardStore.getState();
    expect(searchResults.map((r) => r.nodeId)).toContain("fn:token");
    const hit = searchResults.find((r) => r.nodeId === "fn:token")!;
    expect(hit.reasons?.length).toBeGreaterThan(0);
  });

  it("fuzzy mode keeps the original behaviour (no concept matching, no reasons)", () => {
    useDashboardStore.getState().setSearchMode("fuzzy");
    useDashboardStore.getState().setSearchQuery("login");
    const { searchResults } = useDashboardStore.getState();
    expect(searchResults.map((r) => r.nodeId)).not.toContain("fn:token");
    for (const r of searchResults) expect(r.reasons).toBeUndefined();
  });

  it("switching mode re-runs the current query", () => {
    useDashboardStore.getState().setSearchQuery("login");
    expect(useDashboardStore.getState().searchResults.length).toBeGreaterThan(0);
    useDashboardStore.getState().setSearchMode("fuzzy");
    expect(useDashboardStore.getState().searchResults.map((r) => r.nodeId)).not.toContain("fn:token");
    useDashboardStore.getState().setSearchMode("semantic");
    expect(useDashboardStore.getState().searchResults.map((r) => r.nodeId)).toContain("fn:token");
  });

  it("clears results for an empty query", () => {
    useDashboardStore.getState().setSearchQuery("login");
    useDashboardStore.getState().setSearchQuery("   ");
    expect(useDashboardStore.getState().searchResults).toEqual([]);
  });
});
