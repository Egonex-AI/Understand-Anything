import { afterEach, describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@understand-anything/core/types";
import {
  filterStructuralGraph,
  inheritContainedNodeLayers,
} from "../GraphView";
import {
  ALL_COMPLEXITIES,
  ALL_EDGE_CATEGORIES,
  ALL_NODE_TYPES,
  useDashboardStore,
} from "../../store";
import type { EdgeCategory, FilterState, NodeCategory, NodeType } from "../../store";

const categories: Record<NodeCategory, boolean> = {
  code: true, config: true, docs: true, infra: true,
  data: true, domain: true, knowledge: true,
};

function node(id: string, type: NodeType = "file", complexity = "simple"): GraphNode {
  return { id, name: id, type, summary: "", tags: [], complexity } as GraphNode;
}
function edge(source: string, target: string, type = "imports"): GraphEdge {
  return { source, target, type } as GraphEdge;
}
function filterState(overrides: Partial<FilterState> = {}): FilterState {
  return {
    nodeTypes: new Set(ALL_NODE_TYPES),
    complexities: new Set(ALL_COMPLEXITIES),
    layerIds: new Set<string>(),
    edgeCategories: new Set(ALL_EDGE_CATEGORIES),
    ...overrides,
  };
}

const membership = new Map([
  ["a", new Set(["L1"])],
  ["b", new Set(["L2"])],
  ["c", new Set(["L1", "L2"])],
]);

describe("structural canvas filters (#778)", () => {
  it("preserves nodes and edges with default filters", () => {
    const out = filterStructuralGraph(
      [node("a"), node("b")], [edge("a", "b")], membership,
      filterState(), categories,
    );
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(out.edges).toHaveLength(1);
  });

  it("combines Filter panel node types and header categories (AND)", () => {
    const nodes = [node("a", "file"), node("b", "service"), node("c", "table")];
    const chosen = filterState({ nodeTypes: new Set<NodeType>(["file", "service"]) });
    const out = filterStructuralGraph(nodes, [], membership, chosen, categories);
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    const withoutInfrastructure = filterStructuralGraph(
      nodes, [], membership, chosen, { ...categories, infra: false },
    );
    expect(withoutInfrastructure.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("filters both edges and nodes by complexity and edge category", () => {
    const nodes = [node("a", "file", "complex"), node("b", "file", "complex"),
      node("c", "file", "simple")];
    const edges = [edge("a", "b", "imports"), edge("a", "b", "calls"),
      edge("a", "c", "imports")];
    const chosen = filterState({
      complexities: new Set(["complex"]),
      edgeCategories: new Set<EdgeCategory>(["structural"]),
    });
    const out = filterStructuralGraph(nodes, edges, membership, chosen, categories);
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(out.edges).toEqual([edge("a", "b", "imports")]);
  });

  it("uses any-layer-wins membership for multi-layer nodes", () => {
    const out = filterStructuralGraph(
      [node("a"), node("b"), node("c")],
      [edge("a", "b"), edge("c", "b")],
      membership, filterState({ layerIds: new Set(["L2"]) }), categories,
    );
    expect(out.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(out.edges).toEqual([edge("c", "b")]);
  });

  it("inherits parent file layers for class-view children without mutating the index", () => {
    const indexed = new Map([["a", new Set(["L1", "L2"])]]);
    const inherited = inheritContainedNodeLayers(
      indexed, [edge("a", "child", "contains")],
      new Set(["a"]), new Set(["a", "child"]),
    );
    expect([...inherited.get("child")!].sort()).toEqual(["L1", "L2"]);
    expect(indexed.has("child")).toBe(false);
    const out = filterStructuralGraph(
      [node("a"), node("child", "class")],
      [edge("a", "child", "contains")],
      inherited, filterState({ layerIds: new Set(["L2"]) }), categories,
    );
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "child"]);
  });
});

describe("filter changes invalidate structural layout caches (#778)", () => {
  afterEach(() => useDashboardStore.getState().resetFilters());

  function putStaleContainer() {
    useDashboardStore.setState({
      containerLayoutCache: new Map([["container", {
        childPositions: new Map(),
        actualSize: { width: 100, height: 100 },
      }]]),
      containerSizeMemory: new Map([["container", { width: 100, height: 100 }]]),
      expandedContainers: new Set(["container"]),
      pendingFocusContainer: "container",
    });
  }

  it("clears stale positions when changing a filter", () => {
    putStaleContainer();
    useDashboardStore.getState().setFilters({ nodeTypes: new Set<NodeType>(["file"]) });
    const s = useDashboardStore.getState();
    expect(s.containerLayoutCache.size).toBe(0);
    expect(s.containerSizeMemory.size).toBe(0);
    expect(s.expandedContainers.size).toBe(0);
    expect(s.pendingFocusContainer).toBeNull();
  });

  it("clears stale positions when resetting filters", () => {
    putStaleContainer();
    useDashboardStore.getState().resetFilters();
    const s = useDashboardStore.getState();
    expect(s.containerLayoutCache.size).toBe(0);
    expect(s.containerSizeMemory.size).toBe(0);
    expect(s.expandedContainers.size).toBe(0);
    expect(s.pendingFocusContainer).toBeNull();
  });
});
