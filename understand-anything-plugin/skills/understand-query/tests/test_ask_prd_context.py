"""Tests for cmd_ask compact PRD context from knowledge services."""
import argparse
import pytest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from _commands import cmd_ask
from ua_query import parse_args


def _make_ask_args(**overrides):
    defaults = {
        "server": "http://localhost:3001",
        "service": None,
        "query": "公会结算",
        "depth": "standard",
        "platform": None,
        "limit": 5,
        "fusion": "rrf",
        "format": "json",
        "knowledge_read": False,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


PRD_TRACE_RESULT = {
    "kind": "knowledge-trace",
    "service": "amar-prd",
    "query": "公会结算",
    "matches": [{"id": "requirement:1", "name": "公会结算需求", "type": "requirement"}],
    "related": {},
    "coverage": [],
    "citedSources": [],
    "nextReads": [],
}


class TestCmdAskPrdContext:
    """cmd_ask should query compact knowledge trace and include prdContext."""

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_commands._helpers.fetch_json")
    @patch("_helpers._discover_knowledge_services")
    @patch("_commands._auto_discover_service")
    def test_cmd_ask_includes_prd_context_when_knowledge_service_exists(
        self, mock_auto_discover, mock_discover, mock_fetch_json, mock_search, mock_trace
    ):
        mock_auto_discover.return_value = ("code-svc", [{"name": "biz hit"}])
        mock_discover.return_value = ["amar-prd"]
        mock_fetch_json.return_value = PRD_TRACE_RESULT
        mock_trace.return_value = {"matchedNodes": [], "hint": "No KG nodes matched"}

        args = _make_ask_args(query="公会结算", depth="standard")
        result = cmd_ask(args)

        assert "prdContext" in result
        assert result["prdContext"] == PRD_TRACE_RESULT

        mock_fetch_json.assert_called_once_with(
            "http://localhost:3001",
            "/api/knowledge/trace",
            {"service": "amar-prd", "q": "公会结算", "limit": "5", "depth": "1"},
        )
        mock_trace.assert_called_once()

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_commands._helpers.fetch_json")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_warns_when_no_knowledge_services(
        self, mock_discover, mock_fetch_json, mock_search, mock_trace
    ):
        mock_discover.return_value = []
        mock_trace.return_value = {"matchedNodes": []}

        args = _make_ask_args(service="code-svc", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == {
            "kind": "knowledge-trace",
            "service": None,
            "query": "公会结算",
            "matches": [],
            "related": {},
            "coverage": [],
            "citedSources": [],
            "nextReads": [],
            "error": "No knowledge service found. Run system graph generation after /understand-knowledge.",
        }
        mock_fetch_json.assert_not_called()

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_commands._helpers.fetch_json")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_warns_and_survives_trace_fetch_error(
        self, mock_discover, mock_fetch_json, mock_search, mock_trace
    ):
        mock_discover.return_value = ["amar-prd"]
        mock_fetch_json.side_effect = RuntimeError("knowledge trace failed")
        mock_trace.return_value = {"matchedNodes": [{"id": "node:1", "name": "TestNode"}]}

        args = _make_ask_args(service="code-svc", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == {
            "kind": "knowledge-trace",
            "service": None,
            "query": "公会结算",
            "matches": [],
            "related": {},
            "coverage": [],
            "citedSources": [],
            "nextReads": [],
            "error": "Knowledge trace unavailable: knowledge trace failed",
            "candidates": ["amar-prd"],
        }
        mock_trace.assert_called_once()
        assert result.get("matchedNodes") == [{"id": "node:1", "name": "TestNode"}]

    @patch("_helpers._discover_knowledge_services")
    @patch("_commands._auto_discover_service")
    def test_cmd_ask_quick_depth_skips_prd_context(
        self, mock_auto_discover, mock_discover
    ):
        mock_auto_discover.return_value = ("code-svc", [{"name": "biz hit"}])
        mock_discover.return_value = ["amar-prd"]

        args = _make_ask_args(query="公会结算", depth="quick")
        result = cmd_ask(args)

        mock_discover.assert_not_called()
        assert "prdContext" not in result or result.get("prdContext") == []

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_commands._helpers.fetch_json")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_returns_error_when_multiple_knowledge_services(
        self, mock_discover, mock_fetch_json, mock_search, mock_trace
    ):
        mock_discover.return_value = ["prd-a", "prd-b"]
        mock_trace.return_value = {"matchedNodes": []}

        args = _make_ask_args(service="code-svc", query="跨房间 PK", depth="standard")
        result = cmd_ask(args)

        assert result.get("prdContext") == {
            "kind": "knowledge-trace",
            "service": None,
            "query": "跨房间 PK",
            "matches": [],
            "related": {},
            "coverage": [],
            "citedSources": [],
            "nextReads": [],
            "error": "Multiple knowledge services found. Pass --service to knowledge trace for explicit PRD context.",
            "candidates": ["prd-a", "prd-b"],
        }
        mock_fetch_json.assert_not_called()

    @patch("_commands.cmd_trace")
    @patch("_commands._search_api")
    @patch("_commands._helpers.fetch_json")
    @patch("_helpers._discover_knowledge_services")
    def test_cmd_ask_prd_context_reads_bounded_snippets_when_requested(
        self, mock_discover, mock_fetch_json, mock_search, mock_trace
    ):
        mock_discover.return_value = ["amar-prd"]
        mock_fetch_json.return_value = PRD_TRACE_RESULT
        mock_trace.return_value = {"matchedNodes": []}

        args = _make_ask_args(
            service="code-svc", query="跨房间PK", depth="full", knowledge_read=True
        )
        result = cmd_ask(args)

        assert result["prdContext"] == PRD_TRACE_RESULT
        trace_calls = [
            c for c in mock_fetch_json.call_args_list
            if c.args[1] == "/api/knowledge/trace"
        ]
        assert len(trace_calls) == 1
        assert trace_calls[0].args == (
            "http://localhost:3001",
            "/api/knowledge/trace",
            {"service": "amar-prd", "q": "跨房间PK", "limit": "5", "depth": "1", "read": "1"},
        )


def test_parse_args_accepts_ask_knowledge_read_flag():
    args = parse_args(["ask", "--query", "跨房间PK", "--depth", "full", "--knowledge-read"])

    assert args.knowledge_read is True
