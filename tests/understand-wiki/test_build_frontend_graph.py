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
        for key in ("version", "facetType", "project", "routes", "pages",
                    "components", "stateStores", "apiCalls", "features", "contentHash"):
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
