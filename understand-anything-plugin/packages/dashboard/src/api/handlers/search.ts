import path from "path"
import fs from "fs"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import {
  graphFileCandidates,
  readJsonFile,
  resolveProjectRoot,
  businessLandscapeDir,
} from "../utils"
import type { KnowledgeGraph, SystemGraph, WikiIndex } from "@understand-anything/core"

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
}

type SearchLayer = UnifiedSearchResult["layer"]
type SearchScope = SearchLayer | "all"

interface SearchIndexItem {
  id: string
  text: string
  meta: Omit<UnifiedSearchResult, "id" | "score">
}

interface SearchIndexState {
  items: SearchIndexItem[]
  tokenizedDocs: string[][]
  avgDl: number
  df: Map<string, number>
  mtimes: Record<string, number>
}

interface SearchIndexCache {
  serviceFilter: string | null
  state: SearchIndexState
}

const DOMAIN_NODE_TYPES = new Set(["flow", "step", "domain"])

let cachedSystemGraph: SystemGraph | null = null
let systemGraphMtime = 0
let cachedSearchIndex: SearchIndexCache | null = null

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

  const cjk = text.match(/[\u4e00-\u9fff]+/g)
  if (cjk) {
    for (const segment of cjk) {
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2))
      }
      if (segment.length === 1) tokens.push(segment)
    }
  }

  return tokens
}

function buildBm25Stats(items: SearchIndexItem[]): {
  tokenizedDocs: string[][]
  avgDl: number
  df: Map<string, number>
} {
  const tokenizedDocs = items.map((item) => tokenize(item.text))
  const N = tokenizedDocs.length
  const avgDl = tokenizedDocs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(N, 1)
  const df = new Map<string, number>()

  for (const doc of tokenizedDocs) {
    const seen = new Set(doc)
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }

  return { tokenizedDocs, avgDl, df }
}

export function bm25Search(
  items: SearchIndexItem[],
  query: string,
  limit = 50,
  k1 = 1.5,
  b = 0.75,
): UnifiedSearchResult[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0 || items.length === 0) return []

  const { tokenizedDocs, avgDl, df } = buildBm25Stats(items)
  const N = items.length
  const qLower = query.toLowerCase()
  const scored: UnifiedSearchResult[] = []

  for (let i = 0; i < N; i++) {
    const doc = tokenizedDocs[i]
    const dl = doc.length
    const tf = new Map<string, number>()
    for (const term of doc) {
      tf.set(term, (tf.get(term) ?? 0) + 1)
    }

    let score = 0
    for (const qt of queryTokens) {
      const termFreq = tf.get(qt)
      if (!termFreq) continue
      const docFreq = df.get(qt) ?? 0
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1)
      score += idf * (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * dl / avgDl))
    }

    const nameLower = items[i].meta.name.toLowerCase()
    if (nameLower === qLower) score += 15
    else if (nameLower.includes(qLower)) score += 5

    if (score > 0) {
      scored.push({ id: items[i].id, score, ...items[i].meta })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

function bm25SearchIndexed(
  state: SearchIndexState,
  query: string,
  limit: number,
): { results: UnifiedSearchResult[]; total: number } {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0 || state.items.length === 0) {
    return { results: [], total: 0 }
  }

  const { items, tokenizedDocs, avgDl, df } = state
  const N = items.length
  const qLower = query.toLowerCase()
  const k1 = 1.5
  const b = 0.75
  const scored: UnifiedSearchResult[] = []

  for (let i = 0; i < N; i++) {
    const doc = tokenizedDocs[i]
    const dl = doc.length
    const tf = new Map<string, number>()
    for (const term of doc) {
      tf.set(term, (tf.get(term) ?? 0) + 1)
    }

    let score = 0
    for (const qt of queryTokens) {
      const termFreq = tf.get(qt)
      if (!termFreq) continue
      const docFreq = df.get(qt) ?? 0
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1)
      score += idf * (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * dl / avgDl))
    }

    const nameLower = items[i].meta.name.toLowerCase()
    if (nameLower === qLower) score += 15
    else if (nameLower.includes(qLower)) score += 5

    if (score > 0) {
      scored.push({ id: items[i].id, score, ...items[i].meta })
    }
  }

  scored.sort((a, b) => b.score - a.score)
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

function loadSystemGraph(): SystemGraph | null {
  const sgCandidates = graphFileCandidates("system-graph.json")
  for (const candidate of sgCandidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      const mtime = fs.statSync(candidate).mtimeMs
      if (!cachedSystemGraph || mtime !== systemGraphMtime) {
        cachedSystemGraph = JSON.parse(fs.readFileSync(candidate, "utf-8")) as SystemGraph
        systemGraphMtime = mtime
      }
      return cachedSystemGraph
    } catch {
      return null
    }
  }
  return null
}

function resolveServiceBasePath(serviceName: string): string | null {
  const sg = loadSystemGraph()
  return sg?.serviceIndex?.[serviceName]?.basePath ?? null
}

function resolveServiceDataPath(serviceName: string, relativePath: string): string | null {
  const candidates: string[] = []
  const graphDir = process.env.GRAPH_DIR
  const resolvedBasePath = resolveServiceBasePath(serviceName)

  if (resolvedBasePath) {
    if (graphDir) {
      candidates.push(path.resolve(graphDir, resolvedBasePath, ".understand-anything", relativePath))
    }
    candidates.push(path.resolve(process.cwd(), resolvedBasePath, ".understand-anything", relativePath))
  }

  if (!serviceName.includes("/")) {
    if (graphDir) {
      candidates.push(path.resolve(graphDir, serviceName, ".understand-anything", relativePath))
    }
    candidates.push(path.resolve(process.cwd(), serviceName, ".understand-anything", relativePath))
    candidates.push(
      path.resolve(process.cwd(), "../../..", serviceName, ".understand-anything", relativePath),
    )
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
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

function listServiceNames(serviceFilter: string | null): string[] {
  if (serviceFilter) return [serviceFilter]
  const sg = loadSystemGraph()
  if (!sg?.serviceIndex) return []
  return Object.keys(sg.serviceIndex)
}

function pushKgItems(items: SearchIndexItem[], graph: KnowledgeGraph, serviceName: string): void {
  for (const node of graph.nodes) {
    items.push({
      id: node.id,
      text: [node.name, node.summary, node.type, ...(node.tags ?? [])].join(" "),
      meta: {
        name: node.name,
        type: node.type,
        layer: "kg",
        summary: node.summary,
        service: serviceName,
        filePath: node.filePath,
        lineRange: node.lineRange,
      },
    })
  }
}

function pushWikiItems(items: SearchIndexItem[], index: WikiIndex, serviceName?: string): void {
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
  const mtimes = collectIndexMtimes(projectRoot, serviceFilter)

  const parentWikiPath = resolveProjectDataPath(projectRoot, "wiki/index.json")
  const parentWiki = parentWikiPath ? readJsonFile<WikiIndex>(parentWikiPath) : null
  if (parentWiki) pushWikiItems(items, parentWiki)

  for (const serviceName of listServiceNames(serviceFilter)) {
    const kgPath = resolveServiceDataPath(serviceName, "knowledge-graph.json")
    const kg = kgPath ? readJsonFile<KnowledgeGraph>(kgPath) : null
    if (kg) pushKgItems(items, kg, serviceName)

    const wikiPath = resolveServiceDataPath(serviceName, "wiki/index.json")
    const wiki = wikiPath ? readJsonFile<WikiIndex>(wikiPath) : null
    if (wiki) pushWikiItems(items, wiki, serviceName)

    const domainPath = resolveServiceDataPath(serviceName, "domain-graph.json")
    const domainGraph = domainPath ? readJsonFile<KnowledgeGraph>(domainPath) : null
    if (domainGraph) pushDomainItems(items, domainGraph, serviceName)
  }

  const blDir = businessLandscapeDir(projectRoot)
  if (fs.existsSync(blDir)) {
    pushBusinessItems(items, blDir)
  }

  const { tokenizedDocs, avgDl, df } = buildBm25Stats(items)
  return { items, tokenizedDocs, avgDl, df, mtimes }
}

function getOrBuildIndex(projectRoot: string, serviceFilter: string | null): SearchIndexState {
  const currentMtimes = collectIndexMtimes(projectRoot, serviceFilter)

  if (
    cachedSearchIndex &&
    cachedSearchIndex.serviceFilter === serviceFilter &&
    mtimesEqual(cachedSearchIndex.state.mtimes, currentMtimes)
  ) {
    return cachedSearchIndex.state
  }

  const state = buildSearchIndex(projectRoot, serviceFilter)
  cachedSearchIndex = { serviceFilter, state }
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

function validateServiceName(serviceName: string | null): ApiResponse | null {
  if (!serviceName) return null
  if (serviceName.includes("\\") || serviceName.includes("..")) {
    return { statusCode: 400, body: { error: "invalid service name" } }
  }
  return null
}

function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "statusCode" in value && "body" in value
}

function filterByScope(items: SearchIndexItem[], scope: SearchScope): SearchIndexItem[] {
  if (scope === "all") return items
  return items.filter((item) => item.meta.layer === scope)
}

function handleSearch(searchParams: URLSearchParams): ApiResponse {
  const query = searchParams.get("q")?.trim() ?? ""
  if (!query) return { statusCode: 400, body: { error: "q parameter required" } }

  const scope = parseScope(searchParams.get("scope"))
  if (isApiResponse(scope)) return scope

  const limit = parseLimit(searchParams.get("limit"))
  if (isApiResponse(limit)) return limit

  const serviceName = searchParams.get("service")
  const serviceErr = validateServiceName(serviceName)
  if (serviceErr) return serviceErr

  const projectRoot = resolveProjectRoot()
  const indexState = getOrBuildIndex(projectRoot, serviceName)
  const scopedItems = filterByScope(indexState.items, scope)

  if (scopedItems.length === 0) {
    return { statusCode: 200, body: { results: [], total: 0, query } }
  }

  if (scope === "all") {
    const { results, total } = bm25SearchIndexed(indexState, query, limit)
    return { statusCode: 200, body: { results, total, query } }
  }

  const scopedState: SearchIndexState = {
    items: scopedItems,
    ...buildBm25Stats(scopedItems),
    mtimes: indexState.mtimes,
  }
  const { results, total } = bm25SearchIndexed(scopedState, query, limit)
  return { statusCode: 200, body: { results, total, query } }
}

export async function handleSearchRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/search") return null
  return handleSearch(req.searchParams)
}
