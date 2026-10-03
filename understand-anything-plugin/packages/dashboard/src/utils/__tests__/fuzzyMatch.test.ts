import { describe, expect, it } from "vitest";
import { fuzzyScore } from "../fuzzyMatch";

describe("fuzzyScore", () => {
  it("matches subsequences case-insensitively", () => {
    expect(fuzzyScore("cv", "CodeViewer.tsx")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "CodeViewer.tsx")).toBe(-1);
  });

  it("prefers file-name and contiguous matches", () => {
    expect(fuzzyScore("store", "src/store.ts")).toBeGreaterThan(fuzzyScore("store", "src/s/t/o/r/e.ts"));
    expect(fuzzyScore("view", "src/components/CodeViewer.tsx")).toBeGreaterThan(
      fuzzyScore("view", "src/views/a/b/c/x.tsx"),
    );
  });

  it("treats an empty query as a neutral match", () => {
    expect(fuzzyScore("  ", "anything")).toBe(0);
  });
});
