import { create } from "zustand";

/**
 * User tags + notes per graph node.
 *
 * Persisted to the project's data directory (`.ua/annotations.json`) via the
 * dashboard server's `/annotations.json` endpoint. When the server can't
 * store them — static demo build, the read-only standalone viewer, a failed
 * save — they live in this browser's localStorage instead, keyed by project.
 *
 * Mirrors core's annotations.ts shape (redeclared: the dashboard may only
 * import core's browser-safe subpaths).
 */
export interface NodeAnnotation {
  tags: string[];
  note: string;
  updatedAt: string;
}

export type AnnotationStorage = "server" | "local";

interface AnnotationsState {
  annotations: Record<string, NodeAnnotation>;
  storage: AnnotationStorage;
  loaded: boolean;
  load: (accessToken: string, projectKey: string) => Promise<void>;
  setTags: (nodeId: string, tags: string[]) => void;
  setNote: (nodeId: string, note: string) => void;
}

const DEMO_TOKEN = "__demo__";
const SAVE_DEBOUNCE_MS = 400;
const LOCAL_KEY_PREFIX = "ua-annotations:";

let token: string | null = null;
let localKey = `${LOCAL_KEY_PREFIX}default`;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readLocal(): Record<string, NodeAnnotation> {
  try {
    const raw = window.localStorage.getItem(localKey);
    const parsed = raw ? (JSON.parse(raw) as { nodes?: Record<string, NodeAnnotation> }) : null;
    return parsed?.nodes && typeof parsed.nodes === "object" ? parsed.nodes : {};
  } catch {
    return {};
  }
}

function writeLocal(nodes: Record<string, NodeAnnotation>): void {
  try {
    window.localStorage.setItem(localKey, JSON.stringify({ version: 1, nodes }));
  } catch {
    // Storage full or blocked — nothing more we can do.
  }
}

function annotationsUrl(): string {
  return `/annotations.json?token=${encodeURIComponent(token ?? "")}`;
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").slice(0, 64);
}

export const useAnnotationsStore = create<AnnotationsState>()((set, get) => {
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const { annotations, storage } = get();
      if (storage === "local") {
        writeLocal(annotations);
        return;
      }
      fetch(annotationsUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, nodes: annotations }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
        .catch((err: unknown) => {
          console.warn("[annotations] could not save to the server, keeping them in this browser:", err);
          set({ storage: "local" });
          writeLocal(get().annotations);
        });
    }, SAVE_DEBOUNCE_MS);
  }

  function update(nodeId: string, patch: Partial<Pick<NodeAnnotation, "tags" | "note">>) {
    const current = get().annotations[nodeId] ?? { tags: [], note: "", updatedAt: "" };
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const annotations = { ...get().annotations };
    if (next.tags.length === 0 && !next.note.trim()) delete annotations[nodeId];
    else annotations[nodeId] = next;
    set({ annotations });
    scheduleSave();
  }

  return {
    annotations: {},
    storage: "server",
    loaded: false,

    load: async (accessToken, projectKey) => {
      token = accessToken;
      localKey = `${LOCAL_KEY_PREFIX}${projectKey}`;
      if (accessToken === DEMO_TOKEN) {
        set({ annotations: readLocal(), storage: "local", loaded: true });
        return;
      }
      try {
        const res = await fetch(annotationsUrl());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = (await res.json()) as { nodes?: Record<string, NodeAnnotation>; writable?: boolean };
        const serverNodes = doc.nodes ?? {};
        if (doc.writable) {
          set({ annotations: serverNodes, storage: "server", loaded: true });
        } else {
          // Read-only server: committed annotations, overlaid by this browser's edits.
          set({ annotations: { ...serverNodes, ...readLocal() }, storage: "local", loaded: true });
        }
      } catch {
        set({ annotations: readLocal(), storage: "local", loaded: true });
      }
    },

    setTags: (nodeId, tags) => {
      const seen = new Set<string>();
      const clean = tags.map(normalizeTag).filter((t) => {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      update(nodeId, { tags: clean });
    },

    setNote: (nodeId, note) => update(nodeId, { note }),
  };
});
