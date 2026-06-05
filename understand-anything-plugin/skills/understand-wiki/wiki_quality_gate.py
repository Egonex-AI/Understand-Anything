"""Wiki Quality Gate — Layer 1 Automatic Structural Validation.

Validates a service wiki directory against its domain-graph, checking:
- meta.json required fields
- index.json non-empty entries
- service.json name and description
- Domain coverage (domain-graph nodes vs wiki domain files)
- Domain page content quality (flows, steps, descriptions)
- Source reference file existence

Usage:
    python wiki_quality_gate.py <wiki_dir> <dg_path> <service_root> [output_path]
"""

import json
import os
import re
import sys
from typing import Any

WIKIREF_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9._-]*/domains/[a-z0-9][a-z0-9._-]*(#(flow|step):[a-z0-9._-]+)?$",
    re.IGNORECASE,
)


def run_quality_gate(
    wiki_dir: str,
    dg_path: str,
    service_root: str,
    output_path: str | None = None,
) -> dict[str, Any]:
    """Run structural validation on a wiki directory.

    Returns a dict with keys: passed, issues, warnings, stats.
    """
    issues: list[str] = []
    warnings: list[str] = []

    meta_path = os.path.join(wiki_dir, "meta.json")
    index_path = os.path.join(wiki_dir, "index.json")
    service_path = os.path.join(wiki_dir, "service.json")
    domain_dir = os.path.join(wiki_dir, "domains")

    meta = _load_json(meta_path)
    index = _load_json(index_path)
    service = _load_json(service_path)
    dg = _load_json(dg_path)

    _validate_meta(meta, issues)
    _validate_index(index, issues)
    _validate_service(service, issues)

    dg_domains = [
        n["id"].replace("domain:", "")
        for n in dg.get("nodes", [])
        if n.get("type") == "domain"
    ]
    domain_files = _list_domain_files(domain_dir)

    _check_coverage(dg_domains, domain_files, issues)
    _check_domain_pages(domain_dir, domain_files, service_root, issues, warnings)

    stats = {
        "domainsCovered": len(domain_files),
        "domainsExpected": len(dg_domains),
        "coveragePercent": (
            round(len(domain_files) / len(dg_domains) * 100)
            if dg_domains
            else 100
        ),
    }

    result = {
        "passed": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "stats": stats,
    }

    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)

    return result


def _load_json(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def _validate_meta(meta: dict, issues: list[str]) -> None:
    for field in ("gitCommitHash", "generatedAt", "version", "outputLanguage"):
        if not meta.get(field):
            issues.append(f"meta.json: missing {field}")


def _validate_index(index: dict, issues: list[str]) -> None:
    entries = index.get("entries")
    if not isinstance(entries, list) or len(entries) == 0:
        issues.append("index.json: entries is empty or not an array")
        return
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        entry_type = entry.get("type")
        if entry_type == "domain" and not entry.get("service"):
            issues.append(f"index.json: entries[{i}] (domain) missing 'service' field")
        if entry_type == "flow":
            if not entry.get("service"):
                issues.append(f"index.json: entries[{i}] (flow) missing 'service' field")
            if not entry.get("domain"):
                issues.append(f"index.json: entries[{i}] (flow) missing 'domain' field")


def _validate_service(service: dict, issues: list[str]) -> None:
    if not service.get("name"):
        issues.append("service.json: missing name")
    desc = service.get("description", "")
    if not desc or len(desc) < 10:
        issues.append("service.json: description is missing or too short")


def _list_domain_files(domain_dir: str) -> list[str]:
    if not os.path.exists(domain_dir):
        return []
    return [f for f in os.listdir(domain_dir) if f.endswith(".json")]


def _check_coverage(
    dg_domains: list[str], domain_files: list[str], issues: list[str]
) -> None:
    existing = {f.removesuffix(".json") for f in domain_files}
    for slug in dg_domains:
        if slug not in existing:
            issues.append(
                f"Coverage: domain '{slug}' has no wiki page "
                f"(expected domains/{slug}.json)"
            )


def _check_domain_pages(
    domain_dir: str,
    domain_files: list[str],
    service_root: str,
    issues: list[str],
    warnings: list[str],
) -> None:
    for file in domain_files:
        page = _load_json(os.path.join(domain_dir, file))
        summary = page.get("summary", "")
        if not summary or len(summary) < 10:
            warnings.append(f"domains/{file}: summary is empty or too short")

        flows = page.get("flows", [])
        if not isinstance(flows, list) or len(flows) == 0:
            issues.append(f"domains/{file}: no flows defined")
            continue

        for i, flow in enumerate(flows):
            steps = flow.get("steps", [])
            if not isinstance(steps, list) or len(steps) == 0:
                warnings.append(
                    f"domains/{file}: flow '{flow.get('name', i)}' has no steps"
                )
            else:
                for j, step in enumerate(steps):
                    desc = step.get("description", "")
                    if not desc or len(desc) < 5:
                        warnings.append(
                            f"domains/{file}: flow[{i}].step[{j}] has empty description"
                        )
                    source_ref = step.get("sourceRef")
                    if source_ref and source_ref.get("file"):
                        ref_path = os.path.join(service_root, source_ref["file"])
                        if not os.path.exists(ref_path):
                            warnings.append(
                                f"domains/{file}: sourceRef '{source_ref['file']}' does not exist"
                            )


def run_parent_quality_gate(
    wiki_dir: str,
    output_path: str | None = None,
) -> dict[str, Any]:
    """Run structural validation on a parent-level wiki directory.

    Validates overview.json, architecture.json, and cross-domain pages.
    """
    issues: list[str] = []
    warnings: list[str] = []

    overview = _load_json(os.path.join(wiki_dir, "overview.json"))
    arch = _load_json(os.path.join(wiki_dir, "architecture.json"))
    index = _load_json(os.path.join(wiki_dir, "index.json"))
    meta = _load_json(os.path.join(wiki_dir, "meta.json"))

    _validate_meta(meta, issues)
    _validate_index(index, issues)
    _validate_parent_overview(overview, issues, warnings)
    _validate_parent_architecture(arch, issues, warnings)

    domain_dir = os.path.join(wiki_dir, "domains")
    domain_files = _list_domain_files(domain_dir)
    _validate_cross_domain_pages(domain_dir, domain_files, issues, warnings)

    stats = {
        "overviewValid": bool(overview and overview.get("name")),
        "architectureValid": bool(arch and isinstance(arch.get("crossServiceCalls"), list)),
        "crossDomainPages": len(domain_files),
    }

    result = {
        "passed": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "stats": stats,
    }

    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)

    return result


def _validate_parent_overview(
    overview: dict, issues: list[str], warnings: list[str]
) -> None:
    if not overview:
        issues.append("overview.json: missing or empty")
        return
    if not overview.get("name"):
        issues.append("overview.json: missing name")
    if not overview.get("description"):
        issues.append("overview.json: missing description")
    services = overview.get("services")
    if not isinstance(services, list) or len(services) == 0:
        issues.append("overview.json: missing or empty services array")
    else:
        for i, svc in enumerate(services):
            if not isinstance(svc, dict):
                issues.append(f"overview.json: services[{i}] is not an object")
                continue
            if not svc.get("name"):
                issues.append(f"overview.json: services[{i}] missing name")
            if not svc.get("description"):
                warnings.append(f"overview.json: services[{i}] missing description")
            if not isinstance(svc.get("domains"), list):
                warnings.append(f"overview.json: services[{i}] missing domains array")


def _validate_parent_architecture(
    arch: dict, issues: list[str], warnings: list[str]
) -> None:
    if not arch:
        warnings.append("architecture.json: missing or empty")
        return
    if not isinstance(arch.get("crossServiceCalls"), list):
        warnings.append("architecture.json: missing crossServiceCalls array")
    else:
        for i, call in enumerate(arch["crossServiceCalls"]):
            if not isinstance(call, dict):
                issues.append(f"architecture.json: crossServiceCalls[{i}] is not an object")
                continue
            if not isinstance(call.get("caller"), dict):
                issues.append(f"architecture.json: crossServiceCalls[{i}] missing caller")
            if not isinstance(call.get("callee"), dict):
                issues.append(f"architecture.json: crossServiceCalls[{i}] missing callee")
            if not call.get("type"):
                issues.append(f"architecture.json: crossServiceCalls[{i}] missing type")

    if not isinstance(arch.get("eventFlows"), list):
        warnings.append("architecture.json: missing eventFlows array")
    else:
        for i, ev in enumerate(arch["eventFlows"]):
            if not isinstance(ev, dict):
                issues.append(f"architecture.json: eventFlows[{i}] is not an object")
                continue
            if ev.get("caller") or ev.get("callee"):
                issues.append(
                    f"architecture.json: eventFlows[{i}] must use topic/publisher/subscribers, not caller/callee"
                )
            if not ev.get("topic"):
                issues.append(f"architecture.json: eventFlows[{i}] missing topic")
            if not ev.get("publisher"):
                issues.append(f"architecture.json: eventFlows[{i}] missing publisher")
            if not isinstance(ev.get("subscribers"), list) or not ev.get("subscribers"):
                issues.append(
                    f"architecture.json: eventFlows[{i}] missing non-empty subscribers array"
                )


def _validate_cross_domain_pages(
    domain_dir: str,
    domain_files: list[str],
    issues: list[str],
    warnings: list[str],
) -> None:
    for file in domain_files:
        page = _load_json(os.path.join(domain_dir, file))
        if not page:
            issues.append(f"domains/{file}: missing or invalid JSON")
            continue
        if not page.get("name"):
            issues.append(f"domains/{file}: missing name")
        if not page.get("summary"):
            warnings.append(f"domains/{file}: missing summary")
        services = page.get("services")
        if not isinstance(services, list) or len(services) == 0:
            issues.append(f"domains/{file}: missing or empty services array")
        steps = page.get("steps")
        if not isinstance(steps, list):
            issues.append(f"domains/{file}: missing steps array")
        else:
            for i, step in enumerate(steps):
                if not isinstance(step, dict):
                    issues.append(f"domains/{file}: steps[{i}] is not an object")
                    continue
                if not isinstance(step.get("order"), (int, float)):
                    warnings.append(f"domains/{file}: steps[{i}] missing order")
                if not step.get("service"):
                    issues.append(f"domains/{file}: steps[{i}] missing service")
                wiki_ref = step.get("wikiRef")
                if wiki_ref:
                    if wiki_ref.startswith("wiki://") or wiki_ref.startswith("source://"):
                        warnings.append(
                            f"domains/{file}: steps[{i}] wikiRef should not have protocol prefix"
                        )
                    elif ".json" in wiki_ref:
                        warnings.append(
                            f"domains/{file}: steps[{i}] wikiRef should not contain .json extension"
                        )
                    elif not WIKIREF_PATTERN.match(wiki_ref):
                        warnings.append(
                            f"domains/{file}: steps[{i}] wikiRef '{wiki_ref}' does not match canonical format"
                        )
                if not step.get("description"):
                    warnings.append(f"domains/{file}: steps[{i}] missing description")


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <wiki_dir> <dg_path> <service_root> [output_path]")
        print(f"       {sys.argv[0]} --parent <wiki_dir> [output_path]")
        sys.exit(1)

    if sys.argv[1] == "--parent":
        wiki_dir = sys.argv[2]
        output_path = sys.argv[3] if len(sys.argv) > 3 else None
        result = run_parent_quality_gate(wiki_dir, output_path)
    else:
        if len(sys.argv) < 4:
            print(f"Usage: {sys.argv[0]} <wiki_dir> <dg_path> <service_root> [output_path]")
            sys.exit(1)
        wiki_dir = sys.argv[1]
        dg_path = sys.argv[2]
        service_root = sys.argv[3]
        output_path = sys.argv[4] if len(sys.argv) > 4 else None
        result = run_quality_gate(wiki_dir, dg_path, service_root, output_path)

    if result["passed"]:
        print(f"[wiki-quality-gate] PASSED")
    else:
        print(f"[wiki-quality-gate] FAILED — {len(result['issues'])} issue(s)")
        for issue in result["issues"]:
            print(f"  ERROR: {issue}")
    for w in result["warnings"]:
        print(f"  WARN: {w}")

    sys.exit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
