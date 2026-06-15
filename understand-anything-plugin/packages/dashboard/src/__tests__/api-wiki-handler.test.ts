import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { WikiDataService } from "../../wiki-api"
import { handleWikiRequest } from "../api/handlers/wiki"
import { handleSourceRequest } from "../api/handlers/source"
function tmpDir(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "api-wiki-")))
}

function writeJson(p: string, d: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(d))
}

describe("wiki handler", () => {
  let dir: string
  let origCwd: string
  let svc: WikiDataService
  const ctx = {
    getWikiService: () => svc,
  }

  beforeEach(() => {
    dir = tmpDir()
    origCwd = process.cwd()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/wiki/meta.json"), {
      gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en", serviceCount: 0,
    })
    writeJson(path.join(dir, ".understand-anything/wiki/overview.json"), { name: "Parent" })
    svc = new WikiDataService(dir)
    ctx.getWikiService = () => svc
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("GET /api/wiki/ returns global index", async () => {
    const res = await handleWikiRequest({ pathname: "/api/wiki", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { entries: unknown[] }).entries).toBeDefined()
  })

  it("GET /api/wiki/overview returns overview", async () => {
    const res = await handleWikiRequest({ pathname: "/api/wiki/overview", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { name: string }).name).toBe("Parent")
  })

  it("GET /api/wiki/architecture includes client-graph when present", async () => {
    writeJson(path.join(dir, ".understand-anything/wiki/architecture.json"), {
      crossServiceCalls: [],
      sharedResources: [],
      eventFlows: [],
    })
    writeJson(path.join(dir, ".understand-anything/client-graph.json"), {
      platforms: ["Amar"],
      featureMap: [{ domain: "IM", implType: "platform-specific", implementations: { Amar: { framework: "native" } } }],
    })

    const res = await handleWikiRequest({ pathname: "/api/wiki/architecture", searchParams: new URLSearchParams() }, ctx)
    expect(res?.statusCode).toBe(200)
    const body = res?.body as Record<string, unknown>
    expect(body._clientGraph).toBeDefined()
    expect((body._clientGraph as { platforms: string[] }).platforms).toEqual(["Amar"])
  })

  it("blocks null byte injection in /wiki/ path", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/foo\0../../etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })

  it("blocks tilde expansion in /wiki/ path", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/~/etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })

  it("blocks path traversal escaping wiki directory", async () => {
    const res = await handleWikiRequest(
      { pathname: "/wiki/../../etc/passwd", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res?.statusCode).toBe(400)
  })
})

describe("wiki flow direct access", () => {
  let dir: string
  let origCwd: string
  let svc: WikiDataService
  const ctx = {
    getWikiService: () => svc,
  }

  beforeEach(() => {
    dir = tmpDir()
    origCwd = process.cwd()
    process.chdir(dir)
    svc = new WikiDataService(dir)
    ctx.getWikiService = () => svc
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns 404 when service wiki not available", async () => {
    const res = await handleWikiRequest(
      { pathname: "/api/wiki/service/test-svc/flow/flow:create-order", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(404)
    expect((res!.body as { error: string }).error).toBe("Service wiki not found")
  })

  it("returns flow with parent domain for matching route", async () => {
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/meta.json"), {
      gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/index.json"), {
      entries: [{ id: "wiki:order-mgmt", name: "Order Management", type: "domain", summary: "Orders" }],
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/service.json"), {
      name: "test-svc",
      description: "Test service",
      techStack: [],
      modules: [],
      entryPoints: [],
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/domains/order-mgmt.json"), {
      id: "domain:order-mgmt",
      name: "Order Management",
      summary: "Handles order lifecycle",
      flows: [{
        id: "flow:create-order",
        name: "Create Order",
        summary: "Creates a new order",
        steps: [{ order: 1, name: "Validate", description: "Validate input" }],
      }],
    })

    const res = await handleWikiRequest(
      { pathname: "/api/wiki/service/test-svc/flow/flow:create-order", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    const body = res!.body as {
      flow: { id: string; name: string; summary: string; steps: unknown[] }
      domain: { id: string; name: string }
      service: string
    }
    expect(body.service).toBe("test-svc")
    expect(body.domain).toEqual({ id: "domain:order-mgmt", name: "Order Management" })
    expect(body.flow.id).toBe("flow:create-order")
    expect(body.flow.name).toBe("Create Order")
    expect(body.flow.steps).toHaveLength(1)
  })

  it("returns 404 when flow id not found in any domain", async () => {
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/meta.json"), {
      gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/index.json"), {
      entries: [{ id: "wiki:order-mgmt", name: "Order Management", type: "domain", summary: "Orders" }],
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/service.json"), {
      name: "test-svc",
      description: "Test service",
      techStack: [],
      modules: [],
      entryPoints: [],
    })
    writeJson(path.join(dir, "test-svc/.understand-anything/wiki/domains/order-mgmt.json"), {
      id: "domain:order-mgmt",
      name: "Order Management",
      summary: "Handles order lifecycle",
      flows: [{ id: "flow:create-order", name: "Create Order", summary: "Creates a new order", steps: [] }],
    })

    const res = await handleWikiRequest(
      { pathname: "/api/wiki/service/test-svc/flow/flow:missing", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(404)
    expect((res!.body as { error: string }).error).toBe("Flow 'flow:missing' not found")
  })

  it("returns null for non-matching routes", async () => {
    const res = await handleWikiRequest(
      { pathname: "/api/other/path", searchParams: new URLSearchParams() },
      ctx,
    )
    expect(res).toBeNull()
  })

  it("returns domain page when domain segment is Chinese", async () => {
    writeJson(path.join(dir, "ultron-relation/.understand-anything/wiki/meta.json"), {
      gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "zh",
    })
    writeJson(path.join(dir, "ultron-relation/.understand-anything/wiki/index.json"), {
      entries: [
        {
          id: "wiki:domain:closed-friend-relation",
          name: "挚友关系管理",
          type: "domain",
          summary: "Closed friend relation management",
        },
      ],
    })
    writeJson(path.join(dir, "ultron-relation/.understand-anything/wiki/service.json"), {
      name: "ultron-relation",
      description: "Relation service",
      techStack: [],
      modules: [],
      entryPoints: [],
    })
    writeJson(
      path.join(dir, "ultron-relation/.understand-anything/wiki/domains/closed-friend-relation.json"),
      {
        id: "domain:closed-friend-relation",
        name: "挚友关系管理",
        summary: "Manages closed friend relationships",
        entities: [],
        flows: [],
      },
    )

    const res = await handleWikiRequest(
      {
        pathname: `/api/wiki/service/ultron-relation/domain/${encodeURIComponent("挚友关系")}`,
        searchParams: new URLSearchParams(),
      },
      ctx,
    )
    expect(res).not.toBeNull()
    expect(res!.statusCode).toBe(200)
    expect((res!.body as { id: string; name: string }).id).toBe("domain:closed-friend-relation")
    expect((res!.body as { name: string }).name).toBe("挚友关系管理")
  })
})

describe("source handler", () => {
  let dir: string
  let origCwd: string
  const ctx = { getWikiService: () => new WikiDataService(dir) }

  beforeEach(() => {
    dir = tmpDir()
    origCwd = process.cwd()
    process.chdir(dir)
    writeJson(path.join(dir, ".understand-anything/knowledge-graph.json"), { nodes: [] })
    fs.mkdirSync(path.join(dir, "src"), { recursive: true })
    fs.writeFileSync(path.join(dir, "src", "App.ts"), "line1\nline2\n")
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("reads source file via /api/source", async () => {
    const res = await handleSourceRequest(
      { pathname: "/api/source", searchParams: new URLSearchParams({ file: "src/App.ts" }) },
      ctx,
    )
    expect(res?.statusCode).toBe(200)
    expect((res?.body as { content: string }).content).toContain("line1")
  })
})
