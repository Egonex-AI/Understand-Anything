import type {
  GraphNode,
  GraphEdge,
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

export function deriveContainers(
  nodes: GraphNode[],
  edges: GraphEdge[],
): DeriveResult {
  if (nodes.length === 0) {
    return { containers: [], ungrouped: [] };
  }

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
      name: i < 26 ? `Cluster ${String.fromCharCode(65 + i)}` : `Cluster ${i + 1}`,
      nodeIds: ids,
      strategy: "community" as const,
    }));
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

  // Suppress single-child containers (their child becomes ungrouped).
  // Skip suppression for tiny layers — with so few nodes, even single-item
  // boxes carry useful folder context that shouldn't be discarded.
  const ungrouped: string[] = [];
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
