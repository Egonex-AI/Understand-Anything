#!/usr/bin/env python3
"""Cross-reference business features with domain index metadata.

Links feature serverLayer domains to entries in domains.json and writes
bidirectional relatedFeatures / relatedDomainDocs fields.

Usage:
    python3 cross_reference.py <project-root>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def _normalize_name(name: str) -> str:
    return name.lower().replace("-", "_").replace(" ", "_")


def _strip_suffix(name: str) -> str:
    return re.sub(r"[（(].+?[)）]", "", name).strip()


def domains_match(query_name: str, domain_name: str) -> bool:
    """Return True when query_name matches domain_name exactly or fuzzily."""
    q_clean = _strip_suffix(query_name)
    d_clean = _strip_suffix(domain_name)

    if _normalize_name(q_clean) == _normalize_name(d_clean):
        return True

    if len(q_clean) >= 2 and len(d_clean) >= 2:
        if q_clean in d_clean or d_clean in q_clean:
            return True

    return False


def find_matching_domains(query_name: str, domains: list[dict]) -> list[dict]:
    """Find all domain entries whose name matches query_name."""
    return [domain for domain in domains if domains_match(query_name, domain.get("name", ""))]


def _domain_has_interactions(project_root: Path, domain: dict) -> bool:
    detail_ref = domain.get("detailRef", "")
    if detail_ref:
        detail_path = project_root / ".understand-anything" / detail_ref
        if detail_path.exists():
            try:
                data = json.loads(detail_path.read_text())
                return bool(data.get("interactions"))
            except (json.JSONDecodeError, OSError):
                pass
    return bool(domain.get("interactions"))


def run_cross_reference(project_root_str: str) -> dict:
    project_root = Path(project_root_str)
    landscape_dir = project_root / ".understand-anything" / "business-landscape"
    domains_path = landscape_dir / "domains.json"
    features_path = landscape_dir / "business-features.json"

    if not domains_path.exists():
        return {"error": "domains.json not found", "domainsLinked": 0, "featuresLinked": 0, "totalLinks": 0}
    if not features_path.exists():
        return {"error": "business-features.json not found", "domainsLinked": 0, "featuresLinked": 0, "totalLinks": 0}

    domains_data = json.loads(domains_path.read_text())
    features_data = json.loads(features_path.read_text())
    domains = domains_data.get("domains", [])
    features = features_data.get("features", [])

    for domain in domains:
        domain["relatedFeatures"] = []
    for feature in features:
        feature["relatedDomainDocs"] = []

    total_links = 0
    linked_domain_ids: set[str] = set()
    linked_feature_ids: set[str] = set()

    for feature in features:
        feature_id = feature.get("id", "")
        feature_name = feature.get("name", "")
        server_layer = feature.get("serverLayer") or {}

        domain_queries: list[tuple[str, str]] = []
        primary = server_layer.get("primaryDomain")
        if primary and primary.get("name"):
            domain_queries.append((primary["name"], "primary"))

        for supporting in server_layer.get("supportingDomains") or []:
            if supporting.get("name"):
                domain_queries.append((supporting["name"], "supporting"))

        seen_domain_ids: set[str] = set()
        for query_name, relationship in domain_queries:
            for matched_domain in find_matching_domains(query_name, domains):
                domain_id = matched_domain.get("id", "")
                if not domain_id or domain_id in seen_domain_ids:
                    continue
                seen_domain_ids.add(domain_id)

                matched_domain.setdefault("relatedFeatures", []).append(
                    {
                        "featureId": feature_id,
                        "featureName": feature_name,
                        "relationship": relationship,
                    }
                )
                feature.setdefault("relatedDomainDocs", []).append(
                    {
                        "domainId": domain_id,
                        "domainSlug": matched_domain.get("slug", ""),
                        "hasInteractions": _domain_has_interactions(project_root, matched_domain),
                    }
                )

                total_links += 1
                linked_domain_ids.add(domain_id)
                linked_feature_ids.add(feature_id)

    domains_path.write_text(json.dumps(domains_data, indent=2, ensure_ascii=False) + "\n")
    features_path.write_text(json.dumps(features_data, indent=2, ensure_ascii=False) + "\n")

    return {
        "domainsLinked": len(linked_domain_ids),
        "featuresLinked": len(linked_feature_ids),
        "totalLinks": total_links,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 cross_reference.py <project-root>", file=sys.stderr)
        sys.exit(1)
    stats = run_cross_reference(sys.argv[1])
    print(
        "Cross-reference complete: "
        f"{stats['domainsLinked']} domains, "
        f"{stats['featuresLinked']} features, "
        f"{stats['totalLinks']} links"
    )
