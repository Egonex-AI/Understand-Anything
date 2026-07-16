import { describe, it, expect } from "vitest";
import { ALL_NODE_TYPES } from "../store";
import type { NodeType as CoreNodeType } from "@understand-anything/core/types";

/**
 * Guard for the node-type FILTER / EXPORT path.
 *
 * `filters.nodeTypes` is initialised from ALL_NODE_TYPES, and
 * ExportMenu.exportJSON always runs filterNodes() with that set. Any core
 * NodeType missing from ALL_NODE_TYPES is therefore silently stripped from a
 * freshly-loaded graph on export — which is exactly what dropped every
 * kind:"design" (Figma) node and its edges before this fix (PR #516 review).
 *
 * EXPECTED_NODE_TYPES is compile-time exhaustive over the core NodeType union
 * via `satisfies Record<CoreNodeType, true>`:
 *   • Add a NodeType to core → this object is missing a key → the dashboard
 *     `build` (tsc -b) fails until it is listed here.
 *   • The runtime checks below then fail until it is ALSO added to
 *     ALL_NODE_TYPES.
 * Together they make it impossible to add a core NodeType that export would
 * silently drop.
 */
const EXPECTED_NODE_TYPES = {
  // code (5)
  file: true, function: true, class: true, module: true, concept: true,
  // non-code (8)
  config: true, document: true, service: true, table: true, endpoint: true,
  pipeline: true, schema: true, resource: true,
  // domain (3)
  domain: true, flow: true, step: true,
  // knowledge (5)
  article: true, entity: true, topic: true, claim: true, source: true,
  // design (6) — Figma graphs must remain exportable by default
  page: true, screen: true, component: true, componentSet: true, instance: true, token: true,
} satisfies Record<CoreNodeType, true>;

const DESIGN_TYPES = ["page", "screen", "component", "componentSet", "instance", "token"] as const;

describe("ALL_NODE_TYPES (filter / export default set)", () => {
  it('includes all 6 design node types so kind:"design" graphs survive JSON export', () => {
    for (const t of DESIGN_TYPES) {
      expect(ALL_NODE_TYPES).toContain(t);
    }
  });

  it("contains every core NodeType (regression guard)", () => {
    for (const t of Object.keys(EXPECTED_NODE_TYPES)) {
      expect(ALL_NODE_TYPES).toContain(t);
    }
  });

  it("has no duplicates and no types beyond the core set", () => {
    expect(new Set(ALL_NODE_TYPES).size).toBe(ALL_NODE_TYPES.length);
    expect(ALL_NODE_TYPES.length).toBe(Object.keys(EXPECTED_NODE_TYPES).length);
  });
});
