# Understand-Anything 生态全量优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升全链路数据质量（Domain→Wiki→Business）并为 Dashboard 添加搜索功能

**Architecture:** 修改 domain-flow-extractor agent prompt 以深化 flow 步骤；修改 assemble_landscape.py 去重 business 域；新增 server-side BM25 搜索 API 和前端搜索组件；强化 validate-graph.mjs 门禁

**Tech Stack:** TypeScript (API server), Python (CLI/scripts), Zod (schema), Node.js (validation)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `agents/domain-flow-extractor.md` | Modify | Flow/Step 生成 prompt (P0+P2) |
| `agents/file-analyzer.md` | Modify | KG node summary prompt (P5) |
| `skills/understand/validate-graph.mjs` | Modify | 添加 domain-graph 门禁校验 |
| `skills/understand-business/assemble_landscape.py` | Modify | 域去重 (P1) |
| `packages/dashboard/src/api/handlers/search.ts` | Create | 统一 BM25 搜索 API (P3) |
| `packages/dashboard/src/api/index.ts` | Modify | 注册 /api/search 路由 (P3) |
| `packages/dashboard/wiki-api.ts` | Modify | 移除 Fuse.js, 改用共享 BM25 (P3) |
| `packages/core/src/search.ts` | Modify | 前端改为调 API (P3) |
| `skills/understand-query/ua_query.py` | Modify | CLI 初始搜索改为调 /api/search (P3) |

---

## Task 1: P0 — domain-flow-extractor Prompt 深化

**Files:**
- Modify: `agents/domain-flow-extractor.md`

- [ ] **Step 1: 阅读当前 prompt 全文，确认修改点**

读取 `agents/domain-flow-extractor.md`，记录当前 Rules 和 Output Schema 的结构。

- [ ] **Step 2: 在 Task section 后新增 Step Extraction Rules**

在 `## Task` 和 `## Three-Level Hierarchy` 之间新增：

```markdown
## Step Extraction Rules (MANDATORY)

These rules override any impulse to generate generic steps. Violations make the output USELESS.

1. **TRACE CALLS EDGES**: For each flow's entryPoint, find all edges where `source` matches 
   that node's ID and `type == "calls"`. Each called function is a candidate step.
2. **MINIMUM 4 STEPS**: Every flow MUST have at least 4 distinct steps derived from actual 
   method calls. If the entry point has fewer than 4 outbound calls, follow calls edges 
   recursively (depth 2) to find sub-calls.
3. **BANNED STEP NAMES** (generating these means you failed):
   - "Validate Input" / "校验输入" (generic)
   - "Execute Business Logic" / "执行业务逻辑" (generic)
   - "Build Response" / "构建响应" (generic)
   Instead use the actual method's business purpose: "检查亲密度阈值", "创建绑定记录", "发布关系变更事件"
4. **ACCURATE lineRange**: Each step's `lineRange` MUST come from the target node's 
   `lineRange` field in the KG subset. Using `[1, 100]` or `[0, 0]` is FORBIDDEN.
5. **DISTINCT filePath**: Steps should reference different files when the call chain crosses 
   class boundaries. If all steps point to the same file, you are not tracing calls edges.
6. **sourceNode field**: Add `"sourceNode": "<KG node ID>"` to each step, linking it to 
   the actual KG node this step is derived from.

### Worked Example

Given edges:
```json
{"source": "function:...WebServiceImpl.java:bindClosedFriend", "target": "function:...ServiceImpl.java:checkIntimacy", "type": "calls"}
{"source": "function:...WebServiceImpl.java:bindClosedFriend", "target": "function:...ServiceImpl.java:createRecord", "type": "calls"}
{"source": "function:...ServiceImpl.java:createRecord", "target": "function:...KafkaProducer.java:publish", "type": "calls"}
```

Produce steps:
```json
[
  {"id": "step:bind:check-intimacy", "name": "校验亲密度阈值", "sourceNode": "function:...ServiceImpl.java:checkIntimacy", "filePath": "...ServiceImpl.java", "lineRange": [45, 67]},
  {"id": "step:bind:create-record", "name": "创建挚友绑定记录", "sourceNode": "function:...ServiceImpl.java:createRecord", "filePath": "...ServiceImpl.java", "lineRange": [110, 145]},
  {"id": "step:bind:publish-event", "name": "发布关系变更事件", "sourceNode": "function:...KafkaProducer.java:publish", "filePath": "...KafkaProducer.java", "lineRange": [23, 35]}
]
```
```

- [ ] **Step 3: 修改 Output Schema 的 step 定义，新增 sourceNode 字段**

在 Output Schema 的 step 对象中新增：

```json
{
  "id": "step:<flow-name>:<specific-action-kebab>",
  "name": "<中文业务动作描述>",
  "summary": "<中文，描述这一步的业务目的>",
  "sourceNode": "<KG node ID this step maps to>",
  "tags": ["<relevant-tags>"],
  "complexity": "simple|moderate|complex",
  "filePath": "<from KG node's filePath field>",
  "lineRange": [123, 156]
}
```

- [ ] **Step 4: 新增 Language Requirements section (P2 合并)**

在 Rules 之前新增：

```markdown
## Language Requirements

- `flow.name`: English Title Case (e.g., "Create Family", "Bind Closed Friend")
- `flow.summary`: Chinese, one sentence describing business purpose (MUST contain ≥2 CJK characters)
- `step.name`: Chinese, specific business action (e.g., "校验亲密度阈值")
- `step.summary`: Chinese, describing what this step accomplishes
```

- [ ] **Step 5: 验证 prompt 完整性**

重新读取修改后的 `agents/domain-flow-extractor.md`，检查无冲突。

---

## Task 2: P0 — 门禁校验逻辑

**Files:**
- Modify: `skills/understand/validate-graph.mjs`

- [ ] **Step 1: 阅读当前 validate-graph.mjs 完整逻辑**

确认 validation 流程和 issue reporting 机制。

- [ ] **Step 2: 在 node validation 后新增 domain-graph 专项校验**

在 `validate-graph.mjs` 的校验逻辑末尾（tour validation 之后），新增：

```javascript
// Domain-graph quality gates (P0/P2)
const flowNodes = fixed.nodes.filter(n => n.type === "flow");
const stepNodes = fixed.nodes.filter(n => n.type === "step");
const BANNED_STEP_NAMES = new Set([
  "Validate Input", "Execute Business Logic", "Build Response",
  "校验输入", "执行业务逻辑", "构建响应",
]);
const CJK_RE = /[\u4e00-\u9fff]/;

for (const flow of flowNodes) {
  // P2: Check Chinese summary
  if (flow.summary && !CJK_RE.test(flow.summary)) {
    issues.push({
      level: "auto-corrected",
      category: "domain-quality",
      message: `Flow "${flow.name}" summary lacks Chinese characters`,
      path: `nodes[${flow.id}].summary`,
    });
  }

  // P0: Check step count
  const flowSteps = fixed.edges
    .filter(e => e.source === flow.id && e.type === "flow_step")
    .map(e => stepNodes.find(s => s.id === e.target))
    .filter(Boolean);

  if (flowSteps.length > 0 && flowSteps.length < 4) {
    issues.push({
      level: "dropped",
      category: "domain-quality",
      message: `Flow "${flow.name}" has only ${flowSteps.length} steps (minimum 4 required)`,
      path: `nodes[${flow.id}]`,
    });
  }

  for (const step of flowSteps) {
    // P0: Check banned names
    if (BANNED_STEP_NAMES.has(step.name)) {
      issues.push({
        level: "dropped",
        category: "domain-quality",
        message: `Step "${step.name}" uses banned template name`,
        path: `nodes[${step.id}].name`,
      });
    }
    // P0: Check default lineRange
    if (step.lineRange && step.lineRange[0] === 1 && step.lineRange[1] === 100) {
      issues.push({
        level: "auto-corrected",
        category: "domain-quality",
        message: `Step "${step.name}" has default lineRange [1,100]`,
        path: `nodes[${step.id}].lineRange`,
      });
    }
  }
}
```

- [ ] **Step 3: 测试门禁逻辑**

用现有的 `domain-graph.json`（已知有模板步骤）运行：
```bash
node skills/understand/validate-graph.mjs \
  /Users/earthchen/ai-work/kb-test/backend/ultron-relation/.understand-anything/domain-graph.json \
  /tmp/domain-validation-test.json
```

Expected: 报告中包含 "banned template name" 和 "only 3 steps" warnings。

---

## Task 3: P1 — Business 域去重

**Files:**
- Modify: `skills/understand-business/assemble_landscape.py`

- [ ] **Step 1: 阅读 assemble_landscape.py 中域输出逻辑**

找到写入 `domains.json` 的位置。

- [ ] **Step 2: 在域列表输出前添加去重逻辑**

```python
def _deduplicate_domains(domains: list[dict]) -> list[dict]:
    """Merge domains with identical names, combining their facets and interactions."""
    seen: dict[str, dict] = {}
    for domain in domains:
        key = domain.get("name", "").strip().lower()
        if not key:
            continue
        if key in seen:
            existing = seen[key]
            existing.setdefault("facets", []).extend(domain.get("facets", []))
            existing.setdefault("interactions", []).extend(domain.get("interactions", []))
            existing.setdefault("businessRules", []).extend(domain.get("businessRules", []))
            # Deduplicate sub-lists
            existing["facets"] = list({json.dumps(f, sort_keys=True): f for f in existing["facets"]}.values())
            existing["interactions"] = list({json.dumps(i, sort_keys=True): i for i in existing["interactions"]}.values())
            existing["businessRules"] = list({json.dumps(r, sort_keys=True): r for r in existing["businessRules"]}.values())
        else:
            seen[key] = domain
    return list(seen.values())
```

在写入 `domains.json` 之前调用：
```python
domains = _deduplicate_domains(domains)
```

- [ ] **Step 3: 验证去重效果**

重跑 `/understand-business` 或直接用当前数据运行 `assemble_landscape.py`，检查输出的 domains 数量从 11 降到 ~8。

---

## Task 4: P3 — 统一 Server-side BM25 搜索

**Files:**
- Create: `packages/dashboard/src/api/handlers/search.ts` (统一搜索 API)
- Modify: `packages/dashboard/src/api/index.ts` (注册路由)
- Modify: `packages/dashboard/wiki-api.ts` (移除 Fuse.js, 改用共享 BM25)
- Modify: `packages/core/src/search.ts` (前端改为调 API)
- Modify: `skills/understand-query/ua_query.py` (CLI 初始搜索改为调 /api/search)
- Remove dependency: `fuse.js`

> 架构目标: **一处 BM25，三端受益** (Server + Dashboard + CLI)
> - Server 提供 `/api/search` 统一跨层搜索
> - Dashboard 搜索改调 API（不再前端内存搜索）
> - CLI 初始搜索改调 API（不需下载全量节点）

### Step 4.1: Server-side — 统一搜索 API（含内存缓存）

- [ ] **创建 `packages/dashboard/src/api/handlers/search.ts`（含缓存层）**

搜索引擎使用 **内存缓存 + mtime 失效** 策略：

```typescript
interface SearchIndexState {
  items: Array<{ id: string; text: string; meta: Omit<UnifiedSearchResult, "id" | "score"> }>;
  tokenizedDocs: string[][];
  avgDl: number;
  df: Map<string, number>;
  mtimes: Record<string, number>; // 各数据文件的 mtime
}

let cachedIndex: SearchIndexState | null = null;

function getOrBuildIndex(projectRoot: string, service?: string): SearchIndexState {
  // 1. 获取各层数据文件 mtime
  const kgPath = resolveGraphPath(projectRoot, service, "kg");
  const wikiPath = resolveWikiIndexPath(projectRoot, service);
  const domainPath = resolveGraphPath(projectRoot, service, "domain");
  const currentMtimes = {
    kg: getFileMtime(kgPath),
    wiki: getFileMtime(wikiPath),
    domain: getFileMtime(domainPath),
  };

  // 2. 如果 mtime 都没变，返回缓存
  if (cachedIndex && JSON.stringify(cachedIndex.mtimes) === JSON.stringify(currentMtimes)) {
    return cachedIndex;
  }

  // 3. 重建索引
  const items = [];
  // ... 从各层加载 nodes/entries 到统一 items 格式
  // ... 预计算 tokenizedDocs, avgDl, df (BM25 准备数据)

  cachedIndex = { items, tokenizedDocs, avgDl, df, mtimes: currentMtimes };
  return cachedIndex;
}
```

这确保：
- 首次请求：加载 + 建索引 (~100ms)
- 后续请求：直接用缓存 (~5ms)
- 文件更新（如重跑 /understand）：自动重建索引

- [ ] **创建 `packages/dashboard/src/api/handlers/search.ts`**

```typescript
import type { GraphNode } from "@understand-anything/core/types";

export interface UnifiedSearchResult {
  id: string;
  name: string;
  type: string;
  layer: "kg" | "wiki" | "domain" | "business";
  summary: string;
  score: number;
  service?: string;
  filePath?: string;
  lineRange?: [number, number];
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:]+/);
  for (const part of parts) {
    if (part.length > 1) tokens.push(part.toLowerCase());
  }
  const cjk = text.match(/[\u4e00-\u9fff]+/g);
  if (cjk) {
    for (const segment of cjk) {
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2));
      }
      if (segment.length === 1) tokens.push(segment);
    }
  }
  return tokens;
}

export function bm25Search(
  items: Array<{ id: string; text: string; meta: Omit<UnifiedSearchResult, "id" | "score"> }>,
  query: string,
  limit = 50,
): UnifiedSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const N = items.length;
  const docs = items.map(item => tokenize(item.text));
  const avgDl = docs.reduce((s, d) => s + d.length, 0) / Math.max(N, 1);
  const k1 = 1.5, b = 0.75;

  const df: Record<string, number> = {};
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }

  const scored: UnifiedSearchResult[] = [];
  for (let i = 0; i < N; i++) {
    const dl = docs[i].length;
    const tf: Record<string, number> = {};
    for (const t of docs[i]) tf[t] = (tf[t] || 0) + 1;

    let score = 0;
    for (const qt of queryTokens) {
      if (!tf[qt]) continue;
      const idf = Math.log((N - (df[qt] || 0) + 0.5) / ((df[qt] || 0) + 0.5) + 1);
      score += idf * (tf[qt] * (k1 + 1)) / (tf[qt] + k1 * (1 - b + b * dl / avgDl));
    }
    const nameLower = items[i].meta.name.toLowerCase();
    const qLower = query.toLowerCase();
    if (nameLower === qLower) score += 15;
    else if (nameLower.includes(qLower)) score += 5;

    if (score > 0) {
      scored.push({ id: items[i].id, score, ...items[i].meta });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

- [ ] **实现 handleSearch handler**

搜索范围覆盖 KG nodes + Wiki entries + Domain flows + Business domains：
```typescript
// GET /api/search?q=keyword&scope=all|kg|wiki|domain|business&limit=20&service=xxx
export async function handleSearch(req, ctx): Promise<ApiResponse> {
  // 1. 从各层加载数据到统一 items[] 格式
  // 2. 调 bm25Search(items, query, limit)
  // 3. 返回跨层排序结果
}
```

- [ ] **注册路由并测试**

```bash
curl "http://localhost:3000/api/search?q=亲密度&scope=all&project=kb-test"
```

Expected: 返回 KG+Wiki+Domain 中含"亲密度"的结果，BM25 排序。

### Step 4.2: Dashboard — 前端改为调 API

- [ ] **修改 `store.ts` 的 `setSearchQuery`**

将浏览器内 SearchEngine 搜索替换为调 `/api/search`：
```typescript
setSearchQuery: (query) => {
  if (!query.trim()) {
    set({ searchQuery: query, searchResults: [], wikiSearchResults: [] });
    return;
  }
  // 调 server-side unified search 代替本地 Fuse
  fetch(`/api/search?q=${encodeURIComponent(query)}&scope=all&limit=20`)
    .then(r => r.json())
    .then(data => set({ searchQuery: query, searchResults: data.results }));
}
```

- [ ] **移除前端 SearchEngine 和 fuse.js 依赖**

```bash
cd packages/core && pnpm remove fuse.js
```

### Step 4.3: CLI — 初始搜索改为调 /api/search

- [ ] **修改 `ua_query.py` 中 `cmd_trace` 的初始搜索**

将 "下载全量节点 → 本地 BM25" 改为 "调 `/api/search?q=keyword&scope=kg`"：
```python
# Before: 下载全量 nodes, 本地 BM25
# After: 调统一搜索 API
url = build_url(f"/api/search", {"q": keyword, "scope": "kg", "service": args.service, "limit": "50"})
search_results = fetch_json(url, args)
matched = search_results.get("results", [])
```

- [ ] **修改 `cmd_kg --search` 使用 server-side search**

同样改为调 `/api/search?scope=kg`。

- [ ] **验证 CLI 搜索效率**

```bash
python3 ua_query.py trace --service ultron-relation --query "亲密度"
# 对比修改前后的 API 调用次数和响应时间
```

### Step 4.4: 移除 wiki-api.ts 中的 Fuse.js

- [ ] **将 Wiki 搜索改为调共享的 bm25Search**

修改 `wiki-api.ts` 的 `ensureSearchIndex` 和 `search` 方法，使用同一个 BM25 实现。

- [ ] **全面验证**

Dashboard 搜索、CLI trace、CLI kg --search 都应正常工作。

---

## Task 5: P5 — KG Node Summary 质量强化

**Files:**
- Modify: `agents/file-analyzer.md`

- [ ] **Step 1: 阅读 file-analyzer.md 当前 prompt**

确认 summary 相关的现有指导。

- [ ] **Step 2: 新增 Summary Quality Rules**

在 `agents/file-analyzer.md` 中添加：

```markdown
## Summary Quality Rules (MANDATORY)

Every node summary MUST answer "What does this do in business terms?" in one Chinese sentence.

### BANNED generic summaries (generating these means failure):
- "方法 X，实现具体业务步骤" ❌
- "类 Y，承载相关业务类型与行为" ❌
- "数据传输对象 X.java，封装 API 请求/响应字段" ❌ (too generic for DTOs with specific fields)

### REQUIRED specific summaries:
- "检查用户亲密度是否达到挚友绑定阈值(默认500)" ✓
- "管理挚友空间装扮素材的佩戴状态与过期回收" ✓
- "封装家族创建请求参数(家族名、类型、封面URL)" ✓

### Rules:
1. For methods: describe WHAT business decision or action this method performs
2. For classes: describe the DOMAIN CONCEPT this class represents
3. For DTOs: list the key business fields (not just "封装字段")
4. If the source has Javadoc/docstring, use its first meaningful sentence
5. Summary must be ≥ 10 Chinese characters
```

- [ ] **Step 3: 验证方式记录**

验证 P5 需要重跑 `/understand`。记录验证命令：
```bash
# After re-running /understand on target project:
cat .understand-anything/knowledge-graph.json | python3 -c "
import json, sys, re
kg = json.load(sys.stdin)
banned = re.compile(r'(实现具体业务步骤|承载相关业务类型与行为|封装.*字段)')
bad = [n for n in kg['nodes'] if banned.search(n.get('summary', ''))]
print(f'Banned summaries: {len(bad)} / {len(kg[\"nodes\"])}')
for n in bad[:5]: print(f'  - {n[\"name\"]}: {n[\"summary\"][:50]}')
"
```

Expected: 0 banned summaries after re-run.

---

## Task 6: P0 验证 — 重跑 Domain 并检查

**Files:**
- None (execution validation)

- [ ] **Step 1: 重跑 /understand-domain 对目标项目**

```bash
cd /Users/earthchen/ai-work/kb-test/backend/ultron-relation
# Run /understand-domain --full
```

- [ ] **Step 2: 检查输出 domain-graph.json 步骤质量**

```bash
cat .understand-anything/domain-graph.json | python3 -c "
import json, sys
dg = json.load(sys.stdin)
steps = [n for n in dg['nodes'] if n['type'] == 'step']
flows = [n for n in dg['nodes'] if n['type'] == 'flow']
print(f'Flows: {len(flows)}, Steps: {len(steps)}, Avg: {len(steps)/max(len(flows),1):.1f} steps/flow')
banned = {'Validate Input', 'Execute Business Logic', 'Build Response', '校验输入', '执行业务逻辑', '构建响应'}
bad = [s for s in steps if s['name'] in banned]
default_lr = [s for s in steps if s.get('lineRange') == [1, 100]]
print(f'Banned names: {len(bad)}, Default lineRange: {len(default_lr)}')
"
```

Expected:
- Avg steps/flow ≥ 5
- Banned names = 0
- Default lineRange = 0

- [ ] **Step 3: 运行门禁校验确认 PASS**

```bash
node skills/understand/validate-graph.mjs \
  /Users/earthchen/ai-work/kb-test/backend/ultron-relation/.understand-anything/domain-graph.json \
  /tmp/validation-report.json
cat /tmp/validation-report.json | python3 -c "import json,sys; r=json.load(sys.stdin); print(f'Passed: {r[\"passed\"]}, Issues: {len(r[\"issues\"])}')"
```

---

## Execution Notes

- Task 1-2 (P0+P2+门禁) 可合并为一个 subagent
- Task 3 (P1) 独立，可并行
- Task 4 (P3) 独立，可并行（替换 core/search.ts 中 Fuse.js 为 BM25）
- Task 5 (P5) 独立
- Task 6 (验证) 必须在 Task 1-2 完成后执行
