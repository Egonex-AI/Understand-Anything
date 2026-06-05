"""Tests for build-endpoint-index.py — endpoint navigation index builder."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "build-endpoint-index.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("build_endpoint_index", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_endpoint_index"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()
build_endpoint_index = mod.build_endpoint_index


def _write_service_doc(wiki_dir: Path, service: str, doc: dict) -> None:
    endpoints_dir = wiki_dir / "endpoints"
    endpoints_dir.mkdir(parents=True, exist_ok=True)
    (endpoints_dir / f"{service}.json").write_text(
        json.dumps(doc),
        encoding="utf-8",
    )


class TestBuildEndpointIndex(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.wiki_dir = self.tmp_dir / "wiki"
        self.wiki_dir.mkdir(parents=True)

    def test_basic_index_structure(self) -> None:
        """Two services — byService, byProtocol, and byTopic all populated."""
        _write_service_doc(self.wiki_dir, "order-service", {
            "service": "order-service",
            "description": "RPC/MQ endpoints for order-service",
            "providers": [{
                "identifier": "OrderService",
                "protocol": "dubbo",
                "framework": "DubboService",
                "methods": [
                    {"name": "createOrder"},
                    {"name": "getOrder"},
                    {"name": "cancelOrder"},
                ],
            }],
            "consumers": [{
                "identifier": "UserServiceConsumer",
                "protocol": "moa",
                "framework": "MoaConsumer",
            }],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "publisher",
            }],
        })
        _write_service_doc(self.wiki_dir, "payment-service", {
            "service": "payment-service",
            "description": "RPC/MQ endpoints for payment-service",
            "providers": [{
                "identifier": "PaymentService",
                "protocol": "moa",
                "framework": "MoaProvider",
                "methods": [
                    {"name": "pay"},
                    {"name": "refund"},
                ],
            }],
            "consumers": [],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "subscriber",
            }],
        })

        index = build_endpoint_index(str(self.wiki_dir))

        self.assertIn("generatedAt", index)
        self.assertEqual(index["totalProviders"], 2)
        self.assertEqual(index["totalConsumers"], 1)
        self.assertEqual(index["totalKafkaTopics"], 2)

        services = [s["service"] for s in index["byService"]]
        self.assertEqual(services, ["order-service", "payment-service"])

        order_svc = index["byService"][0]
        self.assertEqual(order_svc["providerCount"], 1)
        self.assertEqual(order_svc["consumerCount"], 1)
        self.assertEqual(order_svc["kafkaTopicCount"], 1)
        self.assertEqual(order_svc["protocols"], ["dubbo", "moa"])

        self.assertIn("dubbo", index["byProtocol"])
        self.assertIn("moa", index["byProtocol"])
        dubbo_entry = index["byProtocol"]["dubbo"][0]
        self.assertEqual(dubbo_entry["service"], "order-service")
        self.assertEqual(dubbo_entry["identifier"], "OrderService")
        self.assertEqual(dubbo_entry["methodCount"], 3)

        self.assertIn("order.created", index["byTopic"])
        topic_entry = index["byTopic"]["order.created"]
        self.assertEqual(topic_entry["publishers"], ["order-service"])
        self.assertEqual(topic_entry["subscribers"], ["payment-service"])

    def test_aggregates_kafka_topics(self) -> None:
        """Same topic across multiple services — publishers/subscribers merged."""
        _write_service_doc(self.wiki_dir, "order-service", {
            "service": "order-service",
            "description": "RPC/MQ endpoints for order-service",
            "providers": [],
            "consumers": [],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "publisher",
            }],
        })
        _write_service_doc(self.wiki_dir, "payment-service", {
            "service": "payment-service",
            "description": "RPC/MQ endpoints for payment-service",
            "providers": [],
            "consumers": [],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "subscriber",
            }],
        })
        _write_service_doc(self.wiki_dir, "inventory-service", {
            "service": "inventory-service",
            "description": "RPC/MQ endpoints for inventory-service",
            "providers": [],
            "consumers": [],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "subscriber",
            }],
        })

        index = build_endpoint_index(str(self.wiki_dir))

        topic_entry = index["byTopic"]["order.created"]
        self.assertEqual(topic_entry["publishers"], ["order-service"])
        self.assertEqual(
            topic_entry["subscribers"],
            ["inventory-service", "payment-service"],
        )

    def test_empty_endpoints_dir(self) -> None:
        """No endpoint files — empty index with zero counts."""
        (self.wiki_dir / "endpoints").mkdir(parents=True)

        index = build_endpoint_index(str(self.wiki_dir))

        self.assertEqual(index["totalProviders"], 0)
        self.assertEqual(index["totalConsumers"], 0)
        self.assertEqual(index["totalKafkaTopics"], 0)
        self.assertEqual(index["byService"], [])
        self.assertEqual(index["byProtocol"], {})
        self.assertEqual(index["byTopic"], {})

    def test_single_service(self) -> None:
        """One service with providers, consumers, and kafka topics."""
        _write_service_doc(self.wiki_dir, "order-service", {
            "service": "order-service",
            "description": "RPC/MQ endpoints for order-service",
            "providers": [{
                "identifier": "OrderService",
                "protocol": "dubbo",
                "framework": "DubboService",
                "methods": [{"name": "createOrder"}],
            }],
            "consumers": [{
                "identifier": "UserServiceConsumer",
                "protocol": "moa",
                "framework": "MoaConsumer",
            }],
            "kafkaTopics": [{
                "topic": "order.created",
                "role": "publisher",
            }],
        })

        index = build_endpoint_index(str(self.wiki_dir))

        self.assertEqual(index["totalProviders"], 1)
        self.assertEqual(index["totalConsumers"], 1)
        self.assertEqual(index["totalKafkaTopics"], 1)
        self.assertEqual(len(index["byService"]), 1)
        svc = index["byService"][0]
        self.assertEqual(svc["service"], "order-service")
        self.assertEqual(svc["providerCount"], 1)
        self.assertEqual(svc["consumerCount"], 1)
        self.assertEqual(svc["kafkaTopicCount"], 1)

    def test_protocol_grouping(self) -> None:
        """Services with different protocols — correctly grouped in byProtocol."""
        _write_service_doc(self.wiki_dir, "order-service", {
            "service": "order-service",
            "description": "RPC/MQ endpoints for order-service",
            "providers": [{
                "identifier": "OrderService",
                "protocol": "dubbo",
                "framework": "DubboService",
                "methods": [
                    {"name": "createOrder"},
                    {"name": "getOrder"},
                ],
            }],
            "consumers": [],
            "kafkaTopics": [],
        })
        _write_service_doc(self.wiki_dir, "payment-service", {
            "service": "payment-service",
            "description": "RPC/MQ endpoints for payment-service",
            "providers": [{
                "identifier": "PaymentService",
                "protocol": "moa",
                "framework": "MoaProvider",
                "methods": [{"name": "pay"}],
            }],
            "consumers": [],
            "kafkaTopics": [],
        })
        _write_service_doc(self.wiki_dir, "gateway-service", {
            "service": "gateway-service",
            "description": "RPC/MQ endpoints for gateway-service",
            "providers": [{
                "identifier": "GatewayApi",
                "protocol": "grpc",
                "framework": "GrpcService",
                "methods": [
                    {"name": "route"},
                    {"name": "health"},
                    {"name": "status"},
                ],
            }],
            "consumers": [],
            "kafkaTopics": [],
        })

        index = build_endpoint_index(str(self.wiki_dir))

        self.assertEqual(list(index["byProtocol"].keys()), ["dubbo", "grpc", "moa"])
        self.assertEqual(index["byProtocol"]["dubbo"][0]["methodCount"], 2)
        self.assertEqual(index["byProtocol"]["moa"][0]["methodCount"], 1)
        self.assertEqual(index["byProtocol"]["grpc"][0]["methodCount"], 3)


if __name__ == "__main__":
    unittest.main()
