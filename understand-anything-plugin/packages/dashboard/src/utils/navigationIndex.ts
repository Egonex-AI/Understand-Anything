import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

export interface NavigationIndex {
  symbols: ReadonlyMap<string, readonly string[]>;
  imports: ReadonlyMap<string, readonly string[]>;
  files: ReadonlyMap<string, GraphNode>;
  /** A node's unique containing file, when the graph provides one. */
  fileForNode: ReadonlyMap<string, string>;
}

export interface NavigationToken {
  content: string;
  types: readonly string[];
}

export function buildNavigationIndex(graph: KnowledgeGraph): NavigationIndex {
  const files = new Map(graph.nodes.filter((node) => node.type === "file").map((node) => [node.id, node]));
  const symbols = new Map<string, string[]>();
  const imports = new Map<string, string[]>();
  const fileCandidates = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string) => {
    const values = map.get(key) ?? [];
    if (!values.includes(value)) values.push(value);
    map.set(key, values);
  };
  const addFileCandidate = (nodeId: string, fileId: string) => add(fileCandidates, nodeId, fileId);
  for (const fileId of files.keys()) addFileCandidate(fileId, fileId);

  for (const edge of graph.edges) {
    if (edge.type === "imports" && files.has(edge.source) && files.has(edge.target)) add(imports, edge.source, edge.target);
    if (edge.type !== "contains" || !files.has(edge.source)) continue;
    const symbol = graph.nodes.find((node) => node.id === edge.target);
    if (symbol) addFileCandidate(symbol.id, edge.source);
    if (symbol?.type === "function" || symbol?.type === "class") add(symbols, symbol.name, edge.source);
  }
  const fileIdsByPath = new Map<string, string[]>();
  for (const file of files.values()) {
    if (!file.filePath) continue;
    add(fileIdsByPath, normalized(file.filePath), file.id);
  }
  for (const symbol of graph.nodes) {
    if (symbol.type !== "function" && symbol.type !== "class") continue;
    if (!symbol.filePath) continue;
    const containingFiles = fileIdsByPath.get(normalized(symbol.filePath)) ?? [];
    if (containingFiles.length === 1) {
      addFileCandidate(symbol.id, containingFiles[0]);
      add(symbols, symbol.name, containingFiles[0]);
    }
  }
  const fileForNode = new Map<string, string>();
  for (const [nodeId, candidates] of fileCandidates) {
    if (candidates.length === 1) fileForNode.set(nodeId, candidates[0]);
  }
  return { symbols, imports, files, fileForNode };
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/").replace(/\.(?:[cm]?[jt]sx?|json)$/i, "").replace(/\/index$/i, "");
}

function importedPathMatches(filePath: string | undefined, requested: string): boolean {
  const normalizedFilePath = normalized(filePath ?? "");
  return normalizedFilePath === requested || normalizedFilePath.endsWith(`/${requested}`);
}

function importTargetsForRequestedPath(
  index: NavigationIndex,
  sourceFileId: string,
  requested: string,
): string[] {
  return (index.imports.get(sourceFileId) ?? []).filter((id) =>
    importedPathMatches(index.files.get(id)?.filePath, requested),
  );
}

export function importTargetForSpecifier(index: NavigationIndex, sourceFileId: string, specifier: string): string | null {
  const source = index.files.get(sourceFileId);
  if (!source?.filePath) return null;
  const clean = specifier.replace(/^['"]|['"]$/g, "");
  if (clean.startsWith(".")) {
    const base = source.filePath.split("/").slice(0, -1);
    for (const part of clean.split("/")) {
      if (part === ".") continue;
      if (part === "..") base.pop(); else base.push(part);
    }
    const requested = normalized(base.join("/"));
    const matches = importTargetsForRequestedPath(index, sourceFileId, requested);
    return matches.length === 1 ? matches[0] : null;
  }

  // Resolve configured-style aliases by matching the path suffix against the
  // graph's evidenced import targets. This avoids assuming that every project
  // keeps sources under a single hard-coded directory such as `src/`.
  if (!clean.startsWith("@/") && !clean.startsWith("~/")) return null;
  const requested = normalized(clean.slice(2));
  const matches = importTargetsForRequestedPath(index, sourceFileId, requested);
  return matches.length === 1 ? matches[0] : null;
}

export function sourceFileIdForNode(index: NavigationIndex, nodeId: string): string | null {
  return index.fileForNode.get(nodeId) ?? null;
}

/**
 * Returns true only when a string token is syntactically positioned as an
 * import/export specifier or a require()/dynamic import() argument. Ordinary
 * strings are intentionally excluded even when their contents match an
 * evidenced import target.
 */
export function isImportSpecifierToken(
  lines: readonly (readonly NavigationToken[])[],
  lineIndex: number,
  tokenIndex: number,
): boolean {
  const token = lines[lineIndex]?.[tokenIndex];
  if (!token?.types.includes("string")) return false;

  const before = lines
    .slice(0, lineIndex)
    .flatMap((line) => line.map((part) => part.content))
    .concat(lines[lineIndex].slice(0, tokenIndex).map((part) => part.content))
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ");

  return /\b(?:import|export)\b[\s\S]*\bfrom\s*$/.test(before)
    || /(?:^|[;\n])\s*import\s*$/.test(before)
    || /(?:^|[^\w$.])(?:require|import)\s*\(\s*$/.test(before);
}
