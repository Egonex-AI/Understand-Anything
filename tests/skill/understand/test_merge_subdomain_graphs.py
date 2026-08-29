#!/usr/bin/env python3
"""
test_merge_subdomain_graphs.py — Tests for structural-edge drop reporting
and cross-run recovery in merge-subdomain-graphs.py (issue #529).

Run from the repo root:
    python -m unittest tests.skill.understand.test_merge_subdomain_graphs -v
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


# ── Module loader ─────────────────────────────────────────────────────────
# `merge-subdomain-graphs.py` has hyphens in its name, so we cannot `import`
# it directly. Load it via importlib so we can call its module-level helpers.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand"
    / "merge-subdomain-graphs.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("merge_subdomain_graphs", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["merge_subdomain_graphs"] = module
    spec.loader.exec_module(module)
    return module


msg = _load_module()


# ── Helpers ───────────────────────────────────────────────────────────────

def _node(nid: str) -> dict[str, Any]:
    return {
        "id": nid,
        "type": "domain",
        "name": nid,
        "summary": "",
        "tags": [],
        "complexity": "simple",
    }


def _edge(src: str, tgt: str, etype: str) -> dict[str, Any]:
    return {"source": src, "target": tgt, "type": etype, "direction": "forward", "weight": 0.8}


def _graph(nodes: list[dict], edges: list[dict]) -> dict[str, Any]:
    return {"nodes": nodes, "edges": edges, "layers": [], "tour": [], "project": {}}


# ── Tests ─────────────────────────────────────────────────────────────────

class TestStructuralEdgeDrops(unittest.TestCase):
    def test_structural_drop_emits_warning_and_is_recorded(self) -> None:
        g = _graph([_node("domain:auth")], [_edge("domain:auth", "flow:login", "contains_flow")])
        merged, report, dropped = msg.merge_graphs([g])

        self.assertEqual(merged["edges"], [])
        self.assertEqual(len(dropped), 1)
        self.assertEqual(dropped[0]["type"], "contains_flow")
        self.assertIn("target 'flow:login'", dropped[0]["missing"][0])
        warnings = [line for line in report if line.startswith("Warning: dropped structural edge")]
        self.assertEqual(len(warnings), 1)
        self.assertIn("contains_flow", warnings[0])

    def test_non_structural_drop_stays_in_could_not_fix(self) -> None:
        g = _graph([_node("domain:auth")], [_edge("domain:auth", "file:gone.py", "related")])
        merged, report, dropped = msg.merge_graphs([g])

        self.assertEqual(len(dropped), 1)
        self.assertFalse(any(line.startswith("Warning: dropped structural edge") for line in report))
        self.assertTrue(any("Could not fix" in line for line in report))

    def test_valid_edges_are_untouched(self) -> None:
        g = _graph(
            [_node("domain:auth"), _node("flow:login")],
            [_edge("domain:auth", "flow:login", "contains_flow")],
        )
        merged, _report, dropped = msg.merge_graphs([g])
        self.assertEqual(len(merged["edges"]), 1)
        self.assertEqual(dropped, [])


class TestCrossRunRecovery(unittest.TestCase):
    def test_dropped_structural_edge_recovers_when_endpoint_arrives(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "merge-report.json"

            # Run 1: cross_domain edge whose target subdomain doesn't exist yet.
            g1 = _graph([_node("domain:auth")], [_edge("domain:auth", "domain:billing", "cross_domain")])
            merged1, _r1, dropped1 = msg.merge_graphs([g1])
            msg.write_merge_report(report_path, merged1, dropped1, 0)

            # Run 2: the billing subdomain graph has arrived; the pending edge
            # is re-injected exactly the way main() does it.
            pending = msg.load_pending_structural_edges(report_path)
            self.assertEqual(len(pending), 1)
            self.assertNotIn("missing", pending[0])

            g2 = _graph([_node("domain:auth"), _node("domain:billing")], [])
            merged2, _r2, dropped2 = msg.merge_graphs([g2, {"nodes": [], "edges": pending}])

            self.assertEqual(dropped2, [])
            self.assertEqual(len(merged2["edges"]), 1)
            self.assertEqual(merged2["edges"][0]["type"], "cross_domain")

    def test_non_structural_dropped_edges_are_not_retried(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "merge-report.json"
            g = _graph([_node("domain:auth")], [_edge("domain:auth", "file:gone.py", "related")])
            merged, _report, dropped = msg.merge_graphs([g])
            msg.write_merge_report(report_path, merged, dropped, 0)

            # The related edge is persisted for investigation but not re-injected.
            data = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(len(data["droppedEdges"]), 1)
            self.assertEqual(msg.load_pending_structural_edges(report_path), [])

    def test_missing_or_corrupt_report_yields_no_pending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "merge-report.json"
            self.assertEqual(msg.load_pending_structural_edges(missing), [])
            missing.write_text("{not json", encoding="utf-8")
            self.assertEqual(msg.load_pending_structural_edges(missing), [])


if __name__ == "__main__":
    unittest.main()
