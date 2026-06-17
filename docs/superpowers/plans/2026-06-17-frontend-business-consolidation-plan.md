# Frontend Business Consolidation + Server-Anchored Unification (Spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `understand-business` treat `frontend` as a peer client facet via a single client-facet strategy registry, anchor cross-client unification on shared backend domains (`serverIndex` touchpoints), and refine those groupings with one bounded LLM review pass.

**Architecture:** A new `client_facets.py` module owns per-facet-type consolidation (`consolidate_mobile`, `consolidate_frontend`) behind one `load_client_features(project_root, facet)` dispatch. The two existing consumers (`association_discovery.py`, `assemble_business_features.py`) stop reimplementing frontend loading and call the registry instead. `_merge_server_associations` is enriched to emit per-domain `touchpoints[]` (the deterministic server-anchored join), and a new `capability_review.py` labels multi-facet domains with an LLM (degrading to mechanical labels). All `business-features.json` additions are additive.

**Tech Stack:** Python 3 stdlib, the existing `_call_llm` placeholder convention (overridden by the agent in production), pytest under `tests/understand-business/`.

**Spec:** `docs/superpowers/specs/2026-06-17-frontend-business-consolidation-design.md`. Consumes the `frontend-graph.json` aggregate produced by Spec 1 (already merged & committed on this branch).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `understand-anything-plugin/skills/understand-business/client_facets.py` | Per-facet-type consolidation strategies + single dispatch point (`load_client_features`). Owns the only frontend loader. | **Create** (Task 1) |
| `understand-anything-plugin/skills/understand-business/association_discovery.py` | Phase 2 association discovery. Refactor to dispatch through the registry; delete the duplicate `_load_frontend_features` and the mobile/frontend `if/elif` ladder. | Modify (Task 2) |
| `understand-anything-plugin/skills/understand-business/assemble_business_features.py` | Phase 4b assembly. Dispatch through the registry (Task 2); emit `serverIndex[domain].touchpoints` + `clientLayers[].units` (Task 3). | Modify (Tasks 2, 3) |
| `understand-anything-plugin/skills/understand-business/capability_review.py` | Bounded LLM capability review over the deterministic `serverIndex`. | **Create** (Task 4) |
| `understand-anything-plugin/skills/understand-business/SKILL.md` | Document the `capability_review` step in the feature-centric path + pipeline table. | Modify (Task 5) |
| `tests/understand-business/test_client_facets.py` | Registry + `consolidate_frontend` tests. | **Create** (Task 1) |
| `tests/understand-business/test_registry_dispatch.py` | De-dup regression: both consumers route through the registry. | **Create** (Task 2) |
| `tests/understand-business/test_association_discovery_frontend.py` | Old direct `_load_frontend_features` tests. | **Delete** (Task 2 — coverage moves to `test_client_facets.py`) |
| `tests/understand-business/test_server_index_touchpoints.py` | `serverIndex` touchpoints + `clientLayers[].units`. | **Create** (Task 3) |
| `tests/understand-business/test_capability_review.py` | Bounded LLM capability review + degradation. | **Create** (Task 4) |
| `tests/understand-business/test_business_features_backward_compat.py` | Mobile-only regression: additive-only keys. | **Create** (Task 5) |

**Import convention (already used by these modules):** `tests/understand-business/conftest.py` puts the `understand-business` skills dir on `sys.path`, so tests and modules import siblings directly (`from client_facets import ...`, `from domain_matcher import ...`). No `importlib` gymnastics needed — these modules have underscore names (unlike Spec 1's hyphenated `build-frontend-graph.py`).

**Test command (run from worktree root):**
```bash
python3 -m pytest tests/understand-business/ understand-anything-plugin/skills/understand-business/tests/ -q
```
Both directories must stay green — the second holds the pre-existing assembler/consolidation tests that constrain the refactor.

---

## Task 1: `client_facets.py` — strategy registry + `consolidate_frontend`

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/client_facets.py`
- Test: `tests/understand-business/test_client_facets.py`

Implements Spec Components 1 & 2. `consolidate_frontend` reads `frontend-graph.json` (Spec 1 aggregate) and returns the standard `{consolidated, standalone, infrastructure}` shape so downstream is uniform with mobile. `consolidate_mobile` just delegates to the existing `_consolidate_mobile_domains` (no reimplementation). The registry exposes one `load_client_features` dispatch.

- [ ] **Step 1: Write the failing tests**

Create `tests/understand-business/test_client_facets.py`:

```python
"""Tests for client_facets.py — strategy registry + consolidate_frontend (Spec 2 Component 1 & 2)."""
import json
from pathlib import Path

import pytest

from client_facets import (
    consolidate_frontend,
    load_client_features,
    CLIENT_STRATEGIES,
)


def _write_frontend_graph(project_root: Path, features: list, frameworks=None, facet_path="frontend"):
    """Write a minimal frontend-graph.json under <root>/<facet_path>/.understand-anything/."""
    fe_ua = project_root / facet_path / ".understand-anything"
    fe_ua.mkdir(parents=True, exist_ok=True)
    fg = {
        "version": "1.0.0",
        "facetType": "frontend",
        "project": {"name": "web", "frameworks": frameworks or ["react", "vite"]},
        "features": features,
    }
    (fe_ua / "frontend-graph.json").write_text(json.dumps(fg), encoding="utf-8")


def _feat(name, source_repos=None, routes=None, api_calls=None):
    return {
        "id": f"feature:{name}",
        "name": name,
        "sourceRepos": source_repos if source_repos is not None else [],
        "routes": routes or [],
        "apiCalls": api_calls or [],
        "pages": [],
        "components": [],
        "stateStores": [],
    }


class TestConsolidateFrontend:
    def test_reads_features_into_consolidated(self, tmp_path):
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app"],
                  routes=["/orders"],
                  api_calls=[{"method": "GET", "path": "/api/orders"}]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert set(result.keys()) == {"consolidated", "standalone", "infrastructure"}
        assert result["standalone"] == []
        assert len(result["consolidated"]) == 1
        entry = result["consolidated"][0]
        assert entry["name"] == "Order Management"
        assert entry["implType"] == "frontend-web"
        assert entry["platforms"] == ["web"]
        assert entry["facetType"] == "frontend"
        assert "react" in entry["deliveryPlatforms"]
        assert "/orders" in entry["mergedSummary"]
        assert "GET /api/orders" in entry["mergedSummary"]

    def test_multi_repo_feature_yields_one_implementation_per_repo(self, tmp_path):
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app", "admin"]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        impls = result["consolidated"][0]["implementations"]
        assert impls == [
            {"platform": "web", "repo": "web-app"},
            {"platform": "web", "repo": "admin"},
        ]
        assert result["consolidated"][0]["sourceRepos"] == ["web-app", "admin"]

    def test_single_repo_feature_has_single_implementation(self, tmp_path):
        _write_frontend_graph(tmp_path, [_feat("Checkout", source_repos=["web-app"])])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        impls = result["consolidated"][0]["implementations"]
        assert impls == [{"platform": "web", "repo": "web-app"}]

    def test_infra_named_feature_lands_in_infrastructure(self, tmp_path):
        _write_frontend_graph(tmp_path, [
            _feat("Order Management", source_repos=["web-app"]),
            _feat("Layout", source_repos=["web-app"]),
            _feat("ThemeProvider", source_repos=["web-app"]),
        ])
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        consolidated_names = {e["name"] for e in result["consolidated"]}
        infra_names = {e["name"] for e in result["infrastructure"]}
        assert "Order Management" in consolidated_names
        assert "Layout" in infra_names
        assert "ThemeProvider" in infra_names
        assert "Layout" not in consolidated_names

    def test_missing_frontend_graph_returns_empty(self, tmp_path):
        (tmp_path / "frontend").mkdir()
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_corrupt_frontend_graph_returns_empty(self, tmp_path):
        fe_ua = tmp_path / "frontend" / ".understand-anything"
        fe_ua.mkdir(parents=True)
        (fe_ua / "frontend-graph.json").write_text("{ not json", encoding="utf-8")
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}

    def test_absolute_facet_path_rejected_by_traversal_guard(self, tmp_path):
        result = consolidate_frontend(str(tmp_path), {"type": "frontend", "path": "/etc"})
        assert result == {"consolidated": [], "standalone": [], "infrastructure": []}


class TestLoadClientFeaturesDispatch:
    def test_frontend_dispatches_to_frontend_shape(self, tmp_path):
        _write_frontend_graph(tmp_path, [_feat("Orders", source_repos=["web-app"])])
        result = load_client_features(str(tmp_path), {"type": "frontend", "path": "frontend/"})
        assert result is not None
        assert result["consolidated"][0]["implType"] == "frontend-web"

    def test_mobile_dispatches_to_mobile_shape(self, tmp_path):
        # No client-graph / wiki present → empty consolidation, but a valid mobile-shaped dict.
        (tmp_path / "mobile").mkdir()
        result = load_client_features(
            str(tmp_path), {"type": "mobile", "path": "mobile/", "subPaths": []}
        )
        assert result is not None
        assert set(result.keys()) == {"consolidated", "standalone", "infrastructure"}

    def test_unknown_type_returns_none(self, tmp_path):
        result = load_client_features(str(tmp_path), {"type": "desktop", "path": "desktop/"})
        assert result is None

    def test_registry_has_mobile_and_frontend(self):
        assert set(CLIENT_STRATEGIES.keys()) == {"mobile", "frontend"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/understand-business/test_client_facets.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'client_facets'`.

- [ ] **Step 3: Create `client_facets.py`**

Create `understand-anything-plugin/skills/understand-business/client_facets.py`:

```python
#!/usr/bin/env python3
"""Client-facet strategy registry (Spec 2 Component 1 & 2).

Gives every client facet type a single
`(project_root, facet) -> {consolidated, standalone, infrastructure}` entry
point so the rest of the business pipeline never branches on facet type.
Adding a new client facet type = register one strategy here, zero pipeline edits.
"""
import json
from pathlib import Path

from domain_matcher import _consolidate_mobile_domains

# Conservative frontend-infrastructure keywords. Most infra is already excluded
# upstream by frontend-flow.md; this is a backstop for anything that slips through.
_FRONTEND_INFRA_KEYWORDS = (
    'layout', 'theme', 'i18n', 'locale', 'error-boundary',
    'loading', 'toast', 'modal-shell', 'provider',
)


def consolidate_mobile(project_root: str, facet: dict) -> dict:
    """Mobile consolidation — delegates to the existing domain_matcher logic."""
    return _consolidate_mobile_domains(
        project_root, facet['path'], facet.get('subPaths', [])
    )


def _summarize(feat: dict) -> str:
    """Build a one-line summary from a frontend feature's routes + API calls.

    Uses the safe `.get` defaults that were patched into the original loaders in
    review (`method` defaults to 'UNKNOWN', `path` to '').
    """
    routes = feat.get('routes', [])
    calls = feat.get('apiCalls', [])
    parts = []
    if routes:
        parts.append('Routes: ' + ', '.join(routes[:3]))
    if calls:
        parts.append('API: ' + ', '.join(
            f"{c.get('method', 'UNKNOWN')} {c.get('path', '')}" for c in calls[:3]
        ))
    return '. '.join(parts)


def _is_frontend_infra(name: str) -> bool:
    lowered = name.lower()
    return any(kw in lowered for kw in _FRONTEND_INFRA_KEYWORDS)


def consolidate_frontend(project_root: str, facet: dict) -> dict:
    """Read frontend-graph.json (Spec 1 aggregate) → {consolidated, standalone, infrastructure}.

    Missing/unparseable graph or a facet path that escapes the project root →
    empty consolidation (graceful; matches the prior loader's fallback).
    """
    empty = {'consolidated': [], 'standalone': [], 'infrastructure': []}
    root = Path(project_root).resolve()
    fg_path = (
        root / facet.get('path', '') /
        '.understand-anything' / 'frontend-graph.json'
    ).resolve()
    if not fg_path.is_relative_to(root):
        return empty
    if not fg_path.is_file():
        return empty
    try:
        fg = json.loads(fg_path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return empty

    frameworks = fg.get('project', {}).get('frameworks', [])
    consolidated = []
    infrastructure = []
    for feat in fg.get('features', []):
        name = feat.get('name', '')
        if _is_frontend_infra(name):
            infrastructure.append({
                'name': name,
                'implType': 'infrastructure',
                'platforms': ['web'],
                'deliveryPlatforms': frameworks,
                'facetType': 'frontend',
            })
            continue
        source_repos = feat.get('sourceRepos', [])
        consolidated.append({
            'name': name,
            'implType': 'frontend-web',
            'platforms': ['web'],
            'deliveryPlatforms': frameworks,
            'implementations': [
                {'platform': 'web', 'repo': r} for r in source_repos
            ],
            'mergedSummary': _summarize(feat),
            'facetType': 'frontend',
            'sourceRepos': source_repos,
        })
    return {
        'consolidated': consolidated,
        'standalone': [],
        'infrastructure': infrastructure,
    }


CLIENT_STRATEGIES = {
    'mobile': consolidate_mobile,
    'frontend': consolidate_frontend,
}


def load_client_features(project_root: str, facet: dict) -> dict | None:
    """Return {consolidated, standalone, infrastructure}, or None if unsupported."""
    strategy = CLIENT_STRATEGIES.get(facet.get('type'))
    return strategy(project_root, facet) if strategy else None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/understand-business/test_client_facets.py -q`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/client_facets.py tests/understand-business/test_client_facets.py
git commit -m "$(cat <<'EOF'
feat(business): add client-facet strategy registry + consolidate_frontend

Spec 2 Component 1 & 2: single load_client_features() dispatch over
per-facet-type consolidation; frontend reads frontend-graph.json into the
standard {consolidated, standalone, infrastructure} shape.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Route both consumers through the registry (delete duplicate frontend loader)

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/association_discovery.py` (delete `_load_frontend_features` at lines 261-296; rewrite the dispatch loop at lines 334-353; adjust the `domain_matcher` import at line 313)
- Modify: `understand-anything-plugin/skills/understand-business/assemble_business_features.py` (rewrite the facet loop at lines 198-245; adjust the `domain_matcher` import at line 187)
- Create: `tests/understand-business/test_registry_dispatch.py`
- Delete: `tests/understand-business/test_association_discovery_frontend.py` (tested the now-deleted `_load_frontend_features`; coverage moved to `test_client_facets.py` in Task 1)

This is Spec Component 1's DRY fix: frontend loading exists once (in `client_facets`); mobile loading is called, not reimplemented. Both consumers dispatch through `load_client_features`. Behavior must be unchanged for mobile and frontend feature pools.

- [ ] **Step 1: Write the failing regression test**

Create `tests/understand-business/test_registry_dispatch.py`:

```python
"""De-dup regression: association_discovery and assemble both route frontend
through the registry, so their frontend feature pools cannot drift (Spec 2 test 6)."""
import json
from pathlib import Path

import pytest

import association_discovery
import assemble_business_features
from association_discovery import run_association_discovery
from assemble_business_features import run_assemble_features


@pytest.fixture
def project_with_server_and_frontend(tmp_path):
    """A project root with a backend facet (no domains) and a frontend facet."""
    ua = tmp_path / ".understand-anything"
    ua.mkdir()
    system = {
        "facets": [
            {"name": "api", "type": "backend", "path": "backend/", "subPaths": []},
            {"name": "web", "type": "frontend", "path": "frontend/"},
        ]
    }
    (ua / "system.json").write_text(json.dumps(system), encoding="utf-8")
    (tmp_path / "backend" / ".understand-anything").mkdir(parents=True)

    fe_ua = tmp_path / "frontend" / ".understand-anything"
    fe_ua.mkdir(parents=True)
    fg = {
        "version": "1.0.0",
        "facetType": "frontend",
        "project": {"name": "web", "frameworks": ["react"]},
        "features": [
            {"id": "feature:orders", "name": "Order Management", "sourceRepos": ["web-app"],
             "routes": ["/orders"], "apiCalls": [{"method": "GET", "path": "/api/orders"}],
             "pages": [], "components": [], "stateStores": []},
            {"id": "feature:profile", "name": "User Profile", "sourceRepos": ["web-app"],
             "routes": ["/profile"], "apiCalls": [], "pages": [], "components": [], "stateStores": []},
        ],
    }
    (fe_ua / "frontend-graph.json").write_text(json.dumps(fg), encoding="utf-8")
    return tmp_path


def test_loader_was_deleted_from_association_discovery():
    """The duplicate frontend loader must be gone — there is one loader, in client_facets."""
    assert not hasattr(association_discovery, "_load_frontend_features")


def test_both_paths_reference_the_registry():
    # Both consumers import load_client_features inside their run_* functions
    # (matching the existing local-import style), so assert against source text.
    assoc_src = Path(association_discovery.__file__).read_text(encoding="utf-8")
    asm_src = Path(assemble_business_features.__file__).read_text(encoding="utf-8")
    assert "load_client_features" in assoc_src
    assert "load_client_features" in asm_src
    # The duplicate frontend loader is gone from association_discovery.
    assert "_load_frontend_features" not in assoc_src


def test_frontend_feature_pools_match_across_paths(project_with_server_and_frontend):
    root = str(project_with_server_and_frontend)

    # association_discovery's pool (LLM is not configured → each feature errors but is
    # still recorded with its featureName).
    assoc_out = run_association_discovery(root)
    assoc_names = {a["featureName"] for a in assoc_out["associations"]}

    # assemble re-derives the consolidation via the same registry and builds one
    # feature doc per association.
    asm_out = run_assemble_features(root)
    asm_names = {f["name"] for f in asm_out["features"]}

    assert assoc_names == {"Order Management", "User Profile"}
    assert assoc_names == asm_names
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/understand-business/test_registry_dispatch.py -q`
Expected: FAIL — `test_loader_was_deleted_from_association_discovery` fails (`_load_frontend_features` still present).

- [ ] **Step 3: Refactor `association_discovery.py`**

Change the import at line 313 — drop `_consolidate_mobile_domains` (now reached via the registry), keep `_load_server_domains`, and add the registry import:

```python
    from domain_matcher import _load_server_domains
    from scenario_detector import CLIENT_FACET_TYPES
    from client_facets import load_client_features
```

Delete the entire `_load_frontend_features` function (lines 261-296).

Replace the dispatch loop (currently lines 334-353, the `for client_facet in client_facets:` block with the mobile/frontend `if/elif/else`) with:

```python
    # Consolidate features from all client facets through the strategy registry.
    all_features = []
    unsupported_facets = []
    for client_facet in client_facets:
        c = load_client_features(project_root_str, client_facet)
        if c is None:
            unsupported_facets.append(client_facet.get('name', client_facet.get('type')))
            continue
        all_features.extend(c['consolidated'])
        all_features.extend([
            {'name': d['name'], 'implType': d.get('implType', ''),
             'platforms': [d.get('platform', '')],
             'deliveryPlatforms': d.get('deliveryPlatforms', []),
             'mergedSummary': d.get('summary', '')}
            for d in c['standalone']
        ])
```

(This generic standalone-flattening is identical to the old mobile branch for mobile facets, and a no-op for frontend whose `standalone` is always `[]`.)

- [ ] **Step 4: Refactor `assemble_business_features.py`**

Change the import at line 187 — replace the `domain_matcher` import with the registry import:

```python
    # Re-derive consolidation through the client-facet strategy registry.
    from client_facets import load_client_features
```

Replace the facet loop (currently lines 198-245, the `for facet in system_config.get('facets', []):` block with the mobile/frontend branches) with:

```python
    consolidation = {'consolidated': [], 'standalone': [], 'infrastructure': []}
    for facet in system_config.get('facets', []):
        c = load_client_features(project_root_str, facet)
        if c is None:
            continue
        facet_type = facet.get('type', '')
        for item in c['consolidated']:
            item.setdefault('facetType', facet_type)
        for item in c['standalone']:
            item.setdefault('facetType', facet_type)
        consolidation['consolidated'].extend(c['consolidated'])
        consolidation['standalone'].extend(c['standalone'])
        consolidation['infrastructure'].extend(c['infrastructure'])
```

(`setdefault` preserves frontend's pre-set `facetType='frontend'` and stamps `'mobile'` on mobile entries — exactly as the old `item.setdefault('facetType', 'mobile')` did, now generalized across facet types. Server/backend facets return `None` and are skipped.)

- [ ] **Step 5: Delete the obsolete test file**

```bash
git rm tests/understand-business/test_association_discovery_frontend.py
```

- [ ] **Step 6: Run the full business suite to verify pass**

Run: `python3 -m pytest tests/understand-business/ understand-anything-plugin/skills/understand-business/tests/ -q`
Expected: PASS. `test_registry_dispatch.py` passes; the pre-existing assembler/consolidation/association tests still pass (behavior unchanged); the deleted file no longer collected.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/association_discovery.py understand-anything-plugin/skills/understand-business/assemble_business_features.py tests/understand-business/test_registry_dispatch.py
git commit -m "$(cat <<'EOF'
refactor(business): route client facets through the strategy registry

Spec 2 Component 1 DRY fix: delete the duplicate _load_frontend_features and
the mobile/frontend if/elif ladders in association_discovery and
assemble_business_features; both now dispatch through
client_facets.load_client_features. Removes the historic frontend-loader drift.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server-anchored `serverIndex` touchpoints + `clientLayers[].units`

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/assemble_business_features.py` (`_merge_server_associations` at lines 91-118; `assemble_features` at lines 121-167; `_build_feature_document` at lines 23-88)
- Create: `tests/understand-business/test_server_index_touchpoints.py`

Implements Spec Component 3. Each `serverIndex` domain gains `touchpoints[]` (`{feature, facet, role}`) — the deterministic server-anchored join that surfaces co-touching features together. Each `clientLayers[]` entry gains `units` (keyed by platforms for mobile, repos for web). Legacy `features[]` / `refCount` / `service` / `platforms` / `clientLayer` are all retained.

- [ ] **Step 1: Write the failing tests**

Create `tests/understand-business/test_server_index_touchpoints.py`:

```python
"""serverIndex touchpoints + clientLayers[].units (Spec 2 Component 3, tests 7-9)."""
import pytest

from assemble_business_features import assemble_features, _merge_server_associations


def _assoc(feature_name, primary, supporting=None):
    return {
        "featureName": feature_name,
        "primaryServer": primary,
        "supportingServers": supporting or [],
        "error": None,
    }


def _frontend(name, repos):
    return {
        "name": name, "implType": "frontend-web", "platforms": ["web"],
        "deliveryPlatforms": ["react"],
        "implementations": [{"platform": "web", "repo": r} for r in repos],
        "mergedSummary": f"Routes: /{name}", "facetType": "frontend",
        "sourceRepos": repos,
    }


def _mobile(name, platforms):
    return {
        "name": name, "implType": "cross-platform", "platforms": platforms,
        "deliveryPlatforms": platforms,
        "implementations": [{"platform": p, "domainName": name, "domainId": name, "summary": ""} for p in platforms],
        "mergedSummary": "", "facetType": "mobile",
    }


class TestTouchpoints:
    def test_shared_domain_gets_two_touchpoints_with_facet_and_role(self):
        assoc = [
            _assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
            _assoc("订单跟踪", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
        ]
        consol = {
            "consolidated": [_frontend("下单创建", ["web-app"]), _mobile("订单跟踪", ["ios"])],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        entry = result["serverIndex"]["OrderService"]
        tps = {(t["feature"], t["facet"], t["role"]) for t in entry["touchpoints"]}
        assert tps == {("下单创建", "frontend", "primary"), ("订单跟踪", "mobile", "primary")}

    def test_complementary_split_groups_under_shared_domain(self):
        # web "下单创建" → primary Order; mobile "订单跟踪" → primary Order + supporting Push.
        assoc = [
            _assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9}),
            _assoc("订单跟踪", {"domain": "OrderService", "service": "order", "confidence": 0.9},
                   supporting=[{"domain": "PushService", "service": "push",
                                "relationship": "calls", "confidence": 0.8}]),
        ]
        consol = {
            "consolidated": [_frontend("下单创建", ["web-app"]), _mobile("订单跟踪", ["ios"])],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        order_features = {t["feature"] for t in result["serverIndex"]["OrderService"]["touchpoints"]}
        assert order_features == {"下单创建", "订单跟踪"}
        push = result["serverIndex"]["PushService"]
        assert push["touchpoints"][0] == {"feature": "订单跟踪", "facet": "mobile", "role": "supporting"}

    def test_legacy_serverindex_fields_retained(self):
        assoc = [_assoc("下单创建", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_frontend("下单创建", ["web-app"])], "standalone": []}
        entry = assemble_features(assoc, consol)["serverIndex"]["OrderService"]
        assert entry["features"] == ["下单创建"]
        assert entry["refCount"] == 1
        assert entry["service"] == "order"

    def test_unknown_feature_facet_is_unknown(self):
        # association references a feature not present in consolidation.
        assoc = [_assoc("Ghost", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [], "standalone": []}
        entry = assemble_features(assoc, consol)["serverIndex"]["OrderService"]
        assert entry["touchpoints"][0]["facet"] == "unknown"

    def test_merge_server_associations_default_facet_map(self):
        # Called with one positional arg (as the pre-existing tests do) → facet "unknown", no crash.
        index = _merge_server_associations([_assoc("X", {"domain": "D", "service": "s", "confidence": 0.9})])
        assert index["D"]["touchpoints"][0]["facet"] == "unknown"
        assert index["D"]["refCount"] == 1


class TestClientLayerUnits:
    def test_web_units_keyed_by_repos(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_frontend("Orders", ["web-app", "admin"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["units"].keys()) == {"web-app", "admin"}

    def test_mobile_units_keyed_by_platforms(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_mobile("Orders", ["ios", "android"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert set(layer["units"].keys()) == {"ios", "android"}

    def test_platforms_dict_still_present(self):
        assoc = [_assoc("Orders", {"domain": "OrderService", "service": "order", "confidence": 0.9})]
        consol = {"consolidated": [_mobile("Orders", ["ios"])], "standalone": []}
        layer = assemble_features(assoc, consol)["features"][0]["clientLayers"][0]
        assert "ios" in layer["platforms"]
        assert "units" in layer
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/understand-business/test_server_index_touchpoints.py -q`
Expected: FAIL — `KeyError: 'touchpoints'` / `KeyError: 'units'` (fields not yet emitted).

- [ ] **Step 3: Rewrite `_merge_server_associations` (lines 91-118)**

```python
def _merge_server_associations(associations: list, facet_map: dict | None = None) -> dict:
    """Build reverse index: server domain → the client features that depend on it.

    Each domain entry carries:
      - features[]: legacy feature-name list (retained for backward compat)
      - refCount, service: retained for backward compat
      - touchpoints[]: {feature, facet, role}, role ∈ {primary, supporting} — the
        server-anchored join. Indexing primary ∪ supporting under each domain
        already co-locates features that touch the same backend domain.

    facet_map maps featureName → facetType; unknown names resolve to "unknown".
    """
    facet_map = facet_map or {}
    index: dict = {}

    def _ensure(domain: str, service: str) -> dict:
        if domain not in index:
            index[domain] = {'features': [], 'refCount': 0, 'service': service, 'touchpoints': []}
        return index[domain]

    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')
        facet = facet_map.get(feature_name, 'unknown')

        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            domain = primary.get('domain', '')
            if domain:
                entry = _ensure(domain, primary.get('service', ''))
                entry['features'].append(feature_name)
                entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'primary'}
                )

        for s in (assoc.get('supportingServers') or []):
            if not isinstance(s, dict):
                continue
            domain = s.get('domain', '')
            if domain:
                entry = _ensure(domain, s.get('service', ''))
                if feature_name not in entry['features']:
                    entry['features'].append(feature_name)
                    entry['refCount'] += 1
                entry['touchpoints'].append(
                    {'feature': feature_name, 'facet': facet, 'role': 'supporting'}
                )

    return index
```

- [ ] **Step 4: Build `facet_map` in `assemble_features` and pass it through (lines 121-167)**

In `assemble_features`, while building `feature_lookup`, also build a `featureName → facetType` map, and pass it to `_merge_server_associations`. Replace the lookup-building block and the `server_index = _merge_server_associations(associations)` call:

```python
def assemble_features(associations: list, consolidation: dict) -> dict:
    """Assemble feature-centric documents from associations and consolidation data."""
    # Build name→[feature_data] lookup; list supports multiple facets per feature name.
    feature_lookup: dict = {}
    facet_map: dict = {}
    for f in consolidation.get('consolidated', []):
        feature_lookup.setdefault(f['name'], []).append(f)
        facet_map.setdefault(f['name'], f.get('facetType', 'unknown'))
    for f in consolidation.get('standalone', []):
        feature_lookup.setdefault(f['name'], []).append({
            'name': f['name'],
            'implType': f.get('implType', 'native-specific'),
            'platforms': [f.get('platform', '')],
            'deliveryPlatforms': f.get('deliveryPlatforms', []),
            'implementations': [],
            'mergedSummary': '',
            'facetType': f.get('facetType', 'mobile'),
        })
        facet_map.setdefault(f['name'], f.get('facetType', 'mobile'))
```

…and further down, replace:

```python
    server_index = _merge_server_associations(associations)
```

with:

```python
    server_index = _merge_server_associations(associations, facet_map)
```

(The `features`/`with_association`/`stats` block in between is unchanged.)

- [ ] **Step 5: Add `units` to `_build_feature_document` (lines 37-54)**

Replace the per-`fd` loop body that builds `platforms_dict` and appends to `client_layers`:

```python
    client_layers = []
    for fd in feature_data_list:
        facet_type = fd.get('facetType', 'mobile')
        platforms_dict = {}
        units = {}
        for impl in fd.get('implementations', []):
            platform = impl.get('platform', '')
            platforms_dict[platform] = {k: v for k, v in impl.items() if k != 'platform'}
            unit_key = impl.get('repo', '') if facet_type == 'frontend' else platform
            if unit_key:
                units[unit_key] = {k: v for k, v in impl.items() if k not in ('platform', 'repo')}
        if not platforms_dict:
            for p in fd.get('platforms', []):
                platforms_dict[p] = {}
        client_layers.append({
            'facetType': facet_type,
            'implType': fd.get('implType', 'unknown'),
            'platforms': platforms_dict,
            'units': units,
            'deliveryPlatforms': fd.get('deliveryPlatforms', []),
            'summary': fd.get('mergedSummary', ''),
        })
```

(For mobile, `units` keys == platforms (no `repo` in impls). For web, `units` keys == repos. `platforms` and the backward-compat `clientLayer = clientLayers[0]` are untouched.)

- [ ] **Step 6: Run the suite to verify pass**

Run: `python3 -m pytest tests/understand-business/ understand-anything-plugin/skills/understand-business/tests/ -q`
Expected: PASS. New touchpoints/units tests pass; pre-existing `test_feature_assembler.py` (calls `_merge_server_associations(results)` with one arg, asserts `features`/`refCount`) and `test_assemble_client_layers.py` still pass.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/assemble_business_features.py tests/understand-business/test_server_index_touchpoints.py
git commit -m "$(cat <<'EOF'
feat(business): server-anchored serverIndex touchpoints + clientLayers units

Spec 2 Component 3: each serverIndex domain carries touchpoints[] {feature,
facet, role} (the deterministic server-domain join), and each clientLayers[]
entry carries units keyed by platforms (mobile) or repos (web). Legacy
features/refCount/service/platforms/clientLayer retained — additive only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `capability_review.py` — bounded LLM capability review

**Files:**
- Create: `understand-anything-plugin/skills/understand-business/capability_review.py`
- Test: `tests/understand-business/test_capability_review.py`

Implements Spec Component 4. A candidate→verify pass over the deterministic `serverIndex`: runs the LLM only for domains with ≥2 touchpoints across ≥2 facets; everything else gets a mechanical label. Degrades to mechanical labels when no LLM is configured or a response is malformed. Caches per `(domain + sorted touchpoint identities)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/understand-business/test_capability_review.py`:

```python
"""Bounded LLM capability review (Spec 2 Component 4, tests 10-13)."""
import json
from pathlib import Path

import pytest

import capability_review
from capability_review import (
    run_capability_review,
    parse_review_response,
    build_review_prompt,
)


def _write_business_features(root: Path, server_index: dict):
    out = root / ".understand-anything" / "business-landscape"
    out.mkdir(parents=True, exist_ok=True)
    data = {"features": [], "serverIndex": server_index, "stats": {}}
    (out / "business-features.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return out / "business-features.json"


def _multi_facet_index():
    return {
        "OrderService": {
            "features": ["下单创建", "订单跟踪"], "refCount": 2, "service": "order",
            "touchpoints": [
                {"feature": "下单创建", "facet": "frontend", "role": "primary"},
                {"feature": "订单跟踪", "facet": "mobile", "role": "primary"},
            ],
        }
    }


@pytest.fixture(autouse=True)
def _restore_llm():
    """Each test may monkeypatch _call_llm; restore the placeholder afterwards."""
    original = capability_review._call_llm
    yield
    capability_review._call_llm = original


class TestParseReviewResponse:
    def test_valid_response_parsed(self):
        resp = json.dumps({"label": "订单管理", "relationship": "complementary-split",
                           "summary": "web 创建;mobile 跟踪", "flagged": []})
        result = parse_review_response(resp, "OrderService")
        assert result["label"] == "订单管理"
        assert result["relationship"] == "complementary-split"
        assert result["summary"]

    def test_shared_infrastructure_keeps_domain_name_as_label(self):
        resp = json.dumps({"label": "登录", "relationship": "shared-infrastructure", "summary": "共享鉴权"})
        result = parse_review_response(resp, "AuthService")
        assert result["label"] == "AuthService"  # must NOT assert one capability
        assert result["relationship"] == "shared-infrastructure"

    def test_malformed_response_degrades(self):
        result = parse_review_response("not json at all", "OrderService")
        assert result["label"] == "OrderService"
        assert result["relationship"] == "unknown"

    def test_unknown_relationship_normalized(self):
        resp = json.dumps({"label": "X", "relationship": "made-up", "summary": ""})
        assert parse_review_response(resp, "D")["relationship"] == "unknown"


class TestRunCapabilityReview:
    def test_multi_facet_domain_enriched_by_llm(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split",
            "summary": "web 创建;mobile 跟踪", "flagged": [],
        })
        run_capability_review(str(tmp_path))
        data = json.loads(bf.read_text(encoding="utf-8"))
        cap = data["serverIndex"]["OrderService"]["capability"]
        assert cap == {"label": "订单管理", "relationship": "complementary-split",
                       "summary": "web 创建;mobile 跟踪"}

    def test_no_llm_degrades_to_mechanical(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        # default _call_llm raises NotImplementedError → mechanical fallback
        run_capability_review(str(tmp_path))
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["capability"]
        assert cap["label"] == "OrderService"
        assert cap["relationship"] == "unknown"

    def test_single_facet_domain_skips_llm(self, tmp_path):
        index = {
            "AuthService": {
                "features": ["登录", "登出"], "refCount": 2, "service": "auth",
                "touchpoints": [
                    {"feature": "登录", "facet": "mobile", "role": "primary"},
                    {"feature": "登出", "facet": "mobile", "role": "primary"},
                ],
            }
        }
        bf = _write_business_features(tmp_path, index)
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(prompt) or "{}"
        run_capability_review(str(tmp_path))
        assert calls == []  # single-facet → no LLM cost
        cap = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["AuthService"]["capability"]
        assert cap["label"] == "AuthService"
        assert cap["relationship"] == "unknown"

    def test_flagged_touchpoint_annotated_not_deleted(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        capability_review._call_llm = lambda prompt: json.dumps({
            "label": "订单管理", "relationship": "complementary-split", "summary": "x",
            "flagged": [{"feature": "订单跟踪", "reason": "weak association"}],
        })
        run_capability_review(str(tmp_path))
        tps = json.loads(bf.read_text(encoding="utf-8"))["serverIndex"]["OrderService"]["touchpoints"]
        assert len(tps) == 2  # nothing deleted
        flagged = next(t for t in tps if t["feature"] == "订单跟踪")
        assert flagged["flagged"]["reason"] == "weak association"

    def test_caching_skips_unchanged_domain(self, tmp_path):
        bf = _write_business_features(tmp_path, _multi_facet_index())
        calls = []
        capability_review._call_llm = lambda prompt: calls.append(1) or json.dumps(
            {"label": "订单管理", "relationship": "complementary-split", "summary": "x", "flagged": []})
        run_capability_review(str(tmp_path))   # first run → 1 LLM call
        run_capability_review(str(tmp_path))   # second run → unchanged → reuse, no call
        assert len(calls) == 1

    def test_missing_business_features_returns_error(self, tmp_path):
        result = run_capability_review(str(tmp_path))
        assert "error" in result


class TestBuildReviewPrompt:
    def test_prompt_mentions_domain_and_touchpoints(self):
        prompt = build_review_prompt("OrderService", "order", [
            {"feature": "下单创建", "facet": "frontend", "role": "primary"},
        ])
        assert "OrderService" in prompt
        assert "下单创建" in prompt
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/understand-business/test_capability_review.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'capability_review'`.

- [ ] **Step 3: Create `capability_review.py`**

```python
#!/usr/bin/env python3
"""Phase 4b.1: Bounded LLM capability review (Spec 2 Component 4).

A candidate→verify pass over the deterministic serverIndex. Runs the LLM only
for domains with >=2 touchpoints across >=2 facets (single-touchpoint or
single-facet domains get a mechanical label, no LLM cost). It judges WITHIN the
given grouping; it never invents groupings. Degrades to mechanical labels when
no LLM is configured or a response is malformed.

Usage:
    python3 capability_review.py <project-root>

Reads / writes (in place):
    <project-root>/.understand-anything/business-landscape/business-features.json
"""
import hashlib
import json
import sys
from pathlib import Path

from association_discovery import _extract_json

_VALID_RELATIONSHIPS = ('replication', 'complementary-split', 'shared-infrastructure')


def build_review_prompt(domain_name: str, domain_service: str, touchpoints: list) -> str:
    """Build an LLM prompt asking how the touchpoints on a backend domain relate."""
    tp_lines = []
    for t in touchpoints:
        tp_lines.append(
            f"  - 功能: {t.get('feature', '')} (端: {t.get('facet', '')}, 角色: {t.get('role', '')})"
        )
    tp_block = '\n'.join(tp_lines)
    return f"""以下是多个客户端功能,它们都关联到同一个后端业务域:
后端域: {domain_name} (服务: {domain_service})

关联的客户端触点:
{tp_block}

请判断这些触点之间的关系,并给这个后端域对应的业务能力起一个规范名称。
返回严格 JSON 格式:
{{
  "label": "<这个业务能力的规范中文名>",
  "relationship": "replication | complementary-split | shared-infrastructure",
  "summary": "<一句话说明各端如何分工>",
  "flagged": [{{"feature": "<关联看起来不合理的功能名>", "reason": "<原因>"}}]
}}

规则:
- replication=各端实现同一能力; complementary-split=各端负责能力的不同部分; shared-infrastructure=这是被很多无关功能共用的基础设施(此时不要断言它们是同一个能力)
- 只在给定的触点范围内判断,不要发明新的分组
- flagged 仅作建议标注,不会删除任何关联"""


def parse_review_response(response: str, domain_name: str) -> dict:
    """Parse an LLM review response into {label, relationship, summary, flagged}.

    Falls back to a mechanical label on malformed input.
    """
    cleaned = _extract_json(response)
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return {'label': domain_name, 'relationship': 'unknown', 'summary': '', 'flagged': []}
    if not isinstance(data, dict):
        return {'label': domain_name, 'relationship': 'unknown', 'summary': '', 'flagged': []}

    relationship = data.get('relationship', 'unknown')
    if relationship not in _VALID_RELATIONSHIPS:
        relationship = 'unknown'

    # For shared infrastructure, do NOT assert the touchpoints are one capability:
    # keep the domain's own name as the label.
    if relationship == 'shared-infrastructure':
        label = domain_name
    else:
        label = data.get('label') or domain_name

    summary = data.get('summary', '') or ''
    flagged = data.get('flagged', []) or []
    if not isinstance(flagged, list):
        flagged = []
    return {'label': label, 'relationship': relationship, 'summary': summary, 'flagged': flagged}


def _call_llm(prompt: str) -> str:
    """Placeholder for LLM call. Overridden in tests, replaced by the agent in production."""
    raise NotImplementedError(
        "LLM call not configured. In production, this is replaced by the agent's LLM."
    )


def _mechanical_capability(domain_name: str) -> dict:
    return {'label': domain_name, 'relationship': 'unknown', 'summary': ''}


def _capability_hash(domain_name: str, touchpoints: list) -> str:
    ids = sorted(
        f"{t.get('feature', '')}|{t.get('facet', '')}|{t.get('role', '')}"
        for t in touchpoints
    )
    raw = domain_name + '\n' + '\n'.join(ids)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def run_capability_review(project_root_str: str) -> dict:
    """Enrich serverIndex[domain].capability in business-features.json (in place)."""
    project_root = Path(project_root_str)
    bf_path = (
        project_root / '.understand-anything' / 'business-landscape' / 'business-features.json'
    )
    if not bf_path.is_file():
        return {'error': 'business-features.json not found. Run Phase 4b first.'}
    try:
        data = json.loads(bf_path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as e:
        return {'error': f'Failed to parse business-features.json: {e}'}

    server_index = data.get('serverIndex', {})
    reviewed = 0
    mechanical = 0
    reused = 0

    for domain_name, entry in server_index.items():
        touchpoints = entry.get('touchpoints', [])
        facets = {t.get('facet') for t in touchpoints}
        new_hash = _capability_hash(domain_name, touchpoints)

        # Cache: reuse the prior capability if the grouping is unchanged.
        if entry.get('_capabilityHash') == new_hash and entry.get('capability'):
            reused += 1
            continue

        if len(touchpoints) >= 2 and len(facets) >= 2:
            prompt = build_review_prompt(domain_name, entry.get('service', ''), touchpoints)
            try:
                response = _call_llm(prompt)
            except (NotImplementedError, RuntimeError, OSError):
                entry['capability'] = _mechanical_capability(domain_name)
                mechanical += 1
            else:
                parsed = parse_review_response(response, domain_name)
                entry['capability'] = {
                    'label': parsed['label'],
                    'relationship': parsed['relationship'],
                    'summary': parsed['summary'],
                }
                for fl in parsed.get('flagged', []):
                    if not isinstance(fl, dict):
                        continue
                    for tp in touchpoints:
                        if tp.get('feature') == fl.get('feature'):
                            tp['flagged'] = {'reason': fl.get('reason', '')}
                reviewed += 1
        else:
            entry['capability'] = _mechanical_capability(domain_name)
            mechanical += 1

        entry['_capabilityHash'] = new_hash

    bf_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    return {
        'reviewed': reviewed,
        'mechanical': mechanical,
        'reused': reused,
        'domains': len(server_index),
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 capability_review.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = run_capability_review(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    print(
        f"Capability review: {result['reviewed']} reviewed, "
        f"{result['mechanical']} mechanical, {result['reused']} reused "
        f"({result['domains']} domains)"
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/understand-business/test_capability_review.py -q`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/capability_review.py tests/understand-business/test_capability_review.py
git commit -m "$(cat <<'EOF'
feat(business): bounded LLM capability review over serverIndex

Spec 2 Component 4: capability_review labels multi-facet backend domains
(>=2 touchpoints across >=2 facets) via a candidate->verify LLM pass; degrades
to mechanical labels with no LLM; shared-infrastructure keeps the domain name;
flagged touchpoints are annotated, never deleted; caches by grouping hash.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `capability_review` into the pipeline + backward-compat guard

**Files:**
- Modify: `understand-anything-plugin/skills/understand-business/SKILL.md` (feature-centric path after Phase 4b ~line 278; pipeline summary table ~line 748)
- Create: `tests/understand-business/test_business_features_backward_compat.py`

Implements Spec Component 4's placement + Spec test 14. The backward-compat test is a **characterization guard**: it exercises the assembled output from Task 3 and asserts that only the designed additive keys appear (no legacy key removed/renamed). It is expected to PASS on write — if it ever fails, an earlier task regressed backward compatibility.

- [ ] **Step 1: Write the backward-compat guard test**

Create `tests/understand-business/test_business_features_backward_compat.py`:

```python
"""Mobile-only backward-compat guard: business-features.json additions are
additive only — no legacy key removed or renamed (Spec 2 test 14)."""
import pytest

from assemble_business_features import assemble_features

LEGACY_FEATURE_KEYS = {"id", "name", "clientLayers", "clientLayer", "serverLayer"}
LEGACY_LAYER_KEYS = {"facetType", "implType", "platforms", "deliveryPlatforms", "summary"}
LEGACY_SERVERINDEX_KEYS = {"features", "refCount", "service"}
LEGACY_STATS_KEYS = {"totalFeatures", "withServerAssociation", "serverDomainsReferenced"}

ADDITIVE_FEATURE_KEYS = set()           # feature-level: none added by assemble
ADDITIVE_LAYER_KEYS = {"units"}          # Task 3
ADDITIVE_SERVERINDEX_KEYS = {"touchpoints"}  # Task 3 (capability is added later by capability_review)


def _mobile_only():
    associations = [
        {"featureName": "即时通讯",
         "primaryServer": {"domain": "Cosmos IM", "service": "im", "confidence": 0.9},
         "supportingServers": [{"domain": "推送", "service": "push", "relationship": "calls", "confidence": 0.8}],
         "error": None},
        {"featureName": "苹果支付",
         "primaryServer": {"domain": "支付账户", "service": "pay", "confidence": 0.9},
         "supportingServers": [], "error": None},
    ]
    consolidation = {
        "consolidated": [{
            "name": "即时通讯", "implType": "cross-platform",
            "platforms": ["ios", "android"], "deliveryPlatforms": ["ios", "android"],
            "implementations": [
                {"platform": "ios", "domainName": "IM", "domainId": "im", "summary": "iOS IM"},
                {"platform": "android", "domainName": "IM", "domainId": "im", "summary": "Android IM"},
            ],
            "mergedSummary": "[ios] iOS IM [android] Android IM", "facetType": "mobile",
        }],
        "standalone": [
            {"name": "苹果支付", "platform": "ios", "domainId": "pay",
             "implType": "native-specific", "deliveryPlatforms": ["ios"], "facetType": "mobile"},
        ],
        "infrastructure": [],
    }
    return associations, consolidation


def test_feature_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for feat in result["features"]:
        extra = set(feat.keys()) - LEGACY_FEATURE_KEYS
        assert extra <= ADDITIVE_FEATURE_KEYS, f"unexpected feature keys: {extra}"
        assert LEGACY_FEATURE_KEYS <= set(feat.keys())


def test_client_layer_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for feat in result["features"]:
        for layer in feat["clientLayers"]:
            extra = set(layer.keys()) - LEGACY_LAYER_KEYS
            assert extra <= ADDITIVE_LAYER_KEYS, f"unexpected layer keys: {extra}"
            assert LEGACY_LAYER_KEYS <= set(layer.keys())


def test_serverindex_keys_are_additive_only():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for domain, entry in result["serverIndex"].items():
        extra = set(entry.keys()) - LEGACY_SERVERINDEX_KEYS
        assert extra <= ADDITIVE_SERVERINDEX_KEYS, f"unexpected serverIndex keys: {extra}"
        assert LEGACY_SERVERINDEX_KEYS <= set(entry.keys())


def test_stats_keys_unchanged():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    assert set(result["stats"].keys()) == LEGACY_STATS_KEYS


def test_all_mobile_touchpoints_have_mobile_facet():
    associations, consolidation = _mobile_only()
    result = assemble_features(associations, consolidation)
    for entry in result["serverIndex"].values():
        for tp in entry["touchpoints"]:
            assert tp["facet"] == "mobile"
```

- [ ] **Step 2: Run the guard test (expected to PASS)**

Run: `python3 -m pytest tests/understand-business/test_business_features_backward_compat.py -q`
Expected: PASS (5 tests) — Task 3 already produces additive-only output. If it FAILS, an earlier task removed/renamed a legacy key; fix that before continuing.

- [ ] **Step 3: Document the `capability_review` step in SKILL.md**

In `understand-anything-plugin/skills/understand-business/SKILL.md`, insert a new subsection immediately after the Phase 4b block (after the line `Report: \`Phase 4b complete. <N> features assembled, <M> with server associations.\`` at ~line 278) and before `##### Phase 4c — Feature Interaction Generation`:

```markdown
##### Phase 4b.1 — Capability Review (server-anchored)

Report: `[Phase 4b.1/5] Reviewing cross-client capabilities...`

```bash
python3 "$SKILL_DIR/capability_review.py" "$PROJECT_ROOT"
```

Enriches each `serverIndex[domain].capability` in `business-features.json`. Runs
the LLM only for domains touched by ≥2 client features across ≥2 facets
(single-facet domains get a mechanical label). For these multi-facet domains:

1. **LLM step:** classify the relationship of the touchpoints
   (`replication` | `complementary-split` | `shared-infrastructure`), produce a
   canonical `label` + one-line `summary`, and optionally `flagged[]` touchpoints
   whose association looks implausible (advisory — annotated, never deleted).
2. **Validate & degrade:** on no-LLM / malformed response, fall back to a
   mechanical label `{label: <domain>, relationship: "unknown", summary: ""}`.
   For `shared-infrastructure`, the label stays the domain's own name.

Report: `Phase 4b.1 complete. <N> domains reviewed, <M> mechanical.`
```

- [ ] **Step 4: Add `capability_review` to the pipeline summary table**

In the same file, in the pipeline summary table (the rows around lines 746-750 listing `association_discovery.py` / `route_phase3.py` / `assemble_business_features.py`), insert a row after the `assemble_business_features.py` row:

```markdown
| 6 | `capability_review.py` | Phase 4b.1 | `business-features.json` — `serverIndex[domain].capability` labels |
```

(Adjust the leading step numbers of subsequent rows if they are sequential; if the existing numbering already skips, just keep the new row's number consistent with its neighbours.)

- [ ] **Step 5: Verify the docs reference the new step**

Run: `grep -n "capability_review" understand-anything-plugin/skills/understand-business/SKILL.md`
Expected: at least two matches (the Phase 4b.1 bash block + the pipeline table row).

- [ ] **Step 6: Run the entire business suite one final time**

Run: `python3 -m pytest tests/understand-business/ understand-anything-plugin/skills/understand-business/tests/ -q`
Expected: PASS (all tests across both directories).

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand-business/SKILL.md tests/understand-business/test_business_features_backward_compat.py
git commit -m "$(cat <<'EOF'
docs(business): wire capability_review into feature-centric pipeline

Spec 2 Component 4 placement: document the Phase 4b.1 capability_review step
(after assemble) in SKILL.md + pipeline table. Add a mobile-only backward-compat
guard asserting business-features.json additions are additive-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review notes (resolved during planning)

- **`_merge_server_associations` signature stays back-compatible.** The pre-existing `test_feature_assembler.py` calls it with one positional arg and asserts `features`/`refCount`; the new `facet_map` param is optional (defaults to `{}` → facet `"unknown"`), and `features`/`refCount`/`service` are retained. ✓
- **`assemble_features(assoc, consol)` signature unchanged.** `facet_map` is derived internally from the consolidation (every consolidated/standalone item carries `facetType`), so existing callers/tests are untouched. ✓
- **Mobile behavior is preserved through the registry.** `consolidate_mobile` calls `_consolidate_mobile_domains` verbatim; assemble's `setdefault('facetType', facet_type)` generalizes the old `setdefault('facetType', 'mobile')`; association_discovery's generic standalone-flatten is identical to the old mobile branch for mobile and a no-op for frontend (`standalone == []`). ✓
- **`units` vs `platforms`.** Both are emitted. For mobile they coincide (keys = platforms). For web, `platforms` keeps `web` (last repo's payload) and `units` is keyed by repo — that's the new per-repo breakdown the spec wants. `clientLayer = clientLayers[0]` (same object) so the backward-compat equality test still holds. ✓
- **Deleted test file.** `test_association_discovery_frontend.py` tested the deleted `_load_frontend_features`; its coverage (reads graph, fields, missing-graph, path-traversal) is fully reproduced in `test_client_facets.py`. ✓
- **`_extract_json` reuse.** `capability_review` imports `_extract_json` from `association_discovery` (DRY, same package, no import-time side effects) rather than copying it. ✓
- **No strict schema rejects the additive keys.** There is no JSON schema for `business-features.json`; `validate_landscape.py` only validates the domain-centric path. Additive keys are safe. ✓
- **`capability` is added by `capability_review`, not `assemble`.** The backward-compat guard lists `capability` as neither legacy nor an assemble-additive key — it asserts assemble's output, which does not yet carry `capability`. The Phase 4b.1 step adds it later, in place. ✓
- **Caching keys on the grouping.** `_capabilityHash = sha256(domain + sorted touchpoint identities)`; a re-run with an unchanged grouping reuses the prior `capability` (mirrors `association_discovery`'s `_promptHash`). ✓
