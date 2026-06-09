"""Deterministic endpoint extraction from ua-file-extract-results JSON.

Reads annotations + method signatures to produce ServiceEndpointDoc JSON.
Does NOT use LLM — pure structural extraction.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_PROVIDER_ANNOTATIONS = {"MoaProvider", "DubboService", "GrpcService"}
_CONSUMER_ANNOTATIONS = {"MoaConsumer", "DubboReference", "GrpcClient"}
_CONSUMER_CLASS_ANNOTATIONS = {"FeignClient"}
_SUBSCRIBER_ANNOTATIONS = {"KafkaListener"}

_ANNOTATION_TO_PROTOCOL = {
    "MoaProvider": "moa", "MoaConsumer": "moa",
    "DubboService": "dubbo", "DubboReference": "dubbo",
    "GrpcService": "grpc", "GrpcClient": "grpc",
    "FeignClient": "http",
}


def _annotation_names(annotations: list[dict] | None) -> set[str]:
    if not annotations:
        return set()
    return {a.get("name", "") for a in annotations if isinstance(a, dict)}


def _annotation_args(annotations: list[dict] | None, name: str) -> dict:
    if not annotations:
        return {}
    for a in annotations:
        if isinstance(a, dict) and a.get("name") == name:
            args = a.get("arguments", {})
            return args if isinstance(args, dict) else {}
    return {}


def _extract_javadoc_above(lines: list[str], method_line_idx: int) -> str:
    """Extract the descriptive text from a Javadoc comment above a method declaration.

    Scans upwards from method_line_idx, skipping annotations (@Override etc.),
    looking for a ``*/`` then ``/**`` block.  Returns the description portion
    (lines before any @param / @return / @throws tags), joined into a single string.
    """
    end_idx: int | None = None
    start_idx: int | None = None

    scan_from = method_line_idx - 1
    for i in range(scan_from, max(scan_from - 30, -1), -1):
        stripped = lines[i].strip()
        if stripped == "*/":
            end_idx = i
        elif stripped.startswith("/**"):
            start_idx = i
            break
        elif end_idx is None and stripped and not stripped.startswith("@") and not stripped.startswith("*"):
            break

    if start_idx is None or end_idx is None:
        return ""

    desc_parts: list[str] = []
    for i in range(start_idx, end_idx + 1):
        stripped = lines[i].strip()
        if stripped.startswith("/**"):
            stripped = stripped[3:].strip()
        elif stripped == "*/":
            continue
        elif stripped.startswith("*"):
            stripped = stripped[1:].strip()

        if stripped.startswith("@"):
            break
        if stripped:
            desc_parts.append(stripped)

    return " ".join(desc_parts)


def _extract_javadocs_from_source(
    source_path: Path, method_names: list[str],
) -> dict[str, str]:
    """Read a Java source file and extract Javadoc descriptions for the given methods."""
    if not source_path.is_file():
        return {}

    try:
        lines = source_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}

    result: dict[str, str] = {}
    _method_re_cache: dict[str, re.Pattern[str]] = {}

    for name in method_names:
        if name not in _method_re_cache:
            _method_re_cache[name] = re.compile(
                rf"\b{re.escape(name)}\s*\(", re.IGNORECASE,
            )
        pat = _method_re_cache[name]

        for i, line in enumerate(lines):
            if pat.search(line):
                doc = _extract_javadoc_above(lines, i)
                if doc:
                    result[name] = doc
                break

    return result


def _match_methods_to_class(
    functions: list[dict], class_method_names: list[str],
) -> list[dict]:
    """Filter functions to only those whose name appears in the class's method list.

    Falls back to returning all functions if class_method_names is empty
    (tree-sitter may not always extract the methods list).
    """
    method_set = set(class_method_names) if class_method_names else None
    methods = []
    for fn in functions:
        if not isinstance(fn, dict):
            continue
        fn_name = fn.get("name")
        if method_set is not None and fn_name not in method_set:
            continue
        params = fn.get("params", [])
        typed_params = []
        for p in params:
            if isinstance(p, dict):
                typed_params.append({
                    "name": p.get("name", "?"),
                    "type": p.get("type", "unknown"),
                })
            elif isinstance(p, str):
                typed_params.append({"name": p, "type": "unknown"})

        methods.append({
            "name": fn_name or "?",
            "params": typed_params,
            "returnType": fn.get("returnType", "void"),
            "lineRange": [fn.get("startLine", 0), fn.get("endLine", 0)],
        })
    return methods


def extract_endpoints_from_dir(
    extraction_dir: Path, service_name: str,
    project_root: Path | None = None,
) -> dict[str, Any]:
    """Read extraction results and produce a ServiceEndpointDoc dict.

    When *project_root* is provided, the extractor reads actual Java source
    files to pull Javadoc descriptions for each provider method.
    """
    providers: list[dict] = []
    consumers: list[dict] = []
    kafka_topics: list[dict] = []
    # class_name -> relative file path (for resolving interface source files)
    _class_file_map: dict[str, str] = {}

    extraction_files = sorted(extraction_dir.glob("ua-file-extract-results-*.json"))

    for ext_file in extraction_files:
        try:
            data = json.loads(ext_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        results = data.get("results")
        if not isinstance(results, list):
            continue

        for file_result in results:
            file_path = file_result.get("path", "")
            classes = file_result.get("classes", [])
            functions = file_result.get("functions", [])
            if not isinstance(classes, list):
                classes = []
            if not isinstance(functions, list):
                functions = []

            for cls in classes:
                if not isinstance(cls, dict):
                    continue
                cls_name = cls.get("name", "")
                if not cls_name:
                    continue

                _class_file_map[cls_name] = file_path

                ann_names = _annotation_names(cls.get("annotations"))
                interfaces = cls.get("interfaces", [])
                if not isinstance(interfaces, list):
                    interfaces = []

                provider_anns = ann_names & _PROVIDER_ANNOTATIONS
                if provider_anns and interfaces:
                    ann_name = next(iter(provider_anns))
                    protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                    ann_args = _annotation_args(cls.get("annotations"), ann_name)
                    methods = _match_methods_to_class(functions, cls.get("methods", []))

                    for iface in interfaces:
                        if not isinstance(iface, str) or not iface:
                            continue
                        providers.append({
                            "identifier": iface,
                            "protocol": protocol,
                            "framework": ann_name,
                            "group": ann_args.get("group"),
                            "version": ann_args.get("version"),
                            "methods": methods,
                            "sourceRef": {"file": file_path},
                        })

                consumer_anns = ann_names & _CONSUMER_CLASS_ANNOTATIONS
                if consumer_anns:
                    ann_name = next(iter(consumer_anns))
                    protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                    ann_args = _annotation_args(cls.get("annotations"), ann_name)
                    target = (
                        ann_args.get("value")
                        or ann_args.get("name")
                        or ann_args.get("url")
                        or cls_name
                    )
                    consumers.append({
                        "identifier": cls_name,
                        "protocol": protocol,
                        "framework": ann_name,
                        "targetInterface": target if isinstance(target, str) else cls_name,
                        "sourceRef": {"file": file_path},
                    })

                typed_props = cls.get("typedProperties", [])
                if isinstance(typed_props, list):
                    for prop in typed_props:
                        if not isinstance(prop, dict):
                            continue
                        prop_anns = _annotation_names(prop.get("annotations"))
                        field_consumer_anns = prop_anns & _CONSUMER_ANNOTATIONS
                        if field_consumer_anns:
                            ann_name = next(iter(field_consumer_anns))
                            protocol = _ANNOTATION_TO_PROTOCOL.get(ann_name, "unknown")
                            iface_name = prop.get("type", prop.get("name", "?"))
                            consumers.append({
                                "identifier": iface_name,
                                "protocol": protocol,
                                "framework": ann_name,
                                "targetInterface": iface_name,
                                "sourceRef": {"file": file_path},
                            })

            for fn in functions:
                if not isinstance(fn, dict):
                    continue
                fn_anns = _annotation_names(fn.get("annotations"))
                if fn_anns & _SUBSCRIBER_ANNOTATIONS:
                    for ann_name in fn_anns & _SUBSCRIBER_ANNOTATIONS:
                        ann_args = _annotation_args(fn.get("annotations"), ann_name)
                        topics = ann_args.get("topics", ann_args.get("value", ""))
                        if isinstance(topics, str):
                            topics = [topics] if topics else []
                        elif not isinstance(topics, list):
                            topics = []
                        for topic in topics:
                            if not topic:
                                continue
                            kafka_topics.append({
                                "topic": topic,
                                "role": "subscriber",
                                "handlerMethod": fn.get("name"),
                                "sourceRef": {"file": file_path},
                            })

    provider_ids = {p["identifier"] for p in providers}
    filtered_consumers = []
    dropped_self_refs = []
    for c in consumers:
        src = c.get("sourceRef", {}).get("file", "")
        is_wrapper_module = "-wrapper-starter/" in src or "-wrapper/" in src
        if is_wrapper_module and c.get("targetInterface") in provider_ids:
            dropped_self_refs.append(
                f"{c['targetInterface']} (from {src})"
            )
            continue
        filtered_consumers.append(c)
    if dropped_self_refs:
        import sys
        print(
            f"[extract-endpoints] Dropped {len(dropped_self_refs)} "
            f"self-referencing wrapper consumer(s): "
            + ", ".join(dropped_self_refs),
            file=sys.stderr,
        )

    if project_root is not None:
        _enrich_provider_descriptions(providers, _class_file_map, project_root)

    return {
        "service": service_name,
        "description": f"RPC/MQ endpoints for {service_name}",
        "providers": providers,
        "consumers": filtered_consumers,
        "kafkaTopics": kafka_topics,
    }


def _enrich_provider_descriptions(
    providers: list[dict],
    class_file_map: dict[str, str],
    project_root: Path,
) -> None:
    """Enrich provider methods with Javadoc descriptions from interface source files.

    Tries the interface source first (where Javadoc is conventionally written),
    then falls back to the implementation source.
    """
    import sys

    enriched_count = 0
    for prov in providers:
        methods = prov.get("methods", [])
        if not methods:
            continue
        method_names = [m["name"] for m in methods if m.get("name")]

        javadocs: dict[str, str] = {}

        iface_name = prov["identifier"]
        iface_rel = class_file_map.get(iface_name)
        if iface_rel:
            iface_path = project_root / iface_rel
            javadocs = _extract_javadocs_from_source(iface_path, method_names)

        missing = [n for n in method_names if n not in javadocs]
        if missing:
            impl_rel = prov.get("sourceRef", {}).get("file", "")
            if impl_rel and impl_rel != iface_rel:
                impl_javadocs = _extract_javadocs_from_source(
                    project_root / impl_rel, missing,
                )
                javadocs.update(impl_javadocs)

        for m in methods:
            desc = javadocs.get(m["name"], "")
            if desc:
                m["description"] = desc
                enriched_count += 1

    if enriched_count:
        print(
            f"[extract-endpoints] Enriched {enriched_count} method(s) "
            f"with Javadoc descriptions",
            file=sys.stderr,
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract RPC/MQ endpoint metadata from file extraction results",
    )
    parser.add_argument("extraction_dir", help="Directory containing ua-file-extract-results-*.json")
    parser.add_argument("service_name", help="Name of the service being analyzed")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument(
        "--project-root",
        help="Project root directory for reading source files (enables Javadoc extraction)",
    )
    args = parser.parse_args()

    proj_root = Path(args.project_root) if args.project_root else None
    result = extract_endpoints_from_dir(
        Path(args.extraction_dir), args.service_name, project_root=proj_root,
    )
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Extracted {len(result['providers'])} providers, "
          f"{len(result['consumers'])} consumers, "
          f"{len(result['kafkaTopics'])} kafka topics for {args.service_name}")
