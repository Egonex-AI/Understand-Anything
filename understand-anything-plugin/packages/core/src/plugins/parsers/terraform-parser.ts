import type { AnalyzerPlugin, StructuralAnalysis, ResourceInfo, DefinitionInfo } from "../../types.js";

/**
 * Parses Terraform (.tf) files to extract resource, data, module, variable, and output blocks.
 * Handles HCL block syntax with brace-matching for line range computation.
 * Does not handle provider blocks, locals, or terraform configuration blocks.
 */
export class TerraformParser implements AnalyzerPlugin {
  name = "terraform-parser";
  languages = ["terraform"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const resources = this.extractResources(content);
    const definitions = this.extractVariablesAndOutputs(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      resources,
      definitions,
    };
  }

  private extractResources(content: string): ResourceInfo[] {
    const resources: ResourceInfo[] = [];

    // Match resource blocks: resource "type" "name" {
    const resourceRegex = /^resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/gm;
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const afterMatch = content.slice(match.index);
      const closeBrace = this.findClosingBrace(afterMatch);
      const endLine = content.slice(0, match.index + closeBrace + 1).split("\n").length;

      resources.push({
        name: `${match[1]}.${match[2]}`,
        kind: match[1],
        lineRange: [startLine, endLine],
      });
    }

    // Match data blocks: data "type" "name" {
    const dataRegex = /^data\s+"([^"]+)"\s+"([^"]+)"\s*\{/gm;
    while ((match = dataRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const afterMatch = content.slice(match.index);
      const closeBrace = this.findClosingBrace(afterMatch);
      const endLine = content.slice(0, match.index + closeBrace + 1).split("\n").length;

      resources.push({
        name: `data.${match[1]}.${match[2]}`,
        kind: `data.${match[1]}`,
        lineRange: [startLine, endLine],
      });
    }

    // Match module blocks: module "name" {
    const moduleRegex = /^module\s+"([^"]+)"\s*\{/gm;
    while ((match = moduleRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const afterMatch = content.slice(match.index);
      const closeBrace = this.findClosingBrace(afterMatch);
      const endLine = content.slice(0, match.index + closeBrace + 1).split("\n").length;

      resources.push({
        name: `module.${match[1]}`,
        kind: "module",
        lineRange: [startLine, endLine],
      });
    }

    return resources;
  }

  private extractVariablesAndOutputs(content: string): DefinitionInfo[] {
    const definitions: DefinitionInfo[] = [];

    // Match variable blocks
    const varRegex = /^variable\s+"([^"]+)"\s*\{/gm;
    let match;
    while ((match = varRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const afterMatch = content.slice(match.index);
      const closeBrace = this.findClosingBrace(afterMatch);
      const endLine = content.slice(0, match.index + closeBrace + 1).split("\n").length;

      definitions.push({
        name: match[1],
        kind: "variable",
        lineRange: [startLine, endLine],
        fields: [],
      });
    }

    // Match output blocks
    const outputRegex = /^output\s+"([^"]+)"\s*\{/gm;
    while ((match = outputRegex.exec(content)) !== null) {
      const startLine = content.slice(0, match.index).split("\n").length;
      const afterMatch = content.slice(match.index);
      const closeBrace = this.findClosingBrace(afterMatch);
      const endLine = content.slice(0, match.index + closeBrace + 1).split("\n").length;

      definitions.push({
        name: match[1],
        kind: "output",
        lineRange: [startLine, endLine],
        fields: [],
      });
    }

    return definitions;
  }

  private findClosingBrace(content: string): number {
    let depth = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "{") depth++;
      if (content[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    if (depth !== 0) {
      console.warn(`[terraform-parser] Unbalanced braces detected (depth=${depth}), results may be incomplete`);
    }
    return content.length;
  }
}
