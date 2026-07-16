import { describe, it, expect } from "vitest";
import { STRUCTURAL_VISIBLE_TYPES } from "../GraphView";
import type { NodeType } from "@understand-anything/core/types";

/**
 * Guard for the drill-in (layer-detail) canvas node-type filter.
 *
 * `kind:"design"` (Figma) knowledge graphs reuse the structural GraphView in
 * v1 — there is no separate design view. The drill-in filter only renders node
 * types listed in STRUCTURAL_VISIBLE_TYPES, so every non-knowledge core
 * NodeType (including the 6 design types) must be present or design nodes
 * vanish the moment you click into a layer.
 */

/**
 * Knowledge node types render in the dedicated KnowledgeGraphView, NOT the
 * structural drill-in. They are the ONLY core NodeTypes intentionally excluded
 * from STRUCTURAL_VISIBLE_TYPES.
 */
const KNOWLEDGE_TYPES = ["article", "entity", "topic", "claim", "source"] as const;
type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/**
 * Exhaustive, compile-time-checked mirror of every NON-knowledge core
 * NodeType. The `satisfies Record<Exclude<NodeType, KnowledgeType>, true>`
 * constraint is the regression guard:
 *
 *   • Add a new design (or any non-knowledge) NodeType to core → this object is
 *     missing a key → `tsc -b` (the dashboard `build`) fails until it's listed.
 *   • The runtime loop below then fails until that type is ALSO added to
 *     STRUCTURAL_VISIBLE_TYPES.
 *
 * Together they make it impossible to add a design NodeType without keeping it
 * visible on drill-in. Removing a knowledge type, or adding an extra key here,
 * is likewise rejected by `satisfies`.
 */
const EXPECTED_STRUCTURAL_TYPES = {
  // code (5)
  file: true, function: true, class: true, module: true, concept: true,
  // non-code (8)
  config: true, document: true, service: true, table: true, endpoint: true,
  pipeline: true, schema: true, resource: true,
  // domain (3)
  domain: true, flow: true, step: true,
  // design (6) — Figma graphs reuse the structural view in v1
  page: true, screen: true, component: true, componentSet: true, instance: true, token: true,
} satisfies Record<Exclude<NodeType, KnowledgeType>, true>;

const DESIGN_TYPES = [
  "page",
  "screen",
  "component",
  "componentSet",
  "instance",
  "token",
] as const;

describe("STRUCTURAL_VISIBLE_TYPES (drill-in / layer-detail visibility)", () => {
  it('includes all 6 design node types so kind:"design" graphs render on drill-in', () => {
    for (const t of DESIGN_TYPES) {
      expect(STRUCTURAL_VISIBLE_TYPES.has(t)).toBe(true);
    }
  });

  it("includes the core structural node types", () => {
    for (const t of ["file", "function", "class", "service", "domain", "flow"]) {
      expect(STRUCTURAL_VISIBLE_TYPES.has(t)).toBe(true);
    }
  });

  it("excludes knowledge node types (they render in KnowledgeGraphView)", () => {
    for (const t of KNOWLEDGE_TYPES) {
      expect(STRUCTURAL_VISIBLE_TYPES.has(t)).toBe(false);
    }
  });

  it("contains every non-knowledge core NodeType (regression guard)", () => {
    // EXPECTED_STRUCTURAL_TYPES is compile-time exhaustive over
    // Exclude<NodeType, KnowledgeType>, so a newly added design NodeType that
    // someone forgot to list in STRUCTURAL_VISIBLE_TYPES trips this assertion.
    for (const t of Object.keys(EXPECTED_STRUCTURAL_TYPES)) {
      expect(STRUCTURAL_VISIBLE_TYPES.has(t)).toBe(true);
    }
  });

  it("contains no node types beyond the expected non-knowledge set", () => {
    expect(STRUCTURAL_VISIBLE_TYPES.size).toBe(
      Object.keys(EXPECTED_STRUCTURAL_TYPES).length,
    );
  });
});
