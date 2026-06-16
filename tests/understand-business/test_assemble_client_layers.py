"""Tests for assemble_business_features.py — clientLayers[] shape."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(
    Path(__file__).resolve().parents[2] /
    "understand-anything-plugin" / "skills" / "understand-business"
))

from assemble_business_features import assemble_features, _build_feature_document


def _mobile_feature(name="Order Management"):
    return {
        "name": name,
        "implType": "native-specific",
        "platforms": ["ios"],
        "deliveryPlatforms": ["ios"],
        "implementations": [{"platform": "ios", "framework": "native", "ref": "mobile/ios/..."}],
        "mergedSummary": "Mobile order management",
        "facetType": "mobile",
    }


def _frontend_feature(name="Order Management"):
    return {
        "name": name,
        "implType": "frontend-web",
        "platforms": ["web"],
        "deliveryPlatforms": ["react"],
        "implementations": [],
        "mergedSummary": "Routes: /orders. API: GET /api/orders",
        "facetType": "frontend",
    }


def _association(feature_name, primary_domain="Order Management", service="order-service"):
    return {
        "featureName": feature_name,
        "primaryServer": {"domain": primary_domain, "service": service, "confidence": 0.9},
        "supportingServers": [],
        "error": None,
    }


class TestClientLayers:
    def test_single_mobile_feature_produces_client_layers(self):
        assoc = [_association("Order Management")]
        consol = {"consolidated": [_mobile_feature()], "standalone": []}
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert "clientLayers" in feat
        assert len(feat["clientLayers"]) >= 1
        assert feat["clientLayers"][0]["facetType"] == "mobile"

    def test_single_frontend_feature_produces_client_layers(self):
        assoc = [_association("Order Management")]
        consol = {"consolidated": [_frontend_feature()], "standalone": []}
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert "clientLayers" in feat
        layer = feat["clientLayers"][0]
        assert layer["facetType"] == "frontend"

    def test_backward_compat_client_layer_field_present(self):
        assoc = [_association("Order Management")]
        consol = {"consolidated": [_mobile_feature()], "standalone": []}
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert "clientLayer" in feat

    def test_backward_compat_client_layer_matches_first_client_layers_entry(self):
        assoc = [_association("Order Management")]
        consol = {"consolidated": [_mobile_feature()], "standalone": []}
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        first_layer = feat["clientLayers"][0]
        assert feat["clientLayer"]["facetType"] == first_layer["facetType"]

    def test_features_without_facet_type_default_to_mobile(self):
        """Existing features without facetType annotation should default to mobile."""
        feat_data = {
            "name": "Login",
            "implType": "native-specific",
            "platforms": ["android"],
            "deliveryPlatforms": ["android"],
            "implementations": [],
            "mergedSummary": "",
            # no facetType key
        }
        assoc = [_association("Login")]
        consol = {"consolidated": [feat_data], "standalone": []}
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert feat["clientLayers"][0]["facetType"] in ("mobile", "unknown")

    def test_frontend_only_feature_preserved_when_no_server_association(self):
        """A frontend feature with no matching server domain must still appear in output."""
        assoc = [
            {
                "featureName": "Design System",
                "primaryServer": None,
                "supportingServers": [],
                "error": None,
            }
        ]
        consol = {
            "consolidated": [
                {
                    "name": "Design System",
                    "implType": "frontend-web",
                    "platforms": ["web"],
                    "deliveryPlatforms": ["react"],
                    "implementations": [],
                    "mergedSummary": "Routes: /components",
                    "facetType": "frontend",
                }
            ],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        names = [f["name"] for f in result["features"]]
        assert "Design System" in names
        feat = next(f for f in result["features"] if f["name"] == "Design System")
        assert feat["serverLayer"]["primaryDomain"] is None

    def test_mobile_feature_server_layer_unaffected(self):
        """Mobile features still produce the same server layer shape as before."""
        assoc = [_association("Checkout", primary_domain="Checkout")]
        consol = {
            "consolidated": [
                {
                    "name": "Checkout",
                    "implType": "native-specific",
                    "platforms": ["ios", "android"],
                    "deliveryPlatforms": ["ios", "android"],
                    "implementations": [],
                    "mergedSummary": "Checkout flow",
                    "facetType": "mobile",
                }
            ],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert feat["serverLayer"]["primaryDomain"]["name"] == "Checkout"
        assert feat["serverLayer"]["primaryDomain"]["service"] == "order-service"


class TestMultiFacetMerge:
    def test_same_name_mobile_and_frontend_both_appear_in_client_layers(self):
        """Same-named features from mobile and frontend must not overwrite each other."""
        assoc = [_association("Order Management")]
        consol = {
            "consolidated": [_mobile_feature(), _frontend_feature()],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        assert len(result["features"]) == 1
        feat = result["features"][0]
        facet_types = {layer["facetType"] for layer in feat["clientLayers"]}
        assert "mobile" in facet_types
        assert "frontend" in facet_types

    def test_backward_compat_client_layer_is_first_entry(self):
        """clientLayer (singular) must equal clientLayers[0] even when multiple layers exist."""
        assoc = [_association("Order Management")]
        consol = {
            "consolidated": [_mobile_feature(), _frontend_feature()],
            "standalone": [],
        }
        result = assemble_features(assoc, consol)
        feat = result["features"][0]
        assert feat["clientLayer"] == feat["clientLayers"][0]
