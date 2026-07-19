import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

export interface ForceLayoutNode {
  id: string;
  width: number;
  height: number;
  community?: number;
}

export interface ForceLayoutEdge {
  source: string;
  target: string;
}

export interface ForceLayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface ForceLayoutRequest {
  requestId: number;
  nodes: ForceLayoutNode[];
  edges: ForceLayoutEdge[];
}

export interface ForceLayoutSuccess {
  requestId: number;
  positions: ForceLayoutPosition[];
}

export interface ForceLayoutFailure {
  requestId: number;
  error: string;
}

export type ForceLayoutResponse = ForceLayoutSuccess | ForceLayoutFailure;

interface SimulationForceNode extends SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
  community?: number;
}

/**
 * Run the expensive d3-force simulation. This function is called by the
 * dedicated layout worker; keeping it DOM-free also makes the algorithm easy
 * to verify in Node-based unit tests.
 */
export function computeForceLayout(
  nodes: ForceLayoutNode[],
  edges: ForceLayoutEdge[],
): ForceLayoutPosition[] {
  if (nodes.length === 0) return [];

  // Leaving x/y unset lets d3-force use its deterministic phyllotaxis seed.
  // This keeps layouts stable for identical, ordered graph inputs.
  const simulationNodes: SimulationForceNode[] = nodes.map((node) => ({ ...node }));
  const nodeIds = new Set(simulationNodes.map((node) => node.id));
  const simulationLinks: SimulationLinkDatum<SimulationForceNode>[] = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const communityIds = [
    ...new Set(
      simulationNodes
        .map((node) => node.community)
        .filter((community): community is number => community !== undefined),
    ),
  ].sort((left, right) => left - right);
  const communityIndexById = new Map(
    communityIds.map((community, index) => [community, index]),
  );
  const communityCount = Math.max(1, communityIds.length);
  const communityAngle = (community: number) =>
    (2 * Math.PI * (communityIndexById.get(community) ?? 0)) / communityCount;
  const clusterRadius = Math.max(600, nodes.length * 5);
  const isLarge = nodes.length > 100;
  const chargeStrength = isLarge ? -600 : -350;
  const linkDistance = isLarge ? 250 : 150;

  const simulation = forceSimulation<SimulationForceNode>(simulationNodes)
    .force(
      "link",
      forceLink<SimulationForceNode, SimulationLinkDatum<SimulationForceNode>>(
        simulationLinks,
      )
        .id((node) => node.id)
        .distance(linkDistance)
        .strength(0.2),
    )
    .force("charge", forceManyBody().strength(chargeStrength).distanceMax(1500))
    .force("center", forceCenter(0, 0).strength(0.03))
    .force(
      "collide",
      forceCollide<SimulationForceNode>()
        .radius((node) => Math.max(20, (node.width + 40) / 2))
        .strength(0.8),
    );

  if (communityCount > 1) {
    simulation.force(
      "clusterX",
      forceX<SimulationForceNode>((node) =>
        Math.cos(communityAngle(node.community ?? 0)) * clusterRadius,
      ).strength(0.3),
    );
    simulation.force(
      "clusterY",
      forceY<SimulationForceNode>((node) =>
        Math.sin(communityAngle(node.community ?? 0)) * clusterRadius,
      ).strength(0.3),
    );
  }

  simulation.tick(Math.min(300, Math.max(100, nodes.length)));
  simulation.stop();

  return simulationNodes.map((node) => ({
    id: node.id,
    x: Number.isFinite(node.x) ? (node.x ?? 0) - node.width / 2 : 0,
    y: Number.isFinite(node.y) ? (node.y ?? 0) - node.height / 2 : 0,
  }));
}
