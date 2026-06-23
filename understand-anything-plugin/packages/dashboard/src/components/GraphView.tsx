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
import type { ContainerFlowNode, ContainerNodeData } from "./ContainerNode";
import Breadcrumb from "./Breadcrumb";
import { useDashboardStore } from "../store";
import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  NodeType,
} from "@understand-anything/core/types";
import { useTheme } from "../themes/index.ts";
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  LAYER_CLUSTER_WIDTH,
  LAYER_CLUSTER_HEIGHT,
  PORTAL_NODE_WIDTH,
  PORTAL_NODE_HEIGHT,
  ELK_DEFAULT_LAYOUT_OPTIONS,
  nodesToElkInput,
  mergeElkPositions,
} from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import type { ElkChild, ElkEdge, ElkInput } from "../utils/elk-layout";
import {
  aggregateContainerEdges,
  aggregateLayerEdges,
  computePortals,
  findCrossLayerFileNodes,
} from "../utils/edgeAggregation";
import { deriveContainers } from "../utils/containers";
import type { DerivedContainer } from "../utils/containers";
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
 * appear in React Flow's node list until Stage 2 layout writes the
 * `containerLayoutCache` (async ELK call, hundreds of ms on big layers).
 *
 * We subscribe to React Flow's reactive node list via `useNodes()` so the
 * effect re-runs every time the node set actually changes (Stage 1, Stage
 * 2, expand/collapse). When every highlighted id is present we fit; until
 * then we wait. A 2s fallback timer covers the case where a highlighted
 * id is filtered out and never materialises.
 */
function TourFitView() {
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const setTourFitPending = useDashboardStore((s) => s.setTourFitPending);
  const { fitView, getInternalNode } = useReactFlow();
  // Subscribe to React Flow's user-node array so this effect re-fires when
  // the node set changes (e.g. Stage 2 finally lands the highlighted ids
  // after the per-step RAF window already gave up). The RAF poll inside
  // covers the common fast path; the `nodes` dep covers slow Stage 2.
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

// ── Layer detail level: topology (ELK Stage 1) + visual overlay ─────────

interface LayerDetailTopology {
  nodes: Node[];
  edges: Edge[];
  portalNodes: PortalFlowNode[];
  portalEdges: Edge[];
  filteredEdges: KnowledgeGraph["edges"];
  filteredNodes: GraphNode[];
  containers: DerivedContainer[];
  nodeToContainer: Map<string, string>;
  intraContainer: GraphEdge[];
}

const EMPTY_TOPOLOGY: LayerDetailTopology = {
  nodes: [],
  edges: [],
  portalNodes: [],
  portalEdges: [],
  filteredEdges: [],
  filteredNodes: [],
  containers: [],
  nodeToContainer: new Map(),
  intraContainer: [],
};

/**
 * Topology hook: derives containers, aggregates inter-container edges, then
 * runs Stage 1 ELK on container atoms (no children rendered yet — Task 12
 * lazy-expands them). Only recomputes when the graph structure, active
 * layer, persona, diff state, focus, or filters change. Does NOT depend on
 * selectedNodeId, searchResults, tourHighlightedNodeIds, or
 * expandedContainers (Stage 2 concern).
 */
function useLayerDetailTopology(): LayerDetailTopology & {
  layoutStatus: "computing" | "ready";
} {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const persona = useDashboardStore((s) => s.persona);
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const affectedNodeIds = useDashboardStore((s) => s.affectedNodeIds);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const detailLevel = useDashboardStore((s) => s.detailLevel);
  const showFunctionsInClassView = useDashboardStore((s) => s.showFunctionsInClassView);

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
    },
    [selectNode],
  );

  // Stable across renders so ContainerNode's memo() actually short-circuits.
  // Reading toggleContainer via getState() avoids subscribing this hook to
  // expandedContainers — Stage 1 must not relayout on expand.
  const handleContainerToggle = useCallback(
    (id: string) => useDashboardStore.getState().toggleContainer(id),
    [],
  );

  // ── Structural build (synchronous): filtering + containers + nodes/edges
  // pre-layout. Re-runs whenever the inputs that drive container derivation
  // change. The only async piece is the ELK call below.
  const built = useMemo(() => {
    if (!graph || !activeLayerId) return null;

    const activeLayer = graph.layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) return null;

    const layerNodeIds = new Set(activeLayer.nodeIds);

    // Expand layer membership to include sub-file nodes (function/class)
    // whose parent file is in this layer. Joined via "contains" edges.
    // File view: file nodes only (architecture-level dependencies).
    // Class view: file nodes + class nodes, functions only when toggle is on.
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
      if (!category) {
        if (import.meta.env.DEV) {
          console.warn(`[GraphView] Unknown node type "${n.type}" — defaulting to "code" category`);
        }
      }
      const effectiveCategory = category ?? "code";
      return nodeTypeFilters[effectiveCategory] !== false;
    });

    let filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));

    let filteredGraphEdges = graph.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    );

    // Focus mode: 1-hop neighborhood within the layer
    if (focusNodeId && filteredNodeIds.has(focusNodeId)) {
      const focusNeighborIds = new Set<string>([focusNodeId]);
      for (const edge of filteredGraphEdges) {
        if (edge.source === focusNodeId) focusNeighborIds.add(edge.target);
        if (edge.target === focusNodeId) focusNeighborIds.add(edge.source);
      }
      filteredGraphNodes = filteredGraphNodes.filter((n) =>
        focusNeighborIds.has(n.id),
      );
      filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));
      filteredGraphEdges = filteredGraphEdges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
      );
    }

    // Derive containers + bucket edges
    const { containers, ungrouped } = deriveContainers(
      filteredGraphNodes,
      filteredGraphEdges,
    );
    const ungroupedSet = new Set(ungrouped);
    const nodeToContainer = new Map<string, string>();
    for (const c of containers) {
      for (const id of c.nodeIds) nodeToContainer.set(id, c.id);
    }
    // Ungrouped nodes are their own atoms — register them so edge
    // aggregation treats inter-(container,ungrouped) edges as cross-atom.
    for (const id of ungroupedSet) {
      nodeToContainer.set(id, id);
    }
    const { intraContainer, interContainerAggregated } = aggregateContainerEdges(
      filteredGraphEdges,
      nodeToContainer,
    );

    // Container size estimate (size memory takes priority).
    // Caps prevent first-paint sprawl: at 100 children sqrt() yields
    // ~3360px which renders as a huge empty box pre-expansion. Stage 2
    // sets the actual size once it's measured, and Task 15 re-flows.
    const STAGE1_MAX_CONTAINER_WIDTH = 800;
    const STAGE1_MAX_CONTAINER_HEIGHT = 600;
    const sizeMemory = useDashboardStore.getState().containerSizeMemory;
    const containerWidth = (c: DerivedContainer) => {
      const memo = sizeMemory.get(c.id)?.width;
      if (memo) return memo;
      const estimate = Math.sqrt(c.nodeIds.length) * NODE_WIDTH * 1.2;
      return Math.min(STAGE1_MAX_CONTAINER_WIDTH, Math.max(NODE_WIDTH, estimate));
    };
    const containerHeight = (c: DerivedContainer) => {
      const memo = sizeMemory.get(c.id)?.height;
      if (memo) return memo;
      const estimate = Math.sqrt(c.nodeIds.length) * NODE_HEIGHT * 1.2;
      return Math.min(STAGE1_MAX_CONTAINER_HEIGHT, Math.max(NODE_HEIGHT, estimate));
    };

    // Build container flow nodes (children NOT rendered yet — Task 12)
    const containerFlowNodes: ContainerFlowNode[] = containers.map((c, idx) => ({
      id: c.id,
      type: "container" as const,
      position: { x: 0, y: 0 },
      width: containerWidth(c),
      height: containerHeight(c),
      data: {
        containerId: c.id,
        name: c.name,
        childCount: c.nodeIds.length,
        strategy: c.strategy,
        colorIndex: idx % 12,
        isExpanded: false,
        hasSearchHits: false,
        isDiffAffected: false, // Task 14 will populate this
        isFocusedViaChild: false,
        onToggle: handleContainerToggle,
      },
    }));

    // Build ungrouped file flow nodes (existing CustomFlowNode shape)
    const ungroupedFlowNodes: CustomFlowNode[] = filteredGraphNodes
      .filter((n) => ungroupedSet.has(n.id))
      .map((node) => ({
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
          isDiffChanged: diffMode && changedNodeIds.has(node.id),
          isDiffAffected: diffMode && affectedNodeIds.has(node.id),
          isDiffFaded: diffMode && !changedNodeIds.has(node.id) && !affectedNodeIds.has(node.id),
          isNeighbor: false,
          isSelectionFaded: false,
          onNodeClick: handleNodeSelect,
        },
      }));

    // Aggregated cross-atom edges (count label, log-scaled stroke).
    // diffMode dims unaffected aggregated edges (no per-edge diff data — we
    // can't tell which underlying edges are impacted without expanding a
    // container, so just fade everything in diff mode at this stage).
    const aggEdges: Edge[] = interContainerAggregated.map((agg, i) => {
      const baseStyle = diffMode
        ? { stroke: "rgba(212,165,116,0.08)", strokeWidth: 1 }
        : {
            stroke: "rgba(212,165,116,0.4)",
            strokeWidth: Math.min(1 + Math.log2(agg.count + 1), 5),
          };
      return {
        id: `agg-${i}`,
        source: agg.sourceContainerId,
        target: agg.targetContainerId,
        label: String(agg.count),
        style: baseStyle,
        labelStyle: {
          fill: diffMode ? "rgba(163,151,135,0.3)" : "#a39787",
          fontSize: 11,
        },
      };
    });

    // Portal nodes for connected external layers (unchanged)
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
    let portalEdgeIdx = aggEdges.length;
    for (const portal of portals) {
      const crossFiles = findCrossLayerFileNodes(graph, activeLayerId, portal.layerId);
      // Dedupe by atom — multiple files in the same container hitting the
      // same portal collapse to one Stage 1 edge. Task 12 will re-route to
      // the actual file ids when the source container expands.
      const seenAtoms = new Set<string>();
      for (const fileId of crossFiles) {
        if (!filteredNodeIds.has(fileId)) continue;
        const atomId = nodeToContainer.get(fileId) ?? fileId;
        if (seenAtoms.has(atomId)) continue;
        seenAtoms.add(atomId);
        portalEdges.push({
          id: `e-${portalEdgeIdx++}`,
          source: atomId,
          target: `portal:${portal.layerId}`,
          style: { stroke: "rgba(212,165,116,0.2)", strokeWidth: 1, strokeDasharray: "4 4" },
          animated: false,
        });
      }
    }

    return {
      containers,
      ungrouped,
      nodeToContainer,
      intraContainer,
      filteredGraphNodes,
      filteredGraphEdges,
      containerFlowNodes,
      ungroupedFlowNodes,
      aggEdges,
      portalNodes,
      portalEdges,
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
    handleNodeSelect,
    handleContainerToggle,
  ]);

  // ── Async ELK Stage 1 layout ────────────────────────────────────────────
  // `stage1Tick` is bumped by the Stage 2 effect when an actual container
  // size deviates >20% from the Stage 1 estimate — it forces this effect
  // to re-run with the now-cached actual size in containerSizeMemory so
  // surrounding atoms reflow into the correct positions.
  const stage1Tick = useDashboardStore((s) => s.stage1Tick);
  const [topology, setTopology] = useState<LayerDetailTopology>(EMPTY_TOPOLOGY);
  const [layoutStatus, setLayoutStatus] = useState<"computing" | "ready">("ready");

  useEffect(() => {
    if (!built) {
      setTopology(EMPTY_TOPOLOGY);
      setLayoutStatus("ready");
      return;
    }
    let cancelled = false;
    const {
      containers,
      nodeToContainer,
      intraContainer,
      filteredGraphNodes,
      filteredGraphEdges,
      containerFlowNodes,
      ungroupedFlowNodes,
      aggEdges,
      portalNodes,
      portalEdges,
    } = built;

    // Build Stage 1 ELK input: containers as opaque atoms + ungrouped files
    // + portals, all at the top level.
    //
    // Read containerSizeMemory at effect-run time so that a Stage 2-driven
    // re-layout (via `stage1Tick`) picks up the freshly measured actual
    // size and routes around the now-correctly-sized atom. The structural
    // memo intentionally does NOT depend on `stage1Tick` (avoids rebuilding
    // the entire layer's structural state), so we override widths from
    // size memory here.
    const sizeMemoryAtRun = useDashboardStore.getState().containerSizeMemory;
    const stage1Children: ElkChild[] = [
      ...containerFlowNodes.map((cn) => {
        const memo = sizeMemoryAtRun.get(cn.id);
        return {
          id: cn.id,
          width: memo?.width ?? cn.width ?? NODE_WIDTH,
          height: memo?.height ?? cn.height ?? NODE_HEIGHT,
        };
      }),
      ...ungroupedFlowNodes.map((un) => ({
        id: un.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      ...portalNodes.map((pn) => ({
        id: pn.id,
        width: PORTAL_NODE_WIDTH,
        height: PORTAL_NODE_HEIGHT,
      })),
    ];

    const stage1Edges: ElkEdge[] = [
      ...aggEdges.map((e) => ({
        id: e.id,
        sources: [String(e.source)],
        targets: [String(e.target)],
      })),
      ...portalEdges.map((e) => ({
        id: e.id,
        sources: [String(e.source)],
        targets: [String(e.target)],
      })),
    ];

    const elkInput: ElkInput = {
      id: "layer",
      layoutOptions: ELK_DEFAULT_LAYOUT_OPTIONS,
      children: stage1Children,
      edges: stage1Edges,
    };

    setLayoutStatus("computing");
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          // Funnel into store so WarningBanner surfaces them.
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        const allBaseNodes: Node[] = [
          ...(containerFlowNodes as unknown as Node[]),
          ...(ungroupedFlowNodes as unknown as Node[]),
          ...(portalNodes as unknown as Node[]),
        ];
        const positionedNodes = mergeElkPositions(allBaseNodes, positioned);
        setTopology({
          nodes: positionedNodes,
          edges: aggEdges,
          portalNodes,
          portalEdges,
          filteredEdges: filteredGraphEdges,
          filteredNodes: filteredGraphNodes,
          containers,
          nodeToContainer,
          intraContainer,
        });
        setLayoutStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[layer-detail Stage 1 ELK] layout failed:", err);
        setLayoutStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [built, stage1Tick]);

  // ── Stage 2: lazy per-container layout on expand ───────────────────────
  // Watches expandedContainers and computes ELK on each newly-expanded
  // container's children (without a cache entry). Critically does NOT
  // depend on `built` — expanding a container must not trigger Stage 1
  // relayout of the surrounding atoms.
  const expandedContainers = useDashboardStore((s) => s.expandedContainers);
  const containerLayoutCache = useDashboardStore((s) => s.containerLayoutCache);
  const setContainerLayout = useDashboardStore((s) => s.setContainerLayout);
  const bumpStage1Tick = useDashboardStore((s) => s.bumpStage1Tick);

  const stage2Containers = topology.containers;
  const stage2Intra = topology.intraContainer;

  useEffect(() => {
    if (stage2Containers.length === 0) return;
    const toCompute = [...expandedContainers].filter(
      (id) => !containerLayoutCache.has(id),
    );
    if (toCompute.length === 0) return;

    let cancelled = false;
    // Capture sizeMemory BEFORE any setContainerLayout writes so the
    // deviation check below compares against the size Stage 1 actually
    // used. (setContainerLayout overwrites containerSizeMemory with the
    // new actualSize.)
    const sizeMemoryBefore = useDashboardStore.getState().containerSizeMemory;
    Promise.all(
      toCompute.map(async (containerId) => {
        const c = stage2Containers.find((cc) => cc.id === containerId);
        if (!c) return null;
        const childIds = new Set(c.nodeIds);
        const childEdges = stage2Intra.filter(
          (e) => childIds.has(e.source) && childIds.has(e.target),
        );
        const stage2Children: ElkChild[] = c.nodeIds.map((id) => ({
          id,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        }));
        const stage2Edges: ElkEdge[] = childEdges.map((e, i) => ({
          id: `${containerId}-e${i}`,
          sources: [e.source],
          targets: [e.target],
        }));
        const stage2Input: ElkInput = {
          id: containerId,
          layoutOptions: ELK_DEFAULT_LAYOUT_OPTIONS,
          children: stage2Children,
          edges: stage2Edges,
        };
        try {
          const { positioned, issues } = await applyElkLayout(stage2Input, {
            strict: import.meta.env.DEV,
          });
          if (issues.length > 0) {
            // Funnel into store so WarningBanner surfaces them.
            useDashboardStore.getState().appendLayoutIssues(issues);
          }
          const childPositions = new Map<string, { x: number; y: number }>();
          let maxX = 0;
          let maxY = 0;
          for (const ch of positioned.children ?? []) {
            const x = ch.x ?? 0;
            const y = ch.y ?? 0;
            const w = ch.width ?? NODE_WIDTH;
            const h = ch.height ?? NODE_HEIGHT;
            childPositions.set(ch.id, { x, y });
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
          }
          // Pad for container chrome (header + border)
          const actualSize = { width: maxX + 40, height: maxY + 60 };

          // Recompute the Stage 1 estimate for this container using the
          // SAME formula `built` used so we know what Stage 1 actually
          // routed against. (Memo if present, else sqrt-clamped estimate.)
          const memo = sizeMemoryBefore.get(containerId);
          const STAGE1_MAX_W = 800;
          const STAGE1_MAX_H = 600;
          const stage1Width = memo?.width
            ?? Math.min(
              STAGE1_MAX_W,
              Math.max(NODE_WIDTH, Math.sqrt(c.nodeIds.length) * NODE_WIDTH * 1.2),
            );
          const stage1Height = memo?.height
            ?? Math.min(
              STAGE1_MAX_H,
              Math.max(NODE_HEIGHT, Math.sqrt(c.nodeIds.length) * NODE_HEIGHT * 1.2),
            );
          const dw = Math.abs(actualSize.width - stage1Width) / stage1Width;
          const dh = Math.abs(actualSize.height - stage1Height) / stage1Height;
          const deviated = dw > 0.2 || dh > 0.2;
          return { containerId, childPositions, actualSize, deviated };
        } catch (err) {
          console.error(`[Stage 2 ${containerId}] layout failed:`, err);
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      let anyDeviated = false;
      for (const r of results) {
        if (!r) continue;
        setContainerLayout(r.containerId, r.childPositions, r.actualSize);
        if (r.deviated) anyDeviated = true;
      }
      // Only bump if at least one container's actual size differed >20%
      // from its Stage 1 estimate. Bumping unconditionally would loop:
      // Stage 1 → Stage 2 → bump → Stage 1 → ... With the >20% gate,
      // after the re-layout containerSizeMemory holds the actual size, so
      // the next Stage 2 sees a 0% deviation and the loop terminates.
      if (anyDeviated) bumpStage1Tick();
    });

    return () => {
      cancelled = true;
    };
  }, [
    expandedContainers,
    stage2Containers,
    stage2Intra,
    containerLayoutCache,
    setContainerLayout,
    bumpStage1Tick,
  ]);

  return { ...topology, layoutStatus };
}

/**
 * Build a CustomFlowNode from a GraphNode. Mirrors the shape produced by
 * the inline ungroupedFlowNodes builder in useLayerDetailTopology — kept
 * symmetric so Stage 2 lazy-expanded children look the same as ungrouped
 * file nodes.
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

/**
 * Visual overlay: cheap O(n) pass that applies selection, search, and tour
 * state onto already-positioned nodes. Avoids triggering ELK relayout.
 *
 * Container atoms whose children are focused or selected light up via
 * `isFocusedViaChild` — neighbor sets are mapped through `nodeToContainer`
 * so collapsed containers still show the relationship.
 *
 * Also folds in Stage 2 outputs:
 *   - Expanded children are emitted as React Flow children (`parentId` +
 *     `extent: "parent"`) using cached positions from `containerLayoutCache`.
 *   - Aggregated edges incident to an expanded container are replaced with
 *     the underlying file→file edges from `topo.filteredEdges`.
 */
function useLayerDetailGraph() {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const expandedContainers = useDashboardStore((s) => s.expandedContainers);
  const containerLayoutCache = useDashboardStore((s) => s.containerLayoutCache);
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const affectedNodeIds = useDashboardStore((s) => s.affectedNodeIds);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);

  const handleNodeSelect = useCallback(
    (nodeId: string) => selectNode(nodeId),
    [selectNode],
  );

  const topo = useLayerDetailTopology();

  // Build expanded child nodes from the layout cache for any expanded
  // container whose layout has been computed. Collapsed containers
  // contribute zero children (gating on `expandedContainers`).
  const expandedChildNodes = useMemo<Node[]>(() => {
    if (expandedContainers.size === 0) return [];
    const out: Node[] = [];
    const nodeById = new Map(topo.filteredNodes.map((n) => [n.id, n]));
    for (const containerId of expandedContainers) {
      const cache = containerLayoutCache.get(containerId);
      const container = topo.containers.find((c) => c.id === containerId);
      if (!cache || !container) continue;
      for (const childId of container.nodeIds) {
        const node = nodeById.get(childId);
        const pos = cache.childPositions.get(childId);
        if (!node || !pos) continue;
        const base = buildCustomFlowNode(node, {
          diffMode,
          changedNodeIds,
          affectedNodeIds,
          onNodeClick: handleNodeSelect,
        });
        out.push({
          ...base,
          parentId: containerId,
          extent: "parent",
          position: pos,
        } as Node);
      }
    }
    return out;
  }, [
    expandedContainers,
    containerLayoutCache,
    topo.containers,
    topo.filteredNodes,
    diffMode,
    changedNodeIds,
    affectedNodeIds,
    handleNodeSelect,
  ]);

  // ── Container visual overlay flags (Task 14) ────────────────────────────
  // O(searchResults) — bucket search hits by container atom.
  const searchHitsByContainer = useMemo(() => {
    const m = new Map<string, number>();
    if (searchResults.length === 0) return m;
    for (const r of searchResults) {
      const cid = topo.nodeToContainer.get(r.nodeId);
      // Only count when the file is actually inside a container (cid !== file id).
      if (!cid || cid === r.nodeId) continue;
      m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [searchResults, topo.nodeToContainer]);

  // O(changed + affected) — set of container atoms touched by the diff.
  const diffContainers = useMemo(() => {
    const s = new Set<string>();
    if (!diffMode) return s;
    for (const id of changedNodeIds) {
      const cid = topo.nodeToContainer.get(id);
      if (cid && cid !== id) s.add(cid);
    }
    for (const id of affectedNodeIds) {
      const cid = topo.nodeToContainer.get(id);
      if (cid && cid !== id) s.add(cid);
    }
    return s;
  }, [diffMode, changedNodeIds, affectedNodeIds, topo.nodeToContainer]);

  // O(filteredEdges) — focus node's container + 1-hop neighbor containers.
  const focusContainerIds = useMemo(() => {
    const s = new Set<string>();
    if (!focusNodeId) return s;
    const focusCid = topo.nodeToContainer.get(focusNodeId);
    if (focusCid && focusCid !== focusNodeId) s.add(focusCid);
    for (const e of topo.filteredEdges) {
      if (e.source === focusNodeId) {
        const cid = topo.nodeToContainer.get(e.target);
        if (cid && cid !== e.target) s.add(cid);
      } else if (e.target === focusNodeId) {
        const cid = topo.nodeToContainer.get(e.source);
        if (cid && cid !== e.source) s.add(cid);
      }
    }
    return s;
  }, [focusNodeId, topo.filteredEdges, topo.nodeToContainer]);

  // Selection neighbor highlighting for containers: when the selected node
  // (or one of its neighbors) lives inside a container, that container atom
  // should pop visually so the user can see where the relationship lives
  // even when the container is collapsed. We piggyback on `isFocusedViaChild`
  // since ContainerNode already styles that flag (gold border emphasis).
  const selectionContainerIds = useMemo(() => {
    const s = new Set<string>();
    if (!selectedNodeId) return s;
    const selCid = topo.nodeToContainer.get(selectedNodeId);
    if (selCid && selCid !== selectedNodeId) s.add(selCid);
    for (const e of topo.filteredEdges) {
      if (e.source === selectedNodeId) {
        const cid = topo.nodeToContainer.get(e.target);
        if (cid && cid !== e.target) s.add(cid);
      } else if (e.target === selectedNodeId) {
        const cid = topo.nodeToContainer.get(e.source);
        if (cid && cid !== e.source) s.add(cid);
      }
    }
    return s;
  }, [selectedNodeId, topo.filteredEdges, topo.nodeToContainer]);

  // Combine Stage 1 nodes with Stage 2 expanded children, then apply the
  // visual overlay (selection, search, tour) to every CustomFlowNode in
  // the combined set. Container nodes get their own overlay branch.
  const nodes = useMemo(() => {
    const combined: Node[] = [...topo.nodes, ...expandedChildNodes];

    const searchMap = new Map(searchResults.map((r) => [r.nodeId, r.score]));
    const tourSet = new Set(tourHighlightedNodeIds);

    // Build neighbor set for selection highlighting
    const neighborNodeIds = new Set<string>();
    if (selectedNodeId) {
      for (const edge of topo.filteredEdges) {
        if (edge.source === selectedNodeId) neighborNodeIds.add(edge.target);
        if (edge.target === selectedNodeId) neighborNodeIds.add(edge.source);
      }
      neighborNodeIds.add(selectedNodeId);
    }

    return combined.map((node) => {
      // Portal nodes have no overlay state.
      if (node.type === "portal") return node;

      // Container nodes: apply container-specific visual flags.
      if (node.type === "container") {
        const cid = String(node.id);
        const data = node.data as ContainerNodeData;
        const isExpanded = expandedContainers.has(cid);
        const rawHits = searchHitsByContainer.get(cid) ?? 0;
        const hasSearchHits = rawHits > 0;
        const searchHitCount = hasSearchHits ? rawHits : undefined;
        const isDiffAffected = diffContainers.has(cid);
        const isFocusedViaChild =
          focusContainerIds.has(cid) || selectionContainerIds.has(cid);

        // Skip creating a new object if nothing changed.
        if (
          data.isExpanded === isExpanded &&
          data.hasSearchHits === hasSearchHits &&
          data.searchHitCount === searchHitCount &&
          data.isDiffAffected === isDiffAffected &&
          data.isFocusedViaChild === isFocusedViaChild
        ) {
          return node;
        }

        return {
          ...node,
          data: {
            ...data,
            isExpanded,
            hasSearchHits,
            searchHitCount,
            isDiffAffected,
            isFocusedViaChild,
          },
        };
      }

      const searchScore = searchMap.get(node.id);
      const isHighlighted = searchScore !== undefined;
      const isSelected = selectedNodeId === node.id;
      const isTourHighlighted = tourSet.has(node.id);
      const hasSelection = !!selectedNodeId;
      const isNeighbor = hasSelection && neighborNodeIds.has(node.id) && !isSelected;
      const isSelectionFaded = hasSelection && !neighborNodeIds.has(node.id);

      const data = node.data as CustomFlowNode["data"];

      // Skip creating a new object if nothing visual changed
      if (
        data.isHighlighted === isHighlighted &&
        data.searchScore === searchScore &&
        data.isSelected === isSelected &&
        data.isTourHighlighted === isTourHighlighted &&
        data.isNeighbor === isNeighbor &&
        data.isSelectionFaded === isSelectionFaded
      ) {
        return node;
      }

      return { ...node, data: { ...data, isHighlighted, searchScore, isSelected, isTourHighlighted, isNeighbor, isSelectionFaded } };
    });
  }, [
    topo.nodes,
    expandedChildNodes,
    topo.filteredEdges,
    selectedNodeId,
    searchResults,
    tourHighlightedNodeIds,
    expandedContainers,
    searchHitsByContainer,
    diffContainers,
    focusContainerIds,
    selectionContainerIds,
  ]);

  // Replace aggregated edges incident to an expanded container with the
  // underlying file→file edges from filteredEdges. Aggregated edges where
  // neither endpoint is expanded pass through unchanged. Also surface
  // intra-container edges for each expanded container — these are stored
  // separately on topo.intraContainer (Stage 1 doesn't render them since
  // the children aren't visible there).
  //
  // Important: when only one side of an aggregated edge is expanded, the
  // collapsed side MUST keep its container-atom id as the endpoint —
  // otherwise React Flow would receive edges referencing file ids that
  // aren't rendered (the collapsed container's children don't exist as
  // nodes), and the edges would silently disappear. Multiple file→file
  // edges that collapse to the same (collapsed-atom → expanded-file)
  // pair are deduped.
  const expandedEdges = useMemo<Edge[]>(() => {
    if (expandedContainers.size === 0) return topo.edges;

    const out: Edge[] = [];
    const seen = new Set<string>();
    for (const e of topo.edges) {
      const srcAtom = String(e.source);
      const tgtAtom = String(e.target);
      const srcExpanded = expandedContainers.has(srcAtom);
      const tgtExpanded = expandedContainers.has(tgtAtom);
      if (!srcExpanded && !tgtExpanded) {
        out.push(e);
        continue;
      }
      const matching = topo.filteredEdges.filter((fe) => {
        const fsc = topo.nodeToContainer.get(fe.source);
        const ftc = topo.nodeToContainer.get(fe.target);
        return fsc === srcAtom && ftc === tgtAtom;
      });
      for (const m of matching) {
        const realSrc = srcExpanded ? m.source : srcAtom;
        const realTgt = tgtExpanded ? m.target : tgtAtom;
        const key = `${realSrc}|${realTgt}|${m.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: `inflated-${key}`,
          source: realSrc,
          target: realTgt,
          label: m.type,
          style: { stroke: "rgba(212,165,116,0.5)", strokeWidth: 1.5 },
          labelStyle: { fill: "#a39787", fontSize: 10 },
        });
      }
    }
    // Add intra-container edges for each expanded container so the user
    // can see the wiring between sibling files inside an expanded folder.
    for (const e of topo.intraContainer) {
      const cid = topo.nodeToContainer.get(e.source);
      if (!cid || !expandedContainers.has(cid)) continue;
      const key = `intra|${e.source}|${e.target}|${e.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: key,
        source: e.source,
        target: e.target,
        label: e.type,
        style: { stroke: "rgba(212,165,116,0.5)", strokeWidth: 1.5 },
        labelStyle: { fill: "#a39787", fontSize: 10 },
      });
    }
    return out;
  }, [
    topo.edges,
    topo.filteredEdges,
    topo.intraContainer,
    topo.nodeToContainer,
    expandedContainers,
  ]);

  const edges = useMemo(() => {
    // Compose: Stage 1 / inflated edges, plus portal edges (Stage 1 sources
    // them off container atoms — re-sourcing on expand is deferred).
    const base = [...expandedEdges, ...topo.portalEdges];
    if (!selectedNodeId) return base;

    // Apply selection-based edge styling on top of topology edges
    return base.map((edge) => {
      const isSelectedEdge = edge.source === selectedNodeId || edge.target === selectedNodeId;
      // Don't restyle diff-impacted or portal edges
      if ((edge.style as Record<string, unknown>)?.strokeDasharray) return edge;

      if (isSelectedEdge) {
        return { ...edge, animated: true, style: { stroke: "rgba(212,165,116,0.8)", strokeWidth: 2.5 }, labelStyle: { fill: "#d4a574", fontSize: 11, fontWeight: 600 } };
      }
      // Fade unrelated edges
      return { ...edge, animated: false, style: { stroke: "rgba(212,165,116,0.08)", strokeWidth: 1 }, labelStyle: { fill: "rgba(163,151,135,0.2)", fontSize: 10 } };
    });
  }, [expandedEdges, topo.portalEdges, selectedNodeId]);

  // Expose container topology so the parent component can wire auto-expand
  // triggers (focus, tour, zoom) without having to re-derive containers.
  const containerIds = useMemo(
    () => topo.containers.map((c) => c.id),
    [topo.containers],
  );

  return {
    nodes,
    edges,
    nodeToContainer: topo.nodeToContainer,
    containerIds,
    layoutStatus: topo.layoutStatus,
  };
}

// ── Main inner component (must be inside ReactFlowProvider) ────────────

function GraphViewInner() {
  const graph = useDashboardStore((s) => s.graph);
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const setReactFlowInstance = useDashboardStore((s) => s.setReactFlowInstance);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const expandContainer = useDashboardStore((s) => s.expandContainer);
  const collapseContainer = useDashboardStore((s) => s.collapseContainer);
  const pendingFocusContainer = useDashboardStore((s) => s.pendingFocusContainer);
  const setPendingFocusContainer = useDashboardStore((s) => s.setPendingFocusContainer);
  const tourFitPending = useDashboardStore((s) => s.tourFitPending);
  const { preset } = useTheme();

  const overviewGraph = useOverviewGraph();
  const detailGraph = useLayerDetailGraph();

  const {
    nodes: initialNodes,
    edges: initialEdges,
    nodeToContainer,
    containerIds,
    layoutStatus,
  } = navigationLevel === "overview"
    ? { ...overviewGraph, nodeToContainer: undefined, containerIds: undefined }
    : detailGraph;

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const { fitView, getViewport, setCenter } = useReactFlow();

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

  // Lock viewport onto a container the user just manually expanded so it
  // appears to expand in place rather than getting yanked off-screen by
  // the surrounding ELK reflow. Re-runs as nodes update (Stage 2 may
  // shift positions a few times) and clears itself after a short window
  // so subsequent layout shifts stop hijacking the viewport.
  useEffect(() => {
    if (!pendingFocusContainer) return;
    const node = nodes.find((n) => n.id === pendingFocusContainer);
    if (!node) return;
    const w =
      (node.width as number | undefined) ??
      ((node.style?.width as number | undefined) ?? 0);
    const h =
      (node.height as number | undefined) ??
      ((node.style?.height as number | undefined) ?? 0);
    const cx = node.position.x + w / 2;
    const cy = node.position.y + h / 2;
    const { zoom } = getViewport();
    setCenter(cx, cy, { zoom, duration: 0 });
  }, [pendingFocusContainer, nodes, getViewport, setCenter]);

  useEffect(() => {
    if (!pendingFocusContainer) return;
    const t = window.setTimeout(() => setPendingFocusContainer(null), 1200);
    return () => window.clearTimeout(t);
  }, [pendingFocusContainer, setPendingFocusContainer]);

  // ── Auto-expand triggers (Task 13) ─────────────────────────────────────
  // Only meaningful in layer-detail; in overview mode there are no
  // containers so all three effects no-op.

  // Focus: when focusNodeId resolves to a node inside a container, expand it.
  // Reading expandContainer is stable (Zustand setter); intentionally omitting
  // expandedContainers from deps so focus changes are the only trigger.
  useEffect(() => {
    if (!focusNodeId || !nodeToContainer) return;
    const cid = nodeToContainer.get(focusNodeId);
    // Self-maps mean ungrouped nodes have cid === focusNodeId — skip those.
    if (cid && cid !== focusNodeId) expandContainer(cid);
  }, [focusNodeId, nodeToContainer, expandContainer]);

  // Tour: expand containers needed for the current step, and release any
  // containers we expanded for the previous step that aren't needed now.
  // Containers the user expanded manually aren't tracked here, so they're
  // never auto-collapsed. stopTour resets tourHighlightedNodeIds to [],
  // which falls through to the "release all" branch.
  const tourBorrowedContainersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!nodeToContainer) return;

    const needed = new Set<string>();
    for (const nid of tourHighlightedNodeIds) {
      const cid = nodeToContainer.get(nid);
      if (cid && cid !== nid) needed.add(cid);
    }

    const stillBorrowed = new Set<string>();
    for (const cid of tourBorrowedContainersRef.current) {
      if (needed.has(cid)) {
        stillBorrowed.add(cid);
      } else {
        collapseContainer(cid);
      }
    }

    const expandedNow = useDashboardStore.getState().expandedContainers;
    for (const cid of needed) {
      if (!expandedNow.has(cid)) {
        expandContainer(cid);
        stillBorrowed.add(cid);
      }
    }

    tourBorrowedContainersRef.current = stillBorrowed;
  }, [tourHighlightedNodeIds, nodeToContainer, expandContainer, collapseContainer]);

  // Zoom: debounced auto-expand when the user has zoomed in past 1.0.
  // Hysteresis: zoom < 0.6 = no auto-expand AND no auto-collapse (v1, the
  // user collapses manually). The handler reads expandedContainers via
  // getState() inside the timeout to avoid re-creating on every expand.
  const zoomTimeoutRef = useRef<number | null>(null);
  // Only auto-expand on user-driven zoom-INs. Skip programmatic moves
  // (e.g. fitView at layer entry, which would otherwise cascade-expand
  // every container the moment the layer paints) and skip pans/zoom-outs
  // (so a user who manually collapses a container at zoom > 1 can pan
  // around without seeing it pop back open).
  const prevZoomRef = useRef<number | null>(null);
  const onMove = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      if (event === null) return; // programmatic — skip
      if (!containerIds || containerIds.length === 0) return;
      if (zoomTimeoutRef.current !== null) {
        window.clearTimeout(zoomTimeoutRef.current);
      }
      zoomTimeoutRef.current = window.setTimeout(() => {
        const vp = getViewport();
        const prev = prevZoomRef.current;
        prevZoomRef.current = vp.zoom;
        if (vp.zoom <= 1.0) return;
        // Only fire when zoom actually increased — pan and zoom-out are no-ops.
        if (prev !== null && vp.zoom <= prev) return;
        const expanded = useDashboardStore.getState().expandedContainers;
        for (const cid of containerIds) {
          if (!expanded.has(cid)) expandContainer(cid);
        }
      }, 200);
    },
    [containerIds, getViewport, expandContainer],
  );

  // Clear any pending zoom timer on unmount or when handler identity changes.
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current !== null) {
        window.clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = null;
      }
    };
  }, [onMove]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      if (navigationLevel === "overview") {
        drillIntoLayer(node.id);
      } else if (node.id.startsWith("portal:")) {
        const targetLayerId = node.id.replace("portal:", "");
        drillIntoLayer(targetLayerId);
      } else {
        selectNode(node.id);
      }
    },
    [navigationLevel, drillIntoLayer, selectNode],
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
        onMove={navigationLevel === "layer-detail" ? onMove : undefined}
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
