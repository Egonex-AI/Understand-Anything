import dagre from "@dagrejs/dagre";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import type { Node, Edge } from "@xyflow/react";
import type { ElkInput } from "./elk-layout";

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 120;
export const LAYER_CLUSTER_WIDTH = 320;
export const LAYER_CLUSTER_HEIGHT = 180;
export const PORTAL_NODE_WIDTH = 240;
export const PORTAL_NODE_HEIGHT = 80;

/**
 * Synchronous dagre layout — used for small graphs.
 *
 * @deprecated The dashboard's structural views all use ELK now
 * (`applyElkLayout` from `./elk-layout`). This helper is kept for one
 * release to allow a quick fallback if ELK has a regression. Slated for
 * removal in the version after layout migration is verified stable.
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  nodeDimensions?: Map<string, { width: number; height: number }>,
  spacingOverrides?: { nodesep?: number; ranksep?: number },
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  // Scale spacing for larger graphs to reduce overlap
  const isLarge = nodes.length > 50;
  g.setGraph({
    rankdir: direction,
    nodesep: spacingOverrides?.nodesep ?? (isLarge ? 80 : 60),
    ranksep: spacingOverrides?.ranksep ?? (isLarge ? 120 : 80),
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((node) => {
    const dims = nodeDimensions?.get(node.id);
    const w = dims?.width ?? NODE_WIDTH;
    const h = dims?.height ?? NODE_HEIGHT;
    g.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return { ...node, position: { x: 0, y: 0 } };
    const dims = nodeDimensions?.get(node.id);
    const w = dims?.width ?? NODE_WIDTH;
    const h = dims?.height ?? NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// Force-directed layout (for knowledge graphs)
// ---------------------------------------------------------------------------

interface ForceNode extends SimulationNodeDatum {
  id: string;
  community?: number;
}

/**
 * Force-directed layout using d3-force — used for knowledge graphs.
 * Optionally groups nodes by community (layer/category).
 */
export function applyForceLayout(
  nodes: Node[],
  edges: Edge[],
  nodeDimensions?: Map<string, { width: number; height: number }>,
  communityMap?: Map<string, number>,
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  // Build simulation nodes with optional community assignment
  const simNodes: ForceNode[] = nodes.map((n) => ({
    id: n.id,
    x: Math.random() * 800 - 400,
    y: Math.random() * 800 - 400,
    community: communityMap?.get(n.id),
  }));

  const nodeIdSet = new Set(simNodes.map((n) => n.id));
  const simLinks: SimulationLinkDatum<ForceNode>[] = edges
    .filter((e) => nodeIdSet.has(e.source as string) && nodeIdSet.has(e.target as string))
    .map((e) => ({
      source: e.source as string,
      target: e.target as string,
    }));

  // Compute community centers for cluster attraction
  const communityCount = communityMap
    ? Math.max(1, new Set(communityMap.values()).size)
    : 1;
  const communityAngle = (i: number) => (2 * Math.PI * i) / communityCount;
  // Scale cluster radius with node count for better spread
  const clusterRadius = Math.max(600, nodes.length * 5);

  // Scale forces based on graph size
  const isLarge = nodes.length > 100;
  const chargeStrength = isLarge ? -600 : -350;
  const linkDistance = isLarge ? 250 : 150;

  const sim = forceSimulation<ForceNode>(simNodes)
    .force(
      "link",
      forceLink<ForceNode, SimulationLinkDatum<ForceNode>>(simLinks)
        .id((d) => d.id)
        .distance(linkDistance)
        .strength(0.2),
    )
    .force("charge", forceManyBody().strength(chargeStrength).distanceMax(1500))
    .force("center", forceCenter(0, 0).strength(0.03))
    .force(
      "collide",
      forceCollide<ForceNode>().radius((d) => {
        const dims = nodeDimensions?.get(d.id);
        return Math.max(20, ((dims?.width ?? NODE_WIDTH) + 40) / 2);
      }).strength(0.8),
    );

  // Add community clustering force if communities are provided
  if (communityMap && communityCount > 1) {
    sim.force(
      "clusterX",
      forceX<ForceNode>((d) => {
        const c = d.community ?? 0;
        return Math.cos(communityAngle(c)) * clusterRadius;
      }).strength(0.3),
    );
    sim.force(
      "clusterY",
      forceY<ForceNode>((d) => {
        const c = d.community ?? 0;
        return Math.sin(communityAngle(c)) * clusterRadius;
      }).strength(0.3),
    );
  }

  // Run to convergence synchronously
  const ticks = Math.min(300, Math.max(100, nodes.length));
  sim.tick(ticks);
  sim.stop();

  // Map positions back to xyflow nodes
  const posMap = new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  const layoutedNodes = nodes.map((node) => {
    const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
    const dims = nodeDimensions?.get(node.id);
    const w = dims?.width ?? NODE_WIDTH;
    const h = dims?.height ?? NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// ELK helpers
// ---------------------------------------------------------------------------

export const ELK_DEFAULT_LAYOUT_OPTIONS: Record<string, string> = {
  algorithm: "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "60",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.compaction.postCompaction.strategy": "LEFT",
  "elk.padding": "[top=40,left=20,right=20,bottom=20]",
};

export function nodesToElkInput(
  nodes: Node[],
  edges: Edge[],
  dims: Map<string, { width: number; height: number }>,
  layoutOptionsOverride?: Record<string, string>,
): ElkInput {
  return {
    id: "root",
    layoutOptions: { ...ELK_DEFAULT_LAYOUT_OPTIONS, ...layoutOptionsOverride },
    children: nodes.map((n) => {
      const d = dims.get(n.id);
      return {
        id: n.id,
        width: d?.width ?? NODE_WIDTH,
        height: d?.height ?? NODE_HEIGHT,
      };
    }),
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      sources: [String(e.source)],
      targets: [String(e.target)],
    })),
  };
}

export function mergeElkPositions<T extends Node>(
  nodes: T[],
  positioned: ElkInput,
): T[] {
  const positionedMap = new Map<
    string,
    { x: number; y: number; width?: number; height?: number }
  >();
  for (const c of positioned.children ?? []) {
    positionedMap.set(c.id, {
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width,
      height: c.height,
    });
  }
  return nodes.map((n) => {
    const merged = positionedMap.get(n.id);
    if (!merged) {
      return {
        ...n,
        position: n.position ?? { x: 0, y: 0 },
      };
    }
    // Propagate width/height for container nodes so a tick-driven
    // Stage 1 re-layout (Task 15) can resize the visible atom to match
    // the actual Stage 2 footprint. ELK echoes back the same width/height
    // we passed in for non-container nodes, so this is a no-op for them.
    return {
      ...n,
      position: { x: merged.x, y: merged.y },
      ...(merged.width != null ? { width: merged.width } : {}),
      ...(merged.height != null ? { height: merged.height } : {}),
    };
  });
}
