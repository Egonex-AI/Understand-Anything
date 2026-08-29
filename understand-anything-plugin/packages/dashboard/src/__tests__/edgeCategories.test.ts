import { describe, it, expect } from "vitest";
import { EDGE_CATEGORY_MAP, ALL_EDGE_CATEGORIES } from "../store";
import type { EdgeType as CoreEdgeType } from "@understand-anything/core/types";

/**
 * Guard for the edge-category FILTER path — the edge analog of
 * allNodeTypes.test.ts.
 *
 * filterEdges() keeps edges whose type maps to no category, so a missing
 * entry doesn't drop edges — but it does make them invisible to the
 * FilterPanel edge-category toggles (which is exactly what happened to the
 * design edges instance_of/variant_of/uses_token before this fix).
 *
 * EXPECTED_EDGE_TYPES is compile-time exhaustive over the core EdgeType union
 * via `satisfies Record<CoreEdgeType, true>`: add an EdgeType to core and the
 * dashboard build fails until it is listed here, then the runtime checks fail
 * until it is also placed in EDGE_CATEGORY_MAP.
 */
const EXPECTED_EDGE_TYPES = {
  // structural (5)
  imports: true, exports: true, contains: true, inherits: true, implements: true,
  // behavioral (4)
  calls: true, subscribes: true, publishes: true, middleware: true,
  // data-flow (4)
  reads_from: true, writes_to: true, transforms: true, validates: true,
  // dependencies (3)
  depends_on: true, tested_by: true, configures: true,
  // semantic (2)
  related: true, similar_to: true,
  // infrastructure (8)
  deploys: true, serves: true, provisions: true, triggers: true,
  migrates: true, documents: true, routes: true, defines_schema: true,
  // domain (3)
  contains_flow: true, flow_step: true, cross_domain: true,
  // knowledge (6)
  cites: true, contradicts: true, builds_on: true, exemplifies: true,
  categorized_under: true, authored_by: true,
  // design (3) — Figma edges must be reachable from the edge-category filter
  instance_of: true, variant_of: true, uses_token: true,
} satisfies Record<CoreEdgeType, true>;

describe("EDGE_CATEGORY_MAP (edge-category filter)", () => {
  const mapped = Object.values(EDGE_CATEGORY_MAP).flat();

  it("covers every core EdgeType (regression guard)", () => {
    for (const t of Object.keys(EXPECTED_EDGE_TYPES)) {
      expect(mapped).toContain(t);
    }
  });

  it("maps each edge type to exactly one category", () => {
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(mapped.length).toBe(Object.keys(EXPECTED_EDGE_TYPES).length);
  });

  it("lists every map key in ALL_EDGE_CATEGORIES so the FilterPanel renders it", () => {
    for (const category of Object.keys(EDGE_CATEGORY_MAP)) {
      expect(ALL_EDGE_CATEGORIES).toContain(category);
    }
    expect(ALL_EDGE_CATEGORIES.length).toBe(Object.keys(EDGE_CATEGORY_MAP).length);
  });
});
