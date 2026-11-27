#!/usr/bin/env python3
"""Generate an inventory for an independently reviewed local release."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

INSTALLER = Path(__file__).resolve().with_name("secure-install.py")

spec = importlib.util.spec_from_file_location(
    "secure_install", INSTALLER
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()

    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("Invalid Git commit identifier")

    root = args.release.absolute()
    installer.safe_dir(root)

    if root.name != args.commit:
        parser.error("Release directory must match the commit")

    manifest = root / installer.MANIFEST

    if installer.exists(manifest):
        parser.error("Manifest already exists")

    data = {
        "commit": args.commit,
        "entries": installer.inventory(root),
    }

    raw = (
        json.dumps(
            data,
            indent=2,
            sort_keys=True,
            ensure_ascii=True,
        ) + "\n"
    ).encode("utf-8")

    with manifest.open("xb") as stream:
        stream.write(raw)

    print(f"Commit: {args.commit}")
    print(f"Inventory entries: {len(data['entries'])}")
    print(f"Manifest: {manifest}")
    print(f"SHA-256: {hashlib.sha256(raw).hexdigest()}")
    print("Manifest generated. Independent approval required.")


if __name__ == "__main__":
    main()
