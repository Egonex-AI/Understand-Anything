import MiniSearch from "minisearch"
import { codeTokenize } from "./code-tokenizer"
import type { KnowledgeGraph } from "@understand-anything/core"

function stripFrontMatter(text: string): string {
  const match = text.match(/^---[\s\S]*?---\s*/)
  return match ? text.slice(match[0].length) : text
}

interface KgDoc {
  id: string
  name: string
  summary: string
  tags: string
  type: string
  knowledgeText: string
  service: string
  filePath: string
  startLine: number
  endLine: number
  layer: string
  business: string
  version: string
  detail: string
  sourcePath: string
  sourceType: string
  profile: string
  contentSnippet: string
}

export interface KgSearchResult {
  id: string
  name: string
  type: string
  layer: string
  summary: string
  score: number
  service?: string
  filePath?: string
  lineRange?: [number, number]
  tags?: string
  business?: string
  version?: string
  detail?: string
  sourcePath?: string
  sourceType?: string
  profile?: string
  contentSnippet?: string
}

export interface KgSearchOptions {
  q?: string
  scope?: string
  type?: string
  tag?: string
  service?: string
  limit?: number
  offset?: number
}

export interface KgSearchResponse {
  results: KgSearchResult[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  facets?: Record<string, Record<string, number>>
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "summary", "tags", "type", "knowledgeText"],
  storeFields: [
    "name",
    "type",
    "service",
    "filePath",
    "startLine",
    "endLine",
    "summary",
    "tags",
    "layer",
    "business",
    "version",
    "detail",
    "sourcePath",
    "sourceType",
    "profile",
    "contentSnippet",
  ],
  tokenize: codeTokenize,
}

const SEARCH_BOOST = {
  name: 3,
  tags: 2.5,
  summary: 2,
  knowledgeText: 1.8,
  type: 0.5,
}

const kgCache = new WeakMap<KnowledgeGraph, { index: KgIndex; gen: number }>()
let cacheGeneration = 0

export function clearKgIndexCache(): void {
  cacheGeneration++
}

export class KgIndex {
  private miniSearch: MiniSearch
  private docs: KgDoc[]

  private constructor(miniSearch: MiniSearch, docs: KgDoc[]) {
    this.miniSearch = miniSearch
    this.docs = docs
  }

  static create(graph: KnowledgeGraph, serviceName: string): KgIndex {
    const cached = kgCache.get(graph)
    if (cached && cached.gen === cacheGeneration) {
      return cached.index
    }

    const docs = KgIndex.buildDocs(graph, serviceName)
    const miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS)
    if (docs.length > 0) {
      miniSearch.addAll(docs)
    }

    const index = new KgIndex(miniSearch, docs)
    kgCache.set(graph, { index, gen: cacheGeneration })
    return index
  }

  private static buildDocs(graph: KnowledgeGraph, serviceName: string): KgDoc[] {
    if (!Array.isArray(graph?.nodes)) return []
    const byId = new Map<string, typeof graph.nodes[number]>()
    for (const node of graph.nodes) {
      byId.set(node.id, node)
    }
    return [...byId.values()]
      .map((node) => {
        const meta = node.knowledgeMeta
        const nodeService = (node as { service?: unknown }).service
        const metaString = (key: keyof NonNullable<typeof meta>): string => {
          const value = meta?.[key]
          return typeof value === "string" ? value : ""
        }
        const business = metaString("business")
        const version = metaString("version")
        const detail = metaString("detail")
        const sourcePath = metaString("sourcePath")
        const sourceType = metaString("sourceType")
        const profile = metaString("profile")
        const markdownLinkText = Array.isArray(meta?.markdownLinks)
          ? meta.markdownLinks
            .flatMap((link: unknown) => {
              if (link === null || typeof link !== "object") return []
              const label = (link as { label?: unknown }).label
              const target = (link as { target?: unknown }).target
              return [label, target].filter((value): value is string => typeof value === "string")
            })
            .join(" ")
          : ""
        const knowledgeText = [
          metaString("content"),
          detail,
          business,
          metaString("month"),
          version,
          sourcePath,
          sourceType,
          markdownLinkText,
        ].filter(Boolean).join(" ")
        const contentSnippet = stripFrontMatter(metaString("content")).slice(0, 500)

        return {
          id: node.id,
          name: node.name ?? "",
          summary: node.summary ?? "",
          tags: (node.tags ?? []).join(" "),
          type: node.type ?? "",
          knowledgeText,
          service: typeof nodeService === "string" && nodeService.length > 0 ? nodeService : serviceName,
          filePath: node.filePath ?? "",
          startLine: node.lineRange?.[0] ?? 0,
          endLine: node.lineRange?.[1] ?? 0,
          layer: (node.tags ?? []).includes("business") ? "business"
            : (node.tags ?? []).includes("domain") ? "domain"
            : "kg",
          business,
          version,
          detail,
          sourcePath,
          sourceType,
          profile,
          contentSnippet,
        }
      })
  }

  isEmpty(): boolean { return this.docs.length === 0 }
  docCount(): number { return this.docs.length }

  search(opts: KgSearchOptions): KgSearchResponse {
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const filter = (doc: Record<string, unknown>): boolean => {
      if (opts.scope && opts.scope !== "all" && doc.layer !== opts.scope) return false
      if (opts.type && doc.type !== opts.type) return false
      if (opts.tag && !(doc.tags as string ?? "").includes(opts.tag)) return false
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
        .filter((doc) => filter(doc as unknown as Record<string, unknown>))
        .map((doc) => ({ ...doc, score: 0 }))
    }

    const total = miniResults.length
    const paged = miniResults.slice(offset, offset + limit)

    const results: KgSearchResult[] = paged.map((r) => ({
      id: r.id,
      name: r.name as string,
      type: r.type as string,
      layer: r.layer as string,
      summary: r.summary as string,
      score: r.score,
      service: r.service as string | undefined,
      filePath: r.filePath as string | undefined,
      lineRange: r.startLine ? [r.startLine as number, r.endLine as number] : undefined,
      tags: r.tags as string | undefined,
      business: r.business as string | undefined,
      version: r.version as string | undefined,
      detail: r.detail as string | undefined,
      sourcePath: r.sourcePath as string | undefined,
      sourceType: r.sourceType as string | undefined,
      profile: r.profile as string | undefined,
      contentSnippet: r.contentSnippet as string | undefined,
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
      for (const key of ["type", "service", "layer"]) {
        const val = r[key] as string
        if (!val) continue
        facets[key] ??= {}
        facets[key][val] = (facets[key][val] ?? 0) + 1
      }
    }
    return facets
  }
}
