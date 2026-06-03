#!/usr/bin/env python3
"""Tests for wiki_config_validator.py — rpcAnnotations config validation."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "understand-anything-plugin",
        "skills",
        "understand-wiki",
    ),
)

from wiki_config_validator import (  # noqa: E402
    DEFAULT_INTERFACE_FIELD,
    load_and_merge_config,
    load_config,
    merge_config,
    normalize_rpc_annotations,
    validate_config,
    validate_exclude_services,
    validate_rpc_annotations,
)


class TestValidateRpcAnnotations(unittest.TestCase):
    def test_valid_config_passes(self):
        annotations = [
            {"provider": "@DubboService", "consumer": "@DubboReference", "type": "dubbo"},
            {
                "provider": "@MoaProvider",
                "consumer": "@MoaConsumer",
                "type": "moa",
                "interfaceField": "service",
            },
            {"provider": "@GrpcService", "consumer": "@GrpcClient", "type": "grpc"},
        ]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_missing_provider_field(self):
        annotations = [{"consumer": "@MoaConsumer", "type": "moa"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("provider" in e for e in errors))

    def test_missing_consumer_field(self):
        annotations = [{"provider": "@MoaProvider", "type": "moa"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("consumer" in e for e in errors))

    def test_missing_type_field(self):
        annotations = [{"provider": "@MoaProvider", "consumer": "@MoaConsumer"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("type" in e for e in errors))

    def test_invalid_types_non_string_provider(self):
        annotations = [{"provider": 123, "consumer": "@MoaConsumer", "type": "moa"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("provider" in e for e in errors))

    def test_invalid_types_non_string_consumer(self):
        annotations = [{"provider": "@MoaProvider", "consumer": None, "type": "moa"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("consumer" in e for e in errors))

    def test_invalid_types_non_string_type(self):
        annotations = [
            {"provider": "@MoaProvider", "consumer": "@MoaConsumer", "type": ["moa"]}
        ]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("type" in e for e in errors))

    def test_invalid_types_non_string_interface_field(self):
        annotations = [
            {
                "provider": "@MoaProvider",
                "consumer": "@MoaConsumer",
                "type": "moa",
                "interfaceField": 42,
            }
        ]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("interfaceField" in e for e in errors))

    def test_invalid_not_array(self):
        valid, errors = validate_rpc_annotations({"provider": "@X"})
        self.assertFalse(valid)
        self.assertTrue(any("array" in e.lower() for e in errors))

    def test_invalid_entry_not_object(self):
        valid, errors = validate_rpc_annotations(["not-an-object"])
        self.assertFalse(valid)
        self.assertTrue(any("object" in e.lower() for e in errors))

    def test_empty_array_is_valid(self):
        valid, errors = validate_rpc_annotations([])
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_empty_string_provider_rejected(self):
        annotations = [{"provider": "", "consumer": "@MoaConsumer", "type": "moa"}]
        valid, errors = validate_rpc_annotations(annotations)
        self.assertFalse(valid)
        self.assertTrue(any("provider" in e for e in errors))


class TestDefaultInterfaceField(unittest.TestCase):
    def test_normalize_applies_default_interface_field(self):
        annotations = [
            {"provider": "@MoaProvider", "consumer": "@MoaConsumer", "type": "moa"},
            {
                "provider": "@DubboService",
                "consumer": "@DubboReference",
                "type": "dubbo",
                "interfaceField": "interfaceName",
            },
        ]
        normalized = normalize_rpc_annotations(annotations)
        self.assertEqual(normalized[0]["interfaceField"], DEFAULT_INTERFACE_FIELD)
        self.assertEqual(normalized[1]["interfaceField"], "interfaceName")

    def test_default_constant_is_value(self):
        self.assertEqual(DEFAULT_INTERFACE_FIELD, "value")


class TestValidateExcludeServices(unittest.TestCase):
    def test_valid_exclude_services_array(self):
        valid, errors = validate_exclude_services(["common", "shared", "libs", "tools"])
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_invalid_not_array(self):
        valid, errors = validate_exclude_services("common")
        self.assertFalse(valid)
        self.assertTrue(any("array" in e.lower() for e in errors))

    def test_invalid_non_string_entry(self):
        valid, errors = validate_exclude_services(["common", 123])
        self.assertFalse(valid)
        self.assertTrue(any("excludeServices[1]" in e for e in errors))


class TestValidateConfig(unittest.TestCase):
    def test_valid_full_config(self):
        config = {
            "outputLanguage": "zh",
            "rpcAnnotations": [
                {"provider": "@DubboService", "consumer": "@DubboReference", "type": "dubbo"}
            ],
        }
        valid, errors = validate_config(config)
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_missing_rpc_annotations_key_is_valid(self):
        valid, errors = validate_config({"outputLanguage": "en"})
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_null_rpc_annotations_invalid(self):
        valid, errors = validate_config({"rpcAnnotations": None})
        self.assertFalse(valid)
        self.assertTrue(any("rpcAnnotations" in e for e in errors))

    def test_valid_exclude_services_in_config(self):
        config = {"excludeServices": ["common", "shared", "libs"]}
        valid, errors = validate_config(config)
        self.assertTrue(valid)
        self.assertEqual(errors, [])

    def test_null_exclude_services_invalid(self):
        valid, errors = validate_config({"excludeServices": None})
        self.assertFalse(valid)
        self.assertTrue(any("excludeServices" in e for e in errors))


class TestConfigLoading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _write_config(self, data: dict) -> str:
        path = os.path.join(self.tmp, "config.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def test_load_config_from_file(self):
        path = self._write_config(
            {
                "outputLanguage": "zh",
                "rpcAnnotations": [
                    {"provider": "@MoaProvider", "consumer": "@MoaConsumer", "type": "moa"}
                ],
            }
        )
        config = load_config(path)
        self.assertEqual(config["outputLanguage"], "zh")
        self.assertEqual(len(config["rpcAnnotations"]), 1)

    def test_load_config_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            load_config(os.path.join(self.tmp, "missing.json"))

    def test_merge_config_overlay(self):
        base = {"outputLanguage": "en", "autoUpdate": True}
        override = {"outputLanguage": "zh", "rpcAnnotations": []}
        merged = merge_config(base, override)
        self.assertEqual(merged["outputLanguage"], "zh")
        self.assertTrue(merged["autoUpdate"])
        self.assertEqual(merged["rpcAnnotations"], [])

    def test_load_and_merge_config_with_defaults(self):
        path = self._write_config({"outputLanguage": "zh"})
        defaults = {"autoUpdate": False, "outputLanguage": "en"}
        config, valid, errors = load_and_merge_config(path, defaults=defaults)
        self.assertTrue(valid)
        self.assertEqual(errors, [])
        self.assertEqual(config["outputLanguage"], "zh")
        self.assertFalse(config["autoUpdate"])

    def test_load_and_merge_config_invalid_rpc(self):
        path = self._write_config({"rpcAnnotations": [{"provider": "@X"}]})
        config, valid, errors = load_and_merge_config(path)
        self.assertFalse(valid)
        self.assertTrue(len(errors) > 0)
        self.assertIn("rpcAnnotations", config)


if __name__ == "__main__":
    unittest.main()
