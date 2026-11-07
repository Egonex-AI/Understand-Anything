import { describe, it, expect } from "vitest";
import { normalizeGraph } from "../schema.js";

describe("edge alias direction", () => {
  it.each([
    ["documented_by", "documents", "b", "a"],
    ["written_by", "authored_by", "a", "b"],
    ["created_by", "authored_by", "a", "b"],
    ["example_of", "exemplifies", "a", "b"],
  ])("normalizes %s without changing its meaning", (alias, type, source, target) => {
    const edge = { type: alias, source: "a", target: "b", weight: 0.8 };
    expect(normalizeGraph({ edges: [edge] })).toEqual({
      edges: [{ ...edge, type, source, target }],
    });
  });
});
