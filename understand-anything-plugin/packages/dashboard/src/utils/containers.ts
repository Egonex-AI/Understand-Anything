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
  // A single folder covering the whole set is a meaningful unit (e.g. a
  // Redux slice folder like src/store/meetingTypes) — keep it as ONE named
  // container instead of splitting into anonymous Louvain communities.
  if (groups.size === 1 && rooted.length === 0) return false;
  // A single folder covering the whole set is a meaningful unit — keep it
  // as ONE named container instead of splitting into Louvain communities.
  if (groups.size === 1 && rooted.length === 0) return false;
  const bucketCount = groups.size + (rooted.length > 0 ? 1 : 0);
  if (bucketCount < MIN_BUCKET_COUNT) return true;
  for (const ids of groups.values()) {
    if (ids.length / totalNodes > MAX_CONCENTRATION) return true;
  }
  if (rooted.length / totalNodes > MAX_CONCENTRATION) return true;
  return false;
}

export interface PredefinedGroup {
  id?: string;
  name: string;
  nodeIds: string[];
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function deriveContainers(
  nodes: GraphNode[],
  edges: GraphEdge[],
  predefined?: PredefinedGroup[],
): DeriveResult {
  if (nodes.length === 0) {
    return { containers: [], ungrouped: [] };
  }

  // Manual grouping from the graph data (layer.containers) wins over
  // folder/community derivation. Nodes not claimed by any group stay
  // ungrouped — they render as standalone cards one level above.
  if (predefined && predefined.length > 0) {
    const present = new Set(nodes.map((n) => n.id));
    const claimed = new Set<string>();
    const containers: DerivedContainer[] = [];
    for (const g of predefined) {
      const ids = g.nodeIds.filter((id) => present.has(id) && !claimed.has(id));
      if (ids.length === 0) continue; // singleton FEATURE containers are allowed
      for (const id of ids) claimed.add(id);
      containers.push({
        id: g.id ?? `container:${slug(g.name)}`,
        name: g.name,
        nodeIds: ids,
        strategy: "folder",
      });
    }
    if (containers.length > 0) {
      const ungrouped = nodes.map((n) => n.id).filter((id) => !claimed.has(id));
      return { containers, ungrouped };
    }
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
    // Name community clusters by their member files instead of "Cluster A/B/C".
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const FILE_LEVEL = new Set([
      "file", "config", "document", "service", "pipeline",
      "table", "schema", "resource", "endpoint",
    ]);
    const labelFor = (ids: string[]): string => {
      let members = ids
        .map((id) => nodeById.get(id))
        .filter((n): n is GraphNode => Boolean(n));
      const fileMembers = members.filter((m) => FILE_LEVEL.has(m.type));
      if (fileMembers.length > 0) members = fileMembers;
      const bases = [
        ...new Set(
          members.map((m) =>
            (m.name ?? m.id).replace(/\.(tsx?|jsx?|java|py|go|rb|cs|kt)$/i, ""),
          ),
        ),
      ];
      const head = bases.slice(0, 3).join(" · ");
      return bases.length > 3 ? `${head} +${bases.length - 3}` : head;
    };
    containers = sorted.map(([cid, ids], i) => ({
      id: `container:cluster-${cid}`,
      name:
        labelFor(ids) ||
        (i < 26 ? `Cluster ${String.fromCharCode(65 + i)}` : `Cluster ${i + 1}`),
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
