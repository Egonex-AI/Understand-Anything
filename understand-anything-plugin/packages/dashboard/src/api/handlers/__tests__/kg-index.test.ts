import { describe, it, expect, beforeEach } from "vitest"
import { KgIndex, clearKgIndexCache } from "../kg-index"
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
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("UserService")
    })
    it("finds by summary", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "authentication" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
    it("finds by tag", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "auth" })
      expect(results.results.some((r) => r.name === "AuthController")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by type", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "Service", type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
    })
    it("filters by tag", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ tag: "auth" })
      expect(results.results.every((r) => r.tags?.includes("auth"))).toBe(true)
    })
    it("filters by service", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ service: "test-service" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
  })

  describe("pagination", () => {
    it("respects limit", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.results.length).toBe(1)
    })
    it("respects offset", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const page1 = index.search({ limit: 1, offset: 0 })
      const page2 = index.search({ limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
  })

  describe("facets", () => {
    it("includes type and service distribution", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
      expect(results.facets!.service).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })
    it("every result has score", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ q: "User" })
      expect(results.results.every((r) => typeof r.score === "number")).toBe(true)
    })
  })

  describe("empty graph", () => {
    it("returns empty results", () => {
      const index = KgIndex.create({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
    })
  })

  describe("isEmpty / docCount", () => {
    it("isEmpty returns true for empty graph", () => {
      const index = KgIndex.create({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
      expect(index.isEmpty()).toBe(true)
    })
    it("isEmpty returns false for non-empty graph", () => {
      const index = KgIndex.create(mockKg, "test-service")
      expect(index.isEmpty()).toBe(false)
    })
    it("docCount returns correct count", () => {
      const index = KgIndex.create(mockKg, "test-service")
      expect(index.docCount()).toBe(3)
    })
    it("docCount returns 0 for empty graph", () => {
      const index = KgIndex.create({ nodes: [], edges: [] } as unknown as KnowledgeGraph, "test-service")
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
      const index = KgIndex.create(layerGraph, "svc")
      const results = index.search({ scope: "kg" })
      expect(results.results.every((r) => r.layer === "kg")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=domain returns only domain layer", () => {
      const index = KgIndex.create(layerGraph, "svc")
      const results = index.search({ scope: "domain" })
      expect(results.results.every((r) => r.layer === "domain")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=business returns only business layer", () => {
      const index = KgIndex.create(layerGraph, "svc")
      const results = index.search({ scope: "business" })
      expect(results.results.every((r) => r.layer === "business")).toBe(true)
      expect(results.results.length).toBe(1)
    })
    it("scope=all returns all layers", () => {
      const index = KgIndex.create(layerGraph, "svc")
      const results = index.search({ scope: "all" })
      expect(results.results.length).toBe(3)
    })
  })

  describe("hasMore", () => {
    it("hasMore is true when more results exist", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.hasMore).toBe(true)
    })
    it("hasMore is false when all results returned", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ limit: 100 })
      expect(results.hasMore).toBe(false)
    })
    it("total reflects full result count", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ limit: 1 })
      expect(results.total).toBe(3)
    })
  })

  describe("filter-only mode (no q)", () => {
    it("returns all matching docs when only type specified", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ type: "class" })
      expect(results.results.every((r) => r.type === "class")).toBe(true)
      expect(results.results.length).toBe(2)
    })
    it("all results have score 0 in filter-only mode", () => {
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ type: "class" })
      expect(results.results.every((r) => r.score === 0)).toBe(true)
    })
    it("preserves each doc's own id in filter-only mode", () => {
      // Guards the no-query map step `{ ...doc, score: 0 }`: a previous
      // `{ id: doc.id, score: 0, ...doc }` spread specified `id` twice, which
      // TS flagged as a silent overwrite. The id must be the doc's own id.
      const index = KgIndex.create(mockKg, "test-service")
      const results = index.search({ type: "class" })
      const ids = results.results.map((r) => r.id).sort()
      expect(ids).toEqual(["node::DatabasePool", "node::UserService"])
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
      const index = KgIndex.create(sparseGraph, "svc")
      expect(index.docCount()).toBe(1)
      const results = index.search({ q: "SparseNode" })
      expect(results.results.length).toBe(1)
      expect(results.results[0].summary).toBe("")
      expect(results.results[0].tags).toBe("")
      expect(results.results[0].filePath).toBe("")
      expect(results.results[0].lineRange).toBeUndefined()
    })
    it("handles null nodes array gracefully", () => {
      const index = KgIndex.create({ nodes: null as unknown as never[], edges: [] } as unknown as KnowledgeGraph, "svc")
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
      const index = KgIndex.create(layerGraph, "svc")
      const results = index.search({ q: "Node" })
      expect(results.facets!.layer).toBeDefined()
      expect(results.facets!.layer["kg"]).toBe(1)
      expect(results.facets!.layer["business"]).toBe(1)
    })
  })

  describe("knowledge metadata indexing", () => {
    it("finds requirements by PRD detail text that is not in the node name", () => {
      const prdGraph = {
        nodes: [
          {
            id: "requirement:room-pk",
            name: "房间玩法",
            type: "requirement",
            summary: "房间相关需求",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              sourceType: "prd",
              business: "房间",
              version: "v2.25.0",
              detail: "跨房间 PK 断线重连",
              sourcePath: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md",
              content: "观众重新进入后需要恢复 PK 进度。",
            },
          },
          {
            id: "testcase:room-pk-reconnect",
            name: "房间 PK 用例",
            type: "testcase",
            summary: "房间 PK 测试用例",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              sourceType: "testcase",
              business: "房间",
              version: "v2.25.0",
              detail: "跨房间 PK 断线重连用例",
              sourcePath: "raw/prd/房间/2025-10-v2.25.0-跨房间PK-testcase.md",
              content: "验证断线重连后的用例状态。",
            },
          },
        ],
        edges: [],
      } as unknown as KnowledgeGraph

      const index = KgIndex.create(prdGraph, "amar-prd")
      const results = index.search({ q: "断线重连", type: "requirement" })

      expect(results.results).toHaveLength(1)
      expect(results.results[0].id).toBe("requirement:room-pk")
      expect(results.results[0].service).toBe("amar-prd")
      expect(results.results[0].business).toBe("房间")
      expect(results.results[0].sourcePath).toContain("raw/prd")
    })

    it("finds requirements by PRD content text that is not in the node name", () => {
      const prdGraph = {
        nodes: [
          {
            id: "requirement:room-pk",
            name: "房间玩法",
            type: "requirement",
            summary: "房间相关需求",
            tags: ["prd"],
            knowledgeMeta: {
              profile: "prd-wiki",
              sourceType: "prd",
              business: "房间",
              version: "v2.25.0",
              detail: "跨房间 PK 断线重连",
              sourcePath: "raw/prd/房间/2025-10-v2.25.0-跨房间PK.md",
              content: "观众重新进入后需要恢复 PK 进度。",
            },
          },
        ],
        edges: [],
      } as unknown as KnowledgeGraph

      const index = KgIndex.create(prdGraph, "amar-prd")
      const results = index.search({ q: "恢复 PK 进度", type: "requirement" })

      expect(results.results).toHaveLength(1)
      expect(results.results[0].id).toBe("requirement:room-pk")
      expect(results.results[0].service).toBe("amar-prd")
    })

    it("indexes knowledge markdown link labels and targets", () => {
      const graph = {
        version: "1.0.0",
        project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
        layers: [],
        tour: [],
        nodes: [
          {
            id: "requirement:1",
            type: "requirement",
            name: "需求",
            summary: "普通摘要",
            tags: [],
            complexity: "simple",
            knowledgeMeta: {
              markdownLinks: [
                { label: "跨房间PK", target: "../summaries/room-pk.md", fragment: null },
              ],
            },
          },
        ],
        edges: [],
      }

      const index = KgIndex.create(graph as never, "amar-prd")
      const labelResult = index.search({ q: "跨房间PK", limit: 5 })
      const targetResult = index.search({ q: "summaries room pk", limit: 5 })

      expect(labelResult.results[0]?.id).toBe("requirement:1")
      expect(targetResult.results[0]?.id).toBe("requirement:1")
    })
  })

  describe("cache", () => {
    beforeEach(() => {
      clearKgIndexCache()
    })

    it("returns cached index for same graph reference", () => {
      const index1 = KgIndex.create(mockKg, "test-service")
      const index2 = KgIndex.create(mockKg, "test-service")
      expect(index1).toBe(index2)
    })

    it("returns new index for different graph reference", () => {
      const graph2 = {
        nodes: [{ id: "other::1", name: "Other", type: "class", summary: "other" }],
        edges: [],
      } as unknown as KnowledgeGraph
      const index1 = KgIndex.create(mockKg, "test-service")
      const index2 = KgIndex.create(graph2, "test-service")
      expect(index1).not.toBe(index2)
    })

    it("clearKgIndexCache forces rebuild on next construction", () => {
      const index1 = KgIndex.create(mockKg, "test-service")
      clearKgIndexCache()
      const index2 = KgIndex.create(mockKg, "test-service")
      expect(index1).not.toBe(index2)
    })

    it("clearKgIndexCache is exported and callable", () => {
      expect(typeof clearKgIndexCache).toBe("function")
      expect(() => clearKgIndexCache()).not.toThrow()
    })
  })
})
