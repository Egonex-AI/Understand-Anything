import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { businessLandscapeDir, readJsonFile, resolveProjectRoot } from "../utils"

interface DomainsIndex {
  domains: Array<{ id: string; name: string; summary: string; detailRef: string }>
  stats: Record<string, number>
}

function searchDomains(blDir: string, query: string): Array<{ id: string; name: string; match: string }> {
  const q = query.toLowerCase()
  const results: Array<{ id: string; name: string; match: string }> = []
  const domainsDir = path.join(blDir, "domains")
  if (!fs.existsSync(domainsDir)) return results
  for (const file of fs.readdirSync(domainsDir).filter((f) => f.endsWith(".json"))) {
    const detail = readJsonFile<{ id: string; name: string; summary: string; interactions?: Array<{ name: string }> }>(
      path.join(domainsDir, file),
    )
    if (!detail) continue
    const haystack = [detail.name, detail.summary, ...(detail.interactions?.map((i) => i.name) ?? [])].join(" ").toLowerCase()
    if (haystack.includes(q)) {
      results.push({ id: detail.id, name: detail.name, match: detail.summary.slice(0, 120) })
    }
  }
  return results
}

export async function handleBusinessRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/business")) return null

  const blDir = businessLandscapeDir(resolveProjectRoot())
  if (!fs.existsSync(blDir)) {
    return { statusCode: 404, body: { error: "business-landscape not found. Run /understand-business first." } }
  }

  if (pathname === "/api/business/domains") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/cross-facet-links") {
    const data = readJsonFile<{ links: Array<{ domain: string }>; unmatchedEndpoints: unknown }>(
      path.join(blDir, "cross-facet-links.json"),
    )
    if (!data) return { statusCode: 404, body: { error: "cross-facet-links.json not found" } }
    const domain = searchParams.get("domain")
    if (domain) {
      return {
        statusCode: 200,
        body: { ...data, links: data.links.filter((link) => link.domain.includes(domain)) },
      }
    }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/overview") {
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return {
      statusCode: 200,
      body: {
        domainCount: data.domains.length,
        stats: data.stats,
        facets: [...new Set(data.domains.flatMap((d) => (d as { facets?: string[] }).facets ?? []))],
      },
    }
  }

  if (pathname === "/api/business/search") {
    const q = searchParams.get("q") ?? ""
    if (!q.trim()) return { statusCode: 400, body: { error: "q parameter required" } }
    return { statusCode: 200, body: { results: searchDomains(blDir, q) } }
  }

  if (pathname === "/api/business/meta") {
    const data = readJsonFile<{
      contentHash: string
      sourceHashes: Record<string, string>
      generatedAt: string
      version: string
      status: "complete" | "degraded"
    }>(path.join(blDir, "meta.json"))
    if (!data) return { statusCode: 404, body: { error: "meta.json not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/panorama") {
    const panoramaPath = path.join(resolveProjectRoot(), ".understand-anything/wiki/domains/business.json")
    const data = readJsonFile(panoramaPath)
    if (!data) return { statusCode: 404, body: { error: "business.json panorama not found" } }
    return { statusCode: 200, body: data }
  }

  const slugMatch = pathname.match(/^\/api\/business\/domains\/([^/]+)$/)
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1])
    // Reject path traversal: decoded slug must not contain ".." segments
    if (slug.includes("..")) {
      return { statusCode: 400, body: { error: "Invalid slug: path traversal detected" } }
    }
    const detailPath = path.join(blDir, "domains", `${slug}.json`)
    const detail = readJsonFile(detailPath)
    if (!detail) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }
    return { statusCode: 200, body: detail }
  }

  return { statusCode: 404, body: { error: `Unknown business API endpoint: ${pathname}` } }
}
