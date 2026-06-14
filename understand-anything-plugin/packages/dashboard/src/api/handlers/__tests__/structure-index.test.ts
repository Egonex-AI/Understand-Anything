import { describe, it, expect } from "vitest"
import { StructureIndex } from "../structure-index"
import type { StructuralAnalysis } from "../structure-index"

const mockData: StructuralAnalysis = {
  "src/UserService.java": {
    language: "java",
    totalLines: 100,
    functions: [
      {
        name: "getUser",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "User",
        annotations: [{ name: "@GetMapping" }],
      },
      {
        name: "createUser",
        startLine: 25,
        endLine: 35,
        params: [{ name: "dto", type: "CreateUserDto" }],
        returnType: "User",
        annotations: [{ name: "@PostMapping" }],
      },
    ],
    classes: [
      {
        name: "UserService",
        startLine: 1,
        endLine: 50,
        kind: "class",
        annotations: [{ name: "@Service" }],
        interfaces: ["CrudRepository"],
        typedProperties: [{ name: "repository", type: "UserRepository" }],
      },
    ],
    imports: [],
    exports: [],
  },
  "src/OrderService.java": {
    language: "java",
    totalLines: 80,
    functions: [
      {
        name: "getOrder",
        startLine: 10,
        endLine: 20,
        params: [{ name: "id", type: "Long" }],
        returnType: "Order",
      },
    ],
    classes: [
      {
        name: "OrderService",
        startLine: 1,
        endLine: 40,
        kind: "class",
        annotations: [{ name: "@Service" }],
      },
    ],
    imports: [],
    exports: [],
  },
}

describe("StructureIndex", () => {
  describe("fuzzy search", () => {
    it("finds by function name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results[0].name).toBe("getUser")
    })
    it("finds by class name", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "UserService" })
      expect(results.results.length).toBeGreaterThan(0)
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("finds by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.results.some((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
    it("cross-style match: get_user matches getUser", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get_user" })
      expect(results.results.some((r) => r.name === "getUser")).toBe(true)
    })
  })

  describe("precise filtering", () => {
    it("filters by annotation", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
    it("filters by paramType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ paramType: "Long" })
      expect(results.results.length).toBeGreaterThan(0)
    })
    it("filters by returnType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ returnType: "User" })
      expect(results.results.every((r) => r.returnType === "User")).toBe(true)
    })
    it("filters by interface", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ iface: "CrudRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("filters by propertyType", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ propertyType: "UserRepository" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("filters by sectionKey", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ sectionKey: "getUser" })
      expect(results.results.some((r) => r.name === "getUser")).toBe(true)
      expect(results.results.some((r) => r.name === "OrderService")).toBe(false)
    })
    it("filters by sectionValue", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ sectionValue: "UserService" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
  })

  describe("combined fuzzy + precise", () => {
    it("applies fuzzy search on filtered subset", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "get", annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
    })
  })

  describe("pagination", () => {
    it("returns first page", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 1, offset: 0 })
      expect(results.results.length).toBe(1)
      expect(results.hasMore).toBe(true)
    })
    it("returns second page", () => {
      const index = new StructureIndex("test-service", mockData)
      const page1 = index.search({ q: "Service", limit: 1, offset: 0 })
      const page2 = index.search({ q: "Service", limit: 1, offset: 1 })
      expect(page2.results[0].id).not.toBe(page1.results[0].id)
    })
    it("returns empty past end", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 10, offset: 100 })
      expect(results.results.length).toBe(0)
      expect(results.hasMore).toBe(false)
    })
  })

  describe("facets", () => {
    it("includes type distribution", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.facets).toBeDefined()
      expect(results.facets!.type).toBeDefined()
    })
  })

  describe("result fields", () => {
    it("every result has id", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.id)).toBe(true)
    })
    it("every result has service", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.service === "test-service")).toBe(true)
    })
    it("every result has filePath and lineRange", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      expect(results.results.every((r) => r.filePath && r.lineRange)).toBe(true)
    })
  })

  describe("empty data", () => {
    it("returns empty results for empty data", () => {
      const index = new StructureIndex("test-service", {})
      const results = index.search({ q: "anything" })
      expect(results.results.length).toBe(0)
      expect(results.total).toBe(0)
    })
  })

  describe("symbol filter", () => {
    it("filters results by symbol name substring", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", symbol: "User" })
      expect(results.results.every((r) => r.name.toLowerCase().includes("user"))).toBe(true)
    })
    it("symbol filter is case-insensitive", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", symbol: "user" })
      expect(results.results.some((r) => r.name === "UserService")).toBe(true)
    })
    it("symbol filter with no match returns empty", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", symbol: "NonExistent" })
      expect(results.results.length).toBe(0)
    })
  })

  describe("pathPattern filter", () => {
    it("filters by file path substring", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ pathPattern: "OrderService" })
      expect(results.results.every((r) => r.filePath.includes("OrderService"))).toBe(true)
    })
    it("pathPattern is case-insensitive", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ pathPattern: "orderservice" })
      expect(results.results.length).toBeGreaterThan(0)
    })
  })

  describe("filter-only mode (no q)", () => {
    it("returns all matching docs when only annotation specified", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ annotation: "@Service" })
      expect(results.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
      expect(results.results.length).toBe(2)
    })
    it("all results have score 0 in filter-only mode", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ annotation: "@Service" })
      expect(results.results.every((r) => r.score === 0)).toBe(true)
    })
  })

  describe("hasMore and total", () => {
    it("hasMore is true when more results exist", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 1 })
      expect(results.hasMore).toBe(true)
    })
    it("hasMore is false when all results returned", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 100 })
      expect(results.hasMore).toBe(false)
    })
    it("total reflects full count before pagination", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service", limit: 1 })
      expect(results.total).toBeGreaterThan(1)
    })
  })

  describe("summary field", () => {
    it("summary includes type, name, and filePath", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "getUser" })
      const r = results.results[0]
      expect(r.summary).toContain(r.type)
      expect(r.summary).toContain(r.name)
      expect(r.summary).toContain(r.filePath)
    })
  })

  describe("empty functions/classes in file", () => {
    it("handles file with empty functions and classes arrays", () => {
      const data: StructuralAnalysis = {
        "src/Empty.java": {
          language: "java",
          totalLines: 10,
          functions: [],
          classes: [],
          imports: [],
          exports: [],
        },
      }
      const index = new StructureIndex("test-service", data)
      expect(index.search({ q: "anything" }).results.length).toBe(0)
    })
    it("handles file with missing functions/classes fields", () => {
      const data = {
        "src/Sparse.java": {
          language: "java",
          totalLines: 5,
        },
      } as unknown as StructuralAnalysis
      const index = new StructureIndex("test-service", data)
      expect(index.search({ q: "anything" }).results.length).toBe(0)
    })
  })

  describe("facets include service", () => {
    it("service facet is computed", () => {
      const index = new StructureIndex("test-service", mockData)
      const results = index.search({ q: "Service" })
      expect(results.facets!.service).toBeDefined()
      expect(results.facets!.service["test-service"]).toBeGreaterThan(0)
    })
  })
})
