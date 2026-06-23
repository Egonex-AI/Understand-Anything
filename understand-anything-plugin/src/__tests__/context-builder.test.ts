import { describe, it, expect } from "vitest";
import { buildChatContext, formatContextForPrompt } from "../context-builder.js";
import type { KnowledgeGraph, GraphNode, GraphEdge, Layer } from "@understand-anything/core";

const makeNode = (
  overrides: Partial<GraphNode> & { id: string; name: string },
): GraphNode => ({
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
    filePath: "src/controllers/auth.ts",
    summary: "Handles user login, logout, and session management",
    tags: ["auth", "controller", "security"],
    complexity: "complex",
    languageNotes: "Uses Express middleware pattern",
  }),
  makeNode({
    id: "db-pool",
    name: "DatabasePool",
    type: "class",
    filePath: "src/db/pool.ts",
    summary: "Manages PostgreSQL connection pooling",
    tags: ["database", "connection"],
    complexity: "moderate",
  }),
  makeNode({
    id: "user-model",
    name: "UserModel",
    type: "class",
    filePath: "src/models/user.ts",
    summary: "ORM model for the users table",
    tags: ["model", "database", "user"],
    complexity: "moderate",
  }),
  makeNode({
    id: "auth-middleware",
    name: "authMiddleware",
    type: "function",
    filePath: "src/middleware/auth.ts",
    summary: "Express middleware that validates JWT tokens for authentication",
    tags: ["auth", "middleware", "security"],
    complexity: "simple",
  }),
  makeNode({
    id: "config",
    name: "config.ts",
    type: "file",
    filePath: "src/config.ts",
    summary: "Application configuration and environment variables",
    tags: ["config", "env"],
    complexity: "simple",
  }),
];

const sampleEdges: GraphEdge[] = [
  {
    source: "auth-ctrl",
    target: "user-model",
    type: "depends_on",
    direction: "forward",
    description: "AuthenticationController uses UserModel for user lookup",
    weight: 0.9,
  },
  {
    source: "auth-ctrl",
    target: "auth-middleware",
    type: "calls",
    direction: "forward",
    description: "Controller registers auth middleware",
    weight: 0.7,
  },
  {
    source: "user-model",
    target: "db-pool",
    type: "depends_on",
    direction: "forward",
    description: "UserModel uses DatabasePool for queries",
    weight: 0.8,
  },
];

const sampleLayers: Layer[] = [
  {
    id: "layer-api",
    name: "API Layer",
    description: "HTTP controllers and middleware",
    nodeIds: ["auth-ctrl", "auth-middleware"],
  },
  {
    id: "layer-data",
    name: "Data Layer",
    description: "Database models and connections",
    nodeIds: ["user-model", "db-pool"],
  },
];

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["TypeScript"],
    frameworks: ["Express"],
    description: "A test project for unit tests",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: sampleNodes,
  edges: sampleEdges,
  layers: sampleLayers,
  tour: [],
};

describe("buildChatContext", () => {
  it("finds relevant nodes for a query", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    expect(ctx.relevantNodes.length).toBeGreaterThan(0);
    const nodeNames = ctx.relevantNodes.map((n) => n.name);
    expect(nodeNames).toContain("AuthenticationController");
  });

  it("includes connected nodes via 1-hop expansion", () => {
    // Searching for "authentication" should find auth-ctrl directly.
    // auth-ctrl connects to user-model and auth-middleware via edges,
    // so those should also appear in relevantNodes.
    const ctx = buildChatContext(sampleGraph, "authentication");
    const nodeIds = ctx.relevantNodes.map((n) => n.id);
    // auth-ctrl is a direct match
    expect(nodeIds).toContain("auth-ctrl");
    // user-model and auth-middleware are 1-hop connected
    expect(nodeIds).toContain("user-model");
    expect(nodeIds).toContain("auth-middleware");
  });

  it("includes project metadata", () => {
    const ctx = buildChatContext(sampleGraph, "database");
    expect(ctx.projectName).toBe("test-project");
    expect(ctx.projectDescription).toBe("A test project for unit tests");
    expect(ctx.languages).toEqual(["TypeScript"]);
    expect(ctx.frameworks).toEqual(["Express"]);
  });

  it("includes relevant layers containing matched nodes", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const layerNames = ctx.relevantLayers.map((l) => l.name);
    // auth-ctrl is in API Layer
    expect(layerNames).toContain("API Layer");
  });

  it("includes relevant edges between relevant nodes", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    expect(ctx.relevantEdges.length).toBeGreaterThan(0);
    // Should include the edge from auth-ctrl to user-model
    const hasAuthToUser = ctx.relevantEdges.some(
      (e) => e.source === "auth-ctrl" && e.target === "user-model",
    );
    expect(hasAuthToUser).toBe(true);
  });

  it("stores the original query", () => {
    const ctx = buildChatContext(sampleGraph, "database pool");
    expect(ctx.query).toBe("database pool");
  });

  it("respects maxNodes parameter", () => {
    const ctx = buildChatContext(sampleGraph, "auth", 1);
    // With maxNodes=1, only 1 search result (before expansion)
    // Expansion may add connected nodes, but initial search is limited
    expect(ctx.relevantNodes.length).toBeGreaterThanOrEqual(1);
    // Should still be bounded reasonably
    expect(ctx.relevantNodes.length).toBeLessThanOrEqual(sampleNodes.length);
  });

  it("returns empty relevantNodes for a query with no matches", () => {
    const ctx = buildChatContext(sampleGraph, "xyznonexistent");
    expect(ctx.relevantNodes.length).toBe(0);
    expect(ctx.relevantEdges.length).toBe(0);
    expect(ctx.relevantLayers.length).toBe(0);
  });
});

describe("formatContextForPrompt", () => {
  it("produces a string containing node names and summaries", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    expect(formatted).toContain("AuthenticationController");
    expect(formatted).toContain("Handles user login, logout, and session management");
  });

  it("includes project header information", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    expect(formatted).toContain("test-project");
    expect(formatted).toContain("TypeScript");
    expect(formatted).toContain("Express");
  });

  it("includes edge/relationship descriptions", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    // Should reference the relationship between auth-ctrl and user-model
    expect(formatted).toContain("AuthenticationController");
    expect(formatted).toContain("UserModel");
    // Edge type or description should appear
    expect(formatted).toContain("depends_on");
  });

  it("includes layer information when layers are present", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    expect(formatted).toContain("API Layer");
  });

  it("includes file paths for nodes that have them", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    expect(formatted).toContain("src/controllers/auth.ts");
  });

  it("includes complexity and type information", () => {
    const ctx = buildChatContext(sampleGraph, "authentication");
    const formatted = formatContextForPrompt(ctx);
    expect(formatted).toContain("complex");
    expect(formatted).toContain("class");
  });
});
