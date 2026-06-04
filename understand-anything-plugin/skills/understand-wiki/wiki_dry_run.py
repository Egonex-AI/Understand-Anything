#!/usr/bin/env python3
"""Wiki dry-run planner — preview generation without LLM calls.

Usage:
    python3 wiki_dry_run.py <parent_directory>

Scans child services, classifies wiki work (FULL / INCREMENTAL / SKIP),
estimates token cost, and prints a dry-run summary. Exit code 0 always on success.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from wiki_diff_domains import diff_domain_graphs, extract_domains

TOKENS_PER_DOMAIN = 2000

SKIP_DIR_NAMES = frozenset(
    {"node_modules", "dist", "build", "target", "docs", "scripts", "tools"}
)

SERVICE_MARKERS = (
    ".understand-anything",
    "pom.xml",
    "package.json",
    "go.mod",
    "Cargo.toml",
)


@dataclass
class ServicePlan:
    name: str
    mode: str  # FULL | INCREMENTAL | SKIP
    reason: str
    detail: str = ""
    total_domains: int = 0
    domains_to_generate: int = 0
    estimated_tokens: int = 0

    @property
    def would_change(self) -> bool:
        return self.mode in ("FULL", "INCREMENTAL")


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def discover_services(parent_root: Path) -> list[str]:
    """Return sorted service directory names under parent_root."""
    if not parent_root.is_dir():
        return []

    services: list[str] = []
    for entry in sorted(parent_root.iterdir()):
        if not entry.is_dir():
            continue
        name = entry.name
        if name.startswith(".") or name in SKIP_DIR_NAMES:
            continue
        if any((entry / marker).exists() for marker in SERVICE_MARKERS):
            services.append(name)
    return services


def resolve_current_commit(
    service_root: Path,
    override: str | None = None,
) -> str:
    """Resolve HEAD commit for a service (git, override, or domain-graph fallback)."""
    if override:
        return override

    try:
        result = subprocess.run(
            ["git", "-C", str(service_root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    dg_path = service_root / ".understand-anything" / "domain-graph.json"
    if dg_path.is_file():
        dg = load_json(dg_path)
        return dg.get("project", {}).get("gitCommitHash", "") or ""

    return ""


def count_domains(service_root: Path) -> int:
    dg_path = service_root / ".understand-anything" / "domain-graph.json"
    if not dg_path.is_file():
        return 0
    return len(extract_domains(load_json(dg_path)))


def classify_service(
    service_root: Path,
    *,
    force_full: bool = False,
    current_commit: str | None = None,
) -> ServicePlan:
    """Classify what wiki work would run for one service."""
    name = service_root.name
    ua = service_root / ".understand-anything"
    meta_path = ua / "wiki" / "meta.json"
    dg_path = ua / "domain-graph.json"
    snapshot_path = ua / "wiki" / "domain-graph.snapshot.json"
    kg_path = ua / "knowledge-graph.json"

    total_domains = count_domains(service_root)
    commit = resolve_current_commit(service_root, current_commit)

    if not meta_path.is_file() or force_full:
        reason = "new, no existing wiki" if not meta_path.is_file() else "forced with --full"
        domains = total_domains or 0
        return ServicePlan(
            name=name,
            mode="FULL",
            reason=reason,
            detail="",
            total_domains=domains,
            domains_to_generate=domains,
            estimated_tokens=domains * TOKENS_PER_DOMAIN,
        )

    meta = load_json(meta_path)
    wiki_commit = meta.get("gitCommitHash", "") or ""

    if wiki_commit and commit and wiki_commit == commit:
        return ServicePlan(
            name=name,
            mode="SKIP",
            reason="up-to-date",
            detail=f"commit: {commit[:8]}" if commit else "",
            total_domains=total_domains,
            domains_to_generate=0,
            estimated_tokens=0,
        )

    # Commit differs — incremental if snapshot exists, else full regen
    if not snapshot_path.is_file() or not dg_path.is_file():
        domains = total_domains or 0
        return ServicePlan(
            name=name,
            mode="FULL",
            reason="stale commit, no DG snapshot",
            detail=f"wiki {wiki_commit[:8]} → {commit[:8]}" if wiki_commit and commit else "commit changed",
            total_domains=domains,
            domains_to_generate=domains,
            estimated_tokens=domains * TOKENS_PER_DOMAIN,
        )

    old_dg = load_json(snapshot_path)
    new_dg = load_json(dg_path)
    kg = load_json(kg_path) if kg_path.is_file() else None
    diff = diff_domain_graphs(old_dg, new_dg, kg=kg)

    modified_count = len(diff["added"]) + len(diff["modified"])
    total_count = modified_count + len(diff["unchanged"]) + len(diff["removed"])

    if total_count > 0 and (modified_count * 100 // total_count) > 80:
        domains = total_domains or total_count
        return ServicePlan(
            name=name,
            mode="FULL",
            reason=f"stale commit (>80% domains changed)",
            detail=f"wiki {wiki_commit[:8]} → {commit[:8]}",
            total_domains=domains,
            domains_to_generate=domains,
            estimated_tokens=domains * TOKENS_PER_DOMAIN,
        )

    if modified_count == 0:
        return ServicePlan(
            name=name,
            mode="SKIP",
            reason="commit changed, no domain changes (Phase 2 assembly only)",
            detail=f"wiki {wiki_commit[:8]} → {commit[:8]}",
            total_domains=total_domains,
            domains_to_generate=0,
            estimated_tokens=0,
        )

    return ServicePlan(
        name=name,
        mode="INCREMENTAL",
        reason=f"{modified_count} domain(s) changed",
        detail=f"wiki {wiki_commit[:8]} → {commit[:8]}",
        total_domains=total_domains,
        domains_to_generate=modified_count,
        estimated_tokens=modified_count * TOKENS_PER_DOMAIN,
    )


def is_service_root(path: Path) -> bool:
    return (path / ".understand-anything").is_dir()


def analyze_target(
    target_root: Path,
    *,
    force_full: bool = False,
    commit_overrides: dict[str, str] | None = None,
) -> list[ServicePlan]:
    """Analyze a parent directory (batch) or a single service directory."""
    if is_service_root(target_root):
        overrides = commit_overrides or {}
        return [
            classify_service(
                target_root,
                force_full=force_full,
                current_commit=overrides.get(target_root.name),
            )
        ]
    return analyze_parent(
        target_root,
        force_full=force_full,
        commit_overrides=commit_overrides,
    )


def analyze_parent(
    parent_root: Path,
    *,
    force_full: bool = False,
    commit_overrides: dict[str, str] | None = None,
) -> list[ServicePlan]:
    """Analyze all services under parent_root."""
    overrides = commit_overrides or {}
    plans: list[ServicePlan] = []
    for name in discover_services(parent_root):
        svc_root = parent_root / name
        plans.append(
            classify_service(
                svc_root,
                force_full=force_full,
                current_commit=overrides.get(name),
            )
        )
    return plans


def _phase2_line(plans: list[ServicePlan], parent_root: Path) -> str:
    changing = [p for p in plans if p.would_change]
    integrated = 0
    for name in discover_services(parent_root):
        if (parent_root / name / ".understand-anything" / "wiki" / "meta.json").is_file():
            integrated += 1

    would_integrate = integrated
    for p in changing:
        meta = parent_root / p.name / ".understand-anything" / "wiki" / "meta.json"
        if not meta.is_file():
            would_integrate += 1

    if would_integrate < 2:
        return "Phase 3: Skipped (requires 2+ integrated services)."

    n = len(changing)
    if n == 0:
        return "Phase 3: Parent wiki unchanged (no service wikis need regeneration)."
    if n == 1:
        return f"Phase 3: Parent wiki would be updated (1 service changed)."
    return f"Phase 3: Parent wiki would be regenerated ({n} services changed)."


def format_dry_run_report(plans: list[ServicePlan], parent_root: Path) -> str:
    """Format the dry-run summary for stdout."""
    lines = [
        "[understand-wiki] Dry run — no files will be generated.",
        "",
        "Services to process:",
    ]

    if not plans:
        lines.append("  (0 services found under parent directory)")
    else:
        for plan in plans:
            if plan.mode == "SKIP":
                lines.append(f"  • {plan.name}: SKIP ({plan.reason})")
                continue

            label = plan.mode
            reason = plan.reason
            lines.append(f"  • {plan.name}: {label} ({reason})")
            if plan.mode == "FULL":
                dom = plan.domains_to_generate or plan.total_domains
                lines.append(f"    - {dom} domains, ~{plan.estimated_tokens} tokens estimated")
            elif plan.mode == "INCREMENTAL":
                lines.append(
                    f"    - {plan.domains_to_generate} domains to regenerate, "
                    f"~{plan.estimated_tokens} tokens estimated"
                )

    lines.append("")
    lines.append(_phase2_line(plans, parent_root))

    total_tokens = sum(p.estimated_tokens for p in plans)
    lines.append(f"Total estimated cost: ~{total_tokens} tokens")
    lines.append("")
    lines.append("Run without --dry-run to execute.")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Preview /understand-wiki batch plan")
    parser.add_argument("parent_directory", help="Parent project root (batch mode)")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Treat all services as full regeneration",
    )
    args = parser.parse_args()

    parent = Path(args.parent_directory).resolve()
    if not parent.is_dir():
        print(f"Error: not a directory: {parent}", file=sys.stderr)
        sys.exit(1)

    plans = analyze_target(parent, force_full=args.full)
    report_root = parent.parent if is_service_root(parent) else parent
    print(format_dry_run_report(plans, report_root))
    sys.exit(0)


if __name__ == "__main__":
    main()
