# Knowledge Facet Compact Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact knowledge trace path for parent-launched knowledge facets such as `amar-prd`, expose it through `ua_query.py knowledge trace`, and let `ask` consume it without defaulting to full PRD content.

**Architecture:** Add a focused dashboard API handler at `/api/knowledge/trace` that loads a knowledge service graph, searches compactly, groups graph neighbors by edge type, and returns summaries plus paths. The Python CLI becomes a thin client for that endpoint, and `ask` reuses the same compact result while keeping code source verification separate.

**Tech Stack:** TypeScript/Vitest for dashboard API handlers; Python stdlib/pytest for `understand-query`; existing MiniSearch-backed `/api/search`, `service-resolver`, and `knowledge-graph.json` contracts.

---

## File Structure

- Create `understand-anything-plugin/packages/dashboard/src/api/handlers/knowledge.ts`
  - Owns `/api/knowledge/trace`.
  - Keeps compact node shaping, service resolution, graph loading, neighbor grouping, and snippet clipping together.
- Modify `understand-anything-plugin/packages/dashboard/src/api/index.ts`
  - Registers `handleKnowledgeRequest` before graph fallback handlers.
- Create `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/knowledge-trace.test.ts`
  - Unit tests API validation, compact output, edge grouping, and content omission.
- Modify `understand-anything-plugin/skills/understand-query/ua_query.py`
  - Adds `knowledge trace` parser and `--read`.
  - Adds `ask --knowledge-read`.
- Modify `understand-anything-plugin/skills/understand-query/_commands.py`
  - Adds `knowledge trace` command behavior.
  - Replaces `ask` shallow PRD search with compact trace reuse.
- Modify `understand-anything-plugin/skills/understand-query/_utils.py`
  - Adds Markdown formatting for `knowledge-trace`.
- Modify `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py`
  - Adds parser and command tests for `knowledge trace`.
- Modify `understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py`
  - Adds Markdown formatting tests for compact trace.
- Modify `understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py`
  - Updates `ask` PRD context expectations from raw search list to compact trace object.
- Modify `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts`
  - Indexes `knowledgeMeta.markdownLinks[].label` and `.target` as search text.
- Modify `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts`
  - Verifies markdown link labels/targets improve recall.
- Modify `understand-anything-plugin/skills/understand-query/SKILL.md`
  - Documents `knowledge trace`, compact behavior, and `--knowledge-read`.

---

## Task 1: Server Knowledge Trace Handler

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/api/handlers/knowledge.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/api/index.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/knowledge-trace.test.ts`

- [ ] **Step 1: Write API tests for compact trace**

Create `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/knowledge-trace.test.ts` with tests that write a temporary parent graph layout and call the handler directly.

```ts
import { afterEach, describe, expect, it } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { handleKnowledgeRequest } from "../knowledge"
import type { ApiContext, ApiRequest } from "../../types"

const originalGraphDir = process.env.GRAPH_DIR

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
  fs.writeFileSync(filePath, JSON.stringify(data), "utf-8")
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ua-knowledge-trace-"))
  process.env.GRAPH_DIR = root
  writeJson(path.join(root, ".understand-anything", "system-graph.json"), {
    version: "1.0.0",
    project: { name: "kb" },
    nodes: [],
    edges: [],
    serviceIndex: {
      "amar-prd": {
        basePath: "amar-prd",
        facet: "knowledge",
        hasKg: true,
        hasWiki: false,
        hasDomain: false,
      },
    },
  })
  writeJson(path.join(root, "amar-prd", ".understand-anything", "knowledge-graph.json"), {
    kind: "knowledge",
    version: "1.0.0",
    project: { name: "Amar PRD", languages: ["markdown"], frameworks: ["prd-wiki"] },
    layers: [],
    tour: [],
    nodes: [
      {
        id: "requirement:summaries/room-pk",
        type: "requirement",
        name: "跨房间PK",
        summary: "跨房间 PK 需求摘要",
        filePath: "wiki/summaries/room-pk.md",
        tags: ["房间", "prd"],
        complexity: "simple",
        knowledgeMeta: {
          business: "房间",
          version: "v2.25.0",
          sourcePath: "raw/prd/房间/room-pk.md",
          sourceType: "prd",
          content: "完整正文 ".repeat(1000),
        },
      },
      {
        id: "article:concepts/room",
        type: "article",
        name: "房间",
        summary: "房间业务域",
        filePath: "wiki/concepts/room.md",
        tags: ["concept"],
        complexity: "simple",
        knowledgeMeta: { content: "房间概念正文" },
      },
      {
        id: "source:prd/room-pk",
        type: "source",
        name: "room-pk.md",
        summary: "Raw PRD",
        filePath: "raw/prd/房间/room-pk.md",
        tags: ["raw", "prd"],
        complexity: "simple",
        knowledgeMeta: { sourceType: "prd" },
      },
      {
        id: "testcase:testcases/room-pk",
        type: "testcase",
        name: "跨房间PK 测试用例",
        summary: "跨房间 PK QA 覆盖",
        filePath: "wiki/testcases/room-pk.md",
        tags: ["testcase"],
        complexity: "simple",
        knowledgeMeta: {
          sourcePath: "raw/testcase/房间/room-pk.md",
          sourceType: "testcase",
          content: "测试正文 ".repeat(500),
        },
      },
      {
        id: "topic:summaries",
        type: "topic",
        name: "Summaries",
        summary: "Summary category",
        tags: ["topic"],
        complexity: "simple",
      },
    ],
    edges: [
      { source: "requirement:summaries/room-pk", target: "article:concepts/room", type: "related", direction: "forward", weight: 0.7 },
      { source: "requirement:summaries/room-pk", target: "source:prd/room-pk", type: "cites", direction: "forward", weight: 0.8 },
      { source: "requirement:summaries/room-pk", target: "testcase:testcases/room-pk", type: "tested_by", direction: "forward", weight: 0.85 },
      { source: "requirement:summaries/room-pk", target: "topic:summaries", type: "categorized_under", direction: "forward", weight: 0.6 },
    ],
  })
  return root
}

afterEach(() => {
  if (originalGraphDir === undefined) delete process.env.GRAPH_DIR
  else process.env.GRAPH_DIR = originalGraphDir
})

describe("handleKnowledgeRequest", () => {
  it("returns compact trace grouped by edge type without full content by default", async () => {
    makeRoot()
    const res = await handleKnowledgeRequest(makeReq({ q: "跨房间PK", service: "amar-prd" }), {} as ApiContext)
    expect(res?.statusCode).toBe(200)
    const body = res!.body as {
      kind: string
      matches: Array<{ id: string; content?: string; contentSnippet?: string; filePath?: string; sourcePath?: string }>
      related: Record<string, unknown[]>
      coverage: unknown[]
      citedSources: unknown[]
      nextReads: unknown[]
      limits: { contentIncluded: boolean }
    }
    expect(body.kind).toBe("knowledge-trace")
    expect(body.matches[0].id).toBe("requirement:summaries/room-pk")
    expect(body.matches[0].content).toBeUndefined()
    expect(body.matches[0].contentSnippet).toBeUndefined()
    expect(body.matches[0].filePath).toBe("wiki/summaries/room-pk.md")
    expect(body.matches[0].sourcePath).toBe("raw/prd/房间/room-pk.md")
    expect(body.related.related).toHaveLength(1)
    expect(body.related.cites).toHaveLength(1)
    expect(body.related.tested_by).toHaveLength(1)
    expect(body.related.categorized_under).toHaveLength(1)
    expect(body.coverage).toHaveLength(1)
    expect(body.citedSources).toHaveLength(1)
    expect(body.nextReads.length).toBeGreaterThan(0)
    expect(body.limits.contentIncluded).toBe(false)
  })

  it("returns bounded snippets only when read=1", async () => {
    makeRoot()
    const res = await handleKnowledgeRequest(makeReq({ q: "跨房间PK", service: "amar-prd", read: "1" }), {} as ApiContext)
    expect(res?.statusCode).toBe(200)
    const body = res!.body as { matches: Array<{ contentSnippet?: string; content?: string }>; limits: { contentIncluded: boolean; snippetMaxChars: number } }
    expect(body.limits.contentIncluded).toBe(true)
    expect(body.limits.snippetMaxChars).toBe(1000)
    expect(body.matches[0].content).toBeUndefined()
    expect(body.matches[0].contentSnippet).toBeDefined()
    expect(body.matches[0].contentSnippet!.length).toBeLessThanOrEqual(1000)
  })

  it("returns 400 for missing q", async () => {
    makeRoot()
    const res = await handleKnowledgeRequest(makeReq({ service: "amar-prd" }), {} as ApiContext)
    expect(res?.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run the new API test and verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run src/api/handlers/__tests__/knowledge-trace.test.ts
```

Expected: fails because `../knowledge` does not exist.

- [ ] **Step 3: Implement `knowledge.ts`**

Create `understand-anything-plugin/packages/dashboard/src/api/handlers/knowledge.ts` with this structure:

```ts
import fs from "fs"
import path from "path"
import type { ApiRequest, ApiContext, ApiResponse } from "../types"
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core"
import {
  resolveServiceDataPath,
  validateServiceName,
  listServiceNames,
} from "../service-resolver"
import { tokenize } from "./search"

type TraceEdgeType = "related" | "cites" | "tested_by" | "categorized_under"

interface CompactKnowledgeNode {
  id: string
  name: string
  type: string
  summary: string
  filePath?: string
  sourcePath?: string
  sourceType?: string
  business?: string
  version?: string
  score?: number
  edgeType?: string
  contentSnippet?: string
}

const EDGE_TYPES: TraceEdgeType[] = ["related", "cites", "tested_by", "categorized_under"]
const DEFAULT_MATCH_LIMIT = 5
const DEFAULT_NEIGHBOR_LIMIT = 5
const SUMMARY_MAX_CHARS = 800
const SNIPPET_MAX_CHARS = 1000

function clampInt(value: string | null, fallback: number, min: number, max: number): number | ApiResponse {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { statusCode: 400, body: { error: `value must be between ${min} and ${max}` } }
  }
  return parsed
}

function boolParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes"
}

function compactText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : ""
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

function compactNode(node: GraphNode, opts: { score?: number; edgeType?: string; includeSnippet: boolean }): CompactKnowledgeNode {
  const meta = node.knowledgeMeta
  const result: CompactKnowledgeNode = {
    id: node.id,
    name: node.name || node.id,
    type: node.type,
    summary: compactText(node.summary, SUMMARY_MAX_CHARS),
  }
  if (node.filePath) result.filePath = node.filePath
  if (typeof meta?.sourcePath === "string" && meta.sourcePath) result.sourcePath = meta.sourcePath
  if (typeof meta?.sourceType === "string" && meta.sourceType) result.sourceType = meta.sourceType
  if (typeof meta?.business === "string" && meta.business) result.business = meta.business
  if (typeof meta?.version === "string" && meta.version) result.version = meta.version
  if (opts.score !== undefined) result.score = opts.score
  if (opts.edgeType) result.edgeType = opts.edgeType
  if (opts.includeSnippet && typeof meta?.content === "string") {
    result.contentSnippet = compactText(meta.content, SNIPPET_MAX_CHARS)
  }
  return result
}

function resolveKnowledgeService(service: string | null): string | ApiResponse {
  const serviceErr = validateServiceName(service)
  if (serviceErr) return serviceErr
  if (service) return service
  const services = listServiceNames(null).filter((name) => {
    const kgPath = resolveServiceDataPath(name, "knowledge-graph.json")
    if (!kgPath) return false
    try {
      const graph = JSON.parse(fs.readFileSync(kgPath, "utf-8")) as { kind?: string }
      return graph.kind === "knowledge"
    } catch {
      return false
    }
  })
  if (services.length === 1) return services[0]
  if (services.length === 0) {
    return { statusCode: 404, body: { error: "No knowledge service found. Check parent GRAPH_DIR and system graph generation." } }
  }
  return {
    statusCode: 400,
    body: { error: "Multiple knowledge services found. Pass service.", candidates: services },
  }
}

function loadKnowledgeGraph(serviceName: string): KnowledgeGraph | ApiResponse {
  const graphPath = resolveServiceDataPath(serviceName, "knowledge-graph.json")
  if (!graphPath) {
    return { statusCode: 404, body: { error: `knowledge-graph.json not found for service ${serviceName}` } }
  }
  try {
    return JSON.parse(fs.readFileSync(graphPath, "utf-8")) as KnowledgeGraph
  } catch {
    return { statusCode: 500, body: { error: "Failed to read knowledge graph" } }
  }
}

function scoreNode(node: GraphNode, query: string): number {
  const tokens = tokenize(query)
  const meta = node.knowledgeMeta
  const haystack = [
    node.name,
    node.summary,
    ...(node.tags ?? []),
    typeof meta?.business === "string" ? meta.business : "",
    typeof meta?.version === "string" ? meta.version : "",
    typeof meta?.sourcePath === "string" ? meta.sourcePath : "",
    typeof meta?.content === "string" ? meta.content : "",
  ].join(" ").toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token.toLowerCase())) score += 1
  }
  if ((node.name || "").toLowerCase().includes(query.toLowerCase())) score += 3
  return score
}

function findMatches(graph: KnowledgeGraph, query: string, typeFilter: string | null, limit: number): Array<{ node: GraphNode; score: number }> {
  return graph.nodes
    .filter((node) => !typeFilter || node.type === typeFilter)
    .map((node) => ({ node, score: scoreNode(node, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "statusCode" in value && "body" in value
}

function groupNeighbors(
  graph: KnowledgeGraph,
  matches: Array<{ node: GraphNode; score: number }>,
  neighborLimit: number,
  includeSnippet: boolean,
): { related: Record<TraceEdgeType, CompactKnowledgeNode[]>; coverage: CompactKnowledgeNode[]; citedSources: CompactKnowledgeNode[]; nextReads: Array<{ id: string; filePath?: string; sourcePath?: string }> } {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const related: Record<TraceEdgeType, CompactKnowledgeNode[]> = {
    related: [],
    cites: [],
    tested_by: [],
    categorized_under: [],
  }
  const seenByType = new Map<TraceEdgeType, Set<string>>()
  for (const type of EDGE_TYPES) seenByType.set(type, new Set())

  for (const match of matches) {
    for (const edge of graph.edges as GraphEdge[]) {
      const edgeType = edge.type as TraceEdgeType
      if (!EDGE_TYPES.includes(edgeType)) continue
      let neighborId = ""
      if (edge.source === match.node.id) neighborId = edge.target
      else if (edge.target === match.node.id) neighborId = edge.source
      if (!neighborId) continue
      const seen = seenByType.get(edgeType)!
      if (seen.has(neighborId) || seen.size >= neighborLimit) continue
      const neighbor = nodesById.get(neighborId)
      if (!neighbor) continue
      seen.add(neighborId)
      related[edgeType].push(compactNode(neighbor, { edgeType, includeSnippet }))
    }
  }

  const coverage = related.tested_by.filter((node) => node.type === "testcase")
  const citedSources = related.cites.filter((node) => node.type === "source")
  const nextReads = [...matches.map((m) => compactNode(m.node, { score: m.score, includeSnippet: false })), ...coverage, ...citedSources]
    .map((node) => ({ id: node.id, filePath: node.filePath, sourcePath: node.sourcePath }))

  return { related, coverage, citedSources, nextReads }
}

function handleTrace(searchParams: URLSearchParams): ApiResponse {
  const query = searchParams.get("q")?.trim() ?? ""
  if (!query) return { statusCode: 400, body: { error: "q parameter required" } }
  const limit = clampInt(searchParams.get("limit"), DEFAULT_MATCH_LIMIT, 1, 20)
  if (isApiResponse(limit)) return limit
  const neighborLimit = clampInt(searchParams.get("neighborLimit"), DEFAULT_NEIGHBOR_LIMIT, 1, 20)
  if (isApiResponse(neighborLimit)) return neighborLimit
  const depth = clampInt(searchParams.get("depth"), 1, 1, 2)
  if (isApiResponse(depth)) return depth
  const service = resolveKnowledgeService(searchParams.get("service"))
  if (isApiResponse(service)) return service
  const graph = loadKnowledgeGraph(service)
  if (isApiResponse(graph)) return graph

  const includeSnippet = boolParam(searchParams.get("read"))
  const matches = findMatches(graph, query, searchParams.get("type"), limit)
  const compactMatches = matches.map((entry) => compactNode(entry.node, { score: entry.score, includeSnippet }))
  const grouped = groupNeighbors(graph, matches, neighborLimit, includeSnippet)

  return {
    statusCode: 200,
    body: {
      kind: "knowledge-trace",
      service,
      query,
      matches: compactMatches,
      related: grouped.related,
      coverage: grouped.coverage,
      citedSources: grouped.citedSources,
      nextReads: grouped.nextReads,
      limits: {
        matchLimit: limit,
        neighborLimitPerType: neighborLimit,
        depth,
        contentIncluded: includeSnippet,
        summaryMaxChars: SUMMARY_MAX_CHARS,
        snippetMaxChars: includeSnippet ? SNIPPET_MAX_CHARS : 0,
      },
    },
  }
}

export async function handleKnowledgeRequest(
  req: ApiRequest,
  _ctx: ApiContext,
): Promise<ApiResponse | null> {
  if (req.pathname !== "/api/knowledge/trace") return null
  return handleTrace(req.searchParams)
}
```

This first implementation intentionally uses deterministic in-memory scoring instead of calling `/api/search` from inside the handler. It keeps the endpoint self-contained and avoids router recursion. The later indexing task improves normal `/api/search` recall separately.

- [ ] **Step 4: Register the API handler**

Modify `understand-anything-plugin/packages/dashboard/src/api/index.ts`:

```ts
import { handleKnowledgeRequest } from "./handlers/knowledge"
```

Add it near the front of `HANDLERS`:

```ts
const HANDLERS = [
  handleServicesRequest,
  handleSearchRequest,
  handleKnowledgeRequest,
  handleGraphQueryRequest,
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleStructureRequest,
  handleGraphRequest,
]
```

- [ ] **Step 5: Run the API test and verify it passes**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run src/api/handlers/__tests__/knowledge-trace.test.ts
```

Expected: all tests in `knowledge-trace.test.ts` pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/knowledge.ts \
  understand-anything-plugin/packages/dashboard/src/api/index.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/knowledge-trace.test.ts
git commit -m "feat: add compact knowledge trace api"
```

---

## Task 2: CLI `knowledge trace`

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Modify: `understand-anything-plugin/skills/understand-query/_commands.py`
- Test: `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py`

- [ ] **Step 1: Add failing parser and command tests**

Append these tests to `understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py`:

```py
def test_parse_knowledge_trace_args():
    args = parse_args([
        "knowledge",
        "trace",
        "跨房间 PK",
        "--service",
        "amar-prd",
        "--type",
        "requirement",
        "--depth",
        "2",
        "--read",
    ])

    assert args.command == "knowledge"
    assert args.knowledge_action == "trace"
    assert args.query == "跨房间 PK"
    assert args.service == "amar-prd"
    assert args.type == "requirement"
    assert args.depth == 2
    assert args.read is True


@patch("_commands._resolve_knowledge_service")
@patch("_commands._helpers.fetch_json")
def test_knowledge_trace_calls_api_with_compact_defaults(mock_fetch, mock_resolve):
    mock_resolve.return_value = "amar-prd"
    mock_fetch.return_value = {
        "kind": "knowledge-trace",
        "service": "amar-prd",
        "query": "跨房间 PK",
        "matches": [],
        "related": {},
        "coverage": [],
        "citedSources": [],
        "nextReads": [],
        "limits": {"contentIncluded": False},
    }

    result = cmd_knowledge(_args(
        knowledge_action="trace",
        query="跨房间 PK",
        type="requirement",
        depth=2,
        limit=3,
        read=True,
    ))

    mock_resolve.assert_called_once_with("http://localhost:3001", "amar-prd")
    mock_fetch.assert_called_once_with(
        "http://localhost:3001",
        "/api/knowledge/trace",
        {
            "service": "amar-prd",
            "q": "跨房间 PK",
            "limit": "3",
            "depth": "2",
            "type": "requirement",
            "read": "1",
        },
    )
    assert result["kind"] == "knowledge-trace"
```

Update `_args()` defaults in that same file:

```py
"read": False,
```

- [ ] **Step 2: Run Python tests and verify they fail**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py -q
```

Expected: fails because `knowledge trace` parser/action does not exist.

- [ ] **Step 3: Add CLI parser**

Modify `understand-anything-plugin/skills/understand-query/ua_query.py` inside the `knowledge` subparser block:

```py
    knowledge_trace = knowledge_sub.add_parser("trace", help="Compact knowledge graph trace")
    knowledge_trace.add_argument("query")
    knowledge_trace.add_argument("--service")
    knowledge_trace.add_argument("--type", choices=["requirement", "testcase", "source", "article", "topic", "entity", "claim"])
    knowledge_trace.add_argument("--limit", type=int, default=5)
    knowledge_trace.add_argument("--depth", type=int, default=1)
    knowledge_trace.add_argument("--read", action="store_true", help="Include bounded content snippets")
```

- [ ] **Step 4: Add command implementation**

Modify `cmd_knowledge` in `understand-anything-plugin/skills/understand-query/_commands.py` after the `search` action:

```py
    if action == "trace":
        params: dict[str, str] = {
            "service": service,
            "q": args.query,
            "limit": str(args.limit),
            "depth": str(args.depth),
        }
        if args.type:
            params["type"] = args.type
        if getattr(args, "read", False):
            params["read"] = "1"
        return _helpers.fetch_json(args.server, "/api/knowledge/trace", params)
```

- [ ] **Step 5: Run CLI unit tests and verify they pass**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py -q
```

Expected: all tests in `test_knowledge_command.py` pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py \
  understand-anything-plugin/skills/understand-query/_commands.py \
  understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py
git commit -m "feat: add knowledge trace cli"
```

---

## Task 3: Markdown Formatting for Knowledge Trace

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/_utils.py`
- Test: `understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py`

- [ ] **Step 1: Add failing Markdown format test**

Append to `understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py`:

```py
def test_knowledge_trace_markdown_is_compact():
    rendered = _format_markdown({
        "kind": "knowledge-trace",
        "service": "amar-prd",
        "query": "跨房间PK",
        "matches": [
            {
                "id": "requirement:summaries/room-pk",
                "name": "跨房间PK",
                "type": "requirement",
                "summary": "需求摘要",
                "filePath": "wiki/summaries/room-pk.md",
                "sourcePath": "raw/prd/房间/room-pk.md",
            }
        ],
        "related": {
            "related": [
                {
                    "id": "article:concepts/room",
                    "name": "房间",
                    "type": "article",
                    "summary": "房间概念",
                    "filePath": "wiki/concepts/room.md",
                }
            ],
            "cites": [],
            "tested_by": [],
            "categorized_under": [],
        },
        "coverage": [
            {
                "id": "testcase:testcases/room-pk",
                "name": "跨房间PK 测试用例",
                "type": "testcase",
                "summary": "测试摘要",
                "filePath": "wiki/testcases/room-pk.md",
            }
        ],
        "citedSources": [
            {
                "id": "source:prd/room-pk",
                "name": "room-pk.md",
                "type": "source",
                "summary": "Raw PRD",
                "filePath": "raw/prd/房间/room-pk.md",
            }
        ],
        "nextReads": [
            {
                "id": "requirement:summaries/room-pk",
                "filePath": "wiki/summaries/room-pk.md",
            }
        ],
        "limits": {"contentIncluded": False},
    })

    assert rendered.startswith("# Knowledge Trace: 跨房间PK")
    assert "## PRD Matches" in rendered
    assert "## Related" in rendered
    assert "## Cited Sources" in rendered
    assert "## Test Coverage" in rendered
    assert "## Next Reads" in rendered
    assert "knowledge read --service amar-prd --node" in rendered
    assert "需求摘要" in rendered
```

- [ ] **Step 2: Run formatter tests and verify they fail**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py -q
```

Expected: fails because `_format_markdown` has no `knowledge-trace` branch.

- [ ] **Step 3: Add formatter helpers**

Modify `understand-anything-plugin/skills/understand-query/_utils.py` near existing knowledge formatting branches. Add compact helpers before `_format_markdown` returns generic output:

```py
def _knowledge_trace_node_line(node: dict) -> str:
    name = node.get("name", node.get("id", "?"))
    node_type = node.get("type", "?")
    summary = node.get("summary", "")
    file_path = node.get("filePath", "")
    source_path = node.get("sourcePath", "")
    parts = [f"- **{name}** (`{node_type}`)"]
    if summary:
        parts.append(f" — {summary}")
    if file_path:
        parts.append(f"\n  - wiki: `{file_path}`")
    if source_path:
        parts.append(f"\n  - source: `{source_path}`")
    node_id = node.get("id")
    if node_id:
        parts.append(f"\n  - node: `{node_id}`")
    snippet = node.get("contentSnippet")
    if snippet:
        parts.append(f"\n  - snippet: {snippet}")
    return "".join(parts)


def _format_knowledge_trace(data: dict) -> str:
    query = data.get("query", "")
    service = data.get("service", "")
    lines = [f"# Knowledge Trace: {query}", ""]
    if service:
        lines.append(f"Service: `{service}`")
        lines.append("")

    lines.append("## PRD Matches")
    matches = data.get("matches") or []
    if matches:
        lines.extend(_knowledge_trace_node_line(n) for n in matches)
    else:
        lines.append("No matches.")
    lines.append("")

    lines.append("## Related")
    related = data.get("related") or {}
    any_related = False
    for edge_type in ("related", "categorized_under"):
        nodes = related.get(edge_type) or []
        if not nodes:
            continue
        any_related = True
        lines.append(f"### {edge_type}")
        lines.extend(_knowledge_trace_node_line(n) for n in nodes)
    if not any_related:
        lines.append("No related nodes.")
    lines.append("")

    lines.append("## Cited Sources")
    cited = data.get("citedSources") or []
    if cited:
        lines.extend(_knowledge_trace_node_line(n) for n in cited)
    else:
        lines.append("No cited sources.")
    lines.append("")

    lines.append("## Test Coverage")
    coverage = data.get("coverage") or []
    if coverage:
        lines.extend(_knowledge_trace_node_line(n) for n in coverage)
    else:
        lines.append("No deterministic testcase coverage found.")
    lines.append("")

    lines.append("## Next Reads")
    next_reads = data.get("nextReads") or []
    if next_reads:
        for item in next_reads[:10]:
            node_id = item.get("id")
            if node_id:
                lines.append(f"- `python3 ua_query.py knowledge read --service {service} --node \"{node_id}\"`")
    else:
        lines.append("No next reads.")
    return "\n".join(lines)
```

Then add this branch inside `_format_markdown`:

```py
    if isinstance(data, dict) and data.get("kind") == "knowledge-trace":
        return _format_knowledge_trace(data)
```

- [ ] **Step 4: Run formatter tests and verify they pass**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py -q
```

Expected: all tests in `test_knowledge_read_format.py` pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add understand-anything-plugin/skills/understand-query/_utils.py \
  understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py
git commit -m "feat: format compact knowledge trace"
```

---

## Task 4: `ask` Compact PRD Context and `--knowledge-read`

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/ua_query.py`
- Modify: `understand-anything-plugin/skills/understand-query/_commands.py`
- Test: `understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py`

- [ ] **Step 1: Update ask tests for compact trace**

Replace expectations in `test_ask_prd_context.py` so `cmd_ask` calls `/api/knowledge/trace` instead of `_search_api` for PRD context.

Use this compact fixture:

```py
PRD_TRACE_RESULT = {
    "kind": "knowledge-trace",
    "service": "amar-prd",
    "query": "公会结算",
    "matches": [{"id": "requirement:1", "name": "公会结算需求", "type": "requirement"}],
    "related": {"related": [], "cites": [], "tested_by": [], "categorized_under": []},
    "coverage": [],
    "citedSources": [],
    "nextReads": [],
    "limits": {"contentIncluded": False},
}
```

For `test_cmd_ask_includes_prd_context_when_knowledge_service_exists`, patch `_commands._helpers.fetch_json` and assert:

```py
mock_fetch.assert_any_call(
    "http://localhost:3001",
    "/api/knowledge/trace",
    {
        "service": "amar-prd",
        "q": "公会结算",
        "limit": "5",
        "depth": "1",
    },
)
assert result["prdContext"] == PRD_TRACE_RESULT
```

Add parser test:

```py
from ua_query import parse_args


def test_parse_ask_knowledge_read():
    args = parse_args(["ask", "--query", "跨房间PK", "--depth", "full", "--knowledge-read"])
    assert args.knowledge_read is True
```

Add behavior test:

```py
@patch("_commands.cmd_trace")
@patch("_commands._helpers.fetch_json")
@patch("_helpers._discover_knowledge_services")
def test_cmd_ask_passes_read_to_prd_context(mock_discover, mock_fetch, mock_trace):
    mock_discover.return_value = ["amar-prd"]
    mock_fetch.return_value = PRD_TRACE_RESULT
    mock_trace.return_value = {"matchedNodes": []}

    args = _make_ask_args(service="code-svc", query="跨房间PK", depth="full", knowledge_read=True)
    result = cmd_ask(args)

    assert result["prdContext"] == PRD_TRACE_RESULT
    assert mock_fetch.call_args_list[0].args[2]["read"] == "1"
```

Update `_make_ask_args()` defaults:

```py
"knowledge_read": False,
```

- [ ] **Step 2: Run ask tests and verify they fail**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py -q
```

Expected: fails because `ask --knowledge-read` and compact trace usage are not implemented.

- [ ] **Step 3: Add ask parser flag**

Modify `understand-anything-plugin/skills/understand-query/ua_query.py` in the `ask` parser block:

```py
    ask.add_argument("--knowledge-read", action="store_true", help="Include bounded PRD knowledge snippets")
```

- [ ] **Step 4: Add compact PRD trace helper in `_commands.py`**

Add this helper near `_make_trace_args`:

```py
def _fetch_compact_prd_context(args: argparse.Namespace, query: str, limit: int, read: bool) -> dict | list:
    try:
        knowledge_svcs = _helpers._discover_knowledge_services(args.server)
    except RuntimeError:
        return []
    if not knowledge_svcs:
        return []
    if len(knowledge_svcs) > 1:
        return {
            "kind": "knowledge-trace",
            "service": None,
            "query": query,
            "matches": [],
            "related": {},
            "coverage": [],
            "citedSources": [],
            "nextReads": [],
            "error": "Multiple knowledge services found. Pass --service to knowledge trace for explicit PRD context.",
            "candidates": knowledge_svcs,
        }

    params: dict[str, str] = {
        "service": knowledge_svcs[0],
        "q": query,
        "limit": str(limit),
        "depth": "1",
    }
    if read:
        params["read"] = "1"
    try:
        return _helpers.fetch_json(args.server, "/api/knowledge/trace", params)
    except RuntimeError:
        return []
```

- [ ] **Step 5: Replace shallow PRD search in `cmd_ask`**

In `cmd_ask`, replace the existing `Step 2b: PRD Knowledge Context` loop that calls `_search_api` with:

```py
    prd_context = _fetch_compact_prd_context(
        args,
        query,
        getattr(args, "limit", 5),
        bool(getattr(args, "knowledge_read", False)),
    )
    result["prdContext"] = prd_context
```

Keep the existing `if depth == "quick": return result` before PRD context so quick mode still skips it.

- [ ] **Step 6: Run ask tests and verify they pass**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py -q
```

Expected: all tests in `test_ask_prd_context.py` pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add understand-anything-plugin/skills/understand-query/ua_query.py \
  understand-anything-plugin/skills/understand-query/_commands.py \
  understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py
git commit -m "feat: use compact prd context in ask"
```

---

## Task 5: Index Markdown Links for Knowledge Search Recall

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts`
- Test: `understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts`

- [ ] **Step 1: Add failing KG index test**

Append this test to `kg-index.test.ts`:

```ts
it("indexes knowledge markdown link labels and targets", () => {
  const graph = {
    version: "1.0.0",
    project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    layers: [],
    tour: [],
    nodes: [
      {
        id: "requirement:1",
        type: "requirement",
        name: "需求",
        summary: "普通摘要",
        tags: [],
        complexity: "simple",
        knowledgeMeta: {
          markdownLinks: [
            { label: "跨房间PK", target: "../summaries/room-pk.md", fragment: null },
          ],
        },
      },
    ],
    edges: [],
  }
  const index = KgIndex.create(graph as never, "amar-prd")
  const result = index.search({ q: "跨房间PK", limit: 5 })
  expect(result.results[0]?.id).toBe("requirement:1")
})
```

- [ ] **Step 2: Run KG index test and verify it fails**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run src/api/handlers/__tests__/kg-index.test.ts
```

Expected: new markdown-link search test fails.

- [ ] **Step 3: Index markdown link labels and targets**

Modify `KgIndex.buildDocs` in `kg-index.ts`. Add helper inside the map block:

```ts
        const markdownLinkText = Array.isArray(meta?.markdownLinks)
          ? meta.markdownLinks.flatMap((link) => {
              if (typeof link !== "object" || link === null) return []
              const rec = link as { label?: unknown; target?: unknown }
              return [
                typeof rec.label === "string" ? rec.label : "",
                typeof rec.target === "string" ? rec.target : "",
              ]
            }).filter(Boolean).join(" ")
          : ""
```

Then append it to `knowledgeText`:

```ts
          markdownLinkText,
```

- [ ] **Step 4: Run KG index test and verify it passes**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run src/api/handlers/__tests__/kg-index.test.ts
```

Expected: all tests in `kg-index.test.ts` pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add understand-anything-plugin/packages/dashboard/src/api/handlers/kg-index.ts \
  understand-anything-plugin/packages/dashboard/src/api/handlers/__tests__/kg-index.test.ts
git commit -m "feat: index knowledge markdown links"
```

---

## Task 6: Documentation and Focused Regression

**Files:**
- Modify: `understand-anything-plugin/skills/understand-query/SKILL.md`
- Optional modify: `understand-anything-plugin/skills/understand-query/docs/reference.md`

- [ ] **Step 1: Document `knowledge trace`**

Update `understand-query/SKILL.md` in the Knowledge Wiki Queries section with examples:

```md
python3 ua_query.py --format md knowledge trace "跨房间 PK" --service amar-prd --type requirement
python3 ua_query.py knowledge trace "PK 测试" --service amar-prd --depth 2
python3 ua_query.py --format md ask --query "跨房间 PK" --depth full --knowledge-read
```

Add semantics:

```md
`knowledge trace` returns compact PRD/wiki context: matched nodes, grouped related edges, cited raw sources, deterministic testcase coverage, and next-read commands. It returns summaries and paths by default, not full `knowledgeMeta.content`. Use `--read` or `ask --knowledge-read` for bounded snippets, and `knowledge read` for full content.
```

- [ ] **Step 2: Run focused Python regressions**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 pytest \
  understand-anything-plugin/skills/understand-query/tests/test_knowledge_command.py \
  understand-anything-plugin/skills/understand-query/tests/test_knowledge_read.py \
  understand-anything-plugin/skills/understand-query/tests/test_knowledge_read_format.py \
  understand-anything-plugin/skills/understand-query/tests/test_ask_prd_context.py \
  -q
```

Expected: all selected Python tests pass.

- [ ] **Step 3: Run focused dashboard API regressions**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run \
  src/api/handlers/__tests__/knowledge-trace.test.ts \
  src/api/handlers/__tests__/kg-index.test.ts \
  src/api/handlers/__tests__/search.test.ts
```

Expected: all selected Vitest tests pass.

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd understand-anything-plugin/packages/dashboard
pnpm typecheck
```

Expected: TypeScript typecheck exits 0.

- [ ] **Step 5: Commit documentation and final verification adjustments**

```bash
git add understand-anything-plugin/skills/understand-query/SKILL.md \
  understand-anything-plugin/skills/understand-query/docs/reference.md
git commit -m "docs: document compact knowledge trace"
```

If `reference.md` is not modified, omit it from `git add`.

---

## Final Verification

- [ ] **Step 1: Run all targeted Python tests**

```bash
PYTHONDONTWRITEBYTECODE=1 pytest understand-anything-plugin/skills/understand-query/tests -q
```

Expected: understand-query tests pass.

- [ ] **Step 2: Run dashboard tests for changed API area**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm vitest run src/api/handlers/__tests__ src/__tests__/e2e-knowledge-query.test.ts
```

Expected: changed API handler tests pass. E2E tests that depend on missing local `/Users/earthchen/ai-work/kb-test` remain skipped by their existing `skipIf` guard.

- [ ] **Step 3: Run typecheck**

```bash
cd understand-anything-plugin/packages/dashboard
pnpm typecheck
```

Expected: TypeScript exits 0.

- [ ] **Step 4: Inspect final diff**

```bash
git status --short
git diff --stat
```

Expected: only planned files are modified.

---

## Notes for Execution

- Keep `/api/knowledge/trace` compact by default. Do not add full `knowledgeMeta.content` to default responses.
- Keep PRD context separate from code source verification in `ask`.
- Prefer `edges.related` as the wikilink-equivalent relationship source because `amar-prd` currently has empty `knowledgeMeta.wikilinks`.
- Do not refactor unrelated dashboard routing or query command structure.
