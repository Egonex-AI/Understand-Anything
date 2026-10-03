import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { normalizeNodePath } from "./fileNodes";

/**
 * Graph lookups behind the code viewer's navigation aids: clickable
 * identifiers (name → nodes), the file outline and gutter range bars
 * (file → child nodes with line ranges). Built once per graph.
 */

/** Node types an identifier in source code can refer to. */
const NAVIGABLE_TYPES = new Set<GraphNode["type"]>(["function", "class", "module", "file", "component"]);

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform,
  );
/** How the Ctrl/⌘ modifier is spelled in hints on this platform. */
export const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

export interface CodeNavIndex {
  /** identifier → candidate nodes (functions/classes by name, files by base name) */
  byName: Map<string, GraphNode[]>;
  /** normalised file path → nodes inside that file that carry a line range, by start line */
  childrenByFile: Map<string, GraphNode[]>;
  /** normalised file path → normalised paths of the files it imports (graph `imports` edges) */
  importsByFile: Map<string, Set<string>>;
}

/**
 * Identifier keys for a node: its name with call parens stripped, plus the
 * last segment of qualified names (`Foo.bar`, `Foo::bar`, `Foo#bar` → `bar`)
 * and a file's base name without extension (`Breadcrumb.tsx` → `Breadcrumb`).
 */
export function identifierKeys(node: GraphNode): string[] {
  const keys = new Set<string>();
  const name = node.name.trim().replace(/\(.*\)$/, "");
  if (node.type === "file") {
    const base = name.split(/[\\/]/).pop() ?? name;
    const stem = base.replace(/\.[^.]+$/, "");
    if (IDENTIFIER_RE.test(stem)) keys.add(stem);
    return [...keys];
  }
  if (IDENTIFIER_RE.test(name)) keys.add(name);
  const last = name.split(/::|[.#]/).pop();
  if (last && IDENTIFIER_RE.test(last)) keys.add(last);
  return [...keys];
}

export function buildCodeNavIndex(graph: KnowledgeGraph | null): CodeNavIndex {
  const byName = new Map<string, GraphNode[]>();
  const childrenByFile = new Map<string, GraphNode[]>();
  const importsByFile = new Map<string, Set<string>>();
  if (!graph) return { byName, childrenByFile, importsByFile };

  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
    if (!node.filePath) continue;
    if (NAVIGABLE_TYPES.has(node.type)) {
      for (const key of identifierKeys(node)) {
        const list = byName.get(key);
        if (list) list.push(node);
        else byName.set(key, [node]);
      }
    }
    if (node.lineRange && node.type !== "file") {
      const key = normalizeNodePath(node.filePath);
      const list = childrenByFile.get(key);
      if (list) list.push(node);
      else childrenByFile.set(key, [node]);
    }
  }

  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source?.filePath || !target?.filePath) continue;
    const sourcePath = normalizeNodePath(source.filePath);
    const targetPath = normalizeNodePath(target.filePath);
    if (edge.type === "imports" && sourcePath !== targetPath) {
      const set = importsByFile.get(sourcePath);
      if (set) set.add(targetPath);
      else importsByFile.set(sourcePath, new Set([targetPath]));
    } else if (edge.type === "contains" && target.lineRange && target.type !== "file") {
      // A `contains` child recorded under a different path still belongs to the source file's outline.
      const list = childrenByFile.get(sourcePath);
      if (list && !list.includes(target)) list.push(target);
      else if (!list) childrenByFile.set(sourcePath, [target]);
    }
  }

  for (const list of childrenByFile.values()) {
    list.sort((a, b) => a.lineRange![0] - b.lineRange![0] || b.lineRange![1] - a.lineRange![1]);
  }
  return { byName, childrenByFile, importsByFile };
}

const indexCache = new WeakMap<KnowledgeGraph, CodeNavIndex>();

/** buildCodeNavIndex, memoised per graph object (the code viewer remounts often). */
export function getCodeNavIndex(graph: KnowledgeGraph): CodeNavIndex {
  let index = indexCache.get(graph);
  if (!index) {
    index = buildCodeNavIndex(graph);
    indexCache.set(graph, index);
  }
  return index;
}

/**
 * The node an identifier in `filePath` most likely refers to: a definition in
 * the same file, then one in a file this file imports (or that imported file
 * itself), then any other match. Never the file being viewed.
 */
export function resolveIdentifier(index: CodeNavIndex, name: string, filePath: string): GraphNode | null {
  const candidates = index.byName.get(name);
  if (!candidates?.length) return null;
  const here = normalizeNodePath(filePath);
  const imported = index.importsByFile.get(here);
  let best: GraphNode | null = null;
  let bestScore = -1;
  for (const node of candidates) {
    const path = normalizeNodePath(node.filePath!);
    if (node.type === "file" && path === here) continue;
    const score =
      (path === here ? 4 : imported?.has(path) ? 2 : 0) + (node.type === "file" ? 0 : 1);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

/** Prism token types whose text can name a graph node. */
export function isIdentifierToken(types: string[]): boolean {
  return types.some(
    (type) => type === "function" || type === "class-name" || type === "maybe-class-name" || type === "plain",
  );
}

export interface OutlineEntry {
  node: GraphNode;
  depth: number;
}

/** Child nodes as a nested outline: depth = how many earlier ranges enclose it. */
export function buildOutline(children: GraphNode[]): OutlineEntry[] {
  const stack: GraphNode[] = [];
  return children.map((node) => {
    const [start] = node.lineRange!;
    while (stack.length && stack[stack.length - 1].lineRange![1] < start) stack.pop();
    const depth = stack.length;
    stack.push(node);
    return { node, depth };
  });
}

export const MAX_RANGE_LANES = 4;

/**
 * Per-line gutter bars. Ranges are packed into at most MAX_RANGE_LANES
 * lanes (an enclosing range takes an outer lane); `lanes[line - 1][lane]`
 * is the node whose range covers that line in that lane.
 */
export function buildRangeLanes(
  children: GraphNode[],
  lineCount: number,
): { laneCount: number; lanes: (GraphNode | null)[][] } {
  const laneEnds: number[] = [];
  const placed: { node: GraphNode; lane: number }[] = [];
  for (const node of children) {
    const [start, end] = node.lineRange!;
    if (end < start || start > lineCount) continue;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < start);
    if (lane === -1) {
      if (laneEnds.length >= MAX_RANGE_LANES) continue;
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    placed.push({ node, lane });
  }
  const laneCount = laneEnds.length;
  const lanes: (GraphNode | null)[][] = [];
  if (laneCount === 0) return { laneCount, lanes };
  for (let i = 0; i < lineCount; i += 1) lanes.push(new Array<GraphNode | null>(laneCount).fill(null));
  for (const { node, lane } of placed) {
    const [start, end] = node.lineRange!;
    for (let line = Math.max(1, start); line <= Math.min(end, lineCount); line += 1) {
      lanes[line - 1][lane] = node;
    }
  }
  return { laneCount, lanes };
}
