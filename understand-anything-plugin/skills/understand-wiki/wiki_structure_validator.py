"""Wiki Structure Validator — structural and content depth validation.

Validates that a service wiki directory has the expected layout, that each
JSON file is well-formed, and that content meets minimum depth thresholds
comparable to human-authored business/technical documentation.

Usage:
    python wiki_structure_validator.py <wiki_dir> [dg_path]
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any


REQUIRED_TOP_LEVEL = ("meta.json", "index.json", "service.json")
META_FIELDS = ("gitCommitHash", "generatedAt", "version", "outputLanguage")
MIN_DESCRIPTION_LEN = 10
MIN_SUMMARY_LEN = 10

DEPTH_THRESHOLDS = {
    "domain_summary_warn": 80,
    "domain_summary_fail": 50,
    "flow_summary_warn": 40,
    "flow_summary_fail": 20,
    "step_description_warn": 30,
    "step_description_fail": 10,
    "source_ref_coverage_warn": 0.5,
    "source_ref_coverage_fail": 0.3,
    "depth_indicator_target": 0.3,
}

DEPTH_KEYWORDS_EN = re.compile(
    r"\b(validat|check|verify|if\s|exception|error|throw|fail|rule|constraint|"
    r"side.?effect|publish|emit|event|insert|update|delete|persist|cache|notify|"
    r"return|parameter|rollback)\b",
    re.IGNORECASE,
)
DEPTH_KEYWORDS_ZH = re.compile(
    r"(验证|校验|检查|异常|错误|抛出|失败|规则|约束|副作用|发布|事件|"
    r"插入|更新|删除|持久化|缓存|通知|返回|参数|回滚)",
)


def validate_wiki_structure(
    wiki_dir: str,
    dg_path: str | None = None,
) -> dict[str, Any]:
    """Validate wiki directory structure and JSON shape.

    Returns dict with keys: valid, missing_files, malformed_files, warnings, issues.
    """
    missing_files: list[str] = []
    malformed_files: list[dict[str, Any]] = []
    warnings: list[str] = []
    issues: list[str] = []

    for filename in REQUIRED_TOP_LEVEL:
        if not os.path.isfile(os.path.join(wiki_dir, filename)):
            missing_files.append(filename)
            issues.append(f"Missing required file: {filename}")

    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        missing_files.append("domains/")
        issues.append("Missing required directory: domains/")
        domain_files: list[str] = []
    else:
        domain_files = sorted(f for f in os.listdir(domain_dir) if f.endswith(".json"))
        if len(domain_files) == 0:
            issues.append("domains/: no domain JSON files found")

    meta = _load_json(os.path.join(wiki_dir, "meta.json"))
    index = _load_json(os.path.join(wiki_dir, "index.json"))
    service = _load_json(os.path.join(wiki_dir, "service.json"))

    _validate_meta(meta, malformed_files, issues, warnings)
    _validate_index(index, malformed_files, issues)
    _validate_service(service, malformed_files, issues)

    for filename in domain_files:
        page_path = os.path.join(domain_dir, filename)
        page = _load_json(page_path)
        page_issues = _validate_domain_page(page, filename)
        if page_issues:
            malformed_files.append({"file": f"domains/{filename}", "errors": page_issues})
            issues.extend(f"domains/{filename}: {err}" for err in page_issues)

    if dg_path and os.path.isfile(dg_path):
        dg = _load_json(dg_path)
        dg_domains = [
            n["id"].replace("domain:", "")
            for n in dg.get("nodes", [])
            if n.get("type") == "domain"
        ]
        existing = {f.removesuffix(".json") for f in domain_files}
        for slug in dg_domains:
            if slug not in existing:
                missing_files.append(f"domains/{slug}.json")
                issues.append(
                    f"Coverage: domain '{slug}' has no wiki page "
                    f"(expected domains/{slug}.json)"
                )
    elif dg_path:
        issues.append(f"domain-graph not found: {dg_path}")

    valid = len(issues) == 0
    return {
        "valid": valid,
        "missing_files": missing_files,
        "malformed_files": malformed_files,
        "warnings": warnings,
        "issues": issues,
    }


def _load_json(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _validate_meta(
    meta: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
    warnings: list[str],
) -> None:
    if not meta:
        return
    errors: list[str] = []
    for field in META_FIELDS:
        if not meta.get(field):
            errors.append(f"missing {field}")
    if errors:
        malformed_files.append({"file": "meta.json", "errors": errors})
        issues.extend(f"meta.json: {err}" for err in errors)


def _validate_index(
    index: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
) -> None:
    if not index:
        return
    errors: list[str] = []
    entries = index.get("entries")
    if not isinstance(entries, list):
        errors.append("entries is not an array")
    elif len(entries) == 0:
        errors.append("entries is empty")
    if errors:
        malformed_files.append({"file": "index.json", "errors": errors})
        issues.extend(f"index.json: {err}" for err in errors)


def _validate_service(
    service: dict,
    malformed_files: list[dict[str, Any]],
    issues: list[str],
) -> None:
    if not service:
        return
    errors: list[str] = []
    if not service.get("name"):
        errors.append("missing name")
    desc = service.get("description", "")
    if not desc or len(str(desc)) < MIN_DESCRIPTION_LEN:
        errors.append("description is missing or too short")
    if errors:
        malformed_files.append({"file": "service.json", "errors": errors})
        issues.extend(f"service.json: {err}" for err in errors)


def _validate_domain_page(page: dict, filename: str) -> list[str]:
    errors: list[str] = []
    if not page:
        return [f"domains/{filename} is missing or invalid JSON"]

    for field in ("id", "name", "summary"):
        if not page.get(field):
            errors.append(f"missing {field}")

    summary = page.get("summary", "")
    if summary and len(str(summary)) < MIN_SUMMARY_LEN:
        errors.append("summary is too short")

    flows = page.get("flows")
    if not isinstance(flows, list) or len(flows) == 0:
        errors.append("no flows defined")
        return errors

    for i, flow in enumerate(flows):
        if not isinstance(flow, dict):
            errors.append(f"flows[{i}] is not an object")
            continue
        if not flow.get("name") and not flow.get("id"):
            errors.append(f"flows[{i}] missing name or id")
        steps = flow.get("steps")
        if not isinstance(steps, list) or len(steps) == 0:
            errors.append(f"flows[{i}] has no steps")
            continue
        for j, step in enumerate(steps):
            if not isinstance(step, dict):
                errors.append(f"flows[{i}].steps[{j}] is not an object")
                continue
            if not step.get("description"):
                errors.append(f"flows[{i}].steps[{j}] missing description")

    return errors


def _check_content_depth(page: dict, filename: str) -> dict[str, Any]:
    """Check content depth metrics for a domain page.

    Returns a dict with depthScore, individual metrics, and warnings.
    """
    metrics: dict[str, Any] = {}
    depth_warnings: list[str] = []
    depth_issues: list[str] = []

    summary = str(page.get("summary", ""))
    summary_len = len(summary)
    metrics["domainSummaryLen"] = summary_len
    if summary_len < DEPTH_THRESHOLDS["domain_summary_fail"]:
        depth_issues.append(
            f"domains/{filename}: domain summary too shallow ({summary_len} chars, need >= {DEPTH_THRESHOLDS['domain_summary_fail']})"
        )
    elif summary_len < DEPTH_THRESHOLDS["domain_summary_warn"]:
        depth_warnings.append(
            f"domains/{filename}: domain summary could be deeper ({summary_len} chars, target >= {DEPTH_THRESHOLDS['domain_summary_warn']})"
        )

    entities = page.get("entities", [])
    entity_count = len(entities) if isinstance(entities, list) else 0
    entity_with_desc = 0
    if isinstance(entities, list):
        for e in entities:
            if isinstance(e, dict) and len(str(e.get("description", ""))) >= 30:
                entity_with_desc += 1
            elif isinstance(e, str) and len(e) >= 10:
                entity_with_desc += 1
    metrics["entityCount"] = entity_count
    metrics["entityWithDescription"] = entity_with_desc
    if entity_count == 0:
        depth_warnings.append(f"domains/{filename}: no entities defined")

    flows = page.get("flows", [])
    if not isinstance(flows, list):
        flows = []

    total_steps = 0
    steps_with_source_ref = 0
    steps_with_depth = 0
    flow_summary_issues = 0

    for i, flow in enumerate(flows):
        if not isinstance(flow, dict):
            continue
        flow_summary = str(flow.get("summary", ""))
        flow_summary_len = len(flow_summary)
        if flow_summary_len < DEPTH_THRESHOLDS["flow_summary_fail"]:
            depth_issues.append(
                f"domains/{filename}: flows[{i}] summary too shallow ({flow_summary_len} chars)"
            )
            flow_summary_issues += 1
        elif flow_summary_len < DEPTH_THRESHOLDS["flow_summary_warn"]:
            depth_warnings.append(
                f"domains/{filename}: flows[{i}] summary could be deeper ({flow_summary_len} chars)"
            )

        steps = flow.get("steps", [])
        if not isinstance(steps, list):
            continue
        for j, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            total_steps += 1
            desc = str(step.get("description", ""))
            desc_len = len(desc)

            if desc_len < DEPTH_THRESHOLDS["step_description_fail"]:
                depth_issues.append(
                    f"domains/{filename}: flows[{i}].steps[{j}] description too shallow ({desc_len} chars)"
                )
            elif desc_len < DEPTH_THRESHOLDS["step_description_warn"]:
                depth_warnings.append(
                    f"domains/{filename}: flows[{i}].steps[{j}] description could be deeper ({desc_len} chars)"
                )

            if isinstance(step.get("sourceRef"), dict) and step["sourceRef"].get("file"):
                steps_with_source_ref += 1

            if DEPTH_KEYWORDS_EN.search(desc) or DEPTH_KEYWORDS_ZH.search(desc):
                steps_with_depth += 1

    source_ref_coverage = steps_with_source_ref / total_steps if total_steps > 0 else 0
    depth_indicator_ratio = steps_with_depth / total_steps if total_steps > 0 else 0

    metrics["totalSteps"] = total_steps
    metrics["sourceRefCoverage"] = round(source_ref_coverage, 2)
    metrics["depthIndicatorRatio"] = round(depth_indicator_ratio, 2)
    metrics["flowCount"] = len(flows)

    if total_steps > 0:
        if source_ref_coverage < DEPTH_THRESHOLDS["source_ref_coverage_fail"]:
            depth_issues.append(
                f"domains/{filename}: sourceRef coverage {source_ref_coverage:.0%} "
                f"(need >= {DEPTH_THRESHOLDS['source_ref_coverage_fail']:.0%})"
            )
        elif source_ref_coverage < DEPTH_THRESHOLDS["source_ref_coverage_warn"]:
            depth_warnings.append(
                f"domains/{filename}: sourceRef coverage {source_ref_coverage:.0%} "
                f"(target >= {DEPTH_THRESHOLDS['source_ref_coverage_warn']:.0%})"
            )

        if depth_indicator_ratio < DEPTH_THRESHOLDS["depth_indicator_target"]:
            depth_warnings.append(
                f"domains/{filename}: only {depth_indicator_ratio:.0%} of steps mention business rules/exceptions/side effects "
                f"(target >= {DEPTH_THRESHOLDS['depth_indicator_target']:.0%})"
            )

    glossary = page.get("ubiquitousLanguage", [])
    glossary_count = len(glossary) if isinstance(glossary, list) else 0
    metrics["glossaryTerms"] = glossary_count
    if glossary_count == 0:
        depth_warnings.append(f"domains/{filename}: no ubiquitousLanguage defined")

    biz_rules = page.get("businessRules", [])
    biz_rules_count = len(biz_rules) if isinstance(biz_rules, list) else 0
    metrics["businessRulesCount"] = biz_rules_count
    if biz_rules_count == 0:
        depth_warnings.append(f"domains/{filename}: no businessRules defined")

    integration = page.get("integrationPoints", {})
    inbound_count = len(integration.get("inbound", [])) if isinstance(integration, dict) else 0
    outbound_count = len(integration.get("outbound", [])) if isinstance(integration, dict) else 0
    metrics["integrationInbound"] = inbound_count
    metrics["integrationOutbound"] = outbound_count
    if inbound_count == 0 and outbound_count == 0:
        depth_warnings.append(f"domains/{filename}: no integrationPoints defined")

    error_catalog = page.get("errorCatalog", [])
    error_count = len(error_catalog) if isinstance(error_catalog, list) else 0
    metrics["errorCatalogCount"] = error_count
    if error_count == 0:
        depth_warnings.append(f"domains/{filename}: no errorCatalog defined")

    rich_entities = sum(
        1 for e in (entities if isinstance(entities, list) else [])
        if isinstance(e, dict) and e.get("description") and len(str(e.get("description", ""))) >= 30
    )
    metrics["richEntityCount"] = rich_entities

    weight_summary = min(summary_len / DEPTH_THRESHOLDS["domain_summary_warn"], 1.0) * 15
    weight_entity = min(rich_entities / max(entity_count, 1), 1.0) * min(entity_count / 2, 1.0) * 10
    weight_source = source_ref_coverage * 20
    weight_depth = depth_indicator_ratio * 15
    weight_flow_summary = (
        (1 - flow_summary_issues / max(len(flows), 1)) * 10 if flows else 0
    )
    weight_glossary = min(glossary_count / 5, 1.0) * 8
    weight_rules = min(biz_rules_count / 3, 1.0) * 8
    weight_integration = min((inbound_count + outbound_count) / 3, 1.0) * 7
    weight_errors = min(error_count / 2, 1.0) * 7

    depth_score = round(
        weight_summary + weight_entity + weight_source + weight_depth
        + weight_flow_summary + weight_glossary + weight_rules
        + weight_integration + weight_errors
    )
    metrics["depthScore"] = depth_score

    return {
        "metrics": metrics,
        "warnings": depth_warnings,
        "issues": depth_issues,
        "depthScore": depth_score,
    }


def validate_content_depth(wiki_dir: str) -> dict[str, Any]:
    """Run content depth validation across all domain pages in a wiki directory.

    Returns aggregate metrics with per-domain breakdowns.
    """
    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return {"valid": False, "issues": ["No domains/ directory found"], "warnings": [], "perDomain": {}}

    domain_files = sorted(f for f in os.listdir(domain_dir) if f.endswith(".json"))
    if not domain_files:
        return {"valid": False, "issues": ["No domain JSON files found"], "warnings": [], "perDomain": {}}

    all_issues: list[str] = []
    all_warnings: list[str] = []
    per_domain: dict[str, Any] = {}
    total_score = 0

    for filename in domain_files:
        page = _load_json(os.path.join(domain_dir, filename))
        if not page:
            continue
        result = _check_content_depth(page, filename)
        per_domain[filename] = result["metrics"]
        all_issues.extend(result["issues"])
        all_warnings.extend(result["warnings"])
        total_score += result["depthScore"]

    avg_score = round(total_score / len(domain_files)) if domain_files else 0

    return {
        "valid": len(all_issues) == 0,
        "averageDepthScore": avg_score,
        "issues": all_issues,
        "warnings": all_warnings,
        "perDomain": per_domain,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <wiki_dir> [dg_path]")
        print(f"       {sys.argv[0]} --depth <wiki_dir>")
        sys.exit(1)

    if sys.argv[1] == "--depth":
        wiki_dir = sys.argv[2] if len(sys.argv) > 2 else "."
        result = validate_content_depth(wiki_dir)
        score = result.get("averageDepthScore", 0)
        label = "GOOD" if score >= 70 else "FAIR" if score >= 40 else "SHALLOW"
        print(f"[wiki-content-depth] {label} — score: {score}/100")
        if result["issues"]:
            for issue in result["issues"]:
                print(f"  ERROR: {issue}")
        for w in result["warnings"]:
            print(f"  WARN: {w}")
        for domain, metrics in result.get("perDomain", {}).items():
            print(
                f"  {domain}: score={metrics.get('depthScore', '?')}, "
                f"sourceRef={metrics.get('sourceRefCoverage', '?')}, "
                f"depthIndicators={metrics.get('depthIndicatorRatio', '?')}, "
                f"steps={metrics.get('totalSteps', '?')}"
            )
        sys.exit(0 if result["valid"] else 1)

    wiki_dir = sys.argv[1]
    dg_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = validate_wiki_structure(wiki_dir, dg_path)

    if result["valid"]:
        print("[wiki-structure-validator] PASSED")
    else:
        print(f"[wiki-structure-validator] FAILED — {len(result['issues'])} issue(s)")
        for issue in result["issues"]:
            print(f"  ERROR: {issue}")
    for w in result["warnings"]:
        print(f"  WARN: {w}")

    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
