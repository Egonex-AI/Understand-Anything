import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo } from "../../types.js";

/**
 * Parses .env files to extract environment variable definitions.
 * Handles KEY=value syntax, skipping comments and empty lines.
 * Does not handle `export VAR=value` syntax or multi-line values.
 */
export class EnvParser implements AnalyzerPlugin {
  name = "env-parser";
  languages = ["env"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const definitions = this.extractVariables(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      definitions,
    };
  }

  private extractVariables(content: string): DefinitionInfo[] {
    const definitions: DefinitionInfo[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#") || line === "") continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      if (match) {
        definitions.push({
          name: match[1],
          kind: "variable",
          lineRange: [i + 1, i + 1],
          fields: [],
        });
      }
    }
    return definitions;
  }
}
