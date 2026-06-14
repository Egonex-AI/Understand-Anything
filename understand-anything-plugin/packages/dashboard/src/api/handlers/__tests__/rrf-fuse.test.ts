import { describe, it, expect } from "vitest"
import { rrfFuse } from "../rrf-fuse"
import type { UnifiedSearchResult } from "../search"

function makeResult(id: string, name = id): UnifiedSearchResult {
  return { id, name, type: "class", layer: "kg", summary: name, score: 1 }
}

describe("rrfFuse", () => {
  it("fuses a single ranked list preserving order", () => {
    const a = makeResult("a", "Alice")
    const b = makeResult("b", "Bob")
    const result = rrfFuse([{ results: [a, b] }], 10)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe("a")
    expect(result[1].id).toBe("b")
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  it("fuses two lists — same ID gets summed score", () => {
    const a = makeResult("a", "Alice")
    const b = makeResult("b", "Bob")
    const c = makeResult("c", "Carol")
    const result = rrfFuse(
      [{ results: [a, b] }, { results: [b, c] }],
      10,
    )
    expect(result[0].id).toBe("b")
    const ids = result.map((r) => r.id)
    expect(ids).toContain("a")
    expect(ids).toContain("c")
  })

  it("respects limit parameter", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeResult(String(i)))
    const result = rrfFuse([{ results: items }], 3)
    expect(result.length).toBe(3)
  })

  it("handles empty ranked list", () => {
    const result = rrfFuse([{ results: [] }], 10)
    expect(result.length).toBe(0)
  })

  it("handles multiple empty lists", () => {
    const result = rrfFuse([{ results: [] }, { results: [] }], 10)
    expect(result.length).toBe(0)
  })

  describe("rankMap path", () => {
    it("uses pre-computed rankMap instead of results iteration", () => {
      const rankMap = new Map<string, number>([
        ["x", 1],
        ["y", 2],
        ["z", 3],
      ])
      const resolve = (id: string): UnifiedSearchResult | undefined => {
        const map: Record<string, UnifiedSearchResult> = {
          x: makeResult("x", "Xavier"),
          y: makeResult("y", "Yara"),
          z: makeResult("z", "Zoe"),
        }
        return map[id]
      }
      const result = rrfFuse([{ results: [], rankMap, resolve }], 10)
      expect(result.length).toBe(3)
      expect(result[0].id).toBe("x")
      expect(result[0].name).toBe("Xavier")
    })

    it("rankMap entries without resolve skip unresolvable IDs", () => {
      const rankMap = new Map<string, number>([
        ["found", 1],
        ["missing", 2],
      ])
      const result = rrfFuse([{ results: [], rankMap }], 10)
      expect(result.length).toBe(0)
    })

    it("rankMap with resolve that returns undefined for some IDs", () => {
      const rankMap = new Map<string, number>([
        ["found", 1],
        ["missing", 2],
      ])
      const resolve = (id: string) =>
        id === "found" ? makeResult("found", "Found") : undefined
      const result = rrfFuse([{ results: [], rankMap, resolve }], 10)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe("found")
    })
  })

  describe("mixed results + rankMap", () => {
    it("combines results list with rankMap list", () => {
      const a = makeResult("a", "Alice")
      const rankMap = new Map<string, number>([["b", 1]])
      const resolve = (id: string) =>
        id === "b" ? makeResult("b", "Bob") : undefined
      const result = rrfFuse(
        [
          { results: [a] },
          { results: [], rankMap, resolve },
        ],
        10,
      )
      expect(result.length).toBe(2)
      const ids = result.map((r) => r.id)
      expect(ids).toContain("a")
      expect(ids).toContain("b")
    })
  })

  describe("score calculation", () => {
    it("RRF score = 1/(60+rank)", () => {
      const a = makeResult("a")
      const result = rrfFuse([{ results: [a] }], 10)
      expect(result[0].score).toBeCloseTo(1 / 61, 10)
    })

    it("scores decrease with rank", () => {
      const items = Array.from({ length: 3 }, (_, i) => makeResult(String(i)))
      const result = rrfFuse([{ results: items }], 10)
      expect(result[0].score).toBeGreaterThan(result[1].score)
      expect(result[1].score).toBeGreaterThan(result[2].score)
    })
  })
})
