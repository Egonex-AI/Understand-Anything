import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { findGraphFile, projectRootFromGraphFile, readJsonFile } from "../utils"
import {
  loadSystemGraph,
  resolveServiceDataPath,
  validateServiceName,
  isApiResponse,
} from "../service-resolver"
import { codeTokenize as tokenize } from "./code-tokenizer"

type RelatedGroupName = "related" | "cites" | "tested_by" | "categorized_under"

interface TraceKnowledgeMeta {
  sourcePath?: string
  sourceType?: string
  business?: string
  version?: string
  content?: string
  markdownLinks?: unknown
}

interface TraceGraphNode {
  id: string
  name: string
  type: string
  summary: string
  tags?: string[]
  filePath?: string
  knowledgeMeta?: TraceKnowledgeMeta
}

interface TraceGraphEdge {
  source: string
  target: string
  type: string
}

interface TraceKnowledgeGraph {
  kind?: string
  nodes: TraceGraphNode[]
  edges: TraceGraphEdge[]
}

interface TraceSystemGraphService {
  basePath?: string
  facet?: string
  hasKg?: boolean
}

interface TraceSystemGraph {
  serviceIndex?: Record<string, TraceSystemGraphService>
}

interface CompactNode {
  id: string
  name: string
  type: string
  summary: string
  filePath?: string
  sourcePath?: string
  sourceType?: string
  business?: string
  version?: string
  score?: number
  edgeType?: string
  contentSnippet?: string
}

const RELATED_GROUPS: RelatedGroupName[] = ["related", "cites", "tested_by", "categorized_under"]
const RELATED_GROUP_SET = new Set<string>(RELATED_GROUPS)
const SUMMARY_MAX_CHARS = 800
const SNIPPET_MAX_CHARS = 1000

function parseBoundedInt(value: string | null, defaultValue: number, min: number, max: number, name: string): number | ApiResponse {
  const parsed = value === null ? defaultValue : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || String(parsed) !== String(value ?? defaultValue) || parsed < min || parsed > max) {
    return { statusCode: 400, body: { error: `${name} must be between ${min} and ${max}` } }
  }
  return parsed
}

function wantsRead(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes"
}

function truncate(value: string | undefined, maxChars: number): string {
  const text = value ?? ""
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

function metaString(node: TraceGraphNode, key: keyof TraceKnowledgeMeta): string | undefined {
  const value = node.knowledgeMeta?.[key]
  return typeof value === "string" ? value : undefined
}

function compactNode(
  node: TraceGraphNode,
  opts: { score?: number; edgeType?: string; includeSnippet: boolean },
): CompactNode {
  const compact: CompactNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    summary: truncate(node.summary, SUMMARY_MAX_CHARS),
  }

  if (node.filePath) compact.filePath = node.filePath
  const sourcePath = metaString(node, "sourcePath")
  const sourceType = metaString(node, "sourceType")
  const business = metaString(node, "business")
  const version = metaString(node, "version")
  if (sourcePath) compact.sourcePath = sourcePath
  if (sourceType) compact.sourceType = sourceType
  if (business) compact.business = business
  if (version) compact.version = version
  if (opts.score !== undefined) compact.score = opts.score
  if (opts.edgeType) compact.edgeType = opts.edgeType
  if (opts.includeSnippet) {
    const content = metaString(node, "content")
    if (content) compact.contentSnippet = truncate(content, SNIPPET_MAX_CHARS)
  }

  return compact
}

function basePathEscapesRoot(baseRoot: string, basePath: string): boolean {
  if (path.isAbsolute(basePath) || basePath.includes("\0")) return true
  const resolved = path.resolve(baseRoot, basePath)
  const relative = path.relative(baseRoot, resolved)
  return relative.startsWith("..") || path.isAbsolute(relative)
}

function containmentRoots(): string[] {
  const systemGraphPath = findGraphFile("system-graph.json")
  const roots = [
    ...(process.env.GRAPH_DIR ? [path.resolve(process.env.GRAPH_DIR)] : []),
    ...(systemGraphPath ? [projectRootFromGraphFile(systemGraphPath)] : []),
    path.resolve(process.cwd()),
  ]
  return [...new Set(roots)]
}

function realPathWithinRoot(rootPath: string, targetPath: string): boolean {
  try {
    const rootRealPath = fs.realpathSync(rootPath)
    const targetRealPath = fs.realpathSync(targetPath)
    const relative = path.relative(rootRealPath, targetRealPath)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  } catch {
    return false
  }
}

function serviceBasePathError(serviceName: string): ApiResponse | null {
  const systemGraph = loadSystemGraph() as TraceSystemGraph | null
  const basePath = systemGraph?.serviceIndex?.[serviceName]?.basePath
  if (!basePath) return null

  if (containmentRoots().some((baseRoot) => basePathEscapesRoot(baseRoot, basePath))) {
    return {
      statusCode: 400,
      body: { error: "service path escapes project root", code: "SERVICE_PATH_OUTSIDE_ROOT" },
    }
  }
  return null
}

function resolveKnowledgeGraphPath(serviceName: string): string | ApiResponse | null {
  const basePathErr = serviceBasePathError(serviceName)
  if (basePathErr) return basePathErr
  const graphPath = resolveServiceDataPath(serviceName, "knowledge-graph.json")
  if (!graphPath) return null
  if (!containmentRoots().some((baseRoot) => realPathWithinRoot(baseRoot, graphPath))) {
    return {
      statusCode: 400,
      body: { error: "service path escapes project root", code: "SERVICE_PATH_OUTSIDE_ROOT" },
    }
  }
  return graphPath
}

function hasKnowledgeGraphKind(serviceName: string): boolean {
  const graphPath = resolveKnowledgeGraphPath(serviceName)
  if (isApiResponse(graphPath)) return false
  if (!graphPath) return false
  const graph = readJsonFile<TraceKnowledgeGraph>(graphPath)
  return graph?.kind === "knowledge" && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
}

function resolveKnowledgeService(serviceName: string | null): string | ApiResponse {
  const serviceErr = validateServiceName(serviceName)
  if (serviceErr) return serviceErr
  if (serviceName) return serviceName

  const systemGraph = loadSystemGraph() as TraceSystemGraph | null
  const candidates = Object.entries(systemGraph?.serviceIndex ?? {})
    .filter(([, info]) => info.facet === "knowledge" && info.hasKg === true)
    .map(([name]) => name)
    .filter((name) => validateServiceName(name) === null)
    .filter((name) => hasKnowledgeGraphKind(name))

  if (candidates.length === 0) {
    return {
      statusCode: 404,
      body: { error: "knowledge service not found", code: "KNOWLEDGE_SERVICE_NOT_FOUND" },
    }
  }
  if (candidates.length > 1) {
    return {
      statusCode: 400,
      body: {
        error: "multiple knowledge services found; specify service",
        code: "MULTIPLE_KNOWLEDGE_SERVICES",
        candidates,
      },
    }
  }
  return candidates[0]
}

function loadKnowledgeGraph(serviceName: string): TraceKnowledgeGraph | ApiResponse {
  const graphPath = resolveKnowledgeGraphPath(serviceName)
  if (isApiResponse(graphPath)) return graphPath
  if (!graphPath) {
    return {
      statusCode: 404,
      body: { error: `knowledge-graph.json not found for service ${serviceName}` },
    }
  }
  const graph = readJsonFile<TraceKnowledgeGraph>(graphPath)
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { statusCode: 500, body: { error: "Failed to read knowledge graph file" } }
  }
  if (graph.kind !== "knowledge") {
    return {
      statusCode: 400,
      body: { error: "knowledge-graph.json is not a knowledge graph", code: "INVALID_KNOWLEDGE_GRAPH_KIND" },
    }
  }
  return graph
}

function searchText(node: TraceGraphNode): string {
  const markdownLinks = Array.isArray(node.knowledgeMeta?.markdownLinks)
    ? node.knowledgeMeta.markdownLinks.flatMap((link: unknown) => {
      if (link === null || typeof link !== "object") return []
      const label = (link as { label?: unknown }).label
      const target = (link as { target?: unknown }).target
      return [label, target].filter((value): value is string => typeof value === "string")
    })
    : []
  return [
    node.name,
    node.summary,
    ...(node.tags ?? []),
    metaString(node, "business"),
    metaString(node, "version"),
    metaString(node, "sourcePath"),
    metaString(node, "content"),
    ...markdownLinks,
  ].filter(Boolean).join(" ").toLowerCase()
}

function scoreNode(node: TraceGraphNode, query: string, queryTokens: string[]): number {
  const haystack = searchText(node)
  const normalizedQuery = query.toLowerCase()
  let score = haystack.includes(normalizedQuery) ? 2 : 0
  for (const token of queryTokens) {
    if (haystack.includes(token.toLowerCase())) score += 1
  }
  if ((node.name ?? "").toLowerCase().includes(normalizedQuery)) score += 3
  if ((node.summary ?? "").toLowerCase().includes(normalizedQuery)) score += 1
  return score
}

function findMatches(graph: TraceKnowledgeGraph, query: string, typeFilter: string | null, limit: number): Array<{ node: TraceGraphNode; score: number }> {
  const queryTokens = tokenize(query)
  return graph.nodes
    .filter((node) => !typeFilter || node.type === typeFilter)
    .map((node) => ({ node, score: scoreNode(node, query, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
    .slice(0, limit)
}

function collectRelated(
  graph: TraceKnowledgeGraph,
  matchIds: string[],
  depthLimit: number,
  neighborLimit: number,
  includeSnippet: boolean,
): Record<RelatedGroupName, CompactNode[]> {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const groups: Record<RelatedGroupName, CompactNode[]> = {
    related: [],
    cites: [],
    tested_by: [],
    categorized_under: [],
  }
  const seenByGroup: Record<RelatedGroupName, Set<string>> = {
    related: new Set(),
    cites: new Set(),
    tested_by: new Set(),
    categorized_under: new Set(),
  }
  const matchSet = new Set(matchIds)
  let frontier = matchIds
  const expanded = new Set<string>(matchIds)

  for (let depth = 1; depth <= depthLimit; depth++) {
    const nextFrontier: string[] = []
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (!RELATED_GROUP_SET.has(edge.type)) continue

        const neighborId = edge.source === currentId
          ? edge.target
          : edge.target === currentId
            ? edge.source
            : null
        if (!neighborId) continue
        if (edge.target === currentId && matchSet.has(neighborId)) continue

        const group = edge.type as RelatedGroupName
        const neighbor = nodesById.get(neighborId)
        if (!neighbor) continue

        if (!seenByGroup[group].has(neighborId) && groups[group].length < neighborLimit) {
          groups[group].push(compactNode(neighbor, { edgeType: edge.type, includeSnippet }))
          seenByGroup[group].add(neighborId)
        }

        if (!expanded.has(neighborId)) {
          expanded.add(neighborId)
          nextFrontier.push(neighborId)
        }
      }
    }
    frontier = nextFrontier
  }

  return groups
}

function nextRead(node: CompactNode): { id: string; filePath?: string; sourcePath?: string } | null {
  if (!node.filePath && !node.sourcePath) return null
  return { id: node.id, filePath: node.filePath, sourcePath: node.sourcePath }
}

function compactTrace(searchParams: URLSearchParams): ApiResponse {
  const query = searchParams.get("q")?.trim() ?? ""
  if (!query) return { statusCode: 400, body: { error: "q parameter required" } }

  const limit = parseBoundedInt(searchParams.get("limit"), 5, 1, 20, "limit")
  if (isApiResponse(limit)) return limit
  const depth = parseBoundedInt(searchParams.get("depth"), 1, 1, 2, "depth")
  if (isApiResponse(depth)) return depth
  const neighborLimit = parseBoundedInt(searchParams.get("neighborLimit"), 5, 1, 20, "neighborLimit")
  if (isApiResponse(neighborLimit)) return neighborLimit

  const service = resolveKnowledgeService(searchParams.get("service"))
  if (isApiResponse(service)) return service

  const graph = loadKnowledgeGraph(service)
  if (isApiResponse(graph)) return graph

  const includeSnippet = wantsRead(searchParams.get("read"))
  const matched = findMatches(graph, query, searchParams.get("type"), limit)
  const matches = matched.map(({ node, score }) => compactNode(node, { score, includeSnippet }))
  const related = collectRelated(graph, matched.map(({ node }) => node.id), depth, neighborLimit, includeSnippet)
  const coverage = related.tested_by.filter((node) => node.type === "testcase")
  const citedSources = related.cites.filter((node) => node.type === "source")
  const seenNextReads = new Set<string>()
  const nextReads = RELATED_GROUPS
    .flatMap((group) => related[group])
    .map(nextRead)
    .filter((read): read is { id: string; filePath?: string; sourcePath?: string } => read !== null)
    .filter((read) => {
      if (seenNextReads.has(read.id)) return false
      seenNextReads.add(read.id)
      return true
    })

  return {
    statusCode: 200,
    body: {
      kind: "knowledge-trace",
      service,
      query,
      matches,
      related,
      coverage,
      citedSources,
      nextReads,
      limits: {
        matchLimit: limit,
        neighborLimitPerType: neighborLimit,
        depth,
        contentIncluded: includeSnippet,
        summaryMaxChars: SUMMARY_MAX_CHARS,
        snippetMaxChars: includeSnippet ? SNIPPET_MAX_CHARS : 0,
      },
    },
  }
}

export async function handleKnowledgeTraceRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/knowledge/trace") return null
  return compactTrace(req.searchParams)
}
