#!/usr/bin/env python3
"""
Validate and load .understand-anything/config.json, focusing on rpcAnnotations.

Schema for rpcAnnotations (array of objects):
  - provider: str — annotation class name for RPC providers (e.g. "@MoaProvider")
  - consumer: str — annotation class name for RPC consumers (e.g. "@MoaConsumer")
  - type: str — framework identifier (e.g. "moa", "dubbo", "grpc")
  - interfaceField: str (optional) — annotation attribute holding the interface name;
    defaults to "value"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_INTERFACE_FIELD = "value"

_REQUIRED_ENTRY_FIELDS = ("provider", "consumer", "type")


def validate_exclude_services(exclude_services: Any) -> tuple[bool, list[str]]:
    """Validate an excludeServices array. Returns (is_valid, error_messages)."""
    errors: list[str] = []

    if not isinstance(exclude_services, list):
        return False, ["excludeServices must be an array"]

    for index, entry in enumerate(exclude_services):
        if not isinstance(entry, str):
            errors.append(f"excludeServices[{index}]: must be a string")
        elif not entry.strip():
            errors.append(f"excludeServices[{index}]: must be a non-empty string")

    return len(errors) == 0, errors


def validate_rpc_annotations(rpc_annotations: Any) -> tuple[bool, list[str]]:
    """Validate an rpcAnnotations array. Returns (is_valid, error_messages)."""
    errors: list[str] = []

    if not isinstance(rpc_annotations, list):
        return False, ["rpcAnnotations must be an array"]

    for index, entry in enumerate(rpc_annotations):
        prefix = f"rpcAnnotations[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{prefix}: must be an object")
            continue

        for field in _REQUIRED_ENTRY_FIELDS:
            if field not in entry:
                errors.append(f"{prefix}: missing required field '{field}'")
                continue
            value = entry[field]
            if not isinstance(value, str):
                errors.append(f"{prefix}.{field}: must be a string")
            elif not value.strip():
                errors.append(f"{prefix}.{field}: must be a non-empty string")

        if "interfaceField" in entry:
            iface = entry["interfaceField"]
            if not isinstance(iface, str):
                errors.append(f"{prefix}.interfaceField: must be a string")
            elif not iface.strip():
                errors.append(f"{prefix}.interfaceField: must be a non-empty string")

    return len(errors) == 0, errors


def normalize_rpc_annotations(rpc_annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply default interfaceField to each rpcAnnotations entry."""
    normalized: list[dict[str, Any]] = []
    for entry in rpc_annotations:
        item = dict(entry)
        item.setdefault("interfaceField", DEFAULT_INTERFACE_FIELD)
        normalized.append(item)
    return normalized


def validate_config(config: Any) -> tuple[bool, list[str]]:
    """Validate config dict. rpcAnnotations and excludeServices are optional."""
    if not isinstance(config, dict):
        return False, ["config must be an object"]

    errors: list[str] = []

    if "rpcAnnotations" in config:
        rpc_annotations = config["rpcAnnotations"]
        if rpc_annotations is None:
            errors.append("rpcAnnotations must be an array")
        else:
            valid, rpc_errors = validate_rpc_annotations(rpc_annotations)
            if not valid:
                errors.extend(rpc_errors)

    if "excludeServices" in config:
        exclude_services = config["excludeServices"]
        if exclude_services is None:
            errors.append("excludeServices must be an array")
        else:
            valid, exclude_errors = validate_exclude_services(exclude_services)
            if not valid:
                errors.extend(exclude_errors)

    return len(errors) == 0, errors


def load_config(config_path: str | Path) -> dict[str, Any]:
    """Load config.json from disk. Raises FileNotFoundError or json.JSONDecodeError."""
    path = Path(config_path)
    if not path.is_file():
        raise FileNotFoundError(f"Config file not found: {path}")

    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError(f"Config root must be an object: {path}")

    return data


def merge_config(
    base: dict[str, Any] | None,
    override: dict[str, Any] | None,
) -> dict[str, Any]:
    """Shallow-merge override into base. Override values win on key conflicts."""
    merged: dict[str, Any] = dict(base or {})
    if override:
        merged.update(override)
    return merged


def load_and_merge_config(
    config_path: str | Path,
    defaults: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], bool, list[str]]:
    """
    Load config from file, merge with defaults, validate, and normalize rpcAnnotations.

    Returns (merged_config, is_valid, error_messages).
    """
    loaded = load_config(config_path)
    merged = merge_config(defaults, loaded)

    valid, errors = validate_config(merged)
    if valid and isinstance(merged.get("rpcAnnotations"), list):
        merged["rpcAnnotations"] = normalize_rpc_annotations(merged["rpcAnnotations"])

    return merged, valid, errors


def main() -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Validate rpcAnnotations in .understand-anything/config.json"
    )
    parser.add_argument("config_path", help="Path to config.json")
    args = parser.parse_args()

    try:
        _, valid, errors = load_and_merge_config(args.config_path)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if valid:
        print("Config is valid.")
        return 0

    for message in errors:
        print(message, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
