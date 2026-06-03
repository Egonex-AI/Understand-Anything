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
import sys
from typing import Any


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


def main() -> None:
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <wiki_dir> <dg_path> <service_root> [output_path]")
        sys.exit(1)

    wiki_dir = sys.argv[1]
    dg_path = sys.argv[2]
    service_root = sys.argv[3]
    output_path = sys.argv[4] if len(sys.argv) > 4 else None

    result = run_quality_gate(wiki_dir, dg_path, service_root, output_path)

    if result["passed"]:
        print(f"[wiki-quality-gate] PASSED — {result['stats']['coveragePercent']}% coverage")
    else:
        print(f"[wiki-quality-gate] FAILED — {len(result['issues'])} issue(s)")
        for issue in result["issues"]:
            print(f"  ERROR: {issue}")
    for w in result["warnings"]:
        print(f"  WARN: {w}")

    sys.exit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
