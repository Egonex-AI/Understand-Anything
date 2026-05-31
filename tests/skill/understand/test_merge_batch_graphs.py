#!/usr/bin/env python3
"""
test_merge_batch_graphs.py — Tests for the deterministic tested_by linker.

Run from the repo root:
    python -m unittest tests.skill.understand.test_merge_batch_graphs -v
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any


# ── Module loader ─────────────────────────────────────────────────────────
# `merge-batch-graphs.py` has a hyphen in its name, so we cannot `import` it
# directly. Load it via importlib so we can call its module-level helpers.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand"
    / "merge-batch-graphs.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("merge_batch_graphs", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["merge_batch_graphs"] = module
    spec.loader.exec_module(module)
    return module


mbg = _load_module()


# ── Helpers ───────────────────────────────────────────────────────────────

def _file_node(path: str, **extra: Any) -> dict[str, Any]:
    """Build a minimal file node with the given relative path."""
    node: dict[str, Any] = {
        "id": f"file:{path}",
        "type": "file",
        "name": path.rsplit("/", 1)[-1],
        "filePath": path,
        "summary": "",
        "tags": [],
        "complexity": "simple",
    }
    node.update(extra)
    return node


# ── is_test_path ──────────────────────────────────────────────────────────

class IsTestPathTests(unittest.TestCase):
    """Path classification: production vs. test."""

    def test_js_ts_sibling_test_extensions(self) -> None:
        for path in [
            "src/foo.test.ts",
            "src/foo.test.tsx",
            "src/foo.test.js",
            "src/foo.test.jsx",
            "src/foo.test.mjs",
            "src/foo.test.cjs",
            "src/Component.test.vue",
            "src/foo.spec.ts",
            "src/foo.spec.tsx",
            "src/foo.spec.js",
            "src/Component.spec.vue",
        ]:
            with self.subTest(path=path):
                self.assertTrue(mbg.is_test_path(path), f"{path} should be a test")

    def test_underscore_test_dir_with_test_extension(self) -> None:
        self.assertTrue(mbg.is_test_path("src/__tests__/foo.test.js"))
        self.assertTrue(mbg.is_test_path("src/__tests__/foo.test.ts"))

    def test_tests_directory_with_test_extension(self) -> None:
        self.assertTrue(mbg.is_test_path("tests/foo/X.test.ts"))
        self.assertTrue(mbg.is_test_path("test/foo/X.test.ts"))
        self.assertTrue(mbg.is_test_path("spec/foo/X.spec.ts"))

    def test_go_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("internal/bar_test.go"))
        self.assertTrue(mbg.is_test_path("bar_test.go"))

    def test_python_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("tests/test_bar.py"))
        self.assertTrue(mbg.is_test_path("bar_test.py"))
        self.assertTrue(mbg.is_test_path("test_bar.py"))

    def test_java_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("src/test/java/com/foo/BarTest.java"))
        self.assertTrue(mbg.is_test_path("src/test/java/com/foo/BarTests.java"))
        self.assertTrue(mbg.is_test_path("src/test/java/com/foo/BarIT.java"))

    def test_kotlin_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("src/test/kotlin/com/foo/BarTest.kt"))
        self.assertTrue(mbg.is_test_path("src/test/kotlin/com/foo/BarTests.kt"))

    def test_csharp_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("Foo.Tests/BarTests.cs"))
        self.assertTrue(mbg.is_test_path("Foo.Tests/BarTest.cs"))

    def test_c_cpp_test_files(self) -> None:
        self.assertTrue(mbg.is_test_path("test/bar_test.c"))
        self.assertTrue(mbg.is_test_path("test/test_bar.c"))
        self.assertTrue(mbg.is_test_path("test/bar_test.cpp"))
        self.assertTrue(mbg.is_test_path("test/bar_test.cc"))
        self.assertTrue(mbg.is_test_path("test/test_bar.cpp"))

    def test_production_files_rejected(self) -> None:
        for path in [
            "src/foo.ts",
            "src/foo.tsx",
            "internal/bar.go",
            "src/index.tsx",
            "README.md",
            "docs/guide.md",
            "main.py",
            "src/foo/bar.js",
            "Foo.cs",
            "Bar.kt",
            "Bar.java",
        ]:
            with self.subTest(path=path):
                self.assertFalse(mbg.is_test_path(path), f"{path} should be production")

    def test_helper_in_tests_dir_without_test_extension_is_not_test(self) -> None:
        # Files that live inside a __tests__ directory but don't carry a test
        # extension are treated as helpers, not tests. We only count code files
        # whose basename matches a test pattern. Assets/non-code files in
        # tests/ are not flagged.
        self.assertFalse(mbg.is_test_path("src/__tests__/helpers.ts"))
        self.assertFalse(mbg.is_test_path("tests/fixtures/data.json"))


# ── production_candidates ─────────────────────────────────────────────────

class ProductionCandidatesTests(unittest.TestCase):
    """For each test path, what production paths should we try?"""

    def test_js_ts_sibling(self) -> None:
        cands = mbg.production_candidates("src/foo/X.test.ts")
        # Sibling de-infix should be in the candidate list, with .ts as the
        # most natural target. Several extensions are tried because a .test.ts
        # file might test a .tsx file.
        self.assertIn("src/foo/X.ts", cands)
        self.assertIn("src/foo/X.tsx", cands)

    def test_js_ts_spec_sibling(self) -> None:
        cands = mbg.production_candidates("src/foo/X.spec.tsx")
        self.assertIn("src/foo/X.tsx", cands)
        self.assertIn("src/foo/X.ts", cands)

    def test_underscore_tests_dir(self) -> None:
        cands = mbg.production_candidates("src/foo/__tests__/X.test.ts")
        # Walking out of __tests__/ should produce src/foo/X.ts
        self.assertIn("src/foo/X.ts", cands)

    def test_mirrored_tests_tree(self) -> None:
        cands = mbg.production_candidates("tests/foo/X.test.ts")
        # Should try src/foo/X.ts, app/foo/X.ts, lib/foo/X.ts, foo/X.ts
        self.assertIn("src/foo/X.ts", cands)
        self.assertIn("foo/X.ts", cands)

    def test_go_sibling(self) -> None:
        cands = mbg.production_candidates("internal/bar_test.go")
        self.assertIn("internal/bar.go", cands)

    def test_python_test_prefix(self) -> None:
        cands = mbg.production_candidates("tests/test_bar.py")
        self.assertIn("tests/bar.py", cands)
        # Also try mirrored layout
        self.assertIn("bar.py", cands)
        self.assertIn("src/bar.py", cands)

    def test_python_test_suffix(self) -> None:
        cands = mbg.production_candidates("foo/bar_test.py")
        self.assertIn("foo/bar.py", cands)

    def test_java_maven_layout(self) -> None:
        cands = mbg.production_candidates("src/test/java/com/foo/BarTest.java")
        self.assertIn("src/main/java/com/foo/Bar.java", cands)

    def test_java_tests_suffix(self) -> None:
        cands = mbg.production_candidates("src/test/java/com/foo/BarTests.java")
        self.assertIn("src/main/java/com/foo/Bar.java", cands)

    def test_java_it_suffix(self) -> None:
        cands = mbg.production_candidates("src/test/java/com/foo/BarIT.java")
        self.assertIn("src/main/java/com/foo/Bar.java", cands)

    def test_kotlin_maven_layout(self) -> None:
        cands = mbg.production_candidates("src/test/kotlin/com/foo/BarTest.kt")
        self.assertIn("src/main/kotlin/com/foo/Bar.kt", cands)

    def test_js_ts_test_subdir_walkout(self) -> None:
        # Some JS/TS projects use `<dir>/test/` or `<dir>/spec/` instead of
        # the more idiomatic `__tests__/`. Walk out of either.
        cands_test = mbg.production_candidates("src/foo/test/X.test.ts")
        self.assertIn("src/foo/X.ts", cands_test)
        cands_spec = mbg.production_candidates("src/foo/spec/X.spec.ts")
        self.assertIn("src/foo/X.ts", cands_spec)

    def test_python_in_package_tests_walkout(self) -> None:
        # `mypkg/tests/test_bar.py` (Django-app style) should pair with
        # `mypkg/bar.py` — walk out of the in-package tests/ dir.
        cands = mbg.production_candidates("mypkg/tests/test_bar.py")
        self.assertIn("mypkg/bar.py", cands)
        # Also nested:
        cands_nested = mbg.production_candidates("a/b/test/test_bar.py")
        self.assertIn("a/b/bar.py", cands_nested)

    def test_csharp_tests_subdir_mirror_to_src(self) -> None:
        # Real case from microservices-demo cartservice:
        # `src/cartservice/tests/CartServiceTests.cs` ↔
        # `src/cartservice/src/services/CartService.cs`. The candidate list
        # only knows the basename; the matcher must produce a parent-level
        # candidate that the linker can verify against the actual file index.
        cands = mbg.production_candidates(
            "src/cartservice/tests/CartServiceTests.cs"
        )
        # Drop tests/ entirely:
        self.assertIn("src/cartservice/CartService.cs", cands)
        # Mirror through `src/`:
        self.assertIn("src/cartservice/src/CartService.cs", cands)
        # Sibling fallback retained:
        self.assertIn("src/cartservice/tests/CartService.cs", cands)

    def test_csharp_dotnet_sibling_project_mirror(self) -> None:
        # `.NET` convention: `MyApp.Tests/Foo/BarTests.cs` ↔
        # `MyApp/Foo/Bar.cs`. Strip the `.Tests` suffix from the top dir
        # and try the same tail under the sibling project.
        cands = mbg.production_candidates("MyApp.Tests/Foo/BarTests.cs")
        self.assertIn("MyApp/Foo/Bar.cs", cands)
        # Also `.Test` (singular) is sometimes used.
        cands_singular = mbg.production_candidates("MyApp.Test/BarTest.cs")
        self.assertIn("MyApp/Bar.cs", cands_singular)

    def test_priority_underscore_tests_sibling_before_walkup(self) -> None:
        # When a test sits in `src/__tests__/`, the sibling-de-infix path
        # (same directory) ranks before the walk-out path (parent directory).
        # This is load-bearing: if a project happens to have both
        # `src/__tests__/X.ts` and `src/X.ts`, we should pair with the
        # nearer one.
        cands = mbg.production_candidates("src/__tests__/X.test.ts")
        self.assertEqual(cands[0], "src/__tests__/X.ts")
        self.assertIn("src/X.ts", cands)
        self.assertLess(cands.index("src/__tests__/X.ts"), cands.index("src/X.ts"))

    def test_priority_mirrored_tree_sibling_before_mirror(self) -> None:
        # `tests/foo/X.test.ts` sibling path is `tests/foo/X.ts`, which must
        # rank above the mirrored `src/foo/X.ts` variant. Same rationale:
        # closer pairing wins.
        cands = mbg.production_candidates("tests/foo/X.test.ts")
        self.assertEqual(cands[0], "tests/foo/X.ts")
        self.assertIn("src/foo/X.ts", cands)
        self.assertLess(cands.index("tests/foo/X.ts"), cands.index("src/foo/X.ts"))


# ── link_tests (end-to-end) ───────────────────────────────────────────────

class LinkTestsTests(unittest.TestCase):
    """End-to-end behaviour of the linker against a node/edge set."""

    def test_basic_pairing_emits_forward_edge(self) -> None:
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 1)
        self.assertEqual(dropped, 0)
        self.assertEqual(tagged, 1)
        self.assertEqual(swapped, 0)
        self.assertEqual(len(edges), 1)
        edge = edges[0]
        self.assertEqual(edge["source"], "file:src/foo.ts")
        self.assertEqual(edge["target"], "file:src/foo.test.ts")
        self.assertEqual(edge["type"], "tested_by")
        self.assertEqual(edge["direction"], "forward")
        self.assertEqual(edge["weight"], 0.5)
        self.assertIn("tested", nodes_by_id["file:src/foo.ts"]["tags"])
        # Test node is not tagged with "tested"
        self.assertNotIn("tested", nodes_by_id["file:src/foo.test.ts"]["tags"])

    def test_no_production_counterpart_no_edge(self) -> None:
        nodes_by_id = {
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 0)
        self.assertEqual(tagged, 0)
        self.assertEqual(swapped, 0)
        self.assertEqual(len(edges), 0)

    def test_inverted_llm_edge_is_swapped_not_stripped(self) -> None:
        # The LLM systematically emits tested_by edges as test → production
        # (it sees the import only when analyzing the test file). The pairing
        # is real evidence; we keep it and flip the direction in place.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.test.ts",
                "target": "file:src/foo.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
                "description": "from LLM",
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        # No supplement needed (the LLM edge already covers this pair).
        self.assertEqual(added, 0)
        self.assertEqual(swapped, 1)
        self.assertEqual(dropped, 0)
        self.assertEqual(tagged, 1)

        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        edge = tested_by_edges[0]
        self.assertEqual(edge["source"], "file:src/foo.ts")
        self.assertEqual(edge["target"], "file:src/foo.test.ts")
        # Provenance recorded so reviewers can audit the swap.
        self.assertIn("direction corrected", edge["description"].lower())

    def test_canonical_llm_edge_kept_unchanged(self) -> None:
        # An LLM edge already in canonical direction should pass through
        # untouched (no swap, no drop), and Pass 2 must not produce a
        # duplicate.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.ts",
                "target": "file:src/foo.test.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
                "description": "original",
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual((added, dropped, swapped), (0, 0, 0))
        self.assertEqual(tagged, 1)
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        self.assertEqual(tested_by_edges[0]["description"], "original")

    def test_drops_test_to_test_edge(self) -> None:
        # An LLM edge between two test files has no recoverable meaning.
        nodes_by_id = {
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
            "file:src/bar.test.ts": _file_node("src/bar.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.test.ts",
                "target": "file:src/bar.test.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 0)
        self.assertEqual(swapped, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(tagged, 0)
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(tested_by_edges, [])

    def test_drops_orphan_endpoint_edge(self) -> None:
        # Endpoint references a node that doesn't exist in nodes_by_id —
        # nothing to canonicalize against, drop it.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.ts",
                "target": "file:src/missing.test.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual((added, dropped, tagged, swapped), (0, 1, 0, 0))
        self.assertEqual([e for e in edges if e["type"] == "tested_by"], [])

    def test_dup_keeps_higher_weight_canonical(self) -> None:
        # Two canonical tested_by edges for the same pair, weights 0.3 and
        # 0.9. The heavier one must be kept — mirroring the weight-aware
        # dedup at Step 6 (which never sees the discarded duplicate).
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {"source": "file:src/foo.ts", "target": "file:src/foo.test.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.3},
            {"source": "file:src/foo.ts", "target": "file:src/foo.test.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.9},
        ]
        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)
        self.assertEqual((added, dropped, swapped), (0, 1, 0))
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        self.assertEqual(tested_by_edges[0]["weight"], 0.9)

    def test_dup_lighter_inverted_dropped_no_swap_counted(self) -> None:
        # Heavier canonical first, lighter inverted second. The lighter
        # inverted edge is dropped without being swapped — no point
        # canonicalizing an edge that's about to die in the dedup.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {"source": "file:src/foo.ts", "target": "file:src/foo.test.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.9},
            {"source": "file:src/foo.test.ts", "target": "file:src/foo.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.3},
        ]
        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)
        self.assertEqual((added, dropped, swapped), (0, 1, 0))
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        self.assertEqual(tested_by_edges[0]["weight"], 0.9)
        # Surviving edge is the original canonical — no audit marker.
        self.assertNotIn(
            "direction corrected",
            (tested_by_edges[0].get("description") or "").lower(),
        )

    def test_dup_replaces_with_heavier_inverted(self) -> None:
        # Lighter canonical first, heavier inverted second. The inverted
        # edge gets swapped AND replaces the kept slot, since it's heavier.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {"source": "file:src/foo.ts", "target": "file:src/foo.test.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.3},
            {"source": "file:src/foo.test.ts", "target": "file:src/foo.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.9},
        ]
        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)
        self.assertEqual(added, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(swapped, 1)  # surviving edge IS a swap
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        edge = tested_by_edges[0]
        self.assertEqual(edge["source"], "file:src/foo.ts")
        self.assertEqual(edge["target"], "file:src/foo.test.ts")
        self.assertEqual(edge["weight"], 0.9)
        self.assertIn("direction corrected", edge["description"].lower())

    def test_dup_swapped_then_canonical_heavier_clears_swapped_count(self) -> None:
        # Inverted lighter first (swap is applied, swapped_pairs={pair}),
        # then canonical heavier replaces — the surviving edge is canonical
        # so `swapped` must drop back to 0.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {"source": "file:src/foo.test.ts", "target": "file:src/foo.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.3},
            {"source": "file:src/foo.ts", "target": "file:src/foo.test.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.9},
        ]
        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)
        self.assertEqual(added, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(swapped, 0)  # surviving edge is canonical, not a swap
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        self.assertEqual(tested_by_edges[0]["weight"], 0.9)

    def test_dup_two_inverted_keeps_heavier_swapped_once(self) -> None:
        # Both inverted, different weights. The heavier one wins the slot
        # after both get swapped; `swapped` reflects the surviving edge,
        # not the wasted swap on the dropped lighter one.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {"source": "file:src/foo.test.ts", "target": "file:src/foo.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.3},
            {"source": "file:src/foo.test.ts", "target": "file:src/foo.ts",
             "type": "tested_by", "direction": "forward", "weight": 0.9},
        ]
        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)
        self.assertEqual(added, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(swapped, 1)
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        edge = tested_by_edges[0]
        self.assertEqual(edge["weight"], 0.9)
        self.assertIn("direction corrected", edge["description"].lower())

    def test_drops_duplicate_canonical_edges(self) -> None:
        # Two LLM edges describing the same (production, test) pair — keep
        # one, drop the other.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.ts",
                "target": "file:src/foo.test.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
            {
                "source": "file:src/foo.test.ts",
                "target": "file:src/foo.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 0)
        # First edge was canonical; second was inverted but described the
        # same pair → dropped as a duplicate (not a swap).
        self.assertEqual(dropped, 1)
        self.assertEqual(swapped, 0)
        self.assertEqual(tagged, 1)
        self.assertEqual(len([e for e in edges if e["type"] == "tested_by"]), 1)

    def test_supplement_skips_pair_already_covered_by_llm(self) -> None:
        # If the LLM (after swap) already covers a (production, test) pair
        # that a path-convention candidate would also produce, Pass 2 must
        # not emit a duplicate.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
            "file:src/bar.ts": _file_node("src/bar.ts"),
            "file:src/bar.test.ts": _file_node("src/bar.test.ts"),
        }
        # LLM only emitted (and inverted) the foo pair. The bar pair is
        # covered by Pass 2 (path convention).
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.test.ts",
                "target": "file:src/foo.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(swapped, 1)
        self.assertEqual(added, 1)  # only bar; foo is already covered
        self.assertEqual(dropped, 0)
        self.assertEqual(tagged, 2)
        tested_by_edges = sorted(
            [e for e in edges if e["type"] == "tested_by"],
            key=lambda e: e["source"],
        )
        self.assertEqual(len(tested_by_edges), 2)

    def test_swap_recovers_real_world_one_test_many_production(self) -> None:
        # Real case from microservices-demo: shippingservice_test.go does
        # not have a `shippingservice.go` sibling — it tests `main.go`,
        # `tracker.go`, and `quote.go`. Path convention can't pair these,
        # but the LLM saw the same-package usage and emitted the edges
        # (with wrong direction). Swap should recover them.
        nodes_by_id = {
            "file:src/shippingservice/main.go": _file_node("src/shippingservice/main.go"),
            "file:src/shippingservice/tracker.go": _file_node("src/shippingservice/tracker.go"),
            "file:src/shippingservice/quote.go": _file_node("src/shippingservice/quote.go"),
            "file:src/shippingservice/shippingservice_test.go": _file_node("src/shippingservice/shippingservice_test.go"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/shippingservice/shippingservice_test.go",
                "target": "file:src/shippingservice/main.go",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
            {
                "source": "file:src/shippingservice/shippingservice_test.go",
                "target": "file:src/shippingservice/tracker.go",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
        ]

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(swapped, 2)
        # Pass 2 fallback: the test file with no shippingservice.go sibling
        # produces no path-convention candidate — we rely entirely on swap.
        self.assertEqual(added, 0)
        self.assertEqual(dropped, 0)
        # main.go and tracker.go were tagged; quote.go was not (LLM didn't
        # emit an edge for it, and there's no path-convention pair).
        self.assertEqual(tagged, 2)
        self.assertIn("tested", nodes_by_id["file:src/shippingservice/main.go"]["tags"])
        self.assertIn("tested", nodes_by_id["file:src/shippingservice/tracker.go"]["tags"])
        self.assertNotIn("tested", nodes_by_id["file:src/shippingservice/quote.go"]["tags"])

    def test_unrelated_edges_pass_through(self) -> None:
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.test.ts",
                "target": "file:src/foo.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
            },
            {
                "source": "file:src/foo.ts",
                "target": "file:src/foo.test.ts",
                "type": "imports",
                "direction": "forward",
                "weight": 0.7,
            },
        ]

        mbg.link_tests(nodes_by_id, edges)

        import_edges = [e for e in edges if e["type"] == "imports"]
        self.assertEqual(len(import_edges), 1)
        self.assertEqual(import_edges[0]["source"], "file:src/foo.ts")
        self.assertEqual(import_edges[0]["target"], "file:src/foo.test.ts")
        self.assertEqual(import_edges[0]["weight"], 0.7)

    def test_direction_always_forward_production_to_test(self) -> None:
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/__tests__/foo.test.ts": _file_node("src/__tests__/foo.test.ts"),
            "file:internal/bar.go": _file_node("internal/bar.go"),
            "file:internal/bar_test.go": _file_node("internal/bar_test.go"),
            "file:src/main/java/com/foo/Bar.java": _file_node("src/main/java/com/foo/Bar.java"),
            "file:src/test/java/com/foo/BarTest.java": _file_node("src/test/java/com/foo/BarTest.java"),
        }
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 3)
        for edge in edges:
            self.assertEqual(edge["type"], "tested_by")
            self.assertEqual(edge["direction"], "forward")
            # Target must be the test file (basename gives it away)
            self.assertTrue(
                mbg.is_test_path(edge["target"][len("file:"):]),
                f"target {edge['target']} should classify as test",
            )
            self.assertFalse(
                mbg.is_test_path(edge["source"][len("file:"):]),
                f"source {edge['source']} should classify as production",
            )

    def test_idempotent(self) -> None:
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        mbg.link_tests(nodes_by_id, edges)
        # Second invocation must not duplicate edges or tags. The first run
        # added a canonical supplement edge; the second sees it as canonical
        # in Pass 1 and keeps it without flipping or duplicating.
        added2, dropped2, tagged2, swapped2 = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual((added2, dropped2, swapped2), (0, 0, 0))
        # Tag was already present, so tagged counter for second call is 0.
        self.assertEqual(tagged2, 0)
        tested_by_edges = [e for e in edges if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        tags = nodes_by_id["file:src/foo.ts"]["tags"]
        self.assertEqual(tags.count("tested"), 1)

    def test_first_matching_candidate_wins(self) -> None:
        # If both src/foo.ts and src/foo.tsx exist, the linker should match
        # exactly one of them (the first candidate). Sibling de-infix yields
        # .ts before .tsx (since the test is named foo.test.ts).
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.tsx": _file_node("src/foo.tsx"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 1)
        self.assertEqual(tagged, 1)
        # Only one of them gets tagged.
        ts_tagged = "tested" in nodes_by_id["file:src/foo.ts"]["tags"]
        tsx_tagged = "tested" in nodes_by_id["file:src/foo.tsx"]["tags"]
        self.assertTrue(ts_tagged != tsx_tagged, "exactly one should be tagged")
        # The .ts file should win (it matches the test-file extension).
        self.assertTrue(ts_tagged)

    def test_does_not_match_test_to_test(self) -> None:
        # If only test files exist, no edges are produced — we never link a
        # test to another test.
        nodes_by_id = {
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
            "file:src/foo.spec.ts": _file_node("src/foo.spec.ts"),
        }
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 0)
        self.assertEqual(tagged, 0)

    def test_does_not_duplicate_existing_tag(self) -> None:
        # Production node already carries the "tested" tag — linker should
        # not duplicate it.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts", tags=["tested", "core"]),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        mbg.link_tests(nodes_by_id, edges)

        tags = nodes_by_id["file:src/foo.ts"]["tags"]
        self.assertEqual(tags.count("tested"), 1)
        self.assertIn("core", tags)

    def test_empty_input(self) -> None:
        edges: list[dict[str, Any]] = []
        added, dropped, tagged, swapped = mbg.link_tests({}, edges)
        self.assertEqual((added, dropped, tagged, swapped), (0, 0, 0, 0))
        self.assertEqual(edges, [])

    def test_node_without_filepath_falls_back_to_id(self) -> None:
        # A file node with only `id` (no `filePath`) should still pair via
        # the path embedded in the ID.
        prod = {"id": "file:src/foo.ts", "type": "file", "name": "foo.ts", "tags": []}
        test = {
            "id": "file:src/foo.test.ts",
            "type": "file",
            "name": "foo.test.ts",
            "tags": [],
        }
        nodes_by_id = {prod["id"]: prod, test["id"]: test}
        edges: list[dict[str, Any]] = []

        added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual((added, dropped, tagged, swapped), (1, 0, 1, 0))
        self.assertEqual(edges[0]["source"], "file:src/foo.ts")
        self.assertEqual(edges[0]["target"], "file:src/foo.test.ts")
        self.assertIn("tested", prod["tags"])

    def test_malformed_tags_is_replaced_not_crashed(self) -> None:
        # Raw LLM batch JSON can ship `tags` as None, a string, or other
        # non-list values — the TypeScript autoFixGraph normalizer runs
        # downstream of this script. The linker must coerce instead of crash.
        for bad_tags in (None, "tested,foo", "single", 0, {"k": "v"}):
            with self.subTest(bad_tags=bad_tags):
                prod = {
                    "id": "file:src/foo.ts",
                    "type": "file",
                    "name": "foo.ts",
                    "filePath": "src/foo.ts",
                    "tags": bad_tags,
                }
                test = _file_node("src/foo.test.ts")
                nodes_by_id = {prod["id"]: prod, test["id"]: test}
                edges: list[dict[str, Any]] = []

                added, dropped, tagged, swapped = mbg.link_tests(nodes_by_id, edges)

                self.assertEqual((added, dropped, tagged, swapped), (1, 0, 1, 0))
                self.assertEqual(prod["tags"], ["tested"])


# ── merge_and_normalize integration ───────────────────────────────────────

class MergeIntegrationTests(unittest.TestCase):
    """Verify the linker is wired into merge_and_normalize correctly."""

    def test_linker_runs_during_merge(self) -> None:
        batch = {
            "nodes": [
                {
                    "id": "file:src/foo.ts",
                    "type": "file",
                    "name": "foo.ts",
                    "filePath": "src/foo.ts",
                    "summary": "",
                    "tags": [],
                    "complexity": "simple",
                },
                {
                    "id": "file:src/foo.test.ts",
                    "type": "file",
                    "name": "foo.test.ts",
                    "filePath": "src/foo.test.ts",
                    "summary": "",
                    "tags": [],
                    "complexity": "simple",
                },
            ],
            "edges": [
                # An LLM-emitted (inverted) tested_by edge — should be dropped
                {
                    "source": "file:src/foo.test.ts",
                    "target": "file:src/foo.ts",
                    "type": "tested_by",
                    "direction": "forward",
                    "weight": 0.5,
                },
            ],
        }

        assembled, _report = mbg.merge_and_normalize([batch])

        # Output should have exactly one tested_by edge with canonical direction
        tested_by_edges = [e for e in assembled["edges"] if e["type"] == "tested_by"]
        self.assertEqual(len(tested_by_edges), 1)
        self.assertEqual(tested_by_edges[0]["source"], "file:src/foo.ts")
        self.assertEqual(tested_by_edges[0]["target"], "file:src/foo.test.ts")

        # Production node tagged
        prod_node = next(n for n in assembled["nodes"] if n["id"] == "file:src/foo.ts")
        self.assertIn("tested", prod_node["tags"])

    def test_spec_linker_runs_during_merge(self) -> None:
        batch = {
            "nodes": [
                {
                    "id": "document:specs/auth.md", "type": "document",
                    "name": "auth.md", "filePath": "specs/auth.md",
                    "summary": "", "tags": [], "complexity": "simple",
                },
                {
                    "id": "file:src/auth.ts", "type": "file",
                    "name": "auth.ts", "filePath": "src/auth.ts",
                    "summary": "", "tags": [], "complexity": "simple",
                },
            ],
            "edges": [
                # LLM-emitted inverted specifies edge (code → spec).
                {
                    "source": "file:src/auth.ts",
                    "target": "document:specs/auth.md",
                    "type": "specifies",
                    "direction": "forward",
                    "weight": 0.6,
                },
            ],
        }

        assembled, _report = mbg.merge_and_normalize([batch])

        spec_edges = [e for e in assembled["edges"] if e["type"] == "specifies"]
        self.assertEqual(len(spec_edges), 1)
        self.assertEqual(spec_edges[0]["source"], "document:specs/auth.md")
        self.assertEqual(spec_edges[0]["target"], "file:src/auth.ts")
        self.assertEqual(spec_edges[0]["direction"], "forward")

        doc_node = next(n for n in assembled["nodes"] if n["id"] == "document:specs/auth.md")
        self.assertIn("normative-spec", doc_node["tags"])


class NormalizeDirectionTests(unittest.TestCase):
    """`direction` canonicalization mirrors the dashboard schema validator."""

    def test_missing_defaults_to_forward(self) -> None:
        self.assertEqual(mbg.normalize_direction(None), "forward")
        self.assertEqual(mbg.normalize_direction(""), "forward")

    def test_valid_values_pass_through(self) -> None:
        for value in ("forward", "backward", "bidirectional"):
            with self.subTest(value=value):
                self.assertEqual(mbg.normalize_direction(value), value)

    def test_case_is_normalized(self) -> None:
        self.assertEqual(mbg.normalize_direction("Forward"), "forward")
        self.assertEqual(mbg.normalize_direction("BIDIRECTIONAL"), "bidirectional")

    def test_aliases_are_mapped(self) -> None:
        self.assertEqual(mbg.normalize_direction("both"), "bidirectional")
        self.assertEqual(mbg.normalize_direction("Mutual"), "bidirectional")

    def test_unknown_values_fall_back_to_forward(self) -> None:
        self.assertEqual(mbg.normalize_direction("sideways"), "forward")
        self.assertEqual(mbg.normalize_direction(42), "forward")


class MergeEdgeDirectionTests(unittest.TestCase):
    """End-to-end: merge_and_normalize persists a canonical `direction`."""

    def _two_node_batch(self, edge: dict[str, Any]) -> dict[str, Any]:
        return {
            "nodes": [_file_node("src/a.ts"), _file_node("src/b.ts")],
            "edges": [edge],
        }

    def test_missing_direction_is_persisted_as_forward(self) -> None:
        # Reproduces issue #140: edges without a `direction` field still
        # reach the final graph and trigger dashboard auto-corrections.
        batch = self._two_node_batch({
            "source": "file:src/a.ts",
            "target": "file:src/b.ts",
            "type": "depends_on",
            "weight": 0.5,
        })

        assembled, _report = mbg.merge_and_normalize([batch])

        edges = [e for e in assembled["edges"] if e["type"] == "depends_on"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["direction"], "forward")

    def test_alias_is_canonicalized_before_dedup(self) -> None:
        # `"both"` and `"bidirectional"` describe the same relationship; without
        # canonicalization they get separate dedup keys and leak duplicates.
        batch = {
            "nodes": [_file_node("src/a.ts"), _file_node("src/b.ts")],
            "edges": [
                {"source": "file:src/a.ts", "target": "file:src/b.ts",
                 "type": "depends_on", "direction": "both", "weight": 0.3},
                {"source": "file:src/a.ts", "target": "file:src/b.ts",
                 "type": "depends_on", "direction": "bidirectional", "weight": 0.9},
            ],
        }

        assembled, _report = mbg.merge_and_normalize([batch])

        edges = [e for e in assembled["edges"] if e["type"] == "depends_on"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["direction"], "bidirectional")
        self.assertEqual(edges[0]["weight"], 0.9)


# ── Multi-part batch handling ─────────────────────────────────────────────


class TestMultiPart(unittest.TestCase):
    """End-to-end tests for batch-<i>-part-<k>.json input handling.

    These tests invoke merge-batch-graphs.py as a subprocess in a temp
    directory so we exercise the full path: glob → load → merge → write.
    """

    def setUp(self) -> None:
        import tempfile
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-mbg-"))
        self.intermediate = self.tmp / ".understand-anything" / "intermediate"
        self.intermediate.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_batch(self, name: str, nodes: list, edges: list) -> None:
        import json as _j
        (self.intermediate / name).write_text(
            _j.dumps({"nodes": nodes, "edges": edges}),
            encoding="utf-8",
        )

    def _run_merge(self) -> tuple[int, str, dict]:
        import subprocess
        import json as _j
        result = subprocess.run(
            ["python3", str(_MODULE_PATH), str(self.tmp)],
            capture_output=True, text=True,
        )
        out_path = self.intermediate / "assembled-graph.json"
        assembled = _j.loads(out_path.read_text()) if out_path.exists() else {}
        return result.returncode, result.stderr, assembled

    def test_two_parts_of_one_logical_batch_merge(self) -> None:
        self._write_batch("batch-1-part-1.json",
            [_file_node("src/a.ts")],
            [{"source": "file:src/a.ts", "target": "file:src/b.ts",
              "type": "imports", "direction": "forward", "weight": 0.7}])
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")],
            [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {"file:src/a.ts", "file:src/b.ts"})
        # Cross-part edge survived
        edge_keys = {(e["source"], e["target"], e["type"]) for e in assembled["edges"]}
        self.assertIn(
            ("file:src/a.ts", "file:src/b.ts", "imports"), edge_keys)

    def test_three_parts_of_one_logical_batch_merge(self) -> None:
        for k, path in enumerate(["src/a.ts", "src/b.ts", "src/c.ts"], start=1):
            self._write_batch(f"batch-1-part-{k}.json",
                [_file_node(path)], [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids,
            {"file:src/a.ts", "file:src/b.ts", "file:src/c.ts"})

    def test_malformed_part_is_skipped_with_warning(self) -> None:
        (self.intermediate / "batch-1-part-1.json").write_text(
            "{ this is not valid json", encoding="utf-8")
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")], [])
        rc, stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        # The skip warning is from existing load_batch logic
        self.assertIn("skipping batch-1-part-1.json", stderr)
        # part-2 content still made it in
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {"file:src/b.ts"})

    def test_mixed_single_and_multi_part(self) -> None:
        self._write_batch("batch-1.json",
            [_file_node("src/single.ts")], [])
        self._write_batch("batch-2-part-1.json",
            [_file_node("src/multi-a.ts")], [])
        self._write_batch("batch-2-part-2.json",
            [_file_node("src/multi-b.ts")], [])
        self._write_batch("batch-3.json",
            [_file_node("src/another-single.ts")], [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {
            "file:src/single.ts", "file:src/multi-a.ts",
            "file:src/multi-b.ts", "file:src/another-single.ts",
        })

    def test_missing_part_emits_warning(self) -> None:
        # parts {2, 3} present, part-1 missing
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")], [])
        self._write_batch("batch-1-part-3.json",
            [_file_node("src/c.ts")], [])
        rc, stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        self.assertRegex(stderr,
            r"Warning: merge: batch 1 has parts \[2, 3\] but "
            r"missing part \[1\] — possible truncated write")

    def test_stderr_report_format(self) -> None:
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch("batch-2-part-1.json", [_file_node("src/b.ts")], [])
        self._write_batch("batch-2-part-2.json", [_file_node("src/c.ts")], [])
        rc, stderr, _assembled = self._run_merge()
        self.assertEqual(rc, 0)
        # 3 files on disk, 2 logical batches, 1 multi-part
        self.assertIn(
            "Found 3 batch files (2 logical batches, 1 multi-part)", stderr)


# ── Unrecognized batch filename handling ───────────────────────────────────


class TestUnrecognizedBatchFilename(unittest.TestCase):
    """File-analyzer fuses multiple batches into one output (e.g.,
    `batch-fused-8-13.json`, `batch-8-13.json`) — the merge script's regex
    requires `batch-<N>.json` or `batch-<N>-part-<K>.json` and would
    otherwise silently drop the contents. The script must warn loudly and
    surface the drop in its report so the downstream review step catches it.
    """

    def setUp(self) -> None:
        import tempfile
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-mbg-unrec-"))
        self.intermediate = self.tmp / ".understand-anything" / "intermediate"
        self.intermediate.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_batch(self, name: str, nodes: list, edges: list) -> None:
        import json as _j
        (self.intermediate / name).write_text(
            _j.dumps({"nodes": nodes, "edges": edges}),
            encoding="utf-8",
        )

    def _run_merge(self) -> tuple[int, str, dict]:
        import subprocess
        import json as _j
        result = subprocess.run(
            ["python3", str(_MODULE_PATH), str(self.tmp)],
            capture_output=True, text=True,
        )
        out_path = self.intermediate / "assembled-graph.json"
        assembled = _j.loads(out_path.read_text()) if out_path.exists() else {}
        return result.returncode, result.stderr, assembled

    def test_fused_filename_emits_stderr_warning(self) -> None:
        # `batch-fused-3-5.json` does not match the merge regex —
        # script must warn on stderr (not silently drop).
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch("batch-2.json", [_file_node("src/b.ts")], [])
        self._write_batch(
            "batch-fused-3-5.json",
            [_file_node("src/c.ts"), _file_node("src/d.ts"), _file_node("src/e.ts")],
            [],
        )
        rc, stderr, _assembled = self._run_merge()
        self.assertEqual(rc, 0)
        self.assertIn("Warning: merge-batch-graphs:", stderr)
        self.assertIn("unrecognized filenames", stderr)
        self.assertIn("batch-fused-3-5.json", stderr)
        # Remediation hint must be present so users know what to fix.
        self.assertIn("file-analyzer", stderr)
        self.assertIn("batch-<N>.json", stderr)

    def test_fused_filename_surfaces_in_report(self) -> None:
        # The merge report (printed after the per-file load lines) must
        # also flag the drop so Phase 3 review picks it up.
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch(
            "batch-fused-2-4.json", [_file_node("src/x.ts")], [],
        )
        rc, stderr, _assembled = self._run_merge()
        self.assertEqual(rc, 0)
        # "dropped N batch file(s) with unrecognized filenames" appears in the
        # report section (printed after "Output: ..." line).
        self.assertIn("dropped 1 batch file(s) with unrecognized filenames", stderr)
        self.assertIn("batch-fused-2-4.json", stderr)
        self.assertIn(
            "every node/edge in these files was excluded from the final graph",
            stderr,
        )

    def test_recognized_batches_still_loaded(self) -> None:
        # With both recognized and unrecognized files present, recognized
        # ones must still produce a valid assembled graph.
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch("batch-2.json", [_file_node("src/b.ts")], [])
        self._write_batch(
            "batch-fused-3-5.json",
            [_file_node("src/dropped-c.ts")],
            [],
        )
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        # batch-1 + batch-2 survive
        self.assertIn("file:src/a.ts", node_ids)
        self.assertIn("file:src/b.ts", node_ids)
        # batch-fused-3-5.json content is excluded
        self.assertNotIn("file:src/dropped-c.ts", node_ids)
        self.assertEqual(node_ids, {"file:src/a.ts", "file:src/b.ts"})

    def test_range_filename_also_unrecognized(self) -> None:
        # A bare range like `batch-8-13.json` is just as broken as
        # `batch-fused-8-13.json` — both must be flagged. The regex
        # `batch-(\d+)(?:-part-(\d+))?\.json` requires the literal
        # `-part-` separator before a second number.
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch(
            "batch-8-13.json",
            [_file_node("src/x.ts"), _file_node("src/y.ts")],
            [],
        )
        rc, stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        self.assertIn("Warning: merge-batch-graphs:", stderr)
        self.assertIn("batch-8-13.json", stderr)
        # Content is dropped
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertNotIn("file:src/x.ts", node_ids)
        self.assertNotIn("file:src/y.ts", node_ids)


def _doc_node(path: str, **extra: Any) -> dict[str, Any]:
    """Build a minimal document node with the given relative path."""
    node: dict[str, Any] = {
        "id": f"document:{path}",
        "type": "document",
        "name": path.rsplit("/", 1)[-1],
        "filePath": path,
        "summary": "",
        "tags": [],
        "complexity": "simple",
    }
    node.update(extra)
    return node


class LinkSpecsTests(unittest.TestCase):
    """Canonicalization behaviour of the specifies linker."""

    def test_canonical_edge_kept_and_direction_forced_forward(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "file:src/auth.ts": _file_node("src/auth.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "document:specs/auth.md",
                "target": "file:src/auth.ts",
                "type": "specifies",
                "direction": "backward",
                "weight": 0.6,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 0)
        self.assertEqual(swapped, 0)
        self.assertEqual(tagged, 1)
        self.assertEqual(len(edges), 1)
        edge = edges[0]
        self.assertEqual(edge["source"], "document:specs/auth.md")
        self.assertEqual(edge["target"], "file:src/auth.ts")
        self.assertEqual(edge["direction"], "forward")
        self.assertIn("normative-spec", nodes_by_id["document:specs/auth.md"]["tags"])
        # The specified code node is NOT tagged (links are inferred, so absence
        # of a spec edge is not a reliable "unspecified" signal).
        self.assertNotIn("normative-spec", nodes_by_id["file:src/auth.ts"]["tags"])

    def test_inverted_edge_is_flipped(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "module:auth": {
                "id": "module:auth", "type": "module", "name": "auth",
                "summary": "", "tags": [], "complexity": "simple",
            },
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "module:auth",
                "target": "document:specs/auth.md",
                "type": "specifies",
                "direction": "forward",
                "weight": 0.6,
                "description": "from LLM",
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 0)
        self.assertEqual(swapped, 1)
        self.assertEqual(tagged, 1)
        self.assertEqual(len(edges), 1)
        edge = edges[0]
        self.assertEqual(edge["source"], "document:specs/auth.md")
        self.assertEqual(edge["target"], "module:auth")
        self.assertEqual(edge["direction"], "forward")
        self.assertIn("direction corrected", edge["description"].lower())

    def test_specified_by_type_is_folded_and_flipped(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "file:src/auth.ts": _file_node("src/auth.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/auth.ts",
                "target": "document:specs/auth.md",
                "type": "specified_by",
                "direction": "forward",
                "weight": 0.6,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 0)
        self.assertEqual(swapped, 1)
        self.assertEqual(len(edges), 1)
        edge = edges[0]
        self.assertEqual(edge["type"], "specifies")
        self.assertEqual(edge["source"], "document:specs/auth.md")
        self.assertEqual(edge["target"], "file:src/auth.ts")

    def test_doc_to_doc_and_code_to_code_dropped(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "document:README.md": _doc_node("README.md"),
            "file:src/a.ts": _file_node("src/a.ts"),
            "file:src/b.ts": _file_node("src/b.ts"),
        }
        edges: list[dict[str, Any]] = [
            {  # spec ↔ spec
                "source": "document:README.md",
                "target": "document:specs/auth.md",
                "type": "specifies", "direction": "forward", "weight": 0.5,
            },
            {  # code ↔ code
                "source": "file:src/a.ts",
                "target": "file:src/b.ts",
                "type": "specifies", "direction": "forward", "weight": 0.5,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 2)
        self.assertEqual(swapped, 0)
        self.assertEqual(tagged, 0)
        self.assertEqual(len(edges), 0)

    def test_missing_endpoint_dropped(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "document:specs/auth.md",
                "target": "file:src/gone.ts",
                "type": "specifies", "direction": "forward", "weight": 0.6,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 1)
        self.assertEqual(len(edges), 0)

    def test_duplicate_pair_keeps_heavier_weight(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "file:src/auth.ts": _file_node("src/auth.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "document:specs/auth.md", "target": "file:src/auth.ts",
                "type": "specifies", "direction": "forward", "weight": 0.4,
            },
            {
                "source": "document:specs/auth.md", "target": "file:src/auth.ts",
                "type": "specifies", "direction": "forward", "weight": 0.9,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual(dropped, 1)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["weight"], 0.9)

    def test_unrelated_edges_preserved(self) -> None:
        nodes_by_id = {
            "file:src/a.ts": _file_node("src/a.ts"),
            "file:src/b.ts": _file_node("src/b.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/a.ts", "target": "file:src/b.ts",
                "type": "imports", "direction": "forward", "weight": 1.0,
            },
        ]

        dropped, swapped, tagged = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual((dropped, swapped, tagged), (0, 0, 0))
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["type"], "imports")

    def test_idempotent(self) -> None:
        nodes_by_id = {
            "document:specs/auth.md": _doc_node("specs/auth.md"),
            "file:src/auth.ts": _file_node("src/auth.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "document:specs/auth.md", "target": "file:src/auth.ts",
                "type": "specifies", "direction": "forward", "weight": 0.6,
            },
        ]

        mbg.link_specs(nodes_by_id, edges)
        dropped2, swapped2, tagged2 = mbg.link_specs(nodes_by_id, edges)

        self.assertEqual((dropped2, swapped2), (0, 0))
        self.assertEqual(tagged2, 0)  # tag already present
        self.assertEqual(len(edges), 1)


if __name__ == "__main__":
    unittest.main()