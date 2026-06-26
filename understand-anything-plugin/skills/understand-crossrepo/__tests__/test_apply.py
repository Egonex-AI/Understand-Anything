#!/usr/bin/env python3
"""
test_apply.py — TDD tests for apply-interlinks.py (Task 5).

Fixture: two-repo combined-graph + crossrepo-edges with:
  - one edge targeting external:keycloak
  - one valid module→module edge
  - one DANGLING edge (target not in node set)

Assertions:
  a) service:external/keycloak node exists with summary+tags, in layer:external-shared-infra
  b) dangling edge was dropped
  c) valid + external edges present with direction:"forward" and x<i> ids
  d) bundled validator on knowledge-graph.json → ZERO issues
  e) meta.json written
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).parent.parent / "apply-interlinks.py"


def make_combined_graph(out: Path) -> None:
    """Write a minimal combined-graph.json with two repos and module anchors."""
    intermediate = out / ".understand-anything" / "intermediate"
    intermediate.mkdir(parents=True, exist_ok=True)

    graph = {
        "version": "1.0.0",
        "project": {
            "name": "test-combined",
            "languages": ["Python"],
            "frameworks": [],
            "description": "Test fixture combined graph",
        },
        "nodes": [
            # Repo A: file node + module anchor
            {
                "id": "file:svc_a/src/main.py",
                "type": "file",
                "name": "main.py",
                "filePath": "svc_a/src/main.py",
                "summary": "Entry point for svc_a",
                "tags": ["repo:svc_a"],
                "repo": "svc_a",
            },
            {
                "id": "module:svc_a",
                "type": "module",
                "name": "svc_a",
                "summary": "Module anchor for svc_a",
                "tags": ["repo:svc_a"],
                "repo": "svc_a",
            },
            # Repo B: file node + module anchor
            {
                "id": "file:svc_b/src/app.py",
                "type": "file",
                "name": "app.py",
                "filePath": "svc_b/src/app.py",
                "summary": "Entry point for svc_b",
                "tags": ["repo:svc_b"],
                "repo": "svc_b",
            },
            {
                "id": "module:svc_b",
                "type": "module",
                "name": "svc_b",
                "summary": "Module anchor for svc_b",
                "tags": ["repo:svc_b"],
                "repo": "svc_b",
            },
        ],
        "edges": [
            # Intra-repo edge (svc_a)
            {
                "source": "module:svc_a",
                "target": "file:svc_a/src/main.py",
                "type": "contains",
                "direction": "forward",
                "weight": 0.8,
            },
            # Intra-repo edge (svc_b)
            {
                "source": "module:svc_b",
                "target": "file:svc_b/src/app.py",
                "type": "contains",
                "direction": "forward",
                "weight": 0.8,
            },
        ],
        "layers": [
            {
                "id": "layer:svc_a",
                "name": "svc_a",
                "description": "Layer for svc_a",
                "nodeIds": ["file:svc_a/src/main.py", "module:svc_a"],
            },
            {
                "id": "layer:svc_b",
                "name": "svc_b",
                "description": "Layer for svc_b",
                "nodeIds": ["file:svc_b/src/app.py", "module:svc_b"],
            },
        ],
    }
    (intermediate / "combined-graph.json").write_text(
        json.dumps(graph, indent=2), encoding="utf-8"
    )


def make_crossrepo_edges(out: Path) -> None:
    """Write crossrepo-edges.json with three edge cases."""
    intermediate = out / ".understand-anything" / "intermediate"
    edges = [
        # Valid: module→external (keycloak)
        {
            "source": "module:svc_a",
            "target": "external:keycloak",
            "type": "auth-dependency",
            "label": "svc_a authenticates via Keycloak",
            "weight": 0.9,
            "direction": "forward",
            "confidence": 0.85,
            "evidence": "Uses Keycloak OIDC",
        },
        # Valid: module→module cross-repo
        {
            "source": "module:svc_a",
            "target": "module:svc_b",
            "type": "api-call",
            "label": "svc_a calls svc_b API",
            "weight": 0.7,
            "direction": "forward",
            "confidence": 0.75,
            "evidence": "HTTP client import",
        },
        # Dangling: target endpoint does not exist in node set
        {
            "source": "module:svc_a",
            "target": "endpoint:svc_b/api/v1/nonexistent",
            "type": "api-call",
            "label": "Dangling edge — target missing",
            "weight": 0.5,
            "direction": "forward",
            "confidence": 0.6,
            "evidence": "Stale reference",
        },
        # Low-confidence: must be kept but tagged lowConfidence
        {
            "source": "module:svc_b",
            "target": "module:svc_a",
            "type": "event-dependency",
            "label": "svc_b maybe consumes svc_a events",
            "weight": 0.3,
            "direction": "forward",
            "confidence": 0.3,
            "evidence": "Speculative",
        },
    ]
    (intermediate / "crossrepo-edges.json").write_text(
        json.dumps(edges, indent=2), encoding="utf-8"
    )


def run_apply(out: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(out)],
        capture_output=True,
        text=True,
    )


# ── Tests ──────────────────────────────────────────────────────────────────────


def test_external_node_and_layer_created():
    """(a) service:external/keycloak exists with summary+tags, in layer:external-shared-infra."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)
        make_crossrepo_edges(out)

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())
        node_ids = {n["id"]: n for n in kg["nodes"]}

        # Node exists
        assert "service:external/keycloak" in node_ids, (
            f"service:external/keycloak missing from nodes: {list(node_ids.keys())}"
        )
        kc = node_ids["service:external/keycloak"]
        assert kc["summary"], "External keycloak node missing summary"
        assert kc["tags"], "External keycloak node missing tags"
        assert "external" in kc["tags"], "External node tags must include 'external'"

        # In the external layer
        layers = {l["id"]: l for l in kg["layers"]}
        assert "layer:external-shared-infra" in layers, (
            f"layer:external-shared-infra missing: {list(layers.keys())}"
        )
        ext_layer = layers["layer:external-shared-infra"]
        assert "service:external/keycloak" in ext_layer["nodeIds"], (
            f"keycloak not in external layer nodeIds: {ext_layer['nodeIds']}"
        )


def test_dangling_edge_dropped():
    """(b) edge with non-existent target endpoint is dropped."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)
        make_crossrepo_edges(out)

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())
        node_ids = {n["id"] for n in kg["nodes"]}

        for edge in kg["edges"]:
            assert edge["target"] in node_ids, (
                f"Dangling edge not dropped: target '{edge['target']}' not in node set"
            )
            assert edge["source"] in node_ids, (
                f"Dangling edge not dropped: source '{edge['source']}' not in node set"
            )

        # Specifically the dangling endpoint edge must be absent
        dangling_targets = [
            e for e in kg["edges"]
            if e.get("target") == "endpoint:svc_b/api/v1/nonexistent"
        ]
        assert not dangling_targets, "Dangling edge with missing endpoint target was not dropped"


def test_valid_and_external_edges_present():
    """(c) valid module→module and external edges present with direction:forward and x<i> ids."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)
        make_crossrepo_edges(out)

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())

        cross_edges = [e for e in kg["edges"] if e.get("id", "").startswith("x")]
        assert cross_edges, "No cross-repo edges (x<i> ids) found"

        # All cross edges have direction:forward and numeric weight
        for e in cross_edges:
            assert e.get("direction") == "forward", f"Edge missing direction:forward: {e}"
            assert isinstance(e.get("weight"), (int, float)), f"Edge weight not numeric: {e}"

        # External edge: svc_a → service:external/keycloak
        ext_edges = [
            e for e in cross_edges
            if e.get("target") == "service:external/keycloak"
        ]
        assert ext_edges, "External keycloak edge not found in cross-repo edges"

        # Module→module edge: svc_a → svc_b
        mm_edges = [
            e for e in cross_edges
            if e.get("source") == "module:svc_a" and e.get("target") == "module:svc_b"
        ]
        assert mm_edges, "module:svc_a → module:svc_b cross-repo edge missing"

        # Low-confidence edge kept but tagged
        lc_edges = [e for e in cross_edges if e.get("lowConfidence")]
        assert lc_edges, "Low-confidence edge (confidence<0.5) should be kept with lowConfidence:true"


def test_validator_zero_issues():
    """(d) bundled inline validator returns issues==[] on knowledge-graph.json."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)
        make_crossrepo_edges(out)

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        review_path = out / ".understand-anything" / "intermediate" / "review.json"
        assert review_path.exists(), "review.json not written by validator"

        review = json.loads(review_path.read_text())
        assert review.get("issues") == [], (
            f"Validator found issues: {review.get('issues')}"
        )


def test_meta_json_written():
    """(e) meta.json is written with required fields."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)
        make_crossrepo_edges(out)

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        meta_path = out / ".understand-anything" / "meta.json"
        assert meta_path.exists(), "meta.json not written"

        meta = json.loads(meta_path.read_text())
        assert "lastAnalyzedAt" in meta, "meta.json missing lastAnalyzedAt"
        assert meta.get("gitCommitHash") == "crossrepo", "meta.json gitCommitHash must be 'crossrepo'"
        assert meta.get("version") == "1.0.0", "meta.json version must be '1.0.0'"
        assert "analyzedFiles" in meta, "meta.json missing analyzedFiles"


def test_dedup_edges():
    """Duplicate (source,target,type) cross edges are deduped."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)

        # Write crossrepo-edges with a duplicate
        intermediate = out / ".understand-anything" / "intermediate"
        edges = [
            {"source": "module:svc_a", "target": "module:svc_b", "type": "api-call",
             "weight": 0.7, "direction": "forward", "confidence": 0.8, "evidence": "first"},
            {"source": "module:svc_a", "target": "module:svc_b", "type": "api-call",
             "weight": 0.5, "direction": "forward", "confidence": 0.8, "evidence": "dup"},
        ]
        (intermediate / "crossrepo-edges.json").write_text(json.dumps(edges), encoding="utf-8")

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())
        cross = [e for e in kg["edges"]
                 if e.get("source") == "module:svc_a" and e.get("target") == "module:svc_b"
                 and e.get("type") == "api-call"]
        assert len(cross) == 1, f"Duplicate edge not deduped: found {len(cross)}"


def test_zero_confidence_tagged_low_confidence():
    """confidence==0.0 is falsy but must still be tagged lowConfidence; confidence>=0.5 must NOT be."""
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str)
        make_combined_graph(out)

        intermediate = out / ".understand-anything" / "intermediate"
        edges = [
            # zero-confidence: falsy 0.0 must be tagged lowConfidence
            {
                "source": "module:svc_a",
                "target": "module:svc_b",
                "type": "api-call",
                "weight": 0.5,
                "direction": "forward",
                "confidence": 0.0,
                "evidence": "zero-confidence edge",
            },
            # high-confidence: must NOT be tagged lowConfidence
            {
                "source": "module:svc_b",
                "target": "module:svc_a",
                "type": "event-dependency",
                "weight": 0.8,
                "direction": "forward",
                "confidence": 0.9,
                "evidence": "high-confidence edge",
            },
        ]
        (intermediate / "crossrepo-edges.json").write_text(json.dumps(edges), encoding="utf-8")

        result = run_apply(out)
        assert result.returncode == 0, f"apply-interlinks failed:\n{result.stderr}"

        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())
        cross = [e for e in kg["edges"] if e.get("id", "").startswith("x")]

        zero_edge = next(
            (e for e in cross if e.get("source") == "module:svc_a" and e.get("target") == "module:svc_b"),
            None,
        )
        assert zero_edge is not None, "zero-confidence edge was dropped (should be kept)"
        assert zero_edge.get("confidence") == 0.0, f"confidence not stored correctly: {zero_edge}"
        assert zero_edge.get("lowConfidence") is True, (
            f"confidence==0.0 edge must have lowConfidence:true, got: {zero_edge}"
        )

        high_edge = next(
            (e for e in cross if e.get("source") == "module:svc_b" and e.get("target") == "module:svc_a"),
            None,
        )
        assert high_edge is not None, "high-confidence edge was dropped"
        assert not high_edge.get("lowConfidence"), (
            f"confidence==0.9 edge must NOT have lowConfidence, got: {high_edge}"
        )


def test_dashboard_schema_requirements():
    """Lock the e2e-found fixes: the assembled graph must satisfy the dashboard's
    stricter core/schema.ts (which the inline .cjs does NOT check):
      - project carries analyzedAt + gitCommitHash
      - every node has a valid `complexity`
      - a string `lineRange` (some per-repo graphs store it as a string) is dropped
        rather than left to fail node validation (which cascades to dropped edges)
      - linker edge types not in the schema enum (authenticates_via/embeds) are
        mapped to an allowed type with the original semantic kept in `description`.
    """
    with tempfile.TemporaryDirectory() as tmp_str:
        out = Path(tmp_str) / "out"
        intermediate = out / ".understand-anything" / "intermediate"
        intermediate.mkdir(parents=True, exist_ok=True)
        graph = {
            "version": "1.0.0",
            "project": {"name": "x", "languages": [], "frameworks": [], "description": "d"},
            "nodes": [
                {  # malformed lineRange (string) + missing complexity
                    "id": "file:svc_a/m.py", "type": "file", "name": "m.py",
                    "filePath": "svc_a/m.py", "summary": "s", "tags": ["repo:svc_a"],
                    "repo": "svc_a", "lineRange": "1-50",
                },
                {"id": "module:svc_a", "type": "module", "name": "svc_a",
                 "summary": "anchor", "tags": ["repo:svc_a"], "repo": "svc_a"},
            ],
            "edges": [{"source": "module:svc_a", "target": "file:svc_a/m.py",
                       "type": "contains", "direction": "forward", "weight": 0.8}],
            "layers": [{"id": "layer:svc_a", "name": "svc_a", "description": "l",
                        "nodeIds": ["file:svc_a/m.py", "module:svc_a"]}],
        }
        (intermediate / "combined-graph.json").write_text(json.dumps(graph), encoding="utf-8")
        (intermediate / "crossrepo-edges.json").write_text(json.dumps([
            {"source": "module:svc_a", "target": "external:keycloak",
             "type": "authenticates_via", "label": "svc_a auth via Keycloak",
             "weight": 0.8, "direction": "forward", "confidence": 0.9, "evidence": "OIDC"},
        ]), encoding="utf-8")

        proc = run_apply(out)
        assert proc.returncode == 0, f"apply failed: {proc.stderr}"
        kg = json.loads((out / ".understand-anything" / "knowledge-graph.json").read_text())

        # project metadata required by core/schema.ts ProjectMetaSchema
        assert kg["project"].get("analyzedAt"), "project.analyzedAt missing"
        assert kg["project"].get("gitCommitHash"), "project.gitCommitHash missing"

        # every node must have a valid complexity; no node may carry a string lineRange
        for n in kg["nodes"]:
            assert n.get("complexity") in ("simple", "moderate", "complex"), \
                f"node {n['id']} bad complexity: {n.get('complexity')}"
            lr = n.get("lineRange")
            assert lr is None or (isinstance(lr, list) and len(lr) == 2), \
                f"node {n['id']} has invalid lineRange survived: {lr}"
        bad = next(n for n in kg["nodes"] if n["id"] == "file:svc_a/m.py")
        assert "lineRange" not in bad, "string lineRange should have been dropped"

        # authenticates_via must be remapped to an allowed type with semantic in description
        auth = next(e for e in kg["edges"] if e.get("target") == "service:external/keycloak")
        assert auth["type"] == "depends_on", f"expected mapped depends_on, got {auth['type']}"
        assert "authenticates_via" in (auth.get("description") or ""), \
            f"original type not preserved in description: {auth.get('description')}"


if __name__ == "__main__":
    tests = [
        test_dashboard_schema_requirements,
        test_external_node_and_layer_created,
        test_dangling_edge_dropped,
        test_valid_and_external_edges_present,
        test_validator_zero_issues,
        test_meta_json_written,
        test_dedup_edges,
        test_zero_confidence_tagged_low_confidence,
    ]
    passed = failed = 0
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
