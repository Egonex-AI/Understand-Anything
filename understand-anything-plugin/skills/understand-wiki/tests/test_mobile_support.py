"""Tests for mobile wiki support: QG, feature-parity-matcher, build-client-graph."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent
if str(SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(SKILL_DIR))


def _import_skill_module(filename: str):
    """Import a skill script by filename (supports hyphenated names)."""
    path = SKILL_DIR / filename
    module_name = filename.replace("-", "_").removesuffix(".py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec and spec.loader, f"Cannot load module from {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wiki_qg = _import_skill_module("wiki_quality_gate.py")
build_client_graph_mod = _import_skill_module("build-client-graph.py")

_feature_parity_mod = None


def _get_feature_parity_mod():
    global _feature_parity_mod
    if _feature_parity_mod is None:
        _feature_parity_mod = _import_skill_module("feature-parity-matcher.py")
    return _feature_parity_mod


# ---------------------------------------------------------------------------
# Fixtures — parent wiki (quality gate)
# ---------------------------------------------------------------------------


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _minimal_parent_meta() -> dict:
    return {
        "gitCommitHash": "abc123",
        "generatedAt": "2026-06-15T00:00:00Z",
        "version": "1.0.0",
        "outputLanguage": "en",
        "serviceCount": 1,
    }


def _minimal_parent_index() -> dict:
    return {
        "entries": [
            {
                "id": "wiki:parent",
                "name": "Mobile App",
                "type": "overview",
                "summary": "Parent wiki index entry",
            }
        ]
    }


def _minimal_parent_overview() -> dict:
    return {
        "name": "Mobile App Suite",
        "description": "Cross-platform mobile application wiki.",
        "services": [
            {
                "name": "ios-app",
                "description": "iOS client",
                "domains": ["user-profile"],
            },
            {
                "name": "android-app",
                "description": "Android client",
                "domains": ["user-profile"],
            },
        ],
    }


def _mobile_architecture(
    *,
    cross_service_calls: list | None = None,
    feature_parity: list | None = None,
    shared_infrastructure: list | None = None,
    native_bridge: list | None = None,
) -> dict:
    arch: dict = {
        "crossServiceCalls": cross_service_calls if cross_service_calls is not None else [],
        "eventFlows": [],
    }
    if feature_parity is not None:
        arch["featureParity"] = feature_parity
    if shared_infrastructure is not None:
        arch["sharedInfrastructure"] = shared_infrastructure
    if native_bridge is not None:
        arch["nativeBridge"] = native_bridge
    return arch


def _setup_parent_wiki(tmp_path: Path, architecture: dict) -> Path:
    wiki_dir = tmp_path / "wiki"
    _write_json(wiki_dir / "meta.json", _minimal_parent_meta())
    _write_json(wiki_dir / "index.json", _minimal_parent_index())
    _write_json(wiki_dir / "overview.json", _minimal_parent_overview())
    _write_json(wiki_dir / "architecture.json", architecture)
    (wiki_dir / "domains").mkdir(parents=True, exist_ok=True)
    return wiki_dir


# ---------------------------------------------------------------------------
# Fixtures — mobile project (client graph + feature parity)
# ---------------------------------------------------------------------------


def _write_platform_wiki(
    platform_path: Path,
    *,
    service_name: str,
    domains: list[dict],
    domain_pages: dict[str, dict] | None = None,
) -> None:
    wiki_dir = platform_path / ".understand-anything" / "wiki"
    _write_json(
        wiki_dir / "meta.json",
        {
            "gitCommitHash": "abc123",
            "generatedAt": "2026-06-15T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "en",
        },
    )
    _write_json(
        wiki_dir / "service.json",
        {
            "name": service_name,
            "description": f"{service_name} mobile client wiki",
            "domains": domains,
        },
    )
    domain_pages = domain_pages or {}
    for slug, page in domain_pages.items():
        _write_json(wiki_dir / "domains" / f"{slug}.json", page)


def _domain_page(slug: str, name: str) -> dict:
    return {
        "id": f"domain:{slug}",
        "name": name,
        "summary": f"Domain page for {name} with enough summary text.",
        "entities": [],
        "flows": [],
    }


def _setup_mobile_project(
    tmp_path: Path,
    *,
    ios_domains: list[dict],
    android_domains: list[dict],
    ios_pages: dict[str, dict] | None = None,
    android_pages: dict[str, dict] | None = None,
) -> Path:
    system = {
        "facets": [
            {
                "name": "mobile",
                "type": "mobile",
                "path": "mobile/",
                "subPaths": ["ios/", "android/"],
            }
        ]
    }
    _write_json(tmp_path / ".understand-anything" / "system.json", system)

    _write_platform_wiki(
        tmp_path / "mobile" / "ios",
        service_name="ios-app",
        domains=ios_domains,
        domain_pages=ios_pages,
    )
    _write_platform_wiki(
        tmp_path / "mobile" / "android",
        service_name="android-app",
        domains=android_domains,
        domain_pages=android_pages,
    )
    return tmp_path


def _write_kg(platform_path: Path, nodes: list[dict], edges: list[dict] | None = None) -> None:
    kg_path = platform_path / ".understand-anything" / "knowledge-graph.json"
    _write_json(
        kg_path,
        {
            "project": {"name": platform_path.name},
            "nodes": nodes,
            "edges": edges or [],
        },
    )


def _read_client_graph(project_root: Path) -> dict:
    graph_path = project_root / "mobile" / ".understand-anything" / "client-graph.json"
    return json.loads(graph_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Test 1 — Parent quality gate mobile architecture
# ---------------------------------------------------------------------------


def test_parent_qg_passes_with_mobile_architecture(tmp_path):
    """architecture.json with featureParity+sharedInfrastructure+nativeBridge should pass QG even if crossServiceCalls is empty."""
    architecture = _mobile_architecture(
        cross_service_calls=[],
        feature_parity=[
            {
                "feature": "user-profile",
                "platforms": {
                    "ios": {"domain": "user-profile", "implType": "native"},
                    "android": {"domain": "user-profile", "implType": "native"},
                },
                "note": "Shared profile feature across native platforms",
            }
        ],
        shared_infrastructure=[
            {
                "type": "sdk",
                "resource": "PhotonIM",
                "platforms": ["ios", "android"],
                "detail": "Shared instant messaging SDK",
            }
        ],
        native_bridge=[
            {
                "type": "flutter_boost",
                "from": "flutter",
                "to": "native",
                "mechanism": "FlutterBoost",
                "detail": "Hybrid navigation bridge",
            }
        ],
    )
    wiki_dir = _setup_parent_wiki(tmp_path, architecture)

    result = wiki_qg.run_parent_quality_gate(str(wiki_dir))

    assert result["passed"] is True
    assert result["issues"] == []
    assert not any("featureParity" in issue for issue in result["issues"])
    assert not any("sharedInfrastructure" in issue for issue in result["issues"])
    assert not any("nativeBridge" in issue for issue in result["issues"])


def test_parent_qg_validates_feature_parity_structure(tmp_path):
    """featureParity entries must have 'feature' and 'platforms' fields."""
    architecture = _mobile_architecture(
        feature_parity=[
            {"platforms": {"ios": {}}},
            {"feature": "orphan-feature"},
        ]
    )
    wiki_dir = _setup_parent_wiki(tmp_path, architecture)

    issues: list[str] = []
    warnings: list[str] = []
    wiki_qg._validate_parent_architecture(architecture, issues, warnings)

    assert any("featureParity" in issue and "feature" in issue for issue in issues)
    assert any("featureParity" in issue and "platforms" in issue for issue in issues)


def test_parent_qg_warns_on_empty_mobile_fields(tmp_path):
    """If mobile-specific fields are present but empty, emit warnings not errors."""
    architecture = _mobile_architecture(
        feature_parity=[],
        shared_infrastructure=[],
        native_bridge=[],
    )
    wiki_dir = _setup_parent_wiki(tmp_path, architecture)

    result = wiki_qg.run_parent_quality_gate(str(wiki_dir))

    assert result["passed"] is True
    assert result["issues"] == []
    warning_text = " ".join(result["warnings"]).lower()
    assert "featureparity" in warning_text or "feature parity" in warning_text
    assert "sharedinfrastructure" in warning_text or "shared infrastructure" in warning_text
    assert "nativebridge" in warning_text or "native bridge" in warning_text


# ---------------------------------------------------------------------------
# Test 2 — feature-parity-matcher.py
# ---------------------------------------------------------------------------


def test_domain_name_matching_exact(tmp_path):
    """Domains with same name across platforms are matched."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "user-profile", "name": "User Profile"}],
        android_domains=[{"slug": "user-profile", "name": "User Profile"}],
    )
    fpm = _get_feature_parity_mod()
    platform_domains = fpm.load_platform_domains(project)

    matches = fpm.match_domains_across_platforms(platform_domains)
    exact = [m for m in matches if m.get("matchType") == "exact"]

    assert len(exact) >= 1
    match = exact[0]
    assert match["canonicalName"] == "User Profile"
    assert "ios" in match["platforms"]
    assert "android" in match["platforms"]
    assert match["platforms"]["ios"]["slug"] == "user-profile"
    assert match["platforms"]["android"]["slug"] == "user-profile"


def test_domain_name_matching_fuzzy(tmp_path):
    """Domains like 'login-auth' on both platforms are matched."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "login-auth", "name": "login-auth"}],
        android_domains=[{"slug": "login_auth", "name": "login-auth"}],
    )
    fpm = _get_feature_parity_mod()
    platform_domains = fpm.load_platform_domains(project)

    matches = fpm.match_domains_across_platforms(platform_domains)
    fuzzy = [m for m in matches if m.get("matchType") in ("exact", "fuzzy")]

    assert len(fuzzy) >= 1
    match = fuzzy[0]
    assert "login" in match["canonicalName"].lower()
    assert "ios" in match["platforms"]
    assert "android" in match["platforms"]


def test_domain_name_matching_semantic(tmp_path):
    """Semantically similar domains like 'instant-messaging' and 'im-chat' are matched as candidates."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "instant-messaging", "name": "Instant Messaging"}],
        android_domains=[{"slug": "im-chat", "name": "IM Chat"}],
    )
    fpm = _get_feature_parity_mod()
    platform_domains = fpm.load_platform_domains(project)

    matches = fpm.match_domains_across_platforms(platform_domains)
    semantic = [m for m in matches if m.get("matchType") == "semantic"]

    assert len(semantic) >= 1
    candidate = semantic[0]
    assert candidate.get("status") == "candidate" or candidate.get("confidence", 0) < 1.0
    slugs = {
        candidate["platforms"]["ios"]["slug"],
        candidate["platforms"]["android"]["slug"],
    }
    assert "instant-messaging" in slugs
    assert "im-chat" in slugs


def test_shared_sdk_detection(tmp_path):
    """Common SDK imports (PhotonIM, Agora) across platforms are detected."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "chat", "name": "Chat"}],
        android_domains=[{"slug": "chat", "name": "Chat"}],
    )
    _write_kg(
        project / "mobile" / "ios",
        [
            {
                "id": "file:ios/ChatService.swift",
                "name": "ChatService",
                "imports": ["PhotonIM", "Foundation"],
            },
            {
                "id": "file:ios/VideoCall.swift",
                "name": "VideoCall",
                "imports": ["AgoraRtcKit"],
            },
        ],
    )
    _write_kg(
        project / "mobile" / "android",
        [
            {
                "id": "file:android/ChatService.kt",
                "name": "ChatService",
                "imports": ["com.photon.im.PhotonIM", "android.os.Bundle"],
            },
            {
                "id": "file:android/VideoCall.kt",
                "name": "VideoCall",
                "imports": ["io.agora.rtc.AgoraRtcEngine"],
            },
        ],
    )

    fpm = _get_feature_parity_mod()
    platform_kgs = fpm.load_platform_knowledge_graphs(project)
    shared_sdks = fpm.detect_shared_sdks(platform_kgs)
    sdk_names = {entry["sdk"].lower() for entry in shared_sdks}

    assert any("photon" in name for name in sdk_names)
    assert any("agora" in name for name in sdk_names)
    photon = next(s for s in shared_sdks if "photon" in s["sdk"].lower())
    assert set(photon["platforms"]) == {"ios", "android"}


def test_bridge_detection(tmp_path):
    """FlutterBoost/MethodChannel references in KG are detected as bridge channels."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "hybrid", "name": "Hybrid Navigation"}],
        android_domains=[{"slug": "hybrid", "name": "Hybrid Navigation"}],
    )
    _write_kg(
        project / "mobile" / "ios",
        [
            {
                "id": "class:flutter_boost",
                "name": "FlutterBoost",
                "type": "class",
                "filePath": "ios/Bridge/FlutterBoostDelegate.swift",
            },
            {
                "id": "channel:login",
                "name": "loginChannel",
                "type": "method_channel",
                "filePath": "ios/Bridge/LoginChannel.swift",
            },
        ],
        edges=[
            {
                "source": "class:flutter_boost",
                "target": "channel:login",
                "type": "uses_channel",
            }
        ],
    )
    _write_kg(
        project / "mobile" / "android",
        [
            {
                "id": "class:flutter_boost",
                "name": "FlutterBoost",
                "type": "class",
                "filePath": "android/bridge/FlutterBoostActivity.kt",
            },
            {
                "id": "channel:login",
                "name": "MethodChannel",
                "type": "method_channel",
                "filePath": "android/bridge/LoginChannel.kt",
            },
        ],
    )

    fpm = _get_feature_parity_mod()
    platform_kgs = fpm.load_platform_knowledge_graphs(project)
    bridges = fpm.detect_bridge_channels(platform_kgs)
    mechanisms = {b.get("mechanism", "").lower() for b in bridges}
    names = {b.get("name", "").lower() for b in bridges}

    assert any("flutterboost" in m for m in mechanisms) or any(
        "flutterboost" in n for n in names
    )
    assert any("methodchannel" in m for m in mechanisms) or any(
        "methodchannel" in n for n in names
    )


# ---------------------------------------------------------------------------
# Test 3 — build-client-graph.py domainLinks
# ---------------------------------------------------------------------------


def test_domain_links_generated(tmp_path):
    """domainLinks[] is populated with cross-platform domain mappings."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[
            {"slug": "user-profile", "name": "User Profile"},
            {"slug": "login-auth", "name": "login-auth"},
        ],
        android_domains=[
            {"slug": "user-profile", "name": "User Profile"},
            {"slug": "login-auth", "name": "login-auth"},
        ],
        ios_pages={
            "user-profile": _domain_page("user-profile", "User Profile"),
            "login-auth": _domain_page("login-auth", "login-auth"),
        },
        android_pages={
            "user-profile": _domain_page("user-profile", "User Profile"),
            "login-auth": _domain_page("login-auth", "login-auth"),
        },
    )

    build_client_graph_mod.build_client_graph(str(project))
    graph = _read_client_graph(project)

    assert "domainLinks" in graph
    assert isinstance(graph["domainLinks"], list)
    assert len(graph["domainLinks"]) >= 2
    canonical = {link["canonicalFeature"] for link in graph["domainLinks"]}
    assert "User Profile" in canonical or "user-profile" in canonical
    assert "login-auth" in canonical


def test_domain_links_structure(tmp_path):
    """Each domainLink has canonicalFeature and mappings dict."""
    project = _setup_mobile_project(
        tmp_path,
        ios_domains=[{"slug": "user-profile", "name": "User Profile"}],
        android_domains=[{"slug": "user-profile", "name": "User Profile"}],
        ios_pages={"user-profile": _domain_page("user-profile", "User Profile")},
        android_pages={"user-profile": _domain_page("user-profile", "User Profile")},
    )

    build_client_graph_mod.build_client_graph(str(project))
    graph = _read_client_graph(project)

    assert graph["domainLinks"]
    for link in graph["domainLinks"]:
        assert "canonicalFeature" in link
        assert isinstance(link["canonicalFeature"], str)
        assert link["canonicalFeature"]
        assert "mappings" in link
        assert isinstance(link["mappings"], dict)
        assert "ios" in link["mappings"]
        assert "android" in link["mappings"]
        assert isinstance(link["mappings"]["ios"], str)
        assert isinstance(link["mappings"]["android"], str)
