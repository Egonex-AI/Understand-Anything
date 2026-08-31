"""Tests for parse-knowledge-base.py — doctrine-format detection + parsing.

Covers the Ext-1 extension that relaxes the Karpathy detector to also
accept doctrine corpora (numbered files + prose cross-refs + standard
markdown links). Existing Karpathy fixtures regress unchanged.
"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

# ---------------------------------------------------------------------------
# Module loading — filename contains hyphens so we can't `import` it directly
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-knowledge"
    / "parse-knowledge-base.py"
)
_spec = importlib.util.spec_from_file_location("parse_knowledge_base", _MODULE_PATH)
parser_mod = importlib.util.module_from_spec(_spec)
sys.modules["parse_knowledge_base"] = parser_mod
_spec.loader.exec_module(parser_mod)


def _write(root: Path, rel: str, body: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


def _build_doctrine_corpus(root: Path) -> None:
    """Create a doctrine-format fixture: numbered files + prose-refs + md links."""
    _write(root, "00-foundation.md",
           "# Foundation\n\nThe foundational doctrine. See canon/04 §6-7.\n"
           "Cross-ref to [Layer Omega](04-layer-omega.md) explains the cycle.\n")
    _write(root, "01-hard-rules.md",
           "# Hard Rules\n\nReferences canon/00 for canonical names.\n"
           "See [foundation](00-foundation.md) for grounding.\n")
    _write(root, "02-naming.md",
           "# Naming Conventions\n\nDoctrine #11 covers sub-patterns.\n"
           "[Cross-link](01-hard-rules.md)\n")
    _write(root, "04-layer-omega.md",
           "# Layer Omega SOP\n\nThe 7-step cycle described here.\n"
           "Refers back to canon/00 and canon/01.\n")
    _write(root, "11-sub-patterns.md",
           "# Sub-Pattern Activation\n\nOverview of doctrine sub-patterns.\n"
           "Pairs with canon/04 for SOP invocation.\n")


def _build_karpathy_corpus(root: Path) -> None:
    """Create a Karpathy-format fixture: index.md + wikilinks."""
    _write(root, "index.md",
           "# Index\n\n## Core\n\n- [[foundation]]\n- [[ego-system]]\n\n"
           "## Operational\n\n- [[deploy-flow]]\n")
    _write(root, "foundation.md", "# Foundation\n\nLinks to [[ego-system]].\n")
    _write(root, "ego-system.md", "# Ego System\n\nLinks back to [[foundation]].\n")
    _write(root, "deploy-flow.md", "# Deploy Flow\n\nReferences [[ego-system]].\n")


# ---------------------------------------------------------------------------
# detect_format() — format dispatch
# ---------------------------------------------------------------------------

class DetectFormatTests(unittest.TestCase):

    def test_doctrine_corpus_detected_as_doctrine(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _build_doctrine_corpus(root)
            result = parser_mod.detect_format(root)
            self.assertTrue(result["detected"])
            self.assertEqual(result["format"], "doctrine")
            self.assertGreaterEqual(result["numbered_count"], 3)
            self.assertTrue(result["has_prose_refs"])
            self.assertTrue(result["has_md_links"])

    def test_karpathy_corpus_still_detected_as_karpathy(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _build_karpathy_corpus(root)
            result = parser_mod.detect_format(root)
            self.assertTrue(result["detected"])
            self.assertEqual(result["format"], "karpathy")

    def test_karpathy_precedence_over_doctrine_signals(self):
        """When BOTH index.md and numbered files exist, Karpathy wins."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _build_doctrine_corpus(root)
            # Add an index.md to make it also look Karpathy
            _write(root, "index.md", "# Index\n\n## Articles\n\n- [[00-foundation]]\n")
            result = parser_mod.detect_format(root)
            self.assertEqual(result["format"], "karpathy",
                             "Karpathy detection must take precedence when both "
                             "signal sets are present (backwards compat)")

    def test_empty_directory_unknown(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = parser_mod.detect_format(root)
            self.assertFalse(result["detected"])
            self.assertEqual(result["format"], "unknown")

    def test_few_numbered_files_not_doctrine(self):
        """Below the 3-file threshold, no doctrine detection."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _write(root, "00-foo.md", "# Foo\n")
            _write(root, "01-bar.md", "# Bar\n")
            result = parser_mod.detect_format(root)
            self.assertEqual(result["format"], "unknown")


# ---------------------------------------------------------------------------
# _parse_doctrine_wiki() — manifest shape + edges
# ---------------------------------------------------------------------------

class DoctrineWikiParseTests(unittest.TestCase):

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        _build_doctrine_corpus(self.root)
        self.manifest = parser_mod.parse_wiki(self.root)

    def tearDown(self):
        self._td.cleanup()

    def test_format_is_doctrine(self):
        self.assertEqual(self.manifest["format"], "doctrine")

    def test_article_count_matches_fixture(self):
        # 5 numbered files, no infra to skip
        self.assertEqual(self.manifest["stats"]["articles"], 5)

    def test_article_node_ids_use_article_prefix(self):
        article_ids = {n["id"] for n in self.manifest["nodes"] if n["type"] == "article"}
        self.assertIn("article:00-foundation", article_ids)
        self.assertIn("article:04-layer-omega", article_ids)
        self.assertIn("article:11-sub-patterns", article_ids)

    def test_md_link_edges_resolve_to_known_articles(self):
        related_edges = [
            (e["source"], e["target"])
            for e in self.manifest["edges"]
            if e["type"] == "related"
        ]
        # 00-foundation → 04-layer-omega (via [Layer Omega](04-layer-omega.md))
        self.assertIn(("article:00-foundation", "article:04-layer-omega"),
                      related_edges)
        # 01-hard-rules → 00-foundation (via [foundation](00-foundation.md))
        self.assertIn(("article:01-hard-rules", "article:00-foundation"),
                      related_edges)

    def test_prose_refs_resolve_to_numbered_articles(self):
        ref_edges = [
            (e["source"], e["target"])
            for e in self.manifest["edges"]
            if e["type"] == "references"
        ]
        # 00-foundation refers to canon/04 → 04-layer-omega
        self.assertIn(("article:00-foundation", "article:04-layer-omega"),
                      ref_edges)
        # 01-hard-rules refers to canon/00 → 00-foundation
        self.assertIn(("article:01-hard-rules", "article:00-foundation"),
                      ref_edges)

    def test_topic_nodes_from_numeric_groups(self):
        topic_ids = {n["id"] for n in self.manifest["nodes"] if n["type"] == "topic"}
        # Files 00, 01, 02, 04 are in group-0; file 11 is in group-1
        self.assertIn("topic:group-0", topic_ids)
        self.assertIn("topic:group-1", topic_ids)

    def test_categorized_under_edges_link_articles_to_groups(self):
        cat_edges = [
            (e["source"], e["target"])
            for e in self.manifest["edges"]
            if e["type"] == "categorized_under"
        ]
        self.assertIn(("article:00-foundation", "topic:group-0"), cat_edges)
        self.assertIn(("article:11-sub-patterns", "topic:group-1"), cat_edges)

    def test_backlinks_populated(self):
        for node in self.manifest["nodes"]:
            if node["id"] == "article:00-foundation":
                bl = node["knowledgeMeta"]["backlinks"]
                # 01-hard-rules links to 00-foundation via both md-link and prose-ref;
                # backlinks dedupe per source-target pair within an edge type, but the
                # backlink list collects from both 'related' and 'references' edges.
                self.assertIn("article:01-hard-rules", bl)
                break
        else:
            self.fail("article:00-foundation node not found")

    def test_summary_extracted_from_first_paragraph(self):
        for node in self.manifest["nodes"]:
            if node["id"] == "article:00-foundation":
                self.assertIn("foundational doctrine", node["summary"].lower())
                break

    def test_warnings_capped(self):
        self.assertLessEqual(len(self.manifest["warnings"]), 50)


# ---------------------------------------------------------------------------
# extract_md_links() + extract_prose_refs() — direct unit coverage
# ---------------------------------------------------------------------------

class HelperExtractionTests(unittest.TestCase):

    def test_md_links_skip_external_urls(self):
        text = "See [home](https://example.com) and [local](foo.md)."
        links = parser_mod.extract_md_links(text)
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["target"], "foo.md")

    def test_md_links_skip_code_blocks(self):
        text = "```python\n[fake](bar.md)\n```\nReal [link](real.md)"
        links = parser_mod.extract_md_links(text)
        targets = [link["target"] for link in links]
        self.assertEqual(targets, ["real.md"])

    def test_md_links_strip_fragments(self):
        text = "See [section](foo.md#some-anchor)."
        links = parser_mod.extract_md_links(text)
        self.assertEqual(links[0]["target"], "foo.md")

    def test_prose_refs_dedupe_within_document(self):
        text = "See canon/04 twice — canon/04 again. Also canon/01."
        refs = parser_mod.extract_prose_refs(text)
        keys = [(r["namespace"], r["num"]) for r in refs]
        self.assertEqual(sorted(keys), [("canon", "01"), ("canon", "04")])

    def test_prose_refs_match_variants(self):
        text = "See canon/04 and Doctrine #11 plus chapter 5."
        refs = parser_mod.extract_prose_refs(text)
        namespaces = sorted(r["namespace"] for r in refs)
        self.assertEqual(namespaces, ["canon", "chapter", "doctrine"])


# ---------------------------------------------------------------------------
# Karpathy regression — ensure existing path unchanged
# ---------------------------------------------------------------------------

class KarpathyRegressionTests(unittest.TestCase):

    def test_karpathy_corpus_still_parses(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _build_karpathy_corpus(root)
            manifest = parser_mod.parse_wiki(root)
            self.assertEqual(manifest["format"], "karpathy")
            # 3 content articles (index.md is infra)
            self.assertEqual(manifest["stats"]["articles"], 3)
            # At least one wikilink edge resolved
            related_edges = [e for e in manifest["edges"] if e["type"] == "related"]
            self.assertGreater(len(related_edges), 0)


if __name__ == "__main__":
    unittest.main()
