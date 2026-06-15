import crypto from "crypto"
import fs from "fs"
import path from "path"
import type { BusinessFeature, BusinessFeaturesDocument } from "@understand-anything/core"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import { businessLandscapeDir, readJsonFile, resolveProjectRoot } from "../utils"
import { handleUnifiedSearch } from "./search"

interface DomainsIndex {
  domains: Array<{ id: string; name: string; summary: string; detailRef: string }>
  stats: Record<string, number>
}

function readBusinessFeatures(blDir: string): BusinessFeaturesDocument | null {
  return readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
}

function featureNameToSlug(name: string): string {
  let slug = name.toLowerCase().trim()
  slug = slug.replace(/[\s_]+/g, "-")
  slug = slug.replace(/[^a-z0-9-]/g, "")
  slug = slug.replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (!slug) {
    slug = crypto.createHash("md5").update(name).digest("hex").slice(0, 8)
  }
  return slug
}

function adaptFeaturesToDomainsList(data: BusinessFeaturesDocument) {
  return {
    _source: "business-features" as const,
    domains: data.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      summary: feature.clientLayer.summary,
      facets: feature.clientLayer.deliveryPlatforms,
      matchType: "feature-association",
      detailRef: null,
    })),
    stats: data.stats,
  }
}

function findFeatureBySlug(data: BusinessFeaturesDocument, slug: string): BusinessFeature | undefined {
  return data.features.find(
    (f) =>
      f.id === slug
      || f.name === slug
      || f.id === `feature:${slug}`
      || featureNameToSlug(f.name) === slug,
  )
}

function resolveRepoFromStandardPlatform(
  data: BusinessFeaturesDocument,
  feature: BusinessFeature,
  standardPlatform: string,
): string | null {
  const repoFromMapping = data.platformMapping?.[standardPlatform]
  if (repoFromMapping && feature.clientLayer.platforms[repoFromMapping]) {
    return repoFromMapping
  }
  for (const [repo, entry] of Object.entries(feature.clientLayer.platforms)) {
    if (entry.standardPlatform === standardPlatform) {
      return repo
    }
  }
  return null
}

function readWikiFromRef(projectRoot: string, wikiRef: string): unknown | null {
  if (!wikiRef || wikiRef.includes("..") || path.isAbsolute(wikiRef)) {
    return null
  }
  return readJsonFile(path.join(projectRoot, wikiRef))
}

interface WikiFlow {
  name?: string
  steps?: Array<{ description?: string }>
}

function applyFlowFilter(platformDetail: unknown, flowFilter: string): unknown {
  if (!platformDetail || typeof platformDetail !== "object") return platformDetail
  const detail = platformDetail as { flows?: WikiFlow[] }
  if (!detail.flows) return platformDetail

  const keyword = flowFilter.toLowerCase()
  const totalFlows = detail.flows.length
  const filtered = detail.flows.filter((flow) => {
    if (flow.name?.toLowerCase().includes(keyword)) return true
    return flow.steps?.some((step) => step.description?.toLowerCase().includes(keyword))
  })

  return {
    ...detail,
    flows: filtered,
    filteredBy: "keyword",
    totalFlows,
  }
}

function basicFeatureInfo(feature: BusinessFeature) {
  return {
    id: feature.id,
    name: feature.name,
    summary: feature.clientLayer.summary,
    deliveryPlatforms: feature.clientLayer.deliveryPlatforms,
  }
}

function resolveFeaturePlatformDetail(
  projectRoot: string,
  data: BusinessFeaturesDocument,
  feature: BusinessFeature,
  standardPlatform: string,
): { feature: ReturnType<typeof basicFeatureInfo>; platformDetail: unknown; repoName: string } | null {
  const repoName = resolveRepoFromStandardPlatform(data, feature, standardPlatform)
  if (!repoName) return null

  const platformEntry = feature.clientLayer.platforms[repoName]
  const wikiRef = platformEntry?.wikiRef
  if (!wikiRef) return null

  const platformDetail = readWikiFromRef(projectRoot, wikiRef)
  if (!platformDetail) return null

  return {
    feature: basicFeatureInfo(feature),
    platformDetail,
    repoName,
  }
}

function readFeatureInteractions(blDir: string, feature: BusinessFeature): unknown[] {
  const slug = featureNameToSlug(feature.name)
  const interactionFile = path.join(blDir, "feature-interactions", `feature-${slug}.json`)
  const interactionData = readJsonFile<{
    interactions?: unknown[]
    skeleton?: unknown
  }>(interactionFile)
  if (!interactionData) return []
  if (Array.isArray(interactionData.interactions)) return interactionData.interactions
  if (interactionData.skeleton) return [interactionData.skeleton]
  return []
}

function adaptFeatureToDetail(blDir: string, feature: BusinessFeature) {
  const { primaryDomain, supportingDomains } = feature.serverLayer
  return {
    _source: "business-features" as const,
    id: feature.id,
    name: feature.name,
    summary: feature.clientLayer.summary,
    interactions: readFeatureInteractions(blDir, feature),
    serverDependencies: {
      primary: primaryDomain,
      supporting: supportingDomains,
    },
    clientLayer: feature.clientLayer,
  }
}

function buildFeaturePanorama(data: BusinessFeaturesDocument) {
  const topFeatures = [...data.features]
    .sort((a, b) => {
      const aHasServer = a.serverLayer.primaryDomain ? 1 : 0
      const bHasServer = b.serverLayer.primaryDomain ? 1 : 0
      return bHasServer - aHasServer
    })
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      name: f.name,
      summary: f.clientLayer.summary,
      hasServerAssociation: Boolean(f.serverLayer.primaryDomain),
    }))

  return {
    _source: "business-features" as const,
    serverIndex: data.serverIndex,
    stats: data.stats,
    topFeatures,
  }
}

export async function handleBusinessRequest(req: ApiRequest, _ctx: ApiContext): Promise<ApiResponse | null> {
  const { pathname, searchParams } = req
  if (!pathname.startsWith("/api/business")) return null

  const blDir = businessLandscapeDir(resolveProjectRoot())
  if (!fs.existsSync(blDir)) {
    return { statusCode: 404, body: { error: "business-landscape not found. Run /understand-business first.", code: "BUSINESS_LANDSCAPE_NOT_FOUND" } }
  }

  if (pathname === "/api/business/domains") {
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return { statusCode: 200, body: adaptFeaturesToDomainsList(featuresData) }
    }
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return { statusCode: 200, body: { ...data, _deprecated: true } }
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
        body: { ...data, links: data.links.filter((link) => link.domain === domain || link.domain === `domain:${domain}`) },
      }
    }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/overview") {
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return {
        statusCode: 200,
        body: {
          primaryView: "features",
          featureCount: featuresData.stats.totalFeatures,
          withServerAssociation: featuresData.stats.withServerAssociation,
          serverDomainsReferenced: featuresData.stats.serverDomainsReferenced,
          stats: featuresData.stats,
        },
      }
    }
    const data = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
    if (!data) return { statusCode: 404, body: { error: "domains.json not found" } }
    return {
      statusCode: 200,
      body: {
        primaryView: "features",
        domainCount: data.domains.length,
        stats: data.stats,
        facets: [...new Set(data.domains.flatMap((d) => (d as { facets?: string[] }).facets ?? []))],
      },
    }
  }

  if (pathname === "/api/business/search") {
    const q = searchParams.get("q") ?? ""
    if (!q.trim()) return { statusCode: 400, body: { error: "q parameter required" } }
    const response = handleUnifiedSearch(q, "business", undefined, 50)
    const body = response.body as { results?: Array<{ id: string; name: string; summary: string }> }
    const results = (body.results ?? []).map((r) => ({
      id: r.id.replace(/^business:/, ""),
      name: r.name,
      match: q,
    }))
    return { statusCode: 200, body: { results } }
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
    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      return { statusCode: 200, body: buildFeaturePanorama(featuresData) }
    }
    const panoramaPath = path.join(resolveProjectRoot(), ".understand-anything/wiki/domains/business.json")
    const data = readJsonFile(panoramaPath)
    if (!data) return { statusCode: 404, body: { error: "business.json panorama not found" } }
    return { statusCode: 200, body: data }
  }

  if (pathname === "/api/business/features") {
    const data = readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }
    return { statusCode: 200, body: data }
  }

  const platformMatch = pathname.match(/^\/api\/business\/features\/([^/]+)\/platform\/([^/]+)$/)
  if (platformMatch) {
    const featureId = decodeURIComponent(platformMatch[1])
    const standardPlatform = decodeURIComponent(platformMatch[2]).toLowerCase()
    if (
      featureId.includes("..") || featureId.includes("/") || featureId.includes("\\")
      || standardPlatform.includes("..") || standardPlatform.includes("/") || standardPlatform.includes("\\")
    ) {
      return { statusCode: 400, body: { error: "Invalid path: path traversal detected", code: "PATH_TRAVERSAL" } }
    }

    const data = readBusinessFeatures(blDir)
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }

    const feature = findFeatureBySlug(data, featureId)
    if (!feature) return { statusCode: 404, body: { error: `Feature not found: ${featureId}` } }

    const projectRoot = resolveProjectRoot()
    const resolved = resolveFeaturePlatformDetail(projectRoot, data, feature, standardPlatform)
    if (!resolved) {
      return { statusCode: 404, body: { error: `Platform not found for feature: ${standardPlatform}`, code: "PLATFORM_NOT_FOUND" } }
    }

    const flowFilter = searchParams.get("flow")
    const platformDetail = flowFilter
      ? applyFlowFilter(resolved.platformDetail, flowFilter)
      : resolved.platformDetail

    return {
      statusCode: 200,
      body: {
        feature: resolved.feature,
        platform: standardPlatform,
        repoName: resolved.repoName,
        platformDetail,
      },
    }
  }

  const featureMatch = pathname.match(/^\/api\/business\/features\/([^/]+)$/)
  if (featureMatch) {
    const featureId = decodeURIComponent(featureMatch[1])
    if (featureId.includes("..") || featureId.includes("/") || featureId.includes("\\")) {
      return { statusCode: 400, body: { error: "Invalid featureId: path traversal detected", code: "PATH_TRAVERSAL" } }
    }
    const data = readJsonFile<BusinessFeaturesDocument>(path.join(blDir, "business-features.json"))
    if (!data) return { statusCode: 404, body: { error: "business-features.json not found" } }
    const feature = findFeatureBySlug(data, featureId)
    if (!feature) return { statusCode: 404, body: { error: `Feature not found: ${featureId}` } }
    return { statusCode: 200, body: feature }
  }

  const slugMatch = pathname.match(/^\/api\/business\/domains\/([^/]+)$/)
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1])
    if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
      return { statusCode: 400, body: { error: "Invalid slug: path traversal detected", code: "PATH_TRAVERSAL" } }
    }

    const featuresData = readBusinessFeatures(blDir)
    if (featuresData) {
      const feature = findFeatureBySlug(featuresData, slug)
      if (!feature) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }

      const standardPlatform = searchParams.get("platform")?.toLowerCase()
      if (standardPlatform) {
        const projectRoot = resolveProjectRoot()
        const resolved = resolveFeaturePlatformDetail(projectRoot, featuresData, feature, standardPlatform)
        if (!resolved) {
          return { statusCode: 404, body: { error: `Platform not found for feature: ${standardPlatform}`, code: "PLATFORM_NOT_FOUND" } }
        }

        const flowFilter = searchParams.get("flow")
        const platformDetail = flowFilter
          ? applyFlowFilter(resolved.platformDetail, flowFilter)
          : resolved.platformDetail

        return {
          statusCode: 200,
          body: {
            _source: "business-features" as const,
            feature: resolved.feature,
            platform: standardPlatform,
            repoName: resolved.repoName,
            platformDetail,
          },
        }
      }

      return { statusCode: 200, body: adaptFeatureToDetail(blDir, feature) }
    }

    const domainsDir = path.join(blDir, "domains")
    const detailPath = path.join(domainsDir, `${slug}.json`)
    let detail = readJsonFile(detailPath)
    if (!detail && !slug.startsWith("domain-")) {
      detail = readJsonFile(path.join(domainsDir, `domain-${slug}.json`))
    }
    if (!detail) {
      const indexData = readJsonFile<DomainsIndex>(path.join(blDir, "domains.json"))
      const matched = indexData?.domains.find(
        (d) => d.name === slug || d.id === slug || d.id === `domain:${slug}`,
      )
      if (matched?.detailRef) {
        const filename = path.basename(matched.detailRef)
        if (!filename.includes("..") && !filename.includes("/") && !filename.includes("\\")) {
          detail = readJsonFile(path.join(domainsDir, filename))
        }
      }
    }
    if (!detail) return { statusCode: 404, body: { error: `Domain not found: ${slug}` } }
    return { statusCode: 200, body: detail }
  }

  return { statusCode: 404, body: { error: `Unknown business API endpoint: ${pathname}` } }
}
