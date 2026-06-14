import { describe, it, expect } from "vitest"
import { WikiIndex } from "../wiki-index"

const mockWiki = {
  entries: [
    {
      id: "wiki::auth",
      name: "Authentication",
      summary: "How authentication works",
      content: "JWT tokens are used for auth",
      type: "concept",
      service: "auth-service",
    },
    {
      id: "wiki::database",
      name: "Database",
      summary: "Database architecture",
      content: "PostgreSQL with connection pooling",
      type: "concept",
      service: "db-service",
    },
  ],
}

describe("WikiIndex", () => {
  it("finds by name", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "Authentication" })
    expect(results.results.length).toBeGreaterThan(0)
    expect(results.results[0].name).toBe("Authentication")
  })
  it("finds by content", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "PostgreSQL" })
    expect(results.results.some((r) => r.name === "Database")).toBe(true)
  })
  it("filters by service", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ service: "auth-service" })
    expect(results.results.every((r) => r.service === "auth-service")).toBe(true)
  })
  it("paginates results", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth", limit: 1, offset: 0 })
    expect(results.results.length).toBeLessThanOrEqual(1)
  })
  it("includes facets", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.facets).toBeDefined()
  })
  it("every result has id", () => {
    const index = new WikiIndex(mockWiki)
    const results = index.search({ q: "auth" })
    expect(results.results.every((r) => r.id)).toBe(true)
  })
  it("returns empty for empty wiki", () => {
    const index = new WikiIndex({ entries: [] })
    const results = index.search({ q: "anything" })
    expect(results.results.length).toBe(0)
  })

  describe("isEmpty / docCount", () => {
    it("isEmpty returns true for empty wiki", () => {
      const index = new WikiIndex({ entries: [] })
      expect(index.isEmpty()).toBe(true)
    })
    it("isEmpty returns false for non-empty wiki", () => {
      const index = new WikiIndex(mockWiki)
      expect(index.isEmpty()).toBe(false)
    })
    it("docCount returns correct count", () => {
      const index = new WikiIndex(mockWiki)
      expect(index.docCount()).toBe(2)
    })
  })

  describe("addDocs", () => {
    it("adds new docs and makes them searchable", () => {
      const index = new WikiIndex({ entries: [] })
      index.addDocs([
        { id: "wiki::cache", name: "Cache", summary: "Redis caching", type: "concept", service: "cache-svc" },
      ])
      expect(index.isEmpty()).toBe(false)
      expect(index.docCount()).toBe(1)
      const results = index.search({ q: "Redis" })
      expect(results.results.some((r) => r.name === "Cache")).toBe(true)
    })
    it("deduplicates by id", () => {
      const index = new WikiIndex(mockWiki)
      index.addDocs([
        { id: "wiki::auth", name: "Auth Dup", summary: "duplicate", type: "concept" },
        { id: "wiki::new", name: "New Entry", summary: "fresh", type: "concept" },
      ])
      expect(index.docCount()).toBe(3)
      const results = index.search({ q: "Auth" })
      expect(results.results[0].name).toBe("Authentication")
    })
  })
})
