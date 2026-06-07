#!/usr/bin/env python3
"""
Run the first deterministic /understand-book pipeline.

Pipeline:
    EPUB → wiki scaffold → understand-knowledge deterministic scan/merge
         → root .understand-anything/knowledge-graph.json + meta.json

This intentionally avoids provider-specific LLM calls. The existing
/understand-knowledge skill can still add analysis-batch-*.json later.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_SKILL_DIR = Path(__file__).resolve().parent
_KNOWLEDGE_SKILL_DIR = _SKILL_DIR.parent / "understand-knowledge"
_EPUB_TO_WIKI = _SKILL_DIR / "epub-to-wiki.py"
_PARSE_KNOWLEDGE = _KNOWLEDGE_SKILL_DIR / "parse-knowledge-base.py"
_MERGE_KNOWLEDGE = _KNOWLEDGE_SKILL_DIR / "merge-knowledge-graph.py"


class PipelineError(RuntimeError):
    """Human-readable pipeline error."""


def _load_epub_module() -> Any:
    spec = importlib.util.spec_from_file_location("understand_book_epub_to_wiki", _EPUB_TO_WIKI)
    if spec is None or spec.loader is None:
        raise PipelineError(f"ERR_PIPELINE_IMPORT_FAILED: {_EPUB_TO_WIKI}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["understand_book_epub_to_wiki"] = module
    spec.loader.exec_module(module)
    return module


def run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    printable = " ".join(command)
    print(f"[understand-book] $ {printable}")
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    if result.returncode != 0:
        raise PipelineError(f"ERR_PIPELINE_COMMAND_FAILED: {printable}")
    return result


def validate_graph(graph: dict[str, Any]) -> None:
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not nodes:
        raise PipelineError("ERR_GRAPH_EMPTY: graph has no nodes")
    if not isinstance(edges, list):
        raise PipelineError("ERR_GRAPH_INVALID: graph edges must be a list")

    node_ids = {node.get("id") for node in nodes if isinstance(node, dict)}
    dangling = [
        edge
        for edge in edges
        if isinstance(edge, dict)
        and (edge.get("source") not in node_ids or edge.get("target") not in node_ids)
    ]
    if dangling:
        raise PipelineError(f"ERR_GRAPH_DANGLING_EDGES: {len(dangling)} dangling edges")


def write_book_report(output_dir: Path, manifest: dict[str, Any], graph: dict[str, Any]) -> Path:
    book = manifest.get("book", {})
    title = book.get("title") or "未知书名"
    authors = book.get("authors") or []
    chapters = manifest.get("chapters", [])
    nodes = graph.get("nodes", []) if isinstance(graph.get("nodes"), list) else []
    edges = graph.get("edges", []) if isinstance(graph.get("edges"), list) else []

    lines = [
        f"# 《{title}》理解报告",
        "",
        "## 一句话总结",
        "",
        f"这是一本包含 {len(chapters)} 个章节的 EPUB 书籍，已转换为可浏览 wiki 和知识图谱。",
        "",
        "## 书籍信息",
        "",
        f"- 书名：{title}",
        f"- 作者：{', '.join(authors) if authors else 'unknown'}",
        f"- 语言：{book.get('language') or 'unknown'}",
        f"- 出版方：{book.get('publisher') or 'unknown'}",
        "",
        "## 全书结构",
        "",
        f"- 章节数：{len(chapters)}",
        f"- 图谱节点数：{len(nodes)}",
        f"- 图谱边数：{len(edges)}",
        "",
        "## 章节导读",
        "",
    ]

    for chapter in chapters:
        lines.append(f"### {chapter.get('title') or chapter.get('id')}")
        lines.append("")
        lines.append(f"- 章节 ID：`{chapter.get('id')}`")
        lines.append(f"- 字符数：{chapter.get('char_count', 0)}")
        lines.append(f"- Wiki：`wiki/chapters/{chapter.get('id')}.md`")
        lines.append("")

    lines.extend(
        [
            "## 知识图谱解读",
            "",
            "当前版本生成章节级结构图谱；后续可叠加 LLM 章节分析，抽取概念、实体、论点、证据与跨章节关系。",
            "",
            "## 输出文件",
            "",
            "- `wiki/index.md`：书籍 wiki 入口",
            "- `.understand-anything/knowledge-graph.json`：dashboard 图谱",
            "- `.understand-anything/intermediate/book-manifest.json`：EPUB 解析清单",
        ]
    )

    report_path = output_dir / "book-report.md"
    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return report_path


def write_root_outputs(output_dir: Path, manifest: dict[str, Any]) -> tuple[Path, Path, Path]:
    wiki_dir = output_dir / "wiki"
    wiki_intermediate = wiki_dir / ".understand-anything" / "intermediate"
    assembled_graph_path = wiki_intermediate / "assembled-graph.json"
    if not assembled_graph_path.is_file():
        raise PipelineError(f"ERR_GRAPH_NOT_FOUND: {assembled_graph_path}")

    graph = json.loads(assembled_graph_path.read_text(encoding="utf-8"))
    validate_graph(graph)

    wiki_graph_dir = wiki_dir / ".understand-anything"
    wiki_graph_dir.mkdir(parents=True, exist_ok=True)
    wiki_graph_path = wiki_graph_dir / "knowledge-graph.json"
    wiki_graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    root_graph_dir = output_dir / ".understand-anything"
    root_graph_dir.mkdir(parents=True, exist_ok=True)
    root_graph_path = root_graph_dir / "knowledge-graph.json"
    shutil.copy2(wiki_graph_path, root_graph_path)

    meta = {
        "lastAnalyzedAt": datetime.now(timezone.utc).isoformat(),
        "gitCommitHash": "",
        "version": "1.0.0",
        "sourceType": "epub",
        "analyzedFiles": len(manifest.get("chapters", [])),
        "book": manifest.get("book", {}),
        "manifestPath": str(output_dir / ".understand-anything" / "intermediate" / "book-manifest.json"),
        "wikiGraphPath": str(wiki_graph_path),
    }
    meta_path = root_graph_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report_path = write_book_report(output_dir, manifest, graph)
    return root_graph_path, meta_path, report_path


def run_pipeline(input_path: Path, output_dir: Path, language: str) -> dict[str, Any]:
    epub_module = _load_epub_module()

    print(f"[understand-book] input: {input_path}")
    print(f"[understand-book] output: {output_dir}")
    print("[1/4] Convert EPUB to wiki scaffold...")
    manifest = epub_module.ingest_epub(input_path.resolve(), output_dir.resolve(), language)
    print(
        f"[1/4] Manifest ready: {len(manifest['chapters'])} chapters, "
        f"{len(manifest.get('assets', []))} assets"
    )

    wiki_dir = output_dir / "wiki"
    print("[2/4] Parse wiki scaffold...")
    run_command([sys.executable, str(_PARSE_KNOWLEDGE), str(wiki_dir)], cwd=output_dir)

    print("[3/4] Merge knowledge graph...")
    run_command([sys.executable, str(_MERGE_KNOWLEDGE), str(wiki_dir)], cwd=output_dir)

    print("[4/4] Save root graph and metadata...")
    graph_path, meta_path, report_path = write_root_outputs(output_dir, manifest)
    print(f"[4/4] Graph: {graph_path}")
    print(f"[4/4] Meta: {meta_path}")
    print(f"[4/4] Report: {report_path}")
    print("Done.")
    return {
        "manifest": manifest,
        "graphPath": str(graph_path),
        "metaPath": str(meta_path),
        "reportPath": str(report_path),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run deterministic EPUB book understanding pipeline")
    parser.add_argument("input", help="Path to .epub file")
    parser.add_argument("--output", default=".understand-book", help="Output directory")
    parser.add_argument("--language", default="", help="Output language override")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        run_pipeline(Path(args.input), Path(args.output), args.language)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
