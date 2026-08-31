import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "understand-anything-plugin", "bin", "ugraph.js");

function withGraph(testFn) {
  const dir = mkdtempSync(path.join(tmpdir(), "ugraph-"));
  mkdirSync(path.join(dir, ".understand-anything"));
  writeFileSync(
    path.join(dir, ".understand-anything", "knowledge-graph.json"),
    JSON.stringify(sampleGraph),
  );

  try {
    return testFn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cwd, args) {
  const output = execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

const sampleGraph = {
  version: "1.0.0",
  kind: "codebase",
  project: {
    name: "Shop",
    description: "Example commerce service",
    languages: ["TypeScript"],
    frameworks: ["Express"],
    analyzedAt: "2026-06-15T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "file:src/auth/login.ts",
      type: "file",
      name: "login.ts",
      filePath: "src/auth/login.ts",
      summary: "Handles auth login and token validation.",
      tags: ["auth", "security"],
      complexity: "moderate",
    },
    {
      id: "function:src/auth/login.ts:validateToken",
      type: "function",
      name: "validateToken",
      filePath: "src/auth/login.ts",
      lineRange: [10, 25],
      summary: "Validates JWT tokens for authenticated requests.",
      tags: ["auth", "jwt"],
      complexity: "simple",
    },
    {
      id: "file:src/routes/payment.ts",
      type: "file",
      name: "payment.ts",
      filePath: "src/routes/payment.ts",
      summary: "Payment route that requires authentication before checkout.",
      tags: ["payment", "route"],
      complexity: "moderate",
    },
    {
      id: "file:src/db/pool.ts",
      type: "file",
      name: "pool.ts",
      filePath: "src/db/pool.ts",
      summary: "Database connection pool.",
      tags: ["database"],
      complexity: "simple",
    },
    {
      id: "file:tests/auth.test.ts",
      type: "file",
      name: "auth.test.ts",
      filePath: "tests/auth.test.ts",
      summary: "Tests token validation and login behavior.",
      tags: ["test", "auth"],
      complexity: "simple",
    },
  ],
  edges: [
    {
      source: "file:src/auth/login.ts",
      target: "function:src/auth/login.ts:validateToken",
      type: "contains",
      direction: "forward",
      weight: 1,
    },
    {
      source: "file:src/routes/payment.ts",
      target: "function:src/auth/login.ts:validateToken",
      type: "calls",
      direction: "forward",
      weight: 0.9,
    },
    {
      source: "file:src/auth/login.ts",
      target: "file:src/db/pool.ts",
      type: "depends_on",
      direction: "forward",
      weight: 0.7,
    },
    {
      source: "file:tests/auth.test.ts",
      target: "file:src/auth/login.ts",
      type: "tested_by",
      direction: "backward",
      weight: 0.8,
    },
  ],
  layers: [
    {
      id: "api",
      name: "API",
      description: "HTTP entry points",
      nodeIds: ["file:src/routes/payment.ts"],
    },
    {
      id: "auth",
      name: "Auth",
      description: "Authentication and authorization",
      nodeIds: ["file:src/auth/login.ts", "function:src/auth/login.ts:validateToken"],
    },
    {
      id: "data",
      name: "Data",
      description: "Persistence",
      nodeIds: ["file:src/db/pool.ts"],
    },
  ],
  tour: [
    {
      order: 1,
      title: "Start with auth",
      description: "Understand login before reading payment routes.",
      nodeIds: ["file:src/auth/login.ts", "file:src/routes/payment.ts"],
    },
  ],
};

describe("ugraph CLI", () => {
  it("prints a compact project overview", () => withGraph((cwd) => {
    const result = run(cwd, ["overview"]);

    expect(result.command).toBe("overview");
    expect(result.project.name).toBe("Shop");
    expect(result.graph.nodes).toBe(5);
    expect(result.nodeTypes.file).toBe(4);
  }));

  it("finds relevant graph nodes", () => withGraph((cwd) => {
    const result = run(cwd, ["find", "auth", "--limit", "3"]);

    expect(result.command).toBe("find");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].node.tags).toContain("auth");
  }));

  it("shows a node with direct relationships", () => withGraph((cwd) => {
    const result = run(cwd, ["node", "src/auth/login.ts"]);

    expect(result.node.id).toBe("file:src/auth/login.ts");
    expect(result.relationships.outgoing.map((edge) => edge.type)).toContain("contains");
    expect(result.relationships.incoming.map((edge) => edge.source)).toContain("file:tests/auth.test.ts");
  }));

  it("resolves file paths by suffix for repo-relative callers", () => withGraph((cwd) => {
    const result = run(cwd, ["node", "app/src/auth/login.ts", "--no-edges"]);

    expect(result.node.id).toBe("file:src/auth/login.ts");
  }));

  it("expands neighborhoods by depth", () => withGraph((cwd) => {
    const result = run(cwd, ["neighbors", "src/auth/login.ts", "--depth", "2", "--limit", "10"]);

    const nodeIds = result.nodes.map((node) => node.id);
    expect(nodeIds).toContain("file:src/db/pool.ts");
    expect(nodeIds).toContain("file:src/routes/payment.ts");
  }));

  it("reports incoming impact for a changed file", () => withGraph((cwd) => {
    const result = run(cwd, ["impact", "src/auth/login.ts", "--limit", "10"]);

    const impactedIds = result.impactedNodes.map((node) => node.id);
    expect(impactedIds).toContain("file:src/routes/payment.ts");
    expect(impactedIds).toContain("file:tests/auth.test.ts");
  }));

  it("builds context around a query", () => withGraph((cwd) => {
    const result = run(cwd, ["context", "payment checkout", "--limit", "10"]);

    expect(result.command).toBe("context");
    expect(result.matchedNodes.map((node) => node.id)).toContain("file:src/routes/payment.ts");
    expect(result.relationships.length).toBeGreaterThan(0);
  }));
});
