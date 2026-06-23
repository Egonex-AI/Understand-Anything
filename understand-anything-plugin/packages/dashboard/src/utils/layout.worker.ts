import dagre from "@dagrejs/dagre";

export interface LayoutMessage {
  requestId: number;
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ source: string; target: string }>;
  direction: "TB" | "LR";
}

export interface LayoutResult {
  requestId: number;
  positions: Record<string, { x: number; y: number }>;
}

self.onmessage = (e: MessageEvent<LayoutMessage>) => {
  const { requestId, nodes, edges, direction } = e.data;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const pos = g.node(node.id);
    positions[node.id] = pos
      ? { x: pos.x - node.width / 2, y: pos.y - node.height / 2 }
      : { x: 0, y: 0 };
  }

  self.postMessage({ requestId, positions } satisfies LayoutResult);
};
