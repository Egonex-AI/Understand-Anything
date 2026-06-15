import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from cross_reference import (
    domains_match,
    find_matching_domains,
    run_cross_reference,
)


@pytest.fixture
def landscape_project(tmp_path):
    """Minimal business-landscape fixture for cross-reference tests."""
    landscape = tmp_path / ".understand-anything" / "business-landscape"
    domains_dir = landscape / "domains"
    domains_dir.mkdir(parents=True)

    (domains_dir / "domain-user-profile.json").write_text(
        json.dumps(
            {
                "id": "domain:user-profile",
                "name": "用户资料",
                "interactions": [{"id": "flow:1", "name": "查询资料"}],
            },
            ensure_ascii=False,
        )
    )
    (domains_dir / "domain-vip.json").write_text(
        json.dumps(
            {"id": "domain:vip", "name": "VIP会员", "interactions": []},
            ensure_ascii=False,
        )
    )

    domains_data = {
        "domains": [
            {
                "id": "domain:用户资料",
                "name": "用户资料",
                "slug": "user-profile",
                "detailRef": "business-landscape/domains/domain-user-profile.json",
            },
            {
                "id": "domain:VIP会员",
                "name": "VIP会员",
                "slug": "vip",
                "detailRef": "business-landscape/domains/domain-vip.json",
            },
            {
                "id": "domain:支付",
                "name": "支付账户",
                "slug": "payment",
                "detailRef": "business-landscape/domains/domain-payment.json",
            },
        ]
    }
    (landscape / "domains.json").write_text(
        json.dumps(domains_data, ensure_ascii=False, indent=2)
    )

    features_data = {
        "features": [
            {
                "id": "feature:个人中心",
                "name": "个人中心",
                "serverLayer": {
                    "primaryDomain": {
                        "name": "用户资料与账户",
                        "service": "ultron-user",
                    },
                    "supportingDomains": [
                        {"name": "VIP会员", "service": "ultron-basic-user"},
                    ],
                },
            },
            {
                "id": "feature:客户端专用",
                "name": "客户端专用",
                "clientLayer": {"implType": "native-specific"},
            },
        ]
    }
    (landscape / "business-features.json").write_text(
        json.dumps(features_data, ensure_ascii=False, indent=2)
    )
    return tmp_path


def test_exact_name_match():
    domains = [{"id": "d1", "name": "用户资料"}]
    assert domains_match("用户资料", "用户资料")
    assert find_matching_domains("用户资料", domains) == domains


def test_fuzzy_substring_match():
    domains = [
        {"id": "d1", "name": "用户资料"},
        {"id": "d2", "name": "VIP会员"},
    ]
    matches = find_matching_domains("用户资料与账户", domains)
    assert len(matches) == 1
    assert matches[0]["name"] == "用户资料"


def test_features_without_server_domains_have_empty_links(landscape_project):
    stats = run_cross_reference(str(landscape_project))

    features = json.loads(
        (landscape_project / ".understand-anything/business-landscape/business-features.json").read_text()
    )["features"]
    client_only = next(f for f in features if f["id"] == "feature:客户端专用")
    assert client_only["relatedDomainDocs"] == []
    assert stats["featuresLinked"] == 1


def test_bidirectional_link_integrity(landscape_project):
    run_cross_reference(str(landscape_project))

    landscape = landscape_project / ".understand-anything/business-landscape"
    domains = json.loads((landscape / "domains.json").read_text())["domains"]
    features = json.loads((landscape / "business-features.json").read_text())["features"]
    feature = next(f for f in features if f["id"] == "feature:个人中心")

    profile_domain = next(d for d in domains if d["name"] == "用户资料")
    vip_domain = next(d for d in domains if d["name"] == "VIP会员")

    profile_link = next(
        rf for rf in profile_domain["relatedFeatures"] if rf["featureId"] == feature["id"]
    )
    assert profile_link["relationship"] == "primary"

    vip_link = next(
        rf for rf in vip_domain["relatedFeatures"] if rf["featureId"] == feature["id"]
    )
    assert vip_link["relationship"] == "supporting"

    linked_ids = {doc["domainId"] for doc in feature["relatedDomainDocs"]}
    assert profile_domain["id"] in linked_ids
    assert vip_domain["id"] in linked_ids

    profile_doc = next(
        doc for doc in feature["relatedDomainDocs"] if doc["domainId"] == profile_domain["id"]
    )
    assert profile_doc["domainSlug"] == "user-profile"
    assert profile_doc["hasInteractions"] is True

    vip_doc = next(
        doc for doc in feature["relatedDomainDocs"] if doc["domainId"] == vip_domain["id"]
    )
    assert vip_doc["hasInteractions"] is False
