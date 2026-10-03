import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_EXPLANATION_HEADINGS,
  validateExplanations,
} from "../../../scripts/lib/explanation-validator.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = resolve(
  repoRoot,
  "analysis-fixtures/eventcalendar-app/understand-anything-data/knowledge-graph.json",
);

function explanation(beginnerBody = "本文") {
  return `${REQUIRED_EXPLANATION_HEADINGS.slice(0, 6).join("\n")}\n## 初心者向けまとめ\n\n${beginnerBody}\n\n## 根拠\n\n根拠`;
}

function fileNode(id, overrides = {}) {
  return {
    id: `file:${id}`,
    type: "file",
    name: id,
    summary: "概要",
    tags: ["test"],
    complexity: "simple",
    explanationStatus: "ready",
    explanation: explanation(),
    ...overrides,
  };
}

function graph(nodes, edges = []) {
  return { nodes, edges };
}

describe("validateExplanations", () => {
  it("accepts ready and failed outcomes when each has its required payload", () => {
    const result = validateExplanations(
      graph([
        fileNode("ready.ts"),
        fileNode("failed.ts", {
          explanationStatus: "failed",
          explanation: undefined,
          explanationError: "LLM request timed out",
        }),
      ], [{ source: "file:ready.ts", target: "file:failed.ts" }]),
      { expectedFileNodes: 2, minimumReadyRatio: 0.5 },
    );

    expect(result.valid).toBe(true);
    expect(result).toMatchObject({
      totalFileNodes: 2,
      readyCount: 1,
      failedCount: 1,
      readyRatio: 0.5,
      statusCounts: { ready: 1, failed: 1 },
    });
  });

  it.each([
    ["missing status", { explanationStatus: undefined }],
    ["generating status", { explanationStatus: "generating" }],
    ["ready without explanation", { explanation: "" }],
    ["failed without error", { explanationStatus: "failed", explanation: undefined }],
  ])("rejects %s", (_label, overrides) => {
    const result = validateExplanations(graph([fileNode("broken.ts", overrides)]), {
      expectedFileNodes: 1,
      minimumReadyRatio: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("reports every missing required heading", () => {
    const result = validateExplanations(
      graph([fileNode("incomplete.ts", { explanation: "## 役割\n本文" })]),
      { expectedFileNodes: 1, minimumReadyRatio: 0 },
    );

    expect(result.issues.filter((entry) => entry.code === "explanation-heading")).toHaveLength(7);
    expect(result.issues.map((entry) => entry.heading)).not.toContain("## 役割");
  });

  it("enforces the minimum ready ratio", () => {
    const result = validateExplanations(
      graph([
        fileNode("ready.ts"),
        fileNode("failed.ts", {
          explanationStatus: "failed",
          explanation: undefined,
          explanationError: "not available",
        }),
      ]),
      { expectedFileNodes: 2, minimumReadyRatio: 0.8 },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.code === "ready-ratio")).toBe(true);
  });

  it("detects duplicate node IDs and dangling edge endpoints", () => {
    const result = validateExplanations(
      graph(
        [fileNode("same.ts"), fileNode("same.ts")],
        [{ source: "file:same.ts", target: "file:missing.ts" }],
      ),
      { expectedFileNodes: 2, minimumReadyRatio: 0 },
    );

    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["duplicate-node-id", "dangling-edge"]),
    );
  });

  it("can validate a general graph without enforcing the fixture count", () => {
    const result = validateExplanations(graph([fileNode("one.ts")]), {
      expectedFileNodes: null,
    });

    expect(result.valid).toBe(true);
    expect(result.expectedFileNodes).toBeNull();
  });

  it("rejects a graph with no file nodes", () => {
    const result = validateExplanations({ nodes: [], edges: [] }, {
      expectedFileNodes: null,
      minimumReadyRatio: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.code === "file-nodes-empty")).toBe(true);
  });

  it("checks beginner summary sentence count and length when enabled", () => {
    const result = validateExplanations(
      graph([
        fileNode("valid.ts", {
          explanation: explanation("一文目です。二文目です。三文目です。"),
        }),
        fileNode("invalid.ts", {
          explanation: explanation("一文目です。二文目です。"),
        }),
        fileNode("too-long.ts", {
          explanation: explanation(`${"あ".repeat(41)}。二文目です。三文目です。`),
        }),
      ]),
      { expectedFileNodes: 3, beginnerQuality: true },
    );

    expect(result.valid).toBe(false);
    expect(result.beginnerQuality).toMatchObject({
      enabled: true,
      checkedCount: 3,
      validCount: 1,
    });
    expect(result.issues.some((entry) => entry.code === "beginner-summary-sentence-count")).toBe(true);
    expect(result.issues.some((entry) => entry.code === "beginner-summary-sentence-length")).toBe(true);
  });
});

describe("EventCalendar explanation fixture", () => {
  it("has valid outcomes for all 81 tracked file nodes", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const result = validateExplanations(fixture, {
      expectedFileNodes: 81,
      beginnerQuality: true,
    });

    expect(result, JSON.stringify(result.issues, null, 2)).toMatchObject({
      valid: true,
      totalFileNodes: 81,
      expectedFileNodes: 81,
    });
    expect(result.beginnerQuality).toMatchObject({
      enabled: true,
      checkedCount: 81,
      validCount: 81,
    });
  });
});
