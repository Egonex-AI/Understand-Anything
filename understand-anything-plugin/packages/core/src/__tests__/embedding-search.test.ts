import { describe, it, expect } from "vitest";
import {
  SemanticSearchEngine,
  cosineSimilarity,
  HashingEmbedder,
  EMBEDDING_DIM,
  embedGraphNodes,
  tokenize,
} from "../embedding-search.js";
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

  describe("tokenize", () => {
    it("splits on non-alphanumeric boundaries", () => {
      expect(tokenize("auth-middleware.ts handles login")).toEqual([
        "auth",
        "middleware",
        "ts",
        "handles",
        "login",
      ]);
    });

    it("splits CamelCase identifiers", () => {
      expect(tokenize("AuthMiddleware")).toEqual(["auth", "middleware"]);
      expect(tokenize("HTTPSConnection")).toEqual(["https", "connection"]);
      expect(tokenize("loadJSON")).toEqual(["load", "json"]);
    });

    it("lowercases tokens", () => {
      expect(tokenize("LOGIN")).toEqual(["login"]);
    });

    it("drops English stopwords and tokens shorter than 2 chars", () => {
      // "a", "the" are stopwords; single chars are filtered out
      expect(tokenize("the user is a person")).toEqual(["user", "person"]);
    });

    it("returns empty array for empty or whitespace-only input", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize("   ")).toEqual([]);
    });
  });

  describe("HashingEmbedder", () => {
    it("produces vectors of the configured dimension", () => {
      const embedder = new HashingEmbedder();
      const vec = embedder.embed("hello world");
      expect(vec).toHaveLength(EMBEDDING_DIM);
    });

    it("respects a custom dimension", () => {
      const embedder = new HashingEmbedder(64);
      expect(embedder.embed("hello").length).toBe(64);
    });

    it("returns a zero vector for empty input", () => {
      const vec = new HashingEmbedder().embed("");
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it("returns L2-normalised vectors for non-empty input", () => {
      const vec = new HashingEmbedder().embed("authentication module");
      const mag = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
      expect(mag).toBeCloseTo(1, 5);
    });

    it("is deterministic — same input yields same vector", () => {
      const embedder = new HashingEmbedder();
      const a = embedder.embed("login handler");
      const b = embedder.embed("login handler");
      expect(a).toEqual(b);
    });

    it("similar texts produce higher similarity than unrelated texts", () => {
      const embedder = new HashingEmbedder();
      const auth = embedder.embed(
        "user authentication login session tokens credentials",
      );
      const authRelated = embedder.embed("login handler session validation");
      const unrelated = embedder.embed(
        "database connection pool postgres query",
      );

      const simRelated = cosineSimilarity(auth, authRelated);
      const simUnrelated = cosineSimilarity(auth, unrelated);
      expect(simRelated).toBeGreaterThan(simUnrelated);
    });

    it("CamelCase identifiers match their split forms", () => {
      // The whole point of CamelCase splitting: `AuthMiddleware` should
      // semantically match a query for "auth middleware".
      const embedder = new HashingEmbedder();
      const node = embedder.embed("AuthMiddleware");
      const query = embedder.embed("auth middleware");
      expect(cosineSimilarity(node, query)).toBeCloseTo(1, 5);
    });
  });

  describe("embedGraphNodes", () => {
    it("returns one vector per node, keyed by id", () => {
      const graphNodes: GraphNode[] = [
        {
          id: "n1",
          type: "file",
          name: "auth.ts",
          summary: "Authentication module",
          tags: ["auth"],
          complexity: "moderate",
        },
        {
          id: "n2",
          type: "file",
          name: "db.ts",
          summary: "Database connection",
          tags: ["db"],
          complexity: "simple",
        },
      ];
      const embeddings = embedGraphNodes(graphNodes);
      expect(Object.keys(embeddings).sort()).toEqual(["n1", "n2"]);
      expect(embeddings.n1).toHaveLength(EMBEDDING_DIM);
      expect(embeddings.n2).toHaveLength(EMBEDDING_DIM);
    });

    it("produces a semantic-search-able index — query for one tag returns that node first", () => {
      const graphNodes: GraphNode[] = [
        {
          id: "auth-node",
          type: "file",
          name: "auth.ts",
          summary: "Handles user authentication with sessions and tokens",
          tags: ["auth", "login", "session"],
          complexity: "moderate",
        },
        {
          id: "db-node",
          type: "file",
          name: "db.ts",
          summary: "Postgres connection pool and query helpers",
          tags: ["database", "postgres", "queries"],
          complexity: "simple",
        },
        {
          id: "ui-node",
          type: "file",
          name: "Button.tsx",
          summary: "Reusable button component for the design system",
          tags: ["ui", "component"],
          complexity: "simple",
        },
      ];

      const embedder = new HashingEmbedder();
      const embeddings = embedGraphNodes(graphNodes, embedder);
      const engine = new SemanticSearchEngine(graphNodes, embeddings);

      const queryVec = embedder.embed("user login session");
      const results = engine.search(queryVec, { limit: 3 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBe("auth-node");
    });

    it("uses the supplied embedder for both indexing and querying (round-trip)", () => {
      // The embedder must be the SAME instance/dimension on both sides; this
      // catches a class of bugs where index and query use different vectorisers.
      const graphNodes: GraphNode[] = [
        {
          id: "n1",
          type: "function",
          name: "computeMd5Hash",
          summary: "",
          tags: [],
          complexity: "simple",
        },
        {
          id: "n2",
          type: "function",
          name: "renderMarkdown",
          summary: "",
          tags: [],
          complexity: "simple",
        },
      ];
      const embedder = new HashingEmbedder();
      const embeddings = embedGraphNodes(graphNodes, embedder);
      const engine = new SemanticSearchEngine(graphNodes, embeddings);

      const results = engine.search(embedder.embed("md5 hash"));
      expect(results[0].nodeId).toBe("n1");
    });
  });
});
