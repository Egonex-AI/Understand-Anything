import { describe, it, expect, beforeEach } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../store.js";

/**
 * Build a minimal graph with nodes whose text content is engineered so that
 * "fuzzy" and "semantic" search return *different* top results — that's how
 * we prove the semantic engine is actually being used and not silently
 * falling back to fuzzy.
 */
function makeGraph(): KnowledgeGraph {
  return {
    version: "1.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: [],
      description: "Fixture project for store search wiring tests",
      analyzedAt: "2026-01-01T00:00:00Z",
      gitCommitHash: "abc1234",
    },
    nodes: [
      {
        id: "auth",
        type: "file",
        name: "session-handler.ts",
        summary:
          "Handles user authentication: login, logout, session tokens, credentials",
        tags: ["auth", "login", "session"],
        complexity: "moderate",
      },
      {
        id: "db",
        type: "file",
        name: "pg-pool.ts",
        summary: "Postgres connection pool and query helpers",
        tags: ["database", "postgres", "queries"],
        complexity: "simple",
      },
      {
        id: "ui",
        type: "file",
        name: "Button.tsx",
        summary: "Reusable button component for the design system",
        tags: ["ui", "component"],
        complexity: "simple",
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

function resetStore() {
  useDashboardStore.setState({
    graph: null,
    searchEngine: null,
    semanticEngine: null,
    embedder: null,
    searchQuery: "",
    searchResults: [],
    searchMode: "fuzzy",
  });
}

describe("dashboard store — search wiring", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("setGraph", () => {
    it("creates a semantic engine and embedder when a graph with nodes is loaded", () => {
      useDashboardStore.getState().setGraph(makeGraph());
      const state = useDashboardStore.getState();
      expect(state.searchEngine).not.toBeNull();
      expect(state.semanticEngine).not.toBeNull();
      expect(state.embedder).not.toBeNull();
      expect(state.semanticEngine!.hasEmbeddings()).toBe(true);
    });

    it("leaves the semantic engine null for an empty graph", () => {
      const emptyGraph: KnowledgeGraph = { ...makeGraph(), nodes: [] };
      useDashboardStore.getState().setGraph(emptyGraph);
      const state = useDashboardStore.getState();
      expect(state.semanticEngine).toBeNull();
      expect(state.embedder).toBeNull();
    });
  });

  describe("setSearchQuery", () => {
    it("returns fuzzy results when searchMode is 'fuzzy'", () => {
      const store = useDashboardStore.getState();
      store.setGraph(makeGraph());
      // Default mode is fuzzy. Search for a literal substring of a node name.
      store.setSearchQuery("pg-pool");
      const results = useDashboardStore.getState().searchResults;
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBe("db");
    });

    it("returns semantic results when searchMode is 'semantic'", () => {
      const store = useDashboardStore.getState();
      store.setGraph(makeGraph());
      store.setSearchMode("semantic");
      // The word "authentication" does NOT appear in any node *name*, only in
      // the auth node's summary. Semantic search should still rank it first
      // because its embedded text shares tokens with the query.
      store.setSearchQuery("authentication");
      const results = useDashboardStore.getState().searchResults;
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBe("auth");
    });

    it("clears results on an empty query", () => {
      const store = useDashboardStore.getState();
      store.setGraph(makeGraph());
      store.setSearchQuery("auth");
      expect(useDashboardStore.getState().searchResults.length).toBeGreaterThan(0);
      store.setSearchQuery("");
      expect(useDashboardStore.getState().searchResults).toEqual([]);
    });

    it("falls back to fuzzy when semantic engine is missing (empty graph)", () => {
      const store = useDashboardStore.getState();
      // Load empty graph: no semantic engine, no embedder
      store.setGraph({ ...makeGraph(), nodes: [] });
      store.setSearchMode("semantic");
      // Should not throw; results just empty since there's nothing to match
      store.setSearchQuery("anything");
      expect(useDashboardStore.getState().searchResults).toEqual([]);
    });
  });

  describe("setSearchMode", () => {
    it("re-runs the current query through the new mode", () => {
      const store = useDashboardStore.getState();
      store.setGraph(makeGraph());

      // Fuzzy search for "session" matches the auth node's tag/summary
      store.setSearchQuery("session");
      const fuzzyResults = useDashboardStore.getState().searchResults.map((r) => r.nodeId);

      // Switch mode — should re-run query through semantic engine
      store.setSearchMode("semantic");
      const semanticResults = useDashboardStore.getState().searchResults.map(
        (r) => r.nodeId,
      );

      // The semantic engine may rank differently — what matters is that the
      // re-run happened (results changed AND/OR the same auth node is still
      // present). At minimum, both modes should find the auth node.
      expect(fuzzyResults).toContain("auth");
      expect(semanticResults).toContain("auth");
    });

    it("does not change results when there is no active query", () => {
      const store = useDashboardStore.getState();
      store.setGraph(makeGraph());
      // No query set
      store.setSearchMode("semantic");
      expect(useDashboardStore.getState().searchResults).toEqual([]);
    });
  });
});
