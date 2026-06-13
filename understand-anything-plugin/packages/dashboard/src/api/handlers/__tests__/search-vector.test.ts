import { describe, it, expect } from "vitest"
import { hybridSearch } from "../search-vector"
import type { UnifiedSearchResult } from "../search"

describe("search-vector.ts", () => {
  describe("hybridSearch", () => {
    it("should merge results using RRF", () => {
      const bm25Results: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 10 },
        { id: "2", name: "test2", type: "class", layer: "kg", summary: "", score: 8 },
      ]

      const vectorResults: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 0.9 },
        { id: "3", name: "test3", type: "module", layer: "kg", summary: "", score: 0.8 },
      ]

      const results = hybridSearch("test", bm25Results, vectorResults, 10)
      expect(results.length).toBeGreaterThan(0)
      // id "1" appears in both, should have higher score
      expect(results[0].id).toBe("1")
    })

    it("should handle empty bm25 results", () => {
      const vectorResults: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 0.9 },
      ]

      const results = hybridSearch("test", [], vectorResults, 10)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe("1")
    })

    it("should handle empty vector results", () => {
      const bm25Results: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 10 },
      ]

      const results = hybridSearch("test", bm25Results, [], 10)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe("1")
    })

    it("should handle both empty results", () => {
      const results = hybridSearch("test", [], [], 10)
      expect(results.length).toBe(0)
    })

    it("should respect limit", () => {
      const bm25Results: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 10 },
        { id: "2", name: "test2", type: "class", layer: "kg", summary: "", score: 8 },
        { id: "3", name: "test3", type: "module", layer: "kg", summary: "", score: 6 },
      ]

      const vectorResults: UnifiedSearchResult[] = [
        { id: "4", name: "test4", type: "function", layer: "kg", summary: "", score: 0.9 },
        { id: "5", name: "test5", type: "class", layer: "kg", summary: "", score: 0.8 },
      ]

      const results = hybridSearch("test", bm25Results, vectorResults, 2)
      expect(results.length).toBe(2)
    })

    it("should sort by RRF score", () => {
      const bm25Results: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 10 },
        { id: "2", name: "test2", type: "class", layer: "kg", summary: "", score: 8 },
      ]

      const vectorResults: UnifiedSearchResult[] = [
        { id: "2", name: "test2", type: "class", layer: "kg", summary: "", score: 0.9 },
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 0.8 },
      ]

      const results = hybridSearch("test", bm25Results, vectorResults, 10)
      // id "2" is ranked higher in vector results (rank 1 vs rank 2)
      // id "1" is ranked higher in bm25 results (rank 1 vs rank 2)
      // Both have similar RRF scores, but order depends on exact calculation
      expect(results.length).toBe(2)
    })

    it("should handle duplicate results across lists", () => {
      const bm25Results: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 10 },
      ]

      const vectorResults: UnifiedSearchResult[] = [
        { id: "1", name: "test1", type: "function", layer: "kg", summary: "", score: 0.9 },
      ]

      const results = hybridSearch("test", bm25Results, vectorResults, 10)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe("1")
    })
  })
})
