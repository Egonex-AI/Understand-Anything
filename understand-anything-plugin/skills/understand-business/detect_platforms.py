#!/usr/bin/env python3
"""Detect standard platform types and enrich business-features.json.

Maps repository names to standard platform names using deterministic file checks,
with LLM prompt generation for ambiguous cases (React Native, KMP, etc.).

Usage:
    python3 detect_platforms.py <project-root>
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).parent / "schemas" / "system.schema.json"

MOBILE_PLATFORMS = (
    "ios",
    "android",
    "flutter",
    "react-native",
    "kotlin-multiplatform",
    "web",
    "unknown",
)

SERVER_PLATFORMS = (
    "java",
    "java-spring",
    "kotlin",
    "go",
    "python",
    "node",
    "dotnet",
    "rust",
    "unknown",
)


def _safe_relpath_name(project_path: Path) -> str:
    return re.sub(r"[^\w.-]", "_", project_path.name) or "project"


def collect_platform_indicators(project_path: str, max_depth: int = 3) -> dict:
    """Collect file and directory signals for platform detection (top N levels)."""
    root = Path(project_path)
    indicators: dict[str, Any] = {
        "project_path": str(root),
        "key_files": [],
        "directories": [],
        "build_files": [],
    }
    if not root.is_dir():
        return indicators

    key_file_names = {
        "pubspec.yaml",
        "Podfile",
        "build.gradle",
        "build.gradle.kts",
        "package.json",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
        "pyproject.toml",
        "requirements.txt",
        "settings.gradle",
        "settings.gradle.kts",
        "metro.config.js",
        "react-native.config.js",
    }

    for path in sorted(root.rglob("*")):
        try:
            depth = len(path.relative_to(root).parts)
        except ValueError:
            continue
        if depth > max_depth:
            continue
        if path.is_file() and path.name in key_file_names:
            rel = str(path.relative_to(root))
            if path.name in {"build.gradle", "build.gradle.kts", "pom.xml", "go.mod", "Cargo.toml"}:
                indicators["build_files"].append(rel)
            else:
                indicators["key_files"].append(rel)
        elif path.is_dir() and depth <= 2:
            indicators["directories"].append(path.name)

    for pattern, label in [
        ("*.xcodeproj", "xcodeproj"),
        ("*.xcworkspace", "xcworkspace"),
        ("**/AndroidManifest.xml", "AndroidManifest.xml"),
        ("**/AppDelegate.swift", "AppDelegate.swift"),
        ("**/AppDelegate.m", "AppDelegate.m"),
    ]:
        if any(root.glob(pattern)):
            indicators["key_files"].append(label)

    indicators["directories"] = sorted(set(indicators["directories"]))
    indicators["key_files"] = sorted(set(indicators["key_files"]))
    indicators["build_files"] = sorted(set(indicators["build_files"]))
    return indicators


def build_platform_detection_prompt(indicators: dict) -> str:
    """Generate a concise LLM prompt from collected project indicators."""
    key_files = ", ".join(indicators.get("key_files", [])) or "none"
    directories = ", ".join(indicators.get("directories", [])) or "none"
    build_files = ", ".join(indicators.get("build_files", [])) or "none"
    project_path = indicators.get("project_path", "unknown")

    return (
        "Given these project indicators, what platform is this?\n\n"
        f"Project path: {project_path}\n"
        f"Key files: {key_files}\n"
        f"Top-level directories: {directories}\n"
        f"Build files: {build_files}\n\n"
        "Respond with exactly one of: "
        "ios, android, flutter, react-native, kotlin-multiplatform, web, unknown"
    )


def _find_project_root(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".understand-anything").is_dir():
            return candidate
    return None


def _store_llm_prompt(project_path: str, prompt: str, project_root: str | None = None) -> Path:
    """Store an LLM prompt for later execution."""
    root = Path(project_path)
    ua_root = Path(project_root) if project_root else _find_project_root(root)
    if ua_root is None:
        ua_root = root

    prompts_dir = ua_root / ".understand-anything" / "platform-detection-prompts"
    prompts_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:12]
    filename = f"{_safe_relpath_name(root)}_{digest}.prompt.txt"
    prompt_path = prompts_dir / filename
    prompt_path.write_text(prompt, encoding="utf-8")
    return prompt_path


def _deterministic_mobile_fallback(indicators: dict) -> str:
    """Priority-ordered fallback when LLM is unavailable."""
    key_files = set(indicators.get("key_files", []))
    build_files = indicators.get("build_files", [])

    if "pubspec.yaml" in key_files or any("pubspec.yaml" in f for f in key_files):
        return "flutter"
    if any("react-native" in f.lower() for f in key_files) or "metro.config.js" in key_files:
        return "react-native"
    if "Podfile" in key_files or "xcodeproj" in key_files or "xcworkspace" in key_files:
        return "ios"
    if any("build.gradle" in f for f in build_files) or "AndroidManifest.xml" in key_files:
        return "android"
    if "package.json" in key_files:
        return "web"
    return "unknown"


def _has_indicator(indicators: dict, *names: str) -> bool:
    haystack = set(indicators.get("key_files", [])) | set(indicators.get("build_files", []))
    for name in names:
        if name in haystack:
            return True
        if any(name in item for item in haystack):
            return True
    return False


def detect_platform_with_llm(project_path: str, project_root: str | None = None) -> tuple[str, Path]:
    """Store LLM prompt and fall back to deterministic detection."""
    indicators = collect_platform_indicators(project_path)
    prompt = build_platform_detection_prompt(indicators)
    prompt_path = _store_llm_prompt(project_path, prompt, project_root=project_root)
    return _deterministic_mobile_fallback(indicators), prompt_path


def detect_platform_type(project_path: str, project_root: str | None = None) -> dict:
    """Detect mobile/client platform with confidence scoring.

    Returns:
        {
            "platform": str,
            "confidence": "high" | "low",
            "needs_llm_verification": bool (optional),
            "llm_prompt_path": str (optional),
        }
    """
    root = Path(project_path)
    if not root.is_dir():
        return {"platform": "unknown", "confidence": "high"}

    indicators = collect_platform_indicators(project_path)
    has_pubspec = _has_indicator(indicators, "pubspec.yaml")
    has_podfile = _has_indicator(indicators, "Podfile", "xcodeproj", "xcworkspace")
    has_android = _has_indicator(indicators, "build.gradle", "build.gradle.kts", "AndroidManifest.xml")
    has_package_json = _has_indicator(indicators, "package.json")
    has_rn = _has_indicator(indicators, "metro.config.js", "react-native.config.js")

    active_groups = sum([has_pubspec, has_podfile, has_android, has_rn and has_package_json])

    if has_pubspec and not has_podfile and not has_android:
        return {"platform": "flutter", "confidence": "high"}

    if has_podfile and not has_android and not has_pubspec:
        return {"platform": "ios", "confidence": "high"}

    if has_android and not has_podfile and not has_pubspec:
        return {"platform": "android", "confidence": "high"}

    if active_groups <= 1 and not has_package_json:
        platform = _deterministic_mobile_fallback(indicators)
        return {"platform": platform, "confidence": "high"}

    if has_package_json and (root / "src").is_dir() and active_groups == 0:
        return {"platform": "web", "confidence": "high"}

    platform, prompt_path = detect_platform_with_llm(project_path, project_root=project_root)
    return {
        "platform": platform,
        "confidence": "low",
        "needs_llm_verification": True,
        "llm_prompt_path": str(prompt_path),
    }


def detect_server_platform(service_path: str) -> dict:
    """Detect backend service tech stack from project structure.

    Returns:
        {"platform": str, "framework": str | None, "confidence": "high" | "low"}
    """
    root = Path(service_path)
    if not root.is_dir():
        return {"platform": "unknown", "framework": None, "confidence": "high"}

    pom = root / "pom.xml"
    gradle = root / "build.gradle"
    gradle_kts = root / "build.gradle.kts"
    go_mod = root / "go.mod"
    cargo = root / "Cargo.toml"
    package_json = root / "package.json"
    requirements = root / "requirements.txt"
    pyproject = root / "pyproject.toml"
    csproj_files = list(root.glob("*.csproj"))
    has_java_src = (root / "src" / "main" / "java").is_dir()
    has_kotlin_src = (root / "src" / "main" / "kotlin").is_dir()

    matches: list[dict] = []

    if pom.is_file():
        content = pom.read_text(encoding="utf-8", errors="ignore")
        spring_boot_markers = (
            "spring-boot-starter",
            "spring-boot-parent",
            "momo-spring-boot-parent",
        )
        if any(marker in content for marker in spring_boot_markers):
            matches.append(
                {
                    "platform": "java-spring",
                    "framework": "spring-boot",
                    "confidence": "high",
                }
            )
        elif has_java_src or "src/main/java" in content:
            matches.append({"platform": "java", "framework": None, "confidence": "high"})
        else:
            matches.append({"platform": "java", "framework": None, "confidence": "high"})

    if gradle.is_file() or gradle_kts.is_file():
        build_file = gradle_kts if gradle_kts.is_file() else gradle
        content = build_file.read_text(encoding="utf-8", errors="ignore")
        if has_kotlin_src or "kotlin" in content:
            matches.append({"platform": "kotlin", "framework": None, "confidence": "high"})
        elif has_java_src:
            matches.append({"platform": "java", "framework": None, "confidence": "high"})

    if go_mod.is_file():
        matches.append({"platform": "go", "framework": None, "confidence": "high"})

    if requirements.is_file() or pyproject.is_file():
        matches.append({"platform": "python", "framework": None, "confidence": "high"})

    if package_json.is_file() and (root / "src").is_dir():
        matches.append({"platform": "node", "framework": None, "confidence": "high"})

    if csproj_files:
        matches.append({"platform": "dotnet", "framework": None, "confidence": "high"})

    if cargo.is_file():
        matches.append({"platform": "rust", "framework": None, "confidence": "high"})

    if not matches:
        return {"platform": "unknown", "framework": None, "confidence": "high"}

    if len(matches) == 1:
        return matches[0]

    priority = ["java-spring", "java", "kotlin", "go", "python", "node", "dotnet", "rust"]
    for platform in priority:
        for match in matches:
            if match["platform"] == platform:
                return {**match, "confidence": "low"}
    return {**matches[0], "confidence": "low"}


def build_mobile_services(
    project_root: Path, facet_path: str, sub_paths: list[str]
) -> tuple[list[dict], dict[str, str]]:
    """Build services[] and platformMapping for a mobile facet from sub-path names."""
    facet_base = facet_path.rstrip("/")
    services: list[dict] = []
    platform_mapping: dict[str, str] = {}

    for sub_path in sub_paths:
        name = sub_path.rstrip("/")
        project_dir = project_root / facet_base / name
        detection = detect_platform_type(str(project_dir), project_root=str(project_root))
        platform_type = detection["platform"]
        service: dict[str, Any] = {
            "name": name,
            "path": f"{facet_base}/{name}",
            "platform": platform_type,
        }
        if detection.get("confidence"):
            service["confidence"] = detection["confidence"]
        services.append(service)
        if platform_type != "unknown" and platform_type not in platform_mapping:
            platform_mapping[platform_type] = name

    return services, platform_mapping


def build_server_services(
    project_root: Path, facet_path: str, sub_paths: list[str]
) -> list[dict]:
    """Build services[] for a server facet from sub-path names."""
    facet_base = facet_path.rstrip("/")
    services: list[dict] = []

    for sub_path in sub_paths:
        name = sub_path.rstrip("/")
        service_dir = project_root / facet_base / name
        detection = detect_server_platform(str(service_dir))
        service: dict[str, Any] = {
            "name": name,
            "path": f"{facet_base}/{name}",
            "platform": detection["platform"],
        }
        if detection.get("framework"):
            service["framework"] = detection["framework"]
        if detection.get("confidence"):
            service["confidence"] = detection["confidence"]
        services.append(service)

    return services


def read_platform_mapping_from_system(system_config: dict) -> dict[str, str]:
    """Read repo -> platform mapping from system.json mobile facet."""
    for facet in system_config.get("facets", []):
        if facet.get("type") != "mobile":
            continue

        platform_mapping = facet.get("platformMapping")
        if platform_mapping:
            return {repo: standard for standard, repo in platform_mapping.items()}

        services = facet.get("services", [])
        if services:
            mapping: dict[str, str] = {}
            for svc in services:
                name = svc.get("name")
                platform = svc.get("platform")
                if name and platform and platform != "unknown":
                    mapping[name] = platform
            if mapping:
                return mapping

    return {}


def detect_platform_mapping_from_files(
    project_root: Path, system_config: dict
) -> dict[str, str]:
    """Fallback: detect platform types from project file structure via subPaths."""
    mapping: dict[str, str] = {}
    for facet in system_config.get("facets", []):
        if facet.get("type") != "mobile":
            continue
        facet_path = facet.get("path", "")
        sub_paths = facet.get("subPaths", [])
        if not sub_paths and facet.get("services"):
            sub_paths = [svc.get("name", "") for svc in facet["services"] if svc.get("name")]
        for sub_path in sub_paths:
            name = sub_path.rstrip("/")
            project_dir = project_root / facet_path / name
            detection = detect_platform_type(str(project_dir), project_root=str(project_root))
            platform_type = detection["platform"]
            if platform_type != "unknown":
                mapping[name] = platform_type
    return mapping


def build_platform_mapping(project_root_str: str) -> dict:
    """Read platform types for each mobile client from system.json."""
    project_root = Path(project_root_str)
    system_path = project_root / ".understand-anything" / "system.json"
    if not system_path.exists():
        return {}

    with open(system_path, encoding="utf-8") as f:
        system_config = json.load(f)

    mapping = read_platform_mapping_from_system(system_config)
    if mapping:
        return mapping

    return detect_platform_mapping_from_files(project_root, system_config)


def enrich_standard_platforms(project_root_str: str) -> dict:
    """Add standardPlatform to platform entries and platformMapping to the document."""
    project_root = Path(project_root_str)
    features_path = project_root / ".understand-anything" / "business-landscape" / "business-features.json"
    if not features_path.exists():
        return {"error": "business-features.json not found"}

    with open(features_path, encoding="utf-8") as f:
        data = json.load(f)

    repo_to_standard = build_platform_mapping(project_root_str)
    standard_to_repo = {standard: repo for repo, standard in repo_to_standard.items()}
    data["platformMapping"] = standard_to_repo

    for feature in data.get("features", []):
        platforms = feature.get("clientLayer", {}).get("platforms", {})
        for repo_name, entry in platforms.items():
            if repo_name in repo_to_standard:
                entry["standardPlatform"] = repo_to_standard[repo_name]

    with open(features_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return data


def _load_schema() -> dict:
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _basic_validate(data: dict, schema: dict) -> list[str]:
    """Minimal validator when jsonschema is unavailable."""
    errors: list[str] = []

    if "facets" not in data:
        errors.append("Missing required field: facets")
        return errors
    if not isinstance(data["facets"], list):
        errors.append("facets must be an array")
        return errors

    facet_required = {"type", "name", "path"}
    facet_types = {"server", "mobile", "frontend", "shared"}
    service_required = {"name", "path", "platform"}
    platform_enum = set(schema["definitions"]["service"]["properties"]["platform"]["enum"])
    confidence_enum = {"high", "low"}

    for i, facet in enumerate(data["facets"]):
        if not isinstance(facet, dict):
            errors.append(f"facets[{i}] must be an object")
            continue
        missing = facet_required - set(facet)
        if missing:
            errors.append(f"facets[{i}] missing required fields: {sorted(missing)}")
        if facet.get("type") not in facet_types:
            errors.append(f"facets[{i}].type must be one of {sorted(facet_types)}")
        for j, service in enumerate(facet.get("services", [])):
            if not isinstance(service, dict):
                errors.append(f"facets[{i}].services[{j}] must be an object")
                continue
            missing_svc = service_required - set(service)
            if missing_svc:
                errors.append(
                    f"facets[{i}].services[{j}] missing required fields: {sorted(missing_svc)}"
                )
            platform = service.get("platform")
            if platform is not None and platform not in platform_enum:
                errors.append(f"facets[{i}].services[{j}].platform invalid: {platform}")
            confidence = service.get("confidence")
            if confidence is not None and confidence not in confidence_enum:
                errors.append(f"facets[{i}].services[{j}].confidence invalid: {confidence}")

    return errors


def validate_system_json(project_root_str: str) -> dict:
    """Validate system.json against the JSON Schema."""
    project_root = Path(project_root_str)
    system_path = project_root / ".understand-anything" / "system.json"
    if not system_path.exists():
        return {"valid": False, "errors": ["system.json not found"]}

    with open(system_path, encoding="utf-8") as f:
        data = json.load(f)

    schema = _load_schema()

    try:
        import jsonschema

        validator = jsonschema.Draft7Validator(schema)
        errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
        if errors:
            return {
                "valid": False,
                "errors": [f"{'.'.join(str(p) for p in err.path)}: {err.message}" for err in errors],
            }
        return {"valid": True, "errors": []}
    except ImportError:
        errors = _basic_validate(data, schema)
        return {"valid": len(errors) == 0, "errors": errors}


def enrich_system_json_services(project_root_str: str) -> dict:
    """Detect and write services[] for mobile and server facets in system.json."""
    project_root = Path(project_root_str)
    system_path = project_root / ".understand-anything" / "system.json"
    if not system_path.exists():
        return {"error": "system.json not found"}

    with open(system_path, encoding="utf-8") as f:
        system_config = json.load(f)

    updated_facets: list[dict] = []
    backend_services: list[dict] = []

    for facet in system_config.get("facets", []):
        facet_type = facet.get("type")
        facet_path = facet.get("path", "")
        sub_paths = facet.get("subPaths", [])

        if facet_type == "mobile" and sub_paths:
            services, platform_mapping = build_mobile_services(project_root, facet_path, sub_paths)
            facet = {**facet, "services": services}
            if platform_mapping:
                facet["platformMapping"] = platform_mapping
        elif facet_type == "server" and sub_paths:
            services = build_server_services(project_root, facet_path, sub_paths)
            facet = {**facet, "services": services}
            backend_services = services

        updated_facets.append(facet)

    system_config["facets"] = updated_facets

    with open(system_path, "w", encoding="utf-8") as f:
        json.dump(system_config, f, ensure_ascii=False, indent=2)
        f.write("\n")

    validation = validate_system_json(project_root_str)
    return {
        "backend_services": backend_services,
        "validation": validation,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 detect_platforms.py <project-root>", file=sys.stderr)
        sys.exit(1)

    project_root_arg = sys.argv[1]
    if len(sys.argv) > 2 and sys.argv[2] == "--enrich-system":
        result = enrich_system_json_services(project_root_arg)
    else:
        result = enrich_standard_platforms(project_root_arg)
    print(json.dumps(result, ensure_ascii=False, indent=2))
