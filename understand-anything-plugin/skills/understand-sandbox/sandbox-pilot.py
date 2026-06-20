#!/usr/bin/env python3
"""Conservative deterministic Understand Anything sandbox pilot."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

EXCLUDE_NAMES = {
    ".git",
    "node_modules",
    ".next",
    "coverage",
    "dist",
    "build",
    ".turbo",
    ".cache",
}
EXCLUDE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".mov"}
INCLUDE_DEFAULTS = [
    "src",
    "app",
    "components",
    "lib",
    "tests",
    "test",
    "README.md",
    "readme.md",
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "next.config.js",
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def is_local_secret_name(name: str) -> bool:
    env_prefix = "." + "env"
    return name == env_prefix or name.startswith(env_prefix + ".") or name.endswith(".local")


def should_skip(path: Path) -> bool:
    return (
        path.name in EXCLUDE_NAMES
        or is_local_secret_name(path.name)
        or path.suffix.lower() in EXCLUDE_SUFFIXES
    )


def copy_tree(src: Path, dst: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> list[str]:
        return [name for name in names if should_skip(Path(name))]

    if src.is_dir():
        shutil.copytree(src, dst, ignore=ignore)
    elif src.is_file() and not should_skip(src):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--sandbox", required=True)
    parser.add_argument("--plugin-root", default=None)
    parser.add_argument("--include", action="append", default=[])
    args = parser.parse_args()

    source = Path(args.source).resolve()
    sandbox = Path(args.sandbox).resolve()
    plugin_root = Path(args.plugin_root).resolve() if args.plugin_root else Path(__file__).resolve().parents[2]
    include = args.include or INCLUDE_DEFAULTS

    if sandbox.exists():
        shutil.rmtree(sandbox)
    sandbox.mkdir(parents=True)

    for rel in include:
        p = source / rel
        if p.exists():
            copy_tree(p, sandbox / rel)

    intermediate = sandbox / ".understand-anything" / "intermediate"
    intermediate.mkdir(parents=True, exist_ok=True)

    skill_root = plugin_root / "skills" / "understand"
    scan_path = intermediate / "scan-script.json"
    run(["node", str(skill_root / "scan-project.mjs"), str(sandbox), str(scan_path)])
    scan = json.loads(scan_path.read_text())

    import_input_path = intermediate / "import-input.json"
    import_input_path.write_text(json.dumps({"projectRoot": str(sandbox), "files": scan["files"]}, indent=2))
    import_path = intermediate / "import-map.json"
    run(["node", str(skill_root / "extract-import-map.mjs"), str(import_input_path), str(import_path)])
    imports = json.loads(import_path.read_text())

    structure_input_path = intermediate / "structure-input.json"
    structure_input_path.write_text(json.dumps({
        "projectRoot": str(sandbox),
        "batchFiles": scan["files"],
        "batchImportData": imports["importMap"],
    }, indent=2))
    structure_path = intermediate / "structure.json"
    run(["node", str(skill_root / "extract-structure.mjs"), str(structure_input_path), str(structure_path)])
    structure = json.loads(structure_path.read_text())

    top_importers = sorted(
        ((path, len(edges)) for path, edges in imports["importMap"].items()),
        key=lambda item: item[1],
        reverse=True,
    )[:20]
    report = {
        "source": str(source),
        "sandbox": str(sandbox),
        "totalFiles": scan["totalFiles"],
        "estimatedComplexity": scan["estimatedComplexity"],
        "filteredByIgnore": scan.get("filteredByIgnore"),
        "byCategory": scan["stats"]["byCategory"],
        "byLanguage": scan["stats"]["byLanguage"],
        "importStats": imports["stats"],
        "structure": {
            "filesAnalyzed": structure["filesAnalyzed"],
            "filesSkipped": structure["filesSkipped"],
            "results": len(structure["results"]),
        },
        "topImporters": top_importers,
    }
    out = sandbox / ".understand-anything" / "sandbox-report.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
