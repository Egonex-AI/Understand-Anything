import type { SearchResult } from "./search"

export interface VectorSearchIndex {
  vectors: Map<string, number[]>
  embedder: (text: string) => Promise<number[]>
  search(query: string, limit: number): Promise<SearchResult[]>
}

export function hybridSearch(
  query: string,
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  limit: number,
): SearchResult[] {
  const RRF_K = 60
  const rrfScores = new Map<string, number>()
  const resultById = new Map<string, SearchResult>()

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i]
    const rank = i + 1
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (RRF_K + rank))
    resultById.set(r.id, r)
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i]
    const rank = i + 1
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (RRF_K + rank))
    if (!resultById.has(r.id)) {
      resultById.set(r.id, r)
    }
  }

  const fused = [...rrfScores.entries()]
    .map(([id, rrfScore]) => {
      const result = resultById.get(id)
      if (!result) return null
      return { ...result, score: rrfScore }
    })
    .filter(Boolean) as SearchResult[]

  fused.sort((a, b) => b.score - a.score)
  return fused.slice(0, limit)
}
