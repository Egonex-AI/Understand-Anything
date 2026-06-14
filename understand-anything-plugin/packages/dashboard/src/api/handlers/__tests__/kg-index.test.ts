import { describe, it, expect } from "vitest"
import { KgIndex } from "../kg-index"
import type { KnowledgeGraph } from "@understand-anything/core"

const mockKg: KnowledgeGraph = {
  nodes: [
    {
      id: "node::UserService",
      name: "UserService",
      type: "class",
      summary: "Handles user CRUD operations",
      tags: ["user", "service"],
      filePath: "src/UserService.java",
      lineRange: [1, 50],
      complexity: "moderate",
    },
    {
      id: "node::AuthController",
      name: "AuthController",
      type: "endpoint",
      summary: "Authentication endpoints",
      tags: ["auth", "controller"],
      filePath: "src/AuthController.java",
      lineRange: [1, 30],
      complexity: "simple",
    },
    {
      id: "node::DatabasePool",
      name: "DatabasePool",
      type: "class",
      summary: "Connection pooling",
      tags: ["database"],
      filePath: "src/DatabasePool.java",
      lineRange: [1, 40],
      complexity: "complex",
    },
  ],
  edges: [
    { source: "node::AuthController", target: "node::UserService", type: "uses", direction: "forward" },
  ],
} as unknown as KnowledgeGraph

describe("KgIndex", () => {
  describe("fuzzy search", () => {
    it("finds by name", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("UserService")
    })
    it("finds by summary", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "authentication" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
    it("finds by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "auth" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by type", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service", type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
    })
    it("filters by tag", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ tag: "auth" })
      expect(results.results.every((r) => r.tags?.includes("auth"))).toBe(true)
    })
    it("filters by service", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ service: "test-service" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
  })

  describe("pagination", () => {
    it("respects limit", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.results.length).toBe(1)
    })
    it("respects offset", () => {
      const index = new KgIndex(mockKg, "test-service")
      const page1 = index.search({ limit: 1, offset: 0 })
      const page2 = index.search({ limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
  })

  describe("facets", () => {
    it("includes type and service distribution", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
      expect(results.facets!.service).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })
    it("every result has score", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => typeof r.score === "number")).toBe(true)
    })
  })

  describe("empty graph", () => {
    it("returns empty results", () => {
      const index = new KgIndex({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
    })
  })

  describe("isEmpty / docCount", () => {
    it("isEmpty returns true for empty graph", () => {
      const index = new KgIndex({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      expect(index.isEmpty()).toBe(true)
    })
    it("isEmpty returns false for non-empty graph", () => {
      const index = new KgIndex(mockKg, "test-service")
      expect(index.isEmpty()).toBe(false)
    })
    it("docCount returns correct count", () => {
      const index = new KgIndex(mockKg, "test-service")
      expect(index.docCount()).toBe(3)
    })
    it("docCount returns 0 for empty graph", () => {
      const index = new KgIndex({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      expect(index.docCount()).toBe(0)
    })
  })

  describe("scope layer filtering", () => {
    const layerGraph = {
      nodes: [
        { id: "kg::1", name: "KgNode", type: "class", summary: "KG node", tags: ["service"] },
        { id: "domain::1", name: "DomainNode", type: "flow", summary: "Domain node", tags: ["domain"] },
        { id: "biz::1", name: "BizNode", type: "domain", summary: "Business node", tags: ["business"] },
      ],
      edges: [],
    } as unknown as KnowledgeGraph

    it("scope=kg returns only kg layer", () => {
      const index = new KgIndex(layerGraph, "svc")
      const results = index.search({ scope: "kg" })
      expect(results.results.every((r) => r.layer === "kg")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=domain returns only domain layer", () => {
      const index = new KgIndex(layerGraph, "svc")
      const results = index.search({ scope: "domain" })
      expect(results.results.every((r) => r.layer === "domain")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=business returns only business layer", () => {
      const index = new KgIndex(layerGraph, "svc")
      const results = index.search({ scope: "business" })
      expect(results.results.every((r) => r.layer === "business")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=all returns all layers", () => {
      const index = new KgIndex(layerGraph, "svc")
      const results = index.search({ scope: "all" })
      expect(results.results.length).toBe(3)
    })
  })

  describe("hasMore", () => {
    it("hasMore is true when more results exist", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.hasMore).toBe(true)
    })
    it("hasMore is false when all results returned", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ limit: 100 })
      expect(results.hasMore).toBe(false)
    })
    it("total reflects full result count", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.total).toBe(3)
    })
  })

  describe("filter-only mode (no q)", () => {
    it("returns all matching docs when only type specified", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
      expect(results.results.length).toBe(2)
    })
    it("all results have score 0 in filter-only mode", () => {
      const index = new KgIndex(mockKg, "test-service")
      const results = index.search({ type: "class" })
      expect(results.results.every((r) => r.score === 0)).toBe(true)
    })
  })

  describe("missing optional fields", () => {
    it("handles nodes with no summary, tags, filePath, lineRange", () => {
      const sparseGraph = {
        nodes: [
          { id: "sparse::1", name: "SparseNode", type: "class" },
        ],
        edges: [],
      } as unknown as KnowledgeGraph
      const index = new KgIndex(sparseGraph, "svc")
      expect(index.docCount()).toBe(1)
      const results = index.search({ q: "SparseNode" })
      expect(results.results.length).toBe(1)
      expect(results.results[0].summary).toBe("")
      expect(results.results[0].tags).toBe("")
      expect(results.results[0].filePath).toBe("")
      expect(results.results[0].lineRange).toBeUndefined()
    })
    it("handles null nodes array gracefully", () => {
      const index = new KgIndex({ nodes: null as unknown as never[], edges: [] } as unknown as KnowledgeGraph, "svc")
      expect(index.isEmpty()).toBe(true)
    })
  })

  describe("facets include layer", () => {
    it("layer facet is computed", () => {
      const layerGraph = {
        nodes: [
          { id: "kg::1", name: "KgNode", type: "class", tags: [] },
          { id: "biz::1", name: "BizNode", type: "domain", tags: ["business"] },
        ],
        edges: [],
      } as unknown as KnowledgeGraph
      const index = new KgIndex(layerGraph, "svc")
      const results = index.search({ q: "Node" })
      expect(results.facets!.layer).toBeDefined()
      expect(results.facets!.layer["kg"]).toBe(1)
      expect(results.facets!.layer["business"]).toBe(1)
    })
  })
})
