import type { UnifiedSearchResult } from "./search"

const RRF_K = 60

export interface RankedResults {
  /** Items in rank order — index 0 = rank 1. */
  results: UnifiedSearchResult[]
  /**
   * Optional fallback: resolve an ID not present in `results` into a
   * UnifiedSearchResult (used by callers that have a separate lookup table,
   * e.g. a knowledge-graph adjacency expansion).
   */
  resolve?: (id: string) => UnifiedSearchResult | undefined
  /** Pre-computed rank map (id -> rank). When provided, entries are used instead of iterating `results`. */
  rankMap?: Map<string, number>
}

/**
 * Fuse multiple ranked result lists using Reciprocal Rank Fusion (RRF).
 *
 * Each entry in `rankedLists` contributes a score of `1 / (RRF_K + rank)` per
 * result. Scores for the same ID across lists are summed. The final list is
 * sorted descending by the fused score and truncated to `limit`.
 */
export function rrfFuse(
  rankedLists: RankedResults[],
  limit: number,
): UnifiedSearchResult[] {
  const rrfScores = new Map<string, number>()
  const resultById = new Map<string, UnifiedSearchResult>()

  for (const list of rankedLists) {
    if (list.rankMap) {
      for (const [id, rank] of list.rankMap) {
        rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (RRF_K + rank))
        if (!resultById.has(id)) {
          const resolved = list.resolve?.(id)
          if (resolved) resultById.set(id, resolved)
        }
      }
    } else {
      for (let i = 0; i < list.results.length; i++) {
        const r = list.results[i]
        const rank = i + 1
        rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (RRF_K + rank))
        if (!resultById.has(r.id)) {
          resultById.set(r.id, r)
        }
      }
    }
  }

  const fused = [...rrfScores.entries()]
    .map(([id, rrfScore]) => {
      const result = resultById.get(id)
      if (!result) return null
      return { ...result, score: rrfScore }
    })
    .filter(Boolean) as UnifiedSearchResult[]

  fused.sort((a, b) => b.score - a.score)
  return fused.slice(0, limit)
}
