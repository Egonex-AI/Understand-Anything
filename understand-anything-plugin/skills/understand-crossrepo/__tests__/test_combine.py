#!/usr/bin/env python3
"""
test_combine.py — TDD tests for combine-graphs.py

Two fixture repos both containing a `file:Dockerfile` node and an edge.
Assert:
  - Distinct namespaced ids (file:<ns>/Dockerfile per repo)
  - Zero id collisions in the union
  - Both layer:<ns1> and layer:<ns2> present with correct nodeIds
  - Edge endpoints rewritten to namespaced ids
  - module:<ns> node exists per repo
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def make_repo(tmp: Path, ns: str) -> Path:
    """Build a minimal .understand-anything/knowledge-graph.json in a temp repo dir."""
    repo = tmp / ns
    ua = repo / ".understand-anything"
    ua.mkdir(parents=True)

    graph = {
        "version": "1.0.0",
        "project": {"name": ns, "languages": ["Python"], "frameworks": []},
        "nodes": [
            {
                "id": "file:Dockerfile",
                "type": "file",
                "name": "Dockerfile",
                "filePath": "Dockerfile",
                "summary": f"Docker build for {ns}",
                "tags": [],
            },
            {
                "id": "file:src/main.py",
                "type": "file",
                "name": "main.py",
                "filePath": "src/main.py",
                "summary": "Entry point",
                "tags": [],
            },
            {
                "id": "function:src/main.py:run",
                "type": "function",
                "name": "run",
                "filePath": "src/main.py",
                "summary": "Main runner",
                "tags": [],
            },
            {
                "id": "endpoint:api/v1/items",
                "type": "endpoint",
                "name": "GET /api/v1/items",
                "filePath": "src/main.py",
                "summary": "List items endpoint",
                "tags": [],
            },
            {
                "id": "service:ItemService",
                "type": "service",
                "name": "ItemService",
                "filePath": "src/main.py",
                "summary": "Item business logic",
                "tags": [],
            },
        ],
        "edges": [
            {
                "source": "file:Dockerfile",
                "target": "file:src/main.py",
                "type": "references",
                "direction": "forward",
                "weight": 0.5,
            }
        ],
        "layers": [
            {
                "id": "layer:internal",
                "name": "Internal Layer",
                "description": "Should be discarded",
                "nodeIds": ["file:Dockerfile", "file:src/main.py"],
            }
        ],
        "tour": [],
    }
    (ua / "knowledge-graph.json").write_text(json.dumps(graph), encoding="utf-8")
    return repo


def run_combine(out: Path, *repo_ns_pairs: str) -> tuple[dict, dict]:
    """Run combine-graphs.py, return (combined-graph, id-map)."""
    script = Path(__file__).parent.parent / "combine-graphs.py"
    cmd = [sys.executable, str(script), str(out)] + list(repo_ns_pairs)
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, f"combine-graphs.py failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"

    combined = json.loads((out / ".understand-anything" / "intermediate" / "combined-graph.json").read_text())
    id_map = json.loads((out / ".understand-anything" / "intermediate" / "id-map.json").read_text())
    return combined, id_map


def test_no_id_collisions_and_distinct_dockerfiles():
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")
        out = tmp / "out"

        combined, id_map = run_combine(out, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        node_ids = [n["id"] for n in combined["nodes"]]

        # Both Dockerfiles must be distinct namespaced ids
        assert "file:repo_a/Dockerfile" in node_ids, f"Missing file:repo_a/Dockerfile in {node_ids}"
        assert "file:repo_b/Dockerfile" in node_ids, f"Missing file:repo_b/Dockerfile in {node_ids}"

        # Old bare id must NOT be present
        assert "file:Dockerfile" not in node_ids, "Bare file:Dockerfile still present (no namespace)"

        # Zero id collisions — all ids are unique
        assert len(node_ids) == len(set(node_ids)), f"Duplicate ids found: {[x for x in node_ids if node_ids.count(x) > 1]}"


def test_both_layers_present_with_correct_nodeids():
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")
        out = tmp / "out"

        combined, _ = run_combine(out, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        layer_ids = {l["id"] for l in combined["layers"]}
        assert "layer:repo_a" in layer_ids, f"Missing layer:repo_a in {layer_ids}"
        assert "layer:repo_b" in layer_ids, f"Missing layer:repo_b in {layer_ids}"

        # Internal layers from repos must be discarded
        assert "layer:internal" not in layer_ids, "Repo's internal layer must be discarded"

        # Each layer's nodeIds must contain at least the file-level nodes for that repo
        layer_a = next(l for l in combined["layers"] if l["id"] == "layer:repo_a")
        layer_b = next(l for l in combined["layers"] if l["id"] == "layer:repo_b")

        # Dockerfile (file-level) must be in each repo's layer
        assert "file:repo_a/Dockerfile" in layer_a["nodeIds"], f"Dockerfile not in layer_a nodeIds: {layer_a['nodeIds']}"
        assert "file:repo_b/Dockerfile" in layer_b["nodeIds"], f"Dockerfile not in layer_b nodeIds: {layer_b['nodeIds']}"

        # function nodes must NOT be in the layer (only top-level)
        assert not any(nid.startswith("function:") for nid in layer_a["nodeIds"]), \
            "Function nodes should not be in repo layer"

        # endpoint: and service: nodes MUST be in the layer (Task 5 relies on this)
        assert "endpoint:repo_a/api/v1/items" in layer_a["nodeIds"], \
            f"endpoint node missing from layer_a nodeIds: {layer_a['nodeIds']}"
        assert "service:repo_a/ItemService" in layer_a["nodeIds"], \
            f"service node missing from layer_a nodeIds: {layer_a['nodeIds']}"

        # module anchor must be in each layer
        assert "module:repo_a" in layer_a["nodeIds"], f"module:repo_a missing from layer nodeIds: {layer_a['nodeIds']}"
        assert "module:repo_b" in layer_b["nodeIds"], f"module:repo_b missing from layer nodeIds: {layer_b['nodeIds']}"


def test_edge_endpoints_rewritten():
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")
        out = tmp / "out"

        combined, _ = run_combine(out, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        # Find the references edge from repo_a (Dockerfile → main.py)
        ref_edges = [e for e in combined["edges"] if e["type"] == "references"]
        assert ref_edges, "No references edges found"

        # All edge endpoints must be namespaced
        for edge in combined["edges"]:
            src, tgt = edge["source"], edge["target"]
            # No bare file:Dockerfile — must have a namespace segment
            assert not src == "file:Dockerfile", f"Bare source id in edge: {edge}"
            assert not tgt == "file:Dockerfile", f"Bare target id in edge: {edge}"

        # Specifically: there must be a references edge repo_a/Dockerfile → repo_a/src/main.py
        a_ref = next(
            (e for e in ref_edges
             if e["source"] == "file:repo_a/Dockerfile" and e["target"] == "file:repo_a/src/main.py"),
            None,
        )
        assert a_ref is not None, "Expected namespaced edge file:repo_a/Dockerfile → file:repo_a/src/main.py not found"


def test_module_anchor_node_per_repo():
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")
        out = tmp / "out"

        combined, _ = run_combine(out, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        node_ids = {n["id"] for n in combined["nodes"]}
        assert "module:repo_a" in node_ids, f"module:repo_a missing from nodes: {node_ids}"
        assert "module:repo_b" in node_ids, f"module:repo_b missing from nodes: {node_ids}"

        mod_a = next(n for n in combined["nodes"] if n["id"] == "module:repo_a")
        assert mod_a["type"] == "module"
        assert mod_a["name"] == "repo_a"
        assert mod_a.get("repo") == "repo_a"


def test_id_map_is_keyed_by_ns():
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")
        out = tmp / "out"

        _, id_map = run_combine(out, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        # id-map must be keyed by ns to avoid collisions
        assert "repo_a" in id_map, f"repo_a key missing from id-map: {list(id_map.keys())}"
        assert "repo_b" in id_map, f"repo_b key missing from id-map: {list(id_map.keys())}"

        # Within repo_a, old id → new id
        a_map = id_map["repo_a"]
        assert "file:Dockerfile" in a_map, f"file:Dockerfile missing from repo_a id-map: {a_map}"
        assert a_map["file:Dockerfile"] == "file:repo_a/Dockerfile"


def test_scan_artifact_nodes_dropped():
    """Nodes whose filePath contains .understand-anything must be dropped."""
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo = tmp / "repo_c"
        ua = repo / ".understand-anything"
        ua.mkdir(parents=True)

        graph = {
            "version": "1.0.0",
            "project": {"name": "repo_c"},
            "nodes": [
                {"id": "file:src/app.py", "type": "file", "name": "app.py", "filePath": "src/app.py", "summary": "", "tags": []},
                # Scan artifact — must be dropped
                {"id": "file:.understand-anything/meta.json", "type": "file", "name": "meta.json",
                 "filePath": ".understand-anything/meta.json", "summary": "", "tags": []},
            ],
            "edges": [],
            "layers": [],
            "tour": [],
        }
        (ua / "knowledge-graph.json").write_text(json.dumps(graph), encoding="utf-8")

        out = tmp / "out2"
        combined, _ = run_combine(out, f"{repo}:repo_c")

        node_ids = [n["id"] for n in combined["nodes"]]
        assert not any(".understand-anything" in nid for nid in node_ids), \
            f".understand-anything artifact node not dropped: {node_ids}"
        assert "file:repo_c/src/app.py" in node_ids


def test_output_is_deterministic():
    """Two identical runs produce byte-identical output."""
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        repo_a = make_repo(tmp, "repo_a")
        repo_b = make_repo(tmp, "repo_b")

        out1 = tmp / "out1"
        out2 = tmp / "out2"
        run_combine(out1, f"{repo_a}:repo_a", f"{repo_b}:repo_b")
        run_combine(out2, f"{repo_a}:repo_a", f"{repo_b}:repo_b")

        g1 = (out1 / ".understand-anything" / "intermediate" / "combined-graph.json").read_text()
        g2 = (out2 / ".understand-anything" / "intermediate" / "combined-graph.json").read_text()
        assert g1 == g2, "Output is not deterministic across two runs"


if __name__ == "__main__":
    tests = [
        test_no_id_collisions_and_distinct_dockerfiles,
        test_both_layers_present_with_correct_nodeids,
        test_edge_endpoints_rewritten,
        test_module_anchor_node_per_repo,
        test_id_map_is_keyed_by_ns,
        test_scan_artifact_nodes_dropped,
        test_output_is_deterministic,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
