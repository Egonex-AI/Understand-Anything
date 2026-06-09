import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import request from "supertest"
import { handleBusinessRequest } from "../api/handlers/business"
import { createApp } from "../../server"

// ─────────────────────────────────────────────────────────────────────
// Bug 1 (C1): Business handler path traversal via slug
// slugFromPathname decodes URL-encoded slugs. An attacker can send
// "..%2F..%2F" (regex passes [^/]+, no literal /) which decodes to
// "../../" — escaping the domains/ directory.
// ─────────────────────────────────────────────────────────────────────

const ctx = { getWikiService: () => { throw new Error("unused") } }

function seedLandscape(dir: string) {
  const bl = path.join(dir, ".understand-anything", "business-landscape")
  fs.mkdirSync(path.join(bl, "domains"), { recursive: true })
  fs.writeFileSync(path.join(bl, "domains.json"), JSON.stringify({
    domains: [{
      id: "domain:order", name: "Order Management", summary: "test",
      facets: ["server"], matchType: "auto-api", matchConfidence: 0.9,
      detailRef: "business-landscape/domains/order.json",
    }],
    unmapped: [],
    stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
  }))
  fs.writeFileSync(path.join(bl, "domains", "order.json"), JSON.stringify({
    id: "domain:order", name: "Order Management", summary: "test",
    interactions: [], businessRules: [], facets: {},
  }))
}

describe("C1: Path traversal via slug (business handler)", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "biz-security-"))
    process.chdir(dir)
    fs.mkdirSync(path.join(dir, ".understand-anything"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".understand-anything/knowledge-graph.json"), JSON.stringify({ nodes: [] }))
    seedLandscape(dir)
    // Place a sensitive file outside the domains/ directory to prove traversal works
    fs.writeFileSync(
      path.join(dir, ".understand-anything", "business-landscape", "secret.json"),
      JSON.stringify({ secret: "classified-data" }),
    )
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it("rejects percent-encoded dot-dot-slash with explicit 400 (not just 'file not found')", async () => {
    const maliciousSlug = "%2e%2e%2ftarget"
    const res = await handleBusinessRequest(
      { pathname: `/api/business/domains/${maliciousSlug}`, searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(400)
  })

  it("rejects encoded dot-dot-slash sequences (..%2F) with explicit 400", async () => {
    const maliciousSlug = "..%2F..%2Ftarget"
    const res = await handleBusinessRequest(
      { pathname: `/api/business/domains/${maliciousSlug}`, searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(400)
  })

  it("rejects fully-encoded traversal (%2e%2e%2f..%2f) with explicit 400", async () => {
    const maliciousSlug = "%2e%2e%2f%2e%2e%2ftarget"
    const res = await handleBusinessRequest(
      { pathname: `/api/business/domains/${maliciousSlug}`, searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(400)
  })

  it("prevents reading files outside domains/ via traversal (secret.json)", async () => {
    const traversalSlug = "%2e%2e%2fsecret"
    const res = await handleBusinessRequest(
      { pathname: `/api/business/domains/${traversalSlug}`, searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(400)
  })

  it("still allows normal slugs after the fix", async () => {
    const res = await handleBusinessRequest(
      { pathname: "/api/business/domains/order", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    expect((res!.body as { name: string }).name).toBe("Order Management")
  })
})

// ─────────────────────────────────────────────────────────────────────
// Bug 2 (C2): Express server wildcard CORS
// cors() with no args = Access-Control-Allow-Origin: *
// Any malicious webpage can cross-origin request localhost:3001.
// ─────────────────────────────────────────────────────────────────────

function writeJson(p: string, d: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("C2: Express server wildcard CORS", () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cors-security-"))
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/knowledge-graph.json"), {
      project: { name: "Test" }, nodes: [], edges: [], layers: [],
    })
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it("does NOT return Access-Control-Allow-Origin: * (wildcard)", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app)
      .get("/knowledge-graph.json")
      .set("Origin", "http://evil-site.com")
    const acao = res.headers["access-control-allow-origin"]
    expect(acao).not.toBe("*")
  })

  it("allows requests from localhost origin", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app)
      .get("/knowledge-graph.json")
      .set("Origin", "http://localhost:5173")
    const acao = res.headers["access-control-allow-origin"]
    expect(acao).toBe("http://localhost:5173")
  })

  it("allows requests from 127.0.0.1 origin", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app)
      .get("/knowledge-graph.json")
      .set("Origin", "http://127.0.0.1:5173")
    const acao = res.headers["access-control-allow-origin"]
    expect(acao).toBe("http://127.0.0.1:5173")
  })

  it("rejects requests from non-localhost origins", async () => {
    const app = createApp({ projectRoot: dir })
    const res = await request(app)
      .get("/knowledge-graph.json")
      .set("Origin", "http://evil-site.com")
    const acao = res.headers["access-control-allow-origin"]
    expect(acao).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Bug 3 (H1): businessApiUrl should not append token
// Now that auth is removed, businessApiUrl builds clean URLs.
// ─────────────────────────────────────────────────────────────────────

describe("H1: businessApiUrl builds clean URLs without token", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("builds URL without token parameter", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:5173",
        search: "",
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [], stats: {} }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const { useBusinessStore } = await import("../stores/businessStore")
    await useBusinessStore.getState().fetchDomains()

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).not.toContain("token=")
    expect(calledUrl).toContain("/api/business/domains")
  })

  it("preserves extra query parameters", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:5173",
        search: "",
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const { useBusinessStore } = await import("../stores/businessStore")
    await useBusinessStore.getState().search("test")

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain("q=test")
    expect(calledUrl).not.toContain("token=")
  })
})
