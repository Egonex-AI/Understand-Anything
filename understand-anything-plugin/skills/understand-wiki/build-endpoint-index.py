"""Aggregate per-service endpoint docs into a navigation index.

Reads endpoints/<service>.json files and produces endpoints/index.json
grouped by service, protocol, and Kafka topic.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def build_endpoint_index(wiki_dir: str) -> dict[str, Any]:
    """Scan wiki_dir/endpoints/*.json and aggregate into an index.

    Args:
        wiki_dir: Path to the .understand-anything/wiki directory

    Returns:
        Index dict with byService, byProtocol, and byTopic groupings
    """
    endpoints_dir = Path(wiki_dir) / "endpoints"
    service_docs: list[dict[str, Any]] = []

    if endpoints_dir.is_dir():
        for path in sorted(endpoints_dir.glob("*.json")):
            if path.name == "index.json":
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                service_docs.append(data)

    total_providers = 0
    total_consumers = 0
    total_kafka_topics = 0
    by_service: list[dict[str, Any]] = []
    by_protocol: dict[str, list[dict[str, Any]]] = {}
    by_topic: dict[str, dict[str, list[str]]] = {}

    for doc in sorted(service_docs, key=lambda d: d.get("service", "")):
        service = doc.get("service", "")
        description = doc.get("description", "")
        providers = doc.get("providers", [])
        consumers = doc.get("consumers", [])
        kafka_topics = doc.get("kafkaTopics", [])

        if not isinstance(providers, list):
            providers = []
        if not isinstance(consumers, list):
            consumers = []
        if not isinstance(kafka_topics, list):
            kafka_topics = []

        provider_count = len(providers)
        consumer_count = len(consumers)
        kafka_topic_count = len(kafka_topics)

        total_providers += provider_count
        total_consumers += consumer_count
        total_kafka_topics += kafka_topic_count

        protocols: set[str] = set()
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            protocol = provider.get("protocol", "unknown")
            protocols.add(protocol)
            methods = provider.get("methods", [])
            if not isinstance(methods, list):
                methods = []
            entry = {
                "service": service,
                "identifier": provider.get("identifier", ""),
                "methodCount": len(methods),
            }
            by_protocol.setdefault(protocol, []).append(entry)

        for consumer in consumers:
            if not isinstance(consumer, dict):
                continue
            protocols.add(consumer.get("protocol", "unknown"))

        for topic_entry in kafka_topics:
            if not isinstance(topic_entry, dict):
                continue
            topic = topic_entry.get("topic", "")
            if not topic:
                continue
            role = topic_entry.get("role", "")
            bucket = by_topic.setdefault(topic, {"publishers": [], "subscribers": []})
            if role == "publisher":
                bucket["publishers"].append(service)
            elif role == "subscriber":
                bucket["subscribers"].append(service)

        by_service.append({
            "service": service,
            "description": description,
            "providerCount": provider_count,
            "consumerCount": consumer_count,
            "kafkaTopicCount": kafka_topic_count,
            "protocols": sorted(protocols),
        })

    for protocol in by_protocol:
        by_protocol[protocol].sort(
            key=lambda e: (e.get("service", ""), e.get("identifier", "")),
        )

    sorted_by_protocol = {k: by_protocol[k] for k in sorted(by_protocol)}

    sorted_by_topic: dict[str, dict[str, list[str]]] = {}
    for topic in sorted(by_topic):
        entry = by_topic[topic]
        sorted_by_topic[topic] = {
            "publishers": sorted(set(entry["publishers"])),
            "subscribers": sorted(set(entry["subscribers"])),
        }

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalProviders": total_providers,
        "totalConsumers": total_consumers,
        "totalKafkaTopics": total_kafka_topics,
        "byService": by_service,
        "byProtocol": sorted_by_protocol,
        "byTopic": sorted_by_topic,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build endpoint navigation index from per-service endpoint docs",
    )
    parser.add_argument(
        "--wiki-dir",
        required=True,
        help="Path to the .understand-anything/wiki directory",
    )
    args = parser.parse_args()

    wiki_dir = Path(args.wiki_dir)
    index = build_endpoint_index(str(wiki_dir))

    output_path = wiki_dir / "endpoints" / "index.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
