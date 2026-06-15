"""Wiki Quality Gate — Layer 1 Automatic Structural Validation.

Validates a service wiki directory against its domain-graph, checking:
- meta.json required fields
- index.json non-empty entries
- service.json name and description
- Domain coverage (domain-graph nodes vs wiki domain files)
- Domain page content quality (flows, steps, descriptions)
- Content depth scoring (summary length, sourceRef coverage, depth indicators)
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
        summary_len = len(summary)
        if not summary or summary_len < 10:
            issues.append(f"domains/{file}: summary is empty or too short")
        elif summary_len < 50:
            issues.append(
                f"domains/{file}: summary too shallow ({summary_len} chars, need >= 50)"
            )
        elif summary_len < 80:
            warnings.append(
                f"domains/{file}: summary could be deeper ({summary_len} chars, target >= 80)"
            )

        flows = page.get("flows", [])
        if not isinstance(flows, list) or len(flows) == 0:
            issues.append(f"domains/{file}: no flows defined")
            continue

        total_steps = 0
        steps_with_source_ref = 0

        for i, flow in enumerate(flows):
            flow_summary = str(flow.get("summary", ""))
            if len(flow_summary) < 20:
                issues.append(
                    f"domains/{file}: flow '{flow.get('name', i)}' summary too shallow ({len(flow_summary)} chars)"
                )
            elif len(flow_summary) < 40:
                warnings.append(
                    f"domains/{file}: flow '{flow.get('name', i)}' summary could be deeper ({len(flow_summary)} chars)"
                )

            steps = flow.get("steps", [])
            if not isinstance(steps, list) or len(steps) == 0:
                warnings.append(
                    f"domains/{file}: flow '{flow.get('name', i)}' has no steps"
                )
            else:
                for j, step in enumerate(steps):
                    total_steps += 1
                    desc = step.get("description", "")
                    desc_len = len(desc)
                    if not desc or desc_len < 5:
                        issues.append(
                            f"domains/{file}: flow[{i}].step[{j}] has empty description"
                        )
                    elif desc_len < 10:
                        issues.append(
                            f"domains/{file}: flow[{i}].step[{j}] description too shallow ({desc_len} chars)"
                        )
                    elif desc_len < 30:
                        warnings.append(
                            f"domains/{file}: flow[{i}].step[{j}] description could be deeper ({desc_len} chars)"
                        )

                    source_ref = step.get("sourceRef")
                    if source_ref and source_ref.get("file"):
                        steps_with_source_ref += 1
                        ref_path = os.path.join(service_root, source_ref["file"])
                        if not os.path.exists(ref_path):
                            warnings.append(
                                f"domains/{file}: sourceRef '{source_ref['file']}' does not exist"
                            )

        # sourceRef coverage — blocking if below 30%
        if total_steps > 0:
            coverage = steps_with_source_ref / total_steps
            if coverage < 0.3:
                issues.append(
                    f"domains/{file}: sourceRef coverage {coverage:.0%} (need >= 30%)"
                )
            elif coverage < 0.5:
                warnings.append(
                    f"domains/{file}: sourceRef coverage {coverage:.0%} (target >= 50%)"
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

    # Mobile schema validation (featureParity, sharedInfrastructure, nativeBridge)
    feature_parity = arch.get("featureParity")
    if isinstance(feature_parity, list):
        if len(feature_parity) == 0:
            warnings.append("architecture.json: featureParity is empty")
        for i, fp in enumerate(feature_parity):
            if not isinstance(fp, dict):
                issues.append(f"architecture.json: featureParity[{i}] is not an object")
                continue
            if not fp.get("feature"):
                issues.append(f"architecture.json: featureParity[{i}] missing 'feature' field")
            if not isinstance(fp.get("platforms"), dict):
                issues.append(f"architecture.json: featureParity[{i}] missing 'platforms' dict")
    elif feature_parity is not None:
        issues.append("architecture.json: featureParity must be an array if present")

    shared_infra = arch.get("sharedInfrastructure")
    if isinstance(shared_infra, list) and len(shared_infra) == 0:
        warnings.append("architecture.json: sharedInfrastructure is empty")
    elif shared_infra is not None and not isinstance(shared_infra, list):
        issues.append("architecture.json: sharedInfrastructure must be an array if present")

    native_bridge = arch.get("nativeBridge")
    if isinstance(native_bridge, list) and len(native_bridge) == 0:
        warnings.append("architecture.json: nativeBridge is empty")
    elif native_bridge is not None and not isinstance(native_bridge, list):
        issues.append("architecture.json: nativeBridge must be an array if present")


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
