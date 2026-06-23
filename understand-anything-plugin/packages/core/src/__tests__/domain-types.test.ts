import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: [],
    description: "A test project",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:order-management",
      type: "domain",
      name: "Order Management",
      summary: "Handles order lifecycle",
      tags: ["core"],
      complexity: "complex",
    },
    {
      id: "flow:create-order",
      type: "flow",
      name: "Create Order",
      summary: "Customer submits a new order",
      tags: ["write-path"],
      complexity: "moderate",
      domainMeta: {
        entryPoint: "POST /api/orders",
        entryType: "http",
      },
    },
    {
      id: "step:create-order:validate",
      type: "step",
      name: "Validate Input",
      summary: "Checks request body",
      tags: ["validation"],
      complexity: "simple",
      filePath: "src/validators/order.ts",
      lineRange: [10, 30],
    },
  ],
  edges: [
    {
      source: "domain:order-management",
      target: "flow:create-order",
      type: "contains_flow",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "flow:create-order",
      target: "step:create-order:validate",
      type: "flow_step",
      direction: "forward",
      weight: 0.1,
    },
  ],
  layers: [],
  tour: [],
};

describe("domain graph types", () => {
  it("validates a domain graph with domain/flow/step node types", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(3);
    expect(result.data!.edges).toHaveLength(2);
  });

  it("validates contains_flow edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("contains_flow");
  });

  it("validates flow_step edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[1].type).toBe("flow_step");
  });

  it("validates cross_domain edge type", () => {
    const graph = structuredClone(domainGraph);
    graph.nodes.push({
      id: "domain:logistics",
      type: "domain",
      name: "Logistics",
      summary: "Handles shipping",
      tags: [],
      complexity: "moderate",
    });
    graph.edges.push({
      source: "domain:order-management",
      target: "domain:logistics",
      type: "cross_domain",
      direction: "forward",
      description: "Triggers on order confirmed",
      weight: 0.6,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });

  it("normalizes domain type aliases", () => {
    const graph = structuredClone(domainGraph);
    (graph.nodes[0] as any).type = "business_domain";
    (graph.nodes[1] as any).type = "business_flow";
    (graph.nodes[2] as any).type = "business_step";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("domain");
    expect(result.data!.nodes[1].type).toBe("flow");
    expect(result.data!.nodes[2].type).toBe("step");
  });

  it("normalizes domain edge type aliases", () => {
    const graph = structuredClone(domainGraph);
    (graph.edges[0] as any).type = "has_flow";
    (graph.edges[1] as any).type = "next_step";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("contains_flow");
    expect(result.data!.edges[1].type).toBe("flow_step");
  });

  it("preserves domainMeta on nodes through validation", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    const flowNode = result.data!.nodes.find((n) => n.id === "flow:create-order");
    expect((flowNode as any).domainMeta).toEqual({
      entryPoint: "POST /api/orders",
      entryType: "http",
    });
  });
});
