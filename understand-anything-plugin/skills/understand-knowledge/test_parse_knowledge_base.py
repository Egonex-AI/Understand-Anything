"""Tests for parse-knowledge-base.py — markdown-link (CommonMark) compatibility.

Run with: python3 -m unittest test_parse_knowledge_base  (no third-party deps).

Covers the case where a Karpathy-pattern wiki (has index.md) uses CommonMark
[label](page.md) links instead of [[wikilinks]] — common for wikis rendered on
GitHub/GitLab, which do not support [[ ]]. Before this fix the deterministic
scan produced zero edges on such wikis.
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# The module filename has hyphens, so import it by path.
_SPEC = importlib.util.spec_from_file_location(
    "parse_knowledge_base", Path(__file__).with_name("parse-knowledge-base.py")
)
pkb = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pkb)


class ExtractMdlinks(unittest.TestCase):
    def test_extracts_local_md_links(self):
        text = "See [Other](other.md) and [Sub](dir/sub.md#anchor)."
        self.assertEqual(pkb.extract_mdlinks(text), ["other.md", "dir/sub.md"])

    def test_ignores_images_and_external_links(self):
        text = "![img](pic.md) [site](https://x.com/p.md) [docs](https://e/g.md#a)"
        # image (leading !) is excluded; external URLs are captured by the regex
        # but filtered at resolution time, so none resolve to articles.
        self.assertNotIn("pic.md", pkb.extract_mdlinks(text))


class ResolveMdlink(unittest.TestCase):
    def setUp(self):
        self.ids = {"article:pages/a", "article:pages/b", "article:index"}

    def test_resolves_sibling(self):
        # link from pages/a.md to b.md -> article:pages/b
        self.assertEqual(
            pkb.resolve_mdlink("b.md", Path("pages/a.md"), self.ids),
            "article:pages/b",
        )

    def test_resolves_parent_relative(self):
        self.assertEqual(
            pkb.resolve_mdlink("../index.md", Path("pages/a.md"), self.ids),
            "article:index",
        )

    def test_resolves_from_index_root(self):
        self.assertEqual(
            pkb.resolve_mdlink("pages/a.md", Path("index.md"), self.ids),
            "article:pages/a",
        )

    def test_strips_anchor(self):
        self.assertEqual(
            pkb.resolve_mdlink("b.md#section", Path("pages/a.md"), self.ids),
            "article:pages/b",
        )

    def test_rejects_external_and_unknown(self):
        self.assertIsNone(pkb.resolve_mdlink("https://x.com/b.md", Path("pages/a.md"), self.ids))
        self.assertIsNone(pkb.resolve_mdlink("/abs/b.md", Path("pages/a.md"), self.ids))
        self.assertIsNone(pkb.resolve_mdlink("missing.md", Path("pages/a.md"), self.ids))
        self.assertIsNone(pkb.resolve_mdlink("notmd.txt", Path("pages/a.md"), self.ids))


class ParseWikiWithMarkdownLinks(unittest.TestCase):
    """End-to-end: a Karpathy wiki using only CommonMark links yields edges."""

    def test_builds_edges_and_categories(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "pages").mkdir()
            (root / "index.md").write_text(
                "# Index\n\n## Topic\n\n- [Alpha](pages/alpha.md)\n- [Beta](pages/beta.md)\n",
                encoding="utf-8",
            )
            (root / "pages" / "alpha.md").write_text(
                "# Alpha\n\nAlpha relates to [Beta](beta.md).\n", encoding="utf-8"
            )
            (root / "pages" / "beta.md").write_text(
                "# Beta\n\nBeta is standalone.\n", encoding="utf-8"
            )

            manifest = pkb.parse_wiki(root)

            self.assertEqual(manifest["format"], "karpathy")
            # md-links in article bodies are counted (index.md is infra; its
            # links become categorized_under edges instead).
            self.assertGreaterEqual(manifest["stats"]["mdlinks"], 1)
            # alpha -> beta related edge exists
            related = [
                (e["source"], e["target"])
                for e in manifest["edges"]
                if e["type"] == "related"
            ]
            self.assertIn(("article:pages/alpha", "article:pages/beta"), related)
            # categorized_under edges from the index's markdown links
            cats = [e for e in manifest["edges"] if e["type"] == "categorized_under"]
            self.assertEqual(len(cats), 2)

    def test_no_duplicate_edge_when_both_link_styles_present(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.md").write_text("# I\n\n## T\n\n- [A](a.md)\n", encoding="utf-8")
            # a.md links b.md via BOTH a wikilink and a markdown link
            (root / "a.md").write_text("# A\n\n[[b]] and [B](b.md)\n", encoding="utf-8")
            (root / "b.md").write_text("# B\n", encoding="utf-8")
            (root / "c.md").write_text("# C\n", encoding="utf-8")  # 3rd md file for detection

            manifest = pkb.parse_wiki(root)
            a_to_b = [
                e for e in manifest["edges"]
                if e["type"] == "related"
                and e["source"] == "article:a" and e["target"] == "article:b"
            ]
            self.assertEqual(len(a_to_b), 1, "duplicate edge from both link styles")


if __name__ == "__main__":
    unittest.main()
