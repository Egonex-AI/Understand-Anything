import pytest
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from assemble_business_features import (
    assemble_features,
    _build_feature_document,
    _merge_server_associations,
)


@pytest.fixture
def association_results():
    """Phase 2 association discovery results."""
    return [
        {
            "featureName": "即时通讯",
            "primaryServer": {"domain": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.95},
            "supportingServers": [
                {"domain": "用户关系", "service": "ultron-relation", "relationship": "depends_on", "confidence": 0.7},
                {"domain": "推送服务", "service": "ultron-wrapper", "relationship": "calls", "confidence": 0.8},
            ],
            "error": None,
        },
        {
            "featureName": "家族运营",
            "primaryServer": {"domain": "公会管理", "service": "ultron-guild", "confidence": 0.85},
            "supportingServers": [],
            "error": None,
        },
        {
            "featureName": "苹果支付",
            "primaryServer": {"domain": "支付账户", "service": "ultron-payaccount", "confidence": 0.9},
            "supportingServers": [],
            "error": None,
        },
    ]


@pytest.fixture
def consolidation_data():
    """Phase 1 consolidation data."""
    return {
        "consolidated": [
            {
                "name": "即时通讯",
                "implType": "cross-platform",
                "platforms": ["Amar", "ddoversea", "ddoversea_flutter"],
                "deliveryPlatforms": ["Amar", "ddoversea", "ddoversea_flutter"],
                "implementations": [
                    {"platform": "Amar", "domainName": "即时通讯", "domainId": "instant-messaging", "summary": "iOS端IM"},
                    {"platform": "ddoversea", "domainName": "即时通讯与私信", "domainId": "im-chat", "summary": "Android端IM"},
                    {"platform": "ddoversea_flutter", "domainName": "群聊社交", "domainId": "group-chat", "summary": "Flutter群聊"},
                ],
                "mergedSummary": "[Amar] iOS端IM [ddoversea] Android端IM [ddoversea_flutter] Flutter群聊",
            },
            {
                "name": "家族运营",
                "implType": "flutter-only",
                "platforms": ["ddoversea_flutter"],
                "deliveryPlatforms": ["Amar", "ddoversea", "ddoversea_flutter"],
                "implementations": [
                    {"platform": "ddoversea_flutter", "domainName": "家族运营", "domainId": "family", "summary": "FlutterBoost家族模块"},
                ],
                "mergedSummary": "[ddoversea_flutter] FlutterBoost家族模块",
            },
        ],
        "standalone": [
            {"name": "苹果支付", "platform": "Amar", "domainId": "apple-payment", "implType": "native-specific", "deliveryPlatforms": ["Amar"]},
        ],
        "infrastructure": [],
    }


class TestBuildFeatureDocument:
    def test_basic_structure(self, association_results, consolidation_data):
        """Feature document should have required top-level fields."""
        feature_data = consolidation_data["consolidated"][0]
        assoc = association_results[0]
        doc = _build_feature_document(feature_data, assoc)

        assert doc["id"] == "feature:即时通讯"
        assert doc["name"] == "即时通讯"
        assert "clientLayer" in doc
        assert "serverLayer" in doc

    def test_client_layer_includes_platforms(self, association_results, consolidation_data):
        """clientLayer should contain per-platform implementation info."""
        feature_data = consolidation_data["consolidated"][0]
        assoc = association_results[0]
        doc = _build_feature_document(feature_data, assoc)

        client = doc["clientLayer"]
        assert client["implType"] == "cross-platform"
        assert "Amar" in client["platforms"]
        assert "ddoversea" in client["platforms"]

    def test_server_layer_includes_primary_and_supporting(self, association_results, consolidation_data):
        """serverLayer should include primary + supporting domains."""
        feature_data = consolidation_data["consolidated"][0]
        assoc = association_results[0]
        doc = _build_feature_document(feature_data, assoc)

        server = doc["serverLayer"]
        assert server["primaryDomain"]["name"] == "Cosmos IM"
        assert server["primaryDomain"]["service"] == "ultron-group-chat"
        assert len(server["supportingDomains"]) == 2

    def test_standalone_feature_has_single_platform(self, association_results, consolidation_data):
        """Standalone (native-specific) feature should show single platform."""
        feature_data = {
            "name": "苹果支付",
            "implType": "native-specific",
            "platforms": ["Amar"],
            "deliveryPlatforms": ["Amar"],
            "implementations": [],
            "mergedSummary": "",
        }
        assoc = association_results[2]
        doc = _build_feature_document(feature_data, assoc)

        assert doc["clientLayer"]["implType"] == "native-specific"
        assert doc["clientLayer"]["platforms"] == {"Amar": {}}

    def test_no_server_association_returns_empty_server_layer(self, consolidation_data):
        """Feature with error in association should have empty serverLayer."""
        feature_data = consolidation_data["consolidated"][0]
        assoc = {"featureName": "即时通讯", "primaryServer": None, "supportingServers": [], "error": "LLM failed"}
        doc = _build_feature_document(feature_data, assoc)

        assert doc["serverLayer"]["primaryDomain"] is None
        assert doc["serverLayer"]["supportingDomains"] == []


class TestMergeServerAssociations:
    def test_merges_multiple_features_into_server_view(self, association_results):
        """Should produce a server-domain→features reverse index."""
        index = _merge_server_associations(association_results)
        assert "Cosmos IM" in index
        assert "即时通讯" in index["Cosmos IM"]["features"]

    def test_counts_references_correctly(self, association_results):
        """Each server domain should count total feature references."""
        index = _merge_server_associations(association_results)
        assert index["Cosmos IM"]["refCount"] == 1
        assert index["用户关系"]["refCount"] == 1


class TestAssembleFeatures:
    def test_produces_feature_list(self, association_results, consolidation_data):
        """Should produce a list of feature documents."""
        result = assemble_features(association_results, consolidation_data)
        assert "features" in result
        assert len(result["features"]) == 3

    def test_produces_server_index(self, association_results, consolidation_data):
        """Should produce a server domain reverse index."""
        result = assemble_features(association_results, consolidation_data)
        assert "serverIndex" in result
        assert "Cosmos IM" in result["serverIndex"]

    def test_skips_errored_associations_gracefully(self, consolidation_data):
        """Errored associations should produce degraded feature docs."""
        assocs = [
            {"featureName": "即时通讯", "primaryServer": None, "supportingServers": [], "error": "timeout"},
            {"featureName": "家族运营", "primaryServer": {"domain": "X", "service": "y", "confidence": 0.8}, "supportingServers": [], "error": None},
        ]
        result = assemble_features(assocs, consolidation_data)
        assert len(result["features"]) == 2
        assert result["features"][0]["serverLayer"]["primaryDomain"] is None

    def test_output_includes_stats(self, association_results, consolidation_data):
        """Output should include coverage statistics."""
        result = assemble_features(association_results, consolidation_data)
        assert "stats" in result
        assert result["stats"]["totalFeatures"] == 3
        assert result["stats"]["withServerAssociation"] > 0
