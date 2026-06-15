import pytest
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from association_discovery import (
    build_discovery_prompt,
    parse_discovery_response,
    discover_associations,
    to_phase3_format,
    _extract_json,
)


@pytest.fixture
def consolidated_features():
    """Consolidated client features from Phase 1a."""
    return [
        {
            "name": "即时通讯",
            "implType": "cross-platform",
            "platforms": ["Amar", "ddoversea", "ddoversea_flutter"],
            "deliveryPlatforms": ["Amar", "ddoversea", "ddoversea_flutter"],
            "mergedSummary": "[Amar] iOS端IM [ddoversea] Android端IM [ddoversea_flutter] Flutter群聊",
        },
        {
            "name": "家族运营",
            "implType": "flutter-only",
            "platforms": ["ddoversea_flutter"],
            "deliveryPlatforms": ["Amar", "ddoversea", "ddoversea_flutter"],
            "mergedSummary": "[ddoversea_flutter] FlutterBoost家族管理模块",
        },
    ]


@pytest.fixture
def server_domains():
    """Server domains with summaries."""
    return {
        "Cosmos IM": {
            "data": {"name": "Cosmos IM", "summary": "即时通讯核心，消息路由、存储与群聊管理"},
            "endpoints": ["/api/v1/msg/send", "/api/v1/group/create"],
            "service": "ultron-group-chat",
        },
        "用户关系": {
            "data": {"name": "用户关系", "summary": "好友关系管理、关注列表、黑名单"},
            "endpoints": ["/api/v1/relation/follow", "/api/v1/relation/block"],
            "service": "ultron-relation",
        },
        "公会管理": {
            "data": {"name": "公会管理", "summary": "公会创建、家族等级、成员管理"},
            "endpoints": ["/api/v1/guild/create", "/api/v1/guild/members"],
            "service": "ultron-guild",
        },
    }


class TestBuildDiscoveryPrompt:
    def test_prompt_contains_feature_info(self, consolidated_features, server_domains):
        """Prompt should include feature name and summary."""
        prompt = build_discovery_prompt(consolidated_features[0], server_domains)
        assert "即时通讯" in prompt
        assert "iOS端IM" in prompt

    def test_prompt_contains_all_server_domains(self, consolidated_features, server_domains):
        """Prompt should list all server domains for selection."""
        prompt = build_discovery_prompt(consolidated_features[0], server_domains)
        assert "Cosmos IM" in prompt
        assert "用户关系" in prompt
        assert "公会管理" in prompt

    def test_prompt_contains_server_summaries(self, consolidated_features, server_domains):
        """Prompt should include server domain summaries for context."""
        prompt = build_discovery_prompt(consolidated_features[0], server_domains)
        assert "消息路由" in prompt
        assert "好友关系" in prompt

    def test_prompt_requests_json_format(self, consolidated_features, server_domains):
        """Prompt should request JSON output format."""
        prompt = build_discovery_prompt(consolidated_features[0], server_domains)
        assert "primaryServer" in prompt
        assert "supportingServers" in prompt
        assert "JSON" in prompt


class TestParseDiscoveryResponse:
    def test_parse_valid_response(self):
        """Valid JSON response should be parsed correctly."""
        response = json.dumps({
            "primaryServer": {"domain": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.95},
            "supportingServers": [
                {"domain": "用户关系", "service": "ultron-relation", "relationship": "depends_on", "confidence": 0.7}
            ]
        })
        result = parse_discovery_response(response, "即时通讯")
        assert result["featureName"] == "即时通讯"
        assert result["primaryServer"]["domain"] == "Cosmos IM"
        assert result["primaryServer"]["confidence"] == 0.95
        assert len(result["supportingServers"]) == 1

    def test_parse_no_primary_server(self):
        """Response with no primary server returns None primary."""
        response = json.dumps({
            "primaryServer": None,
            "supportingServers": []
        })
        result = parse_discovery_response(response, "苹果支付")
        assert result["primaryServer"] is None
        assert result["supportingServers"] == []

    def test_parse_invalid_json_returns_error(self):
        """Invalid JSON should return error result."""
        result = parse_discovery_response("not valid json", "test")
        assert result["error"] is not None

    def test_parse_filters_low_confidence(self):
        """Supporting servers below threshold should be filtered."""
        response = json.dumps({
            "primaryServer": {"domain": "X", "service": "svc-x", "confidence": 0.9},
            "supportingServers": [
                {"domain": "Y", "service": "svc-y", "relationship": "calls", "confidence": 0.3},
                {"domain": "Z", "service": "svc-z", "relationship": "calls", "confidence": 0.8},
            ]
        })
        result = parse_discovery_response(response, "test", min_confidence=0.5)
        assert len(result["supportingServers"]) == 1
        assert result["supportingServers"][0]["domain"] == "Z"


class TestDiscoverAssociations:
    def test_discover_returns_associations_per_feature(self, consolidated_features, server_domains):
        """discover_associations should return one result per feature."""
        mock_llm_response = json.dumps({
            "primaryServer": {"domain": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.9},
            "supportingServers": []
        })

        with patch("association_discovery._call_llm") as mock_llm:
            mock_llm.return_value = mock_llm_response
            results = discover_associations(consolidated_features, server_domains)

        assert len(results) == 2
        assert results[0]["featureName"] == "即时通讯"
        assert results[1]["featureName"] == "家族运营"

    def test_discover_calls_llm_per_feature(self, consolidated_features, server_domains):
        """Should call LLM once per feature (not N×M times)."""
        mock_response = json.dumps({
            "primaryServer": {"domain": "X", "service": "svc", "confidence": 0.8},
            "supportingServers": []
        })

        with patch("association_discovery._call_llm") as mock_llm:
            mock_llm.return_value = mock_response
            discover_associations(consolidated_features, server_domains)

        assert mock_llm.call_count == len(consolidated_features)

    def test_discover_handles_llm_failure_gracefully(self, consolidated_features, server_domains):
        """LLM failure for one feature should not crash the entire process."""
        responses = [
            json.dumps({"primaryServer": {"domain": "Cosmos IM", "service": "x", "confidence": 0.9}, "supportingServers": []}),
            "INVALID_JSON_RESPONSE",
        ]

        with patch("association_discovery._call_llm") as mock_llm:
            mock_llm.side_effect = responses
            results = discover_associations(consolidated_features, server_domains)

        assert len(results) == 2
        assert results[0]["primaryServer"] is not None
        assert results[1].get("error") is not None

    def test_output_format_compatible_with_phase3(self, consolidated_features, server_domains):
        """Output should include fields needed by Phase 3 (interaction builder)."""
        mock_response = json.dumps({
            "primaryServer": {"domain": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.9},
            "supportingServers": [
                {"domain": "用户关系", "service": "ultron-relation", "relationship": "depends_on", "confidence": 0.75}
            ]
        })

        with patch("association_discovery._call_llm") as mock_llm:
            mock_llm.return_value = mock_response
            results = discover_associations(consolidated_features, server_domains)

        r = results[0]
        assert "featureName" in r
        assert "primaryServer" in r
        assert "supportingServers" in r
        assert "relationship" in r["supportingServers"][0]

    def test_discover_validates_domain_names(self, consolidated_features, server_domains):
        """LLM-returned domain names not in server_domains should be rejected."""
        mock_response = json.dumps({
            "primaryServer": {"domain": "不存在的域", "service": "fake", "confidence": 0.9},
            "supportingServers": [
                {"domain": "Cosmos IM", "service": "ultron-group-chat", "relationship": "calls", "confidence": 0.8}
            ]
        })

        with patch("association_discovery._call_llm") as mock_llm:
            mock_llm.return_value = mock_response
            results = discover_associations(consolidated_features, server_domains)

        assert results[0]["primaryServer"] is None
        assert len(results[0]["supportingServers"]) == 1


class TestToPhase3Format:
    def test_transforms_to_flat_format(self):
        """Should produce flat {server_domain, client_domain} entries."""
        associations = [
            {
                "featureName": "即时通讯",
                "primaryServer": {"domain": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.9},
                "supportingServers": [
                    {"domain": "用户关系", "service": "ultron-relation", "relationship": "depends_on", "confidence": 0.7}
                ],
                "error": None,
            }
        ]
        flat = to_phase3_format(associations)
        assert len(flat) == 2
        assert flat[0]["server_domain"] == "Cosmos IM"
        assert flat[0]["client_domain"] == "即时通讯"
        assert flat[0]["matchType"] == "llm-association"
        assert flat[1]["relationship"] == "depends_on"

    def test_skips_errored_associations(self):
        """Entries with errors should be skipped."""
        associations = [
            {"featureName": "test", "primaryServer": None, "supportingServers": [], "error": "LLM failed"}
        ]
        flat = to_phase3_format(associations)
        assert flat == []


class TestExtractJson:
    def test_strips_markdown_fences(self):
        """Should extract JSON from markdown code blocks."""
        text = '```json\n{"key": "value"}\n```'
        assert _extract_json(text) == '{"key": "value"}'

    def test_finds_json_in_text(self):
        """Should find JSON object in surrounding text."""
        text = 'Here is the result:\n{"key": "value"}\nDone.'
        assert _extract_json(text) == '{"key": "value"}'

    def test_passthrough_clean_json(self):
        """Clean JSON should pass through unchanged."""
        text = '{"key": "value"}'
        assert _extract_json(text) == '{"key": "value"}'
