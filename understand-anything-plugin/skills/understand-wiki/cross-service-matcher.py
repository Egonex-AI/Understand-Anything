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

    # Perform matching
    rpc_rels = match_rpc_relationships(all_providers, all_consumers)
    event_rels = match_event_relationships(all_publishers, all_subscribers)
    table_rels = match_shared_tables(all_table_accesses)

    result = {
        "scriptCompleted": True,
        "servicesAnalyzed": services_loaded,
        "relationships": rpc_rels + table_rels,
        "eventFlows": event_rels,
        "stats": {
            "rpcMatches": len(rpc_rels),
            "eventMatches": len(event_rels),
            "sharedTableMatches": len(table_rels),
            "totalRelationships": len(rpc_rels) + len(event_rels) + len(table_rels),
            "providersFound": len(all_providers),
            "consumersFound": len(all_consumers),
            "publishersFound": len(all_publishers),
            "subscribersFound": len(all_subscribers),
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
    print(f"  Total relationships: {len(all_relationships)}")


if __name__ == "__main__":
    main()
