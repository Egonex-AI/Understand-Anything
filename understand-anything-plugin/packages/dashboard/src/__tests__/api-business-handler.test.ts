import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleBusinessRequest } from "../api/handlers/business"

const ctx = { accessToken: "t", getWikiService: () => { throw new Error("unused") } }

const sampleBusinessFeatures = {
  features: [
    {
      id: "feature:order-create",
      name: "Create Order",
      clientLayer: {
        implType: "cross-platform" as const,
        platforms: { ios: { domainName: "Order", domainId: "domain:order", summary: "下单" } },
        deliveryPlatforms: ["ios", "android"],
        summary: "Create order flow",
      },
      serverLayer: {
        primaryDomain: { name: "Order Management", service: "order-service", confidence: 0.9 },
        supportingDomains: [],
      },
    },
    {
      id: "feature:payment",
      name: "Payment",
      clientLayer: {
        implType: "flutter-only" as const,
        platforms: {},
        deliveryPlatforms: ["ios"],
        summary: "Payment flow",
      },
      serverLayer: {
        primaryDomain: null,
        supportingDomains: [],
      },
    },
  ],
  serverIndex: {
    "domain:order": { features: ["feature:order-create"], refCount: 1, service: "order-service" },
  },
  stats: { totalFeatures: 2, withServerAssociation: 1, serverDomainsReferenced: 1 },
}

function seedBusinessFeatures(dir: string) {
  const bl = path.join(dir, ".understand-anything", "business-landscape")
  fs.writeFileSync(path.join(bl, "business-features.json"), JSON.stringify(sampleBusinessFeatures))
}

function seedLandscape(dir: string) {
  const bl = path.join(dir, ".understand-anything", "business-landscape")
  fs.mkdirSync(path.join(bl, "domains"), { recursive: true })
  fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify({
    domains: [{
      id: "domain:order", name: "Order Management", summary: "下单流程",
      facets: ["server", "client"], matchType: "auto-api", matchConfidence: 0.9,
      detailRef: "business-landscape/domains/order.json",
    }],
    unmapped: [],
    stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
  }))
  fs.writeFileSync(path.join(bl, "cross-facet-links.json"), JSON.stringify({
    links: [{ domain: "domain:order", serverEndpoints: ["/api/orders"], clientApiCalls: [], matchDetails: [] }],
    unmatchedEndpoints: { server: [], client: [] },
  }))
  fs.writeFileSync(path.join(bl, "domains", "order.json"), JSON.stringify({
    id: "domain:order", name: "Order Management", summary: "下单流程",
    interactions: [{ id: "flow:create", name: "Create Order", steps: [
      { id: "s1", facet: "server", description: "validate", terminal: true },
    ]}],
    businessRules: [{ id: "r1", rule: "must have items", enforcedBy: ["s1"] }],
    facets: { server: { services: ["order-service"] } },
  }))
}

describe("handleBusinessRequest", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "biz-api-"))
    process.chdir(dir)
    fs.mkdirSync(path.join(dir, ".understand-anything"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".understand-anything/knowledge-graph.json"), JSON.stringify({ nodes: [] }))
    seedLandscape(dir)
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it("GET /api/business/domains returns index", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { domains: unknown[] }).domains).toHaveLength(1)
  })

  it("GET /api/business/domains/:slug returns detail", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/order", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { interactions: unknown[] }).interactions).toHaveLength(1)
  })

  it("GET /api/business/overview aggregates stats", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/overview", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { stats: { totalDomains: number } }).stats.totalDomains).toBe(1)
  })

  it("GET /api/business/search?q=下单 matches domain", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/search", searchParams: new URLSearchParams({ q: "下单" }) }, ctx)
    expect(res?.statusCode).toBe(200)
    const results = (res?.body as { results: Array<{ match: string }> }).results
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].match).toBe("下单")
  })

  it("GET /api/business/search?q=挚友,ClosedFriend matches via unified BM25 search", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    const domainsJson = JSON.parse(fs.readFileSync(path.join(bl, "domains.json"), "utf-8"))
    domainsJson.domains.push({
      id: "domain:friend",
      name: "ClosedFriend",
      summary: "挚友关系管理",
      facets: [],
      matchType: "auto-api",
      matchConfidence: 0.9,
      detailRef: "business-landscape/domains/friend.json",
    })
    fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify(domainsJson))
    fs.writeFileSync(path.join(bl, "domains", "friend.json"), JSON.stringify({
      id: "domain:friend", name: "ClosedFriend", summary: "挚友关系管理",
      interactions: [{ id: "flow:add", name: "Add Friend", steps: [] }],
      businessRules: [],
      facets: {},
    }))
    const res = await handleBusinessRequest(
      { pathname: "/api/business/search", searchParams: new URLSearchParams({ q: "挚友,ClosedFriend" }) }, ctx)
    expect(res?.statusCode).toBe(200)
    const results = (res?.body as { results: Array<{ id: string; match: string }> }).results
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.id === "domain:friend")).toBe(true)
    expect(results.find((r) => r.id === "domain:friend")!.match).toBe("挚友,ClosedFriend")
  })

  it("GET /api/business/search?q=keyword1, keyword2 trims whitespace around keywords", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/search", searchParams: new URLSearchParams({ q: "下单, Create" }) }, ctx)
    expect(res?.statusCode).toBe(200)
    const results = (res?.body as { results: Array<{ match: string }> }).results
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].match).toBe("下单, Create")
  })

  it("/api/business/search returns results (backward compat)", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/search", searchParams: new URLSearchParams({ q: "order" }) }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { results: Array<{ id: string; name: string; match: string }> }
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.some((r) => r.name === "Order Management")).toBe(true)
    expect(body.results[0].match).toBe("order")
  })

  it("returns null for unrelated paths", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/other", searchParams: new URLSearchParams() }, ctx)
    expect(res).toBeNull()
  })

  it("GET /api/business/meta returns 404 when meta.json missing", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/meta", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(404)
  })

  it("GET /api/business/meta returns meta.json when present", async () => {
    const meta = {
      contentHash: "abc123",
      sourceHashes: { "domains.json": "def456" },
      generatedAt: "2026-06-09T00:00:00Z",
      version: "1.0",
      status: "complete" as const,
    }
    fs.writeFileSync(
      path.join(dir, ".understand-anything/business-landscape/meta.json"),
      JSON.stringify(meta),
    )
    const res = await handleBusinessRequest(
      { pathname: "/api/business/meta", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect(res?.body).toEqual(meta)
  })

  it("GET /api/business/panorama returns 404 when business.json missing", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/panorama", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(404)
  })

  it("GET /api/business/panorama returns business.json when present", async () => {
    const panorama = { title: "Business Panorama", domains: ["domain:order"] }
    fs.mkdirSync(path.join(dir, ".understand-anything/wiki/domains"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".understand-anything/wiki/domains/business.json"),
      JSON.stringify(panorama),
    )
    const res = await handleBusinessRequest(
      { pathname: "/api/business/panorama", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect(res?.body).toEqual(panorama)
  })

  it("GET /api/business/cross-facet-links?domain=order does not match order-fulfillment", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    fs.writeFileSync(path.join(bl, "cross-facet-links.json"), JSON.stringify({
      links: [
        { domain: "domain:order", serverEndpoints: ["/api/orders"], clientApiCalls: [] },
        { domain: "domain:order-fulfillment", serverEndpoints: ["/api/fulfill"], clientApiCalls: [] },
      ],
      unmatchedEndpoints: { server: [], client: [] },
    }))

    const res = await handleBusinessRequest(
      { pathname: "/api/business/cross-facet-links", searchParams: new URLSearchParams({ domain: "order" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { links: Array<{ domain: string }> }
    expect(body.links).toHaveLength(1)
    expect(body.links[0].domain).toBe("domain:order")
  })

  it("GET /api/business/cross-facet-links?domain=order filters links", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/cross-facet-links", searchParams: new URLSearchParams({ domain: "order" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { links: Array<{ domain: string }> }
    expect(body.links).toHaveLength(1)
    expect(body.links[0].domain).toBe("domain:order")
  })

  it("GET /api/business/cross-facet-links?domain=missing returns empty links", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/cross-facet-links", searchParams: new URLSearchParams({ domain: "missing" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { links: unknown[] }).links).toHaveLength(0)
  })

  it("GET /api/business/domains/:slug resolves domain- prefixed files", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape", "domains")
    const detail = {
      id: "domain:close-friend-lifecycle-e2e",
      name: "Close Friend Lifecycle E2E",
      summary: "End-to-end close friend lifecycle",
      interactions: [],
    }
    fs.writeFileSync(path.join(bl, "domain-close-friend-lifecycle-e2e.json"), JSON.stringify(detail))

    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/close-friend-lifecycle-e2e", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { id: string }).id).toBe("domain:close-friend-lifecycle-e2e")
  })

  it("GET /api/business/domains/%2fetc%2fpasswd rejects encoded forward slashes with 400", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/%2fetc%2fpasswd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toBe("Invalid slug: path traversal detected")
  })

  it("GET /api/business/domains/foo%5cbar rejects encoded backslashes with 400", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/foo%5cbar", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toBe("Invalid slug: path traversal detected")
  })

  it("GET /api/business/domains/:slug resolves Chinese name via domains.json fallback", async () => {
    const chineseName = "挚友关系建立（端到端）"
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    const detail = {
      id: "domain:挚友关系建立（端到端）",
      name: chineseName,
      summary: "挚友关系建立端到端流程",
      interactions: [{ id: "flow:establish", name: "Establish Close Friend", steps: [] }],
      businessRules: [],
      facets: {},
    }
    fs.writeFileSync(path.join(bl, "domains", "domain-close-friend-establish-e2e.json"), JSON.stringify(detail))
    fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify({
      domains: [{
        id: "domain:挚友关系建立（端到端）",
        name: chineseName,
        summary: detail.summary,
        detailRef: "business-landscape/domains/domain-close-friend-establish-e2e.json",
      }],
      unmapped: [],
      stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
    }))

    const res = await handleBusinessRequest(
      { pathname: `/api/business/domains/${encodeURIComponent(chineseName)}`, searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { id: string; name: string }).id).toBe("domain:挚友关系建立（端到端）")
    expect((res?.body as { name: string }).name).toBe(chineseName)
    expect((res?.body as { interactions: unknown[] }).interactions).toHaveLength(1)
  })

  it("GET /api/business/features returns 404 when business-features.json missing", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(404)
    expect((res?.body as { error: string }).error).toBe("business-features.json not found")
  })

  it("GET /api/business/features returns business-features.json when present", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect(res?.body).toEqual(sampleBusinessFeatures)
  })

  it("GET /api/business/features/:featureId returns a single feature by id", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features/feature:order-create", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { id: string }).id).toBe("feature:order-create")
    expect((res?.body as { name: string }).name).toBe("Create Order")
  })

  it("GET /api/business/features/:featureId returns 404 for unknown feature", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features/feature:missing", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(404)
    expect((res?.body as { error: string }).error).toBe("Feature not found: feature:missing")
  })

  it("GET /api/business/features/%2fetc%2fpasswd rejects encoded forward slashes with 400", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features/%2fetc%2fpasswd", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(400)
    expect((res?.body as { error: string }).error).toBe("Invalid featureId: path traversal detected")
  })

  it("GET /api/business/domains/:slug with domain- prefix still works", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape", "domains")
    const detail = {
      id: "domain:close-friend-lifecycle-e2e",
      name: "Close Friend Lifecycle E2E",
      summary: "End-to-end close friend lifecycle",
      interactions: [],
    }
    fs.writeFileSync(path.join(bl, "domain-close-friend-lifecycle-e2e.json"), JSON.stringify(detail))

    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/domain-close-friend-lifecycle-e2e", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { id: string }).id).toBe("domain:close-friend-lifecycle-e2e")
  })

  it("GET /api/business/domains returns feature-adapted format when business-features.json exists", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      _source: string
      domains: Array<{ id: string; name: string; summary: string; facets: string[]; matchType: string; detailRef: null }>
      stats: { totalFeatures: number }
    }
    expect(body._source).toBe("business-features")
    expect(body.domains).toHaveLength(2)
    expect(body.domains[0]).toEqual({
      id: "feature:order-create",
      name: "Create Order",
      summary: "Create order flow",
      facets: ["ios", "android"],
      matchType: "feature-association",
      detailRef: null,
    })
    expect(body.stats.totalFeatures).toBe(2)
  })

  it("GET /api/business/domains/:slug finds a feature by name", async () => {
    seedBusinessFeatures(dir)
    const interactionsDir = path.join(dir, ".understand-anything", "business-landscape", "feature-interactions")
    fs.mkdirSync(interactionsDir, { recursive: true })
    const skeleton = { featureId: "feature:order-create", featureName: "Create Order", layers: [{ name: "client" }] }
    fs.writeFileSync(
      path.join(interactionsDir, "feature-create-order.json"),
      JSON.stringify({ skeleton, _status: "skeleton_ready" }),
    )

    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/Create%20Order", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      _source: string
      id: string
      name: string
      summary: string
      interactions: unknown[]
      serverDependencies: { primary: { name: string } | null; supporting: unknown[] }
      clientLayer: { deliveryPlatforms: string[] }
    }
    expect(body._source).toBe("business-features")
    expect(body.id).toBe("feature:order-create")
    expect(body.name).toBe("Create Order")
    expect(body.summary).toBe("Create order flow")
    expect(body.interactions).toHaveLength(1)
    expect(body.serverDependencies.primary?.name).toBe("Order Management")
    expect(body.clientLayer.deliveryPlatforms).toEqual(["ios", "android"])
  })

  it("GET /api/business/domains falls back to domains.json when business-features.json missing", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as { _deprecated?: boolean; _source?: string; domains: Array<{ id: string }> }
    expect(body._deprecated).toBe(true)
    expect(body._source).toBeUndefined()
    expect(body.domains[0].id).toBe("domain:order")
  })

  it("GET /api/business/panorama prefers feature-centric panorama when business-features.json exists", async () => {
    seedBusinessFeatures(dir)
    const panorama = { title: "Business Panorama", domains: ["domain:order"] }
    fs.mkdirSync(path.join(dir, ".understand-anything/wiki/domains"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".understand-anything/wiki/domains/business.json"),
      JSON.stringify(panorama),
    )

    const res = await handleBusinessRequest(
      { pathname: "/api/business/panorama", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      _source: string
      serverIndex: Record<string, unknown>
      stats: { totalFeatures: number }
      topFeatures: Array<{ id: string; name: string }>
    }
    expect(body._source).toBe("business-features")
    expect(body.serverIndex["domain:order"]).toBeDefined()
    expect(body.stats.totalFeatures).toBe(2)
    expect(body.topFeatures.some((f) => f.name === "Create Order")).toBe(true)
  })

  it("GET /api/business/features/:id/platform/android returns wiki content", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    const wikiDir = path.join(dir, "mobile", "ddoversea", ".understand-anything", "wiki", "domains")
    fs.mkdirSync(wikiDir, { recursive: true })
    const wikiContent = { id: "domain:order", name: "Order Android", summary: "Android order flow", flows: [] }
    fs.writeFileSync(path.join(wikiDir, "order.json"), JSON.stringify(wikiContent))

    const featuresWithPlatform = {
      ...sampleBusinessFeatures,
      platformMapping: { android: "ddoversea", ios: "ios" },
      features: [
        {
          ...sampleBusinessFeatures.features[0],
          clientLayer: {
            ...sampleBusinessFeatures.features[0].clientLayer,
            platforms: {
              ddoversea: {
                domainName: "Order",
                domainId: "domain:order",
                summary: "Android order",
                standardPlatform: "android",
                wikiRef: "mobile/ddoversea/.understand-anything/wiki/domains/order.json",
              },
              ios: {
                domainName: "Order",
                domainId: "domain:order",
                summary: "iOS order",
                standardPlatform: "ios",
                wikiRef: "mobile/ios/.understand-anything/wiki/domains/order.json",
              },
            },
            deliveryPlatforms: ["ddoversea", "ios"],
          },
        },
        sampleBusinessFeatures.features[1],
      ],
    }
    fs.writeFileSync(path.join(bl, "business-features.json"), JSON.stringify(featuresWithPlatform))

    const res = await handleBusinessRequest(
      { pathname: "/api/business/features/feature:order-create/platform/android", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      feature: { id: string; name: string }
      platform: string
      repoName: string
      platformDetail: { name: string; summary: string }
    }
    expect(body.feature.id).toBe("feature:order-create")
    expect(body.platform).toBe("android")
    expect(body.repoName).toBe("ddoversea")
    expect(body.platformDetail.name).toBe("Order Android")
    expect(body.platformDetail.summary).toBe("Android order flow")
  })

  it("GET /api/business/features/:id/platform/invalid returns 404", async () => {
    seedBusinessFeatures(dir)
    const res = await handleBusinessRequest(
      { pathname: "/api/business/features/feature:order-create/platform/invalid", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(404)
    expect((res?.body as { code: string }).code).toBe("PLATFORM_NOT_FOUND")
  })

  it("GET /api/business/domains/:slug?platform=android resolves platform mapping", async () => {
    const bl = path.join(dir, ".understand-anything", "business-landscape")
    const wikiDir = path.join(dir, "mobile", "ddoversea", ".understand-anything", "wiki", "domains")
    fs.mkdirSync(wikiDir, { recursive: true })
    const wikiContent = { id: "domain:order", name: "Order Android", summary: "Android via query param" }
    fs.writeFileSync(path.join(wikiDir, "order.json"), JSON.stringify(wikiContent))

    const featuresWithPlatform = {
      ...sampleBusinessFeatures,
      platformMapping: { android: "ddoversea" },
      features: [
        {
          ...sampleBusinessFeatures.features[0],
          clientLayer: {
            ...sampleBusinessFeatures.features[0].clientLayer,
            platforms: {
              ddoversea: {
                domainName: "Order",
                domainId: "domain:order",
                summary: "Android order",
                standardPlatform: "android",
                wikiRef: "mobile/ddoversea/.understand-anything/wiki/domains/order.json",
              },
            },
            deliveryPlatforms: ["ddoversea"],
          },
        },
        sampleBusinessFeatures.features[1],
      ],
    }
    fs.writeFileSync(path.join(bl, "business-features.json"), JSON.stringify(featuresWithPlatform))

    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/Create%20Order", searchParams: new URLSearchParams({ platform: "android" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      _source: string
      feature: { name: string }
      platform: string
      repoName: string
      platformDetail: { summary: string }
    }
    expect(body._source).toBe("business-features")
    expect(body.feature.name).toBe("Create Order")
    expect(body.platform).toBe("android")
    expect(body.repoName).toBe("ddoversea")
    expect(body.platformDetail.summary).toBe("Android via query param")
  })
})
