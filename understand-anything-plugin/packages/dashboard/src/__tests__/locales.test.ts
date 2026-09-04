import { describe, expect, it } from "vitest";
import type { EdgeType, GraphNode, KnowledgeGraph, NodeType } from "@understand-anything/core/types";
import { locales, resolveLocaleKey, resolvePreferredLocaleKey } from "../locales";
import { beginnerGuideCopy, complexityLabels, deriveBeginnerGuide, edgeCategoryLabels, edgeDirectionalLabel, nodeTypeLabels } from "../locales/displayLabels";

const NODE_TYPES = {
  file: true, function: true, class: true, module: true, concept: true,
  config: true, document: true, service: true, table: true, endpoint: true,
  pipeline: true, schema: true, resource: true,
  domain: true, flow: true, step: true,
  article: true, entity: true, topic: true, claim: true, source: true,
  page: true, screen: true, component: true, componentSet: true, instance: true, token: true,
} satisfies Record<NodeType, true>;

const EDGE_TYPES = {
  imports: true, exports: true, contains: true, inherits: true, implements: true,
  calls: true, subscribes: true, publishes: true, middleware: true,
  reads_from: true, writes_to: true, transforms: true, validates: true,
  depends_on: true, tested_by: true, configures: true, related: true, similar_to: true,
  deploys: true, serves: true, provisions: true, triggers: true,
  migrates: true, documents: true, routes: true, defines_schema: true,
  contains_flow: true, flow_step: true, cross_domain: true,
  cites: true, contradicts: true, builds_on: true, exemplifies: true, categorized_under: true, authored_by: true,
  instance_of: true, variant_of: true, uses_token: true,
} satisfies Record<EdgeType, true>;

const EDGE_CATEGORIES = ["structural", "behavioral", "data-flow", "dependencies", "semantic", "infrastructure", "domain", "knowledge", "design"] as const;

describe("resolveLocaleKey", () => {
  it("resolves Japanese locale variants to the Japanese UI", () => {
    expect(resolveLocaleKey("ja")).toBe("ja");
    expect(resolveLocaleKey("ja-JP")).toBe("ja");
    expect(resolveLocaleKey("ja_JP")).toBe("ja");
    expect(resolveLocaleKey("japanese")).toBe("ja");
  });

  it("keeps the existing English fallback for unknown or missing languages", () => {
    expect(resolveLocaleKey(undefined)).toBe("en");
    expect(resolveLocaleKey("en-US")).toBe("en");
    expect(resolveLocaleKey("fr")).toBe("en");
  });

  it("prioritizes URL language, then config, browser, and English fallback", () => {
    expect(resolvePreferredLocaleKey("ja-JP", "en", "ko-KR")).toBe("ja");
    expect(resolvePreferredLocaleKey(undefined, "en", "ja-JP")).toBe("en");
    expect(resolvePreferredLocaleKey(undefined, undefined, "ja-JP")).toBe("ja");
    expect(resolvePreferredLocaleKey(undefined, undefined, undefined)).toBe("en");
  });

  it("has complete localized node, complexity, and directional edge labels in every locale", () => {
    for (const [key, locale] of Object.entries(locales)) {
      for (const type of Object.keys(NODE_TYPES) as NodeType[]) {
        expect(nodeTypeLabels[key as keyof typeof locales][type]).toBeTruthy();
      }
      for (const complexity of ["simple", "moderate", "complex"] as const) {
        expect(complexityLabels[key as keyof typeof locales][complexity]).toBeTruthy();
      }
      for (const edgeType of Object.keys(EDGE_TYPES) as EdgeType[]) {
        expect(locale.edgeLabels[edgeType].forward.trim()).not.toBe("");
        expect(locale.edgeLabels[edgeType].backward.trim()).not.toBe("");
      }
      for (const category of EDGE_CATEGORIES) {
        expect(edgeCategoryLabels[key as keyof typeof locales][category].trim()).not.toBe("");
      }
      const copy = beginnerGuideCopy[key as keyof typeof locales];
      expect(copy.projectPurpose.trim()).not.toBe("");
      expect(copy.majorScreens.trim()).not.toBe("");
      expect(copy.dataStorage.trim()).not.toBe("");
      expect(copy.screensAnswer("screen").trim()).not.toBe("");
      expect(copy.storageAnswer("database").trim()).not.toBe("");
    }
  });

  it("derives guide answers only from graph evidence and uses localized fallbacks", () => {
    const page: GraphNode = { id: "page", type: "page", name: "Dashboard", filePath: "src/pages/Dashboard.tsx", summary: "", tags: [], complexity: "simple" };
    const table: GraphNode = { id: "table", type: "table", name: "users", filePath: "db/schema.sql", summary: "", tags: [], complexity: "simple" };
    const graph: KnowledgeGraph = {
      version: "1",
      project: { name: "demo", languages: [], frameworks: [], description: "A dashboard for teams.", analyzedAt: "", gitCommitHash: "" },
      nodes: [page, table],
      edges: [],
      layers: [
        { id: "layer:ui", name: "UI", description: "", nodeIds: ["page"] },
        { id: "layer:data", name: "Data", description: "", nodeIds: ["table"] },
      ],
      tour: [{ order: 1, title: "Dashboard", description: "", nodeIds: ["page"] }],
    };
    const guide = deriveBeginnerGuide(graph, "en");
    expect(guide.purpose).toBe("A dashboard for teams.");
    expect(guide.screens).toContain("src/pages/Dashboard.tsx");
    expect(guide.storage).toContain("db/schema.sql");

    const empty = deriveBeginnerGuide({ ...graph, project: { ...graph.project, description: "" }, nodes: [], layers: [], tour: [] }, "ja");
    expect(empty.purpose).toBe(beginnerGuideCopy.ja.noDescription);
    expect(empty.screens).toBe(beginnerGuideCopy.ja.noScreens);
    expect(empty.storage).toBe(beginnerGuideCopy.ja.noStorage);
  });

  it("uses directional labels for every known edge and keeps an unknown-value fallback", () => {
    for (const edgeType of Object.keys(EDGE_TYPES) as EdgeType[]) {
      expect(edgeDirectionalLabel(locales.ja.edgeLabels, edgeType, true)).toBe(locales.ja.edgeLabels[edgeType].forward);
      expect(edgeDirectionalLabel(locales.ja.edgeLabels, edgeType, false)).toBe(locales.ja.edgeLabels[edgeType].backward);
    }
    expect(edgeDirectionalLabel(locales.en.edgeLabels, "runtime_only", false)).toBe("Runtime Only (reverse)");
  });
});
