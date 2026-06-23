import { useEffect, useMemo, useState } from "react";
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

import DomainClusterNode from "./DomainClusterNode";
import type { DomainClusterFlowNode } from "./DomainClusterNode";
import FlowNode from "./FlowNode";
import type { FlowFlowNode } from "./FlowNode";
import StepNode from "./StepNode";
import type { StepFlowNode } from "./StepNode";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

const nodeTypes = {
  "domain-cluster": DomainClusterNode,
  "flow-node": FlowNode,
  "step-node": StepNode,
};

function getDomainMeta(node: GraphNode) {
  return node.domainMeta;
}

interface BuiltGraph {
  nodes: Node[];
  edges: Edge[];
  dims: Map<string, { width: number; height: number }>;
}

function buildDomainOverview(graph: KnowledgeGraph): BuiltGraph {
  const dims = new Map<string, { width: number; height: number }>();
  const domainNodes = graph.nodes.filter((n) => n.type === "domain");

  // Count flows per domain
  const flowCountMap = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "contains_flow") {
      flowCountMap.set(edge.source, (flowCountMap.get(edge.source) ?? 0) + 1);
    }
  }

  const rfNodes: DomainClusterFlowNode[] = domainNodes.map((node) => {
    const meta = getDomainMeta(node);
    const data = {
      label: node.name,
      summary: node.summary,
      entities: meta?.entities as string[] | undefined,
      flowCount: flowCountMap.get(node.id) ?? 0,
      businessRules: meta?.businessRules as string[] | undefined,
      domainId: node.id,
    };
    dims.set(node.id, { width: 320, height: 180 });
    return {
      id: node.id,
      type: "domain-cluster" as const,
      position: { x: 0, y: 0 },
      data,
    };
  });

  const rfEdges: Edge[] = graph.edges
    .filter((e) => e.type === "cross_domain")
    .map((e, i) => ({
      id: `cd-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: e.description ?? "",
      style: { stroke: "var(--color-accent)", strokeDasharray: "6 3", strokeWidth: 2 },
      labelStyle: { fill: "var(--color-text-muted)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.9 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
      animated: true,
    }));

  return { nodes: rfNodes as unknown as Node[], edges: rfEdges, dims };
}

function buildDomainDetail(
  graph: KnowledgeGraph,
  domainId: string,
): BuiltGraph {
  // Find flows for this domain
  const flowIds = new Set(
    graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === domainId)
      .map((e) => e.target),
  );

  const flowNodes = graph.nodes.filter((n) => flowIds.has(n.id));
  const stepEdges = graph.edges.filter(
    (e) => e.type === "flow_step" && flowIds.has(e.source),
  );
  const stepIds = new Set(stepEdges.map((e) => e.target));
  const stepNodes = graph.nodes.filter((n) => stepIds.has(n.id));

  // Build step order map
  const stepOrderMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepOrderMap.set(edge.target, edge.weight);
  }

  // Count steps per flow
  const stepCountMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepCountMap.set(edge.source, (stepCountMap.get(edge.source) ?? 0) + 1);
  }

  const dims = new Map<string, { width: number; height: number }>();

  const flowRfNodes: FlowFlowNode[] = flowNodes.map((node) => {
    const meta = getDomainMeta(node);
    dims.set(node.id, { width: 260, height: 120 });
    return {
      id: node.id,
      type: "flow-node" as const,
      position: { x: 0, y: 0 },
      data: {
        label: node.name,
        summary: node.summary,
        entryPoint: meta?.entryPoint as string | undefined,
        entryType: meta?.entryType as string | undefined,
        stepCount: stepCountMap.get(node.id) ?? 0,
        flowId: node.id,
      },
    };
  });
  const stepRfNodes: StepFlowNode[] = stepNodes.map((node) => {
    dims.set(node.id, { width: 200, height: 90 });
    return {
      id: node.id,
      type: "step-node" as const,
      position: { x: 0, y: 0 },
      data: {
        label: node.name,
        summary: node.summary,
        filePath: node.filePath,
        stepId: node.id,
        order: Math.round((stepOrderMap.get(node.id) ?? 0) * 10),
      },
    };
  });
  const rfNodes: Node[] = [...flowRfNodes, ...stepRfNodes];

  const rfEdges: Edge[] = stepEdges.map((e, i) => ({
    id: `fs-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: "var(--color-border-medium)", strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes: rfNodes, edges: rfEdges, dims };
}

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const clearActiveDomain = useDashboardStore((s) => s.clearActiveDomain);
  const { t } = useI18n();

  // Build structural nodes/edges/dims synchronously; only the layout call
  // itself is async, so we memo the structural pieces and run ELK in an
  // effect.
  const built = useMemo<BuiltGraph | null>(() => {
    if (!domainGraph) return null;
    if (activeDomainId) {
      return buildDomainDetail(domainGraph, activeDomainId);
    }
    return buildDomainOverview(domainGraph);
  }, [domainGraph, activeDomainId]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (!built) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    let cancelled = false;
    const { nodes: nodesArray, edges: edgesArray, dims } = built;
    // DomainGraphView used dagre LR; preserve that direction with ELK.
    const elkInput = nodesToElkInput(nodesArray, edgesArray, dims, {
      "elk.direction": "RIGHT",
    });
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          // Funnel into store so WarningBanner surfaces them.
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        setLayout({
          nodes: mergeElkPositions(nodesArray, positioned),
          edges: edgesArray,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[domain ELK] layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  const { nodes, edges } = layout;

  // Double-click is handled by individual node components (e.g. DomainClusterNode)

  if (!domainGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No domain graph available. Run /understand-domain to generate one.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {activeDomainId && (
        <div className="absolute top-3 left-3 z-10">
          <button
            type="button"
            onClick={() => clearActiveDomain()}
            className="px-3 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
          >
            {t.domainView.backToDomains}
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
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
          nodeColor="var(--color-accent)"
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
      </ReactFlow>
    </div>
  );
}

export default function DomainGraphView() {
  return (
    <ReactFlowProvider>
      <DomainGraphViewInner />
    </ReactFlowProvider>
  );
}
