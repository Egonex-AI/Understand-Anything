import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from detect_platforms import (
    build_platform_detection_prompt,
    build_platform_mapping,
    collect_platform_indicators,
    detect_platform_type,
    detect_platform_with_llm,
    detect_server_platform,
    enrich_standard_platforms,
    read_platform_mapping_from_system,
    validate_system_json,
)


@pytest.fixture
def ios_project(tmp_path):
    project = tmp_path / "Amar"
    project.mkdir()
    (project / "Podfile").write_text("platform :ios, '13.0'\n")
    return project


@pytest.fixture
def android_project(tmp_path):
    project = tmp_path / "ddoversea"
    project.mkdir()
    (project / "build.gradle").write_text("plugins { id 'com.android.application' }\n")
    return project


@pytest.fixture
def flutter_project(tmp_path):
    project = tmp_path / "ddoversea_flutter"
    project.mkdir()
    (project / "pubspec.yaml").write_text("name: ddoversea_flutter\n")
    return project


def test_detect_ios_from_podfile(ios_project):
    result = detect_platform_type(str(ios_project))
    assert result["platform"] == "ios"
    assert result["confidence"] == "high"


def test_detect_android_from_build_gradle(android_project):
    result = detect_platform_type(str(android_project))
    assert result["platform"] == "android"
    assert result["confidence"] == "high"


def test_detect_flutter_from_pubspec(flutter_project):
    result = detect_platform_type(str(flutter_project))
    assert result["platform"] == "flutter"
    assert result["confidence"] == "high"


def test_detect_unknown_project(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    result = detect_platform_type(str(empty))
    assert result["platform"] == "unknown"
    assert result["confidence"] == "high"


def test_ambiguous_detection_returns_low_confidence(tmp_path):
    project = tmp_path / "react_native"
    project.mkdir()
    (project / "Podfile").write_text("platform :ios, '13.0'\n")
    (project / "build.gradle").write_text("plugins { id 'com.android.application' }\n")

    result = detect_platform_type(str(project))
    assert result["confidence"] == "low"
    assert result["needs_llm_verification"] is True


def test_build_platform_detection_prompt_includes_indicators(tmp_path):
    project = tmp_path / "sample"
    project.mkdir()
    (project / "Podfile").write_text("platform :ios\n")
    indicators = collect_platform_indicators(str(project))
    prompt = build_platform_detection_prompt(indicators)

    assert "Podfile" in prompt
    assert "ios, android, flutter, react-native" in prompt


def test_detect_platform_with_llm_stores_prompt(tmp_path):
    project = tmp_path / "ambiguous"
    project.mkdir()
    (project / "Podfile").write_text("platform :ios\n")
    (project / "build.gradle").write_text("plugins {}\n")
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()

    platform, _ = detect_platform_with_llm(str(project), project_root=str(tmp_path))

    assert platform in {"ios", "android", "react-native", "unknown"}
    prompts_dir = ua_dir / "platform-detection-prompts"
    assert prompts_dir.exists()
    assert any(prompts_dir.glob("*.prompt.txt"))


@pytest.fixture
def java_project(tmp_path):
    project = tmp_path / "ultron-api"
    project.mkdir()
    (project / "pom.xml").write_text(
        "<project><dependencies>"
        "<dependency><artifactId>spring-boot-starter-web</artifactId></dependency>"
        "</dependencies></project>\n"
    )
    java_src = project / "src" / "main" / "java"
    java_src.mkdir(parents=True)
    (java_src / "App.java").write_text("public class App {}\n")
    return project


@pytest.fixture
def go_project(tmp_path):
    project = tmp_path / "my-service"
    project.mkdir()
    (project / "go.mod").write_text("module example.com/my-service\n\ngo 1.21\n")
    return project


def test_detect_server_platform_java_spring(java_project):
    result = detect_server_platform(str(java_project))
    assert result["platform"] == "java-spring"
    assert result["framework"] == "spring-boot"
    assert result["confidence"] == "high"


def test_detect_server_platform_java_without_spring(tmp_path):
    project = tmp_path / "plain-java"
    project.mkdir()
    (project / "pom.xml").write_text("<project></project>\n")
    java_src = project / "src" / "main" / "java"
    java_src.mkdir(parents=True)
    (java_src / "App.java").write_text("public class App {}\n")

    result = detect_server_platform(str(project))
    assert result["platform"] == "java"
    assert result["confidence"] == "high"


def test_detect_server_platform_go(go_project):
    result = detect_server_platform(str(go_project))
    assert result["platform"] == "go"
    assert result["confidence"] == "high"


def test_validate_system_json_valid(tmp_path):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "server",
                        "name": "Backend",
                        "path": "backend",
                        "services": [
                            {
                                "name": "api",
                                "path": "backend/api",
                                "platform": "java-spring",
                                "framework": "spring-boot",
                                "confidence": "high",
                            }
                        ],
                    }
                ]
            }
        )
    )

    result = validate_system_json(str(tmp_path))
    assert result["valid"] is True
    assert result["errors"] == []


def test_validate_system_json_missing_required_fields(tmp_path):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "server",
                        "path": "backend",
                        "services": [{"name": "api", "path": "backend/api"}],
                    }
                ]
            }
        )
    )

    result = validate_system_json(str(tmp_path))
    assert result["valid"] is False
    assert len(result["errors"]) > 0


def test_build_platform_mapping_from_system_json(tmp_path):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "mobile",
                        "path": "mobile",
                        "subPaths": ["Amar", "ddoversea", "ddoversea_flutter"],
                        "services": [
                            {"name": "Amar", "path": "mobile/Amar", "platform": "ios"},
                            {"name": "ddoversea", "path": "mobile/ddoversea", "platform": "android"},
                            {
                                "name": "ddoversea_flutter",
                                "path": "mobile/ddoversea_flutter",
                                "platform": "flutter",
                            },
                        ],
                        "platformMapping": {
                            "ios": "Amar",
                            "android": "ddoversea",
                            "flutter": "ddoversea_flutter",
                        },
                    }
                ]
            }
        )
    )

    mapping = build_platform_mapping(str(tmp_path))
    assert mapping == {
        "Amar": "ios",
        "ddoversea": "android",
        "ddoversea_flutter": "flutter",
    }


def test_read_platform_mapping_prefers_platform_mapping_field():
    system_config = {
        "facets": [
            {
                "type": "mobile",
                "platformMapping": {"ios": "Amar", "android": "ddoversea"},
                "services": [
                    {"name": "Amar", "path": "mobile/Amar", "platform": "ios"},
                ],
            }
        ]
    }
    assert read_platform_mapping_from_system(system_config) == {
        "Amar": "ios",
        "ddoversea": "android",
    }


def test_build_platform_mapping(tmp_path, ios_project, android_project, flutter_project):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "mobile",
                        "path": "mobile",
                        "subPaths": ["Amar", "ddoversea", "ddoversea_flutter"],
                    }
                ]
            }
        )
    )
    mobile = tmp_path / "mobile"
    mobile.mkdir()
    for name in ["Amar", "ddoversea", "ddoversea_flutter"]:
        (mobile / name).mkdir(exist_ok=True)
    (mobile / "Amar" / "Podfile").write_text("platform :ios\n")
    (mobile / "ddoversea" / "build.gradle").write_text("plugins {}\n")
    (mobile / "ddoversea_flutter" / "pubspec.yaml").write_text("name: app\n")

    mapping = build_platform_mapping(str(tmp_path))
    assert mapping == {
        "Amar": "ios",
        "ddoversea": "android",
        "ddoversea_flutter": "flutter",
    }


def test_enrichment_uses_system_json_platform_mapping(tmp_path):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "mobile",
                        "path": "mobile",
                        "subPaths": ["Amar", "ddoversea"],
                        "platformMapping": {"ios": "Amar", "android": "ddoversea"},
                    }
                ]
            }
        )
    )

    bl_dir = ua_dir / "business-landscape"
    bl_dir.mkdir()
    features_path = bl_dir / "business-features.json"
    features_path.write_text(
        json.dumps(
            {
                "features": [
                    {
                        "id": "feature:voice-room",
                        "name": "语聊房",
                        "clientLayer": {
                            "platforms": {
                                "Amar": {"domainName": "直播", "wikiRef": "mobile/Amar/wiki.json"},
                                "ddoversea": {
                                    "domainName": "语音房",
                                    "wikiRef": "mobile/ddoversea/wiki.json",
                                },
                            },
                            "deliveryPlatforms": ["Amar", "ddoversea"],
                            "summary": "Voice room feature",
                        },
                        "serverLayer": {"primaryDomain": None, "supportingDomains": []},
                    }
                ],
                "serverIndex": {},
                "stats": {
                    "totalFeatures": 1,
                    "withServerAssociation": 0,
                    "serverDomainsReferenced": 0,
                },
            },
            ensure_ascii=False,
        )
    )

    result = enrich_standard_platforms(str(tmp_path))

    assert result["platformMapping"] == {"ios": "Amar", "android": "ddoversea"}
    platforms = result["features"][0]["clientLayer"]["platforms"]
    assert platforms["Amar"]["standardPlatform"] == "ios"
    assert platforms["ddoversea"]["standardPlatform"] == "android"


def test_enrichment_adds_standard_platform(tmp_path):
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text(
        json.dumps(
            {
                "facets": [
                    {
                        "type": "mobile",
                        "path": "mobile",
                        "subPaths": ["Amar", "ddoversea"],
                    }
                ]
            }
        )
    )
    mobile = tmp_path / "mobile"
    mobile.mkdir()
    (mobile / "Amar").mkdir()
    (mobile / "ddoversea").mkdir()
    (mobile / "Amar" / "Podfile").write_text("platform :ios\n")
    (mobile / "ddoversea" / "build.gradle").write_text("plugins {}\n")

    bl_dir = ua_dir / "business-landscape"
    bl_dir.mkdir()
    features_path = bl_dir / "business-features.json"
    features_path.write_text(
        json.dumps(
            {
                "features": [
                    {
                        "id": "feature:voice-room",
                        "name": "语聊房",
                        "clientLayer": {
                            "platforms": {
                                "Amar": {"domainName": "直播", "wikiRef": "mobile/Amar/wiki.json"},
                                "ddoversea": {"domainName": "语音房", "wikiRef": "mobile/ddoversea/wiki.json"},
                            },
                            "deliveryPlatforms": ["Amar", "ddoversea"],
                            "summary": "Voice room feature",
                        },
                        "serverLayer": {"primaryDomain": None, "supportingDomains": []},
                    }
                ],
                "serverIndex": {},
                "stats": {"totalFeatures": 1, "withServerAssociation": 0, "serverDomainsReferenced": 0},
            },
            ensure_ascii=False,
        )
    )

    result = enrich_standard_platforms(str(tmp_path))

    assert result["platformMapping"] == {"ios": "Amar", "android": "ddoversea"}
    platforms = result["features"][0]["clientLayer"]["platforms"]
    assert platforms["Amar"]["standardPlatform"] == "ios"
    assert platforms["ddoversea"]["standardPlatform"] == "android"

    saved = json.loads(features_path.read_text())
    assert saved["platformMapping"] == {"ios": "Amar", "android": "ddoversea"}
    assert saved["features"][0]["clientLayer"]["platforms"]["Amar"]["standardPlatform"] == "ios"
