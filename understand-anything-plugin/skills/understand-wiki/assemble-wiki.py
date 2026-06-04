"""Wiki assembly script.

Copies validated intermediate wiki files to the final wiki directory,
generates meta.json with content hashes and quality metrics.

Usage:
    python assemble-wiki.py <intermediate_wiki_dir> <final_wiki_dir> <git_commit_hash> \
        [--output-language=<lang>] [--service-root=<path>]
"""

import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()[:16]}"


def compute_source_ref_coverage(wiki_dir: str) -> dict:
    total_steps = 0
    with_ref = 0
    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return {"totalSteps": 0, "withSourceRef": 0, "coveragePercent": 100}

    for f in os.listdir(domain_dir):
        if not f.endswith(".json"):
            continue
        with open(os.path.join(domain_dir, f)) as fh:
            page = json.load(fh)
        for flow in page.get("flows", []):
            for step in flow.get("steps", []):
                total_steps += 1
                if step.get("sourceRef") and step["sourceRef"].get("file"):
                    with_ref += 1

    return {
        "totalSteps": total_steps,
        "withSourceRef": with_ref,
        "coveragePercent": round(with_ref / total_steps * 100, 1) if total_steps else 100,
    }


DEPTH_KEYWORDS = re.compile(
    r"(business rule|exception|error|side effect|event|callback|transaction|validation|"
    r"业务规则|异常|错误|副作用|事件|回调|事务|校验)",
    re.IGNORECASE,
)


def compute_content_depth(wiki_dir: str) -> float:
    scores = []
    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return 100.0

    for f in os.listdir(domain_dir):
        if not f.endswith(".json"):
            continue
        with open(os.path.join(domain_dir, f)) as fh:
            page = json.load(fh)
        text = json.dumps(page, ensure_ascii=False)
        summary_len = len(page.get("summary", ""))
        keyword_hits = len(DEPTH_KEYWORDS.findall(text))
        flow_count = len(page.get("flows", []))
        score = min(100, summary_len // 5 + keyword_hits * 5 + flow_count * 10)
        scores.append(score)

    return round(sum(scores) / len(scores), 1) if scores else 0


def grade(schema: float, source_ref: float, depth: float) -> str:
    avg = (schema + source_ref + depth) / 3
    if avg >= 90:
        return "A"
    if avg >= 80:
        return "B+"
    if avg >= 70:
        return "B"
    if avg >= 60:
        return "C+"
    if avg >= 50:
        return "C"
    return "D"


def main() -> None:
    args = sys.argv[1:]
    flags = {a.split("=")[0]: a.split("=")[1] for a in args if "=" in a}
    positional = [a for a in args if not a.startswith("--")]

    if len(positional) < 3:
        print("Usage: python assemble-wiki.py <intermediate_dir> <final_dir> <git_hash> [options]")
        sys.exit(1)

    intermediate_dir = positional[0]
    final_dir = positional[1]
    git_hash = positional[2]
    output_language = flags.get("--output-language", "en")

    report_path = os.path.join(os.path.dirname(intermediate_dir), "wiki-validation-report.json")
    validation_warnings = []
    if os.path.exists(report_path):
        with open(report_path) as f:
            report = json.load(f)
        validation_warnings = report.get("warnings", [])
        if report.get("errors"):
            print(f"[assemble-wiki] WARNING: {len(report['errors'])} validation errors — proceeding with partial results")
            for e in report["errors"]:
                print(f"  ERROR: {e}")

    os.makedirs(final_dir, exist_ok=True)
    os.makedirs(os.path.join(final_dir, "domains"), exist_ok=True)

    old_meta = {}
    old_meta_path = os.path.join(final_dir, "meta.json")
    if os.path.exists(old_meta_path):
        with open(old_meta_path) as f:
            old_meta = json.load(f)

    old_hashes = old_meta.get("domainHashes", {})

    for item in ["service.json", "index.json"]:
        src = os.path.join(intermediate_dir, item)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(final_dir, item))

    domain_hashes = {}
    copied = 0
    skipped = 0
    int_domains = os.path.join(intermediate_dir, "domains")
    if os.path.isdir(int_domains):
        for f in os.listdir(int_domains):
            if not f.endswith(".json"):
                continue
            src = os.path.join(int_domains, f)
            new_hash = sha256_file(src)
            slug = f.removesuffix(".json")
            domain_hashes[slug] = new_hash
            if old_hashes.get(slug) == new_hash:
                skipped += 1
            else:
                shutil.copy2(src, os.path.join(final_dir, "domains", f))
                copied += 1

    for item in ["overview.json", "architecture.json"]:
        src = os.path.join(intermediate_dir, item)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(final_dir, item))

    src_ref = compute_source_ref_coverage(final_dir)
    depth = compute_content_depth(final_dir)
    schema_score = 100 if not validation_warnings else max(0, 100 - len(validation_warnings) * 2)

    meta = {
        "gitCommitHash": git_hash,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": "1.0.0",
        "outputLanguage": output_language,
        "domainHashes": domain_hashes,
        "sourceRefCoverage": src_ref,
        "qualityScore": {
            "schemaCompliance": schema_score,
            "sourceRefCoverage": src_ref["coveragePercent"],
            "contentDepth": depth,
            "overallGrade": grade(schema_score, src_ref["coveragePercent"], depth),
        },
        "validationWarnings": validation_warnings[:20],
    }

    with open(os.path.join(final_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"[assemble-wiki] Done — copied {copied}, skipped {skipped} (unchanged), {len(domain_hashes)} domains")
    print(f"[assemble-wiki] Quality: {meta['qualityScore']['overallGrade']} (schema={schema_score}, srcRef={src_ref['coveragePercent']}%, depth={depth})")


if __name__ == "__main__":
    main()
