import { create } from "zustand";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "./store";
import { computeImpact, type ImpactResult } from "./utils/impact";
import { evaluateRules, type ArchRule, type RulesEvaluation } from "./utils/archRules";
import { churnForPath, hotspotLevels, type HotspotsReport } from "./utils/hotspots";
import { diffFingerprint, orderForReview, type ReviewEntry } from "./utils/review";
import { dependencyOf } from "./utils/dependencies";

/**
 * Analysis overlays: git hotspots, impact analysis, architecture-rule
 * violations and the PR review walkthrough.
 *
 * All four paint the graph through one mechanism: `nodeMarks` (node id →
 * tone + level) and `markedEdges`, which CustomNode and GraphView read.
 * Only one overlay is active at a time; switching replaces the marks.
 * Kept apart from the main store so the overlays stay self-contained.
 */
export type OverlayKind = "hotspots" | "impact" | "rules" | "review";

export interface NodeMark {
  tone: "heat" | "impact-root" | "impact" | "violation" | "review-current" | "review-done";
  /** Heat level 1..5, or impact depth. */
  level: number;
  /** Short badge text (commit count, depth). */
  badge?: string;
}

export interface MarkedEdge {
  source: string;
  target: string;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";
export type RulesStorage = "server" | "local";

interface AnalysisState {
  overlay: OverlayKind | null;
  nodeMarks: Map<string, NodeMark>;
  markedEdges: MarkedEdge[];
  /** Unmarked nodes are dimmed while the overlay is active. */
  fadeUnmarked: boolean;

  hotspotDays: number;
  hotspots: HotspotsReport | null;
  hotspotsStatus: LoadStatus;

  impact: ImpactResult | null;

  rules: ArchRule[];
  rulesStorage: RulesStorage;
  rulesLoaded: boolean;
  rulesEditorOpen: boolean;
  evaluation: RulesEvaluation | null;

  reviewSteps: string[];
  reviewIndex: number;
  reviewEntries: Record<string, ReviewEntry>;

  init: (accessToken: string, projectKey: string) => void;
  clearOverlay: () => void;
  showHotspots: (days?: number) => void;
  /** Load churn data (for node details) without turning the overlay on. */
  ensureHotspots: () => void;
  showImpact: (nodeId: string) => void;
  showViolations: () => void;
  openRulesEditor: () => void;
  closeRulesEditor: () => void;
  saveRules: (rules: ArchRule[]) => Promise<{ ok: boolean; error?: string }>;
  startReview: () => void;
  goToReviewStep: (index: number) => void;
  setReviewEntry: (nodeId: string, patch: Partial<ReviewEntry>) => void;
}

const DEMO_TOKEN = "__demo__";
const RULES_LOCAL_PREFIX = "ua-arch-rules:";
const REVIEW_LOCAL_PREFIX = "ua-review:";

let token: string | null = null;
let projectKey = "default";
let unsubscribeGraph: (() => void) | null = null;

function withToken(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, token: token ?? "" });
  return `${path}?${q.toString()}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — progress just won't survive a reload.
  }
}

function graph(): KnowledgeGraph | null {
  return useDashboardStore.getState().graph;
}

function reviewKey(): string {
  return `${REVIEW_LOCAL_PREFIX}${projectKey}:${diffFingerprint(useDashboardStore.getState().changedNodeIds)}`;
}

function cleanRules(raw: unknown): ArchRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r, i) => ({
      id: typeof r.id === "string" && r.id ? r.id : `rule-${i + 1}`,
      from: typeof r.from === "string" ? r.from : "",
      to: typeof r.to === "string" ? r.to : "",
      description: typeof r.description === "string" ? r.description : "",
      enabled: r.enabled !== false,
    }))
    .filter((r) => r.from.trim() && r.to.trim());
}

export const useAnalysisStore = create<AnalysisState>()((set, get) => {
  /** Rebuild nodeMarks/markedEdges for whichever overlay is active. */
  function repaint() {
    const g = graph();
    const { overlay } = get();
    const nodeMarks = new Map<string, NodeMark>();
    const markedEdges: MarkedEdge[] = [];
    let fadeUnmarked = false;
    if (g && overlay === "hotspots") {
      const report = get().hotspots;
      if (report) {
        for (const [id, level] of hotspotLevels(g.nodes, report)) {
          const node = useDashboardStore.getState().nodesById.get(id);
          const churn = churnForPath(report, node?.filePath);
          nodeMarks.set(id, { tone: "heat", level, badge: churn ? String(churn.commits) : undefined });
        }
      }
    } else if (g && overlay === "impact") {
      const impact = get().impact;
      if (impact) {
        fadeUnmarked = true;
        nodeMarks.set(impact.rootId, { tone: "impact-root", level: 0 });
        for (const [id, depth] of impact.depths) {
          nodeMarks.set(id, { tone: "impact", level: depth, badge: String(depth) });
        }
        for (const e of g.edges) {
          const dep = dependencyOf(e);
          if (dep && impact.depths.has(dep.dependent) && nodeMarks.has(dep.dependency)) {
            markedEdges.push({ source: e.source, target: e.target });
          }
        }
      }
    } else if (g && overlay === "rules") {
      const evaluation = get().evaluation;
      fadeUnmarked = true;
      if (evaluation) {
        for (const id of evaluation.nodeIds) nodeMarks.set(id, { tone: "violation", level: 1 });
        for (const key of evaluation.edgeKeys) {
          const [source, target] = key.split("→");
          markedEdges.push({ source, target });
        }
      }
    } else if (g && overlay === "review") {
      const { reviewSteps, reviewIndex, reviewEntries } = get();
      reviewSteps.forEach((id, i) => {
        if (i === reviewIndex) nodeMarks.set(id, { tone: "review-current", level: 2, badge: String(i + 1) });
        else if (reviewEntries[id]?.reviewed) nodeMarks.set(id, { tone: "review-done", level: 1, badge: "✓" });
      });
    }
    set({ nodeMarks, markedEdges, fadeUnmarked });
  }

  function reevaluate() {
    const g = graph();
    set({ evaluation: g ? evaluateRules(g, get().rules) : null });
    if (get().overlay === "rules") repaint();
  }

  async function loadHotspots(days: number) {
    if (token === DEMO_TOKEN) {
      set({ hotspots: null, hotspotsStatus: "error" });
      return;
    }
    set({ hotspotsStatus: "loading", hotspotDays: days });
    try {
      const res = await fetch(withToken("/git-hotspots.json", { days: String(days) }));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report = (await res.json()) as HotspotsReport;
      // A newer window was requested meanwhile — drop this answer.
      if (get().hotspotDays !== days) return;
      set({ hotspots: report, hotspotsStatus: "ready" });
    } catch {
      if (get().hotspotDays !== days) return;
      set({ hotspots: null, hotspotsStatus: "error" });
    }
    repaint();
  }

  async function loadRules() {
    const local = cleanRules(readJson<{ rules?: unknown }>(`${RULES_LOCAL_PREFIX}${projectKey}`)?.rules);
    if (token === DEMO_TOKEN) {
      set({ rules: local, rulesStorage: "local", rulesLoaded: true });
      reevaluate();
      return;
    }
    try {
      const res = await fetch(withToken("/arch-rules.json"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = (await res.json()) as { rules?: unknown; writable?: boolean };
      const serverRules = cleanRules(doc.rules);
      if (doc.writable) set({ rules: serverRules, rulesStorage: "server", rulesLoaded: true });
      // Read-only server: this browser's edits win over the committed file.
      else set({ rules: local.length > 0 ? local : serverRules, rulesStorage: "local", rulesLoaded: true });
    } catch {
      set({ rules: local, rulesStorage: "local", rulesLoaded: true });
    }
    reevaluate();
  }

  function goTo(index: number) {
    const { reviewSteps } = get();
    if (index < 0 || index >= reviewSteps.length) return;
    set({ reviewIndex: index });
    const id = reviewSteps[index];
    const dash = useDashboardStore.getState();
    dash.navigateToNode(id);
    if (dash.nodesById.get(id)?.filePath) useDashboardStore.getState().openCodeViewer(id);
    repaint();
  }

  return {
    overlay: null,
    nodeMarks: new Map(),
    markedEdges: [],
    fadeUnmarked: false,

    hotspotDays: 90,
    hotspots: null,
    hotspotsStatus: "idle",

    impact: null,

    rules: [],
    rulesStorage: "server",
    rulesLoaded: false,
    rulesEditorOpen: false,
    evaluation: null,

    reviewSteps: [],
    reviewIndex: 0,
    reviewEntries: {},

    init: (accessToken, key) => {
      token = accessToken;
      projectKey = key;
      void loadRules();
      unsubscribeGraph?.();
      unsubscribeGraph = useDashboardStore.subscribe((state, prev) => {
        if (state.graph !== prev.graph) {
          // A new graph invalidates impact results and review steps.
          if (get().overlay === "impact" || get().overlay === "review") set({ overlay: null, impact: null });
          reevaluate();
          repaint();
        } else if (state.changedNodeIds !== prev.changedNodeIds && get().overlay === "review") {
          set({ overlay: null });
          repaint();
        }
      });
    },

    clearOverlay: () => {
      set({ overlay: null, impact: null });
      repaint();
    },

    showHotspots: (days) => {
      const nextDays = days ?? get().hotspotDays;
      set({ overlay: "hotspots" });
      if (get().hotspots?.days !== nextDays || get().hotspotsStatus === "error") void loadHotspots(nextDays);
      repaint();
    },

    ensureHotspots: () => {
      if (get().hotspotsStatus === "idle") void loadHotspots(get().hotspotDays);
    },

    showImpact: (nodeId) => {
      const g = graph();
      if (!g) return;
      set({ overlay: "impact", impact: computeImpact(g, nodeId) });
      repaint();
    },

    showViolations: () => {
      set({ overlay: "rules" });
      if (!get().evaluation) reevaluate();
      repaint();
    },

    openRulesEditor: () => set({ rulesEditorOpen: true }),
    closeRulesEditor: () => set({ rulesEditorOpen: false }),

    saveRules: async (rules) => {
      const clean = cleanRules(rules);
      set({ rules: clean });
      reevaluate();
      if (get().rulesStorage === "local" || token === DEMO_TOKEN) {
        writeJson(`${RULES_LOCAL_PREFIX}${projectKey}`, { version: 1, rules: clean });
        return { ok: true };
      }
      try {
        const res = await fetch(withToken("/arch-rules.json"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1, rules: clean }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return { ok: true };
      } catch (err) {
        set({ rulesStorage: "local" });
        writeJson(`${RULES_LOCAL_PREFIX}${projectKey}`, { version: 1, rules: clean });
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    startReview: () => {
      const g = graph();
      const { changedNodeIds, diffMode, toggleDiffMode } = useDashboardStore.getState();
      if (!g || changedNodeIds.size === 0) return;
      const steps = orderForReview(g, changedNodeIds);
      if (steps.length === 0) return;
      const saved = readJson<Record<string, ReviewEntry>>(reviewKey()) ?? {};
      set({ overlay: "review", reviewSteps: steps, reviewEntries: saved, reviewIndex: 0 });
      if (!diffMode) toggleDiffMode();
      goTo(0);
    },

    goToReviewStep: (index) => goTo(index),

    setReviewEntry: (nodeId, patch) => {
      const current = get().reviewEntries[nodeId] ?? { reviewed: false, comment: "" };
      const reviewEntries = { ...get().reviewEntries, [nodeId]: { ...current, ...patch } };
      set({ reviewEntries });
      writeJson(reviewKey(), reviewEntries);
      repaint();
    },
  };
});
