import type {
  GraphNode,
  GraphEdge,
} from "@understand-anything/core/types";
import { detectCommunities } from "./louvain";

export interface DerivedContainer {
  id: string;
  name: string;
  prefix: string;
  nodeIds: string[];
  strategy: "folder" | "community";
}

export interface ContainerLevel {
  containers: DerivedContainer[];
  leaves: string[];
}

export interface DeriveResult {
  containers: DerivedContainer[];
  ungrouped: string[];
}

// Folder segments that are "transparent" — skipped when grouping by next
// meaningful segment. Exported so the breadcrumb can fold these segments into
// the next real crumb (they are never their own container).
export const TRANSPARENT = new Set(["src", "app", "lib", "source"]);

/**
 * Returns the path segments of `filePath` *after* the given `prefix`, or null
 * if the path does not live under that prefix. An empty prefix means the whole
 * path is relevant.
 */
function remainder(filePath: string | undefined, prefix: string): string[] | null {
  if (!filePath) return null;
  let p = filePath;
  if (prefix) {
    if (p !== prefix && !p.startsWith(prefix + "/")) return null;
    p = p.slice(prefix.length + 1);
  }
  return p.split("/").filter(Boolean);
}

/**
 * One raw grouping level: for each node, skip transparent leading segments,
 * then group by the next segment. Nodes that sit directly in the prefix (or
 * have no path) become leaves.
 */
function computeFolderLevel(nodes: GraphNode[], prefix: string): ContainerLevel {
  // Map from full folder path → node ids in that folder
  const groups = new Map<string, string[]>();
  const leaves: string[] = [];

  for (const nd of nodes) {
    let segs = remainder(nd.filePath, prefix);
    if (!segs || segs.length === 0) {
      leaves.push(nd.id);
      continue;
    }
    // Track any transparent segments we consume so we know the full path.
    let consumed = prefix;
    while (segs.length > 1 && TRANSPARENT.has(segs[0])) {
      consumed = consumed ? `${consumed}/${segs[0]}` : segs[0];
      segs = segs.slice(1);
    }
    // After skipping transparent: if only one segment remains, it's the file itself → leaf.
    if (segs.length <= 1) {
      leaves.push(nd.id);
      continue;
    }
    // segs[0] is the grouping folder segment.
    const folderPath = consumed ? `${consumed}/${segs[0]}` : segs[0];
    const arr = groups.get(folderPath) ?? [];
    arr.push(nd.id);
    groups.set(folderPath, arr);
  }

  const containers: DerivedContainer[] = [...groups.entries()].map(([folderPath, ids]) => ({
    id: `container:${folderPath}`,
    name: folderPath.split("/").pop()!,
    prefix: folderPath,
    nodeIds: ids,
    strategy: "folder" as const,
  }));

  return { containers, leaves };
}

/**
 * Derive containers for the given nodes at the given prefix level, with
 * single-child folder-chain collapse and community fallback at the root.
 */
export function deriveContainerLevel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  prefix = "",
): ContainerLevel {
  let level = computeFolderLevel(nodes, prefix);

  // Single-child folder collapse: while there is exactly one folder container
  // and no leaves, keep descending and accumulate the name segments.
  let collapsedName: string | null = null;
  let collapsedPrefix: string | null = null;

  while (level.containers.length === 1 && level.leaves.length === 0) {
    const only = level.containers[0];
    collapsedName = collapsedName ? `${collapsedName}/${only.name}` : only.name;
    collapsedPrefix = only.prefix;

    const next = computeFolderLevel(nodes, only.prefix);

    // Guard: nothing at all at the next level — stop to avoid an infinite loop.
    if (next.containers.length === 0 && next.leaves.length === 0) break;

    level = next;
    // Continue collapsing only if still a single-child chain with no leaves.
  }

  // Re-wrap the result under the collapsed name when appropriate.
  if (collapsedName !== null && collapsedPrefix !== null) {
    if (level.containers.length === 0 && level.leaves.length > 0) {
      // The collapse bottomed out at actual files — present the collapsed chain
      // as the single container holding those files.
      level = {
        containers: [{
          id: `container:${collapsedPrefix}`,
          name: collapsedName,
          prefix: collapsedPrefix,
          nodeIds: level.leaves,
          strategy: "folder" as const,
        }],
        leaves: [],
      };
    } else if (level.containers.length > 1 || level.leaves.length > 0) {
      // The chain forked into multiple sub-folders or a mix of folders + leaves.
      // Wrap everything under the collapsed-chain container.
      const allNodeIds = [
        ...level.containers.flatMap((c) => c.nodeIds),
        ...level.leaves,
      ];
      level = {
        containers: [{
          id: `container:${collapsedPrefix}`,
          name: collapsedName,
          prefix: collapsedPrefix,
          nodeIds: allNodeIds,
          strategy: "folder" as const,
        }],
        leaves: [],
      };
    } else if (level.containers.length === 1) {
      // Still a single container after collapse — give it the collapsed name.
      level.containers[0].name = collapsedName;
    }
  }

  // Community fallback: only at the layer root (prefix === ""), only when
  // nothing was grouped into folder containers.
  if (
    prefix === "" &&
    level.containers.length < 2 &&
    level.leaves.length === nodes.length
  ) {
    if (import.meta.env.DEV) {
      console.debug("[containers] no folder structure at layer root — community fallback");
    }
    const communities = detectCommunities(nodes.map((x) => x.id), edges);
    const byC = new Map<number, string[]>();
    for (const [id, c] of communities) {
      const arr = byC.get(c) ?? [];
      arr.push(id);
      byC.set(c, arr);
    }
    const communityContainers: DerivedContainer[] = [...byC.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([c, ids], i) => ({
        id: `container:cluster-${c}`,
        name: i < 26 ? `Cluster ${String.fromCharCode(65 + i)}` : `Cluster ${i + 1}`,
        prefix: "",
        nodeIds: ids,
        strategy: "community" as const,
      }));
    return { containers: communityContainers, leaves: [] };
  }

  return level;
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
      prefix: "",
      nodeIds: ids,
      strategy: "community" as const,
    }));
  } else {
    containers = [...groups.entries()].map(([seg, ids]) => ({
      id: `container:${seg}`,
      name: seg,
      prefix: seg,
      nodeIds: ids,
      strategy: "folder" as const,
    }));
    if (rooted.length > 0) {
      containers.push({
        id: `container:${ROOT_BUCKET}`,
        name: ROOT_BUCKET,
        prefix: "",
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
