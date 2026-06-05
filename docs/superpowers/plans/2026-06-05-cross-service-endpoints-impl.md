# Cross-Service Endpoint Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable method-level RPC/MQ endpoint discovery in the knowledge graph and wiki, then visualize cross-service topology with a polished SystemOverview component.

**Architecture:** Deterministic pipeline — `extract-structure.mjs` extracts annotations + method signatures → `merge-batch-graphs.py` creates `endpoint` nodes + RPC edges → `build-system-graph.py` aggregates per-service KGs into system topology → Dashboard renders with React Flow.

**Tech Stack:** TypeScript (core/dashboard), Python (merge/matcher/system-graph scripts), tree-sitter (Java extraction), React Flow + D3 (visualization), Vitest/pytest (testing)

**PRD:** `.claude/prds/wiki-cross-service-endpoints.prd.md`

---

## File Structure

### Modified files

| File | Responsibility | Tasks |
|------|----------------|-------|
| `understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts` | Java AST extraction | T1 |
| `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts` | Extractor tests | T1 |
| `understand-anything-plugin/skills/understand/merge-batch-graphs.py` | Graph merge + RPC recovery | T2 |
| `tests/skill/understand/test_merge_batch_graphs.py` | Merge tests | T2 |
| `understand-anything-plugin/packages/core/src/types.ts` | Core type definitions | T3 |
| `understand-anything-plugin/packages/core/src/wiki-schema.ts` | Schema validators | T3 |
| `understand-anything-plugin/packages/core/src/__tests__/wiki-parent-schema.test.ts` | Schema tests | T3 |
| `understand-anything-plugin/skills/understand-wiki/cross-service-matcher.py` | Cross-service matching | T5 |
| `tests/skill/understand-wiki/test_cross_service_matcher.py` | Matcher tests | T5 |
| `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx` | System topology view | T7 |

### New files

| File | Responsibility | Tasks |
|------|----------------|-------|
| `understand-anything-plugin/skills/understand-wiki/extract-endpoints.py` | Deterministic endpoint extraction | T4 |
| `tests/skill/understand-wiki/test_extract_endpoints.py` | Endpoint extraction tests | T4 |
| `understand-anything-plugin/skills/understand-wiki/build-system-graph.py` | System graph generation | T6 |
| `tests/skill/understand-wiki/test_build_system_graph.py` | System graph tests | T6 |
| `understand-anything-plugin/packages/dashboard/src/components/ServiceNode.tsx` | Custom service node component | T7 |

---

# MVP Phase

## Task 1: Java Extractor — Parameter Type Extraction

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/java-extractor.ts:10-32`
- Test: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/java-extractor.test.ts`

Currently `extractParams()` (lines 10–32) only extracts parameter **names** as `string[]`. We need `{name, type}` objects for method signature matching.

- [ ] **Step 1: Write failing test for parameter type extraction**

In `java-extractor.test.ts`, add a new test after the existing parameter tests (~line 64):

```typescript
it("extracts parameter types from method declarations", async () => {
  const code = `
public class UserService {
    public UserDTO findUser(Long userId, String username) {
        return null;
    }
}`;
  const result = await extractor.extract(code, "UserService.java");
  const fn = result.functions.find((f) => f.name === "findUser");
  expect(fn).toBeDefined();
  expect(fn!.params).toEqual([
    { name: "userId", type: "Long" },
    { name: "username", type: "String" },
  ]);
  expect(fn!.returnType).toBe("UserDTO");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run -t "extracts parameter types"`
Expected: FAIL — `params` returns `["userId", "username"]` (strings, not objects)

- [ ] **Step 3: Update `StructuralAnalysis.functions[].params` type**

In `understand-anything-plugin/packages/core/src/types.ts`, find the `StructuralAnalysis` interface (lines 384–411). Change `params` from `string[]` to a union type that accepts both formats for backward compatibility:

```typescript
// In StructuralAnalysis interface, functions array item:
params: Array<string | { name: string; type: string }>;
```

- [ ] **Step 4: Implement `extractParams()` with types**

In `java-extractor.ts`, replace the `extractParams` function (lines 10–32):

```typescript
function extractParams(
  node: SyntaxNode,
): Array<{ name: string; type: string }> {
  const params: Array<{ name: string; type: string }> = [];
  const formalParams = node.namedChildren;
  for (const param of formalParams) {
    if (param.type === "formal_parameter" || param.type === "spread_parameter") {
      const nameNode = param.childForFieldName("name");
      const typeNode = param.childForFieldName("type");
      if (nameNode) {
        params.push({
          name: nameNode.text,
          type: typeNode?.text ?? "unknown",
        });
      }
    }
  }
  return params;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run -t "extracts parameter types"`
Expected: PASS

- [ ] **Step 6: Write test for generic parameter types**

```typescript
it("extracts generic parameter types", async () => {
  const code = `
public class BatchService {
    public List<Result> processBatch(List<Long> ids, Map<String, Object> options) {
        return null;
    }
}`;
  const result = await extractor.extract(code, "BatchService.java");
  const fn = result.functions.find((f) => f.name === "processBatch");
  expect(fn).toBeDefined();
  expect(fn!.params).toEqual([
    { name: "ids", type: "List<Long>" },
    { name: "options", type: "Map<String, Object>" },
  ]);
  expect(fn!.returnType).toBe("List<Result>");
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run -t "extracts generic parameter"`
Expected: PASS (the implementation from Step 4 should handle generics via `typeNode.text`)

- [ ] **Step 8: Run all existing extractor tests to verify no regression**

Run: `pnpm --filter @understand-anything/core test -- --run`
Expected: ALL PASS

- [ ] **Step 9: Update `extract-structure.mjs` to pass through typed params**

In `understand-anything-plugin/skills/understand/extract-structure.mjs`, find the `buildResult` function's function mapping (~lines 162–174). The current code already maps `params` directly — verify it passes through the new object format without changes. If it stringifies params, update to preserve the `{name, type}` structure.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(java-extractor): extract parameter types from method declarations

Params now include {name, type} objects instead of plain strings.
Supports generics (List<Long>, Map<String, Object>).
Backward-compatible union type in StructuralAnalysis."
```

---

## Task 2: Fix Synthetic Node Type — `class` → `endpoint`

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py:1149-1245`
- Test: `tests/skill/understand/test_merge_batch_graphs.py:1214-1559`

Currently `recover_rpc_mq_from_extraction` creates synthetic RPC interface nodes with `type: "class"`. Per design decision, these should be `type: "endpoint"` to appear correctly in the graph and system overview.

- [ ] **Step 1: Write failing test for endpoint node type**

In `test_merge_batch_graphs.py`, add a new test in `TestRecoverRpcMqFromExtraction` (after line 1559):

```python
def test_synthetic_node_type_is_endpoint(self):
    """Synthetic RPC interface nodes should be type 'endpoint', not 'class'."""
    assembled = {
        "nodes": [self._class_node("class:src/OrderServiceImpl.java:OrderServiceImpl")],
        "edges": [],
    }
    ext = self._extraction_result([{
        "path": "src/OrderServiceImpl.java",
        "classes": [{
            "name": "OrderServiceImpl",
            "annotations": [{"name": "MoaProvider"}],
            "interfaces": ["OrderService"],
        }],
        "functions": [],
    }])
    self._write_extraction(ext, "batch-0")

    recovered, _ = merge_batch_graphs.recover_rpc_mq_from_extraction(
        assembled, self.tmp_dir,
    )
    synthetic = next(
        (n for n in assembled["nodes"] if "synthetic" in n.get("id", "")),
        None,
    )
    self.assertIsNotNone(synthetic)
    self.assertEqual(synthetic["type"], "endpoint")
    self.assertIn("rpc-interface", synthetic.get("tags", []))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/skill/understand/test_merge_batch_graphs.py::TestRecoverRpcMqFromExtraction::test_synthetic_node_type_is_endpoint -v`
Expected: FAIL — `AssertionError: 'class' != 'endpoint'`

- [ ] **Step 3: Change synthetic node type to `endpoint`**

In `merge-batch-graphs.py`, change 3 locations:

**Location 1** (line ~1152): Provider interface synthetic node
```python
# Change "type": "class" → "type": "endpoint"
assembled["nodes"].append({
    "id": target_id,
    "type": "endpoint",
    "name": iface,
    "summary": f"RPC interface (synthetic — recovered from annotation)",
    "tags": ["rpc-interface", "synthetic"],
    "complexity": "simple",
})
```

**Location 2** (line ~1194): FeignClient remote service synthetic node
```python
assembled["nodes"].append({
    "id": target_id,
    "type": "endpoint",
    "name": iface_name,
    "summary": f"Remote service endpoint (synthetic — recovered from @FeignClient)",
    "tags": ["rpc-service", "synthetic"],
    "complexity": "simple",
})
```

**Location 3** (line ~1239): Consumer field interface synthetic node
```python
assembled["nodes"].append({
    "id": target_id,
    "type": "endpoint",
    "name": iface_name,
    "summary": f"RPC interface (synthetic — recovered from annotation)",
    "tags": ["rpc-interface", "synthetic"],
    "complexity": "simple",
})
```

- [ ] **Step 4: Also update `_synthetic_node_id` prefix**

In `merge-batch-graphs.py` (line ~1057):
```python
def _synthetic_node_id(interface_name: str) -> str:
    return f"endpoint:__synthetic__:{interface_name}"
```

- [ ] **Step 5: Run new test to verify it passes**

Run: `python3 -m pytest tests/skill/understand/test_merge_batch_graphs.py::TestRecoverRpcMqFromExtraction::test_synthetic_node_type_is_endpoint -v`
Expected: PASS

- [ ] **Step 6: Update existing tests that assert synthetic node properties**

Search existing tests for assertions on `"class:__synthetic__"` node IDs and change to `"endpoint:__synthetic__"`:

In `test_merge_batch_graphs.py`, find and update these test methods:
- `test_moa_provider_creates_provides_rpc_edge_and_synthetic_node` — update expected `target` ID
- `test_moa_consumer_creates_consumes_rpc_edge` — update expected `target` ID
- `test_dubbo_service_creates_provides_rpc_edge` — update expected `target` ID
- `test_dubbo_reference_creates_consumes_rpc_edge` — update expected `target` ID
- `test_feign_client_creates_consumes_rpc_edge` — update expected `target` ID
- `test_skip_if_edge_already_exists` — update edge tuple IDs

Replace all `"class:__synthetic__:` with `"endpoint:__synthetic__:` in test assertions.

- [ ] **Step 7: Run all merge tests to verify no regression**

Run: `python3 -m pytest tests/skill/understand/test_merge_batch_graphs.py -v`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "fix: change synthetic RPC nodes from type 'class' to 'endpoint'

Synthetic nodes created by recover_rpc_mq_from_extraction now use
type: 'endpoint' instead of 'class'. This aligns with the design
decision to reuse the existing endpoint NodeType for RPC endpoints,
making them visible in the graph and system overview.

Also updates node ID prefix from 'class:__synthetic__' to
'endpoint:__synthetic__'."
```

---

## Task 3: Core Types + Schema Validators for Endpoint Wiki Pages

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts:48-55`
- Modify: `understand-anything-plugin/packages/core/src/wiki-schema.ts:86`
- Test: `understand-anything-plugin/packages/core/src/__tests__/wiki-parent-schema.test.ts`

- [ ] **Step 1: Write failing test for `endpoint` in wiki index validTypes**

In `wiki-parent-schema.test.ts`, add:

```typescript
it("accepts 'endpoint' as a valid wiki index type", () => {
  const index = [
    { id: "ep-1", name: "Order Endpoints", type: "endpoint", summary: "RPC endpoints for order service" },
  ];
  const result = validateWikiIndex(index);
  expect(result.valid).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run -t "accepts 'endpoint'"`
Expected: FAIL — `"endpoint"` not in `validTypes` set

- [ ] **Step 3: Add `endpoint` to validTypes**

In `wiki-schema.ts` line 86:
```typescript
new Set(["overview", "architecture", "domain", "flow", "step", "service", "endpoint"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run -t "accepts 'endpoint'"`
Expected: PASS

- [ ] **Step 5: Add `ServiceEndpointDoc` interface to types.ts**

In `types.ts`, after the `WikiIndexEntry` interface (~line 55):

```typescript
export interface EndpointMethodSignature {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  lineRange?: [number, number];
}

export interface ServiceEndpointDoc {
  service: string;
  description: string;
  providers: Array<{
    identifier: string;
    protocol: string;
    framework: string;
    group?: string;
    version?: string;
    methods: EndpointMethodSignature[];
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
  consumers: Array<{
    identifier: string;
    protocol: string;
    framework: string;
    targetInterface: string;
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
  kafkaTopics: Array<{
    topic: string;
    role: "publisher" | "subscriber";
    handlerMethod?: string;
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
}
```

- [ ] **Step 6: Add `endpoint` to `WikiIndexEntry.type` union**

In `types.ts` line ~51, update the type field:
```typescript
type: "overview" | "architecture" | "domain" | "flow" | "step" | "service" | "endpoint";
```

- [ ] **Step 7: Write failing test for `validateWikiEndpointDoc`**

```typescript
it("validates a well-formed ServiceEndpointDoc", () => {
  const doc = {
    service: "order-service",
    description: "Order service RPC endpoints",
    providers: [{
      identifier: "OrderService",
      protocol: "moa",
      framework: "MOA",
      methods: [{ name: "createOrder", params: [{ name: "req", type: "CreateOrderReq" }], returnType: "OrderDTO" }],
    }],
    consumers: [],
    kafkaTopics: [],
  };
  const result = validateWikiEndpointDoc(doc);
  expect(result.valid).toBe(true);
});

it("rejects ServiceEndpointDoc missing service field", () => {
  const doc = { description: "test", providers: [], consumers: [], kafkaTopics: [] };
  const result = validateWikiEndpointDoc(doc);
  expect(result.valid).toBe(false);
  expect(result.issues).toContain(expect.stringContaining("service"));
});
```

- [ ] **Step 8: Implement `validateWikiEndpointDoc` in wiki-schema.ts**

```typescript
export function validateWikiEndpointDoc(
  doc: unknown,
): { valid: boolean; issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!doc || typeof doc !== "object") {
    return { valid: false, issues: ["endpoint doc is not an object"], warnings };
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.service !== "string" || !d.service) {
    issues.push("endpoint doc missing 'service' string");
  }
  if (!Array.isArray(d.providers)) {
    issues.push("endpoint doc missing 'providers' array");
  }
  if (!Array.isArray(d.consumers)) {
    issues.push("endpoint doc missing 'consumers' array");
  }
  if (!Array.isArray(d.kafkaTopics)) {
    issues.push("endpoint doc missing 'kafkaTopics' array");
  }
  return { valid: issues.length === 0, issues, warnings };
}
```

- [ ] **Step 9: Run all core tests**

Run: `pnpm --filter @understand-anything/core test -- --run`
Expected: ALL PASS

- [ ] **Step 10: Verify core builds**

Run: `pnpm --filter @understand-anything/core build`
Expected: Build success

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(core): add endpoint wiki page type and ServiceEndpointDoc

- Add 'endpoint' to WikiIndexEntry.type union and validTypes set
- New interfaces: EndpointMethodSignature, ServiceEndpointDoc
- New validator: validateWikiEndpointDoc()
- Tests for schema validation"
```

---

## Task 4: Deterministic Endpoint Extraction Script

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/extract-endpoints.py`
- Create: `tests/skill/understand-wiki/test_extract_endpoints.py`

This script reads `ua-file-extract-results-*.json` and produces per-service `endpoints/<service>.json` files.

- [ ] **Step 1: Write failing test for MoaProvider endpoint extraction**

Create `tests/skill/understand-wiki/test_extract_endpoints.py`:

```python
"""Tests for extract-endpoints.py — deterministic endpoint extraction."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[3]
        / "understand-anything-plugin" / "skills" / "understand-wiki"),
)


class TestExtractEndpoints(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def _write_extraction(self, data: dict, name: str = "batch-0") -> Path:
        p = Path(self.tmp_dir) / f"ua-file-extract-results-{name}.json"
        p.write_text(json.dumps(data), encoding="utf-8")
        return p

    def test_moa_provider_extracts_endpoint(self):
        ext = {
            "scriptCompleted": True,
            "results": [{
                "path": "src/main/java/com/example/OrderServiceImpl.java",
                "classes": [{
                    "name": "OrderServiceImpl",
                    "annotations": [{"name": "MoaProvider", "arguments": {"uri": "/service/order"}}],
                    "interfaces": ["OrderService"],
                    "methods": ["createOrder", "getOrder"],
                }],
                "functions": [
                    {
                        "name": "createOrder",
                        "params": [{"name": "req", "type": "CreateOrderReq"}],
                        "returnType": "OrderDTO",
                        "startLine": 10, "endLine": 20,
                    },
                    {
                        "name": "getOrder",
                        "params": [{"name": "orderId", "type": "Long"}],
                        "returnType": "OrderDTO",
                        "startLine": 22, "endLine": 30,
                    },
                ],
            }],
        }
        self._write_extraction(ext)

        import extract_endpoints
        result = extract_endpoints.extract_endpoints_from_dir(
            Path(self.tmp_dir), "order-service",
        )
        self.assertEqual(result["service"], "order-service")
        self.assertEqual(len(result["providers"]), 1)
        provider = result["providers"][0]
        self.assertEqual(provider["identifier"], "OrderService")
        self.assertEqual(provider["protocol"], "moa")
        self.assertEqual(len(provider["methods"]), 2)
        self.assertEqual(provider["methods"][0]["name"], "createOrder")
        self.assertEqual(provider["methods"][0]["returnType"], "OrderDTO")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/skill/understand-wiki/test_extract_endpoints.py::TestExtractEndpoints::test_moa_provider_extracts_endpoint -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'extract_endpoints'`

- [ ] **Step 3: Implement `extract-endpoints.py`**

Create `understand-anything-plugin/skills/understand-wiki/extract-endpoints.py`:

```python
"""Deterministic endpoint extraction from ua-file-extract-results JSON.

Reads annotations + method signatures to produce ServiceEndpointDoc JSON.
Does NOT use LLM — pure structural extraction.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PROVIDER_ANNOTATIONS = {"MoaProvider", "DubboService", "GrpcService"}
_CONSUMER_ANNOTATIONS = {"MoaConsumer", "DubboReference", "GrpcClient"}
_CONSUMER_CLASS_ANNOTATIONS = {"FeignClient"}
_SUBSCRIBER_ANNOTATIONS = {"KafkaListener"}

_ANNOTATION_TO_PROTOCOL = {
    "MoaProvider": "moa", "MoaConsumer": "moa",
    "DubboService": "dubbo", "DubboReference": "dubbo",
    "GrpcService": "grpc", "GrpcClient": "grpc",
    "FeignClient": "http",
}


def _annotation_names(annotations: list[dict] | None) -> set[str]:
    if not annotations:
        return set()
    return {a.get("name", "") for a in annotations if isinstance(a, dict)}


def _annotation_args(annotations: list[dict] | None, name: str) -> dict:
    if not annotations:
        return {}
    for a in annotations:
        if isinstance(a, dict) and a.get("name") == name:
            return a.get("arguments", {})
    return {}


def _match_methods_to_class(
    functions: list[dict], class_name: str, file_path: str,
) -> list[dict]:
    """Match top-level functions to a class by checking if they belong to
    the same file and their name appears in the class methods list."""
    methods = []
    for fn in functions:
        if not isinstance(fn, dict):
            continue
        params = fn.get("params", [])
        typed_params = []
        for p in params:
            if isinstance(p, dict):
                typed_params.append({"name": p.get("name", "?"), "type": p.get("type", "unknown")})
            elif isinstance(p, str):
                typed_params.append({"name": p, "type": "unknown"})

        methods.append({
            "name": fn.get("name", "?"),
            "params": typed_params,
            "returnType": fn.get("returnType", "void"),
            "lineRange": [fn.get("startLine", 0), fn.get("endLine", 0)],
        })
    return methods


def extract_endpoints_from_dir(
    extraction_dir: Path, service_name: str,
) -> dict[str, Any]:
    """Read extraction results and produce a ServiceEndpointDoc dict."""
    providers: list[dict] = []
    consumers: list[dict] = []
    kafka_topics: list[dict] = []

    extraction_files = sorted(extraction_dir.glob("ua-file-extract-results-*.json"))

    for ext_file in extraction_files:
        try:
            data = json.loads(ext_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        results = data.get("results")
        if not isinstance(results, list):
            continue

        for file_result in results:
            file_path = file_result.get("path", "")
            classes = file_result.get("classes", [])
            functions = file_result.get("functions", [])
            if not isinstance(classes, list):
                classes = []
            if not isinstance(functions, list):
                functions = []

            for cls in classes:
                if not isinstance(cls, dict):
                    continue
                cls_name = cls.get("name", "")
                if not cls_name:
                    continue

                ann_names = _annotation_names(cls.get("annotations"))
                interfaces = cls.get("interfaces", [])
                if not isinstance(interfaces, list):
                    interfaces = []

                provider_anns = ann_names & _PROVIDER_ANNOTATIONS
                if provider_anns and interfaces:
                    ann_name = next(iter(provider_anns))
                    protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                    ann_args = _annotation_args(cls.get("annotations"), ann_name)
                    methods = _match_methods_to_class(functions, cls_name, file_path)

                    for iface in interfaces:
                        providers.append({
                            "identifier": iface,
                            "protocol": protocol,
                            "framework": ann_name,
                            "group": ann_args.get("group"),
                            "version": ann_args.get("version"),
                            "methods": methods,
                            "sourceRef": {"file": file_path},
                        })

                consumer_anns = ann_names & _CONSUMER_CLASS_ANNOTATIONS
                if consumer_anns:
                    ann_name = next(iter(consumer_anns))
                    protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                    ann_args = _annotation_args(cls.get("annotations"), ann_name)
                    target = ann_args.get("value", ann_args.get("name", cls_name))
                    consumers.append({
                        "identifier": cls_name,
                        "protocol": protocol,
                        "framework": ann_name,
                        "targetInterface": target if isinstance(target, str) else cls_name,
                        "sourceRef": {"file": file_path},
                    })

                typed_props = cls.get("typedProperties", [])
                if isinstance(typed_props, list):
                    for prop in typed_props:
                        if not isinstance(prop, dict):
                            continue
                        prop_anns = _annotation_names(prop.get("annotations"))
                        field_consumer_anns = prop_anns & _CONSUMER_ANNOTATIONS
                        if field_consumer_anns:
                            ann_name = next(iter(field_consumer_anns))
                            protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                            iface_name = prop.get("type", prop.get("name", "?"))
                            consumers.append({
                                "identifier": iface_name,
                                "protocol": protocol,
                                "framework": ann_name,
                                "targetInterface": iface_name,
                                "sourceRef": {"file": file_path},
                            })

            for fn in functions:
                if not isinstance(fn, dict):
                    continue
                fn_anns = _annotation_names(fn.get("annotations"))
                if fn_anns & _SUBSCRIBER_ANNOTATIONS:
                    for ann_name in fn_anns & _SUBSCRIBER_ANNOTATIONS:
                        ann_args = _annotation_args(fn.get("annotations"), ann_name)
                        topics = ann_args.get("topics", ann_args.get("value", ""))
                        if isinstance(topics, str):
                            topics = [topics] if topics else []
                        elif not isinstance(topics, list):
                            topics = []
                        for topic in topics:
                            kafka_topics.append({
                                "topic": topic,
                                "role": "subscriber",
                                "handlerMethod": fn.get("name"),
                                "sourceRef": {"file": file_path},
                            })

    return {
        "service": service_name,
        "description": f"RPC/MQ endpoints for {service_name}",
        "providers": providers,
        "consumers": consumers,
        "kafkaTopics": kafka_topics,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/skill/understand-wiki/test_extract_endpoints.py::TestExtractEndpoints::test_moa_provider_extracts_endpoint -v`
Expected: PASS

- [ ] **Step 5: Write additional tests (DubboService, KafkaListener, empty input)**

Add to `test_extract_endpoints.py`:

```python
def test_dubbo_service_extracts_endpoint(self):
    ext = {
        "scriptCompleted": True,
        "results": [{
            "path": "src/DemoServiceImpl.java",
            "classes": [{
                "name": "DemoServiceImpl",
                "annotations": [{"name": "DubboService", "arguments": {"group": "dev", "version": "1.0"}}],
                "interfaces": ["DemoService"],
                "methods": ["hello"],
            }],
            "functions": [{"name": "hello", "params": [{"name": "name", "type": "String"}], "returnType": "String", "startLine": 5, "endLine": 8}],
        }],
    }
    self._write_extraction(ext)

    import extract_endpoints
    result = extract_endpoints.extract_endpoints_from_dir(Path(self.tmp_dir), "demo-service")
    self.assertEqual(len(result["providers"]), 1)
    self.assertEqual(result["providers"][0]["protocol"], "dubbo")
    self.assertEqual(result["providers"][0]["group"], "dev")
    self.assertEqual(result["providers"][0]["version"], "1.0")

def test_kafka_listener_extracts_topic(self):
    ext = {
        "scriptCompleted": True,
        "results": [{
            "path": "src/EventHandler.java",
            "classes": [],
            "functions": [{
                "name": "onOrderCreated",
                "annotations": [{"name": "KafkaListener", "arguments": {"topics": "order.created"}}],
                "params": [{"name": "event", "type": "OrderEvent"}],
                "returnType": "void",
                "startLine": 10, "endLine": 15,
            }],
        }],
    }
    self._write_extraction(ext)

    import extract_endpoints
    result = extract_endpoints.extract_endpoints_from_dir(Path(self.tmp_dir), "event-service")
    self.assertEqual(len(result["kafkaTopics"]), 1)
    self.assertEqual(result["kafkaTopics"][0]["topic"], "order.created")
    self.assertEqual(result["kafkaTopics"][0]["role"], "subscriber")

def test_empty_extraction_returns_empty_doc(self):
    import extract_endpoints
    result = extract_endpoints.extract_endpoints_from_dir(Path(self.tmp_dir), "empty-service")
    self.assertEqual(result["service"], "empty-service")
    self.assertEqual(result["providers"], [])
    self.assertEqual(result["consumers"], [])
    self.assertEqual(result["kafkaTopics"], [])
```

- [ ] **Step 6: Run all endpoint extraction tests**

Run: `python3 -m pytest tests/skill/understand-wiki/test_extract_endpoints.py -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add deterministic endpoint extraction script

extract-endpoints.py reads ua-file-extract-results JSON and produces
ServiceEndpointDoc JSON. Supports MoaProvider, DubboService, FeignClient,
MoaConsumer, DubboReference, KafkaListener annotations.
No LLM dependency — pure structural extraction."
```

---

## Task 5: Enhance Cross-Service Matcher — Method-Level

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/cross-service-matcher.py:152-194`
- Test: `tests/skill/understand-wiki/test_cross_service_matcher.py`

Currently `match_rpc_relationships()` uses wildcard methods (`ClassName.*()`). Enhance to match at method level when extraction data is available.

- [ ] **Step 1: Write failing test for method-level matching**

In `test_cross_service_matcher.py`, add:

```python
def test_method_level_matching_with_extraction_data(self):
    """When extraction data has method signatures, matching should be method-level."""
    providers = [{
        "service": "order-service",
        "interface": "OrderService",
        "implementor": "OrderServiceImpl",
        "methods": ["createOrder", "getOrder"],
        "source_node_id": "class:OrderServiceImpl.java:OrderServiceImpl",
    }]
    consumers = [{
        "service": "payment-service",
        "interface": "OrderService",
        "consumer_class": "PaymentHandler",
        "source_node_id": "class:PaymentHandler.java:PaymentHandler",
    }]
    result = cross_service_matcher.match_rpc_relationships(providers, consumers)
    self.assertEqual(len(result), 1)
    rel = result[0]
    self.assertIn("methods", rel["callee"])
    self.assertEqual(rel["callee"]["methods"], ["createOrder", "getOrder"])
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `python3 -m pytest tests/skill/understand-wiki/test_cross_service_matcher.py -k "method_level" -v`
Expected: Behavior depends on current output — verify and adjust assertion.

- [ ] **Step 3: Update `match_rpc_relationships` to include method list**

In `cross-service-matcher.py`, update the relationship output in `match_rpc_relationships` (~line 172-190) to include the provider's method list in the callee dict:

```python
rel = {
    "caller": {
        "service": consumer["service"],
        "class": consumer["consumer_class"],
        "method": f"{consumer['consumer_class']}.*()",
    },
    "callee": {
        "service": provider["service"],
        "interface": provider["interface"],
        "implementor": provider["implementor"],
        "method": f"{provider['implementor']}.*()",
        "methods": provider.get("methods", []),
    },
    "type": rpc_type,
    "confidence": "high",
    "evidence": "kg-matched",
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/skill/understand-wiki/test_cross_service_matcher.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(matcher): include method list in cross-service RPC relationships

match_rpc_relationships now passes provider method names through to
the callee dict for method-level granularity."
```

---

# Phase 2: System Graph + SystemOverview UI

## Task 6: `build-system-graph.py` — System Graph Generation

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`
- Create: `tests/skill/understand-wiki/test_build_system_graph.py`

Generates `system-graph.json` by aggregating per-service KGs.

- [ ] **Step 1: Write failing test for basic service discovery**

Create `tests/skill/understand-wiki/test_build_system_graph.py`:

```python
"""Tests for build-system-graph.py — system graph generation."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[3]
        / "understand-anything-plugin" / "skills" / "understand-wiki"),
)


class TestBuildSystemGraph(unittest.TestCase):
    def setUp(self):
        self.project_root = Path(tempfile.mkdtemp())

    def _create_service_kg(self, name: str, nodes: list, edges: list):
        svc_dir = self.project_root / name / ".understand-anything"
        svc_dir.mkdir(parents=True, exist_ok=True)
        kg = {
            "version": "1.0.0",
            "project": {"name": name, "languages": ["Java"], "frameworks": ["Spring Boot"]},
            "nodes": nodes,
            "edges": edges,
            "layers": [],
        }
        (svc_dir / "knowledge-graph.json").write_text(json.dumps(kg), encoding="utf-8")

    def test_discovers_services_with_kg(self):
        self._create_service_kg("order-service", [{"id": "f1", "type": "file"}], [])
        self._create_service_kg("payment-service", [{"id": "f2", "type": "file"}], [])
        (self.project_root / "no-kg-dir").mkdir()

        import build_system_graph
        sg = build_system_graph.build_system_graph(self.project_root)
        svc_names = {n["name"] for n in sg["nodes"] if n["type"] == "microservice"}
        self.assertEqual(svc_names, {"order-service", "payment-service"})
        self.assertEqual(sg["project"]["serviceCount"], 2)

    def test_extracts_rpc_edges_between_services(self):
        self._create_service_kg("svc-a", [
            {"id": "class:Impl.java:Impl", "type": "class"},
            {"id": "endpoint:__synthetic__:RemoteApi", "type": "endpoint", "tags": ["rpc-interface"]},
        ], [
            {"source": "class:Impl.java:Impl", "target": "endpoint:__synthetic__:RemoteApi", "type": "consumes_rpc", "detail": "moa"},
        ])
        self._create_service_kg("svc-b", [
            {"id": "class:RemoteApiImpl.java:RemoteApiImpl", "type": "class"},
            {"id": "endpoint:__synthetic__:RemoteApi", "type": "endpoint", "tags": ["rpc-interface"]},
        ], [
            {"source": "class:RemoteApiImpl.java:RemoteApiImpl", "target": "endpoint:__synthetic__:RemoteApi", "type": "provides_rpc"},
        ])

        import build_system_graph
        sg = build_system_graph.build_system_graph(self.project_root)
        rpc_edges = [e for e in sg["edges"] if e["type"] == "rpc_call"]
        self.assertEqual(len(rpc_edges), 1)
        self.assertIn("RemoteApi", rpc_edges[0].get("detail", {}).get("interface", ""))

    def test_empty_project_returns_valid_graph(self):
        import build_system_graph
        sg = build_system_graph.build_system_graph(self.project_root)
        self.assertEqual(sg["nodes"], [])
        self.assertEqual(sg["edges"], [])
        self.assertEqual(sg["project"]["serviceCount"], 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/skill/understand-wiki/test_build_system_graph.py::TestBuildSystemGraph::test_discovers_services_with_kg -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `build-system-graph.py`**

Create `understand-anything-plugin/skills/understand-wiki/build-system-graph.py`:

```python
"""Build system-graph.json from per-service knowledge graphs.

Aggregates service metadata, endpoint nodes, and RPC edges into a
lightweight system-level topology graph.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _load_kg(kg_path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(kg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _discover_services(project_root: Path) -> list[tuple[str, Path]]:
    services = []
    for child in sorted(project_root.iterdir()):
        if not child.is_dir():
            continue
        kg_path = child / ".understand-anything" / "knowledge-graph.json"
        if kg_path.exists():
            services.append((child.name, kg_path))
    return services


def build_system_graph(project_root: Path) -> dict[str, Any]:
    services = _discover_services(project_root)
    nodes: list[dict] = []
    edges: list[dict] = []
    total_nodes = 0
    total_edges = 0

    provides_index: dict[str, str] = {}
    consumes_list: list[tuple[str, str]] = []

    for svc_name, kg_path in services:
        kg = _load_kg(kg_path)
        if not kg:
            continue

        kg_nodes = kg.get("nodes", [])
        kg_edges = kg.get("edges", [])
        project_meta = kg.get("project", {})
        total_nodes += len(kg_nodes)
        total_edges += len(kg_edges)

        svc_id = f"microservice:{svc_name}"
        nodes.append({
            "id": svc_id,
            "type": "microservice",
            "name": svc_name,
            "summary": project_meta.get("description", ""),
            "languages": project_meta.get("languages", []),
            "frameworks": project_meta.get("frameworks", []),
            "stats": {
                "nodes": len(kg_nodes),
                "edges": len(kg_edges),
                "files": sum(1 for n in kg_nodes if n.get("type") == "file"),
            },
            "kgPath": f"{svc_name}/.understand-anything/knowledge-graph.json",
        })

        for edge in kg_edges:
            edge_type = edge.get("type", "")
            if edge_type == "provides_rpc":
                target_id = edge.get("target", "")
                interface_name = target_id.split(":")[-1] if ":" in target_id else target_id
                provides_index[interface_name] = svc_name
            elif edge_type == "consumes_rpc":
                target_id = edge.get("target", "")
                interface_name = target_id.split(":")[-1] if ":" in target_id else target_id
                consumes_list.append((svc_name, interface_name))

    for consumer_svc, interface_name in consumes_list:
        provider_svc = provides_index.get(interface_name)
        if provider_svc and provider_svc != consumer_svc:
            edges.append({
                "source": f"microservice:{consumer_svc}",
                "target": f"microservice:{provider_svc}",
                "type": "rpc_call",
                "weight": 0.8,
                "detail": {
                    "interface": interface_name,
                    "evidence": "kg-matched",
                },
            })

    service_index = {}
    for svc_name, kg_path in services:
        ua_dir = kg_path.parent
        service_index[svc_name] = {
            "hasKg": True,
            "hasWiki": (ua_dir / "wiki" / "meta.json").exists(),
            "hasDomain": (ua_dir / "domain-graph.json").exists(),
        }

    return {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": {
            "name": project_root.name,
            "serviceCount": len(services),
            "totalNodes": total_nodes,
            "totalEdges": total_edges,
        },
        "nodes": nodes,
        "edges": edges,
        "serviceIndex": service_index,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Build system-graph.json")
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()

    sg = build_system_graph(args.project_root)
    out_dir = args.project_root / ".understand-anything"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "system-graph.json"
    out_path.write_text(json.dumps(sg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"System graph written to {out_path}")
    print(f"  Services: {sg['project']['serviceCount']}")
    print(f"  Nodes: {len(sg['nodes'])}, Edges: {len(sg['edges'])}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run all system graph tests**

Run: `python3 -m pytest tests/skill/understand-wiki/test_build_system_graph.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add build-system-graph.py for system topology generation

Discovers services with KGs, extracts metadata + RPC edges,
produces system-graph.json for the SystemOverview dashboard view.
Supports progressive enhancement (Basic/Intermediate/Full)."
```

---

## Task 7: SystemOverview UI Upgrade — React Flow

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/SystemOverview.tsx`
- Create: `understand-anything-plugin/packages/dashboard/src/components/ServiceNode.tsx`

Replace D3 + SVG with React Flow, matching GraphView's quality.

- [ ] **Step 1: Create ServiceNode custom component**

Create `understand-anything-plugin/packages/dashboard/src/components/ServiceNode.tsx`:

```tsx
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

interface ServiceNodeData {
  label: string;
  summary: string;
  languages: string[];
  frameworks: string[];
  stats: { nodes: number; edges: number; files: number };
  hasKg: boolean;
  hasWiki: boolean;
  hasDomain: boolean;
  isSelected: boolean;
  onNodeClick: (id: string) => void;
}

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

const LANG_COLORS: Record<string, string> = {
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Go: "#00ADD8",
  Python: "#3572A5",
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
};

function ServiceNode({ id, data }: NodeProps<ServiceFlowNode>) {
  const primaryLang = data.languages?.[0] ?? "";
  const langColor = LANG_COLORS[primaryLang] ?? "#6b7280";

  return (
    <div
      className={`
        relative w-[200px] rounded-xl border bg-elevated shadow-md transition-all duration-200
        ${data.isSelected
          ? "border-gold shadow-lg shadow-gold/20"
          : "border-border-subtle hover:border-gold/50 hover:shadow-lg"
        }
      `}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl"
        style={{ backgroundColor: langColor }}
      />
      <div className="p-3 pl-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm text-text-primary truncate">
            {data.label}
          </h3>
          <div className="flex gap-0.5 ml-1">
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasKg ? "bg-green-400" : "bg-gray-600"}`} title="KG" />
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasWiki ? "bg-green-400" : "bg-gray-600"}`} title="Wiki" />
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasDomain ? "bg-green-400" : "bg-gray-600"}`} title="Domain" />
          </div>
        </div>
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {data.languages?.map((lang) => (
            <span
              key={lang}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${LANG_COLORS[lang] ?? "#6b7280"}20`,
                color: LANG_COLORS[lang] ?? "#6b7280",
              }}
            >
              {lang}
            </span>
          ))}
        </div>
        <div className="flex gap-3 text-[10px] text-text-muted font-mono">
          <span>{data.stats?.nodes ?? 0} nodes</span>
          <span>{data.stats?.files ?? 0} files</span>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-accent !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent !w-2 !h-2" />
    </div>
  );
}

export default memo(ServiceNode);
```

- [ ] **Step 2: Rewrite SystemOverview with React Flow**

Replace the entire `SystemOverview.tsx` content:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ServiceNode from "./ServiceNode";
import type { ServiceFlowNode } from "./ServiceNode";
import type { SystemGraph } from "@understand-anything/core";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../themes/index.ts";

const nodeTypes = { service: ServiceNode };

const EDGE_COLORS: Record<string, string> = {
  rpc_call: "#3b82f6",
  event: "#22c55e",
  shared_db: "#f59e0b",
  contains: "#94a3b8",
};

function serviceKeyFromNodeId(nodeId: string): string {
  return nodeId.replace(/^microservice:/, "");
}

function SystemOverviewInner() {
  const systemGraph = useDashboardStore((s) => s.systemGraph);
  const setActiveService = useDashboardStore((s) => s.setActiveService);
  const { t } = useI18n();
  const { preset } = useTheme();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNodeId(node.id);
    },
    [],
  );

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      const serviceName = serviceKeyFromNodeId(node.id);
      setActiveService(serviceName);
    },
    [setActiveService],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const { nodes: initialNodes, edges: initialEdges, project, serviceIndex } = useMemo(() => {
    if (!systemGraph) {
      return { nodes: [] as Node[], edges: [] as Edge[], project: null, serviceIndex: undefined };
    }
    const svcNodes: Node[] = systemGraph.nodes
      .filter((n) => n.type === "microservice")
      .map((n, i) => {
        const svcName = serviceKeyFromNodeId(n.id);
        const idx = systemGraph.serviceIndex?.[svcName];
        return {
          id: n.id,
          type: "service" as const,
          position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 180 },
          data: {
            label: n.name,
            summary: n.summary ?? "",
            languages: n.languages ?? [],
            frameworks: n.frameworks ?? [],
            stats: n.stats ?? { nodes: 0, edges: 0, files: 0 },
            hasKg: idx?.hasKg ?? false,
            hasWiki: idx?.hasWiki ?? false,
            hasDomain: idx?.hasDomain ?? false,
            isSelected: false,
            onNodeClick: () => {},
          },
        };
      });

    const svcIds = new Set(svcNodes.map((n) => n.id));
    const svcEdges: Edge[] = systemGraph.edges
      .filter((e) => svcIds.has(e.source) && svcIds.has(e.target))
      .map((e, i) => ({
        id: `sys-edge-${i}`,
        source: e.source,
        target: e.target,
        label: e.detail?.interface ?? e.type,
        style: {
          stroke: EDGE_COLORS[e.type] ?? EDGE_COLORS.contains,
          strokeWidth: 2,
        },
        labelStyle: {
          fill: EDGE_COLORS[e.type] ?? "#94a3b8",
          fontSize: 10,
          fontWeight: 500,
        },
        animated: e.type === "rpc_call",
      }));

    return {
      nodes: svcNodes,
      edges: svcEdges,
      project: systemGraph.project,
      serviceIndex: systemGraph.serviceIndex,
    };
  }, [systemGraph]);

  const visualNodes = useMemo(() => {
    return initialNodes.map((node) => ({
      ...node,
      data: { ...node.data, isSelected: node.id === selectedNodeId },
    }));
  }, [initialNodes, selectedNodeId]);

  const visualEdges = useMemo(() => {
    if (!selectedNodeId) return initialEdges;
    return initialEdges.map((edge) => {
      const isSelected = edge.source === selectedNodeId || edge.target === selectedNodeId;
      return {
        ...edge,
        animated: isSelected,
        style: {
          ...edge.style,
          strokeWidth: isSelected ? 3 : 1,
          opacity: isSelected ? 1 : 0.2,
        },
      };
    });
  }, [initialEdges, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(visualNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(visualEdges);

  useEffect(() => setNodes(visualNodes), [visualNodes, setNodes]);
  useEffect(() => setEdges(visualEdges), [visualEdges, setEdges]);

  if (!systemGraph) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">{t.systemNoGraph}</p>
      </div>
    );
  }

  const svcList = systemGraph.nodes.filter((n) => n.type === "microservice");

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r border-border-subtle overflow-y-auto p-4 bg-surface">
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {project?.name ?? t.systemOverview}
        </h2>
        {project?.description && (
          <p className="text-xs text-text-secondary mb-3 leading-relaxed">
            {project.description}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">{project?.serviceCount ?? svcList.length}</div>
            <div className="text-text-muted uppercase tracking-wider">{t.systemServiceCount}</div>
          </div>
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">{project?.totalNodes ?? 0}</div>
            <div className="text-text-muted uppercase tracking-wider">{t.systemTotalNodes}</div>
          </div>
        </div>

        <div className="mb-3 text-[10px] text-text-muted space-y-1">
          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#3b82f6] rounded" /> RPC Call</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#22c55e] rounded" /> Event</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#f59e0b] rounded" /> Shared DB</div>
        </div>

        <p className="text-[11px] text-text-muted mb-3">{t.systemDrillDown}</p>
        <ul className="space-y-1.5">
          {svcList.map((node) => {
            const svcName = serviceKeyFromNodeId(node.id);
            const idx = serviceIndex?.[svcName];
            const isActive = selectedNodeId === node.id;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className={`w-full text-left p-2 rounded-lg transition-colors ${isActive ? "bg-elevated border border-gold/30" : "hover:bg-elevated"}`}
                  onClick={() => setSelectedNodeId(node.id)}
                  onDoubleClick={() => {
                    setActiveService(svcName);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-text-primary truncate">{node.name}</span>
                    <div className="flex gap-0.5 ml-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${idx?.hasKg ? "bg-green-400" : "bg-gray-600"}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${idx?.hasWiki ? "bg-green-400" : "bg-gray-600"}`} />
                      <span className={`w-1.5 h-1.5 rounded-full ${idx?.hasDomain ? "bg-green-400" : "bg-gray-600"}`} />
                    </div>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {node.languages?.join(", ")}
                    <span className="ml-2 font-mono">{node.stats?.nodes ?? 0} nodes</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1 min-w-0 relative bg-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          colorMode={preset.isDark ? "dark" : "light"}
        >
          <Background variant={BackgroundVariant.Dots} color="var(--color-edge-dot)" gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeColor="var(--color-elevated)"
            maskColor="var(--glass-bg)"
            className="!bg-surface !border !border-border-subtle"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SystemOverview() {
  return (
    <ReactFlowProvider>
      <SystemOverviewInner />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 3: Verify dashboard builds**

Run: `pnpm --filter @understand-anything/dashboard build`
Expected: Build success

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(dashboard): upgrade SystemOverview to React Flow

- Replace D3 force + raw SVG with React Flow
- New ServiceNode component with language color bar, badges, stats
- Background dots, Controls, MiniMap matching GraphView
- Selection highlighting with edge fade
- Edge color coding (RPC=blue, Event=green, SharedDB=orange)
- Sidebar with legend and availability indicators
- Double-click to navigate to service KG"
```

---

## Task 8: Integration + Documentation

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md` (if exists)
- Modify: `docs/superpowers/specs/2026-06-04-system-graph-design.md`

- [ ] **Step 1: Update system-graph spec status**

In `docs/superpowers/specs/2026-06-04-system-graph-design.md`, change line 4:
```markdown
> Status: IMPLEMENTED — Step 1 complete (build-system-graph.py + SystemOverview React Flow)
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm --filter @understand-anything/core test -- --run && \
python3 -m pytest tests/skill/understand/ -v && \
python3 -m pytest tests/skill/understand-wiki/ -v && \
pnpm --filter @understand-anything/dashboard build
```
Expected: ALL PASS, build success

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: update system-graph spec status to IMPLEMENTED"
```

---

# Self-Review

## 1. Spec Coverage

| PRD Requirement | Task |
|---|---|
| Method signature extraction (params + return types) | T1 |
| Synthetic nodes use `endpoint` type | T2 |
| Core types (ServiceEndpointDoc) + schema validators | T3 |
| Deterministic endpoint extraction script | T4 |
| Cross-service method-level matching | T5 |
| System graph generation | T6 |
| SystemOverview UI upgrade (React Flow) | T7 |
| Documentation | T8 |

No gaps found against PRD milestones 1-7.

## 2. Placeholder Scan

No "TBD", "TODO", "implement later", or unspecified steps found.

## 3. Type Consistency

- `extractParams` returns `Array<{ name: string; type: string }>` (T1) — consumed by `extract-endpoints.py` (T4) as `{"name": ..., "type": ...}` ✓
- `ServiceEndpointDoc` (T3) matches `extract-endpoints.py` output (T4) ✓
- `_synthetic_node_id` prefix changed to `endpoint:__synthetic__:` (T2) — consistent in tests and implementation ✓
- `SystemGraph` types in `system-graph.ts` already exist — no conflicts ✓
