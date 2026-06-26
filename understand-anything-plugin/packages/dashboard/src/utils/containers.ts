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
