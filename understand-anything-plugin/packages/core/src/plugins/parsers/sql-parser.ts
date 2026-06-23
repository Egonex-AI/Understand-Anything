import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo } from "../../types.js";

/**
 * Parses SQL files to extract table, view, and index definitions.
 * Handles CREATE TABLE, CREATE VIEW, CREATE INDEX with IF NOT EXISTS and OR REPLACE variants.
 * Does not handle stored procedures, triggers, or schema-qualified names (e.g., public.users).
 */
export class SQLParser implements AnalyzerPlugin {
  name = "sql-parser";
  languages = ["sql"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const definitions = this.extractDefinitions(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      definitions,
    };
  }

  private extractDefinitions(content: string): DefinitionInfo[] {
    const definitions: DefinitionInfo[] = [];

    // Match CREATE TABLE statements
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|")?(\w+)(?:`|")?/gi;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
      const tableName = match[1];
      const startLine = content.slice(0, match.index).split("\n").length;

      // Extract columns (simplified: look for column names in parenthesized block)
      const fields = this.extractColumns(content, match.index);

      // Find the end of the CREATE TABLE statement
      const afterMatch = content.slice(match.index);
      const endParen = afterMatch.indexOf(");");
      const endLine = endParen !== -1
        ? content.slice(0, match.index + endParen + 2).split("\n").length
        : startLine + 5;

      definitions.push({
        name: tableName,
        kind: "table",
        lineRange: [startLine, endLine],
        fields,
      });
    }

    // Match CREATE VIEW
    const viewRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:`|")?(\w+)(?:`|")?/gi;
    while ((match = viewRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      definitions.push({
        name: match[1],
        kind: "view",
        lineRange: [startLine, startLine],
        fields: [],
      });
    }

    // Match CREATE INDEX
    const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|")?(\w+)(?:`|")?/gi;
    while ((match = indexRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      definitions.push({
        name: match[1],
        kind: "index",
        lineRange: [startLine, startLine],
        fields: [],
      });
    }

    return definitions;
  }

  private extractColumns(content: string, startIdx: number): string[] {
    const fields: string[] = [];
    const afterCreate = content.slice(startIdx);
    const openParen = afterCreate.indexOf("(");
    if (openParen === -1) return fields;

    const closeParen = afterCreate.indexOf(");", openParen);
    if (closeParen === -1) return fields;

    const body = afterCreate.slice(openParen + 1, closeParen);
    const lines = body.split(",");

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip constraints
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)/i.test(trimmed)) continue;
      const colMatch = trimmed.match(/^(?:`|")?(\w+)(?:`|")?\s+/);
      if (colMatch) {
        fields.push(colMatch[1]);
      }
    }

    return fields;
  }
}
