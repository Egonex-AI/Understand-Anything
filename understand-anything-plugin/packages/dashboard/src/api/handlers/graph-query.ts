import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { codeTokenize as tokenize } from "./code-tokenizer"
import { readJsonFile } from "../utils"
import {
  resolveServiceDataPath,
  validateServiceNameRequired,
  isApiResponse,
} from "../service-resolver"
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  TourStep,
} from "@understand-anything/core"

type GraphKind = "kg" | "domain"
type NeighborDirection = "inbound" | "outbound" | "both"

function graphFileName(kind: GraphKind): string {
  return kind === "kg" ? "knowledge-graph.json" : "domain-graph.json"
}

function loadServiceGraph(serviceName: string, kind: GraphKind): KnowledgeGraph | ApiResponse {
  const graphPath = resolveServiceDataPath(serviceName, graphFileName(kind))
  if (!graphPath) {
    return {
      statusCode: 404,
      body: { error: `${graphFileName(kind)} not found for service ${serviceName}` },
    }
  }
  const graph = readJsonFile<KnowledgeGraph>(graphPath)
  if (!graph) {
    return { statusCode: 500, body: { error: "Failed to read graph file" } }
  }
  return graph
}

function parseGraphKind(graph: string | null): GraphKind | ApiResponse {
  if (!graph) return { statusCode: 400, body: { error: "graph parameter required" } }
  if (graph !== "kg" && graph !== "domain") {
    return { statusCode: 400, body: { error: "invalid graph value" } }
  }
  return graph
}

function findNodeByIdOrName(graph: KnowledgeGraph, nodeRef: string): GraphNode | null {
  const byId = graph.nodes.find((n) => n.id === nodeRef)
  if (byId) return byId
  return graph.nodes.find((n) => (n.name || "") === nodeRef) ?? null
}

function fuzzyMatchNodes(graph: KnowledgeGraph, query: string, limit = 10): GraphNode[] {
  const q = query.toLowerCase()
  const tokens = tokenize(query)

  const exact = graph.nodes.filter((n) => (n.name || "").toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
  if (exact.length > 0) return exact.slice(0, limit)

  if (tokens.length === 0) return []
  const scored = graph.nodes
    .map((n) => {
      const haystack = ((n.name || "") + " " + n.id).toLowerCase()
      const hits = tokens.filter((t) => haystack.includes(t)).length
      return { node: n, score: hits / tokens.length }
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.node)
}

function resolveNodeId(graph: KnowledgeGraph, nodeRef: string): string | null {
  return findNodeByIdOrName(graph, nodeRef)?.id ?? null
}

function parseDirection(value: string | null): NeighborDirection | ApiResponse {
  const direction = value ?? "both"
  if (direction !== "inbound" && direction !== "outbound" && direction !== "both") {
    return { statusCode: 400, body: { error: "invalid direction value" } }
  }
  return direction
}

function parseDepth(value: string | null, max = 3): number | ApiResponse {
  const depth = value === null ? 1 : Number.parseInt(value, 10)
  if (!Number.isFinite(depth) || depth < 1 || depth > max) {
    return { statusCode: 400, body: { error: `depth must be between 1 and ${max}` } }
  }
  return depth
}

function parseLimit(value: string | null): number | ApiResponse {
  const limit = value === null ? 50 : Number.parseInt(value, 10)
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    return { statusCode: 400, body: { error: "limit must be between 1 and 200" } }
  }
  return limit
}

function parseOffset(value: string | null): number | ApiResponse {
  const offset = value === null ? 0 : Number.parseInt(value, 10)
  if (!Number.isFinite(offset) || offset < 0) {
    return { statusCode: 400, body: { error: "offset must be a non-negative integer" } }
  }
  return offset
}

function traverseNeighbors(
  graph: KnowledgeGraph,
  centerId: string,
  direction: NeighborDirection,
  edgeType: string | undefined,
  maxDepth: number,
): Array<{ node: GraphNode; edge: GraphEdge; direction: "inbound" | "outbound"; depth: number }> {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
  const results: Array<{
    node: GraphNode
    edge: GraphEdge
    direction: "inbound" | "outbound"
    depth: number
  }> = []
  const expanded = new Set<string>()
  let frontier = [centerId]

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = []
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (edgeType && edge.type !== edgeType) continue

        let neighborId: string | null = null
        let edgeDirection: "inbound" | "outbound" | null = null

        if (edge.source === currentId) {
          if (direction === "inbound") continue
          neighborId = edge.target
          edgeDirection = "outbound"
        } else if (edge.target === currentId) {
          if (direction === "outbound") continue
          neighborId = edge.source
          edgeDirection = "inbound"
        } else {
          continue
        }

        if (!neighborId || neighborId === centerId) continue
        const neighbor = nodesById.get(neighborId)
        if (!neighbor || !edgeDirection) continue

        results.push({ node: neighbor, edge, direction: edgeDirection, depth })

        if (!expanded.has(neighborId)) {
          expanded.add(neighborId)
          nextFrontier.push(neighborId)
        }
      }
    }
    frontier = nextFrontier
  }

  return results
}

function handleNeighbors(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const nodeRef = searchParams.get("node")
  if (!nodeRef) return { statusCode: 400, body: { error: "node parameter required" } }

  const direction = parseDirection(searchParams.get("direction"))
  if (isApiResponse(direction)) return direction

  const depth = parseDepth(searchParams.get("depth"))
  if (isApiResponse(depth)) return depth

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const center = findNodeByIdOrName(loaded, nodeRef)
  if (!center) {
    const suggestions = fuzzyMatchNodes(loaded, nodeRef)
    return { statusCode: 404, body: { error: "node not found", code: "NODE_NOT_FOUND", query: nodeRef, suggestions: suggestions.map((n) => ({ id: n.id, name: n.name, type: n.type })) } }
  }

  const edgeType = searchParams.get("edgeType") ?? undefined
  const neighbors = traverseNeighbors(loaded, center.id, direction, edgeType, depth)

  return {
    statusCode: 200,
    body: {
      center,
      neighbors,
      totalEdges: neighbors.length,
    },
  }
}

function handleEdges(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const limit = parseLimit(searchParams.get("limit"))
  if (isApiResponse(limit)) return limit

  const offset = parseOffset(searchParams.get("offset"))
  if (isApiResponse(offset)) return offset

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const nodesById = new Map(loaded.nodes.map((n) => [n.id, n]))
  const typeFilter = searchParams.get("type") ?? undefined
  const sourceRef = searchParams.get("source")
  const targetRef = searchParams.get("target")

  let sourceId: string | null = null
  if (sourceRef) {
    sourceId = resolveNodeId(loaded, sourceRef)
    if (!sourceId) {
      const suggestions = fuzzyMatchNodes(loaded, sourceRef)
      return { statusCode: 404, body: { error: "source node not found", query: sourceRef, suggestions: suggestions.map((n) => ({ id: n.id, name: n.name, type: n.type })) } }
    }
  }

  let targetId: string | null = null
  if (targetRef) {
    targetId = resolveNodeId(loaded, targetRef)
    if (!targetId) {
      const suggestions = fuzzyMatchNodes(loaded, targetRef)
      return { statusCode: 404, body: { error: "target node not found", query: targetRef, suggestions: suggestions.map((n) => ({ id: n.id, name: n.name, type: n.type })) } }
    }
  }

  const filtered = loaded.edges.filter((edge) => {
    if (typeFilter && edge.type !== typeFilter) return false
    if (sourceId && edge.source !== sourceId) return false
    if (targetId && edge.target !== targetId) return false
    return true
  })

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  const edges = page.flatMap((edge) => {
    const sourceNode = nodesById.get(edge.source)
    const targetNode = nodesById.get(edge.target)
    if (!sourceNode || !targetNode) return []
    return [
      {
        ...edge,
        sourceNode: { id: sourceNode.id, name: sourceNode.name, type: sourceNode.type },
        targetNode: { id: targetNode.id, name: targetNode.name, type: targetNode.type },
      },
    ]
  })

  return {
    statusCode: 200,
    body: {
      edges,
      total,
      hasMore: offset + limit < total,
    },
  }
}

function handleLayers(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, "kg")
  if (isApiResponse(loaded)) return loaded

  const layers = (loaded.layers ?? []).map((layer) => ({
    id: layer.id,
    name: layer.name,
    description: layer.description,
    nodeCount: layer.nodeIds.length,
  }))

  return { statusCode: 200, body: { layers } }
}

function handleTour(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, "kg")
  if (isApiResponse(loaded)) return loaded

  const steps: TourStep[] = loaded.tour ?? []
  return { statusCode: 200, body: { steps } }
}

function handleImpact(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const nodeRef = searchParams.get("node")
  if (!nodeRef) return { statusCode: 400, body: { error: "node parameter required" } }

  const direction = parseDirection(searchParams.get("direction"))
  if (isApiResponse(direction)) return direction

  const depth = parseDepth(searchParams.get("depth"), 10)
  if (isApiResponse(depth)) return depth

  const edgeType = searchParams.get("edgeType") ?? undefined

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const center = findNodeByIdOrName(loaded, nodeRef)
  if (!center) {
    const suggestions = fuzzyMatchNodes(loaded, nodeRef)
    return { statusCode: 404, body: { error: "node not found", code: "NODE_NOT_FOUND", query: nodeRef, suggestions: suggestions.map((n) => ({ id: n.id, name: n.name, type: n.type })) } }
  }

  const neighbors = traverseNeighbors(loaded, center.id, direction, edgeType, depth)

  const seen = new Map<string, { node: GraphNode; edge: GraphEdge; direction: "inbound" | "outbound"; depth: number }>()
  for (const entry of neighbors) {
    if (!seen.has(entry.node.id)) {
      seen.set(entry.node.id, entry)
    }
  }

  const impacted = Array.from(seen.values()).map((e) => ({
    id: e.node.id,
    name: e.node.name || e.node.id,
    type: e.node.type,
    filePath: e.node.filePath,
    depth: e.depth,
    direction: e.direction,
    edgeType: e.edge.type,
  }))

  return {
    statusCode: 200,
    body: {
      center: { id: center.id, name: center.name || center.id, type: center.type, filePath: center.filePath },
      impacted,
      totalImpacted: impacted.length,
      maxDepth: depth,
    },
  }
}

function handleHotspots(searchParams: URLSearchParams): ApiResponse {
  const serviceErr = validateServiceNameRequired(searchParams.get("service"))
  if (serviceErr) return serviceErr

  const graphKind = parseGraphKind(searchParams.get("graph"))
  if (isApiResponse(graphKind)) return graphKind

  const limit = parseLimit(searchParams.get("limit"))
  if (isApiResponse(limit)) return limit

  const nodeType = searchParams.get("type") ?? undefined
  const edgeType = searchParams.get("edgeType") ?? undefined

  const serviceName = searchParams.get("service")!
  const loaded = loadServiceGraph(serviceName, graphKind)
  if (isApiResponse(loaded)) return loaded

  const fanIn = new Map<string, number>()
  const fanOut = new Map<string, number>()

  for (const edge of loaded.edges) {
    if (edgeType && edge.type !== edgeType) continue
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1)
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1)
  }

  const scored: Array<{
    id: string
    name: string
    type: string
    filePath?: string
    fanIn: number
    fanOut: number
    score: number
  }> = []

  for (const node of loaded.nodes) {
    if (nodeType && node.type !== nodeType) continue
    const inCount = fanIn.get(node.id) ?? 0
    const outCount = fanOut.get(node.id) ?? 0
    if (inCount === 0 && outCount === 0) continue
    scored.push({
      id: node.id,
      name: node.name || node.id,
      type: node.type,
      filePath: node.filePath,
      fanIn: inCount,
      fanOut: outCount,
      score: inCount + outCount,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  return {
    statusCode: 200,
    body: {
      hotspots: scored.slice(0, limit),
      total: scored.length,
    },
  }
}

export async function handleGraphQueryRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  switch (pathname) {
    case "/api/graph-query/neighbors":
      return handleNeighbors(searchParams)
    case "/api/graph-query/edges":
      return handleEdges(searchParams)
    case "/api/graph-query/layers":
      return handleLayers(searchParams)
    case "/api/graph-query/tour":
      return handleTour(searchParams)
    case "/api/graph-query/impact":
      return handleImpact(searchParams)
    case "/api/graph-query/hotspots":
      return handleHotspots(searchParams)
    default:
      return null
  }
}
