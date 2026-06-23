import { describe, it, expect } from "vitest";
import { SearchEngine } from "../search.js";
import type { GraphNode } from "../types.js";

const makeNode = (overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode => ({
  type: "file",
  summary: "",
  tags: [],
  complexity: "simple",
  ...overrides,
});

const sampleNodes: GraphNode[] = [
  makeNode({
    id: "auth-ctrl",
    name: "AuthenticationController",
    type: "class",
    summary: "Handles user login, logout, and session management",
    tags: ["auth", "controller", "security"],
    languageNotes: "Uses Express middleware pattern",
  }),
  makeNode({
    id: "db-pool",
    name: "DatabasePool",
    type: "class",
    summary: "Manages PostgreSQL connection pooling",
    tags: ["database", "connection"],
  }),
  makeNode({
    id: "user-model",
    name: "UserModel",
    type: "class",
    summary: "ORM model for the users table",
    tags: ["model", "database", "user"],
  }),
  makeNode({
    id: "config",
    name: "config.ts",
    type: "file",
    summary: "Application configuration and environment variables",
    tags: ["config", "env"],
  }),
  makeNode({
    id: "helpers",
    name: "helpers.ts",
    type: "function",
    summary: "Utility helper functions for string manipulation",
    tags: ["utils", "helpers"],
  }),
  makeNode({
    id: "auth-middleware",
    name: "authMiddleware",
    type: "function",
    summary: "Express middleware that validates JWT tokens for authentication",
    tags: ["auth", "middleware", "security"],
  }),
];

describe("SearchEngine", () => {
  it("returns empty results for empty query", () => {
    const engine = new SearchEngine(sampleNodes);
    expect(engine.search("")).toEqual([]);
    expect(engine.search("  ")).toEqual([]);
  });

  it("finds exact name match", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("AuthenticationController");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe("auth-ctrl");
  });

  it("finds fuzzy name match", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("auth contrl");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.nodeId === "auth-ctrl")).toBe(true);
  });

  it("searches across summary field", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("PostgreSQL connection");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.nodeId === "db-pool")).toBe(true);
  });

  it("searches across tags", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("security");
    expect(results.length).toBeGreaterThan(0);
    const nodeIds = results.map((r) => r.nodeId);
    expect(nodeIds).toContain("auth-ctrl");
    expect(nodeIds).toContain("auth-middleware");
  });

  it("ranks name matches higher than summary matches", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("UserModel");
    expect(results.length).toBeGreaterThan(0);
    // UserModel is an exact name match; it should rank first
    expect(results[0].nodeId).toBe("user-model");
  });

  it("returns scored results with score between 0 and 1", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("database");
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("can updateNodes and re-index", () => {
    const engine = new SearchEngine(sampleNodes);

    // Initially no "PaymentService" results
    const before = engine.search("PaymentService");
    const hadPayment = before.some((r) => r.nodeId === "payment");

    // Add a new node
    engine.updateNodes([
      ...sampleNodes,
      makeNode({
        id: "payment",
        name: "PaymentService",
        type: "class",
        summary: "Handles payment processing",
        tags: ["payment", "billing"],
      }),
    ]);

    const after = engine.search("PaymentService");
    expect(hadPayment).toBe(false);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].nodeId).toBe("payment");
  });

  it("filters by node type", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("auth", { types: ["function"] });
    expect(results.length).toBeGreaterThan(0);
    // Should only return function-type nodes
    for (const result of results) {
      const node = sampleNodes.find((n) => n.id === result.nodeId);
      expect(node?.type).toBe("function");
    }
    // Specifically, authMiddleware (function) should appear but AuthenticationController (class) should not
    expect(results.some((r) => r.nodeId === "auth-middleware")).toBe(true);
    expect(results.some((r) => r.nodeId === "auth-ctrl")).toBe(false);
  });

  it("respects the limit option", () => {
    const engine = new SearchEngine(sampleNodes);
    const results = engine.search("auth", { limit: 1 });
    expect(results.length).toBe(1);
  });
});
