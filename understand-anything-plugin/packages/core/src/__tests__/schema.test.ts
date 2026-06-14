import { describe, it, expect } from "vitest";
import {
  validateGraph,
  sanitizeGraph,
  autoFixGraph,
  NODE_TYPE_ALIASES,
  EDGE_TYPE_ALIASES,
} from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

const validGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["vitest"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "node-1",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      lineRange: [1, 50],
      summary: "Entry point",
      tags: ["entry"],
      complexity: "simple",
    },
  ],
  edges: [
    {
      source: "node-1",
      target: "node-1",
      type: "imports",
      direction: "forward",
      weight: 0.8,
    },
  ],
  layers: [
    {
      id: "layer-1",
      name: "Core",
      description: "Core layer",
      nodeIds: ["node-1"],
    },
  ],
  tour: [
    {
      order: 1,
      title: "Start here",
      description: "Begin with the entry point",
      nodeIds: ["node-1"],
    },
  ],
};

describe("schema validation", () => {
  it("validates a correct knowledge graph", () => {
    const result = validateGraph(validGraph);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.version).toBe("1.0.0");
    expect(result.issues).toEqual([]);
  });

  it("preserves the kind field for knowledge graphs", () => {
    const graph = structuredClone(validGraph);
    (graph as any).kind = "knowledge";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.kind).toBe("knowledge");
  });

  it("leaves kind undefined when the input omits it", () => {
    const result = validateGraph(validGraph);
    expect(result.success).toBe(true);
    expect(result.data!.kind).toBeUndefined();
  });

  it("rejects graph with missing required fields", () => {
    const incomplete = { version: "1.0.0" };
    const result = validateGraph(incomplete);
    expect(result.success).toBe(false);
    expect(result.fatal).toBeDefined();
  });

  it("rejects node with invalid type — drops node, fatal if none remain", () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "invalid_type";

    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("No valid nodes");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-node" })
    );
  });

  it("drops edge with invalid EdgeType but loads graph", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "not_a_real_edge_type";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-edge" })
    );
  });

  it("auto-corrects weight >1 by clamping", () => {
    const graph = structuredClone(validGraph);
    graph.edges[0].weight = 1.5;

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "out-of-range" })
    );
  });

  it("auto-corrects weight <0 by clamping", () => {
    const graph = structuredClone(validGraph);
    graph.edges[0].weight = -0.1;

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "out-of-range" })
    );
  });

  it('normalizes "func" node type to "function"', () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "func";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("function");
  });

  it('normalizes "fn" node type to "function"', () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "fn";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("function");
  });

  it('normalizes "method" node type to "function"', () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "method";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("function");
  });

  it('normalizes "interface" node type to "class"', () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "interface";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("class");
  });

  it('normalizes "struct" node type to "class"', () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "struct";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("class");
  });

  it("normalizes multiple aliased node types in one graph", () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "func";
    graph.nodes.push({
      id: "node-2",
      type: "file" as any,
      name: "utils.ts",
      filePath: "src/utils.ts",
      lineRange: [1, 30],
      summary: "Utility helpers",
      tags: ["utils"],
      complexity: "simple",
    });
    (graph.nodes[1] as any).type = "pkg";
    graph.nodes.push({
      id: "node-3",
      type: "file" as any,
      name: "MyClass.ts",
      filePath: "src/MyClass.ts",
      lineRange: [1, 80],
      summary: "A class",
      tags: ["class"],
      complexity: "moderate",
    });
    (graph.nodes[2] as any).type = "struct";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("function");
    expect(result.data!.nodes[1].type).toBe("module");
    expect(result.data!.nodes[2].type).toBe("class");
  });

  it('normalizes "extends" edge type to "inherits"', () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "extends";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("inherits");
  });

  it('normalizes "invokes" edge type to "calls"', () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "invokes";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("calls");
  });

  it('normalizes "relates_to" edge type to "related"', () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "relates_to";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("related");
  });

  it('normalizes "uses" edge type to "depends_on"', () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "uses";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("depends_on");
  });

  it('drops "tests" edge type — direction-inverting alias is unsafe', () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "tests";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped" })
    );
  });

  it("drops truly invalid edge types after normalization", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "totally_bogus";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped" })
    );
  });

  it("NODE_TYPE_ALIASES values are never alias keys (no chains)", () => {
    for (const [alias, target] of Object.entries(NODE_TYPE_ALIASES)) {
      expect(
        NODE_TYPE_ALIASES,
        `chain detected: ${alias} → ${target} → ${NODE_TYPE_ALIASES[target]}`,
      ).not.toHaveProperty(target);
    }
  });

  it("EDGE_TYPE_ALIASES values are never alias keys (no chains)", () => {
    for (const [alias, target] of Object.entries(EDGE_TYPE_ALIASES)) {
      expect(
        EDGE_TYPE_ALIASES,
        `chain detected: ${alias} → ${target} → ${EDGE_TYPE_ALIASES[target]}`,
      ).not.toHaveProperty(target);
    }
  });
});

describe("sanitizeGraph", () => {
  it("converts null optional node fields to undefined", () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).filePath = null;
    (graph.nodes[0] as any).lineRange = null;
    (graph.nodes[0] as any).languageNotes = null;

    const result = sanitizeGraph(graph as any);
    const node = (result as any).nodes[0];
    expect(node.filePath).toBeUndefined();
    expect(node.lineRange).toBeUndefined();
    expect(node.languageNotes).toBeUndefined();
  });

  it("converts null optional edge fields to undefined", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).description = null;

    const result = sanitizeGraph(graph as any);
    const edge = (result as any).edges[0];
    expect(edge.description).toBeUndefined();
  });

  it("lowercases enum-like strings on nodes", () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).type = "FILE";
    (graph.nodes[0] as any).complexity = "Simple";

    const result = sanitizeGraph(graph as any);
    const node = (result as any).nodes[0];
    expect(node.type).toBe("file");
    expect(node.complexity).toBe("simple");
  });

  it("lowercases enum-like strings on edges", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).type = "IMPORTS";
    (graph.edges[0] as any).direction = "Forward";

    const result = sanitizeGraph(graph as any);
    const edge = (result as any).edges[0];
    expect(edge.type).toBe("imports");
    expect(edge.direction).toBe("forward");
  });

  it("converts null tour/layers to empty arrays", () => {
    const graph = structuredClone(validGraph);
    (graph as any).tour = null;
    (graph as any).layers = null;

    const result = sanitizeGraph(graph as any);
    expect((result as any).tour).toEqual([]);
    expect((result as any).layers).toEqual([]);
  });

  it("converts null optional tour step fields to undefined", () => {
    const graph = structuredClone(validGraph);
    (graph.tour[0] as any).languageLesson = null;

    const result = sanitizeGraph(graph as any);
    expect((result as any).tour[0].languageLesson).toBeUndefined();
  });

  it("passes through non-object node/edge items unchanged", () => {
    const graph = { nodes: [null, "garbage", 42], edges: [null], tour: [], layers: [] };
    const result = sanitizeGraph(graph as any);
    expect((result as any).nodes).toEqual([null, "garbage", 42]);
    expect((result as any).edges).toEqual([null]);
  });
});

describe("autoFixGraph", () => {
  it("defaults missing complexity to moderate with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).complexity;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes[0].complexity).toBe("moderate");
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "nodes[0].complexity" })
    );
  });

  it("maps complexity aliases with issue", () => {
    const graph = structuredClone(validGraph);
    (graph.nodes[0] as any).complexity = "low";

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes[0].complexity).toBe("simple");
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe("auto-corrected");
  });

  it("maps all complexity aliases correctly", () => {
    const mapping: Record<string, string> = {
      low: "simple", easy: "simple",
      medium: "moderate", intermediate: "moderate",
      high: "complex", hard: "complex", difficult: "complex",
    };
    for (const [alias, expected] of Object.entries(mapping)) {
      const graph = structuredClone(validGraph);
      (graph.nodes[0] as any).complexity = alias;
      const { data } = autoFixGraph(graph as any);
      expect((data as any).nodes[0].complexity).toBe(expected);
    }
  });

  it("defaults missing tags to empty array with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).tags;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes[0].tags).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "nodes[0].tags" })
    );
  });

  it("defaults missing summary to node name with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).summary;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes[0].summary).toBe("index.ts");
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "nodes[0].summary" })
    );
  });

  it("defaults missing node type to file with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).type;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes[0].type).toBe("file");
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "nodes[0].type" })
    );
  });

  it("defaults missing direction to forward with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.edges[0] as any).direction;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).edges[0].direction).toBe("forward");
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "edges[0].direction" })
    );
  });

  it("maps direction aliases with issue", () => {
    const mapping: Record<string, string> = {
      to: "forward", outbound: "forward",
      from: "backward", inbound: "backward",
      both: "bidirectional", mutual: "bidirectional",
    };
    for (const [alias, expected] of Object.entries(mapping)) {
      const graph = structuredClone(validGraph);
      (graph.edges[0] as any).direction = alias;
      const { data } = autoFixGraph(graph as any);
      expect((data as any).edges[0].direction).toBe(expected);
    }
  });

  it("defaults missing weight to 0.5 with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.edges[0] as any).weight;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).edges[0].weight).toBe(0.5);
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "edges[0].weight" })
    );
  });

  it("coerces string weight to number with issue", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).weight = "0.8";

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).edges[0].weight).toBe(0.8);
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "type-coercion", path: "edges[0].weight" })
    );
  });

  it("clamps out-of-range weight with issue", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).weight = 1.5;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).edges[0].weight).toBe(1);
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "out-of-range", path: "edges[0].weight" })
    );
  });

  it("defaults missing edge type to depends_on with issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.edges[0] as any).type;

    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).edges[0].type).toBe("depends_on");
    expect(issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "missing-field", path: "edges[0].type" })
    );
  });

  it("returns no issues for a valid graph", () => {
    const { issues } = autoFixGraph(validGraph as any);
    expect(issues).toEqual([]);
  });

  it("passes through non-object node/edge items unchanged", () => {
    const graph = { nodes: [null, "garbage"], edges: [null], tour: [], layers: [] };
    const { data, issues } = autoFixGraph(graph as any);
    expect((data as any).nodes).toEqual([null, "garbage"]);
    expect((data as any).edges).toEqual([null]);
    expect(issues).toEqual([]);
  });
});

describe("permissive validation", () => {
  it("drops nodes missing id with dropped issue", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).id;
    // Add a second valid node so graph isn't fatal
    graph.nodes.push({
      id: "node-2", type: "file", name: "other.ts",
      summary: "Other file", tags: ["util"], complexity: "simple",
    });

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes.length).toBe(1);
    expect(result.data!.nodes[0].id).toBe("node-2");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-node" })
    );
  });

  it("drops edges referencing non-existent nodes with dropped issue", () => {
    const graph = structuredClone(validGraph);
    graph.edges[0].target = "non-existent-node";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges.length).toBe(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-reference" })
    );
  });

  it("returns fatal when 0 valid nodes remain", () => {
    const graph = structuredClone(validGraph);
    delete (graph.nodes[0] as any).id;

    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("No valid nodes");
  });

  it("returns fatal when project metadata is missing", () => {
    const graph = structuredClone(validGraph);
    delete (graph as any).project;

    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("project metadata");
  });

  it("returns fatal when input is not an object", () => {
    const result = validateGraph("not an object");
    expect(result.success).toBe(false);
    expect(result.fatal).toContain("Invalid input");
  });

  it("loads graph with mixed good and bad nodes", () => {
    const graph = structuredClone(validGraph);
    // Add a good node
    graph.nodes.push({
      id: "node-2", type: "function", name: "doThing",
      summary: "Does a thing", tags: ["util"], complexity: "moderate",
    });
    // Add a bad node (missing id AND name -- unrecoverable)
    (graph.nodes as any[]).push({ type: "file", summary: "broken" });

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes.length).toBe(2);
    expect(result.issues.some((i) => i.level === "dropped")).toBe(true);
  });

  it("filters dangling nodeIds from layers", () => {
    const graph = structuredClone(validGraph);
    graph.layers[0].nodeIds.push("non-existent-node");

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.layers[0].nodeIds).toEqual(["node-1"]);
  });

  it("filters dangling nodeIds from tour steps", () => {
    const graph = structuredClone(validGraph);
    graph.tour[0].nodeIds.push("non-existent-node");

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.tour[0].nodeIds).toEqual(["node-1"]);
  });

  it("returns empty issues array for a perfect graph", () => {
    const result = validateGraph(validGraph);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.errors).toBeUndefined();
  });

  it("auto-corrects and loads graph that would have failed strict validation", () => {
    // Graph with many Tier 2 issues: missing complexity, weight as string, null filePath
    const messy = {
      version: "1.0.0",
      project: validGraph.project,
      nodes: [{
        id: "n1", type: "FILE", name: "app.ts",
        filePath: null, summary: "App entry",
        tags: null, complexity: "HIGH",
      }],
      edges: [{
        source: "n1", target: "n1", type: "CALLS",
        direction: "TO", weight: "0.9",
      }],
      layers: [{ id: "l1", name: "Core", description: "Core", nodeIds: ["n1"] }],
      tour: [],
    };

    const result = validateGraph(messy);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].complexity).toBe("complex");
    expect(result.data!.nodes[0].tags).toEqual([]);
    expect(result.data!.edges[0].weight).toBe(0.9);
    expect(result.data!.edges[0].direction).toBe("forward");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.level === "auto-corrected")).toBe(true);
  });

  it("handles non-parseable string weight by defaulting to 0.5", () => {
    const graph = structuredClone(validGraph);
    (graph.edges[0] as any).weight = "not_a_number";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].weight).toBe(0.5);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "auto-corrected", category: "type-coercion" })
    );
  });

  it("returns fatal when edges is present but not an array", () => {
    const graph = structuredClone(validGraph) as any;
    graph.edges = { source: "node-1", target: "node-1" };

    const result = validateGraph(graph);
    expect(result.success).toBe(false);
    expect(result.fatal).toContain('"edges" must be an array');
    expect(result.errors).toContain('"edges" must be an array when present');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        level: "fatal",
        category: "invalid-collection",
        path: "edges",
      })
    );
  });

  it("preserves deprecated errors for dropped-item callers", () => {
    const graph = structuredClone(validGraph);
    graph.edges[0].target = "non-existent-node";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.errors).toContain('edges[0]: target "non-existent-node" does not exist in nodes — removed');
  });
});

describe("Extended node/edge types", () => {
  it("validates nodes with new types: config, document, service, table, endpoint, pipeline, schema, resource", () => {
    const newTypes = ["config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource"];
    for (const type of newTypes) {
      const graph = structuredClone(validGraph);
      (graph.nodes[0] as any).type = type;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.nodes[0].type).toBe(type);
    }
  });

  it("validates edges with new types: deploys, serves, migrates, documents, provisions, routes, defines_schema, triggers", () => {
    const newTypes = ["deploys", "serves", "migrates", "documents", "provisions", "routes", "defines_schema", "triggers"];
    for (const type of newTypes) {
      const graph = structuredClone(validGraph);
      (graph.edges[0] as any).type = type;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges[0].type).toBe(type);
    }
  });

  it("auto-fixes new node type aliases: container->service, doc->document, business_flow->flow, etc.", () => {
    const aliases: Record<string, string> = {
      container: "service",
      doc: "document",
      business_flow: "flow",
      route: "endpoint",
      setting: "config",
      infra: "resource",
      migration: "table",
    };
    for (const [alias, canonical] of Object.entries(aliases)) {
      const graph = structuredClone(validGraph);
      (graph.nodes[0] as any).type = alias;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.nodes[0].type).toBe(canonical);
    }
  });

  it("auto-fixes new edge type aliases: describes->documents, creates->provisions, exposes->serves", () => {
    const aliases: Record<string, string> = {
      describes: "documents",
      creates: "provisions",
      exposes: "serves",
    };
    for (const [alias, canonical] of Object.entries(aliases)) {
      const graph = structuredClone(validGraph);
      (graph.edges[0] as any).type = alias;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges[0].type).toBe(canonical);
    }
  });

  it("accepts node with bare string ID (schema is lenient on format)", () => {
    const graph = structuredClone(validGraph);
    graph.nodes[0].id = "src/foo.ts";

    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });
});
