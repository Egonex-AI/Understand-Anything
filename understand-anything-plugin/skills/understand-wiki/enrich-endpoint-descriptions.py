"""Post-processing step: enrich undescribed endpoint methods via LLM.

Three modes:
  generate-prompt   Read endpoint JSON, output a structured prompt (JSON)
                    listing all methods that lack a description.  The prompt
                    includes method signatures & source context so the LLM
                    can produce concise descriptions.

  merge-responses   Read the LLM's JSON output and merge descriptions back
                    into the endpoint JSON file.

  validate          Quality-gate check on the enriched endpoint JSON.
                    Verifies coverage, language, length, and format.
                    Exit 0 = pass, Exit 1 = fail.

Designed to be called by the understand-wiki SKILL flow between deterministic
extraction and dashboard rendering.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any


def _read_source_context(
    project_root: Path, file_path: str,
    start_line: int, end_line: int, context_lines: int = 3,
) -> str:
    """Read a few lines around the method from source for extra context."""
    src = project_root / file_path
    if not src.is_file():
        return ""
    try:
        lines = src.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""

    lo = max(0, start_line - 1 - context_lines)
    hi = min(len(lines), end_line + context_lines)
    return "\n".join(lines[lo:hi])


def generate_prompt(
    endpoint_json: Path,
    project_root: Path | None = None,
) -> dict[str, Any]:
    """Produce a structured prompt for LLM description generation."""
    data = json.loads(endpoint_json.read_text(encoding="utf-8"))
    service = data.get("service", "unknown")

    items: list[dict[str, Any]] = []
    for prov in data.get("providers", []):
        iface = prov["identifier"]
        src_file = prov.get("sourceRef", {}).get("file", "")
        for m in prov.get("methods", []):
            if m.get("description"):
                continue
            params_str = ", ".join(
                f'{p["name"]}: {p["type"]}' for p in m.get("params", [])
            )
            signature = f'{m["name"]}({params_str}) -> {m.get("returnType", "void")}'
            item: dict[str, Any] = {
                "interface": iface,
                "method": m["name"],
                "signature": signature,
            }
            if project_root and src_file:
                lr = m.get("lineRange", [0, 0])
                ctx = _read_source_context(
                    project_root, src_file, lr[0], lr[1],
                )
                if ctx:
                    item["sourceSnippet"] = ctx

            items.append(item)

    return {
        "service": service,
        "instruction": (
            "为以下 Java RPC 接口方法生成简短的中文描述（一句话，不超过30字）。"
            "根据方法名、参数类型、返回类型和代码片段推断功能。"
            "输出严格 JSON 数组，每个元素包含 interface、method、description 三个字段。"
        ),
        "methods": items,
        "totalCount": len(items),
    }


def merge_responses(
    endpoint_json: Path,
    response_json: Path,
) -> int:
    """Merge LLM-generated descriptions back into the endpoint JSON.

    Returns the number of descriptions merged.
    """
    data = json.loads(endpoint_json.read_text(encoding="utf-8"))
    responses = json.loads(response_json.read_text(encoding="utf-8"))

    if isinstance(responses, dict) and "methods" in responses:
        responses = responses["methods"]
    if not isinstance(responses, list):
        print("[enrich] Response is not a list, skipping merge", file=sys.stderr)
        return 0

    lookup: dict[tuple[str, str], str] = {}
    for r in responses:
        if isinstance(r, dict) and r.get("description"):
            key = (r.get("interface", ""), r.get("method", ""))
            lookup[key] = r["description"]

    merged = 0
    for prov in data.get("providers", []):
        iface = prov["identifier"]
        for m in prov.get("methods", []):
            if m.get("description"):
                continue
            key = (iface, m["name"])
            if key in lookup:
                m["description"] = lookup[key]
                merged += 1

    endpoint_json.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    return merged


_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_MAX_DESC_LEN = 50
_MIN_DESC_LEN = 2


def validate_descriptions(
    endpoint_json: Path,
    prompt_json: Path | None = None,
) -> dict[str, Any]:
    """Quality gate for enriched endpoint descriptions.

    Checks:
      1. Coverage — every method has a description
      2. Language — descriptions contain CJK characters
      3. Length — descriptions are within [MIN, MAX] chars
      4. Specificity — no generic placeholder text
      5. Coverage delta (if prompt_json provided) — methods that were
         in the prompt but still lack a description after merge

    Returns a report dict with ``passed`` (bool) and ``issues`` (list).
    """
    data = json.loads(endpoint_json.read_text(encoding="utf-8"))
    issues: list[dict[str, str]] = []

    expected_keys: set[tuple[str, str]] | None = None
    if prompt_json and prompt_json.is_file():
        prompt = json.loads(prompt_json.read_text(encoding="utf-8"))
        expected_keys = {
            (m["interface"], m["method"])
            for m in prompt.get("methods", [])
        }

    total_methods = 0
    described = 0
    missing: list[str] = []

    for prov in data.get("providers", []):
        iface = prov["identifier"]
        for m in prov.get("methods", []):
            total_methods += 1
            desc = m.get("description", "")
            fqn = f"{iface}.{m['name']}"

            if not desc:
                missing.append(fqn)
                continue

            described += 1

            if not _CJK_RE.search(desc):
                issues.append({
                    "method": fqn,
                    "severity": "warn",
                    "reason": f"description lacks CJK characters: \"{desc}\"",
                })

            if len(desc) > _MAX_DESC_LEN:
                issues.append({
                    "method": fqn,
                    "severity": "warn",
                    "reason": f"description too long ({len(desc)} chars, max {_MAX_DESC_LEN})",
                })
            elif len(desc) < _MIN_DESC_LEN:
                issues.append({
                    "method": fqn,
                    "severity": "error",
                    "reason": f"description too short ({len(desc)} chars)",
                })

            generic_patterns = ["TODO", "待补充", "暂无", "description", "xxx"]
            for pat in generic_patterns:
                if pat.lower() in desc.lower():
                    issues.append({
                        "method": fqn,
                        "severity": "error",
                        "reason": f"description looks like placeholder: \"{desc}\"",
                    })
                    break

    if missing:
        issues.append({
            "method": "(coverage)",
            "severity": "error",
            "reason": f"{len(missing)} method(s) still lack descriptions: "
                      + ", ".join(missing[:10])
                      + ("..." if len(missing) > 10 else ""),
        })

    if expected_keys is not None:
        still_missing = []
        for prov in data.get("providers", []):
            iface = prov["identifier"]
            for m in prov.get("methods", []):
                key = (iface, m["name"])
                if key in expected_keys and not m.get("description"):
                    still_missing.append(f"{iface}.{m['name']}")
        if still_missing:
            issues.append({
                "method": "(enrichment-gap)",
                "severity": "error",
                "reason": f"{len(still_missing)} method(s) from prompt "
                          f"still lack descriptions after merge: "
                          + ", ".join(still_missing[:10]),
            })

    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warn"]
    passed = len(errors) == 0

    return {
        "passed": passed,
        "totalMethods": total_methods,
        "described": described,
        "coverage": f"{described}/{total_methods}"
                    f" ({described * 100 // total_methods if total_methods else 0}%)",
        "errors": len(errors),
        "warnings": len(warnings),
        "issues": issues,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Enrich endpoint method descriptions via LLM",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser(
        "generate-prompt",
        help="Generate structured prompt for LLM",
    )
    gen.add_argument("endpoint_json", help="Path to service endpoint JSON")
    gen.add_argument("--project-root", help="Project root for source context")
    gen.add_argument("--output", required=True, help="Output prompt JSON path")

    mrg = sub.add_parser(
        "merge-responses",
        help="Merge LLM responses back into endpoint JSON",
    )
    mrg.add_argument("endpoint_json", help="Path to service endpoint JSON")
    mrg.add_argument("response_json", help="Path to LLM response JSON")

    val = sub.add_parser(
        "validate",
        help="Quality gate: validate enriched descriptions",
    )
    val.add_argument("endpoint_json", help="Path to service endpoint JSON")
    val.add_argument(
        "--prompt-json",
        help="Optional: prompt JSON from generate-prompt (for coverage delta check)",
    )

    args = parser.parse_args()

    if args.command == "generate-prompt":
        proj = Path(args.project_root) if args.project_root else None
        prompt = generate_prompt(Path(args.endpoint_json), project_root=proj)
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(
            json.dumps(prompt, indent=2, ensure_ascii=False), encoding="utf-8",
        )
        print(
            f"Generated prompt for {prompt['totalCount']} undescribed methods "
            f"in {prompt['service']}",
        )
    elif args.command == "merge-responses":
        count = merge_responses(Path(args.endpoint_json), Path(args.response_json))
        print(f"Merged {count} LLM-generated descriptions")
    elif args.command == "validate":
        prompt_path = Path(args.prompt_json) if args.prompt_json else None
        report = validate_descriptions(Path(args.endpoint_json), prompt_path)
        status = "PASS" if report["passed"] else "FAIL"
        print(f"[enrich-validate] {status} — {report['coverage']} described, "
              f"{report['errors']} error(s), {report['warnings']} warning(s)")
        if report["issues"]:
            for issue in report["issues"]:
                tag = "ERROR" if issue["severity"] == "error" else "WARN"
                print(f"  [{tag}] {issue['method']}: {issue['reason']}")
        sys.exit(0 if report["passed"] else 1)
