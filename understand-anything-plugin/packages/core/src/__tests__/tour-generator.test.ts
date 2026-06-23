import { describe, it, expect } from "vitest";
import {
  buildTourGenerationPrompt,
  parseTourGenerationResponse,
  generateHeuristicTour,
} from "../analyzer/tour-generator.js";
import type { KnowledgeGraph } from "../types.js";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    description: "A test project",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Application entry point", tags: ["entry", "server"], complexity: "simple" },
    { id: "file:src/routes.ts", type: "file", name: "routes.ts", filePath: "src/routes.ts", summary: "Route definitions", tags: ["routes", "api"], complexity: "moderate" },
    { id: "file:src/service.ts", type: "file", name: "service.ts", filePath: "src/service.ts", summary: "Business logic", tags: ["service"], complexity: "complex" },
    { id: "file:src/db.ts", type: "file", name: "db.ts", filePath: "src/db.ts", summary: "Database connection", tags: ["database"], complexity: "simple" },
    { id: "concept:auth-flow", type: "concept", name: "Auth Flow", summary: "Authentication concept", tags: ["concept", "auth"], complexity: "moderate" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "file:src/routes.ts", type: "imports", direction: "forward", weight: 0.9 },
    { source: "file:src/routes.ts", target: "file:src/service.ts", type: "calls", direction: "forward", weight: 0.8 },
    { source: "file:src/service.ts", target: "file:src/db.ts", type: "reads_from", direction: "forward", weight: 0.7 },
  ],
  layers: [
    { id: "layer:api", name: "API Layer", description: "HTTP routes", nodeIds: ["file:src/index.ts", "file:src/routes.ts"] },
    { id: "layer:service", name: "Service Layer", description: "Business logic", nodeIds: ["file:src/service.ts"] },
    { id: "layer:data", name: "Data Layer", description: "Database", nodeIds: ["file:src/db.ts"] },
  ],
  tour: [],
};

describe("tour-generator", () => {
  describe("buildTourGenerationPrompt", () => {
    it("includes project name and description", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("test-project");
      expect(prompt).toContain("A test project");
    });

    it("includes all node summaries", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("Application entry point");
      expect(prompt).toContain("Route definitions");
      expect(prompt).toContain("Business logic");
      expect(prompt).toContain("Database connection");
      expect(prompt).toContain("Authentication concept");
    });

    it("includes layer information", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("API Layer");
      expect(prompt).toContain("Service Layer");
      expect(prompt).toContain("Data Layer");
    });

    it("requests JSON output format", () => {
      const prompt = buildTourGenerationPrompt(sampleGraph);
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("steps");
    });
  });

  describe("parseTourGenerationResponse", () => {
    it("parses valid JSON response with tour steps", () => {
      const response = JSON.stringify({
        steps: [
          {
            order: 1,
            title: "Entry Point",
            description: "Start here",
            nodeIds: ["file:src/index.ts"],
          },
          {
            order: 2,
            title: "Routes",
            description: "API routes",
            nodeIds: ["file:src/routes.ts"],
          },
        ],
      });
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(2);
      expect(steps[0].order).toBe(1);
      expect(steps[0].title).toBe("Entry Point");
      expect(steps[0].nodeIds).toEqual(["file:src/index.ts"]);
      expect(steps[1].order).toBe(2);
    });

    it("extracts JSON from markdown code blocks", () => {
      const response = `Here is the tour:
\`\`\`json
{
  "steps": [
    {
      "order": 1,
      "title": "Start",
      "description": "The beginning",
      "nodeIds": ["file:src/index.ts"]
    }
  ]
}
\`\`\``;
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe("Start");
    });

    it("returns empty array for unparseable response", () => {
      expect(parseTourGenerationResponse("not json at all")).toEqual([]);
      expect(parseTourGenerationResponse("")).toEqual([]);
      expect(parseTourGenerationResponse("random text here")).toEqual([]);
    });

    it("filters out steps with missing required fields", () => {
      const response = JSON.stringify({
        steps: [
          {
            order: 1,
            title: "Valid Step",
            description: "Has everything",
            nodeIds: ["file:src/index.ts"],
          },
          {
            order: 2,
            // missing title
            description: "Missing title",
            nodeIds: ["file:src/routes.ts"],
          },
          {
            order: 3,
            title: "Missing description",
            // missing description
            nodeIds: ["file:src/routes.ts"],
          },
          {
            order: 4,
            title: "Missing nodeIds",
            description: "No nodes",
            // missing nodeIds
          },
          {
            // missing order
            title: "Missing order",
            description: "No order",
            nodeIds: ["file:src/db.ts"],
          },
        ],
      });
      const steps = parseTourGenerationResponse(response);
      expect(steps).toHaveLength(1);
      expect(steps[0].title).toBe("Valid Step");
    });
  });

  describe("generateHeuristicTour", () => {
    it("starts with entry-point nodes", () => {
      const tour = generateHeuristicTour(sampleGraph);
      // Entry point node (0 incoming edges) is file:src/index.ts
      // It should appear in the first step's nodeIds
      const firstStepNodeIds = tour[0].nodeIds;
      expect(firstStepNodeIds).toContain("file:src/index.ts");
    });

    it("follows topological order", () => {
      const tour = generateHeuristicTour(sampleGraph);
      // Collect all code node IDs in order across steps (excluding concept steps)
      const codeSteps = tour.filter(
        (s) => !s.title.toLowerCase().includes("concept"),
      );
      const orderedNodeIds = codeSteps.flatMap((s) => s.nodeIds);

      // index.ts must appear before routes.ts
      const indexPos = orderedNodeIds.indexOf("file:src/index.ts");
      const routesPos = orderedNodeIds.indexOf("file:src/routes.ts");
      const servicePos = orderedNodeIds.indexOf("file:src/service.ts");
      const dbPos = orderedNodeIds.indexOf("file:src/db.ts");

      expect(indexPos).toBeLessThan(routesPos);
      expect(routesPos).toBeLessThan(servicePos);
      expect(servicePos).toBeLessThan(dbPos);
    });

    it("includes concept nodes in separate steps", () => {
      const tour = generateHeuristicTour(sampleGraph);
      // There should be a step containing the concept node
      const conceptStep = tour.find((s) =>
        s.nodeIds.includes("concept:auth-flow"),
      );
      expect(conceptStep).toBeDefined();
      // Concept step should not contain file nodes
      const fileNodeIds = sampleGraph.nodes
        .filter((n) => n.type === "file")
        .map((n) => n.id);
      for (const fileId of fileNodeIds) {
        expect(conceptStep!.nodeIds).not.toContain(fileId);
      }
    });

    it("assigns order numbers sequentially", () => {
      const tour = generateHeuristicTour(sampleGraph);
      for (let i = 0; i < tour.length; i++) {
        expect(tour[i].order).toBe(i + 1);
      }
    });

    it("groups nodes by layer when layers exist", () => {
      const tour = generateHeuristicTour(sampleGraph);
      // With layers, steps should reference layer names
      const stepTitles = tour.map((s) => s.title);
      // Should have steps that reference the layer names
      const hasApiLayer = stepTitles.some((t) => t.includes("API Layer"));
      const hasServiceLayer = stepTitles.some((t) => t.includes("Service Layer"));
      const hasDataLayer = stepTitles.some((t) => t.includes("Data Layer"));
      expect(hasApiLayer).toBe(true);
      expect(hasServiceLayer).toBe(true);
      expect(hasDataLayer).toBe(true);
    });

    it("produces valid TourStep objects", () => {
      const tour = generateHeuristicTour(sampleGraph);
      for (const step of tour) {
        expect(typeof step.order).toBe("number");
        expect(typeof step.title).toBe("string");
        expect(step.title.length).toBeGreaterThan(0);
        expect(typeof step.description).toBe("string");
        expect(step.description.length).toBeGreaterThan(0);
        expect(Array.isArray(step.nodeIds)).toBe(true);
        expect(step.nodeIds.length).toBeGreaterThan(0);
      }
    });

    it("handles graph with no edges gracefully", () => {
      const noEdgesGraph: KnowledgeGraph = {
        ...sampleGraph,
        edges: [],
        layers: [],
      };
      const tour = generateHeuristicTour(noEdgesGraph);
      expect(tour.length).toBeGreaterThan(0);
      // All code nodes should still appear somewhere
      const allNodeIds = tour.flatMap((s) => s.nodeIds);
      for (const node of noEdgesGraph.nodes) {
        expect(allNodeIds).toContain(node.id);
      }
    });

    it("handles graph with no layers", () => {
      const noLayersGraph: KnowledgeGraph = {
        ...sampleGraph,
        layers: [],
      };
      const tour = generateHeuristicTour(noLayersGraph);
      expect(tour.length).toBeGreaterThan(0);
      // Should batch code nodes (3 per step) instead of grouping by layer
      const codeSteps = tour.filter(
        (s) => !s.title.toLowerCase().includes("concept"),
      );
      // With 4 code nodes and batches of 3, expect 2 code steps
      expect(codeSteps.length).toBe(2);
    });
  });
});
