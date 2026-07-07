#!/usr/bin/env python3
"""
test_parse_knowledge_base.py — Tests for the Karpathy-pattern wiki parser.

Focus: regression coverage for issue #361 — Karpathy wikis using CommonMark
`[label](page.md)` links yield 0 deterministic edges.

The fix extracts CommonMark `[](page.md)` links inside the Karpathy code path
alongside the existing `[[wikilink]]` handling. The tests below cover:

  - pure CommonMark wikis (no `[[ ]]` anywhere) — must produce real edges.
  - mixed `[[ ]]` + `[](page.md)` wikis — both styles must contribute edges.
  - pure-wikilink wikis — regression: must remain byte-for-byte equivalent.
  - md-link helpers — filter external URLs, anchors, image links, fenced
    code blocks; resolve relative, `./relative`, and `/absolute` targets.

Run from the repo root:
    python3 -m unittest tests.skill.understand-knowledge.test_parse_knowledge_base -v

Or directly:
    python3 tests/skill/understand-knowledge/test_parse_knowledge_base.py
"""

from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


# ── Module loader ─────────────────────────────────────────────────────────
# `parse-knowledge-base.py` has a hyphen in its name, so we cannot `import`
# it directly. Load it via importlib so we can call its module-level helpers.

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-knowledge"
    / "parse-knowledge-base.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location(
        "parse_knowledge_base", _MODULE_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["parse_knowledge_base"] = module
    spec.loader.exec_module(module)
    return module


pkb = _load_module()


# ── Fixture builder ───────────────────────────────────────────────────────


class _WikiFixture:
    """Build a temp Karpathy-pattern wiki on disk for parse_wiki()."""

    def __init__(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-pkb-"))

    def write(self, rel_path: str, content: str) -> Path:
        p = self.tmp / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def cleanup(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)


def _edge_pairs(manifest: dict, edge_type: str | None = None) -> set[tuple[str, str]]:
    """Return {(source, target)} for edges in manifest, optionally filtered by type."""
    return {
        (e["source"], e["target"])
        for e in manifest["edges"]
        if edge_type is None or e["type"] == edge_type
    }


# ── is_internal_md_target ─────────────────────────────────────────────────


class IsInternalMdTargetTests(unittest.TestCase):
    """Filter logic for raw markdown-link targets."""

    def test_accepts_relative_md_paths(self) -> None:
        for href in ["page.md", "pages/alpha.md", "./pages/alpha.md", "/pages/alpha.md"]:
            with self.subTest(href=href):
                self.assertTrue(pkb.is_internal_md_target(href))

    def test_rejects_external_urls(self) -> None:
        for href in [
            "https://example.com/page.md",
            "http://example.com",
            "mailto:foo@example.com",
            "ftp://example.com/file.md",
        ]:
            with self.subTest(href=href):
                self.assertFalse(pkb.is_internal_md_target(href))

    def test_rejects_bare_anchors(self) -> None:
        self.assertFalse(pkb.is_internal_md_target("#section"))
        self.assertFalse(pkb.is_internal_md_target("#"))

    def test_rejects_non_md_assets(self) -> None:
        for href in ["image.png", "data.json", "script.js", "page", "pages/"]:
            with self.subTest(href=href):
                self.assertFalse(pkb.is_internal_md_target(href))

    def test_accepts_md_with_anchor_or_query(self) -> None:
        # Path-part ends in .md once query/fragment are stripped.
        self.assertTrue(pkb.is_internal_md_target("page.md#section"))
        self.assertTrue(pkb.is_internal_md_target("page.md?v=1"))

    def test_rejects_empty(self) -> None:
        self.assertFalse(pkb.is_internal_md_target(""))
        self.assertFalse(pkb.is_internal_md_target("   "))


# ── extract_md_links ──────────────────────────────────────────────────────


class ExtractMdLinksTests(unittest.TestCase):
    """`[label](page.md)` extraction with image / code-block / URL filters."""

    def test_extracts_basic_md_link(self) -> None:
        links = pkb.extract_md_links("See [Alpha](pages/alpha.md) for details.")
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["target"], "pages/alpha.md")
        self.assertEqual(links[0]["display"], "Alpha")

    def test_skips_image_links(self) -> None:
        # `![alt](src)` is an image embed, not a page link — never an edge.
        text = "![diagram](pages/diagram.md)\n[Alpha](pages/alpha.md)"
        links = pkb.extract_md_links(text)
        self.assertEqual([l["target"] for l in links], ["pages/alpha.md"])

    def test_skips_external_urls(self) -> None:
        text = "[GitHub](https://github.com/foo/bar) and [Alpha](pages/alpha.md)"
        links = pkb.extract_md_links(text)
        self.assertEqual([l["target"] for l in links], ["pages/alpha.md"])

    def test_skips_links_in_fenced_code_blocks(self) -> None:
        text = (
            "Live link: [Alpha](pages/alpha.md)\n"
            "\n"
            "```markdown\n"
            "Example: [NotARealEdge](pages/example.md)\n"
            "```\n"
        )
        links = pkb.extract_md_links(text)
        self.assertEqual([l["target"] for l in links], ["pages/alpha.md"])

    def test_skips_anchors_and_non_md(self) -> None:
        text = "[anchor](#section) and [json](data.json) and [Alpha](alpha.md)"
        links = pkb.extract_md_links(text)
        self.assertEqual([l["target"] for l in links], ["alpha.md"])

    def test_returns_empty_for_text_without_links(self) -> None:
        self.assertEqual(pkb.extract_md_links("plain text, no links"), [])
        self.assertEqual(pkb.extract_md_links(""), [])

    def test_preserves_wikilinks_untouched_in_extract_wikilinks(self) -> None:
        # Backward-compat sanity: extract_wikilinks is unchanged.
        text = "See [[Alpha]] and [Alpha](pages/alpha.md)."
        wls = pkb.extract_wikilinks(text)
        self.assertEqual([w["target"] for w in wls], ["Alpha"])


# ── _normalise_md_target ──────────────────────────────────────────────────


class NormaliseMdTargetTests(unittest.TestCase):
    """Path normalisation for md-link resolution."""

    def test_bare_relative_resolves_against_base_dir(self) -> None:
        # File at `pages/alpha.md` links to `beta.md` → resolves to
        # `pages/beta.md` relative to wiki_root.
        norm = pkb._normalise_md_target(
            "beta.md", Path("pages"), Path("/wiki")
        )
        self.assertEqual(norm, "pages/beta.md")

    def test_dot_slash_prefix_normalised(self) -> None:
        norm = pkb._normalise_md_target(
            "./beta.md", Path("pages"), Path("/wiki")
        )
        self.assertEqual(norm, "pages/beta.md")

    def test_absolute_path_treated_as_wiki_root_relative(self) -> None:
        norm = pkb._normalise_md_target(
            "/pages/alpha.md", Path("anywhere"), Path("/wiki")
        )
        self.assertEqual(norm, "pages/alpha.md")

    def test_parent_dir_traversal(self) -> None:
        # `pages/sub/file.md` links to `../alpha.md` → `pages/alpha.md`.
        norm = pkb._normalise_md_target(
            "../alpha.md", Path("pages/sub"), Path("/wiki")
        )
        self.assertEqual(norm, "pages/alpha.md")

    def test_escape_above_wiki_root_returns_none(self) -> None:
        # `pages/alpha.md` links to `../../escape.md` (would escape wiki_root).
        norm = pkb._normalise_md_target(
            "../../escape.md", Path("pages"), Path("/wiki")
        )
        self.assertIsNone(norm)

    def test_query_and_fragment_stripped(self) -> None:
        norm = pkb._normalise_md_target(
            "pages/alpha.md#section", Path("."), Path("/wiki")
        )
        self.assertEqual(norm, "pages/alpha.md")
        norm2 = pkb._normalise_md_target(
            "pages/alpha.md?v=1", Path("."), Path("/wiki")
        )
        self.assertEqual(norm2, "pages/alpha.md")

    def test_normalised_lowercase(self) -> None:
        # `path_map` uses lower-cased keys for case-insensitive resolution.
        norm = pkb._normalise_md_target(
            "Pages/Alpha.MD", Path("."), Path("/wiki")
        )
        self.assertEqual(norm, "pages/alpha.md")


# ── parse_wiki end-to-end ─────────────────────────────────────────────────


class ParseWikiCommonMarkOnlyTests(unittest.TestCase):
    """Regression for issue #361: a Karpathy-detected wiki using only
    CommonMark `[](page.md)` links must produce deterministic edges.

    Pre-fix behaviour: 0 edges, 0 category memberships → silent degradation.
    """

    def setUp(self) -> None:
        self.fix = _WikiFixture()
        self.addCleanup(self.fix.cleanup)
        # A minimal Karpathy-shaped wiki (has index.md, multiple .md files,
        # ≥3 markdown files) but using only CommonMark links.
        self.fix.write(
            "index.md",
            "# Wiki Index\n\n"
            "## Topic\n\n"
            "- [Alpha](pages/alpha.md)\n"
            "- [Beta](pages/beta.md)\n",
        )
        self.fix.write(
            "pages/alpha.md",
            "# Alpha\n\nAlpha relates to [Beta](beta.md) and back to "
            "[the index](../index.md).\n",
        )
        self.fix.write(
            "pages/beta.md",
            "# Beta\n\nBeta references [Alpha](alpha.md).\n",
        )

    def test_detected_as_karpathy(self) -> None:
        det = pkb.detect_format(self.fix.tmp)
        self.assertTrue(det["detected"])
        self.assertEqual(det["format"], "karpathy")

    def test_md_link_edges_resolved(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        related_pairs = _edge_pairs(manifest, "related")
        # Alpha → Beta and Beta → Alpha (both via [](beta.md) and [](alpha.md))
        self.assertIn(
            ("article:pages/alpha", "article:pages/beta"), related_pairs,
            f"Expected alpha→beta edge; got: {related_pairs}",
        )
        self.assertIn(
            ("article:pages/beta", "article:pages/alpha"), related_pairs,
        )

    def test_categorized_under_edges_from_md_links_in_index(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        cat_pairs = _edge_pairs(manifest, "categorized_under")
        # Both alpha and beta should be categorised under "Topic".
        self.assertIn(("article:pages/alpha", "topic:topic"), cat_pairs)
        self.assertIn(("article:pages/beta", "topic:topic"), cat_pairs)

    def test_category_present_on_article_nodes(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        article_nodes = {
            n["id"]: n for n in manifest["nodes"] if n["type"] == "article"
        }
        self.assertEqual(
            article_nodes["article:pages/alpha"]["knowledgeMeta"]["category"],
            "Topic",
        )
        self.assertEqual(
            article_nodes["article:pages/beta"]["knowledgeMeta"]["category"],
            "Topic",
        )

    def test_topic_count_includes_md_links(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        topic_node = next(n for n in manifest["nodes"] if n["type"] == "topic")
        self.assertEqual(topic_node["name"], "Topic")
        # Summary mentions "(2 articles)" — both md-link entries counted.
        self.assertIn("(2 articles)", topic_node["summary"])

    def test_stats_reports_md_links(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        stats = manifest["stats"]
        # 3 md-links in body (alpha→beta + alpha→index + beta→alpha). The
        # alpha→index link resolves to an infra page (not an article) and is
        # counted as unresolved. We assert the floor (>= 2 successful) rather
        # than the exact total to keep the test resilient to additions.
        self.assertGreaterEqual(stats["mdLinks"], 2)
        # The deterministic parser produced edges — the core regression check.
        self.assertGreaterEqual(len(manifest["edges"]), 2)


class ParseWikiMixedSyntaxTests(unittest.TestCase):
    """Mixed Karpathy wiki: some pages use `[[ ]]`, others use `[](page.md)`.
    Both styles must contribute edges; neither path may regress."""

    def setUp(self) -> None:
        self.fix = _WikiFixture()
        self.addCleanup(self.fix.cleanup)
        # Index uses both syntaxes side-by-side under a single category.
        self.fix.write(
            "index.md",
            "# Wiki Index\n\n"
            "## Topic\n\n"
            "- [[alpha]]\n"
            "- [Beta](pages/beta.md)\n",
        )
        self.fix.write(
            "alpha.md",
            "# Alpha\n\nAlpha links via wikilink to [[beta]] and via "
            "md-link to [Gamma](pages/gamma.md).\n",
        )
        self.fix.write(
            "pages/beta.md",
            "# Beta\n\nBeta references [Alpha](../alpha.md).\n",
        )
        self.fix.write(
            "pages/gamma.md",
            "# Gamma\n\nGamma links back via [[alpha]].\n",
        )

    def test_wikilink_edges_preserved(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        related = _edge_pairs(manifest, "related")
        # alpha → beta via [[beta]]; gamma → alpha via [[alpha]]
        self.assertIn(("article:alpha", "article:pages/beta"), related)
        self.assertIn(("article:pages/gamma", "article:alpha"), related)

    def test_md_link_edges_added(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        related = _edge_pairs(manifest, "related")
        # alpha → gamma via [Gamma](pages/gamma.md)
        self.assertIn(("article:alpha", "article:pages/gamma"), related)
        # beta → alpha via [Alpha](../alpha.md)
        self.assertIn(("article:pages/beta", "article:alpha"), related)

    def test_mixed_category_lookups(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        article_nodes = {
            n["id"]: n for n in manifest["nodes"] if n["type"] == "article"
        }
        # alpha categorised via [[alpha]] wikilink in index.
        self.assertEqual(
            article_nodes["article:alpha"]["knowledgeMeta"]["category"],
            "Topic",
        )
        # beta categorised via [Beta](pages/beta.md) md-link in index.
        self.assertEqual(
            article_nodes["article:pages/beta"]["knowledgeMeta"]["category"],
            "Topic",
        )

    def test_categorized_under_mix(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        cat_pairs = _edge_pairs(manifest, "categorized_under")
        self.assertIn(("article:alpha", "topic:topic"), cat_pairs)
        self.assertIn(("article:pages/beta", "topic:topic"), cat_pairs)


class ParseWikiPureWikilinkRegressionTests(unittest.TestCase):
    """Existing pure-wikilink Karpathy wikis must produce the same edges as
    before — no regression from the md-link extraction additions."""

    def setUp(self) -> None:
        self.fix = _WikiFixture()
        self.addCleanup(self.fix.cleanup)
        self.fix.write(
            "index.md",
            "# Wiki Index\n\n## Topic\n\n- [[alpha]]\n- [[beta]]\n",
        )
        self.fix.write(
            "alpha.md",
            "# Alpha\n\nAlpha relates to [[beta]].\n",
        )
        self.fix.write(
            "beta.md",
            "# Beta\n\nBeta relates to [[alpha]].\n",
        )

    def test_no_md_link_stats_when_pure_wikilink(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        # mdLinks key exists but is 0 — no regression in counter behaviour.
        self.assertEqual(manifest["stats"]["mdLinks"], 0)
        # alpha.md and beta.md each carry one wikilink in their bodies
        # (`[[beta]]` and `[[alpha]]` respectively). Wikilinks inside
        # index.md are tallied by `parse_index`, not by `stats["wikilinks"]`,
        # which only counts links inside article bodies.
        self.assertEqual(manifest["stats"]["wikilinks"], 2)

    def test_wikilink_edges_match_expected(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        related = _edge_pairs(manifest, "related")
        self.assertEqual(
            related,
            {("article:alpha", "article:beta"), ("article:beta", "article:alpha")},
        )

    def test_categorized_under_unchanged(self) -> None:
        manifest = pkb.parse_wiki(self.fix.tmp)
        cat_pairs = _edge_pairs(manifest, "categorized_under")
        self.assertEqual(
            cat_pairs,
            {("article:alpha", "topic:topic"), ("article:beta", "topic:topic")},
        )

    def test_no_mdlinks_key_in_knowledge_meta(self) -> None:
        # Articles without md-links shouldn't carry an empty `mdLinks` key —
        # keeps the manifest output identical to pre-fix for pure wikilink
        # wikis.
        manifest = pkb.parse_wiki(self.fix.tmp)
        for node in manifest["nodes"]:
            if node["type"] == "article":
                self.assertNotIn(
                    "mdLinks", node.get("knowledgeMeta", {}),
                    f"node {node['id']} unexpectedly has mdLinks key",
                )


# ── resolve_md_link ───────────────────────────────────────────────────────


class ResolveMdLinkTests(unittest.TestCase):
    """`resolve_md_link` direct-call tests against a synthetic path_map."""

    def test_resolves_relative(self) -> None:
        path_map = {"pages/alpha.md": "pages/alpha"}
        article_ids = {"article:pages/alpha"}
        resolved = pkb.resolve_md_link(
            "alpha.md", Path("pages"), Path("/wiki"), path_map, article_ids,
        )
        self.assertEqual(resolved, "article:pages/alpha")

    def test_resolves_absolute(self) -> None:
        path_map = {"pages/alpha.md": "pages/alpha"}
        article_ids = {"article:pages/alpha"}
        resolved = pkb.resolve_md_link(
            "/pages/alpha.md", Path("other"), Path("/wiki"), path_map, article_ids,
        )
        self.assertEqual(resolved, "article:pages/alpha")

    def test_returns_none_for_unresolved(self) -> None:
        resolved = pkb.resolve_md_link(
            "missing.md", Path("."), Path("/wiki"), {}, set(),
        )
        self.assertIsNone(resolved)

    def test_returns_none_when_not_in_node_set(self) -> None:
        path_map = {"pages/alpha.md": "pages/alpha"}
        # node_ids deliberately empty — article is in path_map but not nodes.
        resolved = pkb.resolve_md_link(
            "alpha.md", Path("pages"), Path("/wiki"), path_map, set(),
        )
        self.assertIsNone(resolved)


if __name__ == "__main__":
    unittest.main()
