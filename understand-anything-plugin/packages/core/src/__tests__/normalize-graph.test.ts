import { describe, it, expect } from "vitest";
import {
  normalizeNodeId,
  normalizeComplexity,
  normalizeBatchOutput,
} from "../analyzer/normalize-graph.js";
import { validateGraph } from "../schema.js";

describe("normalizeNodeId", () => {
  it("passes through a correct file ID unchanged", () => {
    expect(
      normalizeNodeId("file:src/index.ts", { type: "file" }),
    ).toBe("file:src/index.ts");
  });

  it("passes through a correct func ID unchanged", () => {
    expect(
      normalizeNodeId("func:src/utils.ts:formatDate", { type: "function" }),
    ).toBe("func:src/utils.ts:formatDate");
  });

  it("passes through a correct class ID unchanged", () => {
    expect(
      normalizeNodeId("class:src/models/User.ts:User", { type: "class" }),
    ).toBe("class:src/models/User.ts:User");
  });

  it("fixes double-prefixed IDs", () => {
    expect(
      normalizeNodeId("file:file:src/foo.ts", { type: "file" }),
    ).toBe("file:src/foo.ts");
  });

  it("strips project-name prefix when valid prefix follows", () => {
    expect(
      normalizeNodeId("my-project:file:src/foo.ts", { type: "file" }),
    ).toBe("file:src/foo.ts");
  });

  it("strips project-name prefix and adds correct prefix for bare path", () => {
    expect(
      normalizeNodeId("my-project:src/foo.ts", { type: "file" }),
    ).toBe("file:src/foo.ts");
  });

  it("adds file: prefix to bare paths", () => {
    expect(
      normalizeNodeId("frontend/src/utils/constants.ts", { type: "file" }),
    ).toBe("file:frontend/src/utils/constants.ts");
  });

  it("reconstructs func ID from filePath and name for bare paths", () => {
    expect(
      normalizeNodeId("formatDate", {
        type: "function",
        filePath: "src/utils.ts",
        name: "formatDate",
      }),
    ).toBe("func:src/utils.ts:formatDate");
  });

  it("reconstructs class ID from filePath and name for bare paths", () => {
    expect(
      normalizeNodeId("User", {
        type: "class",
        filePath: "src/models/User.ts",
        name: "User",
      }),
    ).toBe("class:src/models/User.ts:User");
  });

  it("trims whitespace", () => {
    expect(
      normalizeNodeId("  file:src/foo.ts  ", { type: "file" }),
    ).toBe("file:src/foo.ts");
  });

  it("handles module: and concept: prefixes", () => {
    expect(
      normalizeNodeId("module:auth", { type: "module" }),
    ).toBe("module:auth");
    expect(
      normalizeNodeId("concept:caching", { type: "concept" }),
    ).toBe("concept:caching");
  });

  it("handles project-name prefix before a valid non-code prefix", () => {
    expect(
      normalizeNodeId("my-project:service:docker-compose.yml", {
        type: "file",
      }),
    ).toBe("service:docker-compose.yml");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeNodeId("", { type: "file" })).toBe("");
  });

  it("falls back to untouched ID for unknown node type", () => {
    expect(normalizeNodeId("some-id", { type: "widget" as any })).toBe("some-id");
  });

  it("passes through non-code type IDs unchanged", () => {
    expect(normalizeNodeId("config:tsconfig.json", { type: "config" })).toBe("config:tsconfig.json");
    expect(normalizeNodeId("document:README.md", { type: "document" })).toBe("document:README.md");
    expect(normalizeNodeId("service:docker-compose.yml", { type: "service" })).toBe("service:docker-compose.yml");
    expect(normalizeNodeId("table:migrations/001.sql:users", { type: "table" })).toBe("table:migrations/001.sql:users");
    expect(normalizeNodeId("endpoint:src/routes.ts:GET /api/users", { type: "endpoint" })).toBe("endpoint:src/routes.ts:GET /api/users");
    expect(normalizeNodeId("pipeline:.github/workflows/ci.yml", { type: "pipeline" })).toBe("pipeline:.github/workflows/ci.yml");
    expect(normalizeNodeId("schema:schema.graphql", { type: "schema" })).toBe("schema:schema.graphql");
    expect(normalizeNodeId("resource:main.tf", { type: "resource" })).toBe("resource:main.tf");
  });

  it("adds prefix for bare paths with non-code types", () => {
    expect(normalizeNodeId("tsconfig.json", { type: "config" })).toBe("config:tsconfig.json");
    expect(normalizeNodeId("README.md", { type: "document" })).toBe("document:README.md");
  });

  it("strips project-name prefix from non-code type IDs", () => {
    expect(normalizeNodeId("my-project:config:tsconfig.json", { type: "config" })).toBe("config:tsconfig.json");
  });
});

describe("normalizeComplexity", () => {
  it("passes through valid values unchanged", () => {
    expect(normalizeComplexity("simple")).toBe("simple");
    expect(normalizeComplexity("moderate")).toBe("moderate");
    expect(normalizeComplexity("complex")).toBe("complex");
  });

  it("maps 'low' to 'simple'", () => {
    expect(normalizeComplexity("low")).toBe("simple");
  });

  it("maps 'high' to 'complex'", () => {
    expect(normalizeComplexity("high")).toBe("complex");
  });

  it("maps 'medium' to 'moderate'", () => {
    expect(normalizeComplexity("medium")).toBe("moderate");
  });

  it("maps other aliases from upstream COMPLEXITY_ALIASES", () => {
    expect(normalizeComplexity("easy")).toBe("simple");
    expect(normalizeComplexity("hard")).toBe("complex");
    expect(normalizeComplexity("difficult")).toBe("complex");
    expect(normalizeComplexity("intermediate")).toBe("moderate");
  });

  it("is case-insensitive", () => {
    expect(normalizeComplexity("LOW")).toBe("simple");
    expect(normalizeComplexity("High")).toBe("complex");
    expect(normalizeComplexity("MODERATE")).toBe("moderate");
  });

  it("maps numeric 1-3 to simple", () => {
    expect(normalizeComplexity(1)).toBe("simple");
    expect(normalizeComplexity(3)).toBe("simple");
  });

  it("maps numeric 4-6 to moderate", () => {
    expect(normalizeComplexity(4)).toBe("moderate");
    expect(normalizeComplexity(6)).toBe("moderate");
  });

  it("maps numeric 7-10 to complex", () => {
    expect(normalizeComplexity(7)).toBe("complex");
    expect(normalizeComplexity(10)).toBe("complex");
  });

  it("defaults free-text to moderate", () => {
    expect(normalizeComplexity("detailed")).toBe("moderate");
    expect(normalizeComplexity("very complex with many deps")).toBe("moderate");
  });

  it("defaults undefined/null to moderate", () => {
    expect(normalizeComplexity(undefined)).toBe("moderate");
    expect(normalizeComplexity(null)).toBe("moderate");
  });

  it("defaults zero and negative numbers to moderate", () => {
    expect(normalizeComplexity(0)).toBe("moderate");
    expect(normalizeComplexity(-5)).toBe("moderate");
  });
});

describe("normalizeBatchOutput", () => {
  it("normalizes IDs and numeric complexity, rewrites edges", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "file:src/good.ts",
          type: "file",
          name: "good.ts",
          filePath: "src/good.ts",
          summary: "A good file",
          tags: ["util"],
          complexity: "simple",
        },
        {
          id: "my-project:file:src/bad.ts",
          type: "file",
          name: "bad.ts",
          filePath: "src/bad.ts",
          summary: "Project-prefixed",
          tags: ["api"],
          complexity: "simple",
        },
        {
          id: "src/bare.ts",
          type: "file",
          name: "bare.ts",
          filePath: "src/bare.ts",
          summary: "Bare path",
          tags: [],
          complexity: 4,
        },
      ],
      edges: [
        {
          source: "file:src/good.ts",
          target: "my-project:file:src/bad.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
        {
          source: "src/bare.ts",
          target: "file:src/good.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].id).toBe("file:src/good.ts");
    expect(result.nodes[1].id).toBe("file:src/bad.ts");
    expect(result.nodes[2].id).toBe("file:src/bare.ts");
    // Only numeric complexity is fixed here; string aliases are upstream's job
    expect(result.nodes[2].complexity).toBe("moderate");

    // Edges should be rewritten through the ID map
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].source).toBe("file:src/good.ts");
    expect(result.edges[0].target).toBe("file:src/bad.ts");
    expect(result.edges[1].source).toBe("file:src/bare.ts");

    expect(result.stats.idsFixed).toBe(2);
    expect(result.stats.complexityFixed).toBe(1); // only the numeric one
    expect(result.stats.edgesRewritten).toBe(2);
    expect(result.stats.danglingEdgesDropped).toBe(0);
  });

  it("drops dangling edges after normalization", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          summary: "File A",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "file:src/nonexistent.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    expect(result.edges).toHaveLength(0);
    expect(result.stats.danglingEdgesDropped).toBe(1);
    expect(result.stats.droppedEdges).toHaveLength(1);
    expect(result.stats.droppedEdges[0]).toEqual({
      source: "file:src/a.ts",
      target: "file:src/nonexistent.ts",
      type: "imports",
      reason: "missing-target",
    });
  });

  it("deduplicates nodes keeping last occurrence", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          summary: "First version",
          tags: [],
          complexity: "simple",
        },
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          summary: "Second version",
          tags: ["updated"],
          complexity: "complex",
        },
      ],
      edges: [],
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].summary).toBe("Second version");
  });

  it("deduplicates edges after ID rewriting", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "file:src/a.ts",
          type: "file",
          name: "a.ts",
          summary: "A",
          tags: [],
          complexity: "simple",
        },
        {
          id: "file:src/b.ts",
          type: "file",
          name: "b.ts",
          summary: "B",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "file:src/a.ts",
          target: "file:src/b.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
        {
          source: "proj:file:src/a.ts",
          target: "file:src/b.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    // Both edges resolve to the same source after normalization — deduplicated
    expect(result.edges).toHaveLength(1);
  });

  it("returns accurate stats", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "file:src/ok.ts",
          type: "file",
          name: "ok.ts",
          summary: "OK",
          tags: [],
          complexity: "simple",
        },
        {
          id: "proj:file:src/fix.ts",
          type: "file",
          name: "fix.ts",
          summary: "Needs fix",
          tags: [],
          complexity: 2,
        },
      ],
      edges: [
        {
          source: "proj:file:src/fix.ts",
          target: "file:src/ok.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
        {
          source: "file:src/ok.ts",
          target: "file:src/gone.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    expect(result.stats.idsFixed).toBe(1);
    expect(result.stats.complexityFixed).toBe(1);
    expect(result.stats.edgesRewritten).toBe(1);
    expect(result.stats.danglingEdgesDropped).toBe(1);
    expect(result.edges).toHaveLength(1);
  });

  it("resolves edge endpoints with different malformed variants than node IDs", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "src/bare.ts",
          type: "file",
          name: "bare.ts",
          filePath: "src/bare.ts",
          summary: "Bare",
          tags: [],
          complexity: "simple",
        },
        {
          id: "file:src/target.ts",
          type: "file",
          name: "target.ts",
          filePath: "src/target.ts",
          summary: "Target",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "my-project:file:src/bare.ts",
          target: "file:src/target.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("file:src/bare.ts");
    expect(result.edges[0].target).toBe("file:src/target.ts");
  });
});

describe("normalizeBatchOutput integration", () => {
  it("produces output that passes validateGraph after wrapping", () => {
    const result = normalizeBatchOutput({
      nodes: [
        {
          id: "my-project:file:src/index.ts",
          type: "file",
          name: "index.ts",
          filePath: "src/index.ts",
          summary: "Entry point",
          tags: ["entry"],
          complexity: 3,
        },
        {
          id: "src/utils.ts",
          type: "file",
          name: "utils.ts",
          filePath: "src/utils.ts",
          summary: "Utilities",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [
        {
          source: "my-project:file:src/index.ts",
          target: "src/utils.ts",
          type: "imports",
          direction: "forward",
          weight: 0.7,
        },
      ],
    });

    const graph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "Test project",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: "abc123",
      },
      nodes: result.nodes,
      edges: result.edges,
      layers: [],
      tour: [],
    };

    const validation = validateGraph(graph);
    expect(validation.success).toBe(true);
    expect(validation.data?.nodes).toHaveLength(2);
    expect(validation.data?.edges).toHaveLength(1);
  });
});
