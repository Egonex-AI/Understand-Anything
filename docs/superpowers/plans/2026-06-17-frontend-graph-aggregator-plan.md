# Frontend Graph Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `build-frontend-graph.py` from a single-repo tool into a multi-repo aggregator so a web facet made of several repos (e.g. `web/web-app` + `web/admin`) is analyzed as one frontend axis — mirroring how `build-client-graph.py` aggregates mobile platforms into `client-graph.json`.

**Architecture:** Add three pure helper groups (repo discovery, per-repo extraction, cross-repo feature aggregation) and rewrite the orchestrator `build_frontend_graph` to compose them. New output fields are purely additive (`repos[]`, `domainLinks[]`, `apiCalls[].repo`, `features[].sourceRepos`); single-repo output stays shape-compatible. No `workflow.js` or `verify-wiki-completeness.py` changes (they already point at `frontend-graph.json`).

**Tech Stack:** Python 3 (stdlib only: `json`, `re`, `hashlib`, `pathlib`, `datetime`). pytest under `tests/understand-wiki/`. Module is imported in tests via `importlib` because its filename is hyphenated.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py` | Discover web repos, extract each, union + merge into the aggregate `frontend-graph.json` | **Modify** — add helpers, rewrite `build_frontend_graph` |
| `tests/understand-wiki/test_build_frontend_graph.py` | Unit + integration tests for the aggregator | **Modify** — add module bindings + new test classes |
| `understand-anything-plugin/skills/understand-wiki/workflow.js` | Orchestration (already calls `build-frontend-graph.py "${projectRoot}"`) | **No change** |
| `understand-anything-plugin/skills/understand-wiki/verify-wiki-completeness.py` | Batch gate (already requires `frontend-graph.json`, presence-only) | **No change** |

### Helper inventory (all added to `build-frontend-graph.py`)

- `_frontend_subpaths(root) -> list[str]` — read a discoverable `system.json`'s frontend-facet `subPaths`.
- `_discover_repos(root) -> list[tuple[str, Path]]` — resolve the repos this aggregate covers.
- `_normalize_feature_name(name) -> str` — `lower`, `-`/space → `_`.
- `_union(lists) -> list[str]` — sorted deduped union of string lists.
- `_union_api_calls(lists) -> list[dict]` — dedup feature-level apiCalls by `(method, path)`.
- `_aggregate_features(per_repo) -> tuple[list[dict], list[dict]]` — group features across repos → `(merged_features, domainLinks)`.
- `_extract_repo(repo_name, repo_root) -> dict | None` — load one repo's KG+DG and run the existing extractors; `None` (+WARN) if a graph is missing.

The existing extractors (`_extract_routes`, `_extract_pages`, `_extract_components`, `_extract_state_stores`, `_extract_api_calls`, `_build_features`, `_fp_to_route`, `_slug_in`, `_validate`) are **reused unchanged**.

---

## Task 1: Repo discovery helpers

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py` (add `_frontend_subpaths`, `_discover_repos` after `_validate`, before `build_frontend_graph` — around line 323)
- Test: `tests/understand-wiki/test_build_frontend_graph.py`

Resolution order (from spec): (1) single-repo if `root` itself has a `domain-graph.json`; (2) explicit `subPaths` from a frontend facet in `system.json`; (3) scan immediate subdirs that contain a `domain-graph.json`, sorted by name. Discovery keys on `domain-graph.json` presence, so non-repo subdirs (docs, scripts) are silently ignored — they are not "incomplete repos" and must not WARN.

- [ ] **Step 1: Add module bindings + write the failing tests**

In `tests/understand-wiki/test_build_frontend_graph.py`, after the existing binding block (after line 20, `_validate = _mod._validate`), add:

```python
_discover_repos = _mod._discover_repos
_frontend_subpaths = _mod._frontend_subpaths
```

Then append a new test class at the end of the file:

```python
def _make_repo(parent, name, *, kg=None, dg=None):
    """Create parent/name/.understand-anything/{knowledge-graph,domain-graph}.json."""
    ua = parent / name / ".understand-anything"
    ua.mkdir(parents=True)
    if kg is not None:
        (ua / "knowledge-graph.json").write_text(json.dumps(kg))
    if dg is not None:
        (ua / "domain-graph.json").write_text(json.dumps(dg))
    return parent / name


class TestDiscoverRepos:
    def test_single_repo_when_root_has_domain_graph(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
        repos = _discover_repos(tmp_path)
        assert repos == [(tmp_path.name, tmp_path)]

    def test_scan_subdirs_sorted_by_name(self, tmp_path):
        _make_repo(tmp_path, "web-app", dg=_minimal_dg())
        _make_repo(tmp_path, "admin", dg=_minimal_dg())
        (tmp_path / "docs").mkdir()  # non-repo subdir is ignored, no error
        repos = _discover_repos(tmp_path)
        assert [name for name, _ in repos] == ["admin", "web-app"]

    def test_subpaths_override_scan_order(self, tmp_path):
        _make_repo(tmp_path, "web-app", dg=_minimal_dg())
        _make_repo(tmp_path, "admin", dg=_minimal_dg())
        sys_ua = tmp_path / ".understand-anything"
        sys_ua.mkdir()
        (sys_ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "", "subPaths": ["web-app/", "admin/"]}]
        }))
        repos = _discover_repos(tmp_path)
        assert [name for name, _ in repos] == ["web-app", "admin"]  # declared order, not sorted

    def test_subdir_without_domain_graph_is_not_a_repo(self, tmp_path):
        _make_repo(tmp_path, "web-app", dg=_minimal_dg())
        _make_repo(tmp_path, "scripts", kg=_minimal_kg())  # KG only, no DG
        repos = _discover_repos(tmp_path)
        assert [name for name, _ in repos] == ["web-app"]


class TestFrontendSubpaths:
    def test_reads_subpaths_from_root_system_json(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "web/", "subPaths": ["a/", "b/"]}]
        }))
        assert _frontend_subpaths(tmp_path) == ["a/", "b/"]

    def test_reads_subpaths_from_parent_system_json(self, tmp_path):
        # Aggregate is invoked with the facet dir (web/); system.json lives at the project root.
        project = tmp_path
        web = project / "web"
        web.mkdir()
        ua = project / ".understand-anything"
        ua.mkdir()
        (ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "web/", "subPaths": ["admin/"]}]
        }))
        assert _frontend_subpaths(web) == ["admin/"]

    def test_no_system_json_returns_empty(self, tmp_path):
        assert _frontend_subpaths(tmp_path) == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestDiscoverRepos tests/understand-wiki/test_build_frontend_graph.py::TestFrontendSubpaths -v`
Expected: collection error / `AttributeError: module ... has no attribute '_discover_repos'` (helpers not defined yet).

- [ ] **Step 3: Implement the discovery helpers**

In `build-frontend-graph.py`, insert immediately before `def build_frontend_graph(` (currently line 325):

```python
def _frontend_subpaths(root: Path) -> list[str]:
    """Return subPaths declared for the frontend facet in a discoverable system.json.

    Checks root/.understand-anything/system.json then root.parent/... — the
    aggregate is invoked with the facet dir (e.g. web/), whose system.json lives
    at the project root (root.parent).
    """
    for base in (root, root.parent):
        sys_path = base / ".understand-anything" / "system.json"
        if not sys_path.exists():
            continue
        try:
            cfg = json.loads(sys_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        for facet in cfg.get("facets", []):
            if facet.get("type") == "frontend":
                return facet.get("subPaths", []) or []
        return []
    return []


def _discover_repos(root: Path) -> list[tuple[str, Path]]:
    """Resolve the web repos this aggregate covers, as (name, root) pairs.

    1. Single-repo: root itself has a domain-graph.json -> [(root.name, root)].
    2. Explicit: a frontend facet in system.json lists subPaths -> use those in
       declared order, keeping only ones that actually have a domain-graph.json.
    3. Scan: otherwise, immediate subdirs that have a domain-graph.json, by name.

    Discovery keys on domain-graph.json, so arbitrary subdirs (docs/, scripts/)
    are simply not repos and are skipped without warning.
    """
    if (root / ".understand-anything" / "domain-graph.json").exists():
        return [(root.name, root)]

    sub_paths = _frontend_subpaths(root)
    if sub_paths:
        repos: list[tuple[str, Path]] = []
        for sp in sub_paths:
            d = root / sp.rstrip("/")
            if (d / ".understand-anything" / "domain-graph.json").exists():
                repos.append((d.name, d))
        if repos:
            return repos

    repos = []
    for d in sorted(root.iterdir(), key=lambda p: p.name):
        if d.is_dir() and (d / ".understand-anything" / "domain-graph.json").exists():
            repos.append((d.name, d))
    return repos
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestDiscoverRepos tests/understand-wiki/test_build_frontend_graph.py::TestFrontendSubpaths -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py tests/understand-wiki/test_build_frontend_graph.py
git commit -m "feat(wiki): add frontend repo discovery helpers"
```

---

## Task 2: Cross-repo feature aggregation helpers

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py` (add `_normalize_feature_name`, `_union`, `_union_api_calls`, `_aggregate_features` near the discovery helpers)
- Test: `tests/understand-wiki/test_build_frontend_graph.py`

`_aggregate_features` takes the list of per-repo dicts (each `{"name": str, "features": [feature dict]}`), groups features by normalized name, and returns `(merged_features, domainLinks)`. Features unique to one repo pass through with `sourceRepos=[repo]`; features sharing a normalized name across repos merge into one entry (deduped-union list fields, `sourceRepos` = every contributing repo). Each shared group (≥2 distinct repos) also emits one `domainLink` mapping `repo -> that repo's feature id`. No `SEMANTIC_FAMILIES` (YAGNI — web repos name consistently).

- [ ] **Step 1: Add module bindings + write the failing tests**

In the test file binding block (after the Task 1 bindings), add:

```python
_aggregate_features = _mod._aggregate_features
_union = _mod._union
```

Append a new test class:

```python
def _feat(fid, name, *, routes=None, pages=None, components=None,
          stores=None, api=None):
    return {
        "id": fid,
        "name": name,
        "sourceDomain": fid.replace("feature:", "domain:", 1),
        "routes": routes or [],
        "pages": pages or [],
        "components": components or [],
        "stateStores": stores or [],
        "apiCalls": api or [],
        "uiRules": [], "interactionRules": [],
        "stateTransitions": [], "apiSequence": [],
    }


class TestUnion:
    def test_dedups_and_sorts(self):
        assert _union([["b", "a"], ["a", "c"]]) == ["a", "b", "c"]

    def test_empty(self):
        assert _union([]) == []


class TestAggregateFeatures:
    def test_distinct_names_no_links(self):
        per_repo = [
            {"name": "web-app", "features": [_feat("feature:order", "Orders", pages=["p/order.tsx"])]},
            {"name": "admin", "features": [_feat("feature:perm", "Permission", pages=["p/perm.tsx"])]},
        ]
        features, links = _aggregate_features(per_repo)
        assert links == []
        by_name = {f["name"]: f for f in features}
        assert set(by_name) == {"Orders", "Permission"}
        assert by_name["Orders"]["sourceRepos"] == ["web-app"]
        assert by_name["Permission"]["sourceRepos"] == ["admin"]

    def test_shared_name_merges_and_links(self):
        per_repo = [
            {"name": "web-app", "features": [
                _feat("feature:order", "Order Management",
                      pages=["p/order-list.tsx"], routes=["/orders"],
                      api=[{"method": "POST", "path": "/api/orders", "source": "a.ts", "lineRange": []}])]},
            {"name": "admin", "features": [
                _feat("feature:order", "order_management",
                      pages=["p/order-admin.tsx"], routes=["/orders"],
                      api=[{"method": "GET", "path": "/api/orders/export", "source": "b.ts", "lineRange": []}])]},
        ]
        features, links = _aggregate_features(per_repo)
        assert len(features) == 1
        merged = features[0]
        assert merged["sourceRepos"] == ["admin", "web-app"]
        assert merged["pages"] == ["p/order-admin.tsx", "p/order-list.tsx"]
        assert merged["routes"] == ["/orders"]  # deduped union
        assert {(c["method"], c["path"]) for c in merged["apiCalls"]} == {
            ("POST", "/api/orders"), ("GET", "/api/orders/export")}
        assert len(links) == 1
        assert links[0]["canonicalFeature"] == "Order Management"  # first-seen display name
        assert links[0]["mappings"] == {"web-app": "feature:order", "admin": "feature:order"}

    def test_single_repo_sets_source_repos(self):
        per_repo = [{"name": "web-app", "features": [_feat("feature:order", "Orders", pages=["p.tsx"])]}]
        features, links = _aggregate_features(per_repo)
        assert features[0]["sourceRepos"] == ["web-app"]
        assert links == []

    def test_normalization_groups_hyphen_space_case(self):
        per_repo = [
            {"name": "a", "features": [_feat("feature:x", "User-Auth", pages=["p.tsx"])]},
            {"name": "b", "features": [_feat("feature:y", "user auth", pages=["q.tsx"])]},
        ]
        features, links = _aggregate_features(per_repo)
        assert len(features) == 1
        assert features[0]["sourceRepos"] == ["a", "b"]
        assert len(links) == 1
        assert links[0]["mappings"] == {"a": "feature:x", "b": "feature:y"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestUnion tests/understand-wiki/test_build_frontend_graph.py::TestAggregateFeatures -v`
Expected: `AttributeError: module ... has no attribute '_aggregate_features'`.

- [ ] **Step 3: Implement the aggregation helpers**

In `build-frontend-graph.py`, insert before `def build_frontend_graph(` (alongside the Task 1 helpers):

```python
def _normalize_feature_name(name: str) -> str:
    return name.lower().replace("-", "_").replace(" ", "_")


def _union(lists: list[list[str]]) -> list[str]:
    out: set[str] = set()
    for lst in lists:
        out.update(lst)
    return sorted(out)


def _union_api_calls(lists: list[list[dict]]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for lst in lists:
        for c in lst:
            key = (c.get("method", ""), c.get("path", ""))
            if key in seen:
                continue
            seen.add(key)
            out.append(c)
    out.sort(key=lambda c: (c.get("path", ""), c.get("method", "")))
    return out


def _aggregate_features(per_repo: list[dict]) -> tuple[list[dict], list[dict]]:
    """Group features across repos by normalized name.

    Returns (features, domainLinks). Unique features pass through with
    sourceRepos=[repo]; features sharing a normalized name merge into one entry
    (deduped-union list fields, sourceRepos = every repo). Each shared (>=2 repo)
    group yields one domainLink mapping repo -> that repo's feature id.
    """
    groups: dict[str, list[tuple[str, dict]]] = {}
    order: list[str] = []  # preserve first-seen order for deterministic grouping
    for repo in per_repo:
        for feat in repo["features"]:
            key = _normalize_feature_name(feat.get("name", ""))
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append((repo["name"], feat))

    features: list[dict] = []
    domain_links: list[dict] = []
    for key in order:
        members = groups[key]
        repos_in_group = sorted({name for name, _ in members})
        _, first_feat = members[0]
        features.append({
            "id": first_feat["id"],
            "name": first_feat["name"],
            "sourceDomain": first_feat.get("sourceDomain", ""),
            "sourceRepos": repos_in_group,
            "routes": _union([f.get("routes", []) for _, f in members]),
            "pages": _union([f.get("pages", []) for _, f in members]),
            "components": _union([f.get("components", []) for _, f in members]),
            "stateStores": _union([f.get("stateStores", []) for _, f in members]),
            "apiCalls": _union_api_calls([f.get("apiCalls", []) for _, f in members]),
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })
        if len(repos_in_group) >= 2:
            mappings: dict[str, str] = {}
            for name, f in members:
                mappings.setdefault(name, f["id"])  # first occurrence per repo
            domain_links.append({
                "canonicalFeature": first_feat["name"],
                "mappings": mappings,
            })

    features.sort(key=lambda f: f["id"])
    domain_links.sort(key=lambda d: d["canonicalFeature"])
    return features, domain_links
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestUnion tests/understand-wiki/test_build_frontend_graph.py::TestAggregateFeatures -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py tests/understand-wiki/test_build_frontend_graph.py
git commit -m "feat(wiki): add cross-repo frontend feature aggregation helpers"
```

---

## Task 3: Per-repo extraction helper

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py` (add `_extract_repo` near the other helpers)
- Test: `tests/understand-wiki/test_build_frontend_graph.py`

`_extract_repo` loads one repo's KG+DG and runs the existing extractors, returning the raw pieces plus the KG `project` block. If either graph is missing, it prints a WARN and returns `None` so the aggregate can skip that repo and continue. (Discovery already filters on `domain-graph.json`, so in practice this WARNs when a discovered repo is missing `knowledge-graph.json`.)

- [ ] **Step 1: Add module binding + write the failing tests**

Add binding:

```python
_extract_repo = _mod._extract_repo
```

Append a test class:

```python
class TestExtractRepo:
    def test_returns_pieces_for_valid_repo(self, tmp_path):
        repo = _make_repo(tmp_path, "web-app", kg=_minimal_kg(), dg=_minimal_dg())
        out = _extract_repo("web-app", repo)
        assert out is not None
        assert out["name"] == "web-app"
        assert "src/pages/orders/List.tsx" in out["pages"]
        assert len(out["features"]) == 1
        assert out["features"][0]["name"] == "Order Management"
        assert out["project"]["name"] == "admin-web"  # carried from KG project block

    def test_missing_kg_returns_none_and_warns(self, tmp_path, capsys):
        repo = _make_repo(tmp_path, "admin", dg=_minimal_dg())  # DG only, no KG
        out = _extract_repo("admin", repo)
        assert out is None
        assert "WARN" in capsys.readouterr().err

    def test_missing_dg_returns_none_and_warns(self, tmp_path, capsys):
        repo = _make_repo(tmp_path, "admin", kg=_minimal_kg())  # KG only, no DG
        out = _extract_repo("admin", repo)
        assert out is None
        assert "WARN" in capsys.readouterr().err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestExtractRepo -v`
Expected: `AttributeError: module ... has no attribute '_extract_repo'`.

- [ ] **Step 3: Implement `_extract_repo`**

In `build-frontend-graph.py`, insert before `def build_frontend_graph(`:

```python
def _extract_repo(repo_name: str, repo_root: Path) -> dict | None:
    """Load one repo's KG+DG and run all extractors.

    Returns the raw per-repo pieces, or None (with a WARN) if either graph is
    missing, so the aggregate can skip the repo and continue.
    """
    ua_dir = repo_root / ".understand-anything"
    kg_path = ua_dir / "knowledge-graph.json"
    dg_path = ua_dir / "domain-graph.json"
    if not kg_path.exists() or not dg_path.exists():
        print(
            f"[build-frontend-graph] WARN: skipping {repo_name} — missing "
            f"knowledge-graph.json or domain-graph.json",
            file=sys.stderr,
        )
        return None

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    dg = json.loads(dg_path.read_text(encoding="utf-8"))

    routes = _extract_routes(repo_root, kg)
    pages = _extract_pages(repo_root, kg)
    components = _extract_components(repo_root, kg)
    stores = _extract_state_stores(repo_root, kg)
    api_calls = _extract_api_calls(repo_root, kg)
    features = _build_features(dg, routes, pages, components, stores, api_calls)

    return {
        "name": repo_name,
        "project": kg.get("project", {}),
        "routes": routes,
        "pages": pages,
        "components": components,
        "stores": stores,
        "apiCalls": api_calls,
        "features": features,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestExtractRepo -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py tests/understand-wiki/test_build_frontend_graph.py
git commit -m "feat(wiki): add per-repo extraction helper for frontend aggregate"
```

---

## Task 4: Rewrite `build_frontend_graph` as the aggregator

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py:325-399` (replace the `build_frontend_graph` function body)
- Test: `tests/understand-wiki/test_build_frontend_graph.py`

This is the integration step. `build_frontend_graph` now: discovers repos → extracts each (skipping missing) → unions scalar inventories → unions top-level `apiCalls` with per-repo `repo` provenance → calls `_aggregate_features` → assembles the graph with `repos[]` and `domainLinks[]` → validates → `mkdir` + atomic write. The existing single-repo tests must stay green (project name still from the KG, feature shapes preserved), and the new acceptance tests cover the multi-repo behavior.

- [ ] **Step 1: Write the failing acceptance tests**

Append a new test class to `tests/understand-wiki/test_build_frontend_graph.py`. (`_make_repo`, `_minimal_kg`, `_minimal_dg` are already defined from earlier tasks.)

```python
def _kg_with_page(name, page_path, *, api_edge=None):
    """KG with one page node; optionally a consumes_api edge to an endpoint."""
    nodes = [{
        "id": f"file:{page_path}", "type": "file", "name": Path(page_path).name,
        "filePath": page_path, "tags": ["page"], "summary": "page",
    }]
    edges = []
    if api_edge:
        method, path = api_edge
        nodes.append({"id": f"endpoint:{method}:{path}", "type": "endpoint",
                      "name": path, "path": path, "method": method})
        edges.append({"source": f"file:{page_path}", "target": f"endpoint:{method}:{path}",
                      "type": "consumes_api", "direction": "forward", "weight": 0.9})
    return {
        "project": {"name": name, "frameworks": ["react"], "languages": ["typescript"],
                    "gitCommitHash": "abc1234", "provenance": {"generationMode": "full", "degraded": False}},
        "nodes": nodes, "edges": edges,
    }


def _dg_with_domain(did, name):
    return {"project": {"name": "x"},
            "nodes": [{"id": did, "type": "domain", "name": name, "summary": "d"}],
            "edges": []}


def _read_graph(root):
    return json.loads((root / ".understand-anything" / "frontend-graph.json").read_text())


class TestMultiRepoAggregate:
    def test_distinct_modules_union(self, tmp_path):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path, "admin",
                   kg=_kg_with_page("admin", "src/pages/permissions/Index.tsx"),
                   dg=_dg_with_domain("domain:permission", "Permission"))
        build_frontend_graph(str(tmp_path))
        data = _read_graph(tmp_path)
        assert data["repos"] == ["admin", "web-app"]
        names = {f["name"] for f in data["features"]}
        assert names == {"Orders", "Permission"}
        assert data["domainLinks"] == []
        for f in data["features"]:
            assert len(f["sourceRepos"]) == 1

    def test_cross_repo_shared_feature_merges(self, tmp_path):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx", api_edge=("POST", "/api/orders")),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path, "admin",
                   kg=_kg_with_page("admin", "src/pages/orders/Manage.tsx", api_edge=("GET", "/api/orders/export")),
                   dg=_dg_with_domain("domain:order", "Orders"))
        build_frontend_graph(str(tmp_path))
        data = _read_graph(tmp_path)
        order_feats = [f for f in data["features"] if f["name"] == "Orders"]
        assert len(order_feats) == 1
        assert order_feats[0]["sourceRepos"] == ["admin", "web-app"]
        assert {(c["method"], c["path"]) for c in order_feats[0]["apiCalls"]} == {
            ("POST", "/api/orders"), ("GET", "/api/orders/export")}
        assert len(data["domainLinks"]) == 1
        assert set(data["domainLinks"][0]["mappings"]) == {"admin", "web-app"}

    def test_apicalls_have_repo_and_routes_stay_strings(self, tmp_path):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx", api_edge=("POST", "/api/orders")),
                   dg=_dg_with_domain("domain:order", "Orders"))
        build_frontend_graph(str(tmp_path))
        data = _read_graph(tmp_path)
        assert data["apiCalls"], "expected at least one api call"
        for c in data["apiCalls"]:
            assert c["repo"] == "web-app"
        assert isinstance(data["routes"], list)
        assert all(isinstance(r, str) for r in data["routes"])  # guards the non-breaking decision

    def test_single_repo_backward_compat(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = _read_graph(minimal_project)
        assert len(data["repos"]) == 1
        assert data["domainLinks"] == []
        assert data["project"]["name"] == "admin-web"  # KG name preserved for single repo
        feat = data["features"][0]
        assert feat["name"] == "Order Management"
        assert feat["sourceDomain"] == "domain:order-management"
        assert feat["sourceRepos"] == data["repos"]
        for key in ("id", "name", "sourceDomain", "routes", "pages", "components",
                    "stateStores", "apiCalls", "uiRules", "interactionRules",
                    "stateTransitions", "apiSequence"):
            assert key in feat

    def test_missing_sub_repo_kg_is_skipped_with_warn(self, tmp_path, capsys):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        # admin is discovered (has DG) but missing KG -> skipped with WARN
        _make_repo(tmp_path, "admin", dg=_dg_with_domain("domain:permission", "Permission"))
        build_frontend_graph(str(tmp_path))
        captured = capsys.readouterr()
        data = _read_graph(tmp_path)
        assert data["repos"] == ["web-app"]
        assert "admin" in captured.err and "WARN" in captured.err

    def test_content_hash_verifiable(self, tmp_path):
        import hashlib
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path, "admin",
                   kg=_kg_with_page("admin", "src/pages/permissions/Index.tsx"),
                   dg=_dg_with_domain("domain:permission", "Permission"))
        build_frontend_graph(str(tmp_path))
        data = _read_graph(tmp_path)
        stored = data.pop("contentHash")
        raw = json.dumps(data, indent=2, ensure_ascii=False)
        assert stored == "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    def test_subpaths_override_end_to_end(self, tmp_path):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path, "admin",
                   kg=_kg_with_page("admin", "src/pages/permissions/Index.tsx"),
                   dg=_dg_with_domain("domain:permission", "Permission"))
        sys_ua = tmp_path / ".understand-anything"
        sys_ua.mkdir()
        (sys_ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "", "subPaths": ["web-app/", "admin/"]}]
        }))
        build_frontend_graph(str(tmp_path))
        data = _read_graph(tmp_path)
        assert data["repos"] == ["web-app", "admin"]  # declared order, not sorted
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestMultiRepoAggregate -v`
Expected: failures — current `build_frontend_graph` treats `tmp_path` as a single repo, finds no `domain-graph.json` at the root, and raises `FileNotFoundError` (or produces output without `repos`/`domainLinks`). `KeyError: 'repos'` / `FileNotFoundError` on the multi-repo cases.

- [ ] **Step 3: Rewrite `build_frontend_graph`**

Replace the entire `build_frontend_graph` function (currently lines ~325-399) with:

```python
def build_frontend_graph(service_root_str: str) -> dict:
    root = Path(service_root_str).resolve()
    repos = _discover_repos(root)

    per_repo: list[dict] = []
    for repo_name, repo_root in repos:
        extracted = _extract_repo(repo_name, repo_root)
        if extracted is not None:
            per_repo.append(extracted)

    if not per_repo:
        raise FileNotFoundError(
            f"No web repo with knowledge-graph.json + domain-graph.json found under {root}"
        )

    # Union scalar inventories across repos (stay as sorted string lists).
    routes = _union([r["routes"] for r in per_repo])
    pages = _union([r["pages"] for r in per_repo])
    components = _union([r["components"] for r in per_repo])
    stores = _union([r["stores"] for r in per_repo])

    # Union top-level apiCalls with per-repo provenance (dedup per (repo, method, path)).
    all_api_calls: list[dict] = []
    seen_api: set[tuple[str, str, str]] = set()
    for r in per_repo:
        for c in r["apiCalls"]:
            key = (r["name"], c["method"], c["path"])
            if key in seen_api:
                continue
            seen_api.add(key)
            all_api_calls.append({
                "method": c["method"], "path": c["path"],
                "source": c["source"], "repo": r["name"],
            })
    all_api_calls.sort(key=lambda c: (c["repo"], c["path"], c["method"]))

    features, domain_links = _aggregate_features(per_repo)

    # Project metadata: single repo keeps its KG name (backward compat); aggregate
    # uses the facet/root dir name. Frameworks/languages are unioned.
    project_name = (
        per_repo[0]["project"].get("name", root.name) if len(per_repo) == 1 else root.name
    )
    frameworks = _union([r["project"].get("frameworks", []) for r in per_repo])
    languages = _union([r["project"].get("languages", []) for r in per_repo])
    degraded_in = any(
        r["project"].get("provenance", {}).get("degraded", False) for r in per_repo
    )
    git_hash = per_repo[0]["project"].get("gitCommitHash", "")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    graph: dict = {
        "version": VERSION,
        "facetType": "frontend",
        "project": {
            "name": project_name,
            "frameworks": frameworks,
            "languages": languages,
            "provenance": {
                "generationMode": "wiki",
                "degraded": degraded_in,
                "generatedAt": now,
                "gitCommitHash": git_hash,
            },
        },
        "repos": [r["name"] for r in per_repo],
        "routes": routes,
        "pages": pages,
        "components": components,
        "stateStores": stores,
        "apiCalls": all_api_calls,
        "features": features,
        "domainLinks": domain_links,
    }

    valid, degraded, warnings = _validate(graph)
    if not valid:
        raise ValueError(f"[build-frontend-graph] Validation failed: {warnings}")

    graph["project"]["provenance"]["degraded"] = degraded_in or degraded
    for w in warnings:
        print(f"[build-frontend-graph] WARN: {w}", file=sys.stderr)

    # Hash after all fields including degraded are finalized; consumers verify by
    # removing contentHash, serialising with indent=2 ensure_ascii=False, re-hashing.
    raw = json.dumps(graph, indent=2, ensure_ascii=False)
    graph["contentHash"] = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    content = json.dumps(graph, indent=2, ensure_ascii=False)
    ua_dir = root / ".understand-anything"
    ua_dir.mkdir(parents=True, exist_ok=True)
    output_path = ua_dir / "frontend-graph.json"
    tmp = output_path.with_suffix(".json.tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(output_path)

    print(
        f"[build-frontend-graph] Generated frontend-graph.json: "
        f"{len(per_repo)} repo(s), {len(features)} features, {len(routes)} routes, "
        f"{len(all_api_calls)} API calls, {len(domain_links)} domain links"
        + (" [degraded]" if (degraded_in or degraded) else "")
    )
    return graph
```

- [ ] **Step 4: Run the full test file (new acceptance tests + regression)**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py -v`
Expected: all pass — the 7 new `TestMultiRepoAggregate` tests, the 6 Task-1/Task-2/Task-3 helper tests, and all original `TestBuildFrontendGraph`/`TestValidate` tests (single-repo backward compatibility preserved).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-frontend-graph.py tests/understand-wiki/test_build_frontend_graph.py
git commit -m "feat(wiki): make build-frontend-graph a multi-repo aggregator"
```

---

## Task 5: End-to-end completeness-gate regression test

**Files:**
- Test: `tests/understand-wiki/test_build_frontend_graph.py` (add binding for `check_parent_wiki` + one test)

The batch gate (`verify-wiki-completeness.py check_parent_wiki`) only checks that `frontend-graph.json` exists — the additive schema fields can't break it. This test proves a *real* aggregate produced by `build_frontend_graph` satisfies the gate (no code change to the gate). Existing presence/absence gate tests already live in `test_verify_completeness.py`.

- [ ] **Step 1: Add binding + write the test**

Below the existing `importlib` block at the top of `tests/understand-wiki/test_build_frontend_graph.py`, add a second module load for the gate:

```python
_vspec = importlib.util.spec_from_file_location(
    "verify_wiki_completeness", SCRIPTS_DIR / "verify-wiki-completeness.py"
)
_vmod = importlib.util.module_from_spec(_vspec)
_vspec.loader.exec_module(_vmod)
check_parent_wiki = _vmod.check_parent_wiki
```

Append the test (uses `_make_repo`, `_kg_with_page`, `_dg_with_domain` from earlier tasks):

```python
class TestGateAcceptsRealAggregate:
    def test_real_aggregate_satisfies_frontend_batch_gate(self, tmp_path):
        web = tmp_path / "web"
        web.mkdir()
        _make_repo(web, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(web, "admin",
                   kg=_kg_with_page("admin", "src/pages/permissions/Index.tsx"),
                   dg=_dg_with_domain("domain:permission", "Permission"))
        build_frontend_graph(str(web))
        assert (web / ".understand-anything" / "frontend-graph.json").exists()
        errors, _ = check_parent_wiki(web, "frontend")
        assert not any("frontend-graph.json" in e for e in errors)
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `python3 -m pytest tests/understand-wiki/test_build_frontend_graph.py::TestGateAcceptsRealAggregate -v`
Expected: 1 passed. (The aggregate writes to `web/.understand-anything/frontend-graph.json`; the gate finds it. Other parent-wiki errors may exist but none mention `frontend-graph.json`.)

- [ ] **Step 3: Run the whole wiki test suite (full regression)**

Run: `python3 -m pytest tests/understand-wiki/ -v`
Expected: all pass — `test_build_frontend_graph.py`, `test_build_client_graph.py`, and `test_verify_completeness.py` (including the existing `test_frontend_batch_*` gate tests).

- [ ] **Step 4: Commit**

```bash
git add tests/understand-wiki/test_build_frontend_graph.py
git commit -m "test(wiki): end-to-end gate accepts real frontend aggregate"
```

---

## Self-Review notes (resolved during planning)

- **Single-repo `project.name`:** the original script copied `project.name` from the KG. The rewrite preserves this for a one-repo facet (`len(per_repo) == 1`) and only uses `root.name` for true aggregates — keeps `test_project_metadata_copied_from_kg` and `test_single_repo_backward_compat` green.
- **Missing-graph error message:** the two original tests `test_missing_kg_raises_file_not_found` / `test_missing_dg_raises_file_not_found` match on the substrings `knowledge-graph.json` / `domain-graph.json`. The new `FileNotFoundError` message contains both substrings, so both stay green (KG-missing → discovered as single repo then `_extract_repo` returns None → empty `per_repo` → raise; DG-missing → not discovered → empty `per_repo` → raise).
- **WARN vs silent skip:** discovery keys on `domain-graph.json`, so a subdir with no DG is "not a repo" and is skipped silently (correct — arbitrary dirs shouldn't warn). The WARN path is a *discovered* repo (has DG) missing its KG — covered by `test_missing_sub_repo_kg_is_skipped_with_warn`.
- **Two dedup semantics for apiCalls:** top-level `apiCalls` dedup by `(repo, method, path)` to preserve cross-repo provenance; feature-level `_union_api_calls` dedup by `(method, path)` since the merged feature is repo-agnostic. Intentional.
- **No `workflow.js` / `verify-wiki-completeness.py` edits:** both already reference `frontend-graph.json` (confirmed at `workflow.js:863-864` and `verify-wiki-completeness.py:138-143`).

## Out of scope (Spec 2)

`consolidate_frontend`, the client-facet strategy registry, the server-domain-anchored `serverIndex`, and the bounded LLM review pass all live in the separate Spec 2 plan and consume the `frontend-graph.json` this plan produces.
