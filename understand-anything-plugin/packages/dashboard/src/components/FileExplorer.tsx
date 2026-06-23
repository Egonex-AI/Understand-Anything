import { useMemo, useState } from "react";
import type { GraphNode } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

interface FileEntry {
  name: string;
  path: string;
  type: "folder" | "file";
  children: FileEntry[];
  nodeId?: string;
}

function normalizeFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) return null;
  if (normalized.split("/").some((part) => part === "..")) return null;
  return normalized;
}

function bestFileNode(existing: GraphNode | undefined, candidate: GraphNode): GraphNode {
  if (!existing) return candidate;
  if (existing.type !== "file" && candidate.type === "file") return candidate;
  return existing;
}

function buildFileTree(nodes: GraphNode[]): FileEntry[] {
  const files = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (!node.filePath) continue;
    const filePath = normalizeFilePath(node.filePath);
    if (!filePath) continue;
    files.set(filePath, bestFileNode(files.get(filePath), node));
  }

  const root: FileEntry = { name: "", path: "", type: "folder", children: [] };
  const folders = new Map<string, FileEntry>([["", root]]);

  for (const [filePath, node] of files) {
    const parts = filePath.split("/");
    let parent = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isFile = i === parts.length - 1;

      if (isFile) {
        parent.children.push({
          name,
          path: currentPath,
          type: "file",
          children: [],
          nodeId: node.id,
        });
        continue;
      }

      let folder = folders.get(currentPath);
      if (!folder) {
        folder = { name, path: currentPath, type: "folder", children: [] };
        folders.set(currentPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
  }

  const sortEntries = (entries: FileEntry[]): FileEntry[] =>
    entries
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => ({
        ...entry,
        children: sortEntries(entry.children),
      }));

  return sortEntries(root.children);
}

function FileTreeRow({
  entry,
  depth,
  expanded,
  toggleFolder,
  openFile,
}: {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  toggleFolder: (path: string) => void;
  openFile: (nodeId: string) => void;
}) {
  const isExpanded = expanded.has(entry.path);
  const paddingLeft = 12 + depth * 14;

  if (entry.type === "folder") {
    return (
      <>
        <button
          type="button"
          onClick={() => toggleFolder(entry.path)}
          className="w-full flex items-center gap-1.5 py-1.5 pr-3 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-elevated transition-colors"
          style={{ paddingLeft }}
          title={entry.path}
        >
          <span className="w-3 text-text-muted">{isExpanded ? "v" : ">"}</span>
          <span className="truncate font-medium">{entry.name}</span>
        </button>
        {isExpanded &&
          entry.children.map((child) => (
            <FileTreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              toggleFolder={toggleFolder}
              openFile={openFile}
            />
          ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onDoubleClick={() => entry.nodeId && openFile(entry.nodeId)}
      className="w-full flex items-center gap-1.5 py-1.5 pr-3 text-left text-xs text-text-secondary hover:text-accent hover:bg-accent/5 transition-colors"
      style={{ paddingLeft }}
      title={`${entry.path} - double-click to open`}
    >
      <span className="w-3 text-text-muted">-</span>
      <span className="truncate font-mono">{entry.name}</span>
    </button>
  );
}

export default function FileExplorer() {
  const graph = useDashboardStore((s) => s.graph);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const { t } = useI18n();
  const entries = useMemo(() => buildFileTree(graph?.nodes ?? []), [graph]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Navigate the graph first (drills into layer + selects node, which clears the
  // code viewer), then re-open the viewer so the source panel stays visible.
  const handleOpenFile = (nodeId: string) => {
    navigateToNode(nodeId);
    openCodeViewer(nodeId);
  };

  const toggleFolder = (folderPath: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const totalFiles = useMemo(() => {
    const countFiles = (items: FileEntry[]): number =>
      items.reduce(
        (count, item) => count + (item.type === "file" ? 1 : countFiles(item.children)),
        0,
      );
    return countFiles(entries);
  }, [entries]);

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center p-5 text-sm text-text-muted">
        {t.common.noGraphLoaded}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border-subtle shrink-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          {t.fileExplorer.analyzedFiles}
        </div>
        <div className="text-xs text-text-muted mt-1">
          {totalFiles} {t.fileExplorer.filesFromGraph}
        </div>
      </div>
      <div className="flex-1 overflow-auto py-2">
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-text-muted">{t.fileExplorer.noFilePathsFound}</div>
        ) : (
          entries.map((entry) => (
            <FileTreeRow
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              toggleFolder={toggleFolder}
              openFile={handleOpenFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
