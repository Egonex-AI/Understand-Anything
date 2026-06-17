"""Tests for build-frontend-graph.py — builds frontend-graph.json from KG + DG."""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS_DIR = (
    Path(__file__).resolve().parents[2]
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
)
_spec = importlib.util.spec_from_file_location(
    "build_frontend_graph", SCRIPTS_DIR / "build-frontend-graph.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
build_frontend_graph = _mod.build_frontend_graph
_validate = _mod._validate
_discover_repos = _mod._discover_repos
_frontend_subpaths = _mod._frontend_subpaths
_aggregate_features = _mod._aggregate_features
_union = _mod._union
_extract_repo = _mod._extract_repo


def _minimal_kg(name="admin-web", extra_nodes=None):
    nodes = [
        {
            "id": "file:src/pages/orders/List.tsx",
            "type": "file",
            "name": "List.tsx",
            "filePath": "src/pages/orders/List.tsx",
            "tags": ["page"],
            "summary": "Order list page",
        }
    ]
    if extra_nodes:
        nodes.extend(extra_nodes)
    return {
        "project": {
            "name": name,
            "frameworks": ["react"],
            "languages": ["typescript"],
            "gitCommitHash": "abc1234",
            "provenance": {"generationMode": "full", "degraded": False},
        },
        "nodes": nodes,
        "edges": [],
    }


def _minimal_dg(domains=None):
    if domains is None:
        domains = [
            {
                "id": "domain:order-management",
                "type": "domain",
                "name": "Order Management",
                "summary": "Manages orders",
            }
        ]
    return {"project": {"name": "admin-web"}, "nodes": domains, "edges": []}


@pytest.fixture
def minimal_project(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir()
    (ua / "knowledge-graph.json").write_text(json.dumps(_minimal_kg()))
    (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
    return tmp_path


class TestBuildFrontendGraph:
    def test_output_file_created(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        assert (minimal_project / ".understand-anything" / "frontend-graph.json").exists()

    def test_schema_top_level_keys(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        for key in ("version", "facetType", "project", "repos", "routes", "pages",
                    "components", "stateStores", "apiCalls", "features", "domainLinks",
                    "contentHash"):
            assert key in data, f"Missing top-level key: {key}"

    def test_facet_type_is_frontend(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        assert data["facetType"] == "frontend"

    def test_content_hash_has_sha256_prefix(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        assert data["contentHash"].startswith("sha256:")
        assert len(data["contentHash"]) == 71  # len("sha256:") + 64 hex chars

    def test_features_derived_from_domain_graph(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        assert len(data["features"]) == 1
        feat = data["features"][0]
        assert feat["name"] == "Order Management"
        assert feat["sourceDomain"] == "domain:order-management"

    def test_pages_extracted_from_kg_tags(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        assert "src/pages/orders/List.tsx" in data["pages"]

    def test_routes_from_kg_edges(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        kg = _minimal_kg()
        kg["nodes"].append(
            {"id": "endpoint:/orders", "type": "endpoint", "name": "/orders",
             "path": "/orders", "method": "GET"}
        )
        kg["edges"].append(
            {"source": "file:src/pages/orders/List.tsx", "target": "endpoint:/orders",
             "type": "routes", "direction": "forward", "weight": 1.0}
        )
        (ua / "knowledge-graph.json").write_text(json.dumps(kg))
        (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
        build_frontend_graph(str(tmp_path))
        data = json.loads((ua / "frontend-graph.json").read_text())
        assert "/orders" in data["routes"]

    def test_nextjs_file_routes_detected(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        pages_dir = tmp_path / "pages" / "orders"
        pages_dir.mkdir(parents=True)
        (pages_dir / "index.tsx").write_text("export default function Page() {}")
        kg = {
            "project": {"name": "next-app", "frameworks": ["nextjs"],
                        "languages": ["typescript"],
                        "provenance": {"generationMode": "full"}},
            "nodes": [], "edges": [],
        }
        dg = {
            "project": {"name": "next-app"},
            "nodes": [{"id": "domain:orders", "type": "domain", "name": "Orders",
                       "summary": "Order domain"}],
            "edges": [],
        }
        (ua / "knowledge-graph.json").write_text(json.dumps(kg))
        (ua / "domain-graph.json").write_text(json.dumps(dg))
        build_frontend_graph(str(tmp_path))
        data = json.loads((ua / "frontend-graph.json").read_text())
        assert "/orders" in data["routes"]

    def test_api_calls_from_consumes_api_edges(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        kg = _minimal_kg()
        kg["nodes"].append(
            {"id": "endpoint:GET:/api/orders", "type": "endpoint",
             "name": "/api/orders", "path": "/api/orders", "method": "GET"}
        )
        kg["edges"].append(
            {"source": "file:src/pages/orders/List.tsx",
             "target": "endpoint:GET:/api/orders",
             "type": "consumes_api", "direction": "forward", "weight": 0.9}
        )
        (ua / "knowledge-graph.json").write_text(json.dumps(kg))
        (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
        build_frontend_graph(str(tmp_path))
        data = json.loads((ua / "frontend-graph.json").read_text())
        assert any(c["path"] == "/api/orders" for c in data["apiCalls"])

    def test_missing_kg_raises_file_not_found(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
        with pytest.raises(FileNotFoundError, match="knowledge-graph.json"):
            build_frontend_graph(str(tmp_path))

    def test_missing_dg_raises_file_not_found(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "knowledge-graph.json").write_text(json.dumps(_minimal_kg()))
        with pytest.raises(FileNotFoundError, match="domain-graph.json"):
            build_frontend_graph(str(tmp_path))

    def test_empty_domains_raises_value_error(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        kg = _minimal_kg()
        dg = {"project": {"name": "web-app"}, "nodes": [], "edges": []}
        (ua / "knowledge-graph.json").write_text(json.dumps(kg))
        (ua / "domain-graph.json").write_text(json.dumps(dg))
        with pytest.raises(ValueError, match="features"):
            build_frontend_graph(str(tmp_path))

    def test_provenance_in_project(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        prov = data["project"]["provenance"]
        assert prov["generationMode"] == "wiki"
        assert "generatedAt" in prov
        assert "gitCommitHash" in prov

    def test_project_metadata_copied_from_kg(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        assert data["project"]["name"] == "admin-web"
        assert "react" in data["project"]["frameworks"]
        assert "typescript" in data["project"]["languages"]

    def test_feature_has_required_keys(self, minimal_project):
        build_frontend_graph(str(minimal_project))
        data = json.loads(
            (minimal_project / ".understand-anything" / "frontend-graph.json").read_text()
        )
        feat = data["features"][0]
        for key in ("id", "name", "sourceDomain", "routes", "pages", "components",
                    "stateStores", "apiCalls", "uiRules", "interactionRules",
                    "stateTransitions", "apiSequence"):
            assert key in feat, f"Feature missing key: {key}"


class TestValidate:
    def test_valid_graph_passes(self):
        graph = {
            "facetType": "frontend",
            "project": {"provenance": {"generationMode": "wiki"}},
            "contentHash": "sha256:" + "a" * 64,
            "features": [
                {"name": "Auth", "routes": ["/login"], "pages": [],
                 "apiCalls": [], "stateStores": [], "components": []}
            ],
        }
        valid, degraded, warnings = _validate(graph)
        assert valid
        assert not degraded
        assert not warnings

    def test_wrong_facet_type_is_invalid(self):
        graph = {
            "facetType": "mobile",
            "project": {"provenance": {}},
            "contentHash": "sha256:x",
            "features": [{"routes": ["/x"], "pages": [], "apiCalls": [],
                          "stateStores": [], "components": []}],
        }
        valid, _, _ = _validate(graph)
        assert not valid

    def test_empty_features_is_invalid(self):
        graph = {
            "facetType": "frontend",
            "project": {"provenance": {}},
            "contentHash": "sha256:x",
            "features": [],
        }
        valid, _, _ = _validate(graph)
        assert not valid

    def test_features_with_no_evidence_is_invalid(self):
        graph = {
            "facetType": "frontend",
            "project": {"provenance": {}},
            "contentHash": "sha256:x",
            "features": [
                {"routes": [], "pages": [], "apiCalls": [], "stateStores": [], "components": []}
            ],
        }
        valid, _, _ = _validate(graph)
        assert not valid

    def test_missing_content_hash_is_invalid(self, tmp_path):
        """build_frontend_graph must always produce a contentHash in the output file.

        The contentHash check was removed from _validate (since hash must be computed
        after validation so that degraded state is included). This test verifies the
        contract via build_frontend_graph instead.
        """
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "knowledge-graph.json").write_text(json.dumps(_minimal_kg()))
        (ua / "domain-graph.json").write_text(json.dumps(_minimal_dg()))
        build_frontend_graph(str(tmp_path))
        result = json.loads((ua / "frontend-graph.json").read_text())
        assert result["contentHash"].startswith("sha256:")

    def test_partial_evidence_marks_degraded(self):
        """Feature with no evidence in an otherwise-valid graph → degraded, not invalid."""
        graph = {
            "facetType": "frontend",
            "project": {"provenance": {}},
            "contentHash": "sha256:x",
            "features": [
                {"routes": ["/login"], "pages": [], "apiCalls": [],
                 "stateStores": [], "components": []},  # has evidence
                {"routes": [], "pages": [], "apiCalls": [],
                 "stateStores": [], "components": []},   # no evidence → degraded
            ],
        }
        valid, degraded, warnings = _validate(graph)
        assert valid
        assert degraded
        assert any("degraded" in w for w in warnings)


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

    def test_non_frontend_facet_falls_back_to_parent(self, tmp_path):
        project = tmp_path
        web = project / "web"
        web.mkdir()
        # web/ has a system.json with NO frontend facet
        web_ua = web / ".understand-anything"
        web_ua.mkdir()
        (web_ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "backend", "path": "api/"}]
        }))
        # project root has the frontend facet — must be found despite web/'s system.json
        ua = project / ".understand-anything"
        ua.mkdir()
        (ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "web/", "subPaths": ["admin/"]}]
        }))
        assert _frontend_subpaths(web) == ["admin/"]

    def test_invalid_system_json_returns_empty(self, tmp_path):
        ua = tmp_path / ".understand-anything"
        ua.mkdir()
        (ua / "system.json").write_text("{not valid json")
        assert _frontend_subpaths(tmp_path) == []


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

    def test_rerun_is_deterministic(self, tmp_path):
        _make_repo(tmp_path, "web-app",
                   kg=_kg_with_page("web-app", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path, "admin",
                   kg=_kg_with_page("admin", "src/pages/permissions/Index.tsx"),
                   dg=_dg_with_domain("domain:permission", "Permission"))
        build_frontend_graph(str(tmp_path))
        first = _read_graph(tmp_path)
        build_frontend_graph(str(tmp_path))
        second = _read_graph(tmp_path)
        for key in ("repos", "routes", "pages", "components", "stateStores",
                    "apiCalls", "features", "domainLinks"):
            assert first[key] == second[key], f"non-deterministic field: {key}"

    def test_all_repos_skipped_raises_file_not_found(self, tmp_path):
        # discovered (has DG) but missing KG -> skipped; no repo survives
        _make_repo(tmp_path, "admin", dg=_dg_with_domain("domain:order", "Orders"))
        with pytest.raises(FileNotFoundError, match="knowledge-graph.json"):
            build_frontend_graph(str(tmp_path))

    def test_duplicate_repo_names_raise(self, tmp_path):
        # Two nested subPaths whose leaf dir name collides ("web") -> loud error, not silent corruption.
        _make_repo(tmp_path / "apps", "web",
                   kg=_kg_with_page("web", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        _make_repo(tmp_path / "pkgs", "web",
                   kg=_kg_with_page("web", "src/pages/orders/List.tsx"),
                   dg=_dg_with_domain("domain:order", "Orders"))
        sys_ua = tmp_path / ".understand-anything"
        sys_ua.mkdir()
        (sys_ua / "system.json").write_text(json.dumps({
            "facets": [{"type": "frontend", "path": "", "subPaths": ["apps/web/", "pkgs/web/"]}]
        }))
        with pytest.raises(ValueError, match="Duplicate repo name"):
            build_frontend_graph(str(tmp_path))
