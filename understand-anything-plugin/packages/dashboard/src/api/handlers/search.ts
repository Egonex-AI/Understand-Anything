import path from "path"
import fs from "fs"
import jieba from "@node-rs/jieba"
import { LumoSearch } from "@lumosearch/search"

const { cut } = jieba
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
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
import type { KnowledgeGraph, WikiIndex } from "@understand-anything/core"

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

export interface SearchIndexItem {
  id: string
  text: string
  meta: Omit<UnifiedSearchResult, "id" | "score">
}

interface LumoDocument extends Record<string, unknown> {
  id: string
  name: string
  summary: string
  type: string
  service: string
  content: string
  layer: string
  tags: string  // 新增
}

interface KgEdgeEntry {
  source: string
  target: string
  type: string
}

export interface SearchIndexState {
  items: SearchIndexItem[]
  itemById: Map<string, SearchIndexItem>
  tokenizedDocs: string[][]
  tokenizedDocSets: Set<string>[]
  cjkInvertedIndex: Map<string, number[]>
  lumo: LumoSearch<LumoDocument>
  edges: KgEdgeEntry[]
  adjacency: Map<string, Set<string>>
  mtimes: Record<string, number>
}

const DOMAIN_NODE_TYPES = new Set(["flow", "step", "domain"])

const searchIndexCache = new Map<string, SearchIndexState>()

const TYPE_BOOST: Record<string, number> = {
  class: 2,
  function: 1.5,
  interface: 2,
  module: 1,
  endpoint: 2,
  service: 2.5,
  file: 0.5,
  flow: 1,
  domain: 1,
}

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/)

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower)
    }
  }

  // Extract numbers from text
  const numbers = text.match(/\d+/g)
  if (numbers) {
    for (const num of numbers) {
      if (num.length >= 2) {
        tokens.push(num)
      }
    }
  }

  const cjk = text.match(/[\u4e00-\u9fff]+/g)
  if (cjk) {
    for (const segment of cjk) {
      try {
        const words = cut(segment, true)  // \u7cbe\u786e\u6a21\u5f0f
        for (const word of words) {
          if (word.length > 0) tokens.push(word)
        }
      } catch (e) {
        console.warn("[search] jieba cut failed, falling back to bigram:", e)
        // Fallback to bigram if jieba fails
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.slice(i, i + 2))
        }
        if (segment.length === 1) tokens.push(segment)
      }
    }
  }

  return tokens
}

const LUMO_SEARCH_KEYS = [
  { name: "name", weight: 3 },
  { name: "summary", weight: 2 },
  { name: "tags", weight: 2.5 },   // 新增：高于 summary
  { name: "type", weight: 0.5 },
  { name: "content", weight: 1 },
] as const

const LUMO_CANDIDATE_LIMIT = 500

export const CJK_REGEX = /[\u4e00-\u9fff]/

export function buildTokenizedDocs(items: SearchIndexItem[]): string[][] {
  return items.map((item) => tokenize(item.text))
}

function applyResultBoosts(item: SearchIndexItem, baseScore: number, query: string): number {
  const qLower = query.toLowerCase()
  let score = baseScore

  const nameLower = (item.meta.name ?? "").toLowerCase()
  if (nameLower === qLower) score += 15
  else if (nameLower.includes(qLower)) score += 5

  score += TYPE_BOOST[item.meta.type] ?? 0
  if (item.meta.filePath) score += 1.5
  if (item.meta.lineRange) score += 1

  return score
}

/** CJK bigram token overlap — uses inverted index instead of linear scan. */
function cjkTokenScores(
  state: SearchIndexState,
  query: string,
  scope: SearchScope,
  serviceFilter?: string | null,
): Map<string, number> {
  const queryTokens = tokenize(query).filter((t) => CJK_REGEX.test(t))
  if (queryTokens.length === 0) return new Map()

  // Collect candidate item indices from inverted index
  const candidateCounts = new Map<number, number>()
  for (const qt of queryTokens) {
    const postings = state.cjkInvertedIndex.get(qt)
    if (!postings) continue
    for (const idx of postings) {
      candidateCounts.set(idx, (candidateCounts.get(idx) ?? 0) + 1)
    }
  }

  const scores = new Map<string, number>()

  for (const [i, matchCount] of candidateCounts) {
    const item = state.items[i]
    if (scope !== "all" && item.meta.layer !== scope) continue
    if (serviceFilter && item.meta.service !== serviceFilter) continue

    let score = (matchCount / queryTokens.length) * 10
    if ((item.meta.summary ?? "").includes(query) || (item.meta.name ?? "").includes(query)) score += 10

    score = applyResultBoosts(item, score, query)
    scores.set(item.id, score)
  }

  return scores
}

export function buildLumoIndex(items: SearchIndexItem[]): LumoSearch<LumoDocument> {
  const lumoDocs: LumoDocument[] = items.map((item) => ({
    id: item.id,
    name: item.meta.name,
    summary: item.meta.summary,
    type: item.meta.type,
    service: item.meta.service ?? "",
    content: item.text,
    layer: item.meta.layer,
    tags: item.meta.tags ?? "",
  }))

  return new LumoSearch(lumoDocs, {
    keys: [...LUMO_SEARCH_KEYS],
    candidateLimit: LUMO_CANDIDATE_LIMIT,
  })
}


function kgGraphExpansion(
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


function lumoSearch(
  state: SearchIndexState,
  query: string,
  limit: number,
  scope: SearchScope = "all",
  fusion: "none" | "rrf" = "none",
  serviceFilter?: string | null,
): { results: UnifiedSearchResult[]; total: number } {
  if (!query.trim() || state.items.length === 0) {
    return { results: [], total: 0 }
  }

  const predicate = (doc: LumoDocument) => {
    if (scope !== "all" && doc.layer !== scope) return false
    if (serviceFilter && doc.service !== serviceFilter) return false
    return true
  }

  const lumoResults = state.lumo.search(query, {
    limit: LUMO_CANDIDATE_LIMIT,
    candidateLimit: LUMO_CANDIDATE_LIMIT,
    predicate,
  })

  const scoreById = new Map<string, UnifiedSearchResult>()

  for (const r of lumoResults) {
    const item = state.items[r.refIndex]
    if (!item) continue

    const score = applyResultBoosts(item, r.score, query)
    scoreById.set(item.id, { id: item.id, score, ...item.meta })
  }

  for (const [id, cjkScore] of cjkTokenScores(state, query, scope, serviceFilter)) {
    const existing = scoreById.get(id)
    if (existing) {
      existing.score = Math.max(existing.score, cjkScore)
    } else {
      const item = state.itemById.get(id)
      if (item) scoreById.set(id, { id, score: cjkScore, ...item.meta })
    }
  }

  const scored = [...scoreById.values()]
  scored.sort((a, b) => b.score - a.score)

  if (fusion === "rrf" && state.edges.length > 0) {
    const seedIds = scored.slice(0, 10).map((r) => r.id)
    const kgRanks = kgGraphExpansion(state, seedIds)
    const fused = rrfFuse(
      [
        { results: scored },
        {
          rankMap: kgRanks,
          resolve: (id) => {
            const item = state.itemById.get(id)
            return item ? { id, score: 0, ...item.meta } : undefined
          },
        },
      ],
      limit,
    )
    return { results: fused, total: fused.length }
  }

  return { results: scored.slice(0, limit), total: scored.length }
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

export function pushKgItems(
  items: SearchIndexItem[],
  edges: KgEdgeEntry[],
  graph: KnowledgeGraph,
  serviceName: string,
  projectRoot: string,
): void {
  if (!Array.isArray(graph?.nodes)) {
    console.warn(`[search] KG data missing nodes array for service "${serviceName}"`)
    return
  }
  if (Array.isArray(graph.edges)) {
    for (const edge of graph.edges) {
      edges.push({ source: edge.source, target: edge.target, type: edge.type ?? "unknown" })
    }
  }
  for (const node of graph.nodes) {
    const fp = node.filePath
      ? normalizeGraphPath(node.filePath, projectRoot) ?? undefined
      : undefined
    items.push({
      id: node.id,
      text: [node.name, node.summary, node.type].join(" "),  // 不再包含 tags
      meta: {
        name: node.name,
        type: node.type,
        layer: "kg",
        summary: node.summary,
        service: serviceName,
        filePath: fp,
        lineRange: node.lineRange,
        tags: (node.tags ?? []).join(" "),  // 新增：tags 字段
      },
    })
  }
}

export function pushWikiItems(items: SearchIndexItem[], index: WikiIndex, serviceName?: string): void {
  for (const entry of index.entries ?? []) {
    items.push({
      id: entry.id,
      text: [entry.name, entry.summary, entry.type, entry.service, entry.domain].filter(Boolean).join(" "),
      meta: {
        name: entry.name,
        type: entry.type,
        layer: "wiki",
        summary: entry.summary,
        service: entry.service ?? serviceName,
      },
    })
  }
}

function pushDomainItems(items: SearchIndexItem[], graph: KnowledgeGraph, serviceName: string): void {
  if (!Array.isArray(graph?.nodes)) {
    console.warn(`[search] Domain graph data missing nodes array for service "${serviceName}"`)
    return
  }
  for (const node of graph.nodes) {
    if (!DOMAIN_NODE_TYPES.has(node.type)) continue
    items.push({
      id: node.id,
      text: [node.name, node.summary, node.type].join(" "),
      meta: {
        name: node.name,
        type: node.type,
        layer: "domain",
        summary: node.summary,
        service: serviceName,
        filePath: node.filePath,
        lineRange: node.lineRange,
      },
    })
  }
}

function pushBusinessItems(items: SearchIndexItem[], blDir: string): void {
  const domainsPath = path.join(blDir, "domains.json")
  const data = readJsonFile<{ domains?: Array<{ id: string; name: string; summary: string }> }>(domainsPath)
  for (const domain of data?.domains ?? []) {
    items.push({
      id: `business:${domain.id}`,
      text: `${domain.name} ${domain.summary}`,
      meta: {
        name: domain.name,
        type: "domain",
        layer: "business",
        summary: domain.summary,
      },
    })
  }
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
  const items: SearchIndexItem[] = []
  const edges: KgEdgeEntry[] = []
  const mtimes = collectIndexMtimes(projectRoot, serviceFilter)

  const parentWikiPath = resolveProjectDataPath(projectRoot, "wiki/index.json")
  const parentWiki = parentWikiPath ? readJsonFile<WikiIndex>(parentWikiPath) : null
  if (parentWiki) pushWikiItems(items, parentWiki)

  for (const serviceName of listServiceNames(serviceFilter)) {
    try {
      const kgPath = resolveServiceDataPath(serviceName, "knowledge-graph.json")
      const kg = kgPath ? readJsonFile<KnowledgeGraph>(kgPath) : null
      if (kg) pushKgItems(items, edges, kg, serviceName, projectRoot)

      const wikiPath = resolveServiceDataPath(serviceName, "wiki/index.json")
      const wiki = wikiPath ? readJsonFile<WikiIndex>(wikiPath) : null
      if (wiki) pushWikiItems(items, wiki, serviceName)

      const domainPath = resolveServiceDataPath(serviceName, "domain-graph.json")
      const domainGraph = domainPath ? readJsonFile<KnowledgeGraph>(domainPath) : null
      if (domainGraph) pushDomainItems(items, domainGraph, serviceName)
    } catch (err) {
      console.warn(`[search] Failed to load index data for service "${serviceName}":`, err)
    }
  }

  const blDir = businessLandscapeDir(projectRoot)
  if (fs.existsSync(blDir)) {
    pushBusinessItems(items, blDir)
  }

  const lumo = buildLumoIndex(items)
  const itemById = new Map<string, SearchIndexItem>()
  for (const item of items) itemById.set(item.id, item)
  const tokenizedDocs = buildTokenizedDocs(items)
  const tokenizedDocSets = tokenizedDocs.map((tokens) => new Set(tokens))
  const cjkInvertedIndex = new Map<string, number[]>()
  for (let i = 0; i < tokenizedDocs.length; i++) {
    for (const token of tokenizedDocSets[i]) {
      if (CJK_REGEX.test(token)) {
        let postings = cjkInvertedIndex.get(token)
        if (!postings) { postings = []; cjkInvertedIndex.set(token, postings) }
        postings.push(i)
      }
    }
  }
  const adjacency = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    adjacency.get(edge.target)!.add(edge.source)
  }
  return { items, itemById, tokenizedDocs, tokenizedDocSets, cjkInvertedIndex, lumo, edges, adjacency, mtimes }
}

function getOrBuildIndex(projectRoot: string, serviceFilter: string | null): SearchIndexState {
  // Prefer the full ("__all__") index — it contains all services and avoids
  // rebuilding per-service indexes. Service filtering happens in Lumo search
  // via predicate, not at index build time.
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

  const serviceName = searchParams.get("service")
  const serviceErr = validateServiceName(serviceName)
  if (serviceErr) return serviceErr

  const projectRoot = resolveProjectRoot()
  const indexState = getOrBuildIndex(projectRoot, serviceName)

  if (indexState.items.length === 0) {
    return { statusCode: 200, body: { results: [], total: 0, query } }
  }

  const { results, total } = lumoSearch(indexState, query, limit, scope, fusion, serviceName)
  return { statusCode: 200, body: { results, total, query } }
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
  const root = projectRoot ?? resolveProjectRoot()
  const t0 = Date.now()
  const state = getOrBuildIndex(root, null)
  const tBuild = Date.now() - t0
  // Trigger V8 JIT on the hot search path (Lumo + CJK + RRF + graph expansion)
  lumoSearch(state, "warmup test", 5, "all", "rrf")
  lumoSearch(state, "预热测试", 5, "kg", "rrf")
  console.log(
    `  Search index warmed: ${state.items.length} items, ${state.edges.length} edges (${tBuild}ms build, ${Date.now() - t0}ms total)`,
  )
}
