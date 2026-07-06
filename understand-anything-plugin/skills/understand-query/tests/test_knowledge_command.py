import argparse
from pathlib import Path
from unittest.mock import patch
import pytest
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from _commands import cmd_knowledge
from _helpers import _resolve_knowledge_service
from _utils import _format_markdown
from ua_query import parse_args


def _args(**overrides):
    defaults = {
        "server": "http://localhost:3001",
        "service": "amar-prd",
        "search": None,
        "node": None,
        "neighbors": None,
        "coverage": None,
        "knowledge_action": "search",
        "query": None,
        "type": None,
        "edge_type": None,
        "direction": "both",
        "depth": 1,
        "limit": 20,
        "offset": 0,
        "read": False,
        "format": "json",
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def test_parse_knowledge_search_args():
    args = parse_args([
        "knowledge",
        "search",
        "跨房间 PK",
        "--type",
        "requirement",
        "--service",
        "amar-prd",
    ])

    assert args.command == "knowledge"
    assert args.knowledge_action == "search"
    assert args.query == "跨房间 PK"
    assert args.type == "requirement"
    assert args.service == "amar-prd"


def test_parse_knowledge_trace_args():
    args = parse_args([
        "knowledge", "trace", "跨房间 PK",
        "--service", "amar-prd",
        "--type", "requirement",
        "--depth", "2",
        "--read",
    ])

    assert args.command == "knowledge"
    assert args.knowledge_action == "trace"
    assert args.query == "跨房间 PK"
    assert args.service == "amar-prd"
    assert args.type == "requirement"
    assert args.limit == 5
    assert args.depth == 2
    assert args.read is True


@patch("_commands._search_api")
def test_knowledge_search_queries_kg_scope(mock_search):
    mock_search.return_value = [{"id": "requirement:1", "name": "跨房间 PK"}]

    result = cmd_knowledge(_args(query="跨房间 PK", type="requirement"))

    mock_search.assert_called_once_with(
        "http://localhost:3001",
        "跨房间 PK",
        service="amar-prd",
        scope="kg",
        limit=20,
        type="requirement",
        offset=0,
    )
    assert result == {
        "kind": "knowledge-search",
        "service": "amar-prd",
        "query": "跨房间 PK",
        "results": [{"id": "requirement:1", "name": "跨房间 PK"}],
    }


def test_knowledge_search_markdown_uses_knowledge_heading():
    rendered = _format_markdown({
        "kind": "knowledge-search",
        "service": "amar-prd",
        "query": "跨房间 PK",
        "results": [{"id": "requirement:1", "name": "跨房间 PK", "summary": "需求"}],
    })

    assert rendered.startswith("# Knowledge Search: 跨房间 PK")


def test_source_like_search_result_does_not_render_as_knowledge_search():
    rendered = _format_markdown({
        "query": "Q",
        "service": "svc",
        "results": [{"file": "a.py", "snippet": "x"}],
        "totalResults": 1,
    })

    assert not rendered.startswith("# Knowledge Search")


@patch("_commands._resolve_knowledge_service")
@patch("_commands._search_api")
def test_knowledge_search_auto_resolves_single_service(mock_search, mock_resolve):
    mock_resolve.return_value = "amar-prd"
    mock_search.return_value = []

    cmd_knowledge(_args(service=None, query="PK 测试"))

    mock_resolve.assert_called_once_with("http://localhost:3001", None)
    mock_search.assert_called_once_with(
        "http://localhost:3001",
        "PK 测试",
        service="amar-prd",
        scope="kg",
        limit=20,
        type=None,
        offset=0,
    )


@patch("_commands._resolve_knowledge_service")
@patch("_commands._helpers.fetch_json")
def test_knowledge_trace_calls_api_with_compact_defaults(mock_fetch, mock_resolve):
    mock_resolve.return_value = "amar-prd"
    mock_fetch.return_value = {
        "kind": "knowledge-trace",
        "service": "amar-prd",
        "query": "跨房间 PK",
        "matches": [],
        "related": {},
        "coverage": [],
        "citedSources": [],
        "nextReads": [],
        "limits": {"contentIncluded": False},
    }

    result = cmd_knowledge(_args(
        knowledge_action="trace",
        query="跨房间 PK",
        type="requirement",
        depth=2,
        limit=3,
        read=True,
    ))

    mock_resolve.assert_called_once_with("http://localhost:3001", "amar-prd")
    mock_fetch.assert_called_once_with(
        "http://localhost:3001",
        "/api/knowledge/trace",
        {
            "service": "amar-prd",
            "q": "跨房间 PK",
            "limit": "3",
            "depth": "2",
            "type": "requirement",
            "read": "1",
        },
    )
    assert result["kind"] == "knowledge-trace"


@patch("_commands._helpers.fetch_json")
def test_knowledge_coverage_queries_outbound_tested_by_neighbors(mock_fetch):
    mock_fetch.return_value = {
        "center": {"id": "requirement:1", "name": "跨房间 PK"},
        "neighbors": [
            {
                "node": {"id": "testcase:1", "name": "跨房间 PK 用例", "type": "testcase"},
                "edge": {"type": "tested_by"},
                "direction": "outbound",
            }
        ],
    }

    result = cmd_knowledge(_args(knowledge_action="coverage", node="requirement:1"))

    mock_fetch.assert_called_once_with(
        "http://localhost:3001",
        "/api/graph-query/neighbors",
        {
            "service": "amar-prd",
            "graph": "kg",
            "node": "requirement:1",
            "direction": "outbound",
            "depth": "1",
            "edgeType": "tested_by",
        },
    )
    assert result["kind"] == "knowledge-coverage"
    assert result["service"] == "amar-prd"
    assert result["requirement"] == {"id": "requirement:1", "name": "跨房间 PK"}
    assert result["coverage"] == [
        {"id": "testcase:1", "name": "跨房间 PK 用例", "type": "testcase"}
    ]
    assert result["total"] == 1


@patch("_helpers.fetch_json")
def test_resolve_knowledge_service_exits_when_none_found(mock_fetch):
    mock_fetch.return_value = {"services": []}

    with pytest.raises(SystemExit, match="No knowledge service found"):
        _resolve_knowledge_service("http://localhost:3001", None)


@patch("_helpers.fetch_json")
def test_resolve_knowledge_service_returns_single_available_kg_service(mock_fetch):
    mock_fetch.return_value = {
        "services": [
            {
                "name": "amar-prd",
                "facet": "knowledge",
                "dataLayers": {"kg": {"available": True}},
            },
            {
                "name": "code-service",
                "facet": "code",
                "dataLayers": {"kg": {"available": True}},
            },
        ]
    }

    assert _resolve_knowledge_service("http://localhost:3001", None) == "amar-prd"


@patch("_helpers.fetch_json")
def test_resolve_knowledge_service_exits_with_candidates_when_ambiguous(mock_fetch):
    mock_fetch.return_value = {
        "services": [
            {
                "name": "amar-prd",
                "facet": "knowledge",
                "dataLayers": {"kg": {"available": True}},
            },
            {
                "name": "other-prd",
                "facet": "knowledge",
                "dataLayers": {"kg": {"available": True}},
            },
        ]
    }

    with pytest.raises(SystemExit) as exc:
        _resolve_knowledge_service("http://localhost:3001", None)

    assert "Multiple knowledge services found" in str(exc.value)
    assert "amar-prd" in str(exc.value)
    assert "other-prd" in str(exc.value)
