import { describe, it, expect } from "vitest";
import { aggregateEdges } from "../ancestorEdges";

it("lifts endpoints to nearest visible ancestor and dedupes", () => {
  const nodeToPath = new Map([
    ["a", "container:Pricing/UI/api"], ["b", "container:Bridge"],
  ]);
  const visible = ["container:Pricing", "container:Bridge"];
  const out = aggregateEdges(
    [{ source: "a", target: "b", type: "calls", direction: "forward", weight: 0.8 } as any],
    nodeToPath, visible,
  );
  expect(out).toEqual([{ source: "container:Pricing", target: "container:Bridge", count: 1 }]);
});

it("drops edges whose endpoints resolve to the same visible ancestor", () => {
  const nodeToPath = new Map([["a", "container:Pricing/UI"], ["b", "container:Pricing/Service"]]);
  const out = aggregateEdges([{ source: "a", target: "b", type: "calls", direction: "forward", weight: 0.5 } as any], nodeToPath, ["container:Pricing"]);
  expect(out).toEqual([]);
});
