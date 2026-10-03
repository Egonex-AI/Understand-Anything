import type { GraphNode } from "@understand-anything/core/types";

/** Graph file paths may be written as `./src/a.ts` or `src\a.ts`; compare them normalised. */
export function normalizeNodePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export interface FileNodeIndex {
  /** normalised path → every node that points at that file */
  byPath: Map<string, GraphNode[]>;
}

export function buildFileNodeIndex(nodes: GraphNode[]): FileNodeIndex {
  const byPath = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.filePath) continue;
    const key = normalizeNodePath(node.filePath);
    const list = byPath.get(key);
    if (list) list.push(node);
    else byPath.set(key, [node]);
  }
  return { byPath };
}

/** The node that represents the whole file: a `file` node, else any node without a line range. */
export function fileNodeForPath(index: FileNodeIndex, filePath: string): GraphNode | null {
  const nodes = index.byPath.get(normalizeNodePath(filePath));
  if (!nodes?.length) return null;
  return (
    nodes.find((n) => n.type === "file") ??
    nodes.find((n) => !n.lineRange) ??
    nodes[0]
  );
}

/**
 * The most specific node covering `line` of `filePath` — the innermost
 * function/class whose lineRange contains it — falling back to the file node.
 */
export function nodeForFileLine(index: FileNodeIndex, filePath: string, line: number): GraphNode | null {
  const nodes = index.byPath.get(normalizeNodePath(filePath));
  if (!nodes?.length) return null;
  let best: GraphNode | null = null;
  for (const node of nodes) {
    if (!node.lineRange) continue;
    const [start, end] = node.lineRange;
    if (line < start || line > end) continue;
    if (!best || end - start < best.lineRange![1] - best.lineRange![0]) best = node;
  }
  return best ?? fileNodeForPath(index, filePath);
}
