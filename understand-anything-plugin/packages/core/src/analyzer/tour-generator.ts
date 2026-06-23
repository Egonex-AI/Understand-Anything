import type { KnowledgeGraph, TourStep } from "../types.js";

/**
 * Builds an LLM prompt asking for a guided tour of the project.
 * Includes project metadata, node summaries, edges, and layer info.
 */
export function buildTourGenerationPrompt(graph: KnowledgeGraph): string {
  const { project, nodes, edges, layers } = graph;

  const nodeList = nodes
    .map(
      (n) =>
        `  - [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`,
    )
    .join("\n");

  const edgeList = edges
    .slice(0, 50)
    .map((e) => `  - ${e.source} --${e.type}--> ${e.target}`)
    .join("\n");

  const layerList =
    layers.length > 0
      ? layers
          .map(
            (l) =>
              `  - ${l.name}: ${l.description} (nodes: ${l.nodeIds.join(", ")})`,
          )
          .join("\n")
      : "  (no layers detected)";

  return `You are a software architecture educator. Generate a guided tour of the following project that helps a newcomer understand the codebase step by step.

Project: ${project.name}
Description: ${project.description}
Languages: ${project.languages.join(", ")}
Frameworks: ${project.frameworks.join(", ")}

Nodes:
${nodeList}

Edges (dependencies/relationships):
${edgeList}

Layers:
${layerList}

Create a logical tour that:
1. Starts with entry points or high-level overview files
2. Follows the natural dependency flow
3. Groups related files together
4. Ends with supporting utilities or concepts

Return a JSON object with a "steps" array. Each step must have:
- "order": sequential number starting from 1
- "title": a short descriptive title for this tour stop
- "description": 2-3 sentences explaining what the reader will learn at this step
- "nodeIds": array of node IDs to highlight for this step
- "languageLesson" (optional): a brief note about language-specific patterns seen in these files

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Parses an LLM response for tour generation.
 * Handles raw JSON and JSON wrapped in markdown code fences.
 * Filters out steps missing required fields.
 * Returns empty array if parsing fails.
 */
export function parseTourGenerationResponse(response: string): TourStep[] {
  if (!response || response.trim().length === 0) {
    return [];
  }

  try {
    // Try to extract from markdown code fences
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : response.trim();

    // Try to find a JSON object with steps
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return [];
    }

    const parsed = JSON.parse(objectMatch[0]);

    if (!parsed || !Array.isArray(parsed.steps)) {
      return [];
    }

    // Filter and validate each step
    const steps: TourStep[] = [];
    for (const item of parsed.steps) {
      if (typeof item !== "object" || item === null) continue;
      if (typeof item.order !== "number") continue;
      if (typeof item.title !== "string" || item.title.length === 0) continue;
      if (typeof item.description !== "string" || item.description.length === 0)
        continue;
      if (!Array.isArray(item.nodeIds) || item.nodeIds.length === 0) continue;

      const step: TourStep = {
        order: item.order,
        title: item.title,
        description: item.description,
        nodeIds: item.nodeIds.filter((id: unknown) => typeof id === "string"),
      };

      if (typeof item.languageLesson === "string") {
        step.languageLesson = item.languageLesson;
      }

      steps.push(step);
    }

    return steps;
  } catch {
    return [];
  }
}

/**
 * Generates a tour heuristically (without an LLM) using graph topology.
 *
 * Strategy:
 * 1. Separate concept nodes from code nodes
 * 2. Build adjacency info from edges
 * 3. Find entry points (nodes with 0 incoming edges)
 * 4. Topological sort (Kahn's algorithm)
 * 5. If layers exist: group by layer in topological order
 * 6. If no layers: batch by 3 nodes per step
 * 7. Add concept nodes as final "Key Concepts" step
 * 8. Assign sequential order numbers
 */
export function generateHeuristicTour(graph: KnowledgeGraph): TourStep[] {
  const { nodes, edges, layers } = graph;

  // Separate concept nodes from code nodes
  const conceptNodes = nodes.filter((n) => n.type === "concept");
  const codeNodes = nodes.filter((n) => n.type !== "concept");
  const codeNodeIds = new Set(codeNodes.map((n) => n.id));

  // Build adjacency info (only for code nodes)
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of codeNodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!codeNodeIds.has(edge.source) || !codeNodeIds.has(edge.target))
      continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)!.push(edge.target);
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Add any nodes not reached by topological sort (isolated nodes or cycles)
  for (const node of codeNodes) {
    if (!topoOrder.includes(node.id)) {
      topoOrder.push(node.id);
    }
  }

  // Build tour steps
  const steps: TourStep[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (layers.length > 0) {
    // Group by layer in topological order
    const nodeToLayer = new Map<string, string>();
    for (const layer of layers) {
      for (const nodeId of layer.nodeIds) {
        nodeToLayer.set(nodeId, layer.id);
      }
    }

    // Determine layer order from topological sort
    const layerOrder: string[] = [];
    const layerNodes = new Map<string, string[]>();

    for (const nodeId of topoOrder) {
      const layerId = nodeToLayer.get(nodeId);
      if (layerId) {
        if (!layerNodes.has(layerId)) {
          layerNodes.set(layerId, []);
          layerOrder.push(layerId);
        }
        layerNodes.get(layerId)!.push(nodeId);
      }
    }

    // Create steps for each layer
    const layerMap = new Map(layers.map((l) => [l.id, l]));
    for (const layerId of layerOrder) {
      const layer = layerMap.get(layerId);
      const nodeIds = layerNodes.get(layerId) ?? [];
      if (layer && nodeIds.length > 0) {
        const nodeSummaries = nodeIds
          .map((id) => nodeMap.get(id)?.name)
          .filter(Boolean)
          .join(", ");
        steps.push({
          order: 0, // assigned later
          title: layer.name,
          description: `${layer.description}. Key files: ${nodeSummaries}.`,
          nodeIds,
        });
      }
    }

    // Add unlayered code nodes as "Supporting Components"
    const layeredNodeIds = new Set(
      layers.flatMap((l) => l.nodeIds),
    );
    const unlayeredNodes = topoOrder.filter(
      (id) => !layeredNodeIds.has(id),
    );
    if (unlayeredNodes.length > 0) {
      const nodeSummaries = unlayeredNodes
        .map((id) => nodeMap.get(id)?.name)
        .filter(Boolean)
        .join(", ");
      steps.push({
        order: 0,
        title: "Supporting Components",
        description: `Additional supporting files: ${nodeSummaries}.`,
        nodeIds: unlayeredNodes,
      });
    }
  } else {
    // No layers: batch by 3 nodes per step
    for (let i = 0; i < topoOrder.length; i += 3) {
      const batch = topoOrder.slice(i, i + 3);
      const nodeSummaries = batch
        .map((id) => {
          const node = nodeMap.get(id);
          return node ? `${node.name} (${node.summary})` : id;
        })
        .join("; ");
      const stepNumber = Math.floor(i / 3) + 1;
      steps.push({
        order: 0, // assigned later
        title: `Step ${stepNumber}: Code Walkthrough`,
        description: `Exploring: ${nodeSummaries}.`,
        nodeIds: batch,
      });
    }
  }

  // Add concept nodes as final step if any exist
  if (conceptNodes.length > 0) {
    const conceptSummaries = conceptNodes
      .map((n) => `${n.name} (${n.summary})`)
      .join("; ");
    steps.push({
      order: 0,
      title: "Key Concepts",
      description: `Important architectural concepts: ${conceptSummaries}.`,
      nodeIds: conceptNodes.map((n) => n.id),
    });
  }

  // Assign sequential order numbers
  for (let i = 0; i < steps.length; i++) {
    steps[i].order = i + 1;
  }

  return steps;
}
