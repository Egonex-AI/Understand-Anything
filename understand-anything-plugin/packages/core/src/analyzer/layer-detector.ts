import type { KnowledgeGraph, Layer } from "../types.js";

/**
 * LLM layer response structure — what the LLM returns for each layer.
 */
export interface LLMLayerResponse {
  name: string;
  description: string;
  filePatterns: string[];
}

/**
 * Directory-pattern to layer-name mapping for heuristic detection.
 * Order matters: first match wins.
 */
const LAYER_PATTERNS: Array<{ patterns: string[]; layerName: string; description: string }> = [
  {
    patterns: ["routes", "controller", "handler", "endpoint", "api"],
    layerName: "API Layer",
    description: "HTTP endpoints, route handlers, and API controllers",
  },
  {
    patterns: ["service", "usecase", "use-case", "business"],
    layerName: "Service Layer",
    description: "Business logic and application services",
  },
  {
    patterns: ["model", "entity", "schema", "database", "db", "migration", "repository", "repo"],
    layerName: "Data Layer",
    description: "Data models, database access, and persistence",
  },
  {
    patterns: ["component", "view", "page", "screen", "layout", "widget", "ui"],
    layerName: "UI Layer",
    description: "User interface components and views",
  },
  {
    patterns: ["middleware", "interceptor", "guard", "filter", "pipe"],
    layerName: "Middleware Layer",
    description: "Request/response middleware and interceptors",
  },
  {
    patterns: ["client", "integration", "external", "sdk", "vendor", "adapter"],
    layerName: "External Services",
    description: "External service integrations, SDKs, and third-party adapters",
  },
  {
    patterns: ["worker", "job", "queue", "cron", "consumer", "processor", "scheduler", "background"],
    layerName: "Background Tasks",
    description: "Background workers, job processors, and scheduled tasks",
  },
  {
    patterns: ["util", "helper", "lib", "common", "shared"],
    layerName: "Utility Layer",
    description: "Shared utilities, helpers, and common libraries",
  },
  {
    patterns: ["test", "spec", "__test__", "__spec__", "__tests__", "__specs__"],
    layerName: "Test Layer",
    description: "Test files and test utilities",
  },
  {
    patterns: ["config", "setting", "env"],
    layerName: "Configuration Layer",
    description: "Application configuration and environment settings",
  },
];

/**
 * Convert a layer name to a kebab-case layer ID.
 */
function toLayerId(name: string): string {
  return `layer:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Determine which layer a file path belongs to based on directory patterns.
 * Returns the layer name or null if no pattern matches.
 */
function matchFileToLayer(filePath: string): string | null {
  // Normalize path separators and split into segments
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalizedPath.split("/");

  for (const { patterns, layerName } of LAYER_PATTERNS) {
    for (const segment of segments) {
      // Check if any directory segment matches a pattern (plural forms too)
      for (const pattern of patterns) {
        if (segment === pattern || segment === pattern + "s") {
          return layerName;
        }
      }
    }
  }

  return null;
}

/**
 * Heuristic layer detection — assigns file nodes to layers based on
 * directory path patterns. Unmatched files go to a "Core" layer.
 *
 * Only FILE-type nodes are assigned to layers.
 */
export function detectLayers(graph: KnowledgeGraph): Layer[] {
  const layerMap = new Map<string, string[]>(); // layerName -> nodeIds

  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    if (!node.filePath) continue;

    const layerName = matchFileToLayer(node.filePath) ?? "Core";
    const existing = layerMap.get(layerName) ?? [];
    existing.push(node.id);
    layerMap.set(layerName, existing);
  }

  // Also catch file nodes without filePath
  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    if (node.filePath) continue;

    const existing = layerMap.get("Core") ?? [];
    existing.push(node.id);
    layerMap.set("Core", existing);
  }

  const layers: Layer[] = [];
  for (const [name, nodeIds] of layerMap) {
    const description =
      name === "Core"
        ? "Core application files"
        : LAYER_PATTERNS.find((p) => p.layerName === name)?.description ?? "";

    layers.push({
      id: toLayerId(name),
      name,
      description,
      nodeIds,
    });
  }

  return layers;
}

/**
 * Builds an LLM prompt that asks the model to identify logical layers
 * from a list of file paths in the knowledge graph.
 */
export function buildLayerDetectionPrompt(graph: KnowledgeGraph): string {
  const filePaths = graph.nodes
    .filter((n) => n.type === "file" && n.filePath)
    .map((n) => n.filePath!);

  const fileListStr = filePaths.map((f) => `  - ${f}`).join("\n");

  return `You are a software architecture analyst. Given the following list of file paths from a codebase, identify the logical architectural layers.

File paths:
${fileListStr}

Return a JSON array of 3-7 layers. Each layer object must have:
- "name": A short layer name (e.g., "API", "Data", "UI")
- "description": What this layer is responsible for (1 sentence)
- "filePatterns": An array of path prefixes that belong to this layer (e.g., ["src/routes/", "src/controllers/"])

Every file should belong to exactly one layer. Use the most specific pattern possible.

Respond ONLY with the JSON array, no additional text.`;
}

/**
 * Parses an LLM response for layer detection.
 * Handles markdown code fences and raw JSON.
 * Returns the parsed array or null on failure.
 */
export function parseLayerDetectionResponse(
  response: string,
): LLMLayerResponse[] | null {
  if (!response || response.trim().length === 0) {
    return null;
  }

  try {
    // Try to extract from markdown code fences
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : response.trim();

    // Try to find a JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      return null;
    }

    const parsed = JSON.parse(arrayMatch[0]);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    // Validate and normalize each layer entry
    const layers: LLMLayerResponse[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      if (typeof item.name !== "string") continue;

      layers.push({
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
        filePatterns: Array.isArray(item.filePatterns)
          ? item.filePatterns.filter((p: unknown) => typeof p === "string")
          : [],
      });
    }

    return layers.length > 0 ? layers : null;
  } catch {
    return null;
  }
}

/**
 * Applies LLM-provided layer definitions to a knowledge graph.
 * Matches file nodes against LLM filePatterns (path prefix matching).
 * Unassigned file nodes go to an "Other" layer.
 */
export function applyLLMLayers(
  graph: KnowledgeGraph,
  llmLayers: LLMLayerResponse[],
): Layer[] {
  const layerMap = new Map<string, string[]>(); // layerName -> nodeIds

  // Initialize all LLM layers
  for (const llmLayer of llmLayers) {
    layerMap.set(llmLayer.name, []);
  }

  for (const node of graph.nodes) {
    if (node.type !== "file") continue;

    if (!node.filePath) {
      const other = layerMap.get("Other") ?? [];
      other.push(node.id);
      layerMap.set("Other", other);
      continue;
    }

    const normalizedPath = node.filePath.replace(/\\/g, "/");
    let assigned = false;

    for (const llmLayer of llmLayers) {
      for (const pattern of llmLayer.filePatterns) {
        if (normalizedPath.startsWith(pattern) || normalizedPath.includes("/" + pattern)) {
          const existing = layerMap.get(llmLayer.name)!;
          existing.push(node.id);
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }

    if (!assigned) {
      const other = layerMap.get("Other") ?? [];
      other.push(node.id);
      layerMap.set("Other", other);
    }
  }

  const layers: Layer[] = [];
  for (const [name, nodeIds] of layerMap) {
    if (nodeIds.length === 0) continue; // Skip empty layers

    const llmLayer = llmLayers.find((l) => l.name === name);
    layers.push({
      id: toLayerId(name),
      name,
      description: llmLayer?.description ?? "Uncategorized files",
      nodeIds,
    });
  }

  return layers;
}
