"""Deterministic wiki index builder.

Scans intermediate wiki directory and computes index.json from actual files.
Replaces LLM-generated index with a deterministic, file-grounded index.

Usage:
    python build-wiki-index.py <wiki_dir> [--parent] [--service-name=<name>]
"""

import json
import os
import re
import sys


def to_kebab_case(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def build_service_index(wiki_dir: str, service_name: str) -> dict:
    entries = []

    service_path = os.path.join(wiki_dir, "service.json")
    if os.path.exists(service_path):
        with open(service_path) as f:
            svc = json.load(f)
        entries.append({
            "id": "wiki:service-overview",
            "name": svc.get("name", service_name),
            "type": "service",
            "summary": _truncate(svc.get("description", ""), 100),
        })

    domain_dir = os.path.join(wiki_dir, "domains")
    if os.path.isdir(domain_dir):
        domain_files = sorted(
            f for f in os.listdir(domain_dir) if f.endswith(".json")
        )

        for df in domain_files:
            slug = df.removesuffix(".json")
            domain_id = f"wiki:domain:{slug}"
            with open(os.path.join(domain_dir, df)) as f:
                page = json.load(f)

            entries.append({
                "id": domain_id,
                "name": page.get("name", slug),
                "type": "domain",
                "service": service_name,
                "summary": _truncate(page.get("summary", ""), 100),
            })

            for flow in page.get("flows", []):
                flow_id = flow.get("id", f"flow:{to_kebab_case(flow.get('name', ''))}")
                entries.append({
                    "id": f"wiki:{flow_id}" if not flow_id.startswith("wiki:") else flow_id,
                    "name": flow.get("name", flow_id),
                    "type": "flow",
                    "service": service_name,
                    "domain": domain_id,
                    "summary": _truncate(flow.get("summary", ""), 100),
                })

    endpoints_path = os.path.join(wiki_dir, "endpoints", f"{service_name}.json")
    if os.path.exists(endpoints_path):
        with open(endpoints_path) as f:
            doc = json.load(f)
        entries.append({
            "id": f"wiki:endpoints:{service_name}",
            "name": f"{service_name} Endpoints",
            "type": "endpoint",
            "summary": _truncate(doc.get("description", ""), 100),
            "service": service_name,
            "tags": list(set(p.get("protocol", "") for p in doc.get("providers", []))),
        })

    return {"entries": entries}


def build_parent_index(wiki_dir: str) -> dict:
    entries = []

    overview_path = os.path.join(wiki_dir, "overview.json")
    if os.path.exists(overview_path):
        with open(overview_path) as f:
            data = json.load(f)
        entries.append({
            "id": "wiki:overview",
            "name": data.get("name", "System Overview"),
            "type": "overview",
            "summary": _truncate(data.get("description", ""), 100),
        })

    arch_path = os.path.join(wiki_dir, "architecture.json")
    if os.path.exists(arch_path):
        entries.append({
            "id": "wiki:architecture",
            "name": "System Architecture",
            "type": "architecture",
            "summary": "Cross-service call topology and shared resources",
        })

    domain_dir = os.path.join(wiki_dir, "domains")
    if os.path.isdir(domain_dir):
        for df in sorted(os.listdir(domain_dir)):
            if not df.endswith(".json"):
                continue
            slug = df.removesuffix(".json")
            with open(os.path.join(domain_dir, df)) as f:
                page = json.load(f)
            entries.append({
                "id": f"wiki:cross-domain:{slug}",
                "name": page.get("name", slug),
                "type": "cross-domain",
                "summary": _truncate(page.get("summary", ""), 100),
            })

    endpoint_index_path = os.path.join(wiki_dir, "endpoints", "index.json")
    if os.path.exists(endpoint_index_path):
        with open(endpoint_index_path) as f:
            endpoint_index = json.load(f)
        total_providers = endpoint_index.get("totalProviders", 0)
        total_consumers = endpoint_index.get("totalConsumers", 0)
        entries.append({
            "id": "wiki:endpoints:index",
            "name": "Endpoint Index",
            "type": "endpoint",
            "summary": (
                f"Cross-service endpoint navigation ({total_providers} providers, "
                f"{total_consumers} consumers)"
            ),
        })

    return {"entries": entries}


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def main() -> None:
    args = sys.argv[1:]
    is_parent = "--parent" in args
    svc_arg = next((a for a in args if a.startswith("--service-name=")), None)
    service_name = svc_arg.split("=")[1] if svc_arg else "unknown-service"
    wiki_dir = next((a for a in args if not a.startswith("--")), None)

    if not wiki_dir:
        print("Usage: python build-wiki-index.py <wiki_dir> [--parent] [--service-name=<name>]")
        sys.exit(1)

    if is_parent:
        index = build_parent_index(wiki_dir)
    else:
        index = build_service_index(wiki_dir, service_name)

    output_path = os.path.join(wiki_dir, "index.json")
    with open(output_path, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(f"[build-wiki-index] Generated {len(index['entries'])} entries → {output_path}")


if __name__ == "__main__":
    main()
