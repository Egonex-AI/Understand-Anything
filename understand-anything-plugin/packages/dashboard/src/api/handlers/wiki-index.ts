import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"

interface WikiEntry {
  id: string
  name: string
  summary: string
  content?: string
  type: string
  service?: string
}

interface WikiData {
  entries?: WikiEntry[]
}

interface WikiDoc {
  id: string
  name: string
  summary: string
  content: string
  type: string
  service: string
  domain?: string
}

export interface WikiSearchResult {
  id: string
  name: string
  type: string
  summary: string
  score: number
  service?: string
  domain?: string
}

export interface WikiSearchOptions {
  q?: string
  service?: string
  limit?: number
  offset?: number
}

export interface WikiSearchResponse {
  results: WikiSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "content"],
  storeFields: ["name", "type", "service", "summary", "domain"],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  summary: 2,
  content: 1,
}

export class WikiIndex {
  private miniSearch: MiniSearch
  private docs: WikiDoc[]

  constructor(data: WikiData, serviceName?: string) {
    this.docs = this.buildDocs(data, serviceName)
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (this.docs.length > 0) {
      this.miniSearch.addAll(this.docs)
    }
  }

  private buildDocs(data: WikiData, serviceName?: string): WikiDoc[] {
    return (data.entries ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      summary: entry.summary ?? "",
      content: entry.content ?? "",
      type: entry.type,
      service: entry.service ?? serviceName ?? "",
    }))
  }

  isEmpty(): boolean { return this.docs.length === 0 }
  docCount(): number { return this.docs.length }

  addDocs(docs: Array<{ id: string; name: string; summary: string; content?: string; type: string; service?: string; domain?: string }>): void {
    const existingIds = new Set(this.docs.map((d) => d.id))
    const newDocs = docs
      .filter((d) => !existingIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        summary: d.summary ?? "",
        content: d.content ?? "",
        type: d.type,
        service: d.service ?? "",
        domain: d.domain,
      }))
    if (newDocs.length > 0) {
      this.docs.push(...newDocs)
      this.miniSearch.addAll(newDocs)
    }
  }

  search(opts: WikiSearchOptions): WikiSearchResponse {
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.service && doc.service !== opts.service) return false
      return true
    }

    let miniResults: Array<{ id: string; score: number; [key: string]: unknown }>

    if (opts.q) {
      miniResults = this.miniSearch.search(opts.q, {
        filter,
        boost: SEARCH_BOOST,
        prefix: true,
        fuzzy: 0.2,
      })
    } else {
      miniResults = this.docs
        .filter((doc) => filter(doc as Record<string, unknown>))
        .map((doc) => ({ id: doc.id, score: 0, ...doc }))
    }

    const total = miniResults.length
    const paged = miniResults.slice(offset, offset + limit)

    const results: WikiSearchResult[] = paged.map((r) => ({
      id: r.id,
      name: r.name as string,
      type: r.type as string,
      summary: r.summary as string,
      score: r.score,
      service: r.service as string | undefined,
      domain: r.domain as string | undefined,
    }))

    return {
      results,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      facets: this.computeFacets(miniResults),
    }
  }

  private computeFacets(results: Array<Record<string, unknown>>): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}
    for (const r of results) {
      const val = r.service as string
      if (!val) continue
      facets.service ??= {}
      facets.service[val] = (facets.service[val] ?? 0) + 1
    }
    return facets
  }
}
