import type { AnalyzerPlugin, StructuralAnalysis, ReferenceResolution } from "../../types.js";

/**
 * Parses shell scripts (.sh, .bash) to extract function definitions and source references.
 * Handles both `name() {` and `function name {` styles, including brace on next line.
 * Does not extract variable declarations, aliases, or trap handlers.
 */
export class ShellParser implements AnalyzerPlugin {
  name = "shell-parser";
  // `jenkinsfile` is Groovy-flavored DSL; the function-style syntax is similar
  // enough that this parser at least picks up step blocks.
  languages = ["shell", "jenkinsfile"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const functions = this.extractFunctions(content);
    return {
      functions,
      classes: [],
      imports: [],
      exports: [],
    };
  }

  extractReferences(filePath: string, content: string): ReferenceResolution[] {
    const refs: ReferenceResolution[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Match source/. commands
      const sourceMatch = lines[i].match(/^\s*(?:source|\.)[ \t]+["']?([^"'\s]+)["']?/);
      if (sourceMatch) {
        refs.push({
          source: filePath,
          target: sourceMatch[1],
          referenceType: "file",
          line: i + 1,
        });
      }
    }
    return refs;
  }

  private extractFunctions(content: string): Array<{ name: string; lineRange: [number, number]; params: string[] }> {
    const functions: Array<{ name: string; lineRange: [number, number]; params: string[] }> = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      // Match function name() { or function name { — but require an opening
      // brace either on this line or the next non-blank line. Without that
      // guard, lines like `command_substitution_demo() echo hi` or stray
      // `name()` patterns inside heredocs / comments would be picked up.
      const match = lines[i].match(/^(?:function\s+)?(\w+)\s*\(\s*\)\s*\{?/) ||
                    lines[i].match(/^function\s+(\w+)\s*\{?/);
      if (!match) continue;
      const name = match[1];
      const hasBraceHere = lines[i].includes("{");
      let nextNonBlank = i + 1;
      while (nextNonBlank < lines.length && lines[nextNonBlank].trim() === "") {
        nextNonBlank++;
      }
      const hasBraceNext = nextNonBlank < lines.length && lines[nextNonBlank].trim().startsWith("{");
      if (!hasBraceHere && !hasBraceNext) continue;

      // Find closing brace
      const startBraceLine = hasBraceHere ? i : nextNonBlank;
      let depth = 0;
      let endLine = startBraceLine;
      for (let j = startBraceLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth === 0) {
          endLine = j;
          break;
        }
      }
      functions.push({
        name,
        lineRange: [i + 1, endLine + 1],
        params: [],
      });
    }

    return functions;
  }
}
