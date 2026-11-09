import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo } from "../../types.js";

/**
 * Parses .env files to extract environment variable definitions.
 * Handles KEY=value syntax with an optional `export` prefix and whitespace
 * around `=`, skipping comments and empty lines. A quoted value that spans
 * several lines extends the variable's line range, and the lines inside it
 * are not read as variables.
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
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) {
        const endIndex = this.findValueEnd(lines, i, match[2]);
        definitions.push({
          name: match[1],
          kind: "variable",
          lineRange: [i + 1, endIndex + 1],
          fields: [],
        });
        i = endIndex;
      }
    }
    return definitions;
  }

  /**
   * Returns the index of the line where the value starting on line `start`
   * ends. Only a quoted value can continue past its first line; an unclosed
   * quote is treated as a single-line value rather than swallowing the file.
   */
  private findValueEnd(lines: string[], start: number, value: string): number {
    const quote = value[0];
    if (quote !== '"' && quote !== "'" && quote !== "`") return start;
    if (this.closingQuoteIndex(value, 1, quote) !== -1) return start;
    for (let j = start + 1; j < lines.length; j++) {
      if (this.closingQuoteIndex(lines[j], 0, quote) !== -1) return j;
    }
    return start;
  }

  /** Single quotes are literal; double quotes and backticks honor backslash escapes. */
  private closingQuoteIndex(text: string, from: number, quote: string): number {
    for (let k = from; k < text.length; k++) {
      if (text[k] === "\\" && quote !== "'") {
        k++;
        continue;
      }
      if (text[k] === quote) return k;
    }
    return -1;
  }
}
