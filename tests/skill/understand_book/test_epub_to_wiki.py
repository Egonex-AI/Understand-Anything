#!/usr/bin/env python3
"""
Tests for /understand-book deterministic EPUB ingestion.

Run from repo root:
    python -m unittest tests.skill.understand_book.test_epub_to_wiki -v
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_SKILL_DIR = _REPO_ROOT / "understand-anything-plugin" / "skills" / "understand-book"
_SCRIPT = _SKILL_DIR / "epub-to-wiki.py"
_PIPELINE_SCRIPT = _SKILL_DIR / "run-understand-book.py"


def _write_tiny_epub(path: Path) -> None:
    """Create a tiny valid EPUB 3 archive with two spine chapters."""
    container_xml = """<?xml version='1.0' encoding='utf-8'?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""
    opf = """<?xml version='1.0' encoding='utf-8'?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:tiny-book</dc:identifier>
    <dc:title>Tiny Test Book</dc:title>
    <dc:creator>Draco</dc:creator>
    <dc:language>zh</dc:language>
    <dc:publisher>Hermes Press</dc:publisher>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapters/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapters/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>
"""
    nav = """<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><ol>
<li><a href="chapters/ch1.xhtml">第一章 开端</a></li>
<li><a href="chapters/ch2.xhtml">第二章 回声</a></li>
</ol></nav></body></html>"""
    ch1 = """<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 开端</title></head><body>
<h1>第一章 开端</h1><p>人工智能改变阅读方式。</p><p>知识图谱把概念连接起来。</p>
</body></html>"""
    ch2 = """<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 回声</title></head><body>
<h1>第二章 回声</h1><p>人工智能再次出现。</p><p>证据必须绑定原文。</p>
</body></html>"""

    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", container_xml)
        zf.writestr("OEBPS/content.opf", opf)
        zf.writestr("OEBPS/nav.xhtml", nav)
        zf.writestr("OEBPS/chapters/ch1.xhtml", ch1)
        zf.writestr("OEBPS/chapters/ch2.xhtml", ch2)
        zf.writestr("OEBPS/images/cover.png", b"\x89PNG\r\n\x1a\n")


class EpubToWikiTests(unittest.TestCase):
    def test_epub_to_wiki_writes_manifest_chapters_and_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            epub_path = tmp_path / "tiny.epub"
            out_dir = tmp_path / "book-output"
            _write_tiny_epub(epub_path)

            result = subprocess.run(
                ["python3", str(_SCRIPT), str(epub_path), "--output", str(out_dir), "--language", "zh"],
                cwd=_REPO_ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            manifest_path = out_dir / ".understand-anything" / "intermediate" / "book-manifest.json"
            self.assertTrue(manifest_path.is_file())
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            self.assertEqual(manifest["book"]["title"], "Tiny Test Book")
            self.assertEqual(manifest["book"]["authors"], ["Draco"])
            self.assertEqual(manifest["book"]["language"], "zh")
            self.assertEqual([c["id"] for c in manifest["chapters"]], ["ch01", "ch02"])
            self.assertEqual(manifest["chapters"][0]["title"], "第一章 开端")
            self.assertGreater(manifest["chapters"][0]["char_count"], 0)
            self.assertEqual(len(manifest["assets"]), 1)

            index = (out_dir / "wiki" / "index.md").read_text(encoding="utf-8")
            self.assertIn("# Tiny Test Book", index)
            self.assertIn("[[chapters/ch01|第一章 开端]]", index)
            self.assertIn("[[chapters/ch02|第二章 回声]]", index)

            ch01 = (out_dir / "wiki" / "chapters" / "ch01.md").read_text(encoding="utf-8")
            self.assertIn("# 第一章 开端", ch01)
            self.assertIn("人工智能改变阅读方式。", ch01)
            self.assertIn("## Source", ch01)

            raw_copy = out_dir / "raw" / "tiny.epub"
            self.assertTrue(raw_copy.is_file())

    def test_pipeline_writes_root_knowledge_graph_and_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            epub_path = tmp_path / "tiny.epub"
            out_dir = tmp_path / "book-output"
            _write_tiny_epub(epub_path)

            result = subprocess.run(
                ["python3", str(_PIPELINE_SCRIPT), str(epub_path), "--output", str(out_dir), "--language", "zh"],
                cwd=_REPO_ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            root_graph_path = out_dir / ".understand-anything" / "knowledge-graph.json"
            self.assertTrue(root_graph_path.is_file())
            graph = json.loads(root_graph_path.read_text(encoding="utf-8"))
            self.assertEqual(graph["kind"], "knowledge")
            self.assertGreaterEqual(len(graph["nodes"]), 4)
            self.assertGreaterEqual(len(graph["edges"]), 2)

            meta_path = out_dir / ".understand-anything" / "meta.json"
            self.assertTrue(meta_path.is_file())
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            self.assertEqual(meta["sourceType"], "epub")
            self.assertEqual(meta["analyzedFiles"], 2)
            self.assertIn("book", meta)

            wiki_graph_path = out_dir / "wiki" / ".understand-anything" / "knowledge-graph.json"
            self.assertTrue(wiki_graph_path.is_file())

            report_path = out_dir / "book-report.md"
            self.assertTrue(report_path.is_file())
            report = report_path.read_text(encoding="utf-8")
            self.assertIn("# 《Tiny Test Book》理解报告", report)
            self.assertIn("## 章节导读", report)
            self.assertIn("第一章 开端", report)
            self.assertIn("第二章 回声", report)


if __name__ == "__main__":
    unittest.main()
