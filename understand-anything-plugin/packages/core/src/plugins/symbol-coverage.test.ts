import { describe, it, expect } from "vitest";
import { structuralLineCoverage } from "./symbol-coverage.js";
import type { StructuralAnalysis } from "../types.js";

const base = (): StructuralAnalysis => ({ functions: [], classes: [], imports: [], exports: [] });

describe("structuralLineCoverage", () => {
  it("counts top-level segment lines toward coverage", () => {
    const structure: StructuralAnalysis = {
      ...base(),
      imports: [{ source: "os", specifiers: ["os"], lineNumber: 1 }],
      functions: [{ name: "main", lineRange: [3, 5], params: [] }],
      topLevel: [{ kind: "guard", lineRange: [7, 8], calls: ["main"] }],
    };
    expect(structuralLineCoverage(structure, 8)).toEqual({
      totalLines: 8, symbolLines: 4, topLevelLines: 2, coveredLines: 6, ratio: 6 / 8,
    });
  });

  it("does not double-count lines shared by a symbol and a segment", () => {
    const structure: StructuralAnalysis = {
      ...base(),
      exports: [{ name: "x", lineNumber: 2 }],
      topLevel: [{ kind: "config", lineRange: [1, 3], calls: [] }],
    };
    const result = structuralLineCoverage(structure, 3);
    expect(result.symbolLines).toBe(1);
    expect(result.topLevelLines).toBe(2);
    expect(result.coveredLines).toBe(3);
    expect(result.ratio).toBe(1);
  });

  it("is backward compatible when topLevel is absent and clamps out-of-range lines", () => {
    const structure: StructuralAnalysis = { ...base(), functions: [{ name: "f", lineRange: [0, 50], params: [] }] };
    expect(structuralLineCoverage(structure, 10)).toMatchObject({ symbolLines: 10, topLevelLines: 0, ratio: 1 });
  });

  it("reports ratio 1 for an empty file", () => {
    expect(structuralLineCoverage(base(), 0).ratio).toBe(1);
  });
});
