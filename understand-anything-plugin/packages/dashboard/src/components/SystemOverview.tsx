import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { SystemGraph, SystemGraphNode } from "@understand-anything/core";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../themes/index.ts";
import ServiceNode from "./ServiceNode";
import type { ServiceFlowNode } from "./ServiceNode";

const nodeTypes = {
  service: ServiceNode,
};

const EDGE_COLORS: Record<string, string> = {
  rpc_call: "#3b82f6",
  event: "#22c55e",
  shared_db: "#f59e0b",
  contains: "#94a3b8",
};

function serviceKeyFromNodeId(nodeId: string): string {
  return nodeId.replace(/^microservice:/, "");
}

function SystemOverviewInner() {
  const systemGraph = useDashboardStore((s) => s.systemGraph);
  const setActiveService = useDashboardStore((s) => s.setActiveService);
  const { t } = useI18n();
  const { preset } = useTheme();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { svcNodes, svcEdges, project, serviceIndex } = useMemo(() => {
    if (!systemGraph) {
      return {
        svcNodes: [] as SystemGraphNode[],
        svcEdges: [] as SystemGraph["edges"],
        project: null,
        serviceIndex: undefined as SystemGraph["serviceIndex"] | undefined,
      };
    }
    const nodes = systemGraph.nodes.filter((n) => n.type === "microservice");
    const svcIds = new Set(nodes.map((n) => n.id));
    const edges = systemGraph.edges.filter(
      (e) => svcIds.has(e.source) && svcIds.has(e.target),
    );
    return {
      svcNodes: nodes,
      svcEdges: edges,
      project: systemGraph.project,
      serviceIndex: systemGraph.serviceIndex,
    };
  }, [systemGraph]);

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set<string>();
    for (const edge of svcEdges) {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    }
    return ids;
  }, [selectedNodeId, svcEdges]);

  const computedNodes = useMemo((): Node[] => {
    return svcNodes.map((node, i): ServiceFlowNode => {
      const svcName = serviceKeyFromNodeId(node.id);
      const idx = serviceIndex?.[svcName];
      const isSelected = selectedNodeId === node.id;
      const hasSelection = !!selectedNodeId;
      const isNeighbor = neighborIds.has(node.id);
      const isFaded = hasSelection && !isSelected && !isNeighbor;

      return {
        id: node.id,
        type: "service",
        position: { x: (i % 4) * 280, y: Math.floor(i / 4) * 180 },
        style: isFaded ? { opacity: 0.35 } : undefined,
        data: {
          label: node.name,
          summary: node.summary,
          languages: node.languages ?? [],
          frameworks: node.frameworks ?? [],
          stats: node.stats ?? { nodes: 0, edges: 0, files: 0 },
          hasKg: idx?.hasKg ?? false,
          hasWiki: idx?.hasWiki ?? false,
          hasDomain: idx?.hasDomain ?? false,
          isSelected,
          onNodeClick: () => {},
        },
      };
    });
  }, [svcNodes, serviceIndex, selectedNodeId, neighborIds]);

  const computedEdges = useMemo((): Edge[] => {
    return svcEdges.map((edge, i) => {
      const color = EDGE_COLORS[edge.type] ?? EDGE_COLORS.contains;
      const isConnected =
        !!selectedNodeId &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);

      return {
        id: `${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        style: {
          stroke: color,
          strokeWidth: isConnected ? 2.5 : 1.5,
          opacity: selectedNodeId ? (isConnected ? 1 : 0.15) : 0.8,
        },
        animated: edge.type === "event" && isConnected,
      };
    });
  }, [svcEdges, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  useEffect(() => {
    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  const handleServiceNavigate = useCallback(
    (node: SystemGraphNode) => {
      setActiveService(serviceKeyFromNodeId(node.id));
    },
    [setActiveService],
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setActiveService(serviceKeyFromNodeId(node.id));
    },
    [setActiveService],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  if (!systemGraph) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">{t.systemNoGraph}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r border-border-subtle overflow-y-auto p-4 bg-surface">
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {project?.name ?? t.systemOverview}
        </h2>
        {project?.description && (
          <p className="text-xs text-text-secondary mb-3 leading-relaxed">
            {project.description}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">
              {project?.serviceCount ?? svcNodes.length}
            </div>
            <div className="text-text-muted uppercase tracking-wider">
              {t.systemServiceCount}
            </div>
          </div>
          <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
            <div className="font-mono text-accent text-lg">
              {project?.totalNodes ?? 0}
            </div>
            <div className="text-text-muted uppercase tracking-wider">
              {t.systemTotalNodes}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
            Edge Types
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.rpc_call }}
              />
              <span className="text-text-secondary">RPC</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.event }}
              />
              <span className="text-text-secondary">Event</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 rounded"
                style={{ backgroundColor: EDGE_COLORS.shared_db }}
              />
              <span className="text-text-secondary">SharedDB</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-text-muted mb-3">{t.systemDrillDown}</p>
        <ul className="space-y-2">
          {svcNodes.map((node) => {
            const svcName = serviceKeyFromNodeId(node.id);
            const idx = serviceIndex?.[svcName];
            const isSelected = selectedNodeId === node.id;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className={`w-full text-left p-2 rounded-lg transition-colors ${
                    isSelected
                      ? "bg-elevated border border-gold/30"
                      : "hover:bg-elevated"
                  }`}
                  onClick={() => handleServiceNavigate(node)}
                >
                  <div className="font-medium text-sm text-text-primary">
                    {node.name}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {node.languages?.join(", ")}
                    {idx?.hasKg && " · KG"}
                    {idx?.hasWiki && " · Wiki"}
                    {idx?.hasDomain && " · Domain"}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1 min-w-0 relative bg-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode={preset.isDark ? "dark" : "light"}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="var(--color-edge-dot)"
            gap={20}
            size={1}
          />
          <Controls />
          <MiniMap
            nodeColor="var(--color-elevated)"
            maskColor="var(--glass-bg)"
            className="!bg-surface !border !border-border-subtle"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SystemOverview() {
  return (
    <ReactFlowProvider>
      <SystemOverviewInner />
    </ReactFlowProvider>
  );
}
