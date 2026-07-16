import { describe, expect, it } from "vitest";
import { computeForceLayout, type ForceLayoutNode } from "../force-layout";
import { createFallbackGrid } from "../force-layout-client";

const nodes: ForceLayoutNode[] = [
  { id: "alpha", width: 280, height: 120, community: 0 },
  { id: "__proto__", width: 300, height: 130, community: 0 },
  { id: "gamma", width: 260, height: 110, community: 1 },
];

describe("computeForceLayout", () => {
  it("returns no positions for an empty graph", () => {
    expect(computeForceLayout([], [])).toEqual([]);
  });

  it("returns one finite position per node and ignores dangling edges", () => {
    const positions = computeForceLayout(nodes, [
      { source: "alpha", target: "__proto__" },
      { source: "missing", target: "gamma" },
    ]);

    expect(positions.map((position) => position.id)).toEqual(
      nodes.map((node) => node.id),
    );
    for (const position of positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it("is deterministic for identical ordered inputs", () => {
    const edges = [
      { source: "alpha", target: "__proto__" },
      { source: "__proto__", target: "gamma" },
    ];

    expect(computeForceLayout(nodes, edges)).toEqual(
      computeForceLayout(nodes, edges),
    );
  });

  it("normalizes sparse community IDs before assigning cluster angles", () => {
    const denseNodes: ForceLayoutNode[] = Array.from({ length: 80 }, (_, index) => ({
      id: `node-${index}`,
      width: 80,
      height: 40,
      community: index % 2,
    }));
    const denseLayout = computeForceLayout(denseNodes, []);

    for (const [firstCommunity, secondCommunity] of [
      [0, 2],
      [10, 20],
    ] as const) {
      const sparseNodes = denseNodes.map((node, index) => ({
        ...node,
        community: index % 2 === 0 ? firstCommunity : secondCommunity,
      }));

      expect(computeForceLayout(sparseNodes, [])).toEqual(denseLayout);
    }
  });
});

describe("createFallbackGrid", () => {
  it("places every node on a finite, deterministic grid", () => {
    const first = createFallbackGrid(nodes);
    const second = createFallbackGrid(nodes);

    expect(first).toEqual(second);
    expect(first.map((position) => position.id)).toEqual(
      nodes.map((node) => node.id),
    );
    expect(new Set(first.map(({ x, y }) => `${x}:${y}`)).size).toBe(nodes.length);
  });
});
