#!/usr/bin/env python3
"""
compute_domain_fingerprints.py — Compute and compare content fingerprints for domain KG subsets.

Enables incremental domain flow extraction by detecting which domains have
changed since the last run.

Input: intermediate/domain-*.json files (KG subsets produced by split_kg_by_domain.py)
Output: intermediate/domain-fingerprints.json (SHA-256 per domain)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def _parse_domains_flag(args: list[str]) -> list[str] | None:
    """Extract --domains value from CLI args. Returns None if flag absent."""
    for i, arg in enumerate(args):
        if arg == "--domains" and i + 1 < len(args):
            return [d.strip() for d in args[i + 1].split(",") if d.strip()]
    return None


def compute_fingerprints(intermediate_dir: Path) -> dict[str, str]:
    """Compute SHA-256 fingerprints for each domain-<name>.json in the directory.

    Returns a dict mapping domain short name (e.g. "order") to its hex digest.
    Excludes non-domain files like flows-*, kg-summary.json, domain-discovery*.json, etc.
    """
    result: dict[str, str] = {}
    for path in sorted(intermediate_dir.glob("domain-*.json")):
        stem = path.stem
        if not stem.startswith("domain-"):
            continue
        name = stem[len("domain-"):]
        if name in ("discovery", "discovery-checkpoint", "analysis", "audit",
                     "fingerprints", "context", "validation-report"):
            continue
        if name.startswith("discovery"):
            continue
        content = path.read_bytes()
        result[name] = hashlib.sha256(content).hexdigest()
    return result


def compare_fingerprints(
    old: dict[str, str],
    new: dict[str, str],
) -> dict[str, list[str]]:
    """Compare old and new fingerprint dicts.

    Returns:
        {
            "unchanged": [names where fingerprint is identical],
            "changed":   [names where fingerprint differs],
            "new":       [names only in new],
            "removed":   [names only in old],
        }
    """
    old_keys = set(old)
    new_keys = set(new)

    unchanged = sorted(k for k in old_keys & new_keys if old[k] == new[k])
    changed = sorted(k for k in old_keys & new_keys if old[k] != new[k])
    new_domains = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)

    return {
        "unchanged": unchanged,
        "changed": changed,
        "new": new_domains,
        "removed": removed,
    }


def load_fingerprints(path: Path) -> dict[str, str]:
    """Load fingerprints from a JSON file. Returns empty dict on missing/invalid/malformed file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        if not all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
            return {}
        return data
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}


def save_fingerprints(fingerprints: dict[str, str], path: Path) -> None:
    """Write fingerprints dict to a JSON file."""
    path.write_text(
        json.dumps(fingerprints, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _is_doc_only_domain(domain_info: dict[str, Any]) -> bool:
    """Return True if all modules in this domain are pure documentation paths."""
    modules = domain_info.get("modules", [])
    if not modules:
        return False
    return all(
        m.strip("/").split("/")[0].lower() in ("doc", "docs")
        for m in modules
    )


def _has_valid_flows(intermediate_dir: Path, domain_name: str) -> bool:
    """Check if a flows-<name>.json exists with valid JSON and a non-empty flows array."""
    flows_path = intermediate_dir / f"flows-{domain_name}.json"
    if not flows_path.exists():
        return False
    try:
        data = json.loads(flows_path.read_text(encoding="utf-8"))
        flows = data.get("flows", [])
        return isinstance(flows, list) and len(flows) > 0
    except (json.JSONDecodeError, OSError):
        return False


def get_domains_to_extract(
    intermediate_dir: Path,
    discovery: dict[str, Any],
    *,
    full: bool = False,
) -> dict[str, list[str]]:
    """Determine which domains need flow extraction based on fingerprints and flows validity.

    Returns:
        {
            "to_extract":      [domain short names that need extraction],
            "skipped":         [domain short names skipped (unchanged + valid flows)],
            "doc_only_skipped": [domain short names skipped because doc-only],
        }
    """
    domains = discovery.get("domains", [])
    fp_path = intermediate_dir / "domain-fingerprints.json"

    to_extract: list[str] = []
    skipped: list[str] = []
    doc_only_skipped: list[str] = []

    current_fps = compute_fingerprints(intermediate_dir)
    old_fps = {} if full else load_fingerprints(fp_path)

    comparison = compare_fingerprints(old_fps, current_fps)

    for domain_info in domains:
        domain_id = domain_info["id"]
        name = domain_id.replace("domain:", "")

        if _is_doc_only_domain(domain_info):
            doc_only_skipped.append(name)
            continue

        if full:
            to_extract.append(name)
            continue

        is_unchanged = name in comparison["unchanged"]
        has_flows = _has_valid_flows(intermediate_dir, name)

        if is_unchanged and has_flows:
            skipped.append(name)
        else:
            to_extract.append(name)

    return {
        "to_extract": to_extract,
        "skipped": skipped,
        "doc_only_skipped": doc_only_skipped,
    }


def main(argv: list[str] | None = None) -> int:
    """CLI entry point with two modes.

    Usage:
        python compute_domain_fingerprints.py <project-root>               # compute + save
        python compute_domain_fingerprints.py <project-root> --check       # check which need extraction (JSON to stdout)
        python compute_domain_fingerprints.py <project-root> --check --full  # force all extraction
        python compute_domain_fingerprints.py <project-root> --save        # save current fingerprints (post-extraction)
    """
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("Usage: python compute_domain_fingerprints.py <project-root> [--check [--full] | --save]", file=sys.stderr)
        return 1

    project_root = Path(args[0])
    inter_dir = project_root / ".understand-anything" / "intermediate"
    flags = set(args[1:])

    if not inter_dir.exists():
        print(f"[fingerprints] Intermediate directory not found: {inter_dir}", file=sys.stderr)
        return 1

    if "--check" in flags:
        discovery_path = inter_dir / "domain-discovery.json"
        if not discovery_path.exists():
            print(f"[fingerprints] Discovery not found: {discovery_path}", file=sys.stderr)
            return 1
        discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
        full = "--full" in flags
        result = get_domains_to_extract(inter_dir, discovery, full=full)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if "--save" in flags:
        all_fps = compute_fingerprints(inter_dir)
        fp_path = inter_dir / "domain-fingerprints.json"

        domains_filter = _parse_domains_flag(args)
        if domains_filter is not None:
            existing = load_fingerprints(fp_path)
            merged = dict(existing)
            for name in domains_filter:
                if name in all_fps:
                    merged[name] = all_fps[name]
            save_fingerprints(merged, fp_path)
            print(f"[fingerprints] Saved {len(domains_filter)} domain fingerprints (merged with {len(existing)} existing) to {fp_path}")
        else:
            save_fingerprints(all_fps, fp_path)
            print(f"[fingerprints] Saved {len(all_fps)} fingerprints to {fp_path}")
        return 0

    fingerprints = compute_fingerprints(inter_dir)
    fp_path = inter_dir / "domain-fingerprints.json"

    old_fps = load_fingerprints(fp_path)
    if old_fps:
        comparison = compare_fingerprints(old_fps, fingerprints)
        print(f"[fingerprints] Unchanged: {len(comparison['unchanged'])}, "
              f"Changed: {len(comparison['changed'])}, "
              f"New: {len(comparison['new'])}, "
              f"Removed: {len(comparison['removed'])}")
    else:
        print(f"[fingerprints] First run — computed {len(fingerprints)} domain fingerprints")

    save_fingerprints(fingerprints, fp_path)
    print(f"[fingerprints] Saved to {fp_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
