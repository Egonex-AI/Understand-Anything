import type { UnifiedSearchResult } from "./search"
import { rrfFuse } from "./rrf-fuse"

export interface VectorSearchIndex {
  vectors: Map<string, number[]>
  embedder: (text: string) => Promise<number[]>
  search(query: string, limit: number): Promise<UnifiedSearchResult[]>
}

export function hybridSearch(
  _query: string,
  bm25Results: UnifiedSearchResult[],
  vectorResults: UnifiedSearchResult[],
  limit: number,
): UnifiedSearchResult[] {
  return rrfFuse(
    [{ results: bm25Results }, { results: vectorResults }],
    limit,
  )
}
