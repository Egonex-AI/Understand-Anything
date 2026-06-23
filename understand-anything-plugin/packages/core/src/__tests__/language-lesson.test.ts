import { describe, it, expect } from "vitest";
import {
  buildLanguageLessonPrompt,
  parseLanguageLessonResponse,
  detectLanguageConcepts,
} from "../analyzer/language-lesson.js";
import type { GraphNode, GraphEdge } from "../types.js";
import { typescriptConfig } from "../languages/configs/typescript.js";

const sampleNode: GraphNode = {
  id: "function:auth:verifyToken",
  type: "function",
  name: "verifyToken",
  filePath: "src/auth/verify.ts",
  lineRange: [10, 35],
  summary: "Verifies JWT tokens and extracts user payload using async/await",
  tags: ["auth", "jwt", "async"],
  complexity: "moderate",
};

const sampleEdges: GraphEdge[] = [
  {
    source: "function:auth:verifyToken",
    target: "file:src/config.ts",
    type: "reads_from",
    direction: "forward",
    weight: 0.6,
  },
  {
    source: "file:src/middleware.ts",
    target: "function:auth:verifyToken",
    type: "calls",
    direction: "forward",
    weight: 0.8,
  },
];

describe("language-lesson", () => {
  describe("buildLanguageLessonPrompt", () => {
    it("includes the node name and summary", () => {
      const prompt = buildLanguageLessonPrompt(
        sampleNode,
        sampleEdges,
        "typescript",
      );
      expect(prompt).toContain("verifyToken");
      expect(prompt).toContain("JWT tokens");
    });

    it("includes the target language", () => {
      const prompt = buildLanguageLessonPrompt(
        sampleNode,
        sampleEdges,
        "typescript",
        typescriptConfig,
      );
      expect(prompt).toContain("TypeScript");
    });

    it("includes relationship context", () => {
      const prompt = buildLanguageLessonPrompt(
        sampleNode,
        sampleEdges,
        "typescript",
      );
      expect(prompt).toContain("reads_from");
    });

    it("requests JSON output", () => {
      const prompt = buildLanguageLessonPrompt(
        sampleNode,
        sampleEdges,
        "typescript",
      );
      expect(prompt).toContain("JSON");
    });
  });

  describe("parseLanguageLessonResponse", () => {
    it("parses a valid response", () => {
      const response = JSON.stringify({
        languageNotes:
          "Uses async/await for non-blocking token verification.",
        concepts: [
          {
            name: "async/await",
            explanation:
              "The function uses async/await to handle asynchronous JWT verification.",
          },
        ],
      });
      const result = parseLanguageLessonResponse(response);
      expect(result.languageNotes).toBe(
        "Uses async/await for non-blocking token verification.",
      );
      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].name).toBe("async/await");
      expect(result.concepts[0].explanation).toContain("async/await");
    });

    it("extracts JSON from code blocks", () => {
      const response = `Here is the analysis:
\`\`\`json
{
  "languageNotes": "TypeScript generics used here.",
  "concepts": [
    { "name": "generics", "explanation": "Type parameters enable reuse." }
  ]
}
\`\`\``;
      const result = parseLanguageLessonResponse(response);
      expect(result.languageNotes).toBe("TypeScript generics used here.");
      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].name).toBe("generics");
    });

    it("returns empty result for invalid response", () => {
      const result = parseLanguageLessonResponse("");
      expect(result).toEqual({ languageNotes: "", concepts: [] });
    });
  });

  describe("detectLanguageConcepts", () => {
    it("detects async patterns from tags", () => {
      const concepts = detectLanguageConcepts(sampleNode, "typescript");
      expect(concepts).toContain("async/await");
    });

    it("detects middleware pattern", () => {
      const middlewareNode: GraphNode = {
        id: "function:middleware:auth",
        type: "function",
        name: "authMiddleware",
        filePath: "src/middleware/auth.ts",
        summary: "Express middleware for authentication",
        tags: ["middleware", "auth"],
        complexity: "moderate",
      };
      const concepts = detectLanguageConcepts(middlewareNode, "typescript");
      expect(concepts).toContain("middleware pattern");
    });

    it("returns empty for nodes with no detectable concepts", () => {
      const plainNode: GraphNode = {
        id: "file:src/config.ts",
        type: "file",
        name: "config.ts",
        filePath: "src/config.ts",
        summary: "Exports configuration values from environment variables",
        tags: ["config"],
        complexity: "simple",
      };
      const concepts = detectLanguageConcepts(plainNode, "typescript");
      expect(concepts).toEqual([]);
    });
  });
});
