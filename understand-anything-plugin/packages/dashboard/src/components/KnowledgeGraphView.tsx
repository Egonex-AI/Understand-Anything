import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import CustomNode from "./CustomNode";
import type { CustomNodeData } from "./CustomNode";
import { useDashboardStore } from "../store";
import { NODE_WIDTH, NODE_HEIGHT } from "../utils/layout";
import {
  createFallbackGrid,
  ForceLayoutCancelledError,
  startForceLayoutTask,
} from "../utils/force-layout-client";
import type {
  ForceLayoutEdge,
  ForceLayoutNode,
  ForceLayoutPosition,
} from "../utils/force-layout";
import { useI18n } from "../contexts/I18nContext";
import type { KnowledgeGraph } from "@understand-anything/core/types";

const nodeTypes = {
  custom: CustomNode,
};

const EMPTY_POSITION_MAP = new Map<string, { x: number; y: number }>();
const EMPTY_EDGE_COUNTS = new Map<string, number>();

/** Edge style presets by knowledge edge type. */
const EDGE_STYLES: Record<string, React.CSSProperties> = {
  related: { stroke: "var(--color-border-medium)", strokeWidth: 0.5, opacity: 0.12 },
  cites: { stroke: "var(--color-node-source)", strokeWidth: 1.5, strokeDasharray: "6 3" },
  contradicts: { stroke: "#c97070", strokeWidth: 2 },
  builds_on: { stroke: "var(--color-node-claim)", strokeWidth: 1.5 },
  exemplifies: { stroke: "var(--color-node-entity)", strokeWidth: 1, strokeDasharray: "3 3" },
  categorized_under: { stroke: "var(--color-border-medium)", strokeWidth: 0.5, opacity: 0.08 },
  authored_by: { stroke: "var(--color-node-entity)", strokeWidth: 1, strokeDasharray: "4 4" },
  implements: { stroke: "var(--color-node-function)", strokeWidth: 1, opacity: 0.4 },
  depends_on: { stroke: "var(--color-node-module)", strokeWidth: 1, opacity: 0.4 },
};

/** Compute node size based on connection count. */
function getNodeDimensions(
  edgeCount: number,
): { width: number; height: number } {
  const scale = Math.min(1.5, Math.max(0.85, 0.85 + edgeCount * 0.03));
  return {
    width: Math.round(NODE_WIDTH * scale),
    height: Math.round(NODE_HEIGHT * scale),
  };
}

interface PreparedLayout {
  graph: KnowledgeGraph;
  nodes: ForceLayoutNode[];
  edges: ForceLayoutEdge[];
  edgeCounts: Map<string, number>;
}

interface LayoutState {
  graph: KnowledgeGraph | null;
  status: "loading" | "ready";
  positionMap: Map<string, { x: number; y: number }>;
  edgeCounts: Map<string, number>;
  hasWarning?: boolean;
}

function positionsToMap(
  positions: ForceLayoutPosition[],
): Map<string, { x: number; y: number }> {
  return new Map(positions.map(({ id, x, y }) => [id, { x, y }]));
}

/** Prepare lightweight, structured-clone-safe input for the layout worker. */
function prepareLayout(graph: KnowledgeGraph): PreparedLayout {
  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
  }

  const communityMap = new Map<string, number>();
  graph.layers.forEach((layer, i) => {
    for (const nodeId of layer.nodeIds) {
      communityMap.set(nodeId, i);
    }
  });

  return {
    graph,
    edgeCounts,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      ...getNodeDimensions(edgeCounts.get(node.id) ?? 0),
      community: communityMap.get(node.id),
    })),
    edges: graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })),
  };
}

function createForceLayoutWorker(): Worker {
  return new Worker(
    new URL("../utils/force-layout.worker.ts", import.meta.url),
    { type: "module" },
  );
}

function KnowledgeGraphViewInner() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const searchResultsRaw = useDashboardStore((s) => s.searchResults);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const knowledgeNodesVisible = useDashboardStore(
    (s) => s.nodeTypeFilters.knowledge !== false,
  );
  const { t } = useI18n();
  const nextLayoutRequestId = useRef(0);
  const [layoutState, setLayoutState] = useState<LayoutState>({
    graph: null,
    status: "loading",
    positionMap: EMPTY_POSITION_MAP,
    edgeCounts: EMPTY_EDGE_COUNTS,
  });

  const onNodeClick = useCallback(
    (nodeId: string) => selectNode(nodeId),
    [selectNode],
  );

  const searchResults = useMemo(
    () => new Map(searchResultsRaw.map((r) => [r.nodeId, r.score])),
    [searchResultsRaw],
  );

  const tourSet = useMemo(
    () => new Set(tourHighlightedNodeIds),
    [tourHighlightedNodeIds],
  );

  // Filter graph — only recompute when graph data or filters change
  const filteredGraph = useMemo((): KnowledgeGraph | null => {
    if (!graph) return null;

    const filteredNodes = graph.nodes.filter((n) => {
      if (["article", "entity", "topic", "claim", "source"].includes(n.type)) {
        return knowledgeNodesVisible;
      }
      return true;
    });

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = graph.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    );

    return { ...graph, nodes: filteredNodes, edges: filteredEdges };
  }, [graph, knowledgeNodesVisible]);

  const preparedLayout = useMemo(() => {
    if (!filteredGraph) return null;
    return prepareLayout(filteredGraph);
  }, [filteredGraph]);

  // Run d3-force outside the main thread. A fresh worker per graph revision
  // lets cleanup terminate an in-progress synchronous simulation immediately.
  useEffect(() => {
    if (!preparedLayout) {
      setLayoutState({
        graph: null,
        status: "loading",
        positionMap: EMPTY_POSITION_MAP,
        edgeCounts: EMPTY_EDGE_COUNTS,
      });
      return;
    }

    const { graph: layoutGraph, nodes: layoutNodes, edges: layoutEdges, edgeCounts } =
      preparedLayout;

    if (layoutNodes.length === 0) {
      setLayoutState({
        graph: layoutGraph,
        status: "ready",
        positionMap: EMPTY_POSITION_MAP,
        edgeCounts,
      });
      return;
    }

    const requestId = ++nextLayoutRequestId.current;
    let active = true;
    setLayoutState({
      graph: layoutGraph,
      status: "loading",
      positionMap: EMPTY_POSITION_MAP,
      edgeCounts,
    });

    const task = startForceLayoutTask(
      { requestId, nodes: layoutNodes, edges: layoutEdges },
      createForceLayoutWorker,
    );

    void task.promise
      .then((positions) => {
        if (!active || requestId !== nextLayoutRequestId.current) return;
        setLayoutState({
          graph: layoutGraph,
          status: "ready",
          positionMap: positionsToMap(positions),
          edgeCounts,
        });
      })
      .catch((error: unknown) => {
        if (!active || error instanceof ForceLayoutCancelledError) return;
        setLayoutState({
          graph: layoutGraph,
          status: "ready",
          positionMap: positionsToMap(createFallbackGrid(layoutNodes)),
          edgeCounts,
          hasWarning: true,
        });
      });

    return () => {
      active = false;
      task.cancel();
    };
  }, [preparedLayout]);

  const layoutIsReady =
    !!filteredGraph &&
    layoutState.graph === filteredGraph &&
    layoutState.status === "ready";
  const positionMap = layoutIsReady
    ? layoutState.positionMap
    : EMPTY_POSITION_MAP;
  const edgeCounts = layoutIsReady ? layoutState.edgeCounts : EMPTY_EDGE_COUNTS;

  // Build visual nodes/edges — recomputes on selection/search/tour WITHOUT re-layout
  const { nodes, edges } = useMemo(() => {
    if (!filteredGraph || !layoutIsReady) return { nodes: [], edges: [] };

    const neighborIds = new Set<string>();
    if (focusNodeId || selectedNodeId) {
      const focusId = focusNodeId ?? selectedNodeId;
      for (const edge of filteredGraph.edges) {
        if (edge.source === focusId) neighborIds.add(edge.target);
        if (edge.target === focusId) neighborIds.add(edge.source);
      }
    }

    const rfNodes: Node[] = filteredGraph.nodes.map((node) => {
      const isSelected = node.id === selectedNodeId;
      const isFocused = node.id === focusNodeId;
      const isNeighbor = neighborIds.has(node.id);
      const isSelectionFaded =
        (focusNodeId || selectedNodeId) &&
        !isSelected &&
        !isFocused &&
        !isNeighbor;
      const searchScore = searchResults.get(node.id);
      const isHighlighted = searchScore !== undefined;
      const isTourHighlighted = tourSet.has(node.id);

      const data: CustomNodeData = {
        label: node.name,
        nodeType: node.type,
        summary: node.summary,
        complexity: node.complexity,
        isHighlighted,
        searchScore,
        isSelected,
        isTourHighlighted,
        isDiffChanged: false,
        isDiffAffected: false,
        isDiffFaded: false,
        isNeighbor,
        isSelectionFaded: !!isSelectionFaded,
        onNodeClick,
        incomingCount: edgeCounts.get(node.id) ?? 0,
        tags: node.tags,
      };

      return {
        id: node.id,
        type: "custom" as const,
        position: positionMap.get(node.id) ?? { x: 0, y: 0 },
        data,
      };
    });

    const activeId = focusNodeId ?? selectedNodeId;
    const rfEdges: Edge[] = filteredGraph.edges.map((e) => {
      const baseStyle = EDGE_STYLES[e.type] ?? EDGE_STYLES.related;
      const isConnected = activeId && (e.source === activeId || e.target === activeId);

      // When a node is selected: highlight connected edges, dim the rest
      let style: React.CSSProperties;
      if (activeId) {
        if (isConnected) {
          style = {
            ...baseStyle,
            strokeWidth: Math.max(2, (baseStyle.strokeWidth as number ?? 1) * 1.5),
            opacity: 1,
          };
        } else {
          style = { ...baseStyle, opacity: 0.04 };
        }
      } else {
        style = baseStyle;
      }

      return {
        id: `ke-${e.source}-${e.target}-${e.type}`,
        source: e.source,
        target: e.target,
        style,
        animated: e.type === "contradicts" && (!activeId || !!isConnected),
        label: isConnected && e.type !== "related" && e.type !== "categorized_under"
          ? e.type.replace(/_/g, " ")
          : undefined,
        labelStyle: { fill: "var(--color-text-muted)", fontSize: 9, opacity: 0.7 },
        labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [filteredGraph, layoutIsReady, selectedNodeId, focusNodeId, searchResults, tourSet, onNodeClick, positionMap, edgeCounts]);

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No knowledge graph available. Run /understand-knowledge to generate one.
      </div>
    );
  }

  if (!layoutIsReady) {
    return (
      <div
        className="h-full flex items-center justify-center text-text-muted text-sm"
        role="status"
        aria-live="polite"
      >
        {t.common.computingGraphLayout}
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {layoutState.hasWarning && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-md border border-border-medium bg-surface/95 px-3 py-2 text-xs text-text-muted shadow-lg"
          role="status"
        >
          {t.common.forceLayoutFallback}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-subtle)"
        />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as CustomNodeData | undefined;
            const type = data?.nodeType ?? "article";
            const colorMap: Record<string, string> = {
              article: "var(--color-node-article)",
              entity: "var(--color-node-entity)",
              topic: "var(--color-node-topic)",
              claim: "var(--color-node-claim)",
              source: "var(--color-node-source)",
            };
            return colorMap[type] ?? "var(--color-accent)";
          }}
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
      </ReactFlow>
    </div>
  );
}

export default function KnowledgeGraphView() {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphViewInner />
    </ReactFlowProvider>
  );
}
