# Cross-Repo Graph Linking

> Date: 2026-06-05
> Status: DRAFT — Pending approval
> PRD: `.claude/prds/wiki-cross-service-endpoints.prd.md` (Milestone 8)

## Background

Current system graph generation (`build-system-graph.py`) assumes all services reside under a single parent directory. In multi-repo environments where each microservice is an independent git repo cloned to the same parent directory, two problems arise:

1. **No exclusion mechanism** — Unrelated projects in the same parent directory (test repos, deprecated services, experiments) are included in the system graph
2. **No manifest for future extension** — When services are not co-located (CI/CD artifacts, remote teams), there is no lightweight interface contract to share

## Target Scenario

```
~/projects/                          (parent directory)
  ├── order-service/                 (git repo 1, has .understand-anything/)
  ├── payment-service/               (git repo 2, has .understand-anything/)
  ├── user-service/                  (git repo 3, has .understand-anything/)
  ├── deprecated-auth/               (git repo 4, should be EXCLUDED)
  └── test-harness/                  (not a service, no .understand-anything/)
```

Developers clone all repos to the same parent. Each is an independent git repository. `test-harness` is automatically excluded (no KG). `deprecated-auth` should be excluded via configuration.

## Design

### Layer 1: System Configuration (`system.json`)

**File**: `<parent>/.understand-anything/system.json`

```json
{
  "version": "1.0",
  "name": "ultron-platform",
  "description": "Ultron 微服务平台",
  "discovery": {
    "mode": "auto",
    "exclude": ["deprecated-*", "test-*"],
    "include": []
  }
}
```

**Discovery rules**:

| Field | Type | Default | Behavior |
|-------|------|---------|----------|
| `mode` | `"auto"` | `"auto"` | Scan parent for subdirs with `.understand-anything/knowledge-graph.json` |
| `exclude` | `string[]` | `[]` | Glob patterns to exclude from auto-discovery |
| `include` | `string[]` | `[]` | If non-empty, ONLY include these services (whitelist mode, exclude is ignored) |

**Backward compatibility**: When `system.json` does not exist, behavior is identical to current — all services with KG are included. Zero-config for existing users.

**Glob matching**: Uses `fnmatch` pattern matching on service directory names. Supports `*` and `?` wildcards.

### Layer 2: Service Manifest (understand-phase byproduct)

**File**: `<service>/.understand-anything/manifest.json`

Generated automatically at the end of `merge-batch-graphs.py` — no separate script or manual step.

```json
{
  "version": "1.0",
  "service": "order-service",
  "generatedAt": "2026-06-05T12:00:00Z",
  "gitCommitHash": "abc1234",
  "gitBranch": "main",

  "metadata": {
    "languages": ["java"],
    "frameworks": ["spring-boot", "dubbo"],
    "nodeCount": 245,
    "edgeCount": 312,
    "fileCount": 89
  },

  "exports": {
    "providers": [
      {
        "identifier": "OrderService",
        "protocol": "dubbo",
        "framework": "DubboService",
        "methods": ["createOrder", "getOrder", "cancelOrder"]
      }
    ],
    "kafkaTopics": [
      { "topic": "order.created", "role": "publisher" }
    ]
  },

  "imports": {
    "consumers": [
      {
        "identifier": "UserServiceConsumer",
        "protocol": "moa",
        "targetInterface": "UserService"
      }
    ],
    "kafkaTopics": [
      { "topic": "user.registered", "role": "subscriber" }
    ]
  },

  "endpoints": {
    "synthetic": [
      "endpoint:__synthetic__:OrderService",
      "endpoint:__synthetic__:PaymentCallback"
    ]
  }
}
```

**Data source mapping**:

| Manifest field | KG source |
|----------------|-----------|
| `metadata.*` | KG root `projectName`, `languages`, `frameworks`, node/edge counts |
| `exports.providers` | `provides_rpc` edges + endpoint nodes |
| `exports.kafkaTopics` | `subscribes` edges (publisher role) |
| `imports.consumers` | `consumes_rpc` edges |
| `imports.kafkaTopics` | `subscribes` edges (subscriber role) |
| `endpoints.synthetic` | All `endpoint:__synthetic__:*` node IDs |
| `gitCommitHash` | `subprocess.run(["git", "rev-parse", "HEAD"])` |
| `gitBranch` | `subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"])` |

**Size**: ~1-5KB per service. Contains only metadata and interface contracts, no code content.

**Current use**: Not consumed by `build-system-graph.py` in MVP (it reads the full KG directly). Manifest serves as a pre-built summary for future remote scenarios.

### Layer 3: build-system-graph.py Enhancement

```python
def discover_services(project_root, system_config=None):
    all_services = _scan_subdirs(project_root)
    
    if not system_config:
        return all_services
    
    discovery = system_config.get("discovery", {})
    include_patterns = discovery.get("include", [])
    exclude_patterns = discovery.get("exclude", [])
    
    if include_patterns:
        return [s for s in all_services if _matches_any(s.name, include_patterns)]
    
    return [s for s in all_services if not _matches_any(s.name, exclude_patterns)]

def _matches_any(name, patterns):
    return any(fnmatch.fnmatch(name, p) for p in patterns)
```

**Changes**:
1. Load `system.json` if present (before service discovery)
2. Apply include/exclude filtering
3. Record `systemConfig.name` and `systemConfig.description` in system-graph metadata
4. Add `excludedServices` list to system-graph for transparency

**system-graph.json additions**:
```json
{
  "systemName": "ultron-platform",
  "systemDescription": "Ultron 微服务平台",
  "excludedServices": ["deprecated-auth"],
  "nodes": [...],
  "edges": [...]
}
```

## Delivery Milestones

| # | Milestone | Outcome | Scope |
|---|---|---|---|
| 1 | System Configuration | `system.json` schema + `build-system-graph.py` filtering | Core |
| 2 | Manifest Generation | Auto-generate `manifest.json` in `merge-batch-graphs.py` | Core |
| 3 | Dashboard system name | SystemOverview displays system name from config | Enhancement |

## Verification Plan

### Unit tests

| Test | File | What |
|------|------|------|
| `test_system_config_exclude` | `test_build_system_graph.py` | Services matching exclude patterns are filtered out |
| `test_system_config_include` | `test_build_system_graph.py` | Only whitelisted services are included |
| `test_no_system_config` | `test_build_system_graph.py` | Missing config = all services included (backward compat) |
| `test_glob_patterns` | `test_build_system_graph.py` | Wildcard patterns match correctly |
| `test_manifest_generation` | `test_merge_batch_graphs.py` | Manifest contains correct exports/imports from KG |
| `test_manifest_git_info` | `test_merge_batch_graphs.py` | Git commit hash and branch are captured |

### Integration

1. Create 3 mock services + 1 excluded → verify system-graph has 3 nodes
2. Dashboard build passes
3. SystemOverview displays system name

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Glob patterns too aggressive (exclude valid services) | Low | Medium | `excludedServices` in output for transparency |
| git command fails in non-git directories | Low | Low | Graceful fallback to empty strings |
| Manifest schema drift from KG changes | Low | Low | Generated from KG at same time, always in sync |

## Future Extension Points

- **Remote manifests**: `system.json` can add `manifests: ["/path/to/shared/manifests"]` to load manifests from external repos not in the parent directory
- **Dashboard remote markers**: ServiceNode can show `source: "manifest"` for services loaded from remote manifests (not local KG)
- **CI integration**: CI pipeline generates manifest as build artifact; `system.json` references CI artifact URL
