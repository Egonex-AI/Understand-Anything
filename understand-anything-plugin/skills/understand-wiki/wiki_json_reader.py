#!/usr/bin/env python3
"""Read a dot-separated field from a JSON file for shell scripts."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def read_json_field(
    json_file: str,
    json_path: str,
    default_value: str = "",
) -> str:
    """Return a field from JSON as a string, or *default_value* on error/missing path."""
    try:
        path = Path(json_file)
        if not path.is_file():
            return default_value
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return default_value

    current: Any = data
    for key in json_path.split("."):
        if not key:
            continue
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return default_value

    return _format_value(current)


def _format_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2:
        print("Usage: wiki_json_reader.py <json_file> <json_path> [default_value]", file=sys.stderr)
        return 0

    json_file = args[0]
    json_path = args[1]
    default_value = args[2] if len(args) > 2 else ""
    print(read_json_field(json_file, json_path, default_value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
