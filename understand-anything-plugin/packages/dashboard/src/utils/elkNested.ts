import type { VisibleNode } from "./visibleTree";
import type { VisibleEdge } from "./visibleEdges";
import { applyElkLayout } from "./elk-layout";
import type { ElkChild, ElkInput } from "./elk-layout";
import { NODE_WIDTH, NODE_HEIGHT, ELK_DEFAULT_LAYOUT_OPTIONS } from "./layout";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

function buildElkChildren(
  ids: string[],
  childrenOf: Map<string, string[]>,
  nodeMap: Map<string, VisibleNode>,
): ElkChild[] {
  return ids.map((id) => {
    const n = nodeMap.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    const hasChildren = kids.length > 0;

    const base: ElkChild = { id };

    if (!hasChildren) {
      // leaf: fixed size
      if (n.kind === "node") {
        base.width = NODE_WIDTH;
        base.height = NODE_HEIGHT;
      } else {
        // collapsed cluster header
        base.width = 220;
        base.height = 52;
      }
    } else {
      // parent with children: let ELK size it; add padding for header
      base.layoutOptions = { "elk.padding": "[top=34,left=14,right=14,bottom=14]" };
      base.children = buildElkChildren(kids, childrenOf, nodeMap);
    }

    return base;
  });
}

function flattenPositioned(
  children: ElkChild[],
  parentId: string | null,
  offsetX: number,
  offsetY: number,
  out: LaidOutNode[],
): void {
  for (const c of children) {
    const absX = offsetX + (c.x ?? 0);
    const absY = offsetY + (c.y ?? 0);
    const w = c.width ?? NODE_WIDTH;
    const h = c.height ?? NODE_HEIGHT;
    out.push({ id: c.id, x: absX, y: absY, width: w, height: h, parentId });
    if (c.children?.length) {
      flattenPositioned(c.children, c.id, absX, absY, out);
    }
  }
}

export async function layoutNestedTree(
  nodes: VisibleNode[],
  edges: VisibleEdge[],
): Promise<{ positioned: LaidOutNode[]; issues: string[] }> {
  if (nodes.length === 0) return { positioned: [], issues: [] };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Index children by parentId
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    if (n.parentId === null) {
      roots.push(n.id);
    } else {
      const arr = childrenOf.get(n.parentId);
      if (arr) arr.push(n.id);
      else childrenOf.set(n.parentId, [n.id]);
    }
  }

  const elkInput: ElkInput = {
    id: "root",
    layoutOptions: {
      ...ELK_DEFAULT_LAYOUT_OPTIONS,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: buildElkChildren(roots, childrenOf, nodeMap),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const { positioned, issues } = await applyElkLayout(elkInput, { strict: false });

    if (!positioned.children?.length && nodes.length > 0) {
      throw new Error("ELK returned empty children");
    }

    const out: LaidOutNode[] = [];
    flattenPositioned(positioned.children ?? [], null, 0, 0, out);
    return { positioned: out, issues: issues.map((i) => i.message) };
  } catch {
    // ponytail: grid fallback keeps canvas non-blank if ELK fails
    console.warn("[elkNested] ELK failed — grid fallback");
    const cols = Math.ceil(Math.sqrt(roots.length));
    const cellW = NODE_WIDTH + 40;
    const cellH = NODE_HEIGHT + 40;
    const out: LaidOutNode[] = roots.map((id, i) => ({
      id,
      x: (i % cols) * cellW,
      y: Math.floor(i / cols) * cellH,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      parentId: null,
    }));
    return { positioned: out, issues: ["elk-failed"] };
  }
}
