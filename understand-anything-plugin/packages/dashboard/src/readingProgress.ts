import { create } from "zustand";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "./store";

/**
 * Which files the user has opened in the code viewer, per project.
 *
 * A per-viewer convenience, so it lives only in this browser's localStorage
 * (keyed by project name); every storage access is guarded because storage
 * can be blocked or full. Files are keyed by their normalised path so a file
 * counts as read whichever of its nodes (file, function, class) was opened.
 */

const LOCAL_KEY_PREFIX = "ua-reading-progress:";

/** Same normalisation the Files tab uses for its tree paths. */
export function readingKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

/** Every distinct file path in the graph — the denominator of "N / M files read". */
export function graphFilePaths(graph: KnowledgeGraph | null): Set<string> {
  const paths = new Set<string>();
  for (const node of graph?.nodes ?? []) {
    if (!node.filePath) continue;
    const key = readingKey(node.filePath);
    if (key && key !== ".") paths.add(key);
  }
  return paths;
}

interface ReadingProgressState {
  projectKey: string | null;
  read: Set<string>;
  load: (projectKey: string) => void;
  markRead: (filePath: string) => void;
  reset: () => void;
}

function storageKey(projectKey: string): string {
  return `${LOCAL_KEY_PREFIX}${projectKey}`;
}

function readLocal(projectKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(projectKey));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const files = (parsed as { files?: unknown } | null)?.files;
    return new Set(Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : []);
  } catch {
    return new Set();
  }
}

function writeLocal(projectKey: string, read: Set<string>): void {
  try {
    if (read.size === 0) window.localStorage.removeItem(storageKey(projectKey));
    else window.localStorage.setItem(storageKey(projectKey), JSON.stringify({ version: 1, files: [...read] }));
  } catch {
    // Storage blocked or full — progress just won't survive a reload.
  }
}

export const useReadingProgress = create<ReadingProgressState>()((set, get) => ({
  projectKey: null,
  read: new Set(),

  load: (projectKey) => {
    if (get().projectKey === projectKey) return;
    set({ projectKey, read: readLocal(projectKey) });
  },

  markRead: (filePath) => {
    const key = readingKey(filePath);
    const { read, projectKey } = get();
    if (!key || read.has(key)) return;
    const next = new Set(read);
    next.add(key);
    set({ read: next });
    if (projectKey !== null) writeLocal(projectKey, next);
  },

  reset: () => {
    const { projectKey } = get();
    set({ read: new Set() });
    if (projectKey !== null) writeLocal(projectKey, new Set());
  },
}));

// Follow the loaded project without wiring anything into App.
function syncProject(graph: KnowledgeGraph | null): void {
  const name = graph?.project?.name;
  if (name !== undefined) useReadingProgress.getState().load(name);
}
syncProject(useDashboardStore.getState().graph);
useDashboardStore.subscribe((state, prev) => {
  if (state.graph !== prev.graph) syncProject(state.graph);
});
