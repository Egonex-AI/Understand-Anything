import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { graphFileCandidates } from "../utils"
import { resolvePathWithinRoot, sanitizeSlug } from "../../utils/sanitize"
import { handleUnifiedSearch } from "./search"

export async function handleWikiRequest(
  req: ApiRequest,
  ctx: ApiContext,
): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req

  if (pathname.startsWith("/api/wiki")) {
    const ws = ctx.getWikiService()
    const apiPath = pathname.slice("/api/wiki".length) || "/"

    if (apiPath === "/" || apiPath === "") {
      return { statusCode: 200, body: ws.getGlobalIndex() }
    }
    if (apiPath === "/overview") {
      const data = ws.getOverview()
      if (!data) return { statusCode: 404, body: { error: "No parent wiki overview found" } }
      return { statusCode: 200, body: data }
    }
    if (apiPath === "/architecture") {
      const data = ws.getArchitecture()
      if (!data) return { statusCode: 404, body: { error: "No parent wiki architecture found" } }
      const clientGraph = ws.getClientGraph()
      return {
        statusCode: 200,
        body: clientGraph ? { ...data, _clientGraph: clientGraph } : data,
      }
    }
    if (apiPath === "/services") {
      return { statusCode: 200, body: ws.getServices() }
    }
    if (apiPath === "/search") {
      const q = searchParams.get("q") ?? ""
      if (!q.trim()) return { statusCode: 200, body: [] }
      const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10)
      const limit = Math.min(100, Math.max(1, Number.isNaN(rawLimit) ? 20 : rawLimit))
      const response = handleUnifiedSearch(q, "wiki", undefined, limit)
      const body = response.body as { results?: unknown[] }
      return { statusCode: 200, body: body.results ?? [] }
    }

    const svcFlowMatch = apiPath.match(/^\/service\/([^/]+)\/flow\/(.+)$/)
    if (svcFlowMatch) {
      try {
        const svcName = decodeURIComponent(svcFlowMatch[1])
        const flowId = decodeURIComponent(svcFlowMatch[2])
        const serviceWiki = ws.getServiceWiki(svcName)
        if (!serviceWiki) {
          return { statusCode: 404, body: { error: "Service wiki not found" } }
        }

        const domainEntries = serviceWiki.index.entries.filter((e) => e.type === "domain")
        for (const entry of domainEntries) {
          const domainSlug = sanitizeSlug(entry.id)
          if (!domainSlug) continue
          const page = ws.getServiceDomain(svcName, domainSlug)
          if (!page?.flows) continue
          const flow = page.flows.find((f) => f.id === flowId)
          if (flow) {
            return {
              statusCode: 200,
              body: {
                flow: { id: flow.id, name: flow.name, summary: flow.summary, steps: flow.steps },
                domain: { id: page.id, name: page.name },
                service: svcName,
              },
            }
          }
        }
        return { statusCode: 404, body: { error: `Flow '${flowId}' not found` } }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    const svcArchMatch = apiPath.match(/^\/service\/([^/]+)\/architecture$/)
    if (svcArchMatch) {
      try {
        const svcName = decodeURIComponent(svcArchMatch[1])
        const data = ws.getServiceArchitecture(svcName)
        if (!data) return { statusCode: 404, body: { error: "Service architecture not found" } }
        const clientGraph = ws.getClientGraph(svcName)
        return {
          statusCode: 200,
          body: clientGraph ? { ...data, _clientGraph: clientGraph } : data,
        }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    const svcDomainMatch = apiPath.match(/^\/service\/([^/]+)\/domain\/([^/]+)$/)
    if (svcDomainMatch) {
      try {
        const svcName = decodeURIComponent(svcDomainMatch[1])
        const domainId = decodeURIComponent(svcDomainMatch[2])
        const data = ws.getServiceDomain(svcName, domainId)
        if (!data) return { statusCode: 404, body: { error: "Service domain not found" } }
        return { statusCode: 200, body: data }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    const svcMatch = apiPath.match(/^\/service\/([^/]+)$/)
    if (svcMatch) {
      try {
        const svcName = decodeURIComponent(svcMatch[1])
        const data = ws.getServiceWiki(svcName)
        if (!data) return { statusCode: 404, body: { error: "Service wiki not found" } }
        return { statusCode: 200, body: data }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    const domainMatch = apiPath.match(/^\/domain\/([^/]+)$/)
    if (domainMatch) {
      try {
        const domainName = decodeURIComponent(domainMatch[1])
        const data = ws.getDomain(domainName)
        if (!data) return { statusCode: 404, body: { error: "Cross-service domain not found" } }
        return { statusCode: 200, body: data }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    const relatedMatch = apiPath.match(/^\/([^/]+)\/related$/)
    if (relatedMatch) {
      try {
        return { statusCode: 200, body: ws.getRelated(decodeURIComponent(relatedMatch[1])) }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    if (apiPath === "/endpoints/index") {
      const data = ws.getEndpointIndex()
      if (!data) return { statusCode: 404, body: { error: "Endpoint index not found" } }
      return { statusCode: 200, body: data }
    }

    const endpointMatch = apiPath.match(/^\/endpoints\/([^/]+)$/)
    if (endpointMatch) {
      try {
        const svcName = decodeURIComponent(endpointMatch[1])
        const data = ws.getEndpointDoc(svcName)
        if (!data) return { statusCode: 404, body: { error: "Endpoint doc not found" } }
        return { statusCode: 200, body: data }
      } catch {
        return { statusCode: 400, body: { error: "Invalid URL encoding" } }
      }
    }

    return { statusCode: 404, body: { error: `Unknown wiki API endpoint: ${apiPath}` } }
  }

  if (pathname.startsWith("/wiki/")) {
    const wikiPath = pathname.slice("/wiki/".length)
    const wikiRoot = path.resolve(".understand-anything", "wiki")
    if (!resolvePathWithinRoot(wikiRoot, wikiPath)) {
      return { statusCode: 400, body: { error: "Invalid wiki path" } }
    }
    const candidates = graphFileCandidates(`wiki/${wikiPath}`)
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        return { statusCode: 200, body: JSON.parse(fs.readFileSync(candidate, "utf-8")) }
      } catch {
        return { statusCode: 500, body: { error: "Failed to read wiki file" } }
      }
    }
    return { statusCode: 404, body: { error: `Wiki file not found: ${wikiPath}` } }
  }

  return null
}
