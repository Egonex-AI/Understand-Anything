import { describe, it, expect } from "vitest";
import {
  detectLayers,
  buildLayerDetectionPrompt,
  parseLayerDetectionResponse,
  applyLLMLayers,
} from "../analyzer/layer-detector.js";
import type { KnowledgeGraph, GraphNode } from "../types.js";

const makeNode = (
  overrides: Partial<GraphNode> & { id: string; name: string },
): GraphNode => ({
  type: "file",
  summary: "",
  tags: [],
  complexity: "simple",
  ...overrides,
});

const makeGraph = (nodes: GraphNode[]): KnowledgeGraph => ({
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: [],
    description: "A test project",
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "abc123",
  },
  nodes,
  edges: [],
  layers: [],
  tour: [],
});

describe("detectLayers", () => {
  it("detects API/routes layer from file paths", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "users.ts", filePath: "src/routes/users.ts" }),
      makeNode({ id: "f2", name: "auth.ts", filePath: "src/controllers/auth.ts" }),
      makeNode({ id: "f3", name: "health.ts", filePath: "src/api/health.ts" }),
    ]);
    const layers = detectLayers(graph);
    const apiLayer = layers.find((l) => l.name === "API Layer");
    expect(apiLayer).toBeDefined();
    expect(apiLayer!.nodeIds).toContain("f1");
    expect(apiLayer!.nodeIds).toContain("f2");
    expect(apiLayer!.nodeIds).toContain("f3");
  });

  it("detects Data layer from model/entity/repository paths", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "User.ts", filePath: "src/models/User.ts" }),
      makeNode({ id: "f2", name: "Post.ts", filePath: "src/entity/Post.ts" }),
      makeNode({ id: "f3", name: "UserRepo.ts", filePath: "src/repository/UserRepo.ts" }),
    ]);
    const layers = detectLayers(graph);
    const dataLayer = layers.find((l) => l.name === "Data Layer");
    expect(dataLayer).toBeDefined();
    expect(dataLayer!.nodeIds).toContain("f1");
    expect(dataLayer!.nodeIds).toContain("f2");
    expect(dataLayer!.nodeIds).toContain("f3");
  });

  it("puts unmatched file nodes in Core layer", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "main.ts", filePath: "src/main.ts" }),
      makeNode({ id: "f2", name: "app.ts", filePath: "src/app.ts" }),
    ]);
    const layers = detectLayers(graph);
    const coreLayer = layers.find((l) => l.name === "Core");
    expect(coreLayer).toBeDefined();
    expect(coreLayer!.nodeIds).toContain("f1");
    expect(coreLayer!.nodeIds).toContain("f2");
  });

  it("assigns unique kebab-case IDs to each layer", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "users.ts", filePath: "src/routes/users.ts" }),
      makeNode({ id: "f2", name: "User.ts", filePath: "src/models/User.ts" }),
      makeNode({ id: "f3", name: "main.ts", filePath: "src/main.ts" }),
    ]);
    const layers = detectLayers(graph);
    const ids = layers.map((l) => l.id);

    // All IDs should start with "layer:"
    for (const id of ids) {
      expect(id).toMatch(/^layer:/);
    }

    // All IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only assigns file-type nodes, ignoring functions and classes", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "users.ts", type: "file", filePath: "src/routes/users.ts" }),
      makeNode({ id: "fn1", name: "getUser", type: "function", filePath: "src/routes/users.ts" }),
      makeNode({ id: "c1", name: "UserController", type: "class", filePath: "src/routes/users.ts" }),
    ]);
    const layers = detectLayers(graph);
    const allNodeIds = layers.flatMap((l) => l.nodeIds);
    expect(allNodeIds).toContain("f1");
    expect(allNodeIds).not.toContain("fn1");
    expect(allNodeIds).not.toContain("c1");
  });
});

describe("buildLayerDetectionPrompt", () => {
  it("contains file paths and mentions JSON in the prompt", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "index.ts", filePath: "src/index.ts" }),
      makeNode({ id: "f2", name: "app.ts", filePath: "src/app.ts" }),
    ]);
    const prompt = buildLayerDetectionPrompt(graph);
    expect(prompt).toContain("src/index.ts");
    expect(prompt).toContain("src/app.ts");
    expect(prompt).toContain("JSON");
  });
});

describe("parseLayerDetectionResponse", () => {
  it("parses a valid JSON response", () => {
    const response = JSON.stringify([
      {
        name: "API",
        description: "Handles HTTP requests",
        filePatterns: ["src/routes/", "src/controllers/"],
      },
      {
        name: "Data",
        description: "Database models and queries",
        filePatterns: ["src/models/"],
      },
    ]);
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].name).toBe("API");
    expect(result![0].filePatterns).toEqual(["src/routes/", "src/controllers/"]);
  });

  it("parses JSON wrapped in markdown fences", () => {
    const response = `Here are the layers:
\`\`\`json
[
  { "name": "UI", "description": "Frontend components", "filePatterns": ["src/components/"] }
]
\`\`\``;
    const result = parseLayerDetectionResponse(response);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].name).toBe("UI");
  });

  it("returns null for invalid/unparseable input", () => {
    expect(parseLayerDetectionResponse("not json at all")).toBeNull();
    expect(parseLayerDetectionResponse("{}")).toBeNull();
    expect(parseLayerDetectionResponse("")).toBeNull();
  });
});

describe("applyLLMLayers", () => {
  it("assigns file nodes to LLM-provided layers and puts unmatched in Other", () => {
    const graph = makeGraph([
      makeNode({ id: "f1", name: "users.ts", filePath: "src/routes/users.ts" }),
      makeNode({ id: "f2", name: "User.ts", filePath: "src/models/User.ts" }),
      makeNode({ id: "f3", name: "main.ts", filePath: "src/main.ts" }),
    ]);
    const llmLayers = [
      { name: "API", description: "HTTP endpoints", filePatterns: ["src/routes/"] },
      { name: "Data", description: "Models", filePatterns: ["src/models/"] },
    ];
    const layers = applyLLMLayers(graph, llmLayers);

    const apiLayer = layers.find((l) => l.name === "API");
    expect(apiLayer).toBeDefined();
    expect(apiLayer!.nodeIds).toContain("f1");

    const dataLayer = layers.find((l) => l.name === "Data");
    expect(dataLayer).toBeDefined();
    expect(dataLayer!.nodeIds).toContain("f2");

    const otherLayer = layers.find((l) => l.name === "Other");
    expect(otherLayer).toBeDefined();
    expect(otherLayer!.nodeIds).toContain("f3");
  });
});
