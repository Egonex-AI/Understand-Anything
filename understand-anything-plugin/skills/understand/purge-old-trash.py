#!/usr/bin/env python3
"""Safely purge old Understand Anything trash directories.

Only removes direct child directories named `.trash-*` under the provided
`.understand-anything` directory when they are older than the requested age.
"""
from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", help="Path to the .understand-anything directory")
    parser.add_argument("--older-than-days", type=float, default=7)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if root.name != ".understand-anything" or not root.is_dir():
        raise SystemExit(f"Refusing to purge unexpected directory: {root}")

    cutoff = time.time() - args.older_than_days * 24 * 60 * 60
    removed = 0
    for child in root.iterdir():
        if not child.is_dir() or not child.name.startswith(".trash-"):
            continue
        try:
            mtime = child.stat().st_mtime
        except OSError:
            continue
        if mtime <= cutoff:
            shutil.rmtree(child)
            removed += 1
    print(f"purged {removed} old trash directories from {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
