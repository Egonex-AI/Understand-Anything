#!/usr/bin/env python3
"""
test_parse_knowledge_base.py — Tests for title-case infra file detection and
article-root-prefixed wiki links in the Karpathy wiki parser (issue #342).

Run from the repo root:
    python -m unittest tests.skill.knowledge.test_parse_knowledge_base -v
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


# ── Module loaders ────────────────────────────────────────────────────────
# The scripts have hyphens in their names, so we cannot `import` them
# directly. Load them via importlib so we can call module-level helpers.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_SKILL_DIR = _REPO_ROOT / "understand-anything-plugin" / "skills" / "understand-knowledge"


def _load(script: str, alias: str) -> Any:
    spec = importlib.util.spec_from_file_location(alias, _SKILL_DIR / script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[alias] = module
    spec.loader.exec_module(module)
    return module


pkb = _load("parse-knowledge-base.py", "parse_knowledge_base")
mkg = _load("merge-knowledge-graph.py", "merge_knowledge_graph")


def _fs_is_case_sensitive(tmp: Path) -> bool:
    probe = tmp / "CaseProbe.md"
    probe.write_text("x", encoding="utf-8")
    try:
        return not (tmp / "caseprobe.md").is_file()
    finally:
        probe.unlink()


class TestFindMarkdownCaseInsensitive(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-pkb-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_title_case_file_is_found(self) -> None:
        (self.tmp / "Index.md").write_text("# Wiki", encoding="utf-8")
        found = pkb.find_markdown_case_insensitive(self.tmp, "index.md")
        self.assertTrue(found.is_file())
        self.assertEqual(found.name.lower(), "index.md")

    def test_exact_lowercase_wins_when_both_exist(self) -> None:
        if not _fs_is_case_sensitive(self.tmp):
            self.skipTest("filesystem is case-insensitive; both casings collide")
        (self.tmp / "Index.md").write_text("# Title", encoding="utf-8")
        (self.tmp / "index.md").write_text("# lower", encoding="utf-8")
        found = pkb.find_markdown_case_insensitive(self.tmp, "index.md")
        self.assertEqual(found.name, "index.md")

    def test_missing_parent_returns_candidate(self) -> None:
        found = pkb.find_markdown_case_insensitive(self.tmp / "nope", "index.md")
        self.assertFalse(found.is_file())

    def test_merge_script_helper_matches(self) -> None:
        (self.tmp / "Index.md").write_text("# Wiki", encoding="utf-8")
        found = mkg._find_markdown_case_insensitive(self.tmp, "index.md")
        self.assertTrue(found.is_file())


class TestTitleCaseWiki(unittest.TestCase):
    """A wiki using Index.md / Log.md must parse the same as index.md / log.md."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-pkb-wiki-"))
        wiki = self.tmp / "wiki"
        (wiki / "concepts").mkdir(parents=True)
        (wiki / "projects").mkdir(parents=True)
        (wiki / "Index.md").write_text(
            "# Hermes\n\n## Concepts\n\n- [[wiki/concepts/Index]]\n\n"
            "## Projects\n\n- [[wiki/projects/Personal Wiki Second Brain]]\n",
            encoding="utf-8",
        )
        (wiki / "Log.md").write_text(
            "# Log\n\n## [2026-05-01] CREATE | Seeded wiki\n", encoding="utf-8"
        )
        (wiki / "concepts" / "Index.md").write_text(
            "# Concepts Index\n\nOverview of concepts.\n", encoding="utf-8"
        )
        (wiki / "projects" / "Personal Wiki Second Brain.md").write_text(
            "# Personal Wiki Second Brain\n\nPilot project.\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_detect_format_sees_title_case_infra(self) -> None:
        signals = pkb.detect_format(self.tmp)
        self.assertTrue(signals["has_index"])
        self.assertTrue(signals["has_log"])
        self.assertTrue(signals["detected"])

    def test_title_case_root_infra_is_not_an_article(self) -> None:
        manifest = pkb.parse_wiki(self.tmp)
        article_ids = {n["id"] for n in manifest["nodes"] if n["type"] == "article"}
        self.assertNotIn("article:Index", article_ids)
        self.assertNotIn("article:Log", article_ids)
        # Nested Index.md IS content
        self.assertIn("article:concepts/Index", article_ids)

    def test_root_prefixed_category_links_resolve(self) -> None:
        """[[wiki/concepts/Index]] must map to article:concepts/Index when
        wiki/ is the detected article root (the #342 pilot saw every node
        land in "Other" because this lookup missed)."""
        manifest = pkb.parse_wiki(self.tmp)
        cat_edges = {
            (e["source"], e["target"])
            for e in manifest["edges"]
            if e["type"] == "categorized_under"
        }
        self.assertIn(("article:concepts/Index", "topic:concepts"), cat_edges)
        self.assertIn(
            ("article:projects/Personal Wiki Second Brain", "topic:projects"),
            cat_edges,
        )
        by_id = {n["id"]: n for n in manifest["nodes"]}
        self.assertEqual(
            by_id["article:concepts/Index"]["knowledgeMeta"].get("category"),
            "Concepts",
        )

    def test_links_outside_article_root_stay_unresolved(self) -> None:
        """maps/*, SCHEMA etc. must not be forced into article layers."""
        wiki = self.tmp / "wiki"
        (wiki / "concepts" / "Index.md").write_text(
            "# Concepts Index\n\nSee [[maps/overview]] and [[SCHEMA]].\n",
            encoding="utf-8",
        )
        manifest = pkb.parse_wiki(self.tmp)
        related = {
            e["target"] for e in manifest["edges"] if e["source"] == "article:concepts/Index"
        }
        self.assertNotIn("article:maps/overview", related)
        self.assertTrue(any("maps/overview" in w for w in manifest["warnings"]))


class TestLowercaseWikiStillWorks(unittest.TestCase):
    """Regression guard: the original all-lowercase layout keeps parsing."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-pkb-lower-"))
        (self.tmp / "concepts").mkdir(parents=True)
        (self.tmp / "index.md").write_text(
            "# Wiki\n\n## Concepts\n\n- [[concepts/attention]]\n", encoding="utf-8"
        )
        (self.tmp / "log.md").write_text("# Log\n", encoding="utf-8")
        (self.tmp / "concepts" / "attention.md").write_text(
            "# Attention\n\nAll you need.\n", encoding="utf-8"
        )
        (self.tmp / "concepts" / "transformer.md").write_text(
            "# Transformer\n\nSee [[attention]].\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_lowercase_layout_parses_with_categories_and_edges(self) -> None:
        signals = pkb.detect_format(self.tmp)
        self.assertTrue(signals["detected"])
        manifest = pkb.parse_wiki(self.tmp)
        by_id = {n["id"]: n for n in manifest["nodes"]}
        self.assertIn("article:concepts/attention", by_id)
        self.assertEqual(
            by_id["article:concepts/attention"]["knowledgeMeta"].get("category"),
            "Concepts",
        )
        edge_keys = {(e["source"], e["target"], e["type"]) for e in manifest["edges"]}
        self.assertIn(
            ("article:concepts/transformer", "article:concepts/attention", "related"),
            edge_keys,
        )


if __name__ == "__main__":
    unittest.main()
