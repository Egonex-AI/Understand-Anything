#!/usr/bin/env python3
"""Assemble an offline release from previously prepared artifacts."""

import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "understand-anything-plugin"

spec = importlib.util.spec_from_file_location(
    "secure_install", REPO / "scripts/secure-install.py"
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def copy_file(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"Invalid source file: {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def assemble(staging, release):
    plugin = release / "understand-anything-plugin"
    packages = plugin / "packages"
    packages.mkdir(parents=True)

    copy_file(
        SOURCE / "package.json",
        plugin / "package.json",
    )

    for name in (
        "install.sh",
        "install.ps1",
        "LICENSE",
        "scripts/secure-install.py",
    ):
        copy_file(REPO / name, release / name)

    tracked = subprocess.check_output(
        [
            "git", "ls-files", "-z", "--",
            "understand-anything-plugin/skills",
            "understand-anything-plugin/agents",
        ],
        cwd=REPO,
    ).decode().split("\0")

    for name in filter(None, tracked):
        copy_file(REPO / name, release / name)

    shutil.copytree(
        staging / "node_modules",
        plugin / "node_modules",
        symlinks=True,
    )

    mcp = packages / "mcp"
    mcp.mkdir()

    for name in ("bin", "lib"):
        shutil.copytree(
            staging / name, mcp / name, symlinks=True
        )

    for name in ("package.json", "README.md"):
        copy_file(staging / name, mcp / name)

    link = (
        plugin / "node_modules/.pnpm/node_modules"
        / "@understand-anything/mcp"
    )

    if not link.is_symlink():
        raise ValueError("Missing MCP self-reference")

    link.unlink()
    link.symlink_to(
        os.path.relpath(mcp, link.parent),
        target_is_directory=True,
    )

    (packages / "core").symlink_to(
        "../node_modules/@understand-anything/core",
        target_is_directory=True,
    )

    viewer = packages / "viewer"
    viewer.mkdir()

    for name in ("bin", "dist"):
        shutil.copytree(
            SOURCE / "packages/viewer" / name,
            viewer / name,
            symlinks=True,
        )

    for name in ("package.json", "README.md"):
        copy_file(SOURCE / "packages/viewer" / name, viewer / name)

    entries = installer.inventory(release)

    required = (
        "package.json",
        "packages/core/dist/index.js",
        "packages/core/dist/figma/index.js",
        "packages/mcp/bin/understand-anything-mcp.mjs",
        "packages/viewer/bin/viewer.mjs",
        "packages/viewer/dist/index.html",
        "packages/viewer/bin/dist/staleness.js",
        "skills/understand/SKILL.md",
    )

    for name in required:
        if not (plugin / name).is_file():
            raise ValueError(f"Missing runtime artifact: {name}")

    return len(entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    staging = args.staging.absolute()
    output = args.output.absolute()

    installer.safe_dir(staging)
    installer.safe_dir(output.parent)

    if installer.exists(output):
        parser.error("Output already exists")

    if output.is_relative_to(REPO):
        parser.error("Output must be outside the source repository")

    if output.is_relative_to(staging):
        parser.error("Output must be outside staging")

    installer.inventory(staging)

    temporary = Path(tempfile.mkdtemp(
        prefix=".release-build-",
        dir=output.parent,
    ))

    try:
        count = assemble(staging, temporary)

        if installer.exists(output):
            raise ValueError("Output already exists")

        temporary.rename(output)

    finally:
        if temporary.exists():
            shutil.rmtree(temporary)

    print(f"PASS: Release inventory ({count} entries)")
    print(f"Release candidate: {output}")
    print("Independent review required before manifest approval.")


if __name__ == "__main__":
    main()
