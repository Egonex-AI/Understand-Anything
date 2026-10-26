import type { Locale } from "../locales";

/**
 * Helpers that turn raw enum values coming from the knowledge graph
 * (node types, complexity, edge types/categories) into localized labels.
 * Unknown values fall back to the raw string so new schema values still render.
 */

function lookup(table: object, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(table, key)) return undefined;
  const value = (table as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function complexityLabel(t: Locale, complexity: string): string {
  switch (complexity) {
    case "simple":
      return t.projectOverview.simple;
    case "moderate":
      return t.projectOverview.moderate;
    case "complex":
      return t.projectOverview.complex;
    default:
      return complexity;
  }
}

export function nodeTypeLabel(t: Locale, nodeType: string): string {
  return lookup(t.nodeTypeNames, nodeType) ?? nodeType;
}

export function edgeCategoryLabel(t: Locale, category: string): string {
  return lookup(t.edgeCategoryNames, category) ?? category.replace(/-/g, " ");
}

export function edgeTypeLabel(t: Locale, edgeType: string): string {
  if (Object.prototype.hasOwnProperty.call(t.edgeLabels, edgeType)) {
    const labels = (t.edgeLabels as Record<string, { forward: string } | undefined>)[edgeType];
    if (labels) return labels.forward;
  }
  return edgeType.replace(/_/g, " ");
}
