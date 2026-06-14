---
name: understand-query
description: Query the Understand-Anything knowledge base via CLI. Seven-layer drill-down from services to source code, backed by the shared API server.
argument-hint: ["<subcommand> [--server URL] [--format json|md] [--verbose] [subcommand-flags...]"]
---

# /understand-query

Query codebase knowledge through a lightweight CLI (`ua_query.py`) backed by the shared Understand-Anything API server. Use eight progressive layers — from service discovery and business landscape down to source-verified code — to answer questions without loading entire graphs into context.

## Source Verification Rule (MANDATORY)

**For any question about business logic, flows, or implementation details, the agent MUST verify answers against actual source code.** Wiki and domain graph data may be stale — source code is the ground truth.

### Verification Protocol

1. **Always use `--source`** (or `--depth full` with `ask`) for questions about:
   - Business rules and their enforcement
   - Flow steps and their implementation
   - Integration points (RPC, Kafka, Redis)
   - Error handling and edge cases
2. **Cross-check wiki claims**: If wiki says "Method X does Y", read the actual source to confirm.
3. **Flag discrepancies**: If source code contradicts wiki/domain data, report the discrepancy explicitly.
4. **Never trust wiki alone** for: parameter validation logic, error codes, conditional branches, or concurrency controls.

### CRITICAL: Default Depth Must Be `full`

**When answering user-facing questions, agents MUST use `--depth full` (not `standard` or `quick`).** The `standard` depth skips source verification and may return unverified wiki/domain claims. Only use `standard`/`quick` for internal exploratory searches where the output is not directly presented to the user as factual.

**Decision table:**
| Scenario | Required Depth |
|----------|---------------|
| Answering a user question | `full` (mandatory) |
| Agent internal exploration | `standard` (acceptable) |
| Quick service/domain check | `quick` (acceptable) |

---

## Execution Mode: Sub-Agent (Default)

**This skill MUST be delegated to a sub-agent by default.** All understand-query operations are read-only exploration and lookup tasks — the caller only cares about the final result, not the intermediate process.

### Dispatch Instructions (Cross-Platform)

| Platform | Mechanism | Type |
|----------|-----------|------|
| **Cursor** | `Task` tool | `subagent_type: "generalPurpose"` (needs shell for CLI) |
| **Claude Code** | `dispatch_agent` / `Task` tool | General-purpose agent with shell access |
| **Codex** | Platform-native sub-agent / task dispatch | Agent with shell access |

### When NOT to Use Sub-Agent

Skip sub-agent dispatch only when:
- The parent agent is **already inside a sub-agent** (avoid nesting).
- The query is a **single trivial command** (e.g., `services --list`) whose result is needed inline.

---

## Golden Rule for Agents (Read FIRST)

For ANY "How does X work?" or "Where is X implemented?" question:

**Option 1 — Single command (recommended):**
```bash
python ua_query.py ask --query "中文关键词,EnglishName,Synonym" --depth full
```

**Option 2 — Manual trace with verification:**
```bash
python ua_query.py trace --service SERVICE --query "中文关键词,EnglishName,Synonym" --source --business --wiki --domain-flows
```

Both approaches search KG, retrieve neighbors, read source code, include business/wiki/domain context, and verify against source. **Option 1 also auto-discovers the service.**

**Multi-service questions?** Run trace once per relevant service:

```bash
python ua_query.py trace --service svc-a --query "keyword" --source --business && \
python ua_query.py trace --service svc-b --query "keyword" --source
```

---

## Agent Efficiency Rules

1. **Prefer `ask` for business questions**: One command replaces 5+ individual calls.
2. **Batch CLI calls**: Combine multiple CLI commands into ONE Shell call using `&&`.
3. **Expand keywords before trace**: Always provide 2-4 comma-separated variants (original + English + synonym).
4. **Use `--format md`** when the output will be read by an agent (not parsed as JSON).
5. **Use `--source`** for any answer that will be presented as factual to the user.
6. **RRF is default for trace** — `trace` uses `fusion=rrf` automatically.
7. **Use server-side filters**: Pass `--type`/`--tag` to `kg --search` and `trace` instead of post-filtering results client-side. Reduces payload and improves accuracy.
8. **Use `--q` for structure fuzzy search**: `structure --q "getUser"` is faster and more accurate than iterating `--annotation`/`--param-type` separately.
9. **Paginate large results**: Use `--offset N` with `--limit` for large result sets instead of fetching everything.

---

## Subcommands

| Subcommand | Purpose | Detail Doc |
|------------|---------|------------|
| `ask` | **Start here for business questions.** Auto-discover → trace → wiki → domain → source-verify | This file |
| `trace` | Search→neighbors→source in one call (with optional wiki/domain/verify/grouped) | [kg-trace.md](docs/kg-trace.md#trace--aggregated-searchneighborssource-recommended-for-agents) |
| `kg` | Source-level KG: classes, calls, RPC, file annotations, file summary | [kg-trace.md](docs/kg-trace.md#kg--knowledge-graph-queries) |
| `structure` | Code structure: signatures, annotations, types, cross-file symbol search + source | [structure-commands.md](docs/structure-commands.md) |
| `impact` | Server-side BFS impact analysis from a symbol (depth 1–10) | [graph-analysis.md](docs/graph-analysis.md#impact--transitive-impact-analysis) |
| `callers` | Who calls this symbol? (inbound `calls` edges) | [graph-analysis.md](docs/graph-analysis.md#callers--callees--call-graph-navigation) |
| `callees` | What does this symbol call? (outbound `calls` edges) | [graph-analysis.md](docs/graph-analysis.md#callers--callees--call-graph-navigation) |
| `hotspots` | Server-side fan-in/fan-out scoring for critical nodes | [graph-analysis.md](docs/graph-analysis.md#hotspots--code-hotspot-scoring) |
| `affected` | Find test files affected by changes to given source files | [graph-analysis.md](docs/graph-analysis.md#affected--affected-test-discovery) |
| `business` | Business landscape: domains, interactions, rules | [business-domain.md](docs/business-domain.md) |
| `wiki` | Wiki pages, architecture, endpoints, flows | [business-domain.md](docs/business-domain.md) |
| `domain` | Domain graph: flows, steps, neighbors | [business-domain.md](docs/business-domain.md) |
| `services` | Service discovery and data layer readiness | [reference.md](docs/reference.md) |
| `meta` | Cross-layer freshness check | [reference.md](docs/reference.md) |

**Global flags** (place before subcommand name):

| Flag | Default | Description |
|------|---------|-------------|
| `--server URL` | `$UNDERSTAND_SERVER` or auto-detect (localhost → fallback IP) | API server base URL |
| `--format json\|md` | `json` | Output format |
| `--verbose` | off | Include extra detail |

---

## Prerequisites

1. **Python 3.10+** required (stdlib only, no external packages).
2. **API Server must be running** (auto-detected at localhost:3001 or configured IP).
3. **Data must be generated** by running relevant skills:

| Skill | Generates |
|-------|-----------|
| `/understand` | Knowledge graph (`kg` layer) + structural analysis |
| `/understand-domain` | Domain graph (`domain` layer) |
| `/understand-wiki` | Wiki + system graph (`wiki`, `services` layer) |
| `/understand-business` | Business landscape (`business` layer) |

---

## `ask` — Business Question Answering (NEW)

**One command to answer business questions end-to-end.** Replaces the manual 5-step workflow.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query Q` | string | required | Natural language question (Chinese or English, comma-separated keywords) |
| `--depth LEVEL` | string | `standard` | `quick`=business only, `standard`=+trace+wiki, `full`=+domain+source-verify |
| `--service S` | string | auto | Override auto-discovery |
| `--limit N` | int | 5 | Max matched nodes |
| `--fusion MODE` | string | `rrf` | Search fusion strategy |

**Depth levels:**

| Depth | Steps | Use When |
|-------|-------|----------|
| `quick` | Business search only | Quick domain overview |
| `standard` | + KG trace + wiki domain | Understanding a feature |
| `full` | + domain flows + source verification + **cross-service RPC follow** | **Answering factual questions (RECOMMENDED)** |

**Cross-service RPC follow (depth=full):** When the traced service has outbound `consumes_rpc` edges, `ask` automatically identifies the provider service and runs a follow-up trace there. The output includes a `crossServiceTrace` section with the target service's implementation details. This solves the "found the reporter, not the implementer" problem.

**Universal Cross-Service Symbol Resolution:** ALL commands (`trace`, `callers`, `callees`, `impact`) now automatically search other indexed services when a symbol is not found in the specified service. When cross-service resolution occurs, the output includes a `crossServiceOrigin` field indicating the original service, the actual service where the symbol was found, and a user-friendly hint. The commands transparently query the correct service — no manual `--service` switching needed.

**Examples:**

```bash
# Full business question (recommended)
python ua_query.py --format md ask --query "火箭,rocket,RocketReward" --depth full

# Quick domain check
python ua_query.py ask --query "亲密度,intimacy" --depth quick

# Override service
python ua_query.py ask --query "家族,Family" --service ultron-relation --depth standard
```

---

## Eight-Layer Drill-Down Model

| Layer | Subcommand | Answers |
|-------|-----------|---------|
| 0. Service Discovery | `services --list` | What services exist? Which data layers are ready? |
| 1. Business Overview | `business --list` | What business domains exist? |
| 2. Domain Interactions | `business --domain X --type interactions` | How do users interact with domain X? |
| 3. Wiki Detail | `wiki --service S --domain D` | Technical implementation of domain D? |
| 4. Domain Graph | `domain --service S --flow F` | Business flow structure and steps? |
| 5. Source-Level KG | `kg --service S --neighbors N` | Class relationships and code? |
| 6. Source Code | `kg --service S --file PATH` | Read actual implementation source code |
| 7. Code Structure | `structure --service S --annotation X` | Function signatures, annotations, param/return types |
| **NEW** 8. Source Verify | `trace --source` / `ask --depth full` | Cross-check wiki/domain against live source code |

---

## Agent Decision Tree

### Query Paths by Goal

| Path | When | Start With |
|------|------|------------|
| Business Understanding | "What is X?" "Complete flow of X?" | `ask --depth full` |
| Feature Location | "Where is X implemented?" | `trace --auto-discover --query "X" --source` |
| Symbol + Source | "Show me the code for createOrder" | `structure --symbol createOrder --source` |
| Bug Investigation | "API returns wrong data" | `wiki --type endpoint` → `kg --neighbors` → `trace --source` |
| Impact Analysis | "What will changing X break?" | `impact --symbol X --direction inbound --depth 3` → `callers` / `structure --property-type X` |
| Call Graph | "Who calls X?" / "What does X call?" | `callers --symbol X` or `callees --symbol X` |
| Code Hotspots | "What are the most critical classes?" | `hotspots --type class --limit 20` |
| Test Impact | "Which tests break if I change these files?" | `affected --files path1,path2` |
| Cross-Platform | "Client/server don't sync" | `business --panorama` → `trace` per service |
| Architecture | "How is system structured?" | `wiki --architecture` → `services --list` |
| Data Quality | "Is KB data reliable?" | `meta --stale` |
| Code-Level Detail | "Find all @X annotations" | `structure --annotation X` |

---

## Troubleshooting: Empty Results & Errors

When a command returns empty or unexpected results, follow the fallback chain:

| Symptom | Likely Cause | Fallback |
|---------|-------------|----------|
| `trace` returns empty `matchedNodes` | Keywords don't match KG node names | 1. Add more keyword variants (Chinese + English + abbreviation) 2. Try `--fusion none` for pure text search 3. Search domain flows: `domain --service S --flows` then extract English keywords and retry |
| `ask` returns "No service discovered" | Keywords too vague or service has no data layers | 1. Run `services --list` to see available services 2. Try `business --search "keyword"` to find the domain first 3. Specify `--service` manually |
| `structure --symbol X` returns empty | Symbol name doesn't match exactly | 1. Try `structure --q "X"` for fuzzy search 2. Try `structure --annotation X` if it might be an annotation 3. Try `kg --service S --search "X"` to find the node first |
| `kg --neighbors X` returns "node not found" | Node name is wrong or not in KG | 1. Run `kg --service S --search "X"` to find exact name 2. Check "Did you mean" suggestions in error output 3. Try partial name match |
| `impact` / `callers` / `callees` returns empty | Symbol exists but has no edges in specified direction | 1. Try `--direction both` 2. Try without `--edge-type` filter 3. Check if symbol is in the KG: `kg --service S --search "X"` |
| `business --domain X` returns 404 | Domain slug or name doesn't match | 1. Run `business --list` to see exact domain names 2. Try Chinese name directly: `--domain "中文名"` |
| `wiki --service S --domain D` returns 404 | Domain not indexed for this service | 1. Run `wiki --service S` to see available domains 2. Try `wiki --search "D"` across all services |
| `trace --auto-discover` picks wrong service | Ambiguous keywords match multiple services | 1. Use `ask --service S --query "..."` to override 2. Add more specific keywords (e.g., include class name) |
| API server unreachable (exit 2) | Server not running | Report to user: "Start the API server with `pnpm run serve`". Do NOT attempt auto-start. |
| `meta --stale` shows stale layers | Data out of sync with code | Recommend user run the corresponding `/understand-*` skill to regenerate stale layers. |

**General recovery pattern:**
1. **Broaden search**: Add keyword variants, remove filters, increase `--limit`
2. **Narrow scope**: Specify `--service`, use `--path` to filter by file path
3. **Change approach**: If `trace` fails, try `kg --search` → `kg --neighbors` manually
4. **Verify data exists**: `services --list` + `meta --stale` before blaming the query

---

## Server Configuration

The CLI uses `http://172.18.228.71:3001` as the default API server.

- Override with `UNDERSTAND_SERVER` environment variable or `--server` flag.
- If the server is unreachable, the CLI exits with code 2 and prints startup instructions.
- The agent should NOT attempt to auto-start the server — report the error to the user.

---

## Token Budget Guide

| Operation | ~Tokens | Recommendation |
|-----------|---------|----------------|
| `ask --depth quick` | 200–500 | Always safe |
| `ask --depth standard` | 1000–3000 | Default for business questions |
| `ask --depth full` | 3000–8000 | Use for verified answers |
| `trace --source --business` | 1500–4000 | Primary exploration |
| `services --list` | 200 | Always safe |
| `business --search Q` | 300 | Prefer over `--list` |
| `kg --neighbors X` (depth=1) | 500–1500 | Primary traversal |
| `impact --depth 3` | 800–3000 | Transitive impact (prefer over manual BFS) |
| `callers` / `callees` (depth=1) | 300–800 | Direct call graph |
| `hotspots --limit 20` | 500–2000 | Service-wide critical nodes |
| `structure --symbol X` | 200–1000 | Symbol metadata only |
| `structure --symbol X --source` | 500–5000 | Symbol + source code (varies by match count) |
| `kg` full graph (no filter) | 5000–50000 | **AVOID** |

---

## Quick-Reference: Common Agent Questions

Agents receiving natural-language questions (Chinese or English) can map directly to commands:

| User Question Pattern | Recommended Command | Notes |
|----------------------|---------------------|-------|
| **Business & Discovery** |||
| "What is X?" / "X是什么功能？" | `ask --query "X,EnglishName" --depth full` | Auto-discovers service + full trace |
| "Complete flow of X?" / "X的完整流程？" | `ask --query "X,FlowEnglish" --depth full` | Includes domain flow steps |
| "Business rules for X?" / "X的业务规则？" | `business --domain X --type rules` | Business rule query |
| "How do users interact with X?" / "X的用户交互？" | `business --domain X --type interactions` | User interaction steps |
| "Business landscape overview" / "业务全景？" | `business --panorama` | All facets and services |
| "What services exist?" / "有哪些服务？" | `services --list` | Service discovery + data layer readiness |
| **Code Location & Source** |||
| "Where is X implemented?" / "X在哪里实现？" | `trace --auto-discover --query "X,English" --source` | Auto-locates service + source |
| "Show me code for X" / "X方法的源码" | `structure --service S --symbol X --source` | Precise symbol + source |
| "Read file F" / "读取文件F" | `kg --service S --file F` | Full file content |
| "Read lines 100-200 of F" / "读F的100-200行" | `kg --service S --file F --start 100 --end 200` | Line range read |
| "Methods in file F" / "文件F有哪些方法？" | `kg --service S --file F --toc` | Method index (cheap, no source) |
| "File overview for F" / "文件F概览？" | `kg --service S --file F --summary` | Symbols, imports, callers, blast radius |
| "Methods with validate in name?" / "带validate的方法？" | `structure --service S --q "validate"` | Fuzzy name search |
| **Structure & Type Analysis** |||
| "Who implements interface IX?" / "哪些类实现了IX？" | `structure --service S --implementors IX` | Interface implementation search |
| "All classes with @X annotation" / "所有@X注解的类" | `structure --service S --annotation X` | Annotation batch search |
| "Who injects X class?" / "谁注入了X类？" | `structure --service S --property-type X` | Dependency injection analysis |
| "Inheritance chain of X" / "X的继承链" | `structure --service S --chain X --direction up` | Trace superclass hierarchy |
| "All subclasses of X" / "X的子类" | `structure --service S --chain X --direction down` | Descendant enumeration |
| "RPC contract for X?" / "RPC接口的参数和返回值？" | `structure --service S --annotation MoaProvider --path X` | RPC contract inspection |
| "Which classes use OrderDTO?" / "谁用了OrderDTO？" | `structure --service S --param-type OrderDTO` + `--return-type OrderDTO` | Type usage across codebase |
| **Dependency & Impact** |||
| "What breaks if I change X?" / "改X会影响什么？" | `impact --service S --symbol X --depth 3 --direction inbound` | Transitive impact analysis |
| "Who calls X?" / "谁调用了X？" | `callers --service S --symbol X --depth 2` | Inbound call graph |
| "What does X call?" / "X调用了谁？" | `callees --service S --symbol X --depth 2` | Outbound call graph |
| "Which tests for changed files?" / "改了要跑哪些测试？" | `affected --service S --files src/X.java --depth 2` | Affected test discovery |
| "Most critical classes?" / "最关键的类？" | `hotspots --service S --type class --limit 20` | Fan-in/fan-out hotspot scoring |
| "Blast radius of X?" / "X的影响半径？" | `trace --query X` → check `blastRadius` → `impact --symbol X --depth 3` | Quick triage + transitive |
| **Cross-Service & Wiki** |||
| "How do X and Y interact?" / "X和Y怎么交互？" | `trace` in svc-a + `trace` in svc-b | Dual-service comparison |
| "Architecture overview" / "系统架构？" | `wiki --architecture` | System architecture wiki |
| "Endpoints for service S" / "S有哪些接口？" | `wiki --service S --type endpoint` | API endpoint documentation |
| "Domain flow steps" / "X流程的步骤？" | `domain --service S --flow F --steps` | Ordered flow steps |
| "Related domains for X" / "X的相关领域？" | `wiki --service S --domain X --related` | Cross-service related domains |
| **Data & Freshness** |||
| "Is data stale?" / "数据是否过期？" | `meta --stale` | Stale layer detection |
| "KG layers for service S" / "S有哪些数据层？" | `services --name S` | Per-layer readiness |
| "Guided tour of service S" / "S的引导式探索？" | `kg --service S --tour` | Guided exploration steps |
| "Package/module structure" / "S的模块结构？" | `kg --service S --layers` | Layer summary |

**Keyword expansion rule:** When the user's question is in Chinese/non-English, ALWAYS expand keywords to include English variants (comma-separated). Example: "亲密度" → `--query "亲密度,intimacy,IntimacyService"`. Multi-keyword parallel search eliminates retry loops.

---

## Detail Documentation

- **[Source-Level Queries](docs/source-code.md)** — strategy overview, query paths, and combination recipes
- **[KG & Trace](docs/kg-trace.md)** — `kg`, `trace`, file reading patterns
- **[Graph Analysis](docs/graph-analysis.md)** — `impact`, `callers`, `callees`, `hotspots`, `affected`
- **[Structure](docs/structure-commands.md)** — `structure` (annotations, types, symbol search + source)
- **[Business & Domain Queries](docs/business-domain.md)** — `business`, `wiki`, `domain`, cross-platform recipe
- **[Technical Reference](docs/reference.md)** — `services`, `meta`, search algorithm, error handling

---

## Integration with Agent Workflow

**Typical agent patterns:**

1. **Business question:** `ask --depth full` → synthesize → present to user
2. **Code change:** `trace --source` → confirm implementation → edit files
3. **Impact check:** `impact --symbol X --direction inbound` + `affected --files` → assess risk and test scope
4. **Freshness gate:** `meta --stale` → decide if data is trustworthy
5. **Cross-reference:** Check `sourceReads` output before modifying domain logic

**Related skills:**

| Skill | When to run instead of query |
|-------|------------------------------|
| `/understand` | Regenerate stale kg layer |
| `/understand-domain` | Regenerate domain graph |
| `/understand-wiki` | Regenerate wiki and system graph |
| `/understand-business` | Regenerate business landscape |
| `/understand-dashboard` | Visual exploration when CLI output is insufficient |
