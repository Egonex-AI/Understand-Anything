import { describe, it, expect } from "vitest";
import { buildExplainContext, formatExplainPrompt } from "../explain-builder.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "Auth module", tags: ["auth"], complexity: "complex" },
    { id: "function:src/auth.ts:login", type: "function", name: "login", filePath: "src/auth.ts", lineRange: [10, 30], summary: "Login handler", tags: ["auth", "login"], complexity: "moderate" },
    { id: "function:src/auth.ts:verify", type: "function", name: "verify", filePath: "src/auth.ts", lineRange: [32, 50], summary: "Token verification", tags: ["auth", "jwt"], complexity: "moderate" },
    { id: "file:src/db.ts", type: "file", name: "db.ts", filePath: "src/db.ts", summary: "Database", tags: ["db"], complexity: "simple" },
  ],
  edges: [
    { source: "file:src/auth.ts", target: "function:src/auth.ts:login", type: "contains", direction: "forward", weight: 1.0 },
    { source: "file:src/auth.ts", target: "function:src/auth.ts:verify", type: "contains", direction: "forward", weight: 1.0 },
    { source: "function:src/auth.ts:login", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.8 },
  ],
  layers: [
    { id: "layer:auth", name: "Auth Layer", description: "Authentication", nodeIds: ["file:src/auth.ts", "function:src/auth.ts:login", "function:src/auth.ts:verify"] },
  ],
  tour: [],
};

describe("explain-builder", () => {
  describe("buildExplainContext", () => {
    it("finds the file node by path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.targetNode?.id).toBe("file:src/auth.ts");
    });

    it("includes child nodes (functions/classes in the file)", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.childNodes.map((n) => n.name)).toContain("login");
      expect(ctx.childNodes.map((n) => n.name)).toContain("verify");
    });

    it("includes connected nodes", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const allIds = ctx.connectedNodes.map((n) => n.id);
      expect(allIds).toContain("file:src/db.ts");
    });

    it("includes the layer", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      expect(ctx.layer?.name).toBe("Auth Layer");
    });

    it("returns null targetNode for unknown paths", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      expect(ctx.targetNode).toBeNull();
    });

    it("finds function nodes by partial path match", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts:login");
      expect(ctx.targetNode?.name).toBe("login");
    });
  });

  describe("formatExplainPrompt", () => {
    it("produces structured markdown for valid context", () => {
      const ctx = buildExplainContext(sampleGraph, "src/auth.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("auth.ts");
      expect(prompt).toContain("login");
      expect(prompt).toContain("Auth Layer");
    });

    it("produces helpful message for unknown path", () => {
      const ctx = buildExplainContext(sampleGraph, "src/unknown.ts");
      const prompt = formatExplainPrompt(ctx);
      expect(prompt).toContain("not found");
    });
  });
});
