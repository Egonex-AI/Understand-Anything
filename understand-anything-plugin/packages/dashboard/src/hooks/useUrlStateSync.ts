import { useEffect, useRef } from "react";
import { useDashboardStore } from "../store";
import {
  navigationKey,
  parseUrlState,
  serializeUrlState,
  type UrlState,
} from "../utils/urlState";

type DashboardState = ReturnType<typeof useDashboardStore.getState>;

function stateToUrl(s: DashboardState): UrlState {
  return {
    view: s.viewMode,
    layer: s.viewMode === "structural" && s.navigationLevel === "layer-detail" ? s.activeLayerId ?? undefined : undefined,
    node: s.selectedNodeId ?? undefined,
    code: s.codeViewerOpen ? s.codeViewerNodeId ?? undefined : undefined,
    line: s.codeViewerOpen ? s.codeViewerLine ?? undefined : undefined,
    q: s.searchQuery.trim() ? s.searchQuery : undefined,
    mode: s.searchMode,
  };
}

/** Push URL state into the store. Unknown layer/node ids are ignored. */
function applyUrlState(url: UrlState): void {
  const s = useDashboardStore.getState();
  const nodeExists = (id: string) =>
    s.nodesById.has(id) || Boolean(s.domainGraph?.nodes.some((n) => n.id === id));

  if (url.mode && url.mode !== s.searchMode) s.setSearchMode(url.mode);
  if ((url.q ?? "") !== s.searchQuery) s.setSearchQuery(url.q ?? "");

  const wantView = url.view ?? (s.isKnowledgeGraph ? "knowledge" : "structural");
  if (wantView !== s.viewMode && (wantView !== "domain" || s.domainGraph)) {
    s.setViewMode(wantView);
  }

  const layerExists = url.layer && s.graph?.layers.some((l) => l.id === url.layer);
  if (layerExists) {
    if (s.navigationLevel !== "layer-detail" || s.activeLayerId !== url.layer) s.drillIntoLayer(url.layer!);
    if (url.node && nodeExists(url.node)) useDashboardStore.setState({ selectedNodeId: url.node });
    else if (useDashboardStore.getState().selectedNodeId) useDashboardStore.setState({ selectedNodeId: null });
  } else if (url.node && nodeExists(url.node)) {
    if (s.selectedNodeId !== url.node) s.navigateToNodeInLayer(url.node);
  } else {
    if (s.navigationLevel !== "overview") s.navigateToOverview();
    else if (s.selectedNodeId) s.selectNode(null);
  }

  const after = useDashboardStore.getState();
  if (url.code && nodeExists(url.code)) {
    if (!after.codeViewerOpen || after.codeViewerNodeId !== url.code || after.codeViewerLine !== (url.line ?? null)) {
      after.openCodeViewer(url.code, url.line);
    }
  } else if (after.codeViewerOpen) {
    after.closeCodeViewer();
  }
}

/**
 * Keep the dashboard's navigation state in the URL hash: restore it once the
 * graph loads, push a history entry per navigation (layer / node / view /
 * code viewer) and replace in place for search typing, and follow
 * back/forward.
 */
export function useUrlStateSync(): void {
  const graphLoaded = useDashboardStore((s) => s.graph !== null);
  const domainLoaded = useDashboardStore((s) => s.domainGraph !== null);
  const initialRef = useRef<UrlState | null>(null);
  const restoredRef = useRef(false);
  const applyingRef = useRef(false);
  const navKeyRef = useRef<string | null>(null);

  const apply = (url: UrlState) => {
    applyingRef.current = true;
    try {
      applyUrlState(url);
    } finally {
      applyingRef.current = false;
    }
    navKeyRef.current = navigationKey(stateToUrl(useDashboardStore.getState()));
  };

  // Restore from the initial hash once the graph is in.
  useEffect(() => {
    if (!graphLoaded || restoredRef.current) return;
    restoredRef.current = true;
    initialRef.current = parseUrlState(window.location.hash);
    if (window.location.hash) apply(initialRef.current);
    else navKeyRef.current = navigationKey(stateToUrl(useDashboardStore.getState()));
  }, [graphLoaded]);

  // The domain graph loads separately; finish a "#view=domain" restore when it arrives.
  useEffect(() => {
    const initial = initialRef.current;
    if (!domainLoaded || initial?.view !== "domain") return;
    initialRef.current = null;
    apply(initial);
  }, [domainLoaded]);

  // Store → URL.
  useEffect(
    () =>
      useDashboardStore.subscribe((state, prev) => {
        if (!restoredRef.current || applyingRef.current) return;
        // A (re)loaded graph resets navigation to the overview — restore the
        // URL's state on top of it instead of overwriting the URL with the reset.
        if (state.graph !== prev.graph) {
          apply(parseUrlState(window.location.hash));
          return;
        }
        const url = stateToUrl(state);
        const hash = serializeUrlState(url);
        if (hash === window.location.hash || (!hash && !window.location.hash)) return;
        const href = `${window.location.pathname}${window.location.search}${hash}`;
        const key = navigationKey(url);
        if (key !== navKeyRef.current) {
          navKeyRef.current = key;
          window.history.pushState(null, "", href);
        } else {
          window.history.replaceState(null, "", href);
        }
      }),
    [],
  );

  // URL → store on back/forward (or a hand-edited hash).
  useEffect(() => {
    const onPop = () => {
      if (restoredRef.current) apply(parseUrlState(window.location.hash));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
