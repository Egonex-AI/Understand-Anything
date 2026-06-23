import { SearchEngine } from "@understand-anything/core";
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  Layer,
} from "@understand-anything/core";

export interface ChatContext {
  projectName: string;
  projectDescription: string;
  languages: string[];
  frameworks: string[];
  relevantNodes: GraphNode[];
  relevantEdges: GraphEdge[];
  relevantLayers: Layer[];
  query: string;
}

/**
 * Build a ChatContext by searching the knowledge graph for nodes relevant
 * to the user's query, expanding 1 hop via edges, and collecting the
 * associated layers.
 */
export function buildChatContext(
  graph: KnowledgeGraph,
  query: string,
  maxNodes?: number,
): ChatContext {
  const limit = maxNodes ?? 15;

  // 1. Use SearchEngine to find relevant nodes
  const engine = new SearchEngine(graph.nodes);
  const searchResults = engine.search(query, { limit });

  // Build a set of matched node IDs
  const matchedIds = new Set(searchResults.map((r) => r.nodeId));

  // 2. Expand to connected nodes (1 hop via edges)
  const expandedIds = new Set(matchedIds);
  for (const edge of graph.edges) {
    if (matchedIds.has(edge.source)) {
      expandedIds.add(edge.target);
    }
    if (matchedIds.has(edge.target)) {
      expandedIds.add(edge.source);
    }
  }

  // Collect the actual node objects
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const relevantNodes: GraphNode[] = [];
  for (const id of expandedIds) {
    const node = nodeMap.get(id);
    if (node) {
      relevantNodes.push(node);
    }
  }

  // 3. Collect edges where both endpoints are in the relevant set
  const relevantEdges = graph.edges.filter(
    (e) => expandedIds.has(e.source) && expandedIds.has(e.target),
  );

  // 4. Find layers containing any relevant node
  const relevantLayers = graph.layers.filter((layer) =>
    layer.nodeIds.some((id) => expandedIds.has(id)),
  );

  return {
    projectName: graph.project.name,
    projectDescription: graph.project.description,
    languages: graph.project.languages,
    frameworks: graph.project.frameworks,
    relevantNodes,
    relevantEdges,
    relevantLayers,
    query,
  };
}

/**
 * Format the ChatContext as a readable markdown string for LLM consumption.
 */
export function formatContextForPrompt(context: ChatContext): string {
  const lines: string[] = [];

  // Project header
  lines.push(`# Project: ${context.projectName}`);
  lines.push("");
  lines.push(context.projectDescription);
  lines.push("");
  lines.push(`**Languages:** ${context.languages.join(", ")}`);
  lines.push(`**Frameworks:** ${context.frameworks.join(", ")}`);
  lines.push("");

  // Layers section
  if (context.relevantLayers.length > 0) {
    lines.push("## Relevant Layers");
    lines.push("");
    for (const layer of context.relevantLayers) {
      lines.push(`### ${layer.name}`);
      lines.push(layer.description);
      lines.push("");
    }
  }

  // Nodes section
  if (context.relevantNodes.length > 0) {
    lines.push("## Code Components");
    lines.push("");
    for (const node of context.relevantNodes) {
      lines.push(`### ${node.name} (${node.type})`);
      if (node.filePath) {
        lines.push(`- **File:** ${node.filePath}`);
      }
      lines.push(`- **Complexity:** ${node.complexity}`);
      lines.push(`- **Summary:** ${node.summary}`);
      if (node.tags.length > 0) {
        lines.push(`- **Tags:** ${node.tags.join(", ")}`);
      }
      if (node.languageNotes) {
        lines.push(`- **Language Notes:** ${node.languageNotes}`);
      }
      lines.push("");
    }
  }

  // Edges/relationships section
  if (context.relevantEdges.length > 0) {
    const nodeMap = new Map(context.relevantNodes.map((n) => [n.id, n]));
    lines.push("## Relationships");
    lines.push("");
    for (const edge of context.relevantEdges) {
      const sourceName = nodeMap.get(edge.source)?.name ?? edge.source;
      const targetName = nodeMap.get(edge.target)?.name ?? edge.target;
      let line = `- ${sourceName} --[${edge.type}]--> ${targetName}`;
      if (edge.description) {
        line += `: ${edge.description}`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}
