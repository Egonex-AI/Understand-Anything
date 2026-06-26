import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodes,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import CustomNode from "./CustomNode";
import type { CustomFlowNode } from "./CustomNode";
import LayerClusterNode from "./LayerClusterNode";
import type { LayerClusterFlowNode } from "./LayerClusterNode";
import PortalNode from "./PortalNode";
import type { PortalFlowNode } from "./PortalNode";
import ContainerNode from "./ContainerNode";
import type { ContainerFlowNode } from "./ContainerNode";
import Breadcrumb from "./Breadcrumb";
import { useDashboardStore } from "../store";
import type {
  GraphEdge,
  GraphNode,
  NodeType,
} from "@understand-anything/core/types";
import { useTheme } from "../themes/index.ts";
import {
  LAYER_CLUSTER_WIDTH,
  LAYER_CLUSTER_HEIGHT,
  PORTAL_NODE_HEIGHT,
  nodesToElkInput,
  mergeElkPositions,
} from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import {
  aggregateLayerEdges,
  computePortals,
  findCrossLayerFileNodes,
} from "../utils/edgeAggregation";
import { fileChildren } from "../utils/fileChildren";
import { buildVisibleTree } from "../utils/visibleTree";
import { aggregateVisibleEdges } from "../utils/visibleEdges";
import { layoutNestedTree } from "../utils/elkNested";
import type { LaidOutNode } from "../utils/elkNested";
import { computeLayerStats } from "../utils/layerStats";

const nodeTypes = {
  custom: CustomNode,
  "layer-cluster": LayerClusterNode,
  portal: PortalNode,
  container: ContainerNode,
};

import type { NodeCategory } from "../store";

/**
 * Maps each NodeType to a filter category. Must be kept in sync with core NodeType.
 * Unknown types default to "code" with a development warning.
 */
const NODE_TYPE_TO_CATEGORY: Record<NodeType, NodeCategory> = {
  file: "code", function: "code", class: "code", module: "code", concept: "code",
  config: "config",
  document: "docs",
  service: "infra", resource: "infra", pipeline: "infra",
  table: "data", endpoint: "data", schema: "data",
  domain: "domain", flow: "domain", step: "domain",
  article: "knowledge", entity: "knowledge", topic: "knowledge", claim: "knowledge", source: "knowledge",
} as const;

// ── Helper components that must live inside <ReactFlow> ────────────────

/**
 * Pans/zooms to tour-highlighted nodes. Highlighted nodes are usually
 * children of collapsed containers — auto-expand fires synchronously on
 * the same `tourHighlightedNodeIds` change, but their child entries don't
 * appear in React Flow's node list until the async nested ELK layout lands
 * (hundreds of ms on big layers).
 *
 * We subscribe to React Flow's reactive node list via `useNodes()` so the
 * effect re-runs every time the node set actually changes (layout settle,
 * expand/collapse). When every highlighted id is present we fit; until then
 * we wait. A fallback covers the case where a highlighted id is filtered
 * out and never materialises.
 */
function TourFitView() {
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const setTourFitPending = useDashboardStore((s) => s.setTourFitPending);
  const { fitView, getInternalNode } = useReactFlow();
  // Subscribe to React Flow's user-node array so this effect re-fires when
  // the node set changes (e.g. nested ELK finally lands the highlighted ids
  // after the per-step RAF window already gave up). The RAF poll inside
  // covers the common fast path; the `nodes` dep covers the slow async path.
  const nodes = useNodes();
  const fittedKeyRef = useRef<string>("");
  const fallbackKeyRef = useRef<string>("");

  useEffect(() => {
    const targetKey = tourHighlightedNodeIds.join("\n");
    if (targetKey === "") {
      fittedKeyRef.current = "";
      fallbackKeyRef.current = "";
      setTourFitPending(false);
      return;
    }
    if (targetKey === fittedKeyRef.current) return;

    // Poll React Flow's internal lookup directly — `useNodes()` reflects
    // user-supplied nodes and may not fire on measure completion. Once
    // every highlighted id has measured dimensions, `fitView({ nodes })`
    // handles the child→absolute coordinate transform itself, which is
    // more reliable than recomputing bbox manually.
    const MAX_FRAMES = 240; // ~4s at 60fps
    let frame = 0;
    let cancelled = false;
    let rafId = 0;
    // After we've already shown the fallback for this step, suppress the
    // "Locating tour highlight…" overlay on subsequent re-fires (each
    // `nodes` change re-enters the effect, but the user has already given
    // up waiting). The retry still runs silently in case Stage 2 lands.
    if (fallbackKeyRef.current !== targetKey) setTourFitPending(true);

    const tick = () => {
      if (cancelled) return;
      let ready = true;
      for (const id of tourHighlightedNodeIds) {
        const internal = getInternalNode(id);
        if (!internal || !internal.measured?.width || !internal.measured?.height) {
          ready = false;
          break;
        }
      }
      if (ready) {
        fitView({
          nodes: tourHighlightedNodeIds.map((id) => ({ id })),
          duration: 500,
          padding: 0.3,
          maxZoom: 1.2,
          minZoom: 0.4,
        });
        fittedKeyRef.current = targetKey;
        fallbackKeyRef.current = "";
        setTourFitPending(false);
        return;
      }
      if (++frame < MAX_FRAMES) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      // Highlights still not ready after the poll window. Pan into the
      // layer so the user isn't stranded, but DON'T set fittedKeyRef —
      // if Stage 2 lands later, a `nodes` change will re-fire this effect
      // and we'll get another shot at the proper highlight fit.
      // `fallbackKeyRef` prevents the fallback fitView from re-firing on
      // every subsequent nodes update for the same step.
      if (fallbackKeyRef.current !== targetKey) {
        fitView({ duration: 500, padding: 0.3 });
        fallbackKeyRef.current = targetKey;
      }
      setTourFitPending(false);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [tourHighlightedNodeIds, nodes, fitView, getInternalNode, setTourFitPending]);

  return null;
}

/** Centers the graph on the selected node (e.g. from search). */
function SelectedNodeFitView() {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const { fitView } = useReactFlow();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== prevRef.current) {
      // Delay slightly so this runs after any layer-level fitView triggered
      // by navigateToNodeInLayer (which also changes activeLayerId).
      const timer = setTimeout(() => {
        fitView({
          nodes: [{ id: selectedNodeId }],
          duration: 500,
          padding: 0.3,
          maxZoom: 1.2,
          minZoom: 0.01,
        });
      }, 100);
      prevRef.current = selectedNodeId;
      return () => clearTimeout(timer);
    }
    prevRef.current = selectedNodeId;
  }, [selectedNodeId, fitView]);

  return null;
}

// ── Overview level: layers as cluster nodes ────────────────────────────

function useOverviewGraph() {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const nodeIdToLayerId = useDashboardStore((s) => s.nodeIdToLayerId);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);

  // Build cluster nodes / flow edges / dims synchronously; only the layout
  // call itself is async, so we memo the structural pieces and run ELK in an
  // effect.
  const built = useMemo(() => {
    if (!graph) {
      return null;
    }
    const layers = graph.layers ?? [];
    if (layers.length === 0) {
      return null;
    }

    // Build search match counts per layer using the precomputed
    // nodeIdToLayerId index. Reusing the store-level index avoids an extra
    // O(N) pass when search results change frequently.
    const searchMatchByLayer = new Map<string, number>();
    if (searchResults.length > 0) {
      for (const result of searchResults) {
        const lid = nodeIdToLayerId.get(result.nodeId);
        if (lid) {
          searchMatchByLayer.set(lid, (searchMatchByLayer.get(lid) ?? 0) + 1);
        }
      }
    }

    // Create cluster nodes. Per-layer aggregation goes through
    // `computeLayerStats`, which iterates `layer.nodeIds` against the
    // `nodesById` index — O(K) per layer instead of the previous
    // O(N) Array.filter that ran `layer.nodeIds.includes(n.id)` (#102).
    const clusterNodes: LayerClusterFlowNode[] = layers.map((layer, i) => {
      const { aggregateComplexity } = computeLayerStats(layer, nodesById);

      return {
        id: layer.id,
        type: "layer-cluster" as const,
        position: { x: 0, y: 0 },
        data: {
          layerId: layer.id,
          layerName: layer.name,
          layerDescription: layer.description,
          fileCount: layer.nodeIds.length,
          aggregateComplexity,
          layerColorIndex: i,
          searchMatchCount: searchMatchByLayer.get(layer.id),
          onDrillIn: drillIntoLayer,
        },
      };
    });

    // Aggregate edges between layers
    const aggregated = aggregateLayerEdges(graph);
    const flowEdges: Edge[] = aggregated.map((agg, i) => ({
      id: `le-${i}`,
      source: agg.sourceLayerId,
      target: agg.targetLayerId,
      label: `${agg.count}`,
      style: {
        stroke: "rgba(212,165,116,0.4)",
        strokeWidth: Math.min(1 + Math.log2(agg.count + 1), 5),
      },
      labelStyle: { fill: "#a39787", fontSize: 11, fontWeight: 600 },
    }));

    const dims = new Map<string, { width: number; height: number }>();
    for (const n of clusterNodes) {
      dims.set(n.id, { width: LAYER_CLUSTER_WIDTH, height: LAYER_CLUSTER_HEIGHT });
    }

    return { clusterNodes, flowEdges, dims };
  }, [graph, nodesById, nodeIdToLayerId, searchResults, drillIntoLayer]);

  const [overview, setOverview] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });
  const [layoutStatus, setLayoutStatus] = useState<"computing" | "ready">("ready");

  useEffect(() => {
    if (!built) {
      setOverview({ nodes: [], edges: [] });
      setLayoutStatus("ready");
      return;
    }
    let cancelled = false;
    const { clusterNodes, flowEdges, dims } = built;
    const baseNodes = clusterNodes as unknown as Node[];
    const elkInput = nodesToElkInput(baseNodes, flowEdges, dims);
    setLayoutStatus("computing");
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          // Funnel into store so WarningBanner surfaces them. getState()
          // avoids re-creating the closure on every layoutIssues change.
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        const positionedNodes = mergeElkPositions(baseNodes, positioned);
        setOverview({ nodes: positionedNodes, edges: flowEdges });
        setLayoutStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[overview ELK] layout failed:", err);
        setLayoutStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  return { ...overview, layoutStatus };
}

// ── Layer detail level: visible tree + nested ELK + render ──────────────

/**
 * Build a CustomFlowNode from a GraphNode. Shared by the nested renderer for
 * both `node`-kind VisibleNodes (files + their function/class children).
 */
function buildCustomFlowNode(
  node: GraphNode,
  opts: {
    diffMode: boolean;
    changedNodeIds: Set<string>;
    affectedNodeIds: Set<string>;
    onNodeClick: (nodeId: string) => void;
  },
): CustomFlowNode {
  return {
    id: node.id,
    type: "custom" as const,
    position: { x: 0, y: 0 },
    data: {
      label: node.name ?? node.filePath?.split("/").pop() ?? node.id,
      nodeType: node.type,
      summary: node.summary,
      complexity: node.complexity,
      tags: node.tags,
      isHighlighted: false,
      searchScore: undefined,
      isSelected: false,
      isTourHighlighted: false,
      isDiffChanged: opts.diffMode && opts.changedNodeIds.has(node.id),
      isDiffAffected: opts.diffMode && opts.affectedNodeIds.has(node.id),
      isDiffFaded:
        opts.diffMode &&
        !opts.changedNodeIds.has(node.id) &&
        !opts.affectedNodeIds.has(node.id),
      isNeighbor: false,
      isSelectionFaded: false,
      onNodeClick: opts.onNodeClick,
    },
  };
}

interface LayerDetailLayout {
  positioned: LaidOutNode[];
  portalNodes: PortalFlowNode[];
  portalEdges: Edge[];
}

const EMPTY_LAYOUT: LayerDetailLayout = {
  positioned: [],
  portalNodes: [],
  portalEdges: [],
};

/**
 * Layer-detail flow: filter → buildVisibleTree → aggregateVisibleEdges →
 * layoutNestedTree → render nested nodes + count-labelled edges. Expansion
 * (`expandedContainers`) drives nesting depth; there is no re-root.
 */
function useLayerDetailGraph() {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const persona = useDashboardStore((s) => s.persona);
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const affectedNodeIds = useDashboardStore((s) => s.affectedNodeIds);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const detailLevel = useDashboardStore((s) => s.detailLevel);
  const showFunctionsInClassView = useDashboardStore((s) => s.showFunctionsInClassView);
  const expandedContainers = useDashboardStore((s) => s.expandedContainers);

  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const selectNode = useDashboardStore((s) => s.selectNode);

  const handleNodeSelect = useCallback(
    (nodeId: string) => selectNode(nodeId),
    [selectNode],
  );

  // ── Stage 1: structural memo ──────────────────────────────────────────
  // Keep the existing filtering (layer membership, persona, type filters,
  // focusNodeId 1-hop neighborhood), then build the visible tree + edges.
  const structural = useMemo(() => {
    if (!graph || !activeLayerId) return null;

    const activeLayer = graph.layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) return null;

    const layerNodeIds = new Set(activeLayer.nodeIds);

    // Expand layer membership to include sub-file nodes (function/class)
    // whose parent file is in this layer, joined via "contains" edges.
    const expandedLayerNodeIds = new Set(layerNodeIds);
    if (detailLevel !== "file") {
      for (const edge of graph.edges) {
        if (edge.type === "contains" && layerNodeIds.has(edge.source)) {
          const child = nodesById.get(edge.target);
          if (!child) continue;
          if (child.type === "class") {
            expandedLayerNodeIds.add(edge.target);
          } else if (child.type === "function" && showFunctionsInClassView) {
            expandedLayerNodeIds.add(edge.target);
          }
        }
      }
    }

    const subFileTypes = new Set(["function", "class"]);
    const allVisibleTypes = new Set([
      "file", "module", "concept",
      "config", "document", "service", "table",
      "endpoint", "pipeline", "schema", "resource",
      "domain", "flow", "step",
      "function", "class",
    ]);

    let filteredGraphNodes = graph.nodes.filter((n) => {
      if (!expandedLayerNodeIds.has(n.id)) return false;
      if (!allVisibleTypes.has(n.type)) return false;
      if (persona === "non-technical" && subFileTypes.has(n.type)) return false;
      return true;
    });

    filteredGraphNodes = filteredGraphNodes.filter((n) => {
      const category = NODE_TYPE_TO_CATEGORY[n.type as NodeType];
      if (!category && import.meta.env.DEV) {
        console.warn(`[GraphView] Unknown node type "${n.type}" — defaulting to "code" category`);
      }
      const effectiveCategory = category ?? "code";
      return nodeTypeFilters[effectiveCategory] !== false;
    });

    let filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));

    let filteredGraphEdges = graph.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    );

    // Focus mode: 1-hop neighborhood within the layer.
    if (focusNodeId && filteredNodeIds.has(focusNodeId)) {
      const focusNeighborIds = new Set<string>([focusNodeId]);
      for (const edge of filteredGraphEdges) {
        if (edge.source === focusNodeId) focusNeighborIds.add(edge.target);
        if (edge.target === focusNodeId) focusNeighborIds.add(edge.source);
      }
      filteredGraphNodes = filteredGraphNodes.filter((n) => focusNeighborIds.has(n.id));
      filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));
      filteredGraphEdges = filteredGraphEdges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
      );
    }

    // Visible nesting tree — expansion drives depth, no re-root.
    const nodeById = new Map(filteredGraphNodes.map((n) => [n.id, n]));
    const tree = buildVisibleTree({
      scopeNodes: filteredGraphNodes,
      edges: filteredGraphEdges,
      rootPrefix: "",
      expanded: expandedContainers,
      fileChildrenOf: (fileId) => fileChildren(fileId, filteredGraphEdges, nodeById),
    });
    const vEdges = aggregateVisibleEdges(filteredGraphEdges, tree.visibleAtomOf);

    // Portals for connected external layers (unchanged), sourced off the
    // visible atom for each cross-layer file (skip undefined atoms).
    const portals = computePortals(graph, activeLayerId);
    const layerIndexMap = new Map(graph.layers.map((l, i) => [l.id, i]));
    const portalNodes: PortalFlowNode[] = portals.map((portal) => ({
      id: `portal:${portal.layerId}`,
      type: "portal" as const,
      position: { x: 0, y: 0 },
      data: {
        targetLayerId: portal.layerId,
        targetLayerName: portal.layerName,
        connectionCount: portal.connectionCount,
        layerColorIndex: layerIndexMap.get(portal.layerId) ?? 0,
        onNavigate: drillIntoLayer,
      },
    }));

    const portalEdges: Edge[] = [];
    let portalEdgeIdx = 0;
    for (const portal of portals) {
      const crossFiles = findCrossLayerFileNodes(graph, activeLayerId, portal.layerId);
      const seenAtoms = new Set<string>();
      for (const fileId of crossFiles) {
        const atomId = tree.visibleAtomOf.get(fileId);
        if (!atomId) continue;
        if (seenAtoms.has(atomId)) continue;
        seenAtoms.add(atomId);
        portalEdges.push({
          id: `portal-e-${portalEdgeIdx++}`,
          source: atomId,
          target: `portal:${portal.layerId}`,
          style: { stroke: "rgba(212,165,116,0.2)", strokeWidth: 1, strokeDasharray: "4 4" },
          animated: false,
        });
      }
    }

    return {
      tree,
      vEdges,
      filteredGraphEdges,
      portalNodes,
      portalEdges,
      nodeToContainer: tree.visibleAtomOf,
    };
  }, [
    graph,
    nodesById,
    activeLayerId,
    persona,
    diffMode,
    changedNodeIds,
    affectedNodeIds,
    focusNodeId,
    nodeTypeFilters,
    drillIntoLayer,
    detailLevel,
    showFunctionsInClassView,
    expandedContainers,
  ]);

  // ── Stage 2: async nested ELK ─────────────────────────────────────────
  const [layout, setLayout] = useState<LayerDetailLayout>(EMPTY_LAYOUT);
  const [layoutStatus, setLayoutStatus] = useState<"computing" | "ready">("ready");

  useEffect(() => {
    if (!structural) {
      setLayout(EMPTY_LAYOUT);
      setLayoutStatus("ready");
      return;
    }
    let cancelled = false;
    const { tree, vEdges, portalNodes, portalEdges } = structural;
    setLayoutStatus("computing");
    layoutNestedTree(tree.nodes, vEdges)
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        // Surface ONLY hard failures; "auto-corrected" noise is harmless.
        const real = issues.filter((i) => i === "elk-failed");
        if (real.length) {
          useDashboardStore.getState().appendLayoutIssues(
            real.map((message) => ({ level: "dropped" as const, category: "layout", message })),
          );
        }
        // Portals are top-level atoms — stack them to the right of the tree.
        let maxX = 0;
        let minY = Number.POSITIVE_INFINITY;
        for (const p of positioned) {
          if (p.parentId !== null) continue;
          maxX = Math.max(maxX, p.x + p.width);
          minY = Math.min(minY, p.y);
        }
        if (!Number.isFinite(minY)) minY = 0;
        const portalX = maxX + 120;
        const placedPortals = portalNodes.map((pn, i) => ({
          ...pn,
          position: { x: portalX, y: minY + i * (PORTAL_NODE_HEIGHT + 24) },
        }));
        setLayout({ positioned, portalNodes: placedPortals, portalEdges });
        setLayoutStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[layer-detail nested ELK] layout failed:", err);
        setLayoutStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [structural]);

  // ── Container visual overlay flag memos (bucketed via visibleAtomOf) ───
  const nodeToContainer = structural?.nodeToContainer ?? EMPTY_MAP;
  const filteredEdges = structural?.filteredGraphEdges ?? EMPTY_EDGES;

  const searchHitsByContainer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of searchResults) {
      const cid = nodeToContainer.get(r.nodeId);
      if (!cid || cid === r.nodeId) continue;
      m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [searchResults, nodeToContainer]);

  const diffContainers = useMemo(() => {
    const s = new Set<string>();
    if (!diffMode) return s;
    for (const id of changedNodeIds) {
      const cid = nodeToContainer.get(id);
      if (cid && cid !== id) s.add(cid);
    }
    for (const id of affectedNodeIds) {
      const cid = nodeToContainer.get(id);
      if (cid && cid !== id) s.add(cid);
    }
    return s;
  }, [diffMode, changedNodeIds, affectedNodeIds, nodeToContainer]);

  const focusContainerIds = useMemo(() => {
    const s = new Set<string>();
    if (!focusNodeId) return s;
    const focusCid = nodeToContainer.get(focusNodeId);
    if (focusCid && focusCid !== focusNodeId) s.add(focusCid);
    for (const e of filteredEdges) {
      if (e.source === focusNodeId) {
        const cid = nodeToContainer.get(e.target);
        if (cid && cid !== e.target) s.add(cid);
      } else if (e.target === focusNodeId) {
        const cid = nodeToContainer.get(e.source);
        if (cid && cid !== e.source) s.add(cid);
      }
    }
    return s;
  }, [focusNodeId, filteredEdges, nodeToContainer]);

  const selectionContainerIds = useMemo(() => {
    const s = new Set<string>();
    if (!selectedNodeId) return s;
    const selCid = nodeToContainer.get(selectedNodeId);
    if (selCid && selCid !== selectedNodeId) s.add(selCid);
    for (const e of filteredEdges) {
      if (e.source === selectedNodeId) {
        const cid = nodeToContainer.get(e.target);
        if (cid && cid !== e.target) s.add(cid);
      } else if (e.target === selectedNodeId) {
        const cid = nodeToContainer.get(e.source);
        if (cid && cid !== e.source) s.add(cid);
      }
    }
    return s;
  }, [selectedNodeId, filteredEdges, nodeToContainer]);

  // ── Stage 3: nodes memo (build React Flow nodes from positioned tree) ──
  const nodes = useMemo<Node[]>(() => {
    if (!structural) return layout.portalNodes as unknown as Node[];

    const visibleById = new Map(structural.tree.nodes.map((vn) => [vn.id, vn]));
    const searchMap = new Map(searchResults.map((r) => [r.nodeId, r.score]));
    const tourSet = new Set(tourHighlightedNodeIds);

    // Neighbor set for selection highlighting.
    const neighborNodeIds = new Set<string>();
    if (selectedNodeId) {
      for (const edge of filteredEdges) {
        if (edge.source === selectedNodeId) neighborNodeIds.add(edge.target);
        if (edge.target === selectedNodeId) neighborNodeIds.add(edge.source);
      }
      neighborNodeIds.add(selectedNodeId);
    }
    const hasSelection = !!selectedNodeId;

    const out: Node[] = [];
    layout.positioned.forEach((p, idx) => {
      const vn = visibleById.get(p.id);
      if (!vn) return;
      const nested = p.parentId !== null;

      if (vn.kind === "cluster") {
        const cid = p.id;
        const rawHits = searchHitsByContainer.get(cid) ?? 0;
        const hasSearchHits = rawHits > 0;
        const node: ContainerFlowNode = {
          id: cid,
          type: "container",
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          ...(nested ? { parentId: p.parentId!, extent: "parent" as const } : {}),
          data: {
            containerId: cid,
            name: vn.name,
            childCount: vn.childCount,
            strategy: "folder",
            colorIndex: idx % 12,
            isExpanded: expandedContainers.has(cid),
            hasSearchHits,
            searchHitCount: hasSearchHits ? rawHits : undefined,
            isDiffAffected: diffContainers.has(cid),
            isFocusedViaChild:
              focusContainerIds.has(cid) || selectionContainerIds.has(cid),
          },
        };
        out.push(node as Node);
        return;
      }

      // kind === "node"
      if (!vn.graphNode) return;
      const base = buildCustomFlowNode(vn.graphNode, {
        diffMode,
        changedNodeIds,
        affectedNodeIds,
        onNodeClick: handleNodeSelect,
      });
      const searchScore = searchMap.get(p.id);
      const isSelected = selectedNodeId === p.id;
      const isNeighbor = hasSelection && neighborNodeIds.has(p.id) && !isSelected;
      out.push({
        ...base,
        position: { x: p.x, y: p.y },
        ...(nested ? { parentId: p.parentId!, extent: "parent" as const } : {}),
        data: {
          ...base.data,
          isHighlighted: searchScore !== undefined,
          searchScore,
          isSelected,
          isTourHighlighted: tourSet.has(p.id),
          isNeighbor,
          isSelectionFaded: hasSelection && !neighborNodeIds.has(p.id),
        },
      } as Node);
    });

    out.push(...(layout.portalNodes as unknown as Node[]));
    return out;
  }, [
    structural,
    layout,
    searchResults,
    tourHighlightedNodeIds,
    selectedNodeId,
    filteredEdges,
    expandedContainers,
    diffMode,
    changedNodeIds,
    affectedNodeIds,
    handleNodeSelect,
    searchHitsByContainer,
    diffContainers,
    focusContainerIds,
    selectionContainerIds,
  ]);

  // ── Stage 4: edges memo (count-labelled, selection styling, portals) ───
  const edges = useMemo<Edge[]>(() => {
    const vEdges = structural?.vEdges ?? [];
    const base: Edge[] = vEdges.map((ve) => ({
      id: ve.id,
      source: ve.source,
      target: ve.target,
      label: String(ve.count),
      style: {
        stroke: "rgba(212,165,116,0.45)",
        strokeWidth: Math.min(1 + Math.log2(ve.count + 1), 5),
      },
      labelStyle: { fill: "#a39787", fontSize: 11 },
    }));

    const composed = [...base, ...layout.portalEdges];
    if (!selectedNodeId) return composed;

    return composed.map((edge) => {
      if ((edge.style as Record<string, unknown>)?.strokeDasharray) return edge;
      const isSelectedEdge =
        edge.source === selectedNodeId || edge.target === selectedNodeId;
      if (isSelectedEdge) {
        return {
          ...edge,
          animated: true,
          style: { stroke: "rgba(212,165,116,0.8)", strokeWidth: 2.5 },
          labelStyle: { fill: "#d4a574", fontSize: 11, fontWeight: 600 },
        };
      }
      return {
        ...edge,
        animated: false,
        style: { stroke: "rgba(212,165,116,0.08)", strokeWidth: 1 },
        labelStyle: { fill: "rgba(163,151,135,0.2)", fontSize: 10 },
      };
    });
  }, [structural, layout.portalEdges, selectedNodeId]);

  return {
    nodes,
    edges,
    layoutStatus,
    visibleAtomOf: structural?.tree.visibleAtomOf ?? EMPTY_MAP,
  };
}

const EMPTY_MAP: Map<string, string> = new Map();
const EMPTY_EDGES: GraphEdge[] = [];

// ── Main inner component (must be inside ReactFlowProvider) ────────────

function GraphViewInner() {
  const graph = useDashboardStore((s) => s.graph);
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const toggleContainer = useDashboardStore((s) => s.toggleContainer);
  const expandedContainers = useDashboardStore((s) => s.expandedContainers);
  const setReactFlowInstance = useDashboardStore((s) => s.setReactFlowInstance);
  const tourFitPending = useDashboardStore((s) => s.tourFitPending);
  const { preset } = useTheme();

  const overviewGraph = useOverviewGraph();
  const detailGraph = useLayerDetailGraph();

  const { nodes: initialNodes, edges: initialEdges, layoutStatus } =
    navigationLevel === "overview" ? overviewGraph : detailGraph;

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const { fitView, setCenter, getViewport } = useReactFlow();
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const revealNode = useDashboardStore((s) => s.revealNode);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Fit view on level/layer transitions. Layout is async (~125ms+ for
  // medium layers), so a fixed-delay timer can fire before positions
  // arrive and leave the viewport on the previous layer. Instead, mark
  // a pending fit on navigation and run it when nodes actually populate.
  const pendingFitRef = useRef(false);
  useEffect(() => {
    // Re-fit on level/layer navigation so the new level lands centered.
    pendingFitRef.current = true;
  }, [navigationLevel, activeLayerId]);

  useEffect(() => {
    if (!pendingFitRef.current) return;
    if (nodes.length === 0) return;
    pendingFitRef.current = false;
    // One frame so React Flow has positioned the nodes before fit.
    const raf = requestAnimationFrame(() => {
      fitView({ duration: 400, padding: 0.2 });
    });
    return () => cancelAnimationFrame(raf);
  }, [nodes, fitView]);

  // Reveal-on-select: when a node is selected (e.g. from search) that isn't
  // rendered at the current flat level, drill to its folder so it's visible.
  // Clicking an already-visible node is a no-op here.
  useEffect(() => {
    if (navigationLevel !== "layer-detail" || !selectedNodeId) return;
    if (nodes.some((n) => n.id === selectedNodeId)) return;
    revealNode(selectedNodeId);
  }, [selectedNodeId, nodes, navigationLevel, revealNode]);

  // Pan-on-expand: when a new container id is added to expandedContainers,
  // gently re-center on its box (once laid out) at the current zoom, keeping
  // neighbours visible. Guarded on the node lookup — if not yet positioned,
  // skip; it'll be there next render.
  const prevExpandedRef = useRef<Set<string>>(expandedContainers);
  useEffect(() => {
    const prev = prevExpandedRef.current;
    prevExpandedRef.current = expandedContainers;
    if (expandedContainers.size <= prev.size) return;
    let added: string | undefined;
    for (const id of expandedContainers) {
      if (!prev.has(id)) { added = id; break; }
    }
    if (!added) return;
    const box = nodes.find((n) => n.id === added);
    if (!box) return;
    const w = box.width ?? 0;
    const h = box.height ?? 0;
    const cx = box.position.x + w / 2;
    const cy = box.position.y + h / 2;
    setCenter(cx, cy, { zoom: getViewport().zoom, duration: 400 });
  }, [expandedContainers, nodes, setCenter, getViewport]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      if (navigationLevel === "overview") {
        drillIntoLayer(node.id);
      } else if (node.id.startsWith("portal:")) {
        drillIntoLayer(node.id.replace("portal:", ""));
      } else if (node.id.startsWith("container:")) {
        // Expand-in-place: clicking a cluster toggles its expansion.
        toggleContainer(node.id);
      } else {
        selectNode(node.id);
      }
    },
    [navigationLevel, drillIntoLayer, selectNode, toggleContainer],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-root rounded-lg">
        <p className="text-text-muted text-sm">No knowledge graph loaded</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <Breadcrumb />
      {focusNodeId && navigationLevel === "layer-detail" && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={() => setFocusNode(null)}
            className="px-4 py-2 rounded-full bg-elevated border border-gold/30 text-gold text-xs font-semibold tracking-wider uppercase hover:bg-gold/10 transition-colors flex items-center gap-2 shadow-lg"
          >
            <span>Showing neighborhood</span>
            <span className="text-text-muted">&times;</span>
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={setReactFlowInstance}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ minZoom: 0.01, padding: 0.1 }}
        minZoom={0.01}
        maxZoom={2}
        colorMode={preset.isDark ? "dark" : "light"}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--color-edge-dot)" gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeColor="var(--color-elevated)"
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
        <TourFitView />
        <SelectedNodeFitView />
      </ReactFlow>
      {(layoutStatus === "computing" || tourFitPending) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(10,10,10,0.5)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <span style={{ color: "#d4a574", fontSize: 14 }}>
            {tourFitPending ? "Locating tour highlight…" : "Computing layout…"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphViewInner />
    </ReactFlowProvider>
  );
}
