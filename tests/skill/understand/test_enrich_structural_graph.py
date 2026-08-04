#!/usr/bin/env python3
"""
test_enrich_structural_graph.py — Tests for enrich-structural-graph.py
(schema-valid complexity/tags/summary enrichment for structural-only graphs).

Run from the repo root:
    python -m unittest tests.skill.understand.test_enrich_structural_graph -v
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
# `enrich-structural-graph.py` has hyphens in its name, so we cannot `import`
# it directly. Load it via importlib so we can call its module-level helpers.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand"
    / "enrich-structural-graph.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("enrich_structural_graph", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["enrich_structural_graph"] = module
    spec.loader.exec_module(module)
    return module


msg = _load_module()


# ── Helpers ───────────────────────────────────────────────────────────────

def _file_node(name: str, **overrides: Any) -> dict[str, Any]:
    node: dict[str, Any] = {
        "id": f"file:src/{name}",
        "type": "file",
        "name": name,
        "filePath": f"src/{name}",
        "language": "python",
        "fileCategory": "code",
        "sizeLines": 120,
    }
    node.update(overrides)
    return node


# ── Complexity ────────────────────────────────────────────────────────────

class TestComplexity(unittest.TestCase):
    def test_none_defaults_to_moderate(self) -> None:
        self.assertEqual(msg.complexity_for(None), "moderate")

    def test_simple_threshold(self) -> None:
        self.assertEqual(msg.complexity_for(0), "simple")
        self.assertEqual(msg.complexity_for(msg.COMPLEXITY_SIMPLE_MAX), "simple")

    def test_moderate_band(self) -> None:
        self.assertEqual(msg.complexity_for(msg.COMPLEXITY_SIMPLE_MAX + 1), "moderate")
        self.assertEqual(msg.complexity_for(msg.COMPLEXITY_MODERATE_MAX), "moderate")

    def test_complex_band(self) -> None:
        self.assertEqual(msg.complexity_for(msg.COMPLEXITY_MODERATE_MAX + 1), "complex")


# ── Tags ──────────────────────────────────────────────────────────────────

class TestTags(unittest.TestCase):
    def test_category_language_dir_and_type(self) -> None:
        node = _file_node("app.py")
        tags = msg.tags_for(node)
        self.assertIn("code", tags)
        self.assertIn("python", tags)
        self.assertIn("dir:src", tags)

    def test_test_marker(self) -> None:
        tags = msg.tags_for(_file_node("test_app.py"))
        self.assertIn("test", tags)

    def test_documentation_label(self) -> None:
        tags = msg.tags_for(_file_node("readme.md", language="markdown", fileCategory="docs"))
        self.assertIn("documentation", tags)

    def test_dedupes_tags(self) -> None:
        tags = msg.tags_for(_file_node("app.py", fileCategory="code"))
        self.assertEqual(len(tags), len(set(tags)))

    def test_non_file_type_tagged(self) -> None:
        node = _file_node("mod.py", type="module")
        self.assertIn("module", msg.tags_for(node))


# ── Summary ──────────────────────────────────────────────────────────────

class TestSummary(unittest.TestCase):
    def test_with_size(self) -> None:
        summary = msg.summary_for(_file_node("app.py", sizeLines=120))
        self.assertIn("Source code", summary)
        self.assertIn("app.py", summary)
        self.assertIn("120 lines", summary)
        self.assertIn("src", summary)

    def test_without_size(self) -> None:
        summary = msg.summary_for(_file_node("app.py", sizeLines=None))
        self.assertNotIn("lines", summary)


# ── enrich() ──────────────────────────────────────────────────────────────

class TestEnrich(unittest.TestCase):
    def test_fills_missing_fields_and_counts(self) -> None:
        graph = {"nodes": [_file_node("app.py", complexity="simple", tags=["x"], summary="s"),
                           _file_node("bare.py", sizeLines=120)]}
        stats = msg.enrich(graph)
        node = graph["nodes"][1]
        self.assertEqual(stats["complexity"], 1)
        self.assertEqual(stats["tags"], 1)
        self.assertEqual(stats["summary"], 1)
        self.assertEqual(node["complexity"], "moderate")
        self.assertTrue(node["tags"])
        self.assertTrue(node["summary"])

    def test_does_not_overwrite_existing_fields(self) -> None:
        node = _file_node("app.py", complexity="complex", tags=["hand"], summary="handwritten")
        stats = msg.enrich({"nodes": [node]})
        self.assertEqual(stats, {})
        self.assertEqual(node["complexity"], "complex")
        self.assertEqual(node["tags"], ["hand"])
        self.assertEqual(node["summary"], "handwritten")

    def test_skips_non_dict_nodes(self) -> None:
        graph = {"nodes": [{"id": "x"}, "not-a-dict", None]}
        stats = msg.enrich(graph)
        self.assertEqual(stats["complexity"], 1)


# ── main() round-trip + UTF-8 ─────────────────────────────────────────────

class TestMainRoundTrip(unittest.TestCase):
    def test_write_read_round_trip_utf8(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            graph_path = Path(tmp) / "knowledge-graph.json"
            graph = {"nodes": [_file_node("app.py"), _file_node("übersicht.md",
                                                                language="markdown",
                                                                fileCategory="docs",
                                                                sizeLines=10)]}
            for node in graph["nodes"]:
                node.pop("complexity", None)
                node.pop("tags", None)
                node.pop("summary", None)
            graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

            old_argv = sys.argv
            sys.argv = [str(_MODULE_PATH), str(graph_path), "--write"]
            try:
                exit_code = msg.main()
            finally:
                sys.argv = old_argv
            self.assertEqual(exit_code, 0)

            written = json.loads(graph_path.read_text(encoding="utf-8"))
            self.assertEqual(len(written["nodes"]), 2)
            for node in written["nodes"]:
                self.assertIn("complexity", node)
                self.assertIn("tags", node)
                self.assertIn("summary", node)
            markdown = next(n for n in written["nodes"] if n["name"] == "übersicht.md")
            self.assertEqual(markdown["complexity"], "simple")

    def test_usage_when_no_args(self) -> None:
        old_argv = sys.argv
        sys.argv = [str(_MODULE_PATH)]
        try:
            self.assertEqual(msg.main(), 2)
        finally:
            sys.argv = old_argv