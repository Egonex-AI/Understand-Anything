"""Tests for assemble-wiki.py — wiki assembly with endpoint copy."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "assemble-wiki.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("assemble_wiki", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["assemble_wiki"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()
main = mod.main


class TestAssembleWikiEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.intermediate = os.path.join(self.tmp, "intermediate")
        self.final = os.path.join(self.tmp, "final")
        os.makedirs(self.intermediate, exist_ok=True)
        os.makedirs(os.path.join(self.intermediate, "domains"), exist_ok=True)

        with open(os.path.join(self.intermediate, "service.json"), "w") as f:
            json.dump({"name": "order-service", "description": "Orders"}, f)
        with open(os.path.join(self.intermediate, "domains", "orders.json"), "w") as f:
            json.dump({"name": "Orders", "summary": "Order domain", "flows": []}, f)

    def _run_main(self) -> None:
        old_argv = sys.argv
        old_stdout = sys.stdout
        try:
            sys.argv = [
                "assemble-wiki.py",
                self.intermediate,
                self.final,
                "abc123",
            ]
            sys.stdout = StringIO()
            main()
        finally:
            sys.argv = old_argv
            sys.stdout = old_stdout

    def test_copies_endpoints_directory(self) -> None:
        endpoints_src = os.path.join(self.intermediate, "endpoints")
        os.makedirs(endpoints_src, exist_ok=True)
        with open(os.path.join(endpoints_src, "order-service.json"), "w") as f:
            json.dump({"service": "order-service", "providers": []}, f)
        with open(os.path.join(endpoints_src, "notes.txt"), "w") as f:
            f.write("skip me")

        self._run_main()

        endpoints_dst = os.path.join(self.final, "endpoints")
        self.assertTrue(os.path.isdir(endpoints_dst))
        self.assertTrue(os.path.isfile(os.path.join(endpoints_dst, "order-service.json")))
        self.assertFalse(os.path.isfile(os.path.join(endpoints_dst, "notes.txt")))

    def test_skips_endpoints_when_missing(self) -> None:
        self._run_main()

        endpoints_dst = os.path.join(self.final, "endpoints")
        self.assertFalse(os.path.isdir(endpoints_dst))


if __name__ == "__main__":
    unittest.main()
