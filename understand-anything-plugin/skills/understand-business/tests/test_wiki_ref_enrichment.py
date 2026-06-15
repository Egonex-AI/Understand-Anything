import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from enrich_wiki_refs import enrich_wiki_refs


@pytest.fixture
def wiki_ref_project(tmp_path):
    """Minimal project fixture for wikiRef enrichment tests."""
    # Server wiki: PK 对战 in ultron-room
    server_wiki = (
        tmp_path
        / "backend"
        / "ultron-room"
        / ".understand-anything"
        / "wiki"
        / "domains"
    )
    server_wiki.mkdir(parents=True)
    (server_wiki / "pk-battle.json").write_text(
        json.dumps(
            {
                "id": "domain:pk-battle",
                "name": "PK 对战",
                "flows": [{"id": f"flow:{i}"} for i in range(5)],
            },
            ensure_ascii=False,
        )
    )

    # Client wiki: live-streaming in Amar
    client_wiki = (
        tmp_path
        / "mobile"
        / "Amar"
        / ".understand-anything"
        / "wiki"
        / "domains"
    )
    client_wiki.mkdir(parents=True)
    (client_wiki / "live-streaming.json").write_text(
        json.dumps(
            {
                "id": "domain:live-streaming",
                "name": "视频直播",
                "flows": [{"id": f"flow:{i}"} for i in range(5)],
            },
            ensure_ascii=False,
        )
    )

    landscape = tmp_path / ".understand-anything" / "business-landscape"
    landscape.mkdir(parents=True)
    features_data = {
        "features": [
            {
                "id": "feature:pk-battle",
                "name": "PK 对战",
                "clientLayer": {
                    "platforms": {
                        "Amar": {
                            "domainName": "视频直播",
                            "domainId": "live-streaming",
                            "summary": "直播域",
                        }
                    }
                },
                "serverLayer": {
                    "primaryDomain": {
                        "name": "PK 对战",
                        "service": "ultron-room",
                        "confidence": 0.85,
                    },
                    "supportingDomains": [
                        {
                            "name": "不存在的域",
                            "service": "ultron-room",
                            "relationship": "calls",
                            "confidence": 0.7,
                        }
                    ],
                },
            },
            {
                "id": "feature:client-only",
                "name": "纯客户端",
                "clientLayer": {
                    "platforms": {
                        "Amar": {
                            "domainName": "未知域",
                            "domainId": "nonexistent-domain",
                            "summary": "无 wiki",
                        }
                    }
                },
            },
        ],
        "stats": {"totalFeatures": 2},
    }
    (landscape / "business-features.json").write_text(
        json.dumps(features_data, ensure_ascii=False, indent=2)
    )
    return tmp_path


def test_server_domain_exact_wiki_match(wiki_ref_project):
    enrich_wiki_refs(str(wiki_ref_project))

    features = json.loads(
        (
            wiki_ref_project
            / ".understand-anything"
            / "business-landscape"
            / "business-features.json"
        ).read_text()
    )["features"]
    pk_feature = next(f for f in features if f["id"] == "feature:pk-battle")
    primary = pk_feature["serverLayer"]["primaryDomain"]

    assert primary["wikiRef"] == (
        "backend/ultron-room/.understand-anything/wiki/domains/pk-battle.json"
    )
    assert primary["flowCount"] == 5


def test_server_domain_no_wiki_file(wiki_ref_project):
    enrich_wiki_refs(str(wiki_ref_project))

    features = json.loads(
        (
            wiki_ref_project
            / ".understand-anything"
            / "business-landscape"
            / "business-features.json"
        ).read_text()
    )["features"]
    pk_feature = next(f for f in features if f["id"] == "feature:pk-battle")
    supporting = pk_feature["serverLayer"]["supportingDomains"][0]

    assert supporting.get("wikiRef") is None
    assert "flowCount" not in supporting


def test_client_platform_wiki_ref(wiki_ref_project):
    enrich_wiki_refs(str(wiki_ref_project))

    features = json.loads(
        (
            wiki_ref_project
            / ".understand-anything"
            / "business-landscape"
            / "business-features.json"
        ).read_text()
    )["features"]
    pk_feature = next(f for f in features if f["id"] == "feature:pk-battle")
    amar = pk_feature["clientLayer"]["platforms"]["Amar"]

    assert amar["wikiRef"] == (
        "mobile/Amar/.understand-anything/wiki/domains/live-streaming.json"
    )
    assert amar["flowCount"] == 5


def test_flow_count_matches_wiki_file(wiki_ref_project):
    result = enrich_wiki_refs(str(wiki_ref_project))

    features = json.loads(
        (
            wiki_ref_project
            / ".understand-anything"
            / "business-landscape"
            / "business-features.json"
        ).read_text()
    )["features"]
    pk_feature = next(f for f in features if f["id"] == "feature:pk-battle")

    assert pk_feature["serverLayer"]["primaryDomain"]["flowCount"] == 5
    assert pk_feature["clientLayer"]["platforms"]["Amar"]["flowCount"] == 5
    assert result["enriched"] >= 2


def test_multiple_features_enriched(wiki_ref_project):
    result = enrich_wiki_refs(str(wiki_ref_project))

    features = json.loads(
        (
            wiki_ref_project
            / ".understand-anything"
            / "business-landscape"
            / "business-features.json"
        ).read_text()
    )["features"]
    client_only = next(f for f in features if f["id"] == "feature:client-only")
    amar = client_only["clientLayer"]["platforms"]["Amar"]

    assert amar.get("wikiRef") is None
    assert result["total"] == 4
    assert result["enriched"] == 2
    assert result["notFound"] == 2
