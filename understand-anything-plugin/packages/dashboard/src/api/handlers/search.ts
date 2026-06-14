import path from "path"
import fs from "fs"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { codeTokenize } from "./code-tokenizer"

export const tokenize = codeTokenize
export const CJK_REGEX = /[一-鿿㐀-䶿]/
import {
  graphFileCandidates,
  readJsonFile,
  resolveProjectRoot,
  businessLandscapeDir,
  normalizeGraphPath,
} from "../utils"
import {
  resolveServiceDataPath,
  listServiceNames,
  validateServiceName,
  isApiResponse,
} from "../service-resolver"
import { rrfFuse } from "./rrf-fuse"
import { KgIndex } from "./kg-index"
import type { KgSearchOptions } from "./kg-index"
import { WikiIndex } from "./wiki-index"
import type { WikiSearchOptions } from "./wiki-index"
import type { KnowledgeGraph, WikiIndex as WikiIndexType } from "@understand-anything/core"

export interface UnifiedSearchResult {
  id: string
  name: string
  type: string
  layer: "kg" | "wiki" | "domain" | "business"
  summary: string
  score: number
  service?: string
  filePath?: string
  lineRange?: [number, number]
  tags?: string
}

type SearchLayer = UnifiedSearchResult["layer"]
type SearchScope = SearchLayer | "all"

interface KgEdgeEntry {
  source: string
  target: string
  type: string
}

export interface SearchIndexState {
  kgIndex: KgIndex
  wikiIndex: WikiIndex
  edges: KgEdgeEntry[]
  adjacency: Map<string, Set<string>>
  mtimes: Record<string, number>
}

const DOMAIN_NODE_TYPES = new Set(["flow", "step", "domain"])

const searchIndexCache = new Map<string, SearchIndexState>()

const CANDIDATE_LIMIT = 500

export function kgGraphExpansion(
  state: SearchIndexState,
  seedIds: string[],
  maxNeighbors: number = 50,
): Map<string, number> {
  const adj = state.adjacency
  const seedSet = new Set(seedIds)
  const neighborScores = new Map<string, number>()
  const visited = new Set<string>(seedIds)

  // 1-hop neighbors
  for (const seedId of seedIds) {
    const neighbors = adj.get(seedId) ?? new Set()
    for (const neighborId of neighbors) {
      if (seedSet.has(neighborId)) continue
      const current = neighborScores.get(neighborId) ?? 0
      neighborScores.set(neighborId, current + 1)
      visited.add(neighborId)
    }
  }

  // 2-hop neighbors
  const oneHopIds = [...neighborScores.keys()]
  for (const oneHopId of oneHopIds) {
    const neighbors = adj.get(oneHopId) ?? new Set()
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue
      const current = neighborScores.get(neighborId) ?? 0
      neighborScores.set(neighborId, current + 0.5)  // 2-hop 权重降低
      visited.add(neighborId)
    }
  }

  const sorted = [...neighborScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNeighbors)

  const rankMap = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    rankMap.set(sorted[i][0], i + 1)
  }
  return rankMap
}


export function unifiedSearch(
  state: SearchIndexState,
  query: string,
  limit: number,
  scope: SearchScope = "all",
  fusion: "none" | "rrf" = "none",
  typeFilter?: string | null,
  tagFilter?: string | null,
  serviceFilter?: string | null,
  offset: number = 0,
): { results: UnifiedSearchResult[]; total: number; facets: Record<string, Record<string, number>> } {
  if (!query.trim()) {
    return { results: [], total: 0, facets: {} }
  }

  const kgOpts: KgSearchOptions = {
    q: query,
    scope: scope === "all" ? undefined : scope,
    type: typeFilter ?? undefined,
    tag: tagFilter ?? undefined,
    service: serviceFilter ?? undefined,
    limit: CANDIDATE_LIMIT,
    offset: 0,
  }

  const wikiOpts: WikiSearchOptions = {
    q: query,
    service: serviceFilter ?? undefined,
    limit: CANDIDATE_LIMIT,
    offset: 0,
  }

  const kgResult = scope !== "wiki" ? state.kgIndex.search(kgOpts) : { results: [] as Array<{ id: string; name: string; type: string; layer: string; summary: string; score: number; service?: string; filePath?: string; lineRange?: [number, number]; tags?: string }>, total: 0, facets: {} as Record<string, Record<string, number>> }
  const wikiResult = scope !== "kg" && scope !== "domain" && scope !== "business"
    ? state.wikiIndex.search(wikiOpts)
    : { results: [] as Array<{ id: string; name: string; type: string; summary: string; score: number; service?: string }>, total: 0, facets: {} as Record<string, Record<string, number>> }

  // Merge results
  const scoreById = new Map<string, UnifiedSearchResult>()

  for (const r of kgResult.results) {
    const existing = scoreById.get(r.id)
    if (!existing || r.score > existing.score) {
      scoreById.set(r.id, {
        id: r.id,
        name: r.name,
        type: r.type,
        layer: r.layer as UnifiedSearchResult["layer"],
        summary: r.summary,
        score: r.score,
        service: r.service,
        filePath: r.filePath,
        lineRange: r.lineRange,
        tags: r.tags,
      })
    }
  }

  for (const r of wikiResult.results) {
    const existing = scoreById.get(r.id)
    if (!existing || r.score > existing.score) {
      scoreById.set(r.id, {
        id: r.id,
        name: r.name,
        type: r.type,
        layer: "wiki",
        summary: r.summary,
        score: r.score,
        service: r.service,
      })
    }
  }

  const scored = [...scoreById.values()].sort((a, b) => b.score - a.score)

  // Merge facets from both indices
  const facets: Record<string, Record<string, number>> = {}
  for (const [key, vals] of Object.entries(kgResult.facets ?? {})) {
    facets[key] = { ...vals }
  }
  for (const [key, vals] of Object.entries(wikiResult.facets ?? {})) {
    facets[key] = { ...(facets[key] ?? {}), ...vals }
  }

  if (fusion === "rrf" && state.edges.length > 0) {
    const seedIds = scored.slice(0, 10).map((r) => r.id)
    const kgRanks = kgGraphExpansion(state, seedIds)
    const fused = rrfFuse(
      [
        { results: scored },
        {
          rankMap: kgRanks,
          resolve: (id) => {
            const existing = scoreById.get(id)
            if (existing) return existing
            // Try to resolve from KG index
            const kgSearch = state.kgIndex.search({ q: id, limit: 1 })
            if (kgSearch.results.length > 0) {
              const r = kgSearch.results[0]
              return { id, name: r.name, type: r.type, layer: r.layer as UnifiedSearchResult["layer"], summary: r.summary, score: 0, service: r.service, filePath: r.filePath, lineRange: r.lineRange, tags: r.tags }
            }
            return undefined
          },
        },
      ],
      limit + offset,
    )
    const paginated = fused.slice(offset, offset + limit)
    return { results: paginated, total: fused.length, facets }
  }

  const paginated = scored.slice(offset, offset + limit)
  return { results: paginated, total: scored.length, facets }
}

function getFileMtime(filePath: string | null): number {
  if (!filePath) return 0
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function resolveProjectDataPath(projectRoot: string, relativePath: string): string | null {
  const candidates = [
    path.join(projectRoot, ".understand-anything", relativePath),
    ...graphFileCandidates(relativePath),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function collectIndexMtimes(projectRoot: string, serviceFilter: string | null): Record<string, number> {
  const mtimes: Record<string, number> = {}
  const track = (filePath: string | null) => {
    if (!filePath) return
    mtimes[filePath] = getFileMtime(filePath)
  }

  track(resolveProjectDataPath(projectRoot, "system-graph.json"))
  track(path.join(businessLandscapeDir(projectRoot), "domains.json"))
  track(resolveProjectDataPath(projectRoot, "wiki/index.json"))

  for (const serviceName of listServiceNames(serviceFilter)) {
    track(resolveServiceDataPath(serviceName, "knowledge-graph.json"))
    track(resolveServiceDataPath(serviceName, "wiki/index.json"))
    track(resolveServiceDataPath(serviceName, "domain-graph.json"))
  }

  return mtimes
}

function mtimesEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
    if (a[aKeys[i]] !== b[bKeys[i]]) return false
  }
  return true
}

function buildSearchIndex(projectRoot: string, serviceFilter: string | null): SearchIndexState {
  const edges: KgEdgeEntry[] = []
  const mtimes = collectIndexMtimes(projectRoot, serviceFilter)

  // Collect all KG items for KgIndex
  const kgGraph: KnowledgeGraph = { nodes: [], edges: [] }
  const wikiEntries: Array<{ id: string; name: string; summary: string; content?: string; type: string; service?: string }> = []

  const parentWikiPath = resolveProjectDataPath(projectRoot, "wiki/index.json")
  const parentWiki = parentWikiPath ? readJsonFile<WikiIndexType>(parentWikiPath) : null
  if (parentWiki) {
    for (const entry of parentWiki.entries ?? []) {
      wikiEntries.push(entry)
    }
  }

  for (const serviceName of listServiceNames(serviceFilter)) {
    try {
      const kgPath = resolveServiceDataPath(serviceName, "knowledge-graph.json")
      const kg = kgPath ? readJsonFile<KnowledgeGraph>(kgPath) : null
      if (kg) {
        if (!Array.isArray(kg.nodes)) {
          console.warn(`[search] KG data missing nodes array for service "${serviceName}"`)
          continue
        }
        for (const node of kg.nodes) {
          const fp = node.filePath
            ? normalizeGraphPath(node.filePath, projectRoot) ?? undefined
            : undefined
          kgGraph.nodes.push({ ...node, filePath: fp })
        }
        if (Array.isArray(kg.edges)) {
          for (const edge of kg.edges) {
            edges.push({ source: edge.source, target: edge.target, type: edge.type ?? "unknown" })
            kgGraph.edges.push(edge)
          }
        }
      }

      const wikiPath = resolveServiceDataPath(serviceName, "wiki/index.json")
      const wiki = wikiPath ? readJsonFile<WikiIndexType>(wikiPath) : null
      if (wiki) {
        for (const entry of wiki.entries ?? []) {
          wikiEntries.push({ ...entry, service: entry.service ?? serviceName })
        }
      }

      // Domain graph nodes go into KG index with layer="domain"
      const domainPath = resolveServiceDataPath(serviceName, "domain-graph.json")
      const domainGraph = domainPath ? readJsonFile<KnowledgeGraph>(domainPath) : null
      if (domainGraph && Array.isArray(domainGraph.nodes)) {
        for (const node of domainGraph.nodes) {
          if (DOMAIN_NODE_TYPES.has(node.type)) {
            kgGraph.nodes.push({ ...node, tags: [...(node.tags ?? []), "domain"] })
          }
        }
      }
    } catch (err) {
      console.warn(`[search] Failed to load index data for service "${serviceName}":`, err)
    }
  }

  // Business landscape
  const blDir = businessLandscapeDir(projectRoot)
  if (fs.existsSync(blDir)) {
    const domainsPath = path.join(blDir, "domains.json")
    const data = readJsonFile<{ domains?: Array<{ id: string; name: string; summary: string }> }>(domainsPath)
    for (const domain of data?.domains ?? []) {
      kgGraph.nodes.push({
        id: `business:${domain.id}`,
        name: domain.name,
        type: "domain",
        summary: domain.summary,
        tags: ["business"],
      })
    }
  }

  const kgIndex = new KgIndex(kgGraph, serviceFilter ?? "all")
  const wikiIndex = new WikiIndex({ entries: wikiEntries })

  const adjacency = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    adjacency.get(edge.target)!.add(edge.source)
  }

  return { kgIndex, wikiIndex, edges, adjacency, mtimes }
}

function getOrBuildIndex(projectRoot: string, serviceFilter: string | null): SearchIndexState {
  // Prefer the full ("__all__") index — it contains all services and avoids
  // rebuilding per-service indexes. Service filtering happens in search
  // via filter options, not at index build time.
  const allMtimes = collectIndexMtimes(projectRoot, null)
  const allCached = searchIndexCache.get("__all__")
  if (allCached && mtimesEqual(allCached.mtimes, allMtimes)) {
    return allCached
  }

  // No valid __all__ cache — build for the requested scope
  const cacheKey = serviceFilter ?? "__all__"
  const currentMtimes = serviceFilter ? collectIndexMtimes(projectRoot, serviceFilter) : allMtimes
  const cached = searchIndexCache.get(cacheKey)
  if (cached && mtimesEqual(cached.mtimes, currentMtimes)) {
    return cached
  }

  const state = buildSearchIndex(projectRoot, serviceFilter)
  searchIndexCache.set(cacheKey, state)
  return state
}

function parseScope(value: string | null): SearchScope | ApiResponse {
  const scope = value ?? "all"
  if (scope !== "all" && scope !== "kg" && scope !== "wiki" && scope !== "domain" && scope !== "business") {
    return { statusCode: 400, body: { error: "invalid scope value" } }
  }
  return scope
}

function parseLimit(value: string | null): number | ApiResponse {
  const limit = value === null ? 20 : Number.parseInt(value, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 200" } }
  }
  return limit
}

function parseFusion(value: string | null): "none" | "rrf" | ApiResponse {
  const fusion = value ?? "none"
  if (fusion !== "none" && fusion !== "rrf") {
    return { statusCode: 400, body: { error: "invalid fusion value, must be 'none' or 'rrf'" } }
  }
  return fusion
}

function handleSearch(searchParams: URLSearchParams): ApiResponse {
  const query = searchParams.get("q")?.trim() ?? ""
  if (!query) return { statusCode: 400, body: { error: "q parameter required" } }

  const scope = parseScope(searchParams.get("scope"))
  if (isApiResponse(scope)) return scope

  const limit = parseLimit(searchParams.get("limit"))
  if (isApiResponse(limit)) return limit

  const fusion = parseFusion(searchParams.get("fusion"))
  if (isApiResponse(fusion)) return fusion

  const typeFilter = searchParams.get("type") || null
  const tagFilter = searchParams.get("tag") || null

  const offsetStr = searchParams.get("offset")
  const offset = offsetStr === null ? 0 : Number.parseInt(offsetStr, 10)
  if (!Number.isFinite(offset) || offset < 0) {
    return { statusCode: 400, body: { error: "offset must be >= 0" } }
  }

  const serviceName = searchParams.get("service")
  const serviceErr = validateServiceName(serviceName)
  if (serviceErr) return serviceErr

  const projectRoot = resolveProjectRoot()
  const indexState = getOrBuildIndex(projectRoot, serviceName)

  if (indexState.kgIndex.isEmpty() && indexState.wikiIndex.isEmpty()) {
    return { statusCode: 200, body: { results: [], total: 0, query, facets: {} } }
  }

  const { results, total, facets } = unifiedSearch(
    indexState, query, limit, scope, fusion, typeFilter, tagFilter, serviceName, offset,
  )
  return { statusCode: 200, body: { results, total, query, limit, offset, hasMore: offset + limit < total, facets } }
}

export function handleUnifiedSearch(
  query: string,
  scope: string,
  service?: string,
  limit?: number,
): ApiResponse {
  const params = new URLSearchParams()
  params.set("q", query)
  params.set("scope", scope)
  if (service) params.set("service", service)
  if (limit) params.set("limit", String(limit))
  return handleSearch(params)
}

export async function handleSearchRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/search") return null
  return handleSearch(req.searchParams)
}

/** Pre-build the search index and run a dummy search to trigger V8 JIT optimization. */
export function warmupSearchIndex(projectRoot?: string): void {
  try {
    const root = projectRoot ?? resolveProjectRoot()
    const t0 = Date.now()
    const state = getOrBuildIndex(root, null)
    const tBuild = Date.now() - t0
    unifiedSearch(state, "warmup test", 5, "all", "rrf")
    unifiedSearch(state, "预热测试", 5, "kg", "rrf")
    console.log(
      `  Search index warmed: ${state.kgIndex.docCount()} KG docs, ${state.wikiIndex.docCount()} wiki docs, ${state.edges.length} edges (${tBuild}ms build, ${Date.now() - t0}ms total)`,
    )
  } catch (e) {
    console.warn("[search] warmup failed:", e)
  }
}
