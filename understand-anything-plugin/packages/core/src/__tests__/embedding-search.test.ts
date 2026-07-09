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

    it("returns 0 (not NaN) for mismatched vector lengths", () => {
      // a longer than b
      expect(cosineSimilarity([1, 0, 0, 0.5], [1, 0, 0])).toBe(0);
      // a shorter than b — today silently returns 1, overstating similarity
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0, 5])).toBe(0);
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

    it("tolerates a mis-sized stored embedding without throwing", () => {
      // n2 simulates a stale/corrupt index entry: it was persisted by a
      // different model and has the wrong dimension relative to the query.
      const mixedEmbeddings: Record<string, number[]> = {
        n1: [1, 0, 0, 0],
        n2: [0, 1, 0], // wrong length (3 vs 4)
        n3: [0.9, 0, 0.1, 0],
      };
      const engine = new SemanticSearchEngine(nodes, mixedEmbeddings);
      const queryEmbedding = [1, 0, 0, 0];

      expect(() => engine.search(queryEmbedding)).not.toThrow();
    });

    it("ranks a mis-sized stored embedding last at the default threshold", () => {
      const mixedEmbeddings: Record<string, number[]> = {
        n1: [1, 0, 0, 0], // identical to query -> similarity 1, score 0 (best)
        n2: [0, 1, 0], // wrong length -> similarity 0, score 1 (worst)
        n3: [0.9, 0, 0.1, 0], // similar -> high similarity, low score
      };
      const engine = new SemanticSearchEngine(nodes, mixedEmbeddings);

      const results = engine.search([1, 0, 0, 0]);
      const ids = results.map((r) => r.nodeId);

      // Correctly-sized neighbours come back in ascending-score (descending
      // similarity) order; the mismatched node is included but ranked last
      // because similarity 0 satisfies `0 >= 0` and scores `1 - 0 = 1`.
      expect(ids).toEqual(["n1", "n3", "n2"]);
      expect(results[results.length - 1].nodeId).toBe("n2");
      expect(results[results.length - 1].score).toBe(1);
    });

    it("drops a mis-sized stored embedding under a positive threshold", () => {
      const mixedEmbeddings: Record<string, number[]> = {
        n1: [1, 0, 0, 0],
        n2: [0, 1, 0], // wrong length -> similarity 0, filtered by threshold
        n3: [0.9, 0, 0.1, 0],
      };
      const engine = new SemanticSearchEngine(nodes, mixedEmbeddings);

      const results = engine.search([1, 0, 0, 0], { threshold: 0.5 });
      const ids = results.map((r) => r.nodeId);

      // similarity 0 fails `0 >= 0.5`, so the mismatched node is excluded while
      // the correctly-sized neighbours remain in score order.
      expect(ids).not.toContain("n2");
      expect(ids).toEqual(["n1", "n3"]);
    });
  });
});
