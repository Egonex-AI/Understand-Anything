import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  Layer,
} from "@understand-anything/core";

export interface DiffContext {
  projectName: string;
  changedFiles: string[];
  changedNodes: GraphNode[];
  affectedNodes: GraphNode[];
  impactedEdges: GraphEdge[];
  affectedLayers: Layer[];
  unmappedFiles: string[];
}

/**
 * Map a list of changed file paths to knowledge graph nodes and
 * identify the ripple effect (affected nodes, layers, edges).
 */
export function buildDiffContext(
  graph: KnowledgeGraph,
  changedFiles: string[],
): DiffContext {
  const { nodes, edges, layers } = graph;

  const changedNodeIds = new Set<string>();
  const unmappedFiles: string[] = [];

  for (const file of changedFiles) {
    let mapped = false;
    for (const node of nodes) {
      if (node.filePath === file) {
        changedNodeIds.add(node.id);
        mapped = true;
      }
    }
    if (!mapped) {
      unmappedFiles.push(file);
    }
  }

  // Also include "contains" children of changed file nodes
  for (const edge of edges) {
    if (edge.type === "contains" && changedNodeIds.has(edge.source)) {
      changedNodeIds.add(edge.target);
    }
  }

  const changedNodes = nodes.filter((n) => changedNodeIds.has(n.id));

  // Find affected nodes: 1-hop neighbors of changed nodes (excluding already changed)
  const affectedNodeIds = new Set<string>();
  const impactedEdges: GraphEdge[] = [];

  for (const edge of edges) {
    const sourceChanged = changedNodeIds.has(edge.source);
    const targetChanged = changedNodeIds.has(edge.target);

    if (sourceChanged || targetChanged) {
      impactedEdges.push(edge);
      if (sourceChanged && !changedNodeIds.has(edge.target)) {
        affectedNodeIds.add(edge.target);
      }
      if (targetChanged && !changedNodeIds.has(edge.source)) {
        affectedNodeIds.add(edge.source);
      }
    }
  }

  const affectedNodes = nodes.filter((n) => affectedNodeIds.has(n.id));

  const allImpactedIds = new Set([...changedNodeIds, ...affectedNodeIds]);
  const affectedLayers = layers.filter((layer) =>
    layer.nodeIds.some((id) => allImpactedIds.has(id)),
  );

  return {
    projectName: graph.project.name,
    changedFiles,
    changedNodes,
    affectedNodes,
    impactedEdges,
    affectedLayers,
    unmappedFiles,
  };
}

/**
 * Format the diff analysis as structured markdown for LLM or human consumption.
 */
export function formatDiffAnalysis(ctx: DiffContext): string {
  const lines: string[] = [];

  lines.push(`# Diff Analysis: ${ctx.projectName}`);
  lines.push("");

  lines.push("## Changed Components");
  lines.push("");
  if (ctx.changedNodes.length === 0) {
    lines.push("No mapped components found for changed files.");
  } else {
    for (const node of ctx.changedNodes) {
      lines.push(`- **${node.name}** (${node.type}) — ${node.summary}`);
      if (node.filePath) lines.push(`  - File: \`${node.filePath}\``);
      lines.push(`  - Complexity: ${node.complexity}`);
    }
  }
  lines.push("");

  lines.push("## Affected Components");
  lines.push("");
  if (ctx.affectedNodes.length === 0) {
    lines.push("No downstream impact detected.");
  } else {
    lines.push(
      "These components are connected to changed code and may need attention:",
    );
    lines.push("");
    for (const node of ctx.affectedNodes) {
      lines.push(`- **${node.name}** (${node.type}) — ${node.summary}`);
    }
  }
  lines.push("");

  lines.push("## Affected Layers");
  lines.push("");
  if (ctx.affectedLayers.length === 0) {
    lines.push("No layers affected.");
  } else {
    for (const layer of ctx.affectedLayers) {
      lines.push(`- **${layer.name}**: ${layer.description}`);
    }
  }
  lines.push("");

  if (ctx.impactedEdges.length > 0) {
    lines.push("## Impacted Relationships");
    lines.push("");
    for (const edge of ctx.impactedEdges) {
      lines.push(`- ${edge.source} --[${edge.type}]--> ${edge.target}`);
    }
    lines.push("");
  }

  if (ctx.unmappedFiles.length > 0) {
    lines.push("## Unmapped Files");
    lines.push("");
    lines.push("These changed files are not yet in the knowledge graph:");
    lines.push("");
    for (const f of ctx.unmappedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  lines.push("## Risk Assessment");
  lines.push("");
  const complexChanges = ctx.changedNodes.filter(
    (n) => n.complexity === "complex",
  );
  const crossLayerCount = new Set(ctx.affectedLayers.map((l) => l.id)).size;

  if (complexChanges.length > 0) {
    lines.push(
      `- **High complexity**: ${complexChanges.length} complex component(s) changed: ${complexChanges.map((n) => n.name).join(", ")}`,
    );
  }
  if (crossLayerCount > 1) {
    lines.push(
      `- **Cross-layer impact**: Changes span ${crossLayerCount} architectural layers`,
    );
  }
  if (ctx.affectedNodes.length > 5) {
    lines.push(
      `- **Wide blast radius**: ${ctx.affectedNodes.length} components affected downstream`,
    );
  }
  if (ctx.unmappedFiles.length > 0) {
    lines.push(
      `- **New/unmapped files**: ${ctx.unmappedFiles.length} files not in the knowledge graph (may need re-analysis)`,
    );
  }
  if (
    complexChanges.length === 0 &&
    crossLayerCount <= 1 &&
    ctx.affectedNodes.length <= 5 &&
    ctx.unmappedFiles.length === 0
  ) {
    lines.push(
      "- **Low risk**: Changes are localized with limited downstream impact.",
    );
  }
  lines.push("");

  return lines.join("\n");
}
