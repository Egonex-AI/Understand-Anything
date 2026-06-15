#!/usr/bin/env python3
"""Enrich business-features.json with wikiRef and flowCount for drill-down.

Resolves wiki domain file paths for server domains and client platforms,
enabling single-click navigation from business features to detailed wiki pages.

Usage:
    python3 enrich_wiki_refs.py <project-root>
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from cross_reference import domains_match


def _to_slug(name: str) -> str:
    """Convert domain name to ASCII kebab-case slug for filename matching."""
    slug = name.lower().strip()
    slug = re.sub(r"[（(].+?[)）]", "", slug).strip()
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"[^a-z0-9\-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        slug = "domain-" + hashlib.md5(name.encode()).hexdigest()[:8]
    return slug


def _relative_wiki_ref(project_root: Path, wiki_file: Path) -> str:
    return str(wiki_file.relative_to(project_root))


def _load_wiki_entries(wiki_dir: Path) -> list[dict]:
    entries: list[dict] = []
    if not wiki_dir.exists():
        return entries

    for wiki_file in wiki_dir.glob("*.json"):
        try:
            data = json.loads(wiki_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        entries.append(
            {
                "name": data.get("name", wiki_file.stem),
                "slug": wiki_file.stem,
                "path": wiki_file,
                "flowCount": len(data.get("flows", [])),
            }
        )
    return entries


def _find_wiki_match(domain_name: str, entries: list[dict]) -> dict | None:
    if not domain_name or not entries:
        return None

    for entry in entries:
        if entry["name"] == domain_name:
            return entry

    slug = _to_slug(domain_name)
    for entry in entries:
        if entry["slug"] == slug:
            return entry

    for entry in entries:
        if domains_match(domain_name, entry["name"]):
            return entry

    return None


def _load_facet_paths(project_root: Path) -> dict[str, str]:
    system_path = project_root / ".understand-anything" / "system.json"
    if not system_path.exists():
        return {}
    try:
        system = json.loads(system_path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    facet_paths: dict[str, str] = {}
    for facet in system.get("facets", []):
        for svc in facet.get("services", []):
            facet_paths[svc["name"]] = facet.get("path", "")
    return facet_paths


def _resolve_server_domain(
    domain: dict,
    project_root: Path,
    cache: dict[str, list[dict]],
    facet_paths: dict[str, str],
) -> bool:
    service = domain.get("service", "")
    if not service:
        domain["wikiRef"] = None
        return False

    if service not in cache:
        facet_path = facet_paths.get(service, "backend")
        wiki_dir = (
            project_root
            / facet_path
            / service
            / ".understand-anything"
            / "wiki"
            / "domains"
        )
        cache[service] = _load_wiki_entries(wiki_dir)

    match = _find_wiki_match(domain.get("name", ""), cache[service])
    if match:
        domain["wikiRef"] = _relative_wiki_ref(project_root, match["path"])
        domain["flowCount"] = match["flowCount"]
        return True

    domain["wikiRef"] = None
    domain.pop("flowCount", None)
    return False


def _resolve_client_platform(
    platform: dict,
    platform_name: str,
    project_root: Path,
    cache: dict[str, list[dict]],
    facet_paths: dict[str, str],
) -> bool:
    facet_path = facet_paths.get(platform_name, "mobile")
    if platform_name not in cache:
        wiki_dir = (
            project_root
            / facet_path
            / platform_name
            / ".understand-anything"
            / "wiki"
            / "domains"
        )
        cache[platform_name] = _load_wiki_entries(wiki_dir)

    entries = cache[platform_name]
    domain_id = platform.get("domainId", "")
    if domain_id:
        for entry in entries:
            if entry["slug"] == domain_id:
                platform["wikiRef"] = _relative_wiki_ref(project_root, entry["path"])
                platform["flowCount"] = entry["flowCount"]
                return True

        candidate = (
            project_root
            / facet_path
            / platform_name
            / ".understand-anything"
            / "wiki"
            / "domains"
            / f"{domain_id}.json"
        )
        if candidate.exists():
            try:
                data = json.loads(candidate.read_text())
                platform["wikiRef"] = _relative_wiki_ref(project_root, candidate)
                platform["flowCount"] = len(data.get("flows", []))
                return True
            except (json.JSONDecodeError, OSError):
                pass

    match = _find_wiki_match(platform.get("domainName", ""), entries)
    if match:
        platform["wikiRef"] = _relative_wiki_ref(project_root, match["path"])
        platform["flowCount"] = match["flowCount"]
        return True

    platform["wikiRef"] = None
    platform.pop("flowCount", None)
    return False


def enrich_wiki_refs(project_root_str: str) -> dict:
    """
    Reads business-features.json, resolves wikiRef paths for all domains,
    writes enriched version back.

    For server domains: looks up backend/<service>/.understand-anything/wiki/domains/*.json
    For client platforms: looks up mobile/<platform>/.understand-anything/wiki/domains/*.json

    Matching strategy:
    1. Exact name match (domain.name == wiki_file.name)
    2. Slug-based match (domain name → kebab-case slug → find file)
    3. Fuzzy match (substring)

    Returns: {"enriched": N, "notFound": M, "total": T}
    """
    project_root = Path(project_root_str)
    features_path = (
        project_root / ".understand-anything" / "business-landscape" / "business-features.json"
    )
    if not features_path.exists():
        return {"error": "business-features.json not found", "enriched": 0, "notFound": 0, "total": 0}
    features_data = json.loads(features_path.read_text())
    features = features_data.get("features", [])

    facet_paths = _load_facet_paths(project_root)
    server_cache: dict[str, list[dict]] = {}
    client_cache: dict[str, list[dict]] = {}
    enriched = 0
    not_found = 0
    total = 0

    for feature in features:
        server_layer = feature.get("serverLayer") or {}
        primary = server_layer.get("primaryDomain")
        if primary:
            total += 1
            if _resolve_server_domain(primary, project_root, server_cache, facet_paths):
                enriched += 1
            else:
                not_found += 1

        for supporting in server_layer.get("supportingDomains") or []:
            total += 1
            if _resolve_server_domain(supporting, project_root, server_cache, facet_paths):
                enriched += 1
            else:
                not_found += 1

        client_layer = feature.get("clientLayer") or {}
        for platform_name, platform in (client_layer.get("platforms") or {}).items():
            total += 1
            if _resolve_client_platform(platform, platform_name, project_root, client_cache, facet_paths):
                enriched += 1
            else:
                not_found += 1

    features_path.write_text(
        json.dumps(features_data, indent=2, ensure_ascii=False) + "\n"
    )

    return {"enriched": enriched, "notFound": not_found, "total": total}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 enrich_wiki_refs.py <project-root>", file=sys.stderr)
        sys.exit(1)
    result = enrich_wiki_refs(sys.argv[1])
    print(
        "Wiki ref enrichment complete: "
        f"{result['enriched']}/{result['total']} enriched, "
        f"{result['notFound']} not found"
    )
