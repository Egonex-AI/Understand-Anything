import { beforeEach, describe, expect, it } from "vitest";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";

function node(id: string): GraphNode {
  return {
    id,
    type: "file",
    name: id,
    summary: "",
    tags: [],
    complexity: "simple",
  };
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
    nodes: [node("a1"), node("a2"), node("b1"), node("b2")],
    edges: [],
    layers: [
      { id: "layer:a", name: "A", description: "", nodeIds: ["a1", "a2"] },
      { id: "layer:b", name: "B", description: "", nodeIds: ["b1", "b2"] },
    ],
    tour: [],
  };
}

function seedContainerState(): void {
  useDashboardStore.getState().expandContainer("container:cluster-0");
  useDashboardStore.getState().setPendingFocusContainer("container:cluster-0");
  useDashboardStore.getState().setContainerLayout(
    "container:cluster-0",
    new Map([["a1", { x: 10, y: 20 }]]),
    { width: 200, height: 120 },
  );
}

function expectContainerStateCleared(): void {
  const state = useDashboardStore.getState();
  expect(state.containerLayoutCache.size).toBe(0);
  expect(state.containerSizeMemory.size).toBe(0);
  expect(state.expandedContainers.size).toBe(0);
  expect(state.pendingFocusContainer).toBeNull();
}

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
});

describe("store layer navigation container cache resets", () => {
  it("clears container state when navigateToNodeInLayer crosses layers", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().navigateToNodeInLayer("a1");
    seedContainerState();

    useDashboardStore.getState().navigateToNodeInLayer("b1");

    expect(useDashboardStore.getState().activeLayerId).toBe("layer:b");
    expectContainerStateCleared();
  });

  it("preserves container state when navigateToNodeInLayer stays in the same layer", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().navigateToNodeInLayer("a1");
    seedContainerState();

    useDashboardStore.getState().navigateToNodeInLayer("a2");

    const state = useDashboardStore.getState();
    expect(state.activeLayerId).toBe("layer:a");
    expect(state.containerLayoutCache.size).toBe(1);
    expect(state.containerSizeMemory.size).toBe(1);
    expect(state.expandedContainers.has("container:cluster-0")).toBe(true);
    expect(state.pendingFocusContainer).toBe("container:cluster-0");
  });

  it("clears container state when navigateToHistoryIndex crosses layers", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().navigateToNodeInLayer("b1");
    useDashboardStore.getState().navigateToNodeInLayer("a1");
    seedContainerState();

    useDashboardStore.getState().navigateToHistoryIndex(0);

    expect(useDashboardStore.getState().activeLayerId).toBe("layer:b");
    expectContainerStateCleared();
  });

  it("clears container state when goBackNode crosses layers", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().navigateToNodeInLayer("b1");
    useDashboardStore.getState().navigateToNodeInLayer("a1");
    seedContainerState();

    useDashboardStore.getState().goBackNode();

    expect(useDashboardStore.getState().activeLayerId).toBe("layer:b");
    expectContainerStateCleared();
  });
});
