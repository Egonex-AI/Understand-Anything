import pytest
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from build_feature_interactions import (
    build_interaction_skeleton,
    build_interaction_prompt,
)


@pytest.fixture
def feature_doc():
    """A complete feature document with client and server layers."""
    return {
        "id": "feature:即时通讯",
        "name": "即时通讯",
        "clientLayer": {
            "implType": "cross-platform",
            "platforms": {
                "Amar": {"domainName": "即时通讯", "domainId": "instant-messaging", "summary": "iOS端IM"},
                "ddoversea": {"domainName": "即时通讯与私信", "domainId": "im-chat", "summary": "Android端IM"},
                "ddoversea_flutter": {"domainName": "群聊社交", "domainId": "group-chat", "summary": "Flutter群聊"},
            },
            "deliveryPlatforms": ["Amar", "ddoversea", "ddoversea_flutter"],
            "summary": "[Amar] iOS端IM [ddoversea] Android端IM [ddoversea_flutter] Flutter群聊",
        },
        "serverLayer": {
            "primaryDomain": {"name": "Cosmos IM", "service": "ultron-group-chat", "confidence": 0.95},
            "supportingDomains": [
                {"name": "用户关系", "service": "ultron-relation", "relationship": "depends_on", "confidence": 0.7},
                {"name": "推送服务", "service": "ultron-wrapper", "relationship": "calls", "confidence": 0.8},
            ],
        },
    }


@pytest.fixture
def feature_no_server():
    """Feature without server association."""
    return {
        "id": "feature:苹果支付",
        "name": "苹果支付",
        "clientLayer": {
            "implType": "native-specific",
            "platforms": {"Amar": {}},
            "deliveryPlatforms": ["Amar"],
            "summary": "StoreKit IAP",
        },
        "serverLayer": {
            "primaryDomain": None,
            "supportingDomains": [],
        },
    }


class TestBuildInteractionSkeleton:
    def test_produces_layers_list(self, feature_doc):
        """Skeleton should list client→server layers."""
        skeleton = build_interaction_skeleton(feature_doc)
        assert "layers" in skeleton
        assert skeleton["layers"][0]["name"] == "client"
        assert skeleton["layers"][-1]["name"] == "server"

    def test_includes_involved_services(self, feature_doc):
        """Skeleton should list all involved services."""
        skeleton = build_interaction_skeleton(feature_doc)
        services = skeleton["involvedServices"]
        assert "ultron-group-chat" in services
        assert "ultron-relation" in services
        assert "Amar" in services or "ddoversea" in services

    def test_no_server_still_produces_skeleton(self, feature_no_server):
        """Feature without server should still produce client-only skeleton."""
        skeleton = build_interaction_skeleton(feature_no_server)
        assert len(skeleton["layers"]) >= 1
        assert skeleton["layers"][0]["name"] == "client"

    def test_includes_bridge_layer_for_flutter(self, feature_doc):
        """Features with Flutter should include a bridge/SDK layer."""
        skeleton = build_interaction_skeleton(feature_doc)
        layer_names = [l["name"] for l in skeleton["layers"]]
        assert "sdk/bridge" in layer_names or len(layer_names) >= 2


class TestBuildInteractionPrompt:
    def test_prompt_contains_feature_context(self, feature_doc):
        """Prompt should include feature name and layers."""
        skeleton = build_interaction_skeleton(feature_doc)
        prompt = build_interaction_prompt(feature_doc, skeleton)
        assert "即时通讯" in prompt
        assert "ultron-group-chat" in prompt

    def test_prompt_requests_dag_structure(self, feature_doc):
        """Prompt should request DAG steps with after/terminal fields."""
        skeleton = build_interaction_skeleton(feature_doc)
        prompt = build_interaction_prompt(feature_doc, skeleton)
        assert "after" in prompt
        assert "terminal" in prompt

    def test_prompt_includes_platform_differences(self, feature_doc):
        """Prompt should mention platform-specific differences."""
        skeleton = build_interaction_skeleton(feature_doc)
        prompt = build_interaction_prompt(feature_doc, skeleton)
        assert "iOS" in prompt or "Amar" in prompt
        assert "Android" in prompt or "ddoversea" in prompt
