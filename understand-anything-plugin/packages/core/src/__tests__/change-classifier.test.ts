import { describe, it, expect } from "vitest";
import { classifyUpdate } from "../change-classifier.js";
import type { ChangeAnalysis } from "../fingerprint.js";

function makeAnalysis(overrides: Partial<ChangeAnalysis> = {}): ChangeAnalysis {
  return {
    fileChanges: [],
    newFiles: [],
    deletedFiles: [],
    structurallyChangedFiles: [],
    cosmeticOnlyFiles: [],
    unchangedFiles: [],
    ...overrides,
  };
}

describe("classifyUpdate", () => {
  it("returns SKIP when all files are unchanged", () => {
    const analysis = makeAnalysis({
      unchangedFiles: ["src/a.ts", "src/b.ts"],
    });

    const decision = classifyUpdate(analysis, 50);

    expect(decision.action).toBe("SKIP");
    expect(decision.filesToReanalyze).toHaveLength(0);
    expect(decision.rerunArchitecture).toBe(false);
    expect(decision.rerunTour).toBe(false);
  });

  it("returns SKIP when all changes are cosmetic", () => {
    const analysis = makeAnalysis({
      cosmeticOnlyFiles: ["src/a.ts", "src/b.ts"],
    });

    const decision = classifyUpdate(analysis, 50);

    expect(decision.action).toBe("SKIP");
    expect(decision.reason).toContain("cosmetic-only");
  });

  it("returns PARTIAL_UPDATE for a few structural changes", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/a.ts", "src/b.ts"],
      newFiles: ["src/c.ts"],
      cosmeticOnlyFiles: ["src/d.ts"],
    });

    // src/ already exists in the project, so adding src/c.ts is not a directory change
    const allKnownFiles = ["src/a.ts", "src/b.ts", "src/d.ts", "lib/util.ts"];
    const decision = classifyUpdate(analysis, 50, allKnownFiles);

    expect(decision.action).toBe("PARTIAL_UPDATE");
    expect(decision.filesToReanalyze).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(decision.rerunArchitecture).toBe(false);
    expect(decision.rerunTour).toBe(false);
  });

  it("returns ARCHITECTURE_UPDATE when >10 structural files", () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    const analysis = makeAnalysis({
      structurallyChangedFiles: files,
    });

    const decision = classifyUpdate(analysis, 50);

    expect(decision.action).toBe("ARCHITECTURE_UPDATE");
    expect(decision.rerunArchitecture).toBe(true);
    expect(decision.rerunTour).toBe(true);
  });

  it("returns ARCHITECTURE_UPDATE when new directories appear", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/existing.ts"],
      newFiles: ["newdir/file.ts"],
    });

    const allKnownFiles = ["src/existing.ts", "src/other.ts", "lib/util.ts"];
    const decision = classifyUpdate(analysis, 50, allKnownFiles);

    expect(decision.action).toBe("ARCHITECTURE_UPDATE");
    expect(decision.rerunArchitecture).toBe(true);
  });

  it("returns ARCHITECTURE_UPDATE when directories are deleted", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/existing.ts"],
      deletedFiles: ["olddir/removed.ts"],
    });

    const allKnownFiles = ["src/existing.ts", "src/other.ts"];
    const decision = classifyUpdate(analysis, 50, allKnownFiles);

    expect(decision.action).toBe("ARCHITECTURE_UPDATE");
    expect(decision.rerunArchitecture).toBe(true);
  });

  it("does NOT trigger ARCHITECTURE_UPDATE for new file in existing directory", () => {
    const analysis = makeAnalysis({
      newFiles: ["src/newfile.ts"],
    });

    // src/ is already known via other files in the project
    const allKnownFiles = ["src/a.ts", "src/b.ts", "lib/util.ts"];
    const decision = classifyUpdate(analysis, 50, allKnownFiles);

    expect(decision.action).toBe("PARTIAL_UPDATE");
    expect(decision.rerunArchitecture).toBe(false);
  });

  it("triggers ARCHITECTURE_UPDATE for new file in genuinely new directory", () => {
    const analysis = makeAnalysis({
      newFiles: ["brand-new-pkg/index.ts"],
    });

    // allKnownFiles only contains src/ and lib/ — no brand-new-pkg/
    const allKnownFiles = ["src/a.ts", "src/b.ts", "lib/util.ts"];
    const decision = classifyUpdate(analysis, 50, allKnownFiles);

    expect(decision.action).toBe("ARCHITECTURE_UPDATE");
    expect(decision.rerunArchitecture).toBe(true);
  });

  it("returns FULL_UPDATE when >30 structural files", () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`);
    const analysis = makeAnalysis({
      structurallyChangedFiles: files,
    });

    const decision = classifyUpdate(analysis, 100);

    expect(decision.action).toBe("FULL_UPDATE");
    expect(decision.rerunArchitecture).toBe(true);
    expect(decision.rerunTour).toBe(true);
  });

  it("returns FULL_UPDATE when >50% of project is structurally changed", () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/file${i}.ts`);
    const analysis = makeAnalysis({
      structurallyChangedFiles: files,
    });

    // 6 out of 10 files = 60%
    const decision = classifyUpdate(analysis, 10);

    expect(decision.action).toBe("FULL_UPDATE");
  });

  it("includes new and structural files in filesToReanalyze for PARTIAL", () => {
    const analysis = makeAnalysis({
      structurallyChangedFiles: ["src/modified.ts"],
      newFiles: ["src/added.ts"],
      deletedFiles: ["src/removed.ts"],
    });

    const decision = classifyUpdate(analysis, 50);

    expect(decision.filesToReanalyze).toContain("src/modified.ts");
    expect(decision.filesToReanalyze).toContain("src/added.ts");
    // Deleted files shouldn't be re-analyzed
    expect(decision.filesToReanalyze).not.toContain("src/removed.ts");
  });

  it("handles empty analysis (no changes at all)", () => {
    const analysis = makeAnalysis();
    const decision = classifyUpdate(analysis, 50);

    expect(decision.action).toBe("SKIP");
    expect(decision.reason).toContain("No changes detected");
  });

  it("counts deleted files toward structural total", () => {
    // 8 structural + 3 deleted = 11 total structural > 10 threshold
    const analysis = makeAnalysis({
      structurallyChangedFiles: Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`),
      deletedFiles: ["src/old1.ts", "src/old2.ts", "src/old3.ts"],
    });

    const decision = classifyUpdate(analysis, 50);

    expect(decision.action).toBe("ARCHITECTURE_UPDATE");
  });
});
