import { describe, it, expect } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";

describe("dependency smoke test", () => {
  it("imports elkjs", () => {
    expect(typeof ELK).toBe("function");
  });

  it("imports graphology", () => {
    const g = new Graph();
    g.addNode("a");
    expect(g.order).toBe(1);
  });

  it("imports graphology-communities-louvain", () => {
    expect(typeof louvain).toBe("function");
  });
});
