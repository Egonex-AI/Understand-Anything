#!/usr/bin/env python3
"""
Cross-Service Relationship Matcher

Reads knowledge graphs from multiple integrated services and performs deterministic
matching to identify cross-service call relationships at the interface/method level.

Matching strategies:
1. RPC matching: consumes_rpc edge in service A → provides_rpc edge in service B (by interface name)
2. Event matching: publishes edge in service A → subscribes edge in service B (by topic name)
3. Database matching: writes_to/reads_from edges to same table across services

Usage:
    python cross-service-matcher.py <project_root> --services="svc1 svc2 svc3" --output=<path>

Output: JSON file with candidate cross-service relationships and evidence.
"""

import json
import os
import sys
import argparse
from pathlib import Path
from typing import Any


def load_knowledge_graph(service_root: str) -> dict | None:
    kg_path = os.path.join(service_root, ".understand-anything", "knowledge-graph.json")
    if not os.path.isfile(kg_path):
        return None
    with open(kg_path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_rpc_providers(kg: dict, service_name: str) -> list[dict]:
    """Extract all provides_rpc edges and their associated nodes."""
    providers = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] == "provides_rpc":
            source_node = nodes_by_id.get(edge["source"])
            target_node = nodes_by_id.get(edge["target"])
            if source_node and target_node:
                interface_name = target_node["name"]
                methods = []
                if source_node.get("summary"):
                    # Try to extract method list from summary
                    summary = source_node["summary"]
                    if ":" in summary:
                        method_part = summary.split(":", 1)[1].strip()
                        methods = [
                            m.strip().rstrip(")")
                            for m in method_part.split(",")
                            if m.strip()
                        ]

                providers.append({
                    "service": service_name,
                    "interface": interface_name,
                    "implementor": source_node["name"],
                    "implementor_id": source_node["id"],
                    "file": source_node.get("filePath", ""),
                    "methods": methods,
                })
    return providers


def extract_rpc_consumers(kg: dict, service_name: str) -> list[dict]:
    """Extract all consumes_rpc edges and their associated nodes."""
    consumers = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] == "consumes_rpc":
            source_node = nodes_by_id.get(edge["source"])
            target_node = nodes_by_id.get(edge["target"])
            if source_node and target_node:
                interface_name = target_node["name"]
                consumers.append({
                    "service": service_name,
                    "interface": interface_name,
                    "consumer_class": source_node["name"],
                    "consumer_id": source_node["id"],
                    "file": source_node.get("filePath", ""),
                })
    return consumers


def extract_event_publishers(kg: dict, service_name: str) -> list[dict]:
    """Extract publishes edges (Kafka topics, event bus, etc.)."""
    publishers = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] == "publishes":
            source_node = nodes_by_id.get(edge["source"])
            target_node = nodes_by_id.get(edge["target"])
            if source_node and target_node:
                publishers.append({
                    "service": service_name,
                    "topic": target_node["name"],
                    "publisher_id": source_node["id"],
                    "publisher_name": source_node["name"],
                    "file": source_node.get("filePath", ""),
                })
    return publishers


def extract_event_subscribers(kg: dict, service_name: str) -> list[dict]:
    """Extract subscribes edges."""
    subscribers = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] == "subscribes":
            source_node = nodes_by_id.get(edge["source"])
            target_node = nodes_by_id.get(edge["target"])
            if source_node and target_node:
                subscribers.append({
                    "service": service_name,
                    "topic": target_node["name"],
                    "subscriber_id": source_node["id"],
                    "subscriber_name": source_node["name"],
                    "file": source_node.get("filePath", ""),
                })
    return subscribers


def extract_table_accesses(kg: dict, service_name: str) -> list[dict]:
    """Extract reads_from/writes_to edges to table nodes."""
    accesses = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] in ("reads_from", "writes_to"):
            target_node = nodes_by_id.get(edge["target"])
            if target_node and target_node.get("type") == "table":
                source_node = nodes_by_id.get(edge["source"])
                if source_node:
                    accesses.append({
                        "service": service_name,
                        "table": target_node["name"],
                        "access_type": edge["type"],
                        "accessor_id": source_node["id"],
                        "accessor_name": source_node["name"],
                        "file": source_node.get("filePath", ""),
                    })
    return accesses


def match_rpc_relationships(
    all_providers: list[dict], all_consumers: list[dict]
) -> list[dict]:
    """Match consumer interfaces to provider interfaces across services."""
    relationships = []

    # Build provider index by interface name
    provider_index: dict[str, list[dict]] = {}
    for p in all_providers:
        key = p["interface"]
        provider_index.setdefault(key, []).append(p)

    for consumer in all_consumers:
        interface = consumer["interface"]
        if interface in provider_index:
            for provider in provider_index[interface]:
                # Skip if same service (intra-service call, not cross-service)
                if provider["service"] == consumer["service"]:
                    continue

                relationships.append({
                    "caller": {
                        "service": consumer["service"],
                        "node": consumer["consumer_id"],
                        "file": consumer["file"],
                        "method": f"{consumer['consumer_class']}.*()",
                    },
                    "callee": {
                        "service": provider["service"],
                        "node": provider["implementor_id"],
                        "interface": provider["interface"],
                        "method": f"{provider['implementor']}.*()",
                        "methods": provider.get("methods", []),
                    },
                    "type": "moa_rpc",
                    "evidence": "script-matched",
                    "detail": (
                        f"@MoaConsumer {interface} in {consumer['consumer_class']} "
                        f"({consumer['service']}) matched to @MoaProvider "
                        f"{provider['implementor']} in {provider['service']}"
                    ),
                    "confidence": "high",
                })
    return relationships


def match_event_relationships(
    all_publishers: list[dict], all_subscribers: list[dict]
) -> list[dict]:
    """Match event publishers to subscribers across services by topic name.

    Returns a list of topic-aggregated event flow objects:
    { topic, publisher, subscribers[], evidence, confidence, detail }
    """
    publisher_index: dict[str, list[dict]] = {}
    for p in all_publishers:
        publisher_index.setdefault(p["topic"], []).append(p)

    topic_flows: dict[str, dict] = {}

    for subscriber in all_subscribers:
        topic = subscriber["topic"]
        if topic not in publisher_index:
            continue
        for publisher in publisher_index[topic]:
            if publisher["service"] == subscriber["service"]:
                continue
            key = f"{topic}|||{publisher['service']}"
            if key not in topic_flows:
                topic_flows[key] = {
                    "topic": topic,
                    "publisher": publisher["service"],
                    "subscribers": [],
                    "evidence": "script-matched",
                    "confidence": "high",
                    "detail": (
                        f"Topic '{topic}' published by {publisher['publisher_name']} "
                        f"({publisher['service']})"
                    ),
                }
            sub_svc = subscriber["service"]
            if sub_svc not in topic_flows[key]["subscribers"]:
                topic_flows[key]["subscribers"].append(sub_svc)

    for key, flow in topic_flows.items():
        subs = ", ".join(flow["subscribers"])
        flow["detail"] += f" consumed by {subs}"

    return list(topic_flows.values())


def match_shared_tables(all_accesses: list[dict]) -> list[dict]:
    """Identify tables accessed by multiple services (potential shared-DB pattern)."""
    relationships = []

    table_index: dict[str, list[dict]] = {}
    for access in all_accesses:
        table_index.setdefault(access["table"], []).append(access)

    for table, accesses in table_index.items():
        services = set(a["service"] for a in accesses)
        if len(services) < 2:
            continue

        writers = [a for a in accesses if a["access_type"] == "writes_to"]
        readers = [a for a in accesses if a["access_type"] == "reads_from"]

        for writer in writers:
            for reader in readers:
                if writer["service"] == reader["service"]:
                    continue
                relationships.append({
                    "caller": {
                        "service": writer["service"],
                        "node": writer["accessor_id"],
                        "file": writer["file"],
                        "method": f"{writer['accessor_name']}.write('{table}')",
                    },
                    "callee": {
                        "service": reader["service"],
                        "node": reader["accessor_id"],
                        "file": reader["file"],
                        "method": f"{reader['accessor_name']}.read('{table}')",
                    },
                    "type": "database",
                    "evidence": "script-matched",
                    "detail": (
                        f"Table '{table}' written by {writer['accessor_name']} "
                        f"({writer['service']}), read by {reader['accessor_name']} "
                        f"({reader['service']})"
                    ),
                    "confidence": "medium",
                })
    return relationships


def extract_wrapper_providers(kg: dict, service_name: str) -> list[dict]:
    """
    提取 wrapper 类及其 provides_rpc 的接口。

    Wrapper 类的特征：
    1. 有 consumes_rpc 边指向某个 RPC 接口
    2. 同一服务中有 provides_rpc 边指向同一个接口
    """
    wrappers = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    # 找所有 consumes_rpc 的 source
    rpc_consumers = {}
    for edge in kg.get("edges", []):
        if edge["type"] == "consumes_rpc":
            source_id = edge["source"]
            target_id = edge["target"]
            source_node = nodes_by_id.get(source_id)
            target_node = nodes_by_id.get(target_id)
            if source_node and target_node:
                rpc_consumers[source_id] = {
                    "node": source_node,
                    "interface": target_node["name"],
                    "interface_id": target_id,
                }

    # 找所有 provides_rpc 的 target
    rpc_providers = {}
    for edge in kg.get("edges", []):
        if edge["type"] == "provides_rpc":
            source_id = edge["source"]
            target_id = edge["target"]
            source_node = nodes_by_id.get(source_id)
            target_node = nodes_by_id.get(target_id)
            if source_node and target_node:
                rpc_providers[target_id] = {
                    "node": source_node,
                    "interface": target_node["name"],
                }

    # 匹配：某个类既有 consumes_rpc 又有 provides_rpc 指向同一接口
    for consumer_id, consumer_info in rpc_consumers.items():
        interface_id = consumer_info["interface_id"]
        if interface_id in rpc_providers:
            provider_info = rpc_providers[interface_id]
            wrappers.append({
                "service": service_name,
                "wrapper_class": consumer_info["node"]["name"],
                "wrapper_id": consumer_id,
                "wrapper_file": consumer_info["node"].get("filePath", ""),
                "rpc_interface": consumer_info["interface"],
                "rpc_interface_id": interface_id,
                "provider_class": provider_info["node"]["name"],
                "provider_id": provider_info["node"]["id"],
            })

    return wrappers


def extract_injects(kg: dict, service_name: str) -> list[dict]:
    """
    提取所有 injects 边，表示依赖注入关系。
    """
    injects = []
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge["type"] == "injects":
            source_node = nodes_by_id.get(edge["source"])
            target_node = nodes_by_id.get(edge["target"])
            if source_node and target_node:
                injects.append({
                    "service": service_name,
                    "injector_id": edge["source"],
                    "injector_class": source_node["name"],
                    "injector_file": source_node.get("filePath", ""),
                    "injected_id": edge["target"],
                    "injected_class": target_node["name"],
                })

    return injects


def match_wrapper_rpc_relationships(
    all_wrappers: list[dict],
    all_injects: list[dict]
) -> list[dict]:
    """
    匹配 wrapper 使用关系：如果服务 A 注入了服务 B 的 wrapper 类，则建立跨服务 RPC 关系。
    """
    relationships = []

    # 建立 wrapper 索引：wrapper_class -> wrapper_info
    wrapper_index: dict[str, list[dict]] = {}
    for w in all_wrappers:
        wrapper_index.setdefault(w["wrapper_class"], []).append(w)

    # 检查每个 injects 边
    for inject in all_injects:
        injected_class = inject["injected_class"]

        # 检查被注入的类型是否是某个 wrapper
        if injected_class in wrapper_index:
            for wrapper in wrapper_index[injected_class]:
                # 跳过同服务内的注入
                if inject["service"] == wrapper["service"]:
                    continue

                relationships.append({
                    "caller": {
                        "service": inject["service"],
                        "node": inject["injector_id"],
                        "file": inject["injector_file"],
                        "method": f"{inject['injector_class']} uses {wrapper['wrapper_class']}",
                    },
                    "callee": {
                        "service": wrapper["service"],
                        "node": wrapper["provider_id"],
                        "interface": wrapper["rpc_interface"],
                        "method": f"{wrapper['provider_class']}.*()",
                        "wrapper": wrapper["wrapper_class"],
                    },
                    "type": "moa_rpc_via_wrapper",
                    "evidence": "cross-service-wrapper-injection",
                    "detail": (
                        f"{inject['injector_class']} ({inject['service']}) injects "
                        f"{wrapper['wrapper_class']} from {wrapper['service']}; "
                        f"wrapper consumes {wrapper['rpc_interface']} provided by "
                        f"{wrapper['provider_class']}"
                    ),
                    "confidence": "high",
                })

    return relationships


def main():
    parser = argparse.ArgumentParser(description="Cross-service relationship matcher")
    parser.add_argument("project_root", help="Absolute path to parent project directory")
    parser.add_argument("--services", required=True, help="Space-separated list of service names")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    args = parser.parse_args()

    project_root = args.project_root
    service_names = args.services.split()
    output_path = args.output

    all_providers: list[dict] = []
    all_consumers: list[dict] = []
    all_publishers: list[dict] = []
    all_subscribers: list[dict] = []
    all_table_accesses: list[dict] = []
    all_wrappers: list[dict] = []
    all_injects: list[dict] = []
    services_loaded = []

    for svc_name in service_names:
        svc_root = os.path.join(project_root, svc_name)
        kg = load_knowledge_graph(svc_root)
        if kg is None:
            print(f"Warning: No knowledge graph found for '{svc_name}', skipping.", file=sys.stderr)
            continue

        services_loaded.append(svc_name)
        all_providers.extend(extract_rpc_providers(kg, svc_name))
        all_consumers.extend(extract_rpc_consumers(kg, svc_name))
        all_publishers.extend(extract_event_publishers(kg, svc_name))
        all_subscribers.extend(extract_event_subscribers(kg, svc_name))
        all_table_accesses.extend(extract_table_accesses(kg, svc_name))
        all_wrappers.extend(extract_wrapper_providers(kg, svc_name))
        all_injects.extend(extract_injects(kg, svc_name))

    # Perform matching
    rpc_rels = match_rpc_relationships(all_providers, all_consumers)
    event_rels = match_event_relationships(all_publishers, all_subscribers)
    table_rels = match_shared_tables(all_table_accesses)
    wrapper_rels = match_wrapper_rpc_relationships(all_wrappers, all_injects)

    result = {
        "scriptCompleted": True,
        "servicesAnalyzed": services_loaded,
        "relationships": rpc_rels + table_rels + wrapper_rels,
        "eventFlows": event_rels,
        "stats": {
            "rpcMatches": len(rpc_rels),
            "eventMatches": len(event_rels),
            "sharedTableMatches": len(table_rels),
            "wrapperRpcMatches": len(wrapper_rels),
            "totalRelationships": len(rpc_rels) + len(event_rels) + len(table_rels) + len(wrapper_rels),
            "providersFound": len(all_providers),
            "consumersFound": len(all_consumers),
            "publishersFound": len(all_publishers),
            "subscribersFound": len(all_subscribers),
            "wrappersFound": len(all_wrappers),
            "injectsFound": len(all_injects),
        },
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Cross-service matcher complete.")
    print(f"  Services analyzed: {len(services_loaded)}")
    print(f"  RPC matches: {len(rpc_rels)}")
    print(f"  Event matches: {len(event_rels)}")
    print(f"  Shared table matches: {len(table_rels)}")
    print(f"  Wrapper RPC matches: {len(wrapper_rels)}")
    print(f"  Total relationships: {len(rpc_rels) + len(event_rels) + len(table_rels) + len(wrapper_rels)}")


if __name__ == "__main__":
    main()
