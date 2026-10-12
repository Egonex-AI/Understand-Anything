import type { TopLevelSegment, TopLevelSegmentKind } from "../../types.js";
import type { TreeSitterNode } from "./types.js";

/** Max characters kept in a segment's `text` preview. */
export const SEGMENT_TEXT_MAX = 80;

/** Kinds that always form their own segment instead of merging with neighbours. */
const STANDALONE: ReadonlySet<TopLevelSegmentKind> = new Set(["guard", "iife"]);

export interface SegmentClassifier {
  /** Return null when the node is already represented as a symbol/import/export. */
  classify(node: TreeSitterNode): TopLevelSegmentKind | null;
  /** Return the callee text when `node` is a call, otherwise null. */
  callee(node: TreeSitterNode): string | null;
}

function collectCalls(node: TreeSitterNode, classifier: SegmentClassifier, out: string[]): void {
  const callee = classifier.callee(node);
  if (callee !== null && !out.includes(callee)) out.push(callee);
  for (const child of node.namedChildren) collectCalls(child, classifier, out);
}

function preview(node: TreeSitterNode): string {
  const firstLine = node.text.split("\n", 1)[0].trim();
  return firstLine.length > SEGMENT_TEXT_MAX
    ? `${firstLine.slice(0, SEGMENT_TEXT_MAX - 1)}…`
    : firstLine;
}

/**
 * Walk the root's direct children and group the ones no symbol covers
 * ("gaps" between functions/classes/imports) into top-level segments.
 *
 * - Consecutive `statement` / `config` nodes of the same kind merge into one segment.
 * - `guard` and `iife` nodes are always standalone.
 * - Comments neither start nor break a segment.
 * - Any handled node (symbol, import, export) closes the current segment.
 */
export function collectTopLevelSegments(
  root: TreeSitterNode,
  classifier: SegmentClassifier,
): TopLevelSegment[] {
  const segments: TopLevelSegment[] = [];
  let current: TopLevelSegment | null = null;

  for (const node of root.namedChildren) {
    if (node.type === "comment") continue;
    const kind = classifier.classify(node);
    if (kind === null) {
      current = null;
      continue;
    }
    const start = node.startPosition.row + 1;
    const end = node.endPosition.row + 1;
    if (current && current.kind === kind && !STANDALONE.has(kind)) {
      current.lineRange[1] = end;
      collectCalls(node, classifier, current.calls);
      continue;
    }
    current = { kind, lineRange: [start, end], calls: [], text: preview(node) };
    collectCalls(node, classifier, current.calls);
    segments.push(current);
    if (STANDALONE.has(kind)) current = null;
  }

  return segments;
}
