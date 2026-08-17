#!/usr/bin/env python3
"""
test_graph_query_helpers.py — Unit tests for graph-query.py's pure helpers.

Run from the repo root:
    python -m unittest tests.skill.diff.test_graph_query_helpers -v

These need no database and no optional dependency, so unlike the integration
tests in test_graph_query.py they always execute. The module is importable
without a backend because every driver import sits inside the function that
uses it.
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
# `graph-query.py` has a hyphen in its name, so we cannot `import` it directly.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-diff"
    / "graph-query.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("graph_query", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["graph_query"] = module
    spec.loader.exec_module(module)
    return module


gq = _load_module()


class SafeTypeTests(unittest.TestCase):
    """Types become Cypher labels and relationship types, which cannot be
    parameterised, so they are validated rather than escaped."""

    def test_plain_identifiers_pass_through(self) -> None:
        for value in ("file", "function", "defines_schema", "Component", "_x9"):
            self.assertEqual(gq.safe_type(value, "node"), value)

    def test_injection_attempts_are_refused(self) -> None:
        hostile = [
            "file) MATCH (n) DETACH DELETE n //",
            "imports] () //",
            "a b",
            "a-b",
            "a.b",
            "a`b",
            "",
            "1leading_digit",
        ]
        for value in hostile:
            with self.subTest(value=value):
                with self.assertRaises(SystemExit):
                    gq.safe_type(value, "node")

    def test_non_strings_are_refused(self) -> None:
        for value in (None, 7, ["file"]):
            with self.subTest(value=value):
                with self.assertRaises(SystemExit):
                    gq.safe_type(value, "node")

    def test_the_message_names_the_kind(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            gq.safe_type("a b", "edge")
        self.assertIn("edge", str(caught.exception))


class LabelTests(unittest.TestCase):
    def test_snake_case_becomes_pascal_case(self) -> None:
        self.assertEqual(gq.label_for("file"), "File")
        self.assertEqual(gq.label_for("component_set"), "ComponentSet")
        self.assertEqual(gq.label_for("defines_schema"), "DefinesSchema")

    def test_relationship_types_are_upper_case(self) -> None:
        self.assertEqual(gq.rel_for("imports"), "IMPORTS")
        self.assertEqual(gq.rel_for("depends_on"), "DEPENDS_ON")

    def test_labels_are_validated_too(self) -> None:
        with self.assertRaises(SystemExit):
            gq.label_for("file) //")


class DigestTests(unittest.TestCase):
    """Digests decide what gets resynced, so stability is the whole point."""

    def test_same_payload_gives_same_digest(self) -> None:
        self.assertEqual(gq.digest({"a": 1, "b": [2, 3]}),
                         gq.digest({"a": 1, "b": [2, 3]}))

    def test_key_order_does_not_matter(self) -> None:
        self.assertEqual(gq.digest({"a": 1, "b": 2}), gq.digest({"b": 2, "a": 1}))

    def test_list_order_does_matter(self) -> None:
        """Callers sort before digesting; the digest itself must stay faithful."""
        self.assertNotEqual(gq.digest([1, 2]), gq.digest([2, 1]))

    def test_a_changed_value_changes_the_digest(self) -> None:
        self.assertNotEqual(gq.digest({"summary": "x"}), gq.digest({"summary": "y"}))

    def test_digests_are_short_and_hex(self) -> None:
        value = gq.digest({"a": 1})
        self.assertEqual(len(value), 16)
        int(value, 16)  # raises if not hex


class LayersContainingTests(unittest.TestCase):
    LAYERS = [
        {"id": "core", "name": "Core", "description": "shared",
         "nodeIds": ["file:a.ts", "file:b.ts"]},
        {"id": "ui", "name": "UI", "description": "views",
         "nodeIds": ["file:c.tsx"]},
    ]

    def test_only_layers_with_a_match_are_returned(self) -> None:
        out = gq.layers_containing(self.LAYERS, ["file:c.tsx"])
        self.assertEqual([l["name"] for l in out], ["UI"])

    def test_matches_are_named_and_sorted(self) -> None:
        out = gq.layers_containing(self.LAYERS, ["file:b.ts", "file:a.ts"])
        self.assertEqual(out[0]["matched"], ["file:a.ts", "file:b.ts"])

    def test_no_overlap_returns_nothing(self) -> None:
        self.assertEqual(gq.layers_containing(self.LAYERS, ["file:zz.ts"]), [])

    def test_missing_or_empty_layers_are_tolerated(self) -> None:
        self.assertEqual(gq.layers_containing([], ["file:a.ts"]), [])
        self.assertEqual(gq.layers_containing(None, ["file:a.ts"]), [])
        self.assertEqual(gq.layers_containing([{"id": "x"}], ["file:a.ts"]), [])


class FindGraphJsonTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def _write(self, directory: str) -> Path:
        target = self.root / directory
        target.mkdir(parents=True)
        path = target / "knowledge-graph.json"
        path.write_text("{}")
        return path

    def test_finds_the_current_directory_name(self) -> None:
        expected = self._write(".ua")
        self.assertEqual(gq.find_graph_json(self.root), expected)

    def test_legacy_directory_wins_when_both_exist(self) -> None:
        """Projects analysed before the rename keep reading their old directory."""
        self._write(".ua")
        legacy = self._write(".understand-anything")
        self.assertEqual(gq.find_graph_json(self.root), legacy)

    def test_absence_points_at_understand(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            gq.find_graph_json(self.root)
        self.assertIn("/understand", str(caught.exception))


class EmbedTextTests(unittest.TestCase):
    def test_name_summary_and_tags_are_combined(self) -> None:
        text = gq.Embedder.text_for(
            {"name": "isStale", "summary": "checks freshness", "tags": ["git", "cache"]})
        for part in ("isStale", "checks freshness", "git", "cache"):
            self.assertIn(part, text)

    def test_long_summaries_are_truncated(self) -> None:
        text = gq.Embedder.text_for({"name": "n", "summary": "x" * 500, "tags": []})
        self.assertLess(len(text), 300)

    def test_missing_fields_do_not_raise(self) -> None:
        self.assertEqual(gq.Embedder.text_for({}), "")
        self.assertEqual(gq.Embedder.text_for({"name": "n", "summary": None}), "n")


class RowShapeTests(unittest.TestCase):
    """Every node row must carry the same keys, or the batched UNWIND writes
    would set different properties per row."""

    def test_line_range_is_split_into_two_columns(self) -> None:
        row = gq.RepoGraph._row_for(
            {"id": "x", "type": "file", "lineRange": [3, 9]}, "src/x.ts")
        self.assertEqual((row["lineStart"], row["lineEnd"]), (3, 9))

    def test_a_missing_line_range_becomes_sentinels(self) -> None:
        row = gq.RepoGraph._row_for({"id": "x", "type": "file"}, "src/x.ts")
        self.assertEqual((row["lineStart"], row["lineEnd"]), (-1, -1))

    def test_a_malformed_line_range_becomes_sentinels(self) -> None:
        row = gq.RepoGraph._row_for(
            {"id": "x", "type": "file", "lineRange": [5]}, "src/x.ts")
        self.assertEqual((row["lineStart"], row["lineEnd"]), (-1, -1))

    def test_rows_always_have_the_same_keys(self) -> None:
        sparse = gq.RepoGraph._row_for({"id": "a", "type": "file"}, "k")
        full = gq.RepoGraph._row_for(
            {"id": "b", "type": "function", "name": "f", "filePath": "p",
             "summary": "s", "tags": ["t"], "complexity": "complex",
             "lineRange": [1, 2]}, "k")
        self.assertEqual(sorted(sparse), sorted(full))

    def test_the_grouping_key_is_carried(self) -> None:
        row = gq.RepoGraph._row_for({"id": "x", "type": "file"}, "src/x.ts")
        self.assertEqual(row["__key"], "src/x.ts")


if __name__ == "__main__":
    unittest.main(verbosity=2)
