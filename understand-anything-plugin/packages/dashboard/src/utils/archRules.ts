import type { GraphEdge, KnowledgeGraph } from "@understand-anything/core/types";
import { containsParents, dependencyOf, edgeKey, selfAndAncestors } from "./dependencies";

/** Mirrors core's arch-rules.ts (redeclared: the dashboard may only import core's browser-safe subpaths). */
export interface ArchRule {
  id: string;
  from: string;
  to: string;
  description: string;
  enabled: boolean;
}

export interface ArchRulesDocument {
  version: 1;
  rules: ArchRule[];
}

export interface Violation {
  ruleId: string;
  edge: GraphEdge;
  /** The node that must not depend on `dependency`. */
  dependent: string;
  dependency: string;
}

export interface RulesEvaluation {
  violations: Violation[];
  /** Rule id → its violations (rules without violations are absent). */
  byRule: Map<string, Violation[]>;
  /** Both ends of every violation plus their containing files. */
  nodeIds: Set<string>;
  /** edgeKey(source, target) of violating edges, also lifted to containing files. */
  edgeKeys: Set<string>;
  /** Rule id → error message for selectors that could not be parsed. */
  invalid: Map<string, string>;
}

export const LAYER_PREFIX = "layer:";
const RULE_ARROW = /\s+-\/->\s+|\s+!->\s+/;

/**
 * Translate a path glob to a RegExp: `**` spans directories, `*` and `?`
 * stay within one segment, `{a,b}` alternates. A glob without wildcards
 * matches the path itself and everything below it (`src/ui` ≈ `src/ui/**`).
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!/[*?{]/.test(g)) {
    const literal = g.replace(/[.+^$()|[\]\\]/g, "\\$&");
    return new RegExp(`^${literal}(?:/.*)?$`);
  }
  let re = "";
  let inGroup = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**/` also matches zero directories.
        if (g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      re += "(?:";
      inGroup = true;
    } else if (c === "}" && inGroup) {
      re += ")";
      inGroup = false;
    } else if (c === "," && inGroup) {
      re += "|";
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  if (inGroup) throw new Error(`Unclosed "{" in ${glob}`);
  return new RegExp(`^${re}$`);
}

/** Parse `from -/-> to` (or `from !-> to`) into a rule's selectors. */
export function parseRuleText(text: string): { from: string; to: string } | null {
  const parts = text.trim().split(RULE_ARROW);
  if (parts.length !== 2) return null;
  const [from, to] = parts.map((p) => p.trim());
  return from && to ? { from, to } : null;
}

export function formatRule(rule: Pick<ArchRule, "from" | "to">): string {
  return `${rule.from} -/-> ${rule.to}`;
}

type Matcher = (nodeId: string) => boolean;

interface MatchContext {
  pathOf: (id: string) => string | undefined;
  layersOf: (id: string) => Set<string>;
  layers: KnowledgeGraph["layers"];
}

function compileSelector(selector: string, ctx: MatchContext): Matcher {
  const sel = selector.trim();
  if (sel.toLowerCase().startsWith(LAYER_PREFIX)) {
    const wanted = sel.slice(LAYER_PREFIX.length).trim().toLowerCase();
    // Accept the full layer id ("layer:ui"), the id without its "layer:"
    // prefix ("ui"), or the display name ("UI"), case-insensitively.
    const ids = new Set(
      ctx.layers
        .filter((l) => {
          const id = l.id.toLowerCase();
          return (
            id === wanted ||
            id === `${LAYER_PREFIX}${wanted}` ||
            l.name.toLowerCase() === wanted
          );
        })
        .map((l) => l.id),
    );
    return (id) => {
      for (const layer of ctx.layersOf(id)) if (ids.has(layer)) return true;
      return false;
    };
  }
  const re = globToRegExp(sel);
  return (id) => {
    const p = ctx.pathOf(id);
    return p !== undefined && re.test(p);
  };
}

/**
 * Check every enabled rule against the graph's dependency edges. A rule is
 * violated by each edge whose dependent end matches `from` and whose
 * dependency end matches `to`. Function/class nodes inherit their file's
 * path and layers.
 */
export function evaluateRules(
  graph: Pick<KnowledgeGraph, "nodes" | "edges" | "layers">,
  rules: ArchRule[],
): RulesEvaluation {
  const parents = containsParents(graph);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const directLayers = new Map<string, Set<string>>();
  for (const layer of graph.layers) {
    for (const id of layer.nodeIds) {
      let set = directLayers.get(id);
      if (!set) directLayers.set(id, (set = new Set()));
      set.add(layer.id);
    }
  }
  const emptySet = new Set<string>();
  const ctx: MatchContext = {
    layers: graph.layers,
    pathOf: (id) => {
      for (const a of selfAndAncestors(id, parents)) {
        const p = nodesById.get(a)?.filePath;
        if (p) return p.replace(/\\/g, "/").replace(/^\.\//, "");
      }
      return undefined;
    },
    layersOf: (id) => {
      for (const a of selfAndAncestors(id, parents)) {
        const s = directLayers.get(a);
        if (s) return s;
      }
      return emptySet;
    },
  };

  const result: RulesEvaluation = {
    violations: [],
    byRule: new Map(),
    nodeIds: new Set(),
    edgeKeys: new Set(),
    invalid: new Map(),
  };
  const compiled: { rule: ArchRule; from: Matcher; to: Matcher }[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      compiled.push({ rule, from: compileSelector(rule.from, ctx), to: compileSelector(rule.to, ctx) });
    } catch (err) {
      result.invalid.set(rule.id, err instanceof Error ? err.message : String(err));
    }
  }
  if (compiled.length === 0) return result;

  const topOf = (id: string) => {
    const chain = selfAndAncestors(id, parents);
    return chain[chain.length - 1];
  };
  for (const edge of graph.edges) {
    const dep = dependencyOf(edge);
    if (!dep) continue;
    for (const { rule, from, to } of compiled) {
      if (!from(dep.dependent) || !to(dep.dependency)) continue;
      const v: Violation = { ruleId: rule.id, edge, ...dep };
      result.violations.push(v);
      const list = result.byRule.get(rule.id);
      if (list) list.push(v);
      else result.byRule.set(rule.id, [v]);
      for (const id of [dep.dependent, dep.dependency]) {
        for (const a of selfAndAncestors(id, parents)) result.nodeIds.add(a);
      }
      result.edgeKeys.add(edgeKey(edge.source, edge.target));
      result.edgeKeys.add(edgeKey(topOf(edge.source), topOf(edge.target)));
    }
  }
  return result;
}
