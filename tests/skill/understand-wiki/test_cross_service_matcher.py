#!/usr/bin/env python3
"""
test_cross_service_matcher.py — Tests for the cross-service relationship matcher.

Run from the repo root:
    python -m unittest tests.skill.understand-wiki.test_cross_service_matcher -v

Or with pytest:
    pytest tests/skill/understand-wiki/test_cross_service_matcher.py -v
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any


_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "cross-service-matcher.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("cross_service_matcher", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["cross_service_matcher"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()


def _make_kg(nodes: list, edges: list) -> dict:
    return {
        "version": "1.0.0",
        "project": {
            "name": "test-service",
            "languages": ["java"],
            "frameworks": ["spring"],
            "description": "Test",
            "analyzedAt": "2026-01-01T00:00:00Z",
            "gitCommitHash": "abc123",
        },
        "nodes": nodes,
        "edges": edges,
        "layers": [],
        "tour": [],
    }


class TestExtractRpcProviders(unittest.TestCase):
    def test_extracts_provides_rpc_edges(self):
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/PaymentFacadeImpl.java:PaymentFacadeImpl",
                    "type": "service",
                    "name": "PaymentFacadeImpl",
                    "summary": "Implements PaymentFacade RPC interface: createPayment(), queryPayment()",
                    "tags": ["rpc-provider", "moa"],
                    "complexity": "moderate",
                    "filePath": "src/PaymentFacadeImpl.java",
                },
                {
                    "id": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "class",
                    "name": "PaymentFacade",
                    "summary": "Payment facade interface",
                    "tags": ["interface"],
                    "complexity": "simple",
                    "filePath": "src/PaymentFacade.java",
                },
            ],
            edges=[
                {
                    "source": "class:src/PaymentFacadeImpl.java:PaymentFacadeImpl",
                    "target": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "provides_rpc",
                    "direction": "forward",
                    "weight": 0.9,
                }
            ],
        )
        providers = mod.extract_rpc_providers(kg, "payment-service")
        self.assertEqual(len(providers), 1)
        self.assertEqual(providers[0]["service"], "payment-service")
        self.assertEqual(providers[0]["interface"], "PaymentFacade")
        self.assertEqual(providers[0]["implementor"], "PaymentFacadeImpl")

    def test_returns_empty_for_no_rpc_edges(self):
        kg = _make_kg(
            nodes=[{"id": "file:src/Main.java", "type": "file", "name": "Main.java", "summary": "Entry", "tags": ["entry"], "complexity": "simple"}],
            edges=[],
        )
        providers = mod.extract_rpc_providers(kg, "test-service")
        self.assertEqual(providers, [])


class TestExtractRpcConsumers(unittest.TestCase):
    def test_extracts_consumes_rpc_edges(self):
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/OrderService.java:OrderService",
                    "type": "class",
                    "name": "OrderService",
                    "summary": "Manages order creation",
                    "tags": ["service", "rpc-consumer"],
                    "complexity": "moderate",
                    "filePath": "src/OrderService.java",
                },
                {
                    "id": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "class",
                    "name": "PaymentFacade",
                    "summary": "Payment facade interface",
                    "tags": ["interface"],
                    "complexity": "simple",
                    "filePath": "src/PaymentFacade.java",
                },
            ],
            edges=[
                {
                    "source": "class:src/OrderService.java:OrderService",
                    "target": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "consumes_rpc",
                    "direction": "forward",
                    "weight": 0.8,
                }
            ],
        )
        consumers = mod.extract_rpc_consumers(kg, "order-service")
        self.assertEqual(len(consumers), 1)
        self.assertEqual(consumers[0]["service"], "order-service")
        self.assertEqual(consumers[0]["interface"], "PaymentFacade")
        self.assertEqual(consumers[0]["consumer_class"], "OrderService")


class TestMatchRpcRelationships(unittest.TestCase):
    def test_matches_consumer_to_provider_across_services(self):
        providers = [
            {
                "service": "payment-service",
                "interface": "PaymentFacade",
                "implementor": "PaymentFacadeImpl",
                "implementor_id": "class:src/PaymentFacadeImpl.java:PaymentFacadeImpl",
                "file": "src/PaymentFacadeImpl.java",
                "methods": ["createPayment", "queryPayment"],
            }
        ]
        consumers = [
            {
                "service": "order-service",
                "interface": "PaymentFacade",
                "consumer_class": "OrderService",
                "consumer_id": "class:src/OrderService.java:OrderService",
                "file": "src/OrderService.java",
            }
        ]
        rels = mod.match_rpc_relationships(providers, consumers)
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["caller"]["service"], "order-service")
        self.assertEqual(rels[0]["callee"]["service"], "payment-service")
        self.assertEqual(rels[0]["callee"]["interface"], "PaymentFacade")
        self.assertEqual(rels[0]["type"], "moa_rpc")
        self.assertEqual(rels[0]["evidence"], "script-matched")
        self.assertEqual(rels[0]["confidence"], "high")

    def test_ignores_intra_service_matches(self):
        providers = [
            {
                "service": "order-service",
                "interface": "InternalFacade",
                "implementor": "InternalFacadeImpl",
                "implementor_id": "class:x",
                "file": "src/x.java",
                "methods": [],
            }
        ]
        consumers = [
            {
                "service": "order-service",
                "interface": "InternalFacade",
                "consumer_class": "SomeService",
                "consumer_id": "class:y",
                "file": "src/y.java",
            }
        ]
        rels = mod.match_rpc_relationships(providers, consumers)
        self.assertEqual(len(rels), 0)

    def test_no_match_for_unrelated_interfaces(self):
        providers = [
            {
                "service": "payment-service",
                "interface": "PaymentFacade",
                "implementor": "PaymentFacadeImpl",
                "implementor_id": "class:x",
                "file": "src/x.java",
                "methods": [],
            }
        ]
        consumers = [
            {
                "service": "order-service",
                "interface": "InventoryFacade",
                "consumer_class": "OrderService",
                "consumer_id": "class:y",
                "file": "src/y.java",
            }
        ]
        rels = mod.match_rpc_relationships(providers, consumers)
        self.assertEqual(len(rels), 0)

    def test_method_level_matching_includes_methods(self):
        """When providers have methods, matching should include them in callee."""
        providers = [
            {
                "service": "order-service",
                "interface": "OrderService",
                "implementor": "OrderServiceImpl",
                "implementor_id": "class:OrderServiceImpl.java:OrderServiceImpl",
                "file": "src/OrderServiceImpl.java",
                "methods": ["createOrder", "getOrder"],
            }
        ]
        consumers = [
            {
                "service": "payment-service",
                "interface": "OrderService",
                "consumer_class": "PaymentHandler",
                "consumer_id": "class:PaymentHandler.java:PaymentHandler",
                "file": "src/PaymentHandler.java",
            }
        ]
        result = mod.match_rpc_relationships(providers, consumers)
        self.assertEqual(len(result), 1)
        rel = result[0]
        self.assertIn("methods", rel["callee"])
        self.assertEqual(rel["callee"]["methods"], ["createOrder", "getOrder"])


class TestMatchEventRelationships(unittest.TestCase):
    def test_outputs_topic_publisher_subscribers_format(self):
        publishers = [
            {
                "service": "payment-service",
                "topic": "payment.completed",
                "publisher_id": "function:src/PaymentService.java:processPayment",
                "publisher_name": "PaymentService",
                "file": "src/PaymentService.java",
            }
        ]
        subscribers = [
            {
                "service": "inventory-service",
                "topic": "payment.completed",
                "subscriber_id": "function:src/InventoryListener.java:onPaymentCompleted",
                "subscriber_name": "InventoryListener",
                "file": "src/InventoryListener.java",
            }
        ]
        rels = mod.match_event_relationships(publishers, subscribers)
        self.assertEqual(len(rels), 1)
        rel = rels[0]
        self.assertEqual(rel["topic"], "payment.completed")
        self.assertEqual(rel["publisher"], "payment-service")
        self.assertEqual(rel["subscribers"], ["inventory-service"])
        self.assertEqual(rel["evidence"], "script-matched")
        self.assertEqual(rel["confidence"], "high")
        self.assertNotIn("caller", rel)
        self.assertNotIn("callee", rel)

    def test_aggregates_multiple_subscribers_per_topic(self):
        publishers = [
            {"service": "order-service", "topic": "order.created", "publisher_id": "x", "publisher_name": "OrderService", "file": "a.java"},
        ]
        subscribers = [
            {"service": "payment-service", "topic": "order.created", "subscriber_id": "y", "subscriber_name": "PaymentListener", "file": "b.java"},
            {"service": "notification-service", "topic": "order.created", "subscriber_id": "z", "subscriber_name": "NotifyListener", "file": "c.java"},
        ]
        rels = mod.match_event_relationships(publishers, subscribers)
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["topic"], "order.created")
        self.assertEqual(rels[0]["publisher"], "order-service")
        self.assertIn("payment-service", rels[0]["subscribers"])
        self.assertIn("notification-service", rels[0]["subscribers"])

    def test_ignores_same_service_events(self):
        publishers = [{"service": "svc", "topic": "t", "publisher_id": "x", "publisher_name": "P", "file": "p.java"}]
        subscribers = [{"service": "svc", "topic": "t", "subscriber_id": "y", "subscriber_name": "S", "file": "s.java"}]
        rels = mod.match_event_relationships(publishers, subscribers)
        self.assertEqual(len(rels), 0)


class TestMatchSharedTables(unittest.TestCase):
    def test_identifies_cross_service_shared_table(self):
        accesses = [
            {"service": "order-service", "table": "orders", "access_type": "writes_to", "accessor_id": "x", "accessor_name": "OrderRepo", "file": "a.java"},
            {"service": "report-service", "table": "orders", "access_type": "reads_from", "accessor_id": "y", "accessor_name": "ReportQuery", "file": "b.java"},
        ]
        rels = mod.match_shared_tables(accesses)
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["caller"]["service"], "order-service")
        self.assertEqual(rels[0]["callee"]["service"], "report-service")
        self.assertEqual(rels[0]["type"], "database")

    def test_ignores_single_service_access(self):
        accesses = [
            {"service": "order-service", "table": "orders", "access_type": "writes_to", "accessor_id": "x", "accessor_name": "W", "file": "a.java"},
            {"service": "order-service", "table": "orders", "access_type": "reads_from", "accessor_id": "y", "accessor_name": "R", "file": "b.java"},
        ]
        rels = mod.match_shared_tables(accesses)
        self.assertEqual(len(rels), 0)


class TestExtractWrapperProviders(unittest.TestCase):
    def test_identifies_wrapper_pattern(self):
        """测试识别 wrapper 模式：同一类既有 consumes_rpc 又有 provides_rpc"""
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/UserIntimacyMoaWrapperService.java:UserIntimacyMoaWrapperService",
                    "type": "class",
                    "name": "UserIntimacyMoaWrapperService",
                    "summary": "Wrapper for UserIntimacyRemoteService",
                    "tags": ["wrapper"],
                    "complexity": "simple",
                    "filePath": "src/UserIntimacyMoaWrapperService.java",
                },
                {
                    "id": "class:src/UserIntimacyRemoteService.java:UserIntimacyRemoteService",
                    "type": "class",
                    "name": "UserIntimacyRemoteService",
                    "summary": "RPC interface",
                    "tags": ["interface"],
                    "complexity": "simple",
                    "filePath": "src/UserIntimacyRemoteService.java",
                },
                {
                    "id": "class:src/UserIntimacyRemoteServiceImpl.java:UserIntimacyRemoteServiceImpl",
                    "type": "service",
                    "name": "UserIntimacyRemoteServiceImpl",
                    "summary": "Implements UserIntimacyRemoteService",
                    "tags": ["rpc-provider"],
                    "complexity": "simple",
                    "filePath": "src/UserIntimacyRemoteServiceImpl.java",
                },
            ],
            edges=[
                {
                    "source": "class:src/UserIntimacyMoaWrapperService.java:UserIntimacyMoaWrapperService",
                    "target": "class:src/UserIntimacyRemoteService.java:UserIntimacyRemoteService",
                    "type": "consumes_rpc",
                    "direction": "forward",
                    "weight": 0.8,
                },
                {
                    "source": "class:src/UserIntimacyRemoteServiceImpl.java:UserIntimacyRemoteServiceImpl",
                    "target": "class:src/UserIntimacyRemoteService.java:UserIntimacyRemoteService",
                    "type": "provides_rpc",
                    "direction": "forward",
                    "weight": 0.9,
                },
            ],
        )
        wrappers = mod.extract_wrapper_providers(kg, "ultron-basic-user")
        self.assertEqual(len(wrappers), 1)
        self.assertEqual(wrappers[0]["wrapper_class"], "UserIntimacyMoaWrapperService")
        self.assertEqual(wrappers[0]["rpc_interface"], "UserIntimacyRemoteService")
        self.assertEqual(wrappers[0]["provider_class"], "UserIntimacyRemoteServiceImpl")

    def test_returns_empty_when_no_wrapper_pattern(self):
        """测试没有 wrapper 模式时返回空列表"""
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/OrderService.java:OrderService",
                    "type": "class",
                    "name": "OrderService",
                    "summary": "Order service",
                    "tags": ["service"],
                    "complexity": "simple",
                    "filePath": "src/OrderService.java",
                },
                {
                    "id": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "class",
                    "name": "PaymentFacade",
                    "summary": "Payment interface",
                    "tags": ["interface"],
                    "complexity": "simple",
                    "filePath": "src/PaymentFacade.java",
                },
            ],
            edges=[
                {
                    "source": "class:src/OrderService.java:OrderService",
                    "target": "class:src/PaymentFacade.java:PaymentFacade",
                    "type": "consumes_rpc",
                    "direction": "forward",
                    "weight": 0.8,
                },
            ],
        )
        wrappers = mod.extract_wrapper_providers(kg, "order-service")
        self.assertEqual(len(wrappers), 0)


class TestExtractInjects(unittest.TestCase):
    def test_extracts_injects_edges(self):
        """测试提取 injects 边"""
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/OrderService.java:OrderService",
                    "type": "class",
                    "name": "OrderService",
                    "summary": "Order service",
                    "tags": ["service"],
                    "complexity": "simple",
                    "filePath": "src/OrderService.java",
                },
                {
                    "id": "class:src/UserIntimacyMoaWrapperService.java:UserIntimacyMoaWrapperService",
                    "type": "class",
                    "name": "UserIntimacyMoaWrapperService",
                    "summary": "Wrapper service",
                    "tags": ["wrapper"],
                    "complexity": "simple",
                    "filePath": "src/UserIntimacyMoaWrapperService.java",
                },
            ],
            edges=[
                {
                    "source": "class:src/OrderService.java:OrderService",
                    "target": "class:src/UserIntimacyMoaWrapperService.java:UserIntimacyMoaWrapperService",
                    "type": "injects",
                    "direction": "forward",
                    "weight": 0.8,
                },
            ],
        )
        injects = mod.extract_injects(kg, "order-service")
        self.assertEqual(len(injects), 1)
        self.assertEqual(injects[0]["injector_class"], "OrderService")
        self.assertEqual(injects[0]["injected_class"], "UserIntimacyMoaWrapperService")
        self.assertEqual(injects[0]["service"], "order-service")

    def test_returns_empty_for_no_injects(self):
        """测试没有 injects 边时返回空列表"""
        kg = _make_kg(
            nodes=[
                {
                    "id": "class:src/OrderService.java:OrderService",
                    "type": "class",
                    "name": "OrderService",
                    "summary": "Order service",
                    "tags": ["service"],
                    "complexity": "simple",
                    "filePath": "src/OrderService.java",
                },
            ],
            edges=[],
        )
        injects = mod.extract_injects(kg, "order-service")
        self.assertEqual(len(injects), 0)


class TestMatchWrapperRpcRelationships(unittest.TestCase):
    def test_matches_wrapper_injection_across_services(self):
        """测试通过 injects 边识别跨服务 wrapper 使用"""
        wrappers = [
            {
                "service": "ultron-basic-user",
                "wrapper_class": "UserIntimacyMoaWrapperService",
                "wrapper_id": "class:wrapper",
                "wrapper_file": "src/UserIntimacyMoaWrapperService.java",
                "rpc_interface": "UserIntimacyRemoteService",
                "rpc_interface_id": "class:interface",
                "provider_class": "UserIntimacyRemoteServiceImpl",
                "provider_id": "class:provider",
            }
        ]
        injects = [
            {
                "service": "ultron-relation",
                "injector_id": "class:src/IntimacyService.java:IntimacyService",
                "injector_class": "IntimacyService",
                "injector_file": "src/IntimacyService.java",
                "injected_id": "class:wrapper",
                "injected_class": "UserIntimacyMoaWrapperService",
            }
        ]
        rels = mod.match_wrapper_rpc_relationships(wrappers, injects)
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["caller"]["service"], "ultron-relation")
        self.assertEqual(rels[0]["callee"]["service"], "ultron-basic-user")
        self.assertEqual(rels[0]["type"], "moa_rpc_via_wrapper")
        self.assertEqual(rels[0]["callee"]["wrapper"], "UserIntimacyMoaWrapperService")
        self.assertEqual(rels[0]["callee"]["interface"], "UserIntimacyRemoteService")
        self.assertEqual(rels[0]["confidence"], "high")

    def test_ignores_same_service_injection(self):
        """测试忽略同服务内的 wrapper 注入"""
        wrappers = [
            {
                "service": "ultron-basic-user",
                "wrapper_class": "UserIntimacyMoaWrapperService",
                "wrapper_id": "class:wrapper",
                "wrapper_file": "src/wrapper.java",
                "rpc_interface": "UserIntimacyRemoteService",
                "rpc_interface_id": "class:interface",
                "provider_class": "Impl",
                "provider_id": "class:provider",
            }
        ]
        injects = [
            {
                "service": "ultron-basic-user",  # 同服务
                "injector_id": "class:src/SomeService.java:SomeService",
                "injector_class": "SomeService",
                "injector_file": "src/SomeService.java",
                "injected_id": "class:wrapper",
                "injected_class": "UserIntimacyMoaWrapperService",
            }
        ]
        rels = mod.match_wrapper_rpc_relationships(wrappers, injects)
        self.assertEqual(len(rels), 0)

    def test_ignores_non_wrapper_injection(self):
        """测试忽略非 wrapper 类的注入"""
        wrappers = []  # 没有 wrapper
        injects = [
            {
                "service": "order-service",
                "injector_id": "class:src/OrderService.java:OrderService",
                "injector_class": "OrderService",
                "injector_file": "src/OrderService.java",
                "injected_id": "class:src/SomeService.java:SomeService",
                "injected_class": "SomeService",
            }
        ]
        rels = mod.match_wrapper_rpc_relationships(wrappers, injects)
        self.assertEqual(len(rels), 0)

    def test_multiple_injectors_same_wrapper(self):
        """测试多个调用者注入同一个 wrapper"""
        wrappers = [
            {
                "service": "ultron-basic-user",
                "wrapper_class": "UserIntimacyMoaWrapperService",
                "wrapper_id": "class:wrapper",
                "wrapper_file": "src/wrapper.java",
                "rpc_interface": "UserIntimacyRemoteService",
                "rpc_interface_id": "class:interface",
                "provider_class": "Impl",
                "provider_id": "class:provider",
            }
        ]
        injects = [
            {
                "service": "ultron-relation",
                "injector_id": "class:src/IntimacyService.java:IntimacyService",
                "injector_class": "IntimacyService",
                "injector_file": "src/IntimacyService.java",
                "injected_id": "class:wrapper",
                "injected_class": "UserIntimacyMoaWrapperService",
            },
            {
                "service": "ultron-relation",
                "injector_id": "class:src/AnotherService.java:AnotherService",
                "injector_class": "AnotherService",
                "injector_file": "src/AnotherService.java",
                "injected_id": "class:wrapper",
                "injected_class": "UserIntimacyMoaWrapperService",
            },
        ]
        rels = mod.match_wrapper_rpc_relationships(wrappers, injects)
        self.assertEqual(len(rels), 2)  # 两个不同的调用者
        self.assertEqual(rels[0]["caller"]["method"], "IntimacyService uses UserIntimacyMoaWrapperService")
        self.assertEqual(rels[1]["caller"]["method"], "AnotherService uses UserIntimacyMoaWrapperService")


if __name__ == "__main__":
    unittest.main()
