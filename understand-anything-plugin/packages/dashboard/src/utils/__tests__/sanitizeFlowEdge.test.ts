import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import {
  isInvalidHandleValue,
  sanitizeFlowEdge,
  sanitizeFlowEdges,
} from "../sanitizeFlowEdge";

describe("isInvalidHandleValue", () => {
  it.each([
    ["null literal", null],
    ["undefined", undefined],
    ['string "null"', "null"],
    ['string "undefined"', "undefined"],
    ["empty string", ""],
  ])("flags %s as invalid", (_label, value) => {
    expect(isInvalidHandleValue(value)).toBe(true);
  });

  it.each([
    ["a real handle id", "top"],
    ["a numeric-ish handle id", "0"],
    ["a number", 1],
  ])("keeps %s as valid", (_label, value) => {
    expect(isInvalidHandleValue(value)).toBe(false);
  });
});

describe("sanitizeFlowEdge", () => {
  const base: Edge = { id: "e-35", source: "n1", target: "n2" };

  it("returns the original edge when no handle fields are present", () => {
    const result = sanitizeFlowEdge(base);
    expect(result).toBe(base);
  });

  it('strips a sourceHandle set to the literal string "null"', () => {
    // Matches the exact scenario in issue #330 where React Flow logs
    // `Couldn't create edge for source handle id: "null", edge id: e-35.`
    // and then hangs trying to resolve the missing handle.
    const edge: Edge = { ...base, sourceHandle: "null" };
    const result = sanitizeFlowEdge(edge);
    expect(result).not.toBe(edge);
    expect("sourceHandle" in result).toBe(false);
    expect(result.id).toBe("e-35");
    expect(result.source).toBe("n1");
    expect(result.target).toBe("n2");
  });

  it("strips a sourceHandle set to the JS null value", () => {
    const edge = { ...base, sourceHandle: null } as unknown as Edge;
    const result = sanitizeFlowEdge(edge);
    expect("sourceHandle" in result).toBe(false);
  });

  it('strips a targetHandle set to "undefined"', () => {
    const edge: Edge = { ...base, targetHandle: "undefined" };
    const result = sanitizeFlowEdge(edge);
    expect("targetHandle" in result).toBe(false);
  });

  it("strips both source and target handles when both are invalid", () => {
    const edge: Edge = {
      ...base,
      sourceHandle: "null",
      targetHandle: null as unknown as string,
    };
    const result = sanitizeFlowEdge(edge);
    expect("sourceHandle" in result).toBe(false);
    expect("targetHandle" in result).toBe(false);
  });

  it("preserves a real sourceHandle id", () => {
    const edge: Edge = { ...base, sourceHandle: "right" };
    const result = sanitizeFlowEdge(edge);
    expect(result).toBe(edge);
    expect(result.sourceHandle).toBe("right");
  });

  it("strips an empty string sourceHandle", () => {
    // Empty string is treated as "no handle" so it should be stripped —
    // documents the chosen normalisation rule.
    const edge: Edge = { ...base, sourceHandle: "" };
    const result = sanitizeFlowEdge(edge);
    expect("sourceHandle" in result).toBe(false);
  });

  it("preserves other edge fields (style, label, animated)", () => {
    const edge: Edge = {
      ...base,
      sourceHandle: "null",
      label: "calls",
      animated: true,
      style: { stroke: "red" },
    };
    const result = sanitizeFlowEdge(edge);
    expect("sourceHandle" in result).toBe(false);
    expect(result.label).toBe("calls");
    expect(result.animated).toBe(true);
    expect(result.style).toEqual({ stroke: "red" });
  });
});

describe("sanitizeFlowEdges", () => {
  it("returns the original array reference when nothing needs cleaning", () => {
    const edges: Edge[] = [
      { id: "a", source: "1", target: "2" },
      { id: "b", source: "2", target: "3", sourceHandle: "right" },
    ];
    expect(sanitizeFlowEdges(edges)).toBe(edges);
  });

  it("returns a new array when any edge needed cleaning, leaving clean edges by reference", () => {
    const clean: Edge = { id: "a", source: "1", target: "2" };
    const dirty: Edge = { id: "b", source: "2", target: "3", sourceHandle: "null" };
    const input = [clean, dirty];
    const result = sanitizeFlowEdges(input);
    // New array because at least one edge was cleaned.
    expect(result).not.toBe(input);
    // Clean edges keep their original reference for memo stability.
    expect(result[0]).toBe(clean);
    // Dirty edge has the bogus handle field stripped.
    expect("sourceHandle" in result[1]).toBe(false);
    expect(result[1].id).toBe("b");
  });
});
