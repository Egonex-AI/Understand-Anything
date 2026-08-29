import type { GraphNode, GraphEdge } from "../../types.js";
import type { FigmaDocument, FigmaNode } from "../source/types.js";

function mkNode(
  type: GraphNode["type"],
  figmaId: string,
  name: string,
  figmaMeta: GraphNode["figmaMeta"],
): GraphNode {
  return {
    id: `${type}:${figmaId}`,
    type,
    name,
    summary: name, // placeholder; design-analyzer enriches in Phase 2
    tags: [type],
    complexity: "simple",
    figmaMeta,
  };
}

export function parseDocument(doc: FigmaDocument, fileKey: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const add = (n: GraphNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  const link = (source: string, target: string, type: GraphEdge["type"], weight: number) =>
    edges.push({ source, target, type, direction: "forward", weight });

  // Deep-read a screen subtree to find instances (shallow node set, but deep read).
  function collectInstances(n: FigmaNode, screenId: string) {
    for (const child of n.children ?? []) {
      if (child.type === "INSTANCE") {
        const inst = mkNode("instance", child.id, child.name, {
          fileKey, nodeId: child.id, figmaType: "INSTANCE",
          // The global published key (GUID) from the document's components
          // map — child.componentId is only a file-local node id, already
          // captured by the instance_of edge below.
          componentKey: child.componentId ? doc.components?.[child.componentId]?.key : undefined,
          prototypeTargets: child.transitionNodeID ? [child.transitionNodeID] : undefined,
        });
        add(inst);
        link(screenId, inst.id, "contains", 1.0);
        if (child.componentId) link(inst.id, `component:${child.componentId}`, "instance_of", 0.8);
      }
      if (child.children) collectInstances(child, screenId);
    }
  }

  function handlePageChild(child: FigmaNode, pageId: string) {
    switch (child.type) {
      case "FRAME": {
        const screen = mkNode("screen", child.id, child.name, {
          fileKey, nodeId: child.id, figmaType: "FRAME",
          dimensions: child.absoluteBoundingBox
            ? { width: child.absoluteBoundingBox.width, height: child.absoluteBoundingBox.height }
            : undefined,
        });
        add(screen);
        link(pageId, screen.id, "contains", 1.0);
        collectInstances(child, screen.id);
        break;
      }
      case "COMPONENT": {
        const comp = mkNode("component", child.id, child.name, { fileKey, nodeId: child.id, figmaType: "COMPONENT" });
        add(comp);
        link(pageId, comp.id, "contains", 1.0);
        break;
      }
      case "COMPONENT_SET": {
        const set = mkNode("componentSet", child.id, child.name, { fileKey, nodeId: child.id, figmaType: "COMPONENT_SET" });
        add(set);
        link(pageId, set.id, "contains", 1.0);
        for (const variant of child.children ?? []) {
          if (variant.type === "COMPONENT") {
            const comp = mkNode("component", variant.id, variant.name, { fileKey, nodeId: variant.id, figmaType: "COMPONENT" });
            add(comp);
            link(comp.id, set.id, "variant_of", 0.9);
          }
        }
        break;
      }
      case "SECTION": {
        for (const sub of child.children ?? []) handlePageChild(sub, pageId); // flatten sections in v1
        break;
      }
      default:
        break; // other top-level types are ignored in v1
    }
  }

  for (const canvas of doc.document.children ?? []) {
    if (canvas.type !== "CANVAS") continue;
    const page = mkNode("page", canvas.id, canvas.name, { fileKey, nodeId: canvas.id, figmaType: "CANVAS" });
    add(page);
    for (const child of canvas.children ?? []) handlePageChild(child, page.id);
  }

  return { nodes, edges };
}
