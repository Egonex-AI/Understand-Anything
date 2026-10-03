import { beforeEach, describe, expect, it } from "vitest";
import type { GraphNode, KnowledgeGraph, TourStep } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";

function node(id: string): GraphNode {
  return { id, type: "file", name: id, summary: "", tags: [], complexity: "simple" };
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
    nodes: [node("a1"), node("b1")],
    edges: [],
    layers: [
      { id: "layer:a", name: "A", description: "", nodeIds: ["a1"] },
      { id: "layer:b", name: "B", description: "", nodeIds: ["b1"] },
    ],
    tour: [{ order: 1, title: "Built-in", description: "", nodeIds: ["a1"] }],
  };
}

const custom: TourStep[] = [
  { order: 2, title: "Second", description: "note 2", nodeIds: ["a1"] },
  { order: 1, title: "First", description: "note 1", nodeIds: ["b1"] },
];

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
  useDashboardStore.getState().setGraph(graph());
});

describe("custom tours", () => {
  it("plays custom steps in order through the regular tour actions", () => {
    const st = useDashboardStore.getState;
    st().startCustomTour(custom);
    expect(st().tourActive).toBe(true);
    expect(st().customTour?.map((s) => s.title)).toEqual(["First", "Second"]);
    expect(st().tourHighlightedNodeIds).toEqual(["b1"]);
    expect(st().activeLayerId).toBe("layer:b");

    st().nextTourStep();
    expect(st().currentTourStep).toBe(1);
    expect(st().tourHighlightedNodeIds).toEqual(["a1"]);
    expect(st().activeLayerId).toBe("layer:a");
    st().nextTourStep(); // already last
    expect(st().currentTourStep).toBe(1);

    st().prevTourStep();
    expect(st().tourHighlightedNodeIds).toEqual(["b1"]);
    st().setTourStep(1);
    expect(st().tourHighlightedNodeIds).toEqual(["a1"]);
  });

  it("stopTour clears the custom tour; startTour plays the graph's own tour", () => {
    const st = useDashboardStore.getState;
    st().startCustomTour(custom);
    st().stopTour();
    expect(st().tourActive).toBe(false);
    expect(st().customTour).toBeNull();
    expect(st().tourHighlightedNodeIds).toEqual([]);

    st().startCustomTour(custom);
    st().startTour();
    expect(st().customTour).toBeNull();
    expect(st().tourHighlightedNodeIds).toEqual(["a1"]);
  });

  it("ignores an empty custom tour and works without a graph tour", () => {
    const st = useDashboardStore.getState;
    st().startCustomTour([]);
    expect(st().tourActive).toBe(false);
    st().setGraph({ ...graph(), tour: [] });
    st().startCustomTour(custom);
    st().nextTourStep();
    expect(st().currentTourStep).toBe(1);
  });
});
