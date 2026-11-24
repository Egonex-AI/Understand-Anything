import { describe, expect, it, vi } from "vitest";
import { detectCommunities } from "../louvain";
import type { GraphEdge } from "@understand-anything/core/types";

function seededSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("detectCommunities", () => {
  it("returns the same partition across different Math.random seeds", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `n${i}`);
    const edges: GraphEdge[] = [];
    let lcgSeed = 0x12345678;
    const lcg = () => {
      lcgSeed = (Math.imul(lcgSeed, 1664525) + 1013904223) >>> 0;
      return lcgSeed / 0x100000000;
    };

    while (edges.length < 260) {
      const a = Math.floor(lcg() * ids.length);
      const b = Math.floor(lcg() * ids.length);
      if (a === b) continue;
      edges.push({
        source: ids[a],
        target: ids[b],
        type: "calls",
        direction: "bidirectional",
        weight: 1,
      } as GraphEdge);
    }

    const partitions: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const random = seededSequence(seed);
      vi.spyOn(Math, "random").mockImplementation(random);
      const detected = detectCommunities(ids, edges);
      partitions.push(
        [...ids].sort().map((id) => `${id}:${detected.get(id)}`).join("|"),
      );
      vi.restoreAllMocks();
    }

    expect(new Set(partitions).size).toBe(1);
  });
});
