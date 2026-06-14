import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("fs", () => {
  let mtime = 1000
  const data = {
    "src/UserService.java": {
      language: "java",
      totalLines: 100,
      functions: [
        { name: "getUser", startLine: 10, endLine: 20, params: [{ name: "id", type: "Long" }], returnType: "User", annotations: [{ name: "@GetMapping" }] },
        { name: "createUser", startLine: 25, endLine: 35, params: [{ name: "dto", type: "CreateUserDto" }], returnType: "User", annotations: [{ name: "@PostMapping" }] },
      ],
      classes: [
        { name: "UserService", startLine: 1, endLine: 50, kind: "class", annotations: [{ name: "@Service" }], interfaces: ["CrudRepository"], typedProperties: [{ name: "repo", type: "UserRepository" }] },
      ],
      imports: [],
      exports: [],
    },
    "src/OrderService.java": {
      language: "java",
      totalLines: 80,
      functions: [{ name: "getOrder", startLine: 10, endLine: 20, params: [{ name: "id", type: "Long" }], returnType: "Order" }],
      classes: [{ name: "OrderService", startLine: 1, endLine: 40, kind: "class", annotations: [{ name: "@Service" }] }],
      imports: [],
      exports: [],
    },
  }
  return {
    default: {
      statSync: vi.fn(() => ({ mtimeMs: mtime })),
      readFileSync: vi.fn(() => JSON.stringify(data)),
      existsSync: vi.fn(() => true),
      _setMtime: (v: number) => { mtime = v },
    },
  }
})

vi.mock("../service-resolver", () => ({
  resolveServiceDataPath: vi.fn(() => "/mock/path/structural-analysis.json"),
  validateServiceNameRequired: vi.fn(() => null),
  resolveServiceBasePath: vi.fn(() => "mock-service"),
}))

import { handleStructureSearchRequest } from "../structure"
import type { ApiRequest, ApiContext } from "../types"

function makeRequest(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/structure/search",
    searchParams,
    method: "GET",
    url: `/api/structure/search?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

const mockCtx = {} as ApiContext

describe("structure search data flow", () => {
  it("returns search results with actual data", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "getUser" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string }>; total: number }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0].name).toBe("getUser")
  })

  it("returns all filter results", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", annotation: "@Service" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ annotations?: string }> }
    expect(body.results.every((r) => r.annotations?.includes("@Service"))).toBe(true)
  })

  it("returns results with symbol filter", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "Service", symbol: "User" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ name: string }> }
    expect(body.results.every((r) => r.name.toLowerCase().includes("user"))).toBe(true)
  })

  it("returns results with pathPattern filter", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "Service", pathPattern: "OrderService" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { results: Array<{ filePath: string }> }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results.every((r) => r.filePath.includes("OrderService"))).toBe(true)
  })

  it("paginates results correctly", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "Service", limit: "1", offset: "0" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { results: Array<unknown>; total: number; hasMore: boolean }
    expect(body.results.length).toBe(1)
    expect(body.hasMore).toBe(true)
    expect(body.total).toBeGreaterThan(1)
  })

  it("returns facets with results", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "Service" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { facets: Record<string, Record<string, number>> }
    expect(body.facets).toBeDefined()
    expect(body.facets.type).toBeDefined()
  })

  it("returns query info in response", async () => {
    const res = await handleStructureSearchRequest(
      makeRequest({ service: "test-svc", q: "getUser" }),
      mockCtx,
    )
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { query: { q: string; annotation?: string } }
    expect(body.query.q).toBe("getUser")
  })
})
