// src/utils/__tests__/visibleEdges.test.ts
import { it, expect } from "vitest";
import { aggregateVisibleEdges } from "../visibleEdges";

it("re-routes endpoints to visible atoms and counts", () => {
  const v = new Map([["f1","container:pages"],["c1","container:components"],["c2","container:components"]]);
  const edges = [
    { source:"f1", target:"c1", type:"imports" },
    { source:"f1", target:"c2", type:"imports" },
  ] as any;
  const out = aggregateVisibleEdges(edges, v);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ source:"container:pages", target:"container:components", count:2 });
  expect(out[0].types).toEqual(["imports"]);
});

it("drops self-pairs and unmapped endpoints", () => {
  const v = new Map([["a","container:x"],["b","container:x"]]);
  const edges = [{source:"a",target:"b",type:"x"},{source:"a",target:"ghost",type:"y"}] as any;
  expect(aggregateVisibleEdges(edges, v)).toEqual([]);
});

it("collects distinct types across aggregated edges", () => {
  const v = new Map([["a","A"],["b","B"]]);
  const edges = [{source:"a",target:"b",type:"imports"},{source:"a",target:"b",type:"calls"},{source:"a",target:"b",type:"imports"}] as any;
  const out = aggregateVisibleEdges(edges, v);
  expect(out).toHaveLength(1);
  expect(out[0].count).toBe(3);
  expect(out[0].types.sort()).toEqual(["calls","imports"]);
});
