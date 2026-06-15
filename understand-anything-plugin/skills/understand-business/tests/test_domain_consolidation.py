import pytest
import json
import tempfile
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from domain_matcher import _consolidate_mobile_domains


@pytest.fixture
def mobile_project(tmp_path):
    """Create a minimal mobile project structure for testing."""
    # Create architecture.json with featureParity and nativeBridge
    wiki_dir = tmp_path / "mobile" / ".understand-anything" / "wiki"
    wiki_dir.mkdir(parents=True)

    arch = {
        "featureParity": [
            {"feature": "即时通讯", "platforms": {
                "ios": {"service": "Amar", "domain": "instant-messaging", "impl": "PhotonIM"},
                "android": {"service": "ddoversea", "domain": "im-chat", "impl": "PhotonIM MVVM"},
                "flutter": {"service": "ddoversea_flutter", "domain": "group-chat", "impl": "MethodChannel"}
            }},
            {"feature": "家族运营", "platforms": {
                "flutter": {"service": "ddoversea_flutter", "domain": "family", "impl": "FlutterBoost"}
            }, "note": "Flutter独有"}
        ],
        "nativeBridge": [
            {"type": "flutter_channel", "from": "ddoversea_flutter", "to": "ddoversea", "mechanism": "FlutterBoost", "detail": "..."},
            {"type": "flutter_engine", "from": "Amar", "to": "ddoversea_flutter", "mechanism": "FlutterManager", "detail": "..."}
        ],
        "domainMapping": [
            {"canonicalFeature": "即时通讯", "mappings": {"Amar": "domain:instant-messaging", "ddoversea": "domain:im-chat", "ddoversea_flutter": "domain:group-chat"}}
        ]
    }
    (wiki_dir / "architecture.json").write_text(json.dumps(arch, ensure_ascii=False))

    # Create client-graph.json
    cg_dir = tmp_path / "mobile" / ".understand-anything"
    cg = {
        "domainLinks": [
            {"canonicalFeature": "即时通讯", "mappings": {"Amar": "domain:instant-messaging", "ddoversea": "domain:im-chat", "ddoversea_flutter": "domain:group-chat"}}
        ]
    }
    (cg_dir / "client-graph.json").write_text(json.dumps(cg, ensure_ascii=False))

    # Create per-platform domain files
    for platform, domains in {
        "Amar": [
            ("domain:instant-messaging.json", {"name": "即时通讯", "id": "domain:instant-messaging", "summary": "iOS端IM"}),
            ("domain:apple-payment.json", {"name": "苹果支付", "id": "domain:apple-payment", "summary": "StoreKit IAP"}),
            ("domain:network.json", {"name": "网络层", "id": "domain:network", "summary": "AFNetworking封装"}),
        ],
        "ddoversea": [
            ("domain:im-chat.json", {"name": "即时通讯与私信", "id": "domain:im-chat", "summary": "Android端IM"}),
            ("domain:room-mini-game.json", {"name": "房间小游戏", "id": "domain:room-mini-game", "summary": "Sud SDK"}),
        ],
        "ddoversea_flutter": [
            ("domain:group-chat.json", {"name": "群聊社交", "id": "domain:group-chat", "summary": "Flutter IM bridge"}),
            ("domain:family.json", {"name": "家族运营", "id": "domain:family", "summary": "FlutterBoost家族模块"}),
        ]
    }.items():
        domain_dir = tmp_path / "mobile" / platform / ".understand-anything" / "wiki" / "domains"
        domain_dir.mkdir(parents=True)
        for filename, data in domains:
            (domain_dir / filename).write_text(json.dumps(data, ensure_ascii=False))

    return tmp_path


def test_consolidation_merges_cross_platform_domains(mobile_project):
    """domainLinks中的多平台域应合并为一个逻辑域"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    consolidated = result["consolidated"]
    names = [d["name"] for d in consolidated]
    assert "即时通讯" in names
    im_domain = next(d for d in consolidated if d["name"] == "即时通讯")
    assert set(im_domain["platforms"]) == {"Amar", "ddoversea", "ddoversea_flutter"}
    assert im_domain["implType"] == "cross-platform"
    assert len(im_domain["implementations"]) == 3


def test_flutter_only_domain_marked_with_delivery_platforms(mobile_project):
    """Flutter-only域应标记deliveryPlatforms包含通过bridge可达的平台"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    # 家族运营 is Flutter-only but accessible from both native via bridge
    all_domains = result["consolidated"] + result["standalone"]
    family = next((d for d in all_domains if d["name"] == "家族运营"), None)
    assert family is not None
    assert family["implType"] == "flutter-only"
    # deliveryPlatforms should include ios and android (reachable via bridges)
    assert "ios" in family["deliveryPlatforms"] or "Amar" in family["deliveryPlatforms"]
    assert "android" in family["deliveryPlatforms"] or "ddoversea" in family["deliveryPlatforms"]


def test_native_specific_domain_stays_standalone(mobile_project):
    """平台独有域(如苹果支付)应保持独立"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    standalone = result["standalone"]
    apple_pay = next((d for d in standalone if d["name"] == "苹果支付"), None)
    assert apple_pay is not None
    assert apple_pay["platform"] == "Amar"
    assert apple_pay["implType"] == "native-specific"


def test_infrastructure_domain_excluded(mobile_project):
    """基础设施域(网络层等)应被归类为infrastructure"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    infra = result["infrastructure"]
    network = next((d for d in infra if d["name"] == "网络层"), None)
    assert network is not None


def test_merged_summary_combines_all_platforms(mobile_project):
    """合并后的逻辑域应包含所有平台的summary"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    im = next(d for d in result["consolidated"] if d["name"] == "即时通讯")
    assert "iOS" in im["mergedSummary"] or "PhotonIM" in im["mergedSummary"]
    assert "Android" in im["mergedSummary"] or "MVVM" in im["mergedSummary"]
    assert "Flutter" in im["mergedSummary"] or "MethodChannel" in im["mergedSummary"]


def test_total_domain_count_reduced(mobile_project):
    """合并后的域总数应少于原始平台域总数"""
    result = _consolidate_mobile_domains(
        str(mobile_project), "mobile", ["Amar", "ddoversea", "ddoversea_flutter"]
    )
    # Original: 3+2+2=7 platform domains
    # After consolidation: 即时通讯(merged from 3), 家族运营(flutter-only),
    #   苹果支付(standalone), 房间小游戏(standalone), 网络层(infra)
    total = len(result["consolidated"]) + len(result["standalone"]) + len(result["infrastructure"])
    assert total < 7  # less than raw count (due to 3→1 merge for 即时通讯)
