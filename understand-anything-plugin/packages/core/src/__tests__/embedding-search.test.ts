import { describe, it, expect } from "vitest";
import { SemanticSearchEngine, cosineSimilarity } from "../embedding-search.js";
import type { GraphNode } from "../types.js";

const nodes: GraphNode[] = [
  { id: "n1", type: "file", name: "auth.ts", summary: "Authentication module", tags: ["auth"], complexity: "moderate" },
  { id: "n2", type: "file", name: "db.ts", summary: "Database connection", tags: ["db"], complexity: "simple" },
  { id: "n3", type: "function", name: "login", summary: "User login handler", tags: ["auth", "login"], complexity: "moderate" },
];

// Simple unit vectors for testing
const embeddings: Record<string, number[]> = {
  n1: [1, 0, 0, 0],
  n2: [0, 1, 0, 0],
  n3: [0.9, 0, 0.1, 0],
};

describe("embedding-search", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    });

    it("returns high similarity for similar vectors", () => {
      const sim = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0]);
      expect(sim).toBeGreaterThan(0.9);
    });

    it("handles zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    });
  });

  describe("SemanticSearchEngine", () => {
    it("returns results sorted by similarity", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const queryEmbedding = [1, 0, 0, 0]; // most similar to n1 and n3
      const results = engine.search(queryEmbedding);
      expect(results[0].nodeId).toBe("n1");
    });

    it("respects limit parameter", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("respects threshold parameter", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { threshold: 0.5 });
      // n2 has 0 similarity, should be filtered out
      const ids = results.map((r) => r.nodeId);
      expect(ids).not.toContain("n2");
    });

    it("filters by node type", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      const results = engine.search([1, 0, 0, 0], { types: ["function"] });
      expect(results.every((r) => {
        const node = nodes.find((n) => n.id === r.nodeId);
        return node?.type === "function";
      })).toBe(true);
    });

    it("returns empty for nodes without embeddings", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      const results = engine.search([1, 0, 0, 0]);
      expect(results).toHaveLength(0);
    });

    it("hasEmbeddings returns true when embeddings exist", () => {
      const engine = new SemanticSearchEngine(nodes, embeddings);
      expect(engine.hasEmbeddings()).toBe(true);
    });

    it("hasEmbeddings returns false when empty", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      expect(engine.hasEmbeddings()).toBe(false);
    });

    it("addEmbedding updates the search index", () => {
      const engine = new SemanticSearchEngine(nodes, {});
      expect(engine.hasEmbeddings()).toBe(false);
      engine.addEmbedding("n1", [1, 0, 0, 0]);
      expect(engine.hasEmbeddings()).toBe(true);
    });
  });
});
