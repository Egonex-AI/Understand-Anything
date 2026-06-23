import { describe, it, expect } from "vitest";
import {
  buildFileAnalysisPrompt,
  buildProjectSummaryPrompt,
  parseFileAnalysisResponse,
  parseProjectSummaryResponse,
} from "./llm-analyzer.js";

describe("LLM Analyzer", () => {
  describe("buildFileAnalysisPrompt", () => {
    it("should include file path and content in the prompt", () => {
      const prompt = buildFileAnalysisPrompt(
        "src/utils.ts",
        "export function add(a: number, b: number) { return a + b; }",
        "A math utility library",
      );

      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("export function add");
      expect(prompt).toContain("A math utility library");
      expect(prompt).toContain("fileSummary");
      expect(prompt).toContain("JSON");
    });

    it("should include project context", () => {
      const prompt = buildFileAnalysisPrompt(
        "app.py",
        "print('hello')",
        "A Python web server",
      );

      expect(prompt).toContain("A Python web server");
    });
  });

  describe("parseFileAnalysisResponse", () => {
    it("should parse valid JSON response", () => {
      const response = JSON.stringify({
        fileSummary: "A utility module for string processing",
        tags: ["utility", "string"],
        complexity: "simple",
        functionSummaries: { capitalize: "Capitalizes the first letter" },
        classSummaries: {},
        languageNotes: "Uses ES2022 features",
      });

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("A utility module for string processing");
      expect(result!.tags).toEqual(["utility", "string"]);
      expect(result!.complexity).toBe("simple");
      expect(result!.functionSummaries).toEqual({
        capitalize: "Capitalizes the first letter",
      });
      expect(result!.classSummaries).toEqual({});
      expect(result!.languageNotes).toBe("Uses ES2022 features");
    });

    it("should handle markdown-wrapped JSON (```json ... ```)", () => {
      const response = `Here is the analysis:

\`\`\`json
{
  "fileSummary": "Database connection handler",
  "tags": ["database", "connection"],
  "complexity": "complex",
  "functionSummaries": { "connect": "Establishes DB connection" },
  "classSummaries": { "Pool": "Connection pool manager" }
}
\`\`\`

That's the analysis.`;

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("Database connection handler");
      expect(result!.tags).toEqual(["database", "connection"]);
      expect(result!.complexity).toBe("complex");
      expect(result!.functionSummaries.connect).toBe("Establishes DB connection");
      expect(result!.classSummaries.Pool).toBe("Connection pool manager");
    });

    it("should handle markdown fences without language tag", () => {
      const response = `\`\`\`
{
  "fileSummary": "Config loader",
  "tags": ["config"],
  "complexity": "simple",
  "functionSummaries": {},
  "classSummaries": {}
}
\`\`\``;

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("Config loader");
    });

    it("should return null for invalid JSON", () => {
      const result = parseFileAnalysisResponse("This is not JSON at all");
      expect(result).toBeNull();
    });

    it("should return null for completely empty response", () => {
      const result = parseFileAnalysisResponse("");
      expect(result).toBeNull();
    });

    it("should default complexity to 'moderate' for unknown values", () => {
      const response = JSON.stringify({
        fileSummary: "Some file",
        tags: [],
        complexity: "very-hard",
        functionSummaries: {},
        classSummaries: {},
      });

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.complexity).toBe("moderate");
    });

    it("should default complexity to 'moderate' when missing", () => {
      const response = JSON.stringify({
        fileSummary: "Some file",
        tags: [],
        functionSummaries: {},
        classSummaries: {},
      });

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.complexity).toBe("moderate");
    });

    it("should handle missing optional fields gracefully", () => {
      const response = JSON.stringify({
        fileSummary: "Minimal response",
      });

      const result = parseFileAnalysisResponse(response);

      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("Minimal response");
      expect(result!.tags).toEqual([]);
      expect(result!.complexity).toBe("moderate");
      expect(result!.functionSummaries).toEqual({});
      expect(result!.classSummaries).toEqual({});
      expect(result!.languageNotes).toBeUndefined();
    });
  });

  describe("buildProjectSummaryPrompt", () => {
    it("should include file list in the prompt", () => {
      const fileList = ["src/index.ts", "src/utils.ts", "package.json"];
      const prompt = buildProjectSummaryPrompt(fileList, []);

      expect(prompt).toContain("src/index.ts");
      expect(prompt).toContain("src/utils.ts");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("description");
      expect(prompt).toContain("frameworks");
      expect(prompt).toContain("layers");
    });

    it("should include sample file contents when provided", () => {
      const prompt = buildProjectSummaryPrompt(
        ["src/app.ts"],
        [{ path: "src/app.ts", content: "const app = express();" }],
      );

      expect(prompt).toContain("src/app.ts");
      expect(prompt).toContain("const app = express()");
    });
  });

  describe("parseProjectSummaryResponse", () => {
    it("should parse valid project summary response", () => {
      const response = JSON.stringify({
        description: "A REST API for managing tasks",
        frameworks: ["Express", "TypeScript", "Vitest"],
        layers: [
          {
            name: "API",
            description: "HTTP route handlers",
            filePatterns: ["src/routes/**"],
          },
          {
            name: "Data",
            description: "Database access layer",
            filePatterns: ["src/db/**", "src/models/**"],
          },
        ],
      });

      const result = parseProjectSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result!.description).toBe("A REST API for managing tasks");
      expect(result!.frameworks).toEqual(["Express", "TypeScript", "Vitest"]);
      expect(result!.layers).toHaveLength(2);
      expect(result!.layers[0]).toEqual({
        name: "API",
        description: "HTTP route handlers",
        filePatterns: ["src/routes/**"],
      });
    });

    it("should handle markdown-wrapped response", () => {
      const response = `\`\`\`json
{
  "description": "A CLI tool",
  "frameworks": ["Commander"],
  "layers": []
}
\`\`\``;

      const result = parseProjectSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result!.description).toBe("A CLI tool");
      expect(result!.frameworks).toEqual(["Commander"]);
    });

    it("should return null for invalid JSON", () => {
      const result = parseProjectSummaryResponse("Not valid JSON");
      expect(result).toBeNull();
    });

    it("should handle missing fields gracefully", () => {
      const response = JSON.stringify({
        description: "Some project",
      });

      const result = parseProjectSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result!.description).toBe("Some project");
      expect(result!.frameworks).toEqual([]);
      expect(result!.layers).toEqual([]);
    });
  });
});
