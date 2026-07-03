# Knowledge Facet Compact Trace Design

**目标：** 在父级启动模式下，把 `amar-prd` 这类 `facet=knowledge` 的 PRD/LLM wiki 服务，从“可手动查询”升级为 `understand-query` 和 `ask` 可控引用的一等上下文层。

**主要目标项目：** `/Users/earthchen/ai-work/kb-amar/amar-prd`

**实现仓库：** `/Users/earthchen/.understand-anything/repo`

**基础工作：** 建立在 `2026-06-25-prd-system-query-design.md` 和当前 `knowledge search/node/neighbors/coverage/read` 能力之上。

---

## 背景

`amar-prd` 已经通过 `/understand-knowledge` 生成标准 knowledge graph，并在父级项目 `/Users/earthchen/ai-work/kb-amar` 的 `system-graph.json` 中作为 `facet=knowledge` 服务出现。

当前实际数据形态：

- `kind`: `knowledge`
- 节点总数：`1221`
- 边总数：`2530`
- 节点类型：`source=789`、`testcase=204`、`requirement=190`、`article=31`、`topic=7`
- 边类型：`related=1232`、`cites=819`、`categorized_under=422`、`tested_by=57`
- `knowledgeMeta.content`: 425 个节点有内容
- `knowledgeMeta.markdownLinks`: 425 个节点有 Markdown 链接
- `knowledgeMeta.backlinks`: 422 个节点有 backlinks
- `knowledgeMeta.wikilinks`: 当前非空为 0

这说明数据层已经有足够的图关系。主要缺口不在生成侧，而在 query/server 没有把这些关系聚合成适合 agent 使用的 compact 查询结果。

---

## 问题

当前 `understand-query` 有 `knowledge search/node/neighbors/coverage/read`，但这些命令仍偏原子化：

1. agent 需要手动执行 `search -> neighbors -> coverage -> read` 多步流程。
2. `ask` 目前只把 PRD 搜索结果作为浅层 `prdContext`，不会沿 `related/cites/tested_by/categorized_under` 扩展。
3. 如果直接把全文 `knowledgeMeta.content` 接入 `ask`，会导致上下文迅速膨胀。
4. PRD/testcase 内容属于产品意图和 QA 覆盖线索，不能和代码 source-verified 事实混为一谈。
5. 当前真正可靠的关系来源是 `edges`，而不是 `knowledgeMeta.wikilinks`。查询层需要明确以图边为主。

需要一个 compact 聚合层：默认返回摘要、路径和关系，不返回全文；只有显式开关才读取受限正文片段。

---

## 目标

- 在父级 `GRAPH_DIR` 模式下，稳定使用 `serviceIndex` 中的 `facet=knowledge` 服务。
- 新增 compact `knowledge trace` 查询能力，一次完成搜索、邻居扩展、引用源收集和测试覆盖收集。
- 让 `ask` 能引用 compact PRD context，但默认不读取全文。
- 明确区分：
  - 代码事实：来自 source verification。
  - PRD context：产品意图、需求背景、版本线索。
  - Test coverage context：QA 覆盖线索，不代表业务规则仍然有效。
- 输出结构适合 agent 消费，避免一坨原始图 JSON。
- 为后续 dashboard/wiki 元数据增强留下接口空间，但本阶段不改 dashboard 主视图。

## 非目标

- 不优先支持单项目 pseudo-service 启动模式。用户主要使用父级启动。
- 不让 `ask` 默认读取完整 PRD/testcase 正文。
- 不让 PRD 内容覆盖代码 source-verified 事实。
- 不直接修改 `amar-prd` wiki 内容。
- 不重构 dashboard knowledge view。
- 不新增 PRD 专用命令作为主入口；`prd-wiki` 只是 `knowledge` 的一个 profile。

---

## 推荐方案

采用三层方案：

```text
server /api/knowledge/trace
  -> CLI knowledge trace
  -> ask compact prdContext
```

先实现独立 `knowledge trace`，等 compact 输出稳定后再接入 `ask`。这样可以控制风险，也便于观察上下文大小。

### 备选方案 A：直接增强 ask

让 `ask` 自动做 `knowledge search -> neighbors -> read`。

不推荐。它会让 `ask` 输出过大，也容易把 PRD 内容和代码事实混在一起。

### 备选方案 B：只保留手动原子命令

继续让 agent 自己调用 `search/neighbors/read/coverage`。

不推荐作为长期方案。虽然实现成本低，但不能降低 agent 调用次数，也不能统一 compact 输出和预算控制。

---

## Server 设计

新增 API：

```text
GET /api/knowledge/trace
```

### 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `q` | 必填 | 搜索 query |
| `service` | 自动解析 | knowledge service 名称，例如 `amar-prd` |
| `type` | 空 | 可选节点类型过滤，例如 `requirement`、`testcase`、`article` |
| `limit` | `5` | 搜索命中数量上限 |
| `depth` | `1` | 邻居扩展深度，允许 `1` 或 `2` |
| `neighborLimit` | `5` | 每类边返回邻居上限 |
| `read` | `0` | 是否包含受限正文片段 |

### Service 解析

服务解析遵循现有父级启动模型：

1. 如果传入 `service`，使用该服务并通过 `serviceIndex` 解析 `basePath`。
2. 如果未传 `service`，从 `/api/services` 或 `system-graph.serviceIndex` 中发现 `facet=knowledge` 且 `hasKg=true` 的服务。
3. 如果只发现一个 knowledge service，自动使用它。
4. 如果发现多个，返回明确错误，要求传 `service`。
5. 如果没有发现，返回错误提示运行系统图生成或检查 `GRAPH_DIR`。

### 数据流

```text
q
  -> unified search scope=kg service=knowledge-service
  -> take top matches
  -> load knowledge-graph.json
  -> expand graph edges by depth
  -> group neighbors by edge type
  -> collect cited sources
  -> collect tested_by coverage
  -> compact nodes
  -> optionally attach snippets when read=1
```

### Compact Node

默认节点结构：

```json
{
  "id": "requirement:summaries/房间-2026-06-v2.25.0-跨房间PK",
  "name": "房间-2026-06-v2.25.0-跨房间PK",
  "type": "requirement",
  "summary": "...",
  "filePath": "wiki/summaries/房间-2026-06-v2.25.0-跨房间PK.md",
  "sourcePath": "raw/prd/房间/2026-06-v2.25.0-跨房间PK.md",
  "sourceType": "prd",
  "business": "房间",
  "version": "v2.25.0",
  "score": 12.3,
  "edgeType": "related"
}
```

默认不包含 `knowledgeMeta.content`。

当 `read=1` 时，只返回 `contentSnippet`，并进行硬截断。

### 响应结构

```json
{
  "kind": "knowledge-trace",
  "service": "amar-prd",
  "query": "跨房间PK",
  "matches": [],
  "related": {
    "related": [],
    "cites": [],
    "tested_by": [],
    "categorized_under": []
  },
  "coverage": [],
  "citedSources": [],
  "nextReads": [],
  "limits": {
    "matchLimit": 5,
    "neighborLimitPerType": 5,
    "depth": 1,
    "contentIncluded": false,
    "summaryMaxChars": 800,
    "snippetMaxChars": 0
  }
}
```

### Edge 语义

- `related`: wiki 概念、业务域、相关 summary/testcase 的主要关系。
- `cites`: summary/testcase 指向 raw PRD 或 raw testcase。
- `tested_by`: requirement 指向 testcase，表示确定性 QA 覆盖匹配。
- `categorized_under`: 节点所属 topic/category。

当前 `amar-prd` 的 `knowledgeMeta.wikilinks` 非空为 0，所以查询语义应以 `edges.related` 为准。

---

## CLI 设计

新增命令：

```bash
python3 ua_query.py knowledge trace "跨房间PK" --service amar-prd
```

可选参数：

```bash
python3 ua_query.py knowledge trace "跨房间PK" --service amar-prd --depth 2
python3 ua_query.py knowledge trace "跨房间PK" --service amar-prd --type requirement
python3 ua_query.py knowledge trace "跨房间PK" --service amar-prd --read
python3 ua_query.py --format md knowledge trace "跨房间PK" --service amar-prd
```

### JSON 输出

JSON 直接返回 server 的 compact 结构。

### Markdown 输出

Markdown 输出固定分区：

```text
## PRD Matches
## Related
## Cited Sources
## Test Coverage
## Next Reads
```

每条记录展示：

- name
- type
- summary
- wiki path
- raw source path
- node id

`Next Reads` 提供可复制的后续命令线索：

```bash
python3 ua_query.py knowledge read --service amar-prd --node "requirement:summaries/..."
```

### 与现有命令关系

- `knowledge search`: 保留，做轻量搜索。
- `knowledge neighbors`: 保留，做精确图遍历。
- `knowledge coverage`: 保留，做单 requirement 的 coverage shortcut。
- `knowledge read`: 保留，做完整内容读取。
- `knowledge trace`: 新增，做 agent 默认入口的 compact 聚合查询。

---

## ask 接入设计

`ask --depth standard/full` 默认接入 compact PRD context，但不读取全文。

新增结果字段：

```json
{
  "prdContext": {
    "kind": "knowledge-trace",
    "service": "amar-prd",
    "matches": [],
    "relatedConcepts": [],
    "citedSources": [],
    "testCoverage": [],
    "nextReads": [],
    "contentIncluded": false
  }
}
```

### 默认行为

`ask --depth standard`：

- 执行 compact `knowledge trace`
- 返回 matches、related concepts、cited sources、coverage names/paths
- 不读正文片段

`ask --depth full`：

- 保持现有代码 trace/source verify 行为
- 同时返回 compact PRD context
- 不默认读完整 PRD/testcase 正文

### 显式深读

新增参数：

```bash
python3 ua_query.py ask --query "跨房间PK" --depth full --knowledge-read
```

语义：

- 只读取少量强相关节点片段。
- 片段有严格字符上限。
- 完整深读仍使用 `knowledge read`。

### 权威边界

`ask` 的回答层必须保留以下边界：

- 代码事实只来自 source verification。
- PRD context 是产品意图，不证明代码已实现。
- Test coverage context 是 QA 覆盖线索，不证明业务规则仍然有效。
- 如果 PRD 与代码事实冲突，应明确指出冲突来源，而不是合并成一个结论。

---

## 上下文预算

默认预算：

| 项 | 上限 |
| --- | --- |
| matches | 5 |
| 每类 edge neighbors | 5 |
| summary | 800 chars |
| contentSnippet 默认 | 0 chars |
| `--knowledge-read` snippet | 1000 chars/node |
| compact PRD context 总量 | 4k-8k chars |

超限时必须返回 `truncated=true` 或在 `limits` 中标记裁剪信息。

---

## 搜索与索引增强

当前 `KgIndex` 已索引：

- `knowledgeMeta.content`
- `business`
- `version`
- `sourcePath`
- `sourceType`
- `profile`

后续应补充：

- `knowledgeMeta.markdownLinks[].label`
- `knowledgeMeta.markdownLinks[].target`

但 compact trace 的关系来源仍以 `edges` 为准。索引增强只用于提高搜索召回，不作为图结构真相来源。

---

## 错误处理

### 无 knowledge service

返回明确错误：

```text
No knowledge service found. Check parent GRAPH_DIR and system graph generation.
```

### 多 knowledge service

返回候选：

```text
Multiple knowledge services found. Pass --service. Candidates: amar-prd, policy-wiki
```

### node/edge 缺失

compact trace 不应失败整个请求。某类边为空时返回空数组，并在 `notes` 中说明。

### read 失败

`read=1` 的片段读取失败时，保留 compact 节点并附加 `readError`，不影响其他分区。

---

## 测试计划

### Server tests

- 父级 `GRAPH_DIR` + `serviceIndex.amar-prd` 能解析 knowledge service。
- `/api/knowledge/trace` 能搜索到 requirement。
- `related/cites/tested_by/categorized_under` 分组正确。
- 默认响应不包含完整 `knowledgeMeta.content`。
- `read=1` 只返回受限 `contentSnippet`。
- 多 knowledge service 时返回候选错误。
- 无 knowledge service 时返回清晰错误。

### CLI tests

- `knowledge trace` 参数解析。
- JSON 输出透传 compact 结构。
- Markdown 输出包含固定分区。
- `--read` 正确传递为 server `read=1`。
- `knowledge trace` 不破坏现有 `search/node/neighbors/coverage/read`。

### ask tests

- `ask --depth standard` 包含 compact `prdContext`。
- `ask --depth full` 保持现有 source verify 输出，并附带 compact `prdContext`。
- 默认不包含完整 PRD content。
- `--knowledge-read` 返回受限片段。
- PRD context 与 sourceReads 字段分离。

---

## 实施顺序

1. 新增 server `/api/knowledge/trace` handler。
2. 新增 CLI `knowledge trace` 子命令。
3. 新增 Markdown formatter。
4. 补 server 和 CLI 测试。
5. 将 `ask` 的 PRD context 改为调用 compact trace。
6. 新增 `--knowledge-read`。
7. 补 `ask` 测试。
8. 增强 `markdownLinks` 搜索索引。

---

## 验收标准

以下命令应返回 compact 结果，且不包含完整 PRD 正文：

```bash
python3 ua_query.py --format md knowledge trace "跨房间PK" --service amar-prd
```

以下命令应返回 compact PRD context，同时保留代码 source verification 边界：

```bash
python3 ua_query.py --format md ask --query "跨房间PK" --depth full
```

以下命令才允许返回受限正文片段：

```bash
python3 ua_query.py --format md ask --query "跨房间PK" --depth full --knowledge-read
```

完整正文仍通过现有命令读取：

```bash
python3 ua_query.py --format md knowledge read --service amar-prd --node "requirement:summaries/房间-2026-06-v2.25.0-跨房间PK"
```

---

## Open Questions

1. `ask --depth standard` 是否默认启用 compact PRD context，还是只在发现 knowledge service 且 query 命中时启用？
2. `knowledge trace --read` 的片段选择策略应只读 top matches，还是也读 `tested_by` testcase？
3. 多 knowledge service 场景下，是否允许 `ask` 同时搜索多个 knowledge services，还是必须显式指定一个？

本提案建议第一版采用保守策略：

- `ask` 默认搜索唯一 knowledge service；多个时不自动合并。
- `--read` 第一版只读 top matches，不读所有邻居。
- testcase 正文深读留给显式 `knowledge read`。
