import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo, EndpointInfo } from "../../types.js";

/**
 * Parses GraphQL schema files to extract type, input, enum, interface, union, and scalar definitions.
 * Extracts Query, Mutation, and Subscription endpoints as separate endpoint entries.
 * Does not handle schema directives, fragments, or inline union members.
 */
export class GraphQLParser implements AnalyzerPlugin {
  name = "graphql-parser";
  languages = ["graphql"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const definitions = this.extractDefinitions(content);
    const endpoints = this.extractEndpoints(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      definitions,
      endpoints,
    };
  }

  private extractDefinitions(content: string): DefinitionInfo[] {
    const definitions: DefinitionInfo[] = [];

    // Match type, input, enum, interface, union, scalar definitions
    const typeRegex = /^(type|input|enum|interface|union|scalar)\s+(\w+)/gm;
    let match;
    while ((match = typeRegex.exec(content)) !== null) {
      const kind = match[1];
      const name = match[2];
      if (name === "Query" || name === "Mutation" || name === "Subscription") continue;
      const startLine = content.slice(0, match.index).split("\n").length;

      // Extract fields (for type/input/interface/enum)
      const fields = this.extractFields(content, match.index);

      // Find closing brace
      const afterMatch = content.slice(match.index);
      const closeBrace = afterMatch.indexOf("}");
      const endLine = closeBrace !== -1
        ? content.slice(0, match.index + closeBrace + 1).split("\n").length
        : startLine;

      definitions.push({
        name,
        kind,
        lineRange: [startLine, endLine],
        fields,
      });
    }

    return definitions;
  }

  private extractEndpoints(content: string): EndpointInfo[] {
    const endpoints: EndpointInfo[] = [];

    // Find Query, Mutation, Subscription blocks and extract their fields
    const blockRegex = /^(type)\s+(Query|Mutation|Subscription)\s*\{/gm;
    let match;
    while ((match = blockRegex.exec(content)) !== null) {
      const method = match[2]; // Query, Mutation, Subscription
      const startIdx = match.index + match[0].length;

      // Find closing brace
      let depth = 1;
      let i = startIdx;
      while (i < content.length && depth > 0) {
        if (content[i] === "{") depth++;
        if (content[i] === "}") depth--;
        i++;
      }

      const blockContent = content.slice(startIdx, i - 1);
      const blockLines = blockContent.split("\n");
      const blockStartLine = content.slice(0, startIdx).split("\n").length;

      for (let j = 0; j < blockLines.length; j++) {
        const fieldMatch = blockLines[j].trim().match(/^(\w+)/);
        if (fieldMatch && fieldMatch[1]) {
          const lineNum = blockStartLine + j;
          endpoints.push({
            method,
            path: fieldMatch[1],
            lineRange: [lineNum, lineNum],
          });
        }
      }
    }

    return endpoints;
  }

  private extractFields(content: string, startIdx: number): string[] {
    const fields: string[] = [];
    const afterType = content.slice(startIdx);
    const openBrace = afterType.indexOf("{");
    if (openBrace === -1) return fields;

    let depth = 1;
    let i = openBrace + 1;
    while (i < afterType.length && depth > 0) {
      if (afterType[i] === "{") depth++;
      if (afterType[i] === "}") depth--;
      i++;
    }

    const body = afterType.slice(openBrace + 1, i - 1);
    const lines = body.split("\n");
    for (const line of lines) {
      const fieldMatch = line.trim().match(/^(\w+)/);
      if (fieldMatch) {
        fields.push(fieldMatch[1]);
      }
    }

    return fields;
  }
}
