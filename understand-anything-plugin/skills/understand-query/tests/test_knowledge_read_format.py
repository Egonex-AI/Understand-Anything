"""Tests for knowledge-read and knowledge-search markdown formatting."""
import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from _utils import _format_markdown


class TestKnowledgeReadFormat(unittest.TestCase):
    def test_knowledge_read_renders_content(self):
        data = {
            "kind": "knowledge-read",
            "service": "test-svc",
            "nodes": [
                {
                    "id": "article:concepts/Room",
                    "type": "article",
                    "name": "Room",
                    "filePath": "wiki/concepts/Room.md",
                    "knowledgeMeta": {
                        "content": "# Room\n\nRoom business domain.",
                        "sourcePath": "raw/prd/Room.md",
                    },
                }
            ],
            "total": 1,
        }
        output = _format_markdown(data)
        self.assertIn("Room", output)
        self.assertIn("Room business domain", output)
        self.assertIn("raw/prd/Room.md", output)

    def test_knowledge_search_shows_snippet(self):
        data = {
            "kind": "knowledge-search",
            "service": "test-svc",
            "query": "room",
            "results": [
                {
                    "id": "article:concepts/Room",
                    "name": "Room",
                    "type": "article",
                    "summary": "Room domain overview",
                    "score": 8.5,
                    "contentSnippet": "Room business domain covers PK, gifts, and more.",
                }
            ],
        }
        output = _format_markdown(data)
        self.assertIn("Room", output)
        self.assertIn("Room business domain covers PK", output)

    def test_knowledge_trace_markdown_is_compact(self):
        rendered = _format_markdown({
            "kind": "knowledge-trace",
            "service": "amar-prd",
            "query": "跨房间PK",
            "matches": [{
                "id": "requirement:summaries/room-pk",
                "name": "跨房间PK",
                "type": "requirement",
                "summary": "需求摘要",
                "filePath": "wiki/summaries/room-pk.md",
                "sourcePath": "raw/prd/房间/room-pk.md",
            }],
            "related": {
                "related": [{
                    "id": "article:concepts/room",
                    "name": "房间",
                    "type": "article",
                    "summary": "房间概念",
                    "filePath": "wiki/concepts/room.md",
                }],
                "cites": [],
                "tested_by": [],
                "categorized_under": [],
            },
            "coverage": [{
                "id": "testcase:testcases/room-pk",
                "name": "跨房间PK 测试用例",
                "type": "testcase",
                "summary": "测试摘要",
                "filePath": "wiki/testcases/room-pk.md",
            }],
            "citedSources": [{
                "id": "source:prd/room-pk",
                "name": "room-pk.md",
                "type": "source",
                "summary": "Raw PRD",
                "filePath": "raw/prd/房间/room-pk.md",
            }],
            "nextReads": [{
                "id": "requirement:summaries/room-pk",
                "filePath": "wiki/summaries/room-pk.md",
            }],
            "limits": {"contentIncluded": False},
        })
        self.assertTrue(rendered.startswith("# Knowledge Trace: 跨房间PK"))
        self.assertIn("## PRD Matches", rendered)
        self.assertIn("## Related", rendered)
        self.assertIn("## Cited Sources", rendered)
        self.assertIn("## Test Coverage", rendered)
        self.assertIn("## Next Reads", rendered)
        self.assertIn("knowledge read --service amar-prd --node", rendered)
        self.assertIn("需求摘要", rendered)

    def test_ask_markdown_renders_compact_prd_context(self):
        rendered = _format_markdown({
            "query": "跨房间PK",
            "service": "code-svc",
            "matchedNodes": [],
            "prdContext": {
                "kind": "knowledge-trace",
                "service": "amar-prd",
                "query": "跨房间PK",
                "matches": [{
                    "id": "requirement:summaries/room-pk",
                    "name": "跨房间PK",
                    "type": "requirement",
                    "summary": "需求摘要",
                    "filePath": "wiki/summaries/room-pk.md",
                    "sourcePath": "raw/prd/房间/room-pk.md",
                }],
                "related": {},
                "coverage": [{
                    "id": "testcase:testcases/room-pk",
                    "name": "跨房间PK 测试用例",
                    "type": "testcase",
                    "summary": "测试摘要",
                    "filePath": "wiki/testcases/room-pk.md",
                }],
                "citedSources": [{
                    "id": "source:prd/room-pk",
                    "name": "room-pk.md",
                    "type": "source",
                    "summary": "Raw PRD",
                    "filePath": "raw/prd/房间/room-pk.md",
                }],
                "nextReads": [{
                    "id": "requirement:summaries/room-pk",
                    "filePath": "wiki/summaries/room-pk.md",
                }],
            },
        })

        self.assertTrue(rendered.startswith("# Trace: 跨房间PK"))
        self.assertNotIn("# Knowledge Trace", rendered)
        self.assertIn("## PRD Context", rendered)
        self.assertIn("## PRD Matches", rendered)
        self.assertIn("跨房间PK", rendered)
        self.assertIn("测试摘要", rendered)
        self.assertIn("Raw PRD", rendered)
        self.assertIn("knowledge read --service amar-prd --node", rendered)

    def test_knowledge_trace_without_service_does_not_render_bad_read_command(self):
        rendered = _format_markdown({
            "kind": "knowledge-trace",
            "service": None,
            "query": "跨房间PK",
            "matches": [],
            "related": {},
            "coverage": [],
            "citedSources": [],
            "nextReads": [{
                "id": "requirement:summaries/room-pk",
                "filePath": "wiki/summaries/room-pk.md",
            }],
            "error": "Multiple knowledge services found.",
            "candidates": ["prd-a", "prd-b"],
        })

        self.assertIn("PRD context warning", rendered)
        self.assertIn("Candidates: prd-a, prd-b", rendered)
        self.assertIn("Node: `requirement:summaries/room-pk`", rendered)
        self.assertNotIn("--service None", rendered)
        self.assertNotIn("--service ?", rendered)


if __name__ == "__main__":
    unittest.main()
