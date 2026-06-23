import { create } from "zustand";
import { SearchEngine } from "@understand-anything/core/search";
import type { SearchResult } from "@understand-anything/core/search";
import type { GraphIssue } from "@understand-anything/core/schema";
import type {
  GraphNode,
  KnowledgeGraph,
  TourStep,
} from "@understand-anything/core/types";
import type { ReactFlowInstance } from "@xyflow/react";

export type Persona = "non-technical" | "junior" | "experienced";
export type NavigationLevel = "overview" | "layer-detail";
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step" | "article" | "entity" | "topic" | "claim" | "source";
export type Complexity = "simple" | "moderate" | "complex";
export type EdgeCategory = "structural" | "behavioral" | "data-flow" | "dependencies" | "semantic" | "infrastructure" | "domain" | "knowledge";
export type ViewMode = "structural" | "domain" | "knowledge";
export type DetailLevel = "file" | "class";

export interface FilterState {
  nodeTypes: Set<NodeType>;
  complexities: Set<Complexity>;
  layerIds: Set<string>;
  edgeCategories: Set<EdgeCategory>;
}

export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step", "article", "entity", "topic", "claim", "source"];
export const ALL_COMPLEXITIES: Complexity[] = ["simple", "moderate", "complex"];
export const ALL_EDGE_CATEGORIES: EdgeCategory[] = ["structural", "behavioral", "data-flow", "dependencies", "semantic", "infrastructure", "domain", "knowledge"];

export const EDGE_CATEGORY_MAP: Record<EdgeCategory, string[]> = {
  structural: ["imports", "exports", "contains", "inherits", "implements"],
  behavioral: ["calls", "subscribes", "publishes", "middleware"],
  "data-flow": ["reads_from", "writes_to", "transforms", "validates"],
  dependencies: ["depends_on", "tested_by", "configures"],
  semantic: ["related", "similar_to"],
  infrastructure: ["deploys", "serves", "provisions", "triggers", "migrates", "documents", "routes", "defines_schema"],
  domain: ["contains_flow", "flow_step", "cross_domain"],
  knowledge: ["cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by"],
};

export const DOMAIN_EDGE_TYPES = EDGE_CATEGORY_MAP.domain;

const DEFAULT_FILTERS: FilterState = {
  nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
  complexities: new Set<Complexity>(ALL_COMPLEXITIES),
  layerIds: new Set<string>(),
  edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
};

/** Categories used for node type filter toggles. Single source of truth for NodeCategory. */
export type NodeCategory = "code" | "config" | "docs" | "infra" | "data" | "domain" | "knowledge";

/**
 * Build the (id → node) and (id → layerId) lookup maps that the rest of
 * the dashboard reads via store selectors. Centralised so `setGraph` and
 * any future graph-replacement path stay in sync.
 *
 * Two layer indexes, intentionally distinct:
 *
 * - `nodeIdToLayerId` preserves the prior `findNodeLayer` "first matching
 *   layer wins" semantics — if a node id appears in multiple layers
 *   (rare but legal in the schema), the first occurrence in `graph.layers`
 *   order is the one we map to. Drives navigation (drillIntoLayer, tour
 *   step → layer, sidebar history) where a single canonical layer is the
 *   right answer.
 *
 * - `nodeIdToLayerIds` records *every* layer a node belongs to. Drives
 *   membership queries (filterNodes) where the prior `Layer[] +
 *   layer.nodeIds.includes` shape was any-layer-wins — a node in L1 and
 *   L2 with only L2 selected must still pass. Collapsing to first-wins
 *   for filtering would be a silent regression.
 */
function buildGraphIndexes(graph: KnowledgeGraph): {
  nodesById: Map<string, GraphNode>;
  nodeIdToLayerId: Map<string, string>;
  nodeIdToLayerIds: Map<string, Set<string>>;
} {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodesById.set(node.id, node);
  const nodeIdToLayerId = new Map<string, string>();
  const nodeIdToLayerIds = new Map<string, Set<string>>();
  for (const layer of graph.layers) {
    for (const nid of layer.nodeIds) {
      if (!nodeIdToLayerId.has(nid)) nodeIdToLayerId.set(nid, layer.id);
      let set = nodeIdToLayerIds.get(nid);
      if (!set) {
        set = new Set<string>();
        nodeIdToLayerIds.set(nid, set);
      }
      set.add(layer.id);
    }
  }
  return { nodesById, nodeIdToLayerId, nodeIdToLayerIds };
}

/** Maximum number of entries in the sidebar navigation history. */
const MAX_HISTORY = 50;

interface DashboardStore {
  graph: KnowledgeGraph | null;
  /** id → node lookup, rebuilt by setGraph. Empty before any graph loads. */
  nodesById: Map<string, GraphNode>;
  /** id → layer id (first-matching-layer wins), rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerId: Map<string, string>;
  /** id → set of every layer the node belongs to, rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerIds: Map<string, Set<string>>;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchEngine: SearchEngine | null;
  searchMode: "fuzzy" | "semantic";
  setSearchMode: (mode: "fuzzy" | "semantic") => void;

  // Lens navigation
  navigationLevel: NavigationLevel;
  activeLayerId: string | null;

  codeViewerOpen: boolean;
  codeViewerNodeId: string | null;
  codeViewerExpanded: boolean;

  tourActive: boolean;
  currentTourStep: number;
  tourHighlightedNodeIds: string[];

  persona: Persona;

  diffMode: boolean;
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;

  // Focus mode: isolate a node's 1-hop neighborhood
  focusNodeId: string | null;

  // Sidebar navigation history (stack of visited node IDs)
  nodeHistory: string[];

  // Filter & Export features
  filters: FilterState;
  filterPanelOpen: boolean;
  exportMenuOpen: boolean;
  pathFinderOpen: boolean;
  reactFlowInstance: ReactFlowInstance | null;

  // Node type category filters
  nodeTypeFilters: Record<NodeCategory, boolean>;
  toggleNodeTypeFilter: (category: NodeCategory) => void;

  // Detail level: "file" shows only file nodes (architecture view),
  // "class" shows files + class nodes (code structure view) with optional function expansion.
  detailLevel: DetailLevel;
  setDetailLevel: (level: DetailLevel) => void;
  showFunctionsInClassView: boolean;
  toggleShowFunctionsInClassView: () => void;

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  navigateToNodeInLayer: (nodeId: string) => void;
  navigateToHistoryIndex: (index: number) => void;
  goBackNode: () => void;
  drillIntoLayer: (layerId: string) => void;
  navigateToOverview: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setPersona: (persona: Persona) => void;
  openCodeViewer: (nodeId: string) => void;
  closeCodeViewer: () => void;
  expandCodeViewer: () => void;
  collapseCodeViewer: () => void;

  setDiffOverlay: (changed: string[], affected: string[]) => void;
  toggleDiffMode: () => void;
  clearDiffOverlay: () => void;

  toggleFilterPanel: () => void;
  toggleExportMenu: () => void;
  togglePathFinder: () => void;
  setReactFlowInstance: (instance: ReactFlowInstance | null) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  resetFilters: () => void;
  hasActiveFilters: () => boolean;

  startTour: () => void;
  stopTour: () => void;
  setTourStep: (step: number) => void;
  nextTourStep: () => void;
  prevTourStep: () => void;

  // View mode
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

  setDomainGraph: (graph: KnowledgeGraph) => void;
  setViewMode: (mode: ViewMode) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;

  // Container expand/collapse + lazy layout caches
  expandedContainers: Set<string>;
  toggleContainer: (containerId: string) => void;
  expandContainer: (containerId: string) => void;
  collapseContainer: (containerId: string) => void;
  collapseAllContainers: () => void;
  /** Container the user just manually expanded; viewport should lock onto it. Cleared by GraphView once the lock is applied. */
  pendingFocusContainer: string | null;
  setPendingFocusContainer: (containerId: string | null) => void;
  /** True while TourFitView is waiting for highlighted nodes to materialise (Stage 2 layout in progress). Drives the "Computing layout…" overlay. */
  tourFitPending: boolean;
  setTourFitPending: (pending: boolean) => void;

  containerLayoutCache: Map<
    string,
    {
      childPositions: Map<string, { x: number; y: number }>;
      actualSize: { width: number; height: number };
    }
  >;
  setContainerLayout: (
    containerId: string,
    childPositions: Map<string, { x: number; y: number }>,
    actualSize: { width: number; height: number },
  ) => void;
  clearContainerLayouts: () => void;

  containerSizeMemory: Map<string, { width: number; height: number }>;

  stage1Tick: number;
  bumpStage1Tick: () => void;

  // Layout-time issues (e.g. ELK input repair). Funneled into the
  // WarningBanner alongside graph-validation issues.
  layoutIssues: GraphIssue[];
  appendLayoutIssues: (issues: GraphIssue[]) => void;
  clearLayoutIssues: () => void;
}

function getSortedTour(graph: KnowledgeGraph): TourStep[] {
  const tour = graph.tour ?? [];
  return [...tour].sort((a, b) => a.order - b.order);
}

/** Navigate tour step to the correct layer for the first highlighted node. */
function navigateTourToLayer(
  nodeIdToLayerId: Map<string, string>,
  nodeIds: string[],
): Partial<DashboardStore> {
  if (nodeIds.length === 0) return {};
  const layerId = nodeIdToLayerId.get(nodeIds[0]);
  if (layerId) {
    return {
      navigationLevel: "layer-detail" as const,
      activeLayerId: layerId,
    };
  }
  return {};
}

/**
 * Container ids derive from per-layer state — folder names in folder-strategy
 * layers, community indices (`container:cluster-N`) in community-strategy
 * layers — and collide across layers (e.g. API Contracts and Load Testing
 * both produce `container:cluster-0`). When a tour step crosses layers we
 * must drop the previous layer's container caches so Stage 2 actually re-
 * runs for the new layer's children. Mirrors the reset block in
 * `drillIntoLayer`.
 */
function layerResetIfChanged(
  layerNav: Partial<DashboardStore>,
  prevLayerId: string | null,
): Partial<DashboardStore> {
  const next = layerNav.activeLayerId;
  if (!next || next === prevLayerId) return {};
  return {
    containerLayoutCache: new Map(),
    containerSizeMemory: new Map(),
    expandedContainers: new Set(),
    // Drop any pending focus too — its id was scoped to the previous
    // layer and would otherwise re-collide with a same-id container in
    // the new layer for the duration of the 1.2s timer.
    pendingFocusContainer: null,
  };
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  nodesById: new Map<string, GraphNode>(),
  nodeIdToLayerId: new Map<string, string>(),
  nodeIdToLayerIds: new Map<string, Set<string>>(),
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchEngine: null,
  searchMode: "fuzzy",

  navigationLevel: "overview",
  activeLayerId: null,
  codeViewerOpen: false,
  codeViewerNodeId: null,
  codeViewerExpanded: false,

  tourActive: false,
  currentTourStep: 0,
  tourHighlightedNodeIds: [],

  persona: "junior",

  diffMode: false,
  changedNodeIds: new Set<string>(),
  affectedNodeIds: new Set<string>(),

  focusNodeId: null,
  nodeHistory: [],

  filters: { ...DEFAULT_FILTERS, nodeTypes: new Set(DEFAULT_FILTERS.nodeTypes), complexities: new Set(DEFAULT_FILTERS.complexities), layerIds: new Set(DEFAULT_FILTERS.layerIds), edgeCategories: new Set(DEFAULT_FILTERS.edgeCategories) },
  filterPanelOpen: false,
  exportMenuOpen: false,
  pathFinderOpen: false,
  reactFlowInstance: null,

  nodeTypeFilters: { code: true, config: true, docs: true, infra: true, data: true, domain: true, knowledge: true },

  toggleNodeTypeFilter: (category) =>
    set((state) => ({
      nodeTypeFilters: {
        ...state.nodeTypeFilters,
        [category]: !state.nodeTypeFilters[category],
      },
      // Filter changes shift container.nodeIds; cached child positions
      // may reference filtered-out children. Drop the cache so Stage 2
      // recomputes against the current set.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),

  detailLevel: "file",
  setDetailLevel: (level) =>
    set({
      detailLevel: level,
      // Detail level changes which nodes are visible; cached positions stale.
      // Reset fn toggle so it doesn't resurrect when re-entering class view.
      showFunctionsInClassView: false,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  showFunctionsInClassView: false,
  toggleShowFunctionsInClassView: () =>
    set((state) => ({
      showFunctionsInClassView: !state.showFunctionsInClassView,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),

  setGraph: (graph) => {
    const searchEngine = new SearchEngine(graph.nodes);
    const query = get().searchQuery;
    const searchResults = query.trim() ? searchEngine.search(query) : [];
    const { viewMode, domainGraph, activeDomainId } = get();
    // Preserve domain view if a domain graph is already loaded
    const keepDomainView = viewMode === "domain" && domainGraph !== null;
    const { nodesById, nodeIdToLayerId, nodeIdToLayerIds } = buildGraphIndexes(graph);
    set({
      graph,
      nodesById,
      nodeIdToLayerId,
      nodeIdToLayerIds,
      searchEngine,
      searchResults,
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      nodeHistory: [],
      viewMode: keepDomainView ? "domain" as const : "structural" as const,
      activeDomainId: keepDomainView ? activeDomainId : null,
      containerLayoutCache: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
      containerSizeMemory: new Map(),
      stage1Tick: 0,
      layoutIssues: [],
    });
  },

  selectNode: (nodeId) => {
    const { selectedNodeId, nodeHistory } = get();
    if (nodeId && selectedNodeId && nodeId !== selectedNodeId) {
      // Push current node to history before navigating away
      set({
        selectedNodeId: nodeId,
        nodeHistory: [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY),
      });
    } else {
      set({ selectedNodeId: nodeId });
    }
  },

  navigateToNode: (nodeId) => {
    get().navigateToNodeInLayer(nodeId);
  },

  navigateToNodeInLayer: (nodeId) => {
    const { graph, selectedNodeId, nodeHistory, nodeIdToLayerId } = get();
    if (!graph) return;
    const layerId = nodeIdToLayerId.get(nodeId) ?? null;
    const newHistory =
      selectedNodeId && nodeId !== selectedNodeId
        ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
        : nodeHistory;
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: nodeId,
        focusNodeId: null,
        codeViewerOpen: false,
        codeViewerNodeId: null,
        codeViewerExpanded: false,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: nodeId,
        nodeHistory: newHistory,
      });
    }
  },

  navigateToHistoryIndex: (index) => {
    const { nodeHistory, graph, nodeIdToLayerId } = get();
    if (!graph || index < 0 || index >= nodeHistory.length) return;
    const targetId = nodeHistory[index];
    const newHistory = nodeHistory.slice(0, index);
    const layerId = nodeIdToLayerId.get(targetId) ?? null;
    set({
      selectedNodeId: targetId,
      nodeHistory: newHistory,
      ...(layerId ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId } : {}),
    });
  },

  goBackNode: () => {
    const { nodeHistory, graph, nodeIdToLayerId } = get();
    if (nodeHistory.length === 0 || !graph) return;
    const prevNodeId = nodeHistory[nodeHistory.length - 1];
    const newHistory = nodeHistory.slice(0, -1);
    const layerId = nodeIdToLayerId.get(prevNodeId) ?? null;
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    }
  },

  drillIntoLayer: (layerId) =>
    set({
      navigationLevel: "layer-detail",
      activeLayerId: layerId,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      // Container ids derive from folder names and collide across layers
      // (e.g. `container:auth` exists in many layers). Drop the cache so
      // we don't render stale positions for the new layer's children.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  navigateToOverview: () =>
    set({
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  setFocusNode: (nodeId) =>
    set({
      focusNodeId: nodeId,
      selectedNodeId: nodeId,
      // Focus mode narrows filteredGraphNodes to focus + 1-hop; the
      // surviving containers have a subset of their original children,
      // and the cache must not return positions for filtered-out ids.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchQuery: (query) => {
    const engine = get().searchEngine;
    const mode = get().searchMode;
    if (!engine || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }
    // Currently both modes use the same fuzzy engine
    // When embeddings are available, "semantic" mode will use SemanticSearchEngine
    void mode;
    const searchResults = engine.search(query);
    set({ searchQuery: query, searchResults });
  },

  setPersona: (persona) =>
    set({
      persona,
      // Persona changes filter node types, which shifts container.nodeIds.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  openCodeViewer: (nodeId) =>
    set({ codeViewerOpen: true, codeViewerNodeId: nodeId, codeViewerExpanded: false }),
  closeCodeViewer: () =>
    set({ codeViewerOpen: false, codeViewerNodeId: null, codeViewerExpanded: false }),
  expandCodeViewer: () => set({ codeViewerExpanded: true }),
  collapseCodeViewer: () => set({ codeViewerExpanded: false }),

  setDiffOverlay: (changed, affected) =>
    set({
      diffMode: true,
      changedNodeIds: new Set(changed),
      affectedNodeIds: new Set(affected),
    }),

  toggleDiffMode: () => set((state) => ({ diffMode: !state.diffMode })),

  clearDiffOverlay: () =>
    set({
      diffMode: false,
      changedNodeIds: new Set<string>(),
      affectedNodeIds: new Set<string>(),
    }),

  toggleFilterPanel: () => set((state) => ({
    filterPanelOpen: !state.filterPanelOpen,
    exportMenuOpen: false,
  })),

  toggleExportMenu: () => set((state) => ({
    exportMenuOpen: !state.exportMenuOpen,
    filterPanelOpen: false,
  })),

  togglePathFinder: () => set((state) => ({
    pathFinderOpen: !state.pathFinderOpen,
  })),

  setReactFlowInstance: (instance) => set({ reactFlowInstance: instance }),

  setFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters },
  })),

  resetFilters: () => set({
    filters: {
      nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
      complexities: new Set<Complexity>(ALL_COMPLEXITIES),
      layerIds: new Set<string>(),
      edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
    },
  }),

  hasActiveFilters: () => {
    const { filters } = get();
    return filters.nodeTypes.size !== ALL_NODE_TYPES.length
      || filters.complexities.size !== ALL_COMPLEXITIES.length
      || filters.layerIds.size > 0
      || filters.edgeCategories.size !== ALL_EDGE_CATEGORIES.length;
  },

  startTour: () => {
    const { graph, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[0].nodeIds);
    set({
      tourActive: true,
      currentTourStep: 0,
      tourHighlightedNodeIds: sorted[0].nodeIds,
      selectedNodeId: null,
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
    });
  },

  stopTour: () =>
    set({
      tourActive: false,
      currentTourStep: 0,
      tourHighlightedNodeIds: [],
    }),

  setTourStep: (step) => {
    const { graph, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (step < 0 || step >= sorted.length) return;
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[step].nodeIds);
    set({
      currentTourStep: step,
      tourHighlightedNodeIds: sorted[step].nodeIds,
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
    });
  },

  nextTourStep: () => {
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (currentTourStep < sorted.length - 1) {
      const next = currentTourStep + 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[next].nodeIds);
      set({
        currentTourStep: next,
        tourHighlightedNodeIds: sorted[next].nodeIds,
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
      });
    }
  },

  prevTourStep: () => {
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    if (currentTourStep > 0) {
      const sorted = getSortedTour(graph);
      const prev = currentTourStep - 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[prev].nodeIds);
      set({
        currentTourStep: prev,
        tourHighlightedNodeIds: sorted[prev].nodeIds,
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
      });
    }
  },

  viewMode: "structural",
  isKnowledgeGraph: false,
  domainGraph: null,
  activeDomainId: null,

  setDomainGraph: (graph) => {
    set({ domainGraph: graph });
  },

  setIsKnowledgeGraph: (value) => {
    set({ isKnowledgeGraph: value });
  },

  setViewMode: (mode) => {
    set({
      viewMode: mode,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
    });
  },

  navigateToDomain: (domainId) => {
    const { selectedNodeId, nodeHistory } = get();
    const newHistory = selectedNodeId
      ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
      : nodeHistory;
    set({
      viewMode: "domain" as const,
      activeDomainId: domainId,
      focusNodeId: null,
      nodeHistory: newHistory,
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      selectedNodeId: null,
      focusNodeId: null,
    });
  },

  expandedContainers: new Set<string>(),
  pendingFocusContainer: null,
  setPendingFocusContainer: (containerId) =>
    set({ pendingFocusContainer: containerId }),
  tourFitPending: false,
  setTourFitPending: (pending) => set({ tourFitPending: pending }),
  toggleContainer: (containerId) =>
    set((state) => {
      const next = new Set(state.expandedContainers);
      const willExpand = !next.has(containerId);
      if (willExpand) next.add(containerId);
      else next.delete(containerId);
      return {
        expandedContainers: next,
        pendingFocusContainer: willExpand
          ? containerId
          : state.pendingFocusContainer,
      };
    }),
  expandContainer: (containerId) =>
    set((state) => {
      if (state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.add(containerId);
      return { expandedContainers: next };
    }),
  collapseContainer: (containerId) =>
    set((state) => {
      if (!state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.delete(containerId);
      return { expandedContainers: next };
    }),
  collapseAllContainers: () => set({ expandedContainers: new Set() }),

  containerLayoutCache: new Map(),
  setContainerLayout: (containerId, childPositions, actualSize) =>
    set((state) => {
      const next = new Map(state.containerLayoutCache);
      next.set(containerId, { childPositions, actualSize });
      const sizeNext = new Map(state.containerSizeMemory);
      sizeNext.set(containerId, actualSize);
      return { containerLayoutCache: next, containerSizeMemory: sizeNext };
    }),
  clearContainerLayouts: () =>
    set({ containerLayoutCache: new Map(), expandedContainers: new Set(), pendingFocusContainer: null }),

  containerSizeMemory: new Map(),

  stage1Tick: 0,
  bumpStage1Tick: () => set((s) => ({ stage1Tick: s.stage1Tick + 1 })),

  layoutIssues: [],
  appendLayoutIssues: (issues) =>
    set((state) => {
      if (issues.length === 0) return {};
      // Dedupe by level+message so a re-running effect doesn't repeatedly
      // pile up identical issues.
      const seen = new Set(
        state.layoutIssues.map((i) => `${i.level}|${i.message}`),
      );
      const fresh = issues.filter((i) => !seen.has(`${i.level}|${i.message}`));
      if (fresh.length === 0) return {};
      return { layoutIssues: [...state.layoutIssues, ...fresh] };
    }),
  clearLayoutIssues: () => set({ layoutIssues: [] }),
}));

