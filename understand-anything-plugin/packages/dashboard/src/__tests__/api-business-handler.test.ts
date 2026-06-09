import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleBusinessRequest } from "../api/handlers/business"

const ctx = { accessToken: "t", getWikiService: () => { throw new Error("unused") } }

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
    expect((res?.body as { results: unknown[] }).results.length).toBeGreaterThan(0)
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
})
