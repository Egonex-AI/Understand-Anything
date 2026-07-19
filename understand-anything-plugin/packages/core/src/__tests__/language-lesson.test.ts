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

    it.each([
      "This function adds two numbers",
      "Persists data to disk",
      "Renders a list of items",
    ])(
      "does not flag type guards from the 'is' substring in common prose: %s",
      (summary) => {
        const plainNode: GraphNode = {
          id: "function:misc:fn",
          type: "function",
          name: "fn",
          filePath: "src/misc/fn.ts",
          summary,
          tags: ["utility"],
          complexity: "simple",
        };
        const concepts = detectLanguageConcepts(plainNode, "typescript");
        expect(concepts).not.toContain("type guards");
      },
    );

    it("still detects type guards when the summary genuinely describes one", () => {
      const guardNode: GraphNode = {
        id: "function:guards:isUser",
        type: "function",
        name: "isUser",
        filePath: "src/guards/isUser.ts",
        summary: "Type guard that narrows the value to a User",
        tags: ["validation"],
        complexity: "simple",
      };
      const concepts = detectLanguageConcepts(guardNode, "typescript");
      expect(concepts).toContain("type guards");
    });

    it("detects decorators from a specific keyword, not from '@' in prose", () => {
      // '@' was removed from the decorators pattern because it matched any
      // JSDoc `@param`/`@returns` fragment or email in a summary.
      const jsdocNode: GraphNode = {
        id: "function:util:format",
        type: "function",
        name: "format",
        filePath: "src/util/format.ts",
        summary: "Formats a value. @param input the raw value @returns text",
        tags: ["utility"],
        complexity: "simple",
      };
      expect(
        detectLanguageConcepts(jsdocNode, "typescript"),
      ).not.toContain("decorators");

      const decoratorNode: GraphNode = {
        id: "class:http:controller",
        type: "class",
        name: "Controller",
        filePath: "src/http/controller.ts",
        summary: "Uses a decorator to register the route handler",
        tags: ["http"],
        complexity: "moderate",
      };
      expect(
        detectLanguageConcepts(decoratorNode, "typescript"),
      ).toContain("decorators");
    });

    it("detects dependency injection from a specific keyword, not from 'di' in prose", () => {
      // 'di' was removed because it matched "audio", "edit", "directory",
      // "modifies", "loading", "reading", etc.
      const diSubstringNode: GraphNode = {
        id: "function:fs:readDirectory",
        type: "function",
        name: "readDirectory",
        filePath: "src/fs/readDirectory.ts",
        summary: "Reads and modifies a directory while loading audio files",
        tags: ["fs"],
        complexity: "simple",
      };
      expect(
        detectLanguageConcepts(diSubstringNode, "typescript"),
      ).not.toContain("dependency injection");

      const diNode: GraphNode = {
        id: "class:di:service",
        type: "class",
        name: "Service",
        filePath: "src/di/service.ts",
        summary: "Resolves dependencies from the injection container",
        tags: ["inject"],
        complexity: "moderate",
      };
      expect(
        detectLanguageConcepts(diNode, "typescript"),
      ).toContain("dependency injection");
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
