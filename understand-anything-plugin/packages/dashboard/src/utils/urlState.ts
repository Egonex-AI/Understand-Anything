/**
 * Dashboard view state ↔ URL hash, so a refresh restores where you were,
 * browser back/forward walk your navigation, and a link can point a
 * colleague at a specific node ("#node=function:src/auth.ts:login").
 *
 * The hash (not the query string) is used so the state never reaches the
 * server and never mixes with the one-time `?token=`.
 */
export type UrlViewMode = "structural" | "domain" | "knowledge";
export type UrlSearchMode = "fuzzy" | "semantic" | "content";

export interface UrlState {
  view?: UrlViewMode;
  layer?: string;
  node?: string;
  /** Node whose source is open in the code viewer. */
  code?: string;
  line?: number;
  q?: string;
  mode?: UrlSearchMode;
}

const VIEWS: UrlViewMode[] = ["structural", "domain", "knowledge"];
const MODES: UrlSearchMode[] = ["fuzzy", "semantic", "content"];

export function parseUrlState(hash: string): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const state: UrlState = {};
  const view = params.get("view");
  if (view && (VIEWS as string[]).includes(view)) state.view = view as UrlViewMode;
  const mode = params.get("mode");
  if (mode && (MODES as string[]).includes(mode)) state.mode = mode as UrlSearchMode;
  for (const key of ["layer", "node", "code", "q"] as const) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
  const line = Number(params.get("line"));
  if (Number.isInteger(line) && line > 0) state.line = line;
  return state;
}

export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.view && state.view !== "structural") params.set("view", state.view);
  if (state.layer) params.set("layer", state.layer);
  if (state.node) params.set("node", state.node);
  if (state.code) params.set("code", state.code);
  if (state.code && state.line) params.set("line", String(state.line));
  if (state.q) params.set("q", state.q);
  if (state.q && state.mode && state.mode !== "fuzzy") params.set("mode", state.mode);
  const s = params.toString();
  return s ? `#${s}` : "";
}

/** The part of the state worth a history entry (search typing is not). */
export function navigationKey(state: UrlState): string {
  return [state.view ?? "", state.layer ?? "", state.node ?? "", state.code ?? ""].join("\u0000");
}
