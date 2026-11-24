import type {
  GraphNode,
  GraphEdge,
  ContainerLabel,
} from "@understand-anything/core/types";
import { detectCommunities } from "./louvain";

export interface DerivedContainer {
  id: string;
  name: string;
  nodeIds: string[];
  strategy: "folder" | "community";
}

export interface DeriveResult {
  containers: DerivedContainer[];
  ungrouped: string[];
}

export interface ContainerBasis {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const MIN_BUCKET_COUNT = 2;
const MAX_CONCENTRATION = 0.7;
const MIN_NODES_FOR_SUPPRESSION = 3;
const ROOT_BUCKET = "~";

/**
 * Longest common prefix of the *directory* portion of paths, trimmed to a
 * `/` boundary. Using dirs (not full paths) avoids consuming the only
 * folder segment when all paths sit directly under the same folder
 * (e.g. `[auth/x, auth/y]` → LCP `""`, so we still group on `auth`).
 */
function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const dirs = paths.map((p) => {
    const slash = p.lastIndexOf("/");
    return slash >= 0 ? p.slice(0, slash) : "";
  });
  let prefix = dirs[0];
  for (const d of dirs) {
    while (!d.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  const lastSlash = prefix.lastIndexOf("/");
  return lastSlash >= 0 ? prefix.slice(0, lastSlash + 1) : "";
}

function firstSegment(path: string): string {
  const slash = path.indexOf("/");
  return slash >= 0 ? path.slice(0, slash) : path;
}

function groupByFolder(
  nodes: GraphNode[],
): { groups: Map<string, string[]>; rooted: string[] } {
  const withPath = nodes.filter((n) => n.filePath);
  const lcp = commonPrefix(withPath.map((n) => n.filePath!));
  const groups = new Map<string, string[]>();
  const rooted: string[] = [];
  for (const n of nodes) {
    if (!n.filePath) {
      rooted.push(n.id);
      continue;
    }
    const stripped = n.filePath.slice(lcp.length);
    if (!stripped.includes("/")) {
      rooted.push(n.id);
      continue;
    }
    const seg = firstSegment(stripped);
    const arr = groups.get(seg) ?? [];
    arr.push(n.id);
    groups.set(seg, arr);
  }
  return { groups, rooted };
}

function shouldFallbackToCommunity(
  groups: Map<string, string[]>,
  rooted: string[],
  totalNodes: number,
): boolean {
  const bucketCount = groups.size + (rooted.length > 0 ? 1 : 0);
  if (bucketCount < MIN_BUCKET_COUNT) return true;
  for (const ids of groups.values()) {
    if (ids.length / totalNodes > MAX_CONCENTRATION) return true;
  }
  if (rooted.length / totalNodes > MAX_CONCENTRATION) return true;
  return false;
}

// A label applies to a container when at least this share of their combined
// members is shared (Jaccard index). Below this, the label describes a
// different group and the container keeps its fallback name.
const MIN_LABEL_OVERLAP = 0.5;

/**
 * Replaces the fallback "Cluster X" names of community containers with
 * names from `labels`. Matching uses member overlap, not ids: community ids
 * are numbered by the detection run and can shift when the graph changes.
 * Each label names at most one container (best overlap first).
 */
function applyLabels(
  containers: DerivedContainer[],
  labels: ContainerLabel[],
): DerivedContainer[] {
  const pairs: { ci: number; li: number; score: number }[] = [];
  containers.forEach((c, ci) => {
    if (c.strategy !== "community") return;
    const members = new Set(c.nodeIds);
    labels.forEach((l, li) => {
      const labelIds = new Set(l.nodeIds);
      let shared = 0;
      for (const id of labelIds) if (members.has(id)) shared++;
      const union = members.size + labelIds.size - shared;
      const score = union === 0 ? 0 : shared / union;
      if (score >= MIN_LABEL_OVERLAP) pairs.push({ ci, li, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const names = new Map<number, string>();
  const usedLabels = new Set<number>();
  for (const { ci, li } of pairs) {
    if (names.has(ci) || usedLabels.has(li)) continue;
    names.set(ci, labels[li].name);
    usedLabels.add(li);
  }
  return containers.map((c, ci) =>
    names.has(ci) ? { ...c, name: names.get(ci)! } : c,
  );
}

function buildContainers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  labels: ContainerLabel[],
  clusterLabel: string,
): DerivedContainer[] {
  const { groups, rooted } = groupByFolder(nodes);

  const useCommunity = shouldFallbackToCommunity(groups, rooted, nodes.length);
  let containers: DerivedContainer[];

  if (useCommunity) {
    const communities = detectCommunities(
      nodes.map((n) => n.id),
      edges,
    );
    const byCommunity = new Map<number, string[]>();
    for (const [nodeId, cid] of communities) {
      const arr = byCommunity.get(cid) ?? [];
      arr.push(nodeId);
      byCommunity.set(cid, arr);
    }
    const sorted = [...byCommunity.entries()].sort((a, b) => a[0] - b[0]);
    containers = sorted.map(([cid, ids], i) => ({
      id: `container:cluster-${cid}`,
      // A-Z for the first 26, then numeric. Avoids `String.fromCharCode(65+i)`
      // wrapping into `[`, `\`, `]` ... once the cluster count exceeds 26.
      name: i < 26
        ? `${clusterLabel} ${String.fromCharCode(65 + i)}`
        : `${clusterLabel} ${i + 1}`,
      nodeIds: ids,
      strategy: "community" as const,
    }));
    if (labels.length > 0) containers = applyLabels(containers, labels);
  } else {
    containers = [...groups.entries()].map(([seg, ids]) => ({
      id: `container:${seg}`,
      name: seg,
      nodeIds: ids,
      strategy: "folder" as const,
    }));
    if (rooted.length > 0) {
      containers.push({
        id: `container:${ROOT_BUCKET}`,
        name: ROOT_BUCKET,
        nodeIds: rooted,
        strategy: "folder" as const,
      });
    }
  }
  return containers;
}

function projectOntoBasis(
  nodes: GraphNode[],
  labels: ContainerLabel[],
  clusterLabel: string,
  basis: ContainerBasis,
): DeriveResult {
  if (nodes.length === 0) {
    return { containers: [], ungrouped: [] };
  }

  const basisContainers = buildContainers(
    basis.nodes,
    basis.edges,
    labels,
    clusterLabel,
  );
  const basisNodeToContainer = new Map<string, string>();
  const basisContainerById = new Map<string, DerivedContainer>();
  for (const container of basisContainers) {
    basisContainerById.set(container.id, container);
    for (const id of container.nodeIds) basisNodeToContainer.set(id, container.id);
  }

  const filePathToFileId = new Map<string, string>();
  for (const basisNode of basis.nodes) {
    if (basisNode.type === "file" && basisNode.filePath) {
      filePathToFileId.set(basisNode.filePath, basisNode.id);
    }
  }

  const projected = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const node of nodes) {
    let containerId: string | undefined;
    if (basisNodeToContainer.has(node.id)) {
      containerId = basisNodeToContainer.get(node.id);
    } else if ((node.type === "class" || node.type === "function") && node.filePath) {
      const fileId = filePathToFileId.get(node.filePath);
      if (fileId) containerId = basisNodeToContainer.get(fileId);
    }
    if (!containerId) {
      ungrouped.push(node.id);
      continue;
    }
    const ids = projected.get(containerId) ?? [];
    ids.push(node.id);
    projected.set(containerId, ids);
  }

  const basisNodesById = new Map(basis.nodes.map((node) => [node.id, node]));
  let containers = [...projected.entries()].map(([containerId, ids]) => {
    const basisContainer = basisContainerById.get(containerId)!;
    let name = basisContainer.name;
    if (
      basisContainer.strategy === "community" &&
      basisContainer.nodeIds.length === 1 &&
      ids.length > 1 &&
      name.startsWith(`${clusterLabel} `)
    ) {
      const fileNode = basisNodesById.get(basisContainer.nodeIds[0]);
      if (fileNode) name = fileNode.name;
    }
    return { ...basisContainer, name, nodeIds: ids };
  });

  // Suppress single-child containers (their child becomes ungrouped).
  // Skip suppression for tiny layers — with so few nodes, even single-item
  // boxes carry useful folder context that shouldn't be discarded.
  if (nodes.length >= MIN_NODES_FOR_SUPPRESSION) {
    containers = containers.filter((c) => {
      if (c.nodeIds.length === 1) {
        ungrouped.push(c.nodeIds[0]);
        return false;
      }
      return true;
    });
  }

  return { containers, ungrouped };
}

export function deriveContainers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  labels: ContainerLabel[] = [],
  clusterLabelOrBasis: string | ContainerBasis = "Cluster",
  basisArg?: ContainerBasis,
): DeriveResult {
  if (nodes.length === 0) {
    return { containers: [], ungrouped: [] };
  }

  const clusterLabel =
    typeof clusterLabelOrBasis === "string" ? clusterLabelOrBasis : "Cluster";
  const basis =
    typeof clusterLabelOrBasis === "string"
      ? basisArg
      : clusterLabelOrBasis;
  if (basis && basis.nodes.length > 0) {
    return projectOntoBasis(nodes, labels, clusterLabel, basis);
  }

  const containers = buildContainers(nodes, edges, labels, clusterLabel);
  const ungrouped: string[] = [];
  let visibleContainers = containers;
  if (nodes.length >= MIN_NODES_FOR_SUPPRESSION) {
    visibleContainers = containers.filter((c) => {
      if (c.nodeIds.length === 1) {
        ungrouped.push(c.nodeIds[0]);
        return false;
      }
      return true;
    });
  }
  return { containers: visibleContainers, ungrouped };
}
