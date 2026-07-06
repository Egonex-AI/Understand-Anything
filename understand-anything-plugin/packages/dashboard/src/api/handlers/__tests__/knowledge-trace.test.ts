import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { handleKnowledgeTraceRequest } from "../knowledge"
import type { ApiRequest, ApiContext } from "../../types"

const mockCtx = {} as ApiContext

function makeReq(params: Record<string, string>): ApiRequest {
  const searchParams = new URLSearchParams(params)
  return {
    pathname: "/api/knowledge/trace",
    searchParams,
    method: "GET",
    url: `/api/knowledge/trace?${searchParams.toString()}`,
    headers: {},
    body: undefined,
  } as ApiRequest
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data))
}

function seedKnowledgeService(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 5, totalEdges: 4 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "amar-prd": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "amar-prd",
        facet: "knowledge",
        kind: "knowledge",
      },
    },
  })

  writeJson(path.join(root, "amar-prd", ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    version: "1.0.0",
    project: {
      name: "amar-prd",
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "",
      gitCommitHash: "",
    },
    nodes: [
      {
        id: "requirement:pk-reconnect",
        name: "PK Reconnect",
        type: "requirement",
        summary: "Audience users should resume PK progress after reconnect.",
        tags: ["prd", "pk"],
        filePath: "wiki/requirements/pk-reconnect.md",
        complexity: "simple",
        knowledgeMeta: {
          sourceType: "prd",
          sourcePath: "raw/prd/pk-reconnect.md",
          business: "room-pk",
          version: "v1",
          content: "Reconnect content ".repeat(120),
        },
      },
      {
        id: "requirement:pk-room",
        name: "PK Room",
        type: "requirement",
        summary: "Related room requirement.",
        tags: ["prd"],
        filePath: "wiki/requirements/pk-room.md",
        complexity: "simple",
        knowledgeMeta: {
          sourceType: "prd",
          sourcePath: "raw/prd/pk-room.md",
          business: "room-pk",
          version: "v1",
          content: "Room related content",
          markdownLinks: [
            { label: "跨房间PK", target: "../summaries/room-pk.md" },
          ],
        },
      },
      {
        id: "source:pk-doc",
        name: "PK PRD Source",
        type: "source",
        summary: "Original PRD source.",
        tags: ["source"],
        filePath: "wiki/sources/pk-doc.md",
        complexity: "simple",
        knowledgeMeta: {
          sourceType: "prd",
          sourcePath: "raw/prd/source/pk.md",
          business: "room-pk",
          version: "v1",
          content: "Source content",
        },
      },
      {
        id: "testcase:pk-reconnect",
        name: "PK Reconnect Testcase",
        type: "testcase",
        summary: "Verifies reconnect resumes progress.",
        tags: ["testcase"],
        filePath: "wiki/testcases/pk-reconnect.md",
        complexity: "simple",
        knowledgeMeta: {
          sourceType: "testcase",
          sourcePath: "raw/testcases/pk-reconnect.md",
          business: "room-pk",
          version: "v1",
          content: "Testcase content",
        },
      },
      {
        id: "topic:pk",
        name: "PK Topic",
        type: "topic",
        summary: "PK topic category.",
        tags: ["category"],
        filePath: "wiki/topics/pk.md",
        complexity: "simple",
        knowledgeMeta: {
          sourceType: "topic",
          sourcePath: "raw/topics/pk.md",
          business: "room-pk",
          version: "v1",
          content: "Topic content",
        },
      },
    ],
    edges: [
      { source: "requirement:pk-reconnect", target: "requirement:pk-room", type: "related", direction: "forward", weight: 1 },
      { source: "requirement:pk-reconnect", target: "source:pk-doc", type: "cites", direction: "forward", weight: 1 },
      { source: "requirement:pk-reconnect", target: "testcase:pk-reconnect", type: "tested_by", direction: "forward", weight: 1 },
      { source: "requirement:pk-reconnect", target: "topic:pk", type: "categorized_under", direction: "forward", weight: 1 },
    ],
    layers: [],
    tour: [],
  })
}

function seedEscapedBasePathService(root: string): string {
  const outsideDir = path.join(path.dirname(root), `${path.basename(root)}-outside`)
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 1, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      escaped: {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: `../${path.basename(outsideDir)}`,
      },
    },
  })
  writeJson(path.join(outsideDir, ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:escaped",
        name: "Escaped Reconnect",
        type: "requirement",
        summary: "This graph is outside the project root.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
  return outsideDir
}

function seedExplicitNonKnowledgeService(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 1, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "code-kg": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "code-kg",
      },
    },
  })
  writeJson(path.join(root, "code-kg", ".understand-anything", "knowledge-graph.json"), {
    kind: "code",
    nodes: [
      {
        id: "requirement:code",
        name: "Code Reconnect",
        type: "requirement",
        summary: "This graph has nodes but is not a knowledge graph.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
}

function seedIllegalServiceKeyFallback(root: string, parentRoot: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 1, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "..": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
      },
    },
  })
  writeJson(path.join(parentRoot, ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:parent",
        name: "Parent Reconnect",
        type: "requirement",
        summary: "This graph is outside the project root via service name fallback.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
}

function seedNoKnowledgeServices(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 1, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "code-only": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "code-only",
      },
    },
  })
  writeJson(path.join(root, "code-only", ".understand-anything", "knowledge-graph.json"), {
    kind: "code",
    nodes: [
      {
        id: "requirement:code-only",
        name: "Code Only",
        type: "requirement",
        summary: "This is not a knowledge service.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
}

function seedTwoKnowledgeServices(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 2, totalNodes: 2, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "knowledge-a": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "knowledge-a",
        facet: "knowledge",
      },
      "knowledge-b": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "knowledge-b",
        facet: "knowledge",
      },
    },
  })
  for (const service of ["knowledge-a", "knowledge-b"]) {
    writeJson(path.join(root, service, ".understand-anything", "knowledge-graph.json"), {
      kind: "knowledge",
      nodes: [
        {
          id: `requirement:${service}`,
          name: service,
          type: "requirement",
          summary: "Knowledge service candidate.",
          tags: ["prd"],
          complexity: "simple",
        },
      ],
      edges: [],
    })
  }
}

function seedSymlinkEscapedBasePathService(root: string): string {
  const outsideDir = path.join(path.dirname(root), `${path.basename(root)}-symlink-outside`)
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 1, totalNodes: 1, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      linked: {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "linked-service",
      },
    },
  })
  writeJson(path.join(outsideDir, ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:symlink",
        name: "Symlink Reconnect",
        type: "requirement",
        summary: "This graph is outside the project root via a symlink.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
  fs.symlinkSync(outsideDir, path.join(root, "linked-service"), "dir")
  return outsideDir
}

function seedMixedKindServices(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 2, totalNodes: 2, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "facet-only": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "facet-only",
        facet: "knowledge",
      },
      "kg-kind": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "kg-kind",
        facet: "server",
      },
    },
  })

  writeJson(path.join(root, "facet-only", ".understand-anything", "knowledge-graph.json"), {
    kind: "code",
    nodes: [
      {
        id: "requirement:wrong",
        name: "Wrong Reconnect",
        type: "requirement",
        summary: "Should not be selected for reconnect.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })

  writeJson(path.join(root, "kg-kind", ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:right",
        name: "Right Reconnect",
        type: "requirement",
        summary: "This knowledge KG should be selected for reconnect.",
        tags: ["prd"],
        complexity: "simple",
        knowledgeMeta: {
          sourcePath: "raw/prd/right.md",
          sourceType: "prd",
        },
      },
    ],
    edges: [],
  })
}

function seedKnowledgeFacetAmongCodeServices(root: string): void {
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    generatedAt: "2026-07-03T00:00:00Z",
    project: { name: "Trace Test", serviceCount: 2, totalNodes: 2, totalEdges: 0 },
    nodes: [],
    edges: [],
    serviceIndex: {
      "amar-prd": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "amar-prd",
        facet: "knowledge",
      },
      "code-service": {
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
        basePath: "code-service",
        facet: "server",
      },
    },
  })

  writeJson(path.join(root, "amar-prd", ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:prd",
        name: "PRD Reconnect",
        type: "requirement",
        summary: "Knowledge facet requirement.",
        tags: ["prd"],
        complexity: "simple",
      },
    ],
    edges: [],
  })

  writeJson(path.join(root, "code-service", ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    nodes: [
      {
        id: "requirement:code",
        name: "Code Reconnect",
        type: "requirement",
        summary: "Server facet should not be selected as PRD context.",
        tags: ["server"],
        complexity: "simple",
      },
    ],
    edges: [],
  })
}

describe("handleKnowledgeTraceRequest", () => {
  let dir: string
  let extraDirs: string[]
  let originalCwd: string
  let originalGraphDir: string | undefined

  beforeEach(() => {
    originalCwd = process.cwd()
    originalGraphDir = process.env.GRAPH_DIR
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-trace-"))
    extraDirs = []
    process.env.GRAPH_DIR = dir
    process.chdir(dir)
    seedKnowledgeService(dir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalGraphDir === undefined) {
      delete process.env.GRAPH_DIR
    } else {
      process.env.GRAPH_DIR = originalGraphDir
    }
    for (const extraDir of extraDirs) {
      fs.rmSync(extraDir, { recursive: true, force: true })
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns compact trace groups, coverage, citedSources, nextReads, and omits content by default", async () => {
    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect progress", service: "amar-prd" }), mockCtx)

    expect(res?.statusCode).toBe(200)
    const body = res?.body as {
      kind: string
      service: string
      matches: Array<Record<string, unknown>>
      related: Record<string, Array<Record<string, unknown>>>
      coverage: Array<Record<string, unknown>>
      citedSources: Array<Record<string, unknown>>
      nextReads: Array<Record<string, unknown>>
      limits: Record<string, unknown>
    }

    expect(body.kind).toBe("knowledge-trace")
    expect(body.service).toBe("amar-prd")
    expect(body.matches[0]).toMatchObject({
      id: "requirement:pk-reconnect",
      name: "PK Reconnect",
      sourcePath: "raw/prd/pk-reconnect.md",
      sourceType: "prd",
      business: "room-pk",
      version: "v1",
    })
    expect(body.matches[0]).not.toHaveProperty("content")
    expect(body.matches[0]).not.toHaveProperty("knowledgeMeta")
    expect(body.matches[0]).not.toHaveProperty("contentSnippet")
    expect(body.related.related.map((n) => n.id)).toEqual(["requirement:pk-room"])
    expect(body.related.cites.map((n) => n.id)).toEqual(["source:pk-doc"])
    expect(body.related.tested_by.map((n) => n.id)).toEqual(["testcase:pk-reconnect"])
    expect(body.related.categorized_under.map((n) => n.id)).toEqual(["topic:pk"])
    expect(body.coverage.map((n) => n.id)).toEqual(["testcase:pk-reconnect"])
    expect(body.citedSources.map((n) => n.id)).toEqual(["source:pk-doc"])
    expect(body.nextReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "requirement:pk-room", filePath: "wiki/requirements/pk-room.md" }),
        expect.objectContaining({ id: "source:pk-doc", sourcePath: "raw/prd/source/pk.md" }),
      ]),
    )
    expect(body.limits).toMatchObject({
      matchLimit: 5,
      neighborLimitPerType: 5,
      depth: 1,
      contentIncluded: false,
      summaryMaxChars: 800,
      snippetMaxChars: 0,
    })
  })

  it("read=1 returns bounded contentSnippet and still omits content", async () => {
    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect progress", service: "amar-prd", read: "1" }), mockCtx)

    expect(res?.statusCode).toBe(200)
    const body = res?.body as { matches: Array<Record<string, unknown>>; limits: Record<string, unknown> }
    expect(body.matches[0]).toHaveProperty("contentSnippet")
    expect((body.matches[0].contentSnippet as string).length).toBeLessThanOrEqual(1000)
    expect(body.matches[0]).not.toHaveProperty("content")
    expect(body.matches[0]).not.toHaveProperty("knowledgeMeta")
    expect(body.limits).toMatchObject({ contentIncluded: true, snippetMaxChars: 1000 })
  })

  it("returns 400 when q is missing", async () => {
    const res = await handleKnowledgeTraceRequest(makeReq({ service: "amar-prd" }), mockCtx)

    expect(res?.statusCode).toBe(400)
  })

  it("auto-selects the only loadable knowledge facet service", async () => {
    seedKnowledgeFacetAmongCodeServices(dir)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect" }), mockCtx)

    expect(res?.statusCode).toBe(200)
    const body = res?.body as { service: string; matches: Array<Record<string, unknown>> }
    expect(body.service).toBe("amar-prd")
    expect(body.matches.map((node) => node.id)).toEqual(["requirement:prd"])
  })

  it("does not auto-select non-knowledge facets even when their graph kind is knowledge", async () => {
    seedMixedKindServices(dir)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect" }), mockCtx)

    expect(res?.statusCode).toBe(404)
    expect(res?.body).toMatchObject({ code: "KNOWLEDGE_SERVICE_NOT_FOUND" })
  })

  it("matches markdown link labels and targets in trace search", async () => {
    const res = await handleKnowledgeTraceRequest(makeReq({ q: "summaries room pk", service: "amar-prd" }), mockCtx)

    expect(res?.statusCode).toBe(200)
    const body = res?.body as { matches: Array<Record<string, unknown>> }
    expect(body.matches.map((node) => node.id)).toContain("requirement:pk-room")
  })

  it("does not auto-select a service whose basePath escapes the project root", async () => {
    extraDirs.push(seedEscapedBasePathService(dir))

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect", service: "escaped" }), mockCtx)

    expect(res?.statusCode).toBe(400)
    expect(res?.body).toMatchObject({ code: "SERVICE_PATH_OUTSIDE_ROOT" })
  })

  it("rejects explicit service when the graph kind is not knowledge", async () => {
    seedExplicitNonKnowledgeService(dir)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect", service: "code-kg" }), mockCtx)

    expect(res?.statusCode).toBe(400)
    expect(res?.body).toMatchObject({ code: "INVALID_KNOWLEDGE_GRAPH_KIND" })
  })

  it("skips invalid service names from automatic candidates", async () => {
    const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-trace-parent-"))
    const projectRoot = path.join(parentRoot, "project")
    extraDirs.push(parentRoot)
    fs.mkdirSync(projectRoot, { recursive: true })
    process.env.GRAPH_DIR = projectRoot
    process.chdir(projectRoot)
    seedIllegalServiceKeyFallback(projectRoot, parentRoot)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect" }), mockCtx)

    expect(res?.statusCode).toBe(404)
    expect(res?.body).toMatchObject({ code: "KNOWLEDGE_SERVICE_NOT_FOUND" })
  })

  it("does not load a service graph through a symlink escaping the project root", async () => {
    extraDirs.push(seedSymlinkEscapedBasePathService(dir))

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect", service: "linked" }), mockCtx)

    expect(res?.statusCode).toBe(400)
    expect(res?.body).toMatchObject({ code: "SERVICE_PATH_OUTSIDE_ROOT" })
  })

  it("returns candidates when multiple knowledge services are available", async () => {
    seedTwoKnowledgeServices(dir)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "knowledge" }), mockCtx)

    expect(res?.statusCode).toBe(400)
    expect(res?.body).toMatchObject({
      code: "MULTIPLE_KNOWLEDGE_SERVICES",
      candidates: ["knowledge-a", "knowledge-b"],
    })
  })

  it("rejects an explicit invalid service name", async () => {
    const res = await handleKnowledgeTraceRequest(makeReq({ q: "reconnect", service: ".." }), mockCtx)

    expect(res?.statusCode).toBe(400)
    expect(res?.body).toMatchObject({ code: "INVALID_SERVICE_NAME" })
  })

  it("returns 404 when there are no loadable knowledge services", async () => {
    seedNoKnowledgeServices(dir)

    const res = await handleKnowledgeTraceRequest(makeReq({ q: "knowledge" }), mockCtx)

    expect(res?.statusCode).toBe(404)
    expect(res?.body).toMatchObject({ code: "KNOWLEDGE_SERVICE_NOT_FOUND" })
  })
})
