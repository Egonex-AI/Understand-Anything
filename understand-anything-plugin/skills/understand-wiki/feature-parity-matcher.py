#!/usr/bin/env python3
"""
Feature Parity Matcher — cross-platform domain matching for mobile projects.

Replaces cross-service-matcher.py when REPO_TYPE=mobile. Analyzes feature parity
across iOS/Android/Flutter platform implementations instead of RPC/Event/DB edges.

Usage:
    python3 feature-parity-matcher.py <project-root> \\
        --services="Amar ddoversea ddoversea_flutter" \\
        --output="<project-root>/.understand-anything/tmp/cross-service-candidates.json"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Semantic families — deterministic keyword → family mapping
# ---------------------------------------------------------------------------

SEMANTIC_FAMILIES: dict[str, list[str]] = {
    "messaging": ["messaging", "message", "messages", "im", "chat", "instant"],
    "av_call": ["call", "meeting", "av", "video", "audio", "rtc", "voice"],
    "live_stream": ["live", "stream", "streaming", "room", "broadcast"],
    "payment": ["pay", "payment", "billing", "purchase", "wallet", "checkout"],
    "profile": ["profile", "account", "settings", "me", "user"],
    "social_feed": ["moment", "feed", "social", "post", "timeline", "story"],
    "virtual_goods": ["gift", "reward", "virtual", "coin", "diamond"],
    "auth": ["auth", "login", "register", "sign", "signup", "signin"],
}

KNOWN_SDKS: list[tuple[str, list[str]]] = [
    ("PhotonIM", ["photonim", "photon.im", "com.photon.im"]),
    ("Agora", ["agora", "agorartc", "agora_rtc", "agorartckit"]),
    ("Firebase", ["firebase"]),
    ("MMKV", ["mmkv"]),
    ("SDWebImage", ["sdwebimage"]),
    ("Glide", ["glide"]),
    ("Realm", ["realm"]),
    ("RxSwift", ["rxswift"]),
    ("RxJava", ["rxjava"]),
    ("Retrofit", ["retrofit"]),
    ("Alamofire", ["alamofire"]),
    ("OkHttp", ["okhttp"]),
    ("CocoaPods", ["cocoapods"]),
    ("Gradle", ["gradle"]),
]

BRIDGE_MECHANISMS: dict[str, list[str]] = {
    "FlutterBoost": ["flutterboost", "flutter_boost"],
    "MethodChannel": ["methodchannel", "method_channel"],
    "EventChannel": ["eventchannel", "event_channel"],
}

_STOP_TOKENS = frozenset({"the", "and", "for", "app", "module", "domain", "service"})

_LARGE_KG_NODE_THRESHOLD = 5000


# ---------------------------------------------------------------------------
# Platform discovery
# ---------------------------------------------------------------------------


def _load_system_config(project_root: str) -> dict | None:
    system_path = Path(project_root) / ".understand-anything" / "system.json"
    if not system_path.is_file():
        return None
    try:
        with open(system_path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _find_mobile_facet(system_config: dict) -> dict | None:
    for facet in system_config.get("facets", []):
        if facet.get("type") == "mobile":
            return facet
    return None


def _normalize_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _tokenize(value: str) -> set[str]:
    normalized = _normalize_identifier(value)
    tokens = {t for t in normalized.split("_") if t and t not in _STOP_TOKENS and len(t) >= 2}
    return tokens


def _domain_id(domain: dict) -> str:
    if domain.get("id"):
        return domain["id"]
    slug = domain.get("slug") or domain.get("name", "")
    return f"domain:{slug}" if slug else "domain:unknown"


def _read_service_name(platform_path: Path, platform_key: str) -> str:
    service_json = platform_path / ".understand-anything" / "wiki" / "service.json"
    if not service_json.is_file():
        return platform_key
    try:
        with open(service_json, encoding="utf-8") as f:
            return json.load(f).get("name", platform_key)
    except (json.JSONDecodeError, OSError):
        return platform_key


def _discover_platform_paths(
    project_root: str,
    service_filter: list[str] | None = None,
) -> dict[str, Path]:
    """Discover platform directories from system.json mobile facet.

    Returns mapping of platform key (subPath name, e.g. 'ios') → platform path.
    When *service_filter* is provided, only platforms whose wiki service.json
    ``name`` matches one of the filter values are included.
    """
    system_config = _load_system_config(project_root)
    if not system_config:
        return {}

    mobile_facet = _find_mobile_facet(system_config)
    if not mobile_facet:
        return {}

    facet_path = Path(project_root) / mobile_facet.get("path", "")
    if not facet_path.is_dir():
        return {}

    sub_paths = mobile_facet.get("subPaths", [])
    if not sub_paths:
        sub_paths = [
            d.name + "/"
            for d in facet_path.iterdir()
            if d.is_dir()
            and (d / ".understand-anything" / "wiki" / "meta.json").is_file()
        ]

    filter_set = {s.strip() for s in service_filter} if service_filter else None
    platforms: dict[str, Path] = {}

    for sp in sub_paths:
        platform_key = sp.rstrip("/")
        platform_path = facet_path / platform_key
        if not platform_path.is_dir():
            continue

        if filter_set:
            service_name = _read_service_name(platform_path, platform_key)
            if service_name not in filter_set and platform_key not in filter_set:
                continue

        platforms[platform_key] = platform_path

    return platforms


# ---------------------------------------------------------------------------
# Required API — domain loading & matching
# ---------------------------------------------------------------------------


def load_platform_domains(project_root: str) -> dict[str, list[dict]]:
    """Load domain lists from each platform's wiki/domains/ directory.

    Falls back to wiki/service.json 'domains' field if present.

    Returns:
        { "Amar": [{"id": "domain:instant-messaging", "slug": "instant-messaging", "name": "即时通讯"}, ...], ... }
    """
    result: dict[str, list[dict]] = {}
    platforms = _discover_platform_paths(project_root)

    for platform_key, platform_path in platforms.items():
        domains: list[dict] = []

        # Primary source: wiki/domains/*.json files
        domains_dir = platform_path / ".understand-anything" / "wiki" / "domains"
        if domains_dir.is_dir():
            for f in sorted(domains_dir.glob("*.json")):
                try:
                    with open(f, encoding="utf-8") as fh:
                        data = json.load(fh)
                except (json.JSONDecodeError, OSError):
                    continue
                slug = f.stem
                domain_id = data.get("id", f"domain:{slug}")
                name = data.get("name", slug)
                domains.append({
                    "id": domain_id,
                    "slug": slug,
                    "name": name,
                })
        else:
            # Fallback: service.json 'domains' field
            service_json = platform_path / ".understand-anything" / "wiki" / "service.json"
            if service_json.is_file():
                try:
                    with open(service_json, encoding="utf-8") as f:
                        data = json.load(f)
                    for entry in data.get("domains", []):
                        if isinstance(entry, dict):
                            slug = entry.get("slug") or entry.get("id", "").removeprefix("domain:")
                            name = entry.get("name") or slug
                            domains.append({"id": _domain_id(entry), "slug": slug, "name": name})
                        elif isinstance(entry, str):
                            domains.append({"id": f"domain:{entry}", "slug": entry, "name": entry})
                except (json.JSONDecodeError, OSError):
                    pass

        result[platform_key] = domains

    return result


def _semantic_families_for_domain(domain: dict) -> set[str]:
    text = " ".join(
        filter(
            None,
            [
                domain.get("slug", ""),
                domain.get("name", ""),
                domain.get("id", "").removeprefix("domain:"),
            ],
        )
    )
    tokens = _tokenize(text)
    families: set[str] = set()
    for family, keywords in SEMANTIC_FAMILIES.items():
        for kw in keywords:
            if kw in tokens or any(t.startswith(kw) or kw.startswith(t) for t in tokens):
                families.add(family)
    return families


def _pair_match_type(a: dict, b: dict) -> str | None:
    """Classify match between two domains. Returns None if no match."""
    slug_a = _normalize_identifier(a.get("slug", "") or a.get("name", ""))
    slug_b = _normalize_identifier(b.get("slug", "") or b.get("name", ""))
    name_a = _normalize_identifier(a.get("name", ""))
    name_b = _normalize_identifier(b.get("name", ""))

    if slug_a and slug_b and slug_a == slug_b:
        return "exact"
    if name_a and name_b and name_a == name_b:
        return "exact"

    tokens_a = _tokenize(a.get("slug", "")) | _tokenize(a.get("name", ""))
    tokens_b = _tokenize(b.get("slug", "")) | _tokenize(b.get("name", ""))
    if tokens_a and tokens_b:
        shared = tokens_a & tokens_b
        if shared:
            return "fuzzy"
        for ta in tokens_a:
            for tb in tokens_b:
                if ta.startswith(tb) or tb.startswith(ta):
                    return "fuzzy"

    families_a = _semantic_families_for_domain(a)
    families_b = _semantic_families_for_domain(b)
    if families_a & families_b:
        return "semantic"

    return None


_MATCH_PRIORITY = {"exact": 0, "fuzzy": 1, "semantic": 2}


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        if x not in self._parent:
            self._parent[x] = x
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[rb] = ra


def match_domains_across_platforms(platform_domains: dict[str, list[dict]]) -> list[dict]:
    """Match domains across platforms by name similarity.

    Returns list of matches. Each match includes:
    - canonicalName / canonicalFeature: display label
    - matchType: 'exact' | 'fuzzy' | 'semantic'
    - platforms: { platform: { slug, name, id } }
    - mappings: { platform: domain:id }  (CLI-compatible)
    - status / confidence for semantic candidates
    """
    platform_keys = [p for p in platform_domains if platform_domains[p]]
    if len(platform_keys) < 2:
        return []

    keyed_domains: list[tuple[str, dict]] = []
    for platform in platform_keys:
        for domain in platform_domains[platform]:
            key = f"{platform}::{domain.get('slug') or domain.get('id')}"
            keyed_domains.append((platform, domain))

    uf = _UnionFind()
    pair_types: dict[tuple[str, str], str] = {}

    for i, (plat_a, dom_a) in enumerate(keyed_domains):
        key_a = f"{plat_a}::{dom_a.get('slug') or dom_a.get('id')}"
        for plat_b, dom_b in keyed_domains[i + 1 :]:
            if plat_a == plat_b:
                continue
            match_type = _pair_match_type(dom_a, dom_b)
            if not match_type:
                continue
            key_b = f"{plat_b}::{dom_b.get('slug') or dom_b.get('id')}"
            uf.union(key_a, key_b)
            existing = pair_types.get((key_a, key_b)) or pair_types.get((key_b, key_a))
            if existing is None or _MATCH_PRIORITY[match_type] < _MATCH_PRIORITY[existing]:
                pair_types[(key_a, key_b)] = match_type

    groups: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for platform, domain in keyed_domains:
        key = f"{platform}::{domain.get('slug') or domain.get('id')}"
        groups[uf.find(key)].append((platform, domain))

    matches: list[dict] = []
    seen_platform_domain: set[tuple[str, str]] = set()

    for members in groups.values():
        platforms_in_group = {p for p, _ in members}
        if len(platforms_in_group) < 2:
            continue

        best_type = "semantic"
        group_pair_types: list[str] = []
        member_keys = [f"{p}::{d.get('slug') or d.get('id')}" for p, d in members]
        for i, ka in enumerate(member_keys):
            for kb in member_keys[i + 1 :]:
                mt = pair_types.get((ka, kb)) or pair_types.get((kb, ka))
                if mt:
                    group_pair_types.append(mt)

        if group_pair_types:
            best_type = min(group_pair_types, key=lambda t: _MATCH_PRIORITY[t])

        platform_map: dict[str, dict] = {}
        for platform, domain in members:
            slug = domain.get("slug") or domain.get("id", "").removeprefix("domain:")
            dedupe_key = (platform, slug)
            if dedupe_key in seen_platform_domain:
                continue
            seen_platform_domain.add(dedupe_key)
            if platform not in platform_map:
                platform_map[platform] = {
                    "slug": slug,
                    "name": domain.get("name", slug),
                    "id": _domain_id(domain),
                }

        if len(platform_map) < 2:
            continue

        names = [info["name"] for info in platform_map.values() if info.get("name")]
        canonical = max(names, key=len) if names else next(iter(platform_map.values()))["slug"]

        mappings = {plat: info["id"] for plat, info in platform_map.items()}

        entry: dict[str, Any] = {
            "canonicalName": canonical,
            "canonicalFeature": canonical,
            "matchType": best_type,
            "platforms": platform_map,
            "mappings": mappings,
        }
        if best_type == "semantic":
            entry["status"] = "candidate"
            entry["confidence"] = 0.75

        matches.append(entry)

    matches.sort(key=lambda m: (_MATCH_PRIORITY[m["matchType"]], m["canonicalName"]))
    return matches


# ---------------------------------------------------------------------------
# Required API — knowledge graphs, SDKs, bridges
# ---------------------------------------------------------------------------


def _load_kg_light(platform_path: Path) -> dict:
    kg_path = platform_path / ".understand-anything" / "knowledge-graph.json"
    if not kg_path.is_file():
        return {"nodes": [], "edges": []}
    try:
        with open(kg_path, encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"nodes": [], "edges": []}

    nodes_raw = raw.get("nodes", [])
    edges_raw = raw.get("edges", [])

    if len(nodes_raw) > _LARGE_KG_NODE_THRESHOLD:
        node_types = sorted({n.get("type", "unknown") for n in nodes_raw if isinstance(n, dict)})
        edge_types = sorted({e.get("type", "unknown") for e in edges_raw if isinstance(e, dict)})
        return {
            "project": raw.get("project"),
            "nodeTypes": node_types,
            "edgeTypes": edge_types,
            "nodeCount": len(nodes_raw),
            "edgeCount": len(edges_raw),
            "nodes": [],
            "edges": [],
        }

    nodes: list[dict] = []
    for node in nodes_raw:
        if not isinstance(node, dict):
            continue
        nodes.append({
            "id": node.get("id", ""),
            "name": node.get("name", ""),
            "type": node.get("type", ""),
            "filePath": node.get("filePath", ""),
            "imports": node.get("imports", []),
            "summary": node.get("summary", ""),
        })

    edges: list[dict] = []
    for edge in edges_raw:
        if not isinstance(edge, dict):
            continue
        edges.append({
            "source": edge.get("source", ""),
            "target": edge.get("target", ""),
            "type": edge.get("type", ""),
        })

    return {"project": raw.get("project"), "nodes": nodes, "edges": edges}


def load_platform_knowledge_graphs(project_root: str) -> dict[str, dict]:
    """Load KG from each platform (lightweight node/edge summary for large graphs)."""
    result: dict[str, dict] = {}
    for platform_key, platform_path in _discover_platform_paths(project_root).items():
        result[platform_key] = _load_kg_light(platform_path)
    return result


def _node_text_blob(node: dict) -> str:
    parts = [
        node.get("name", ""),
        node.get("id", ""),
        node.get("type", ""),
        node.get("filePath", ""),
        node.get("summary", ""),
    ]
    imports = node.get("imports", [])
    if isinstance(imports, list):
        parts.extend(str(i) for i in imports)
    return " ".join(parts).lower()


def _match_known_sdk(text: str) -> str | None:
    normalized = text.lower().replace("-", "").replace("_", "").replace(".", "")
    for sdk_name, patterns in KNOWN_SDKS:
        for pattern in patterns:
            pat = pattern.replace(".", "").replace("_", "")
            if pat in normalized:
                return sdk_name
    return None


def detect_shared_sdks(platform_kgs: dict[str, dict]) -> list[dict]:
    """Detect SDKs referenced on multiple platforms."""
    sdk_platforms: dict[str, set[str]] = defaultdict(set)
    sdk_details: dict[str, list[str]] = defaultdict(list)

    for platform, kg in platform_kgs.items():
        nodes = kg.get("nodes", [])
        if not nodes and kg.get("nodeCount", 0) > _LARGE_KG_NODE_THRESHOLD:
            continue
        for node in nodes:
            blob = _node_text_blob(node)
            sdk = _match_known_sdk(blob)
            if not sdk:
                continue
            sdk_platforms[sdk].add(platform)
            ref = node.get("name") or node.get("id", "")
            if ref:
                detail_line = f"{platform}: {ref}"
                if detail_line not in sdk_details[sdk]:
                    sdk_details[sdk].append(detail_line)

    results: list[dict] = []
    for sdk in sorted(sdk_platforms):
        platforms = sorted(sdk_platforms[sdk])
        if len(platforms) < 2:
            continue
        results.append({
            "sdk": sdk,
            "platforms": platforms,
            "detail": "; ".join(sdk_details[sdk][:5]) or f"Used on {', '.join(platforms)}",
        })
    return results


def _collect_bridge_signals(kg: dict) -> dict[str, set[str]]:
    """Return mechanism → set of channel/reference names found in KG."""
    signals: dict[str, set[str]] = defaultdict(set)

    def _scan_text(text: str, source: str) -> None:
        lower = text.lower().replace("-", "").replace("_", "")
        for mechanism, patterns in BRIDGE_MECHANISMS.items():
            for pat in patterns:
                if pat.replace("_", "") in lower:
                    signals[mechanism].add(source)

    for node in kg.get("nodes", []):
        name = node.get("name", "") or node.get("id", "").split(":")[-1]
        blob = _node_text_blob(node)
        _scan_text(blob, name)

    for edge in kg.get("edges", []):
        edge_type = edge.get("type", "")
        _scan_text(edge_type, edge_type)
        _scan_text(edge.get("source", ""), edge.get("source", "").split(":")[-1])
        _scan_text(edge.get("target", ""), edge.get("target", "").split(":")[-1])

    return signals


def detect_bridge_channels(platform_kgs: dict[str, dict]) -> list[dict]:
    """Detect Flutter<->Native bridge channels across platforms."""
    platform_signals: dict[str, dict[str, set[str]]] = {}
    for platform, kg in platform_kgs.items():
        signals = _collect_bridge_signals(kg)
        if signals:
            platform_signals[platform] = signals

    if not platform_signals:
        return []

    all_mechanisms: set[str] = set()
    for signals in platform_signals.values():
        all_mechanisms.update(signals)

    native_platforms = sorted(platform_signals)
    flutter_platforms = [p for p in native_platforms if "flutter" in p.lower()]
    if not flutter_platforms:
        flutter_platforms = [p for p in native_platforms if p not in flutter_platforms]

    bridges: list[dict] = []
    seen: set[str] = set()

    def _mechanism_label(mechanisms: set[str]) -> str:
        ordered = []
        for key in ("FlutterBoost", "MethodChannel", "EventChannel"):
            if key in mechanisms:
                ordered.append(key)
        return " + ".join(ordered) if ordered else "Flutter Bridge"

    for from_plat in native_platforms:
        from_signals = platform_signals[from_plat]
        from_mechs = set(from_signals)
        channels: list[str] = []
        for mech, refs in from_signals.items():
            for ref in refs:
                if mech == "MethodChannel" and ref.lower() != "methodchannel":
                    channels.append(ref)
                elif mech == "EventChannel" and ref.lower() != "eventchannel":
                    channels.append(ref)
                elif mech == "FlutterBoost" and "flutter" not in ref.lower():
                    channels.append(ref)

        to_candidates = flutter_platforms or [
            p for p in native_platforms if p != from_plat
        ]
        for to_plat in to_candidates:
            if to_plat == from_plat:
                continue
            to_signals = platform_signals.get(to_plat, {})
            to_mechs = set(to_signals)
            combined = from_mechs | to_mechs
            if not combined:
                continue

            mechanism = _mechanism_label(combined)
            dedupe = f"{from_plat}->{to_plat}:{mechanism}"
            if dedupe in seen:
                continue
            seen.add(dedupe)

            entry: dict[str, Any] = {
                "type": "flutter_channel",
                "name": mechanism.split(" + ")[0],
                "from": from_plat,
                "to": to_plat,
                "mechanism": mechanism,
            }
            if channels:
                entry["channels"] = sorted(set(channels))
            bridges.append(entry)

    if not bridges and platform_signals:
        for platform, signals in platform_signals.items():
            mechanism = _mechanism_label(set(signals))
            bridges.append({
                "type": "flutter_channel",
                "name": mechanism.split(" + ")[0],
                "from": platform,
                "to": platform,
                "mechanism": mechanism,
                "channels": sorted({
                    ref
                    for refs in signals.values()
                    for ref in refs
                    if ref.lower() not in ("methodchannel", "eventchannel", "flutterboost")
                }) or None,
            })
        bridges = [b for b in bridges if b.get("channels") is not None or b["mechanism"]]

    return [b for b in bridges if b.get("channels") is not None or "Flutter" in b.get("mechanism", "")]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _to_domain_mappings(matches: list[dict]) -> list[dict]:
    return [
        {
            "canonicalFeature": m.get("canonicalFeature") or m.get("canonicalName", ""),
            "matchType": m["matchType"],
            "mappings": m.get("mappings") or {
                plat: info.get("id", f"domain:{info.get('slug', '')}")
                for plat, info in m.get("platforms", {}).items()
            },
        }
        for m in matches
    ]


def _collect_domain_summaries(project_root: str, platforms: dict[str, Path]) -> dict[str, list[dict]]:
    """Collect domain summaries from wiki/domains/*.json for LLM consumption.

    Returns: { "Amar": [{"id": "domain:instant-messaging", "name": "即时通讯", "summary": "..."}], ... }
    """
    result: dict[str, list[dict]] = {}
    for platform_key, platform_path in platforms.items():
        domains_dir = platform_path / ".understand-anything" / "wiki" / "domains"
        entries: list[dict] = []
        if domains_dir.is_dir():
            for f in sorted(domains_dir.glob("*.json")):
                try:
                    with open(f, encoding="utf-8") as fh:
                        data = json.load(fh)
                except (json.JSONDecodeError, OSError):
                    continue
                entries.append({
                    "id": data.get("id", f"domain:{f.stem}"),
                    "slug": f.stem,
                    "name": data.get("name", f.stem),
                    "summary": data.get("summary", ""),
                })
        result[platform_key] = entries
    return result


def run_matcher(
    project_root: str,
    service_names: list[str] | None = None,
) -> dict[str, Any]:
    """Run full mobile feature-parity analysis and return result dict.

    The script produces:
    - confirmedMappings: only exact slug matches (high confidence)
    - candidateMappings: fuzzy/semantic matches for LLM to verify
    - domainSummaries: per-platform domain summaries for LLM context
    - sharedSdks / bridgeChannels: deterministic infrastructure detection
    """
    if service_names:
        platforms = _discover_platform_paths(project_root, service_filter=service_names)
        all_domains = load_platform_domains(project_root)
        platform_domains = {k: v for k, v in all_domains.items() if k in platforms}
        all_kgs = load_platform_knowledge_graphs(project_root)
        platform_kgs = {k: v for k, v in all_kgs.items() if k in platforms}
        resolved = [
            _read_service_name(platforms[k], k) for k in platforms
        ]
        services_analyzed = resolved or service_names
    else:
        platforms = _discover_platform_paths(project_root)
        platform_domains = load_platform_domains(project_root)
        platform_kgs = load_platform_knowledge_graphs(project_root)
        services_analyzed = [
            _read_service_name(
                platforms.get(k, Path(project_root) / k),
                k,
            )
            for k in platform_domains
        ]

    domain_matches = match_domains_across_platforms(platform_domains)
    shared_sdks = detect_shared_sdks(platform_kgs)
    bridge_channels = detect_bridge_channels(platform_kgs)

    # Split matches: exact = confirmed, fuzzy/semantic = candidates for LLM
    confirmed = [m for m in domain_matches if m["matchType"] == "exact"]
    candidates = [m for m in domain_matches if m["matchType"] in ("fuzzy", "semantic")]

    # Collect domain summaries for LLM to use in semantic matching
    domain_summaries = _collect_domain_summaries(project_root, platforms)

    stats = {
        "exactMatches": len(confirmed),
        "fuzzyMatches": sum(1 for m in candidates if m["matchType"] == "fuzzy"),
        "semanticMatches": sum(1 for m in candidates if m["matchType"] == "semantic"),
        "sharedSdksFound": len(shared_sdks),
        "bridgeChannelsFound": len(bridge_channels),
    }

    return {
        "scriptCompleted": True,
        "repoType": "mobile",
        "servicesAnalyzed": services_analyzed,
        "confirmedMappings": _to_domain_mappings(confirmed),
        "candidateMappings": _to_domain_mappings(candidates),
        "domainSummaries": domain_summaries,
        "sharedSdks": shared_sdks,
        "bridgeChannels": bridge_channels,
        "stats": stats,
        # Legacy compatibility
        "domainMappings": _to_domain_mappings(domain_matches),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cross-platform feature parity matcher for mobile projects"
    )
    parser.add_argument("project_root", help="Absolute path to parent project directory")
    parser.add_argument(
        "--services",
        required=True,
        help="Space-separated list of platform service names to analyze",
    )
    parser.add_argument("--output", required=True, help="Output JSON file path")
    args = parser.parse_args()

    service_names = args.services.split()
    result = run_matcher(args.project_root, service_names=service_names)

    output_path = args.output
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    stats = result["stats"]
    print("Feature parity matcher complete.")
    print(f"  Services analyzed: {len(result['servicesAnalyzed'])}")
    print(f"  Domain mappings: {len(result['domainMappings'])}")
    print(f"    exact={stats['exactMatches']} fuzzy={stats['fuzzyMatches']} "
          f"semantic={stats['semanticMatches']}")
    print(f"  Shared SDKs: {stats['sharedSdksFound']}")
    print(f"  Bridge channels: {stats['bridgeChannelsFound']}")


if __name__ == "__main__":
    main()
