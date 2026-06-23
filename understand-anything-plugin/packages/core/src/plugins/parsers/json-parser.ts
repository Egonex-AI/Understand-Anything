import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo, ReferenceResolution } from "../../types.js";

/**
 * Strip JSONC syntax (line comments, block comments, trailing commas) so the
 * result can be passed to the standard `JSON.parse`. Preserves string contents
 * verbatim — comment-like sequences inside strings are not removed.
 *
 * Plain JSON passes through unchanged (no `//`, `/* *​/`, or trailing commas
 * to remove).
 */
export function stripJsoncSyntax(content: string): string {
  let out = "";
  let i = 0;
  const n = content.length;

  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];

    // String literal — copy verbatim, honoring escape sequences
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = content[i];
        out += c;
        if (c === "\\" && i + 1 < n) {
          out += content[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (c === '"') break;
      }
      continue;
    }

    // Line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && content[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(content[i] === "*" && content[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  // Remove trailing commas before } or ] (allowing whitespace between)
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Parses JSON / JSONC configuration files to extract top-level key sections and $ref references.
 * Handles package.json, tsconfig.json, wrangler.jsonc, JSON Schema, and OpenAPI spec files.
 * Does not descend into nested object structures beyond top-level keys.
 *
 * JSONC support: line comments (`// ...`), block comments (`/* ... *​/`), and
 * trailing commas are stripped before `JSON.parse`. Strings are preserved.
 */
export class JSONConfigParser implements AnalyzerPlugin {
  name = "json-config-parser";
  // Also handle JSON-flavored special formats so `openapi.json`,
  // `*.schema.json`, etc. don't fall through to the "no parser matched"
  // branch and lose all structural extraction.
  languages = ["json", "jsonc", "json-schema", "openapi"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const sections = this.extractSections(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      sections,
    };
  }

  extractReferences(filePath: string, content: string): ReferenceResolution[] {
    const refs: ReferenceResolution[] = [];
    // Match $ref values (JSON Schema / OpenAPI)
    const refRegex = /"\$ref"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = refRegex.exec(content)) !== null) {
      const target = match[1];
      if (target.startsWith("#")) continue; // Skip internal refs
      const line = content.slice(0, match.index).split("\n").length;
      refs.push({
        source: filePath,
        target,
        referenceType: "schema",
        line,
      });
    }
    return refs;
  }

  private extractSections(content: string): SectionInfo[] {
    const sections: SectionInfo[] = [];
    try {
      const doc = JSON.parse(stripJsoncSyntax(content));
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        // Use the original content (with comments) for line-number lookup so
        // section line numbers match what the user sees in the source file.
        const lines = content.split("\n");
        for (const key of Object.keys(doc)) {
          const escapedKey = JSON.stringify(key);
          const lineIdx = lines.findIndex((l) => l.includes(escapedKey));
          if (lineIdx !== -1) {
            sections.push({
              name: key,
              level: 1,
              lineRange: [lineIdx + 1, lineIdx + 1],
            });
          }
        }
        // Fix lineRange end
        for (let i = 0; i < sections.length; i++) {
          const next = sections[i + 1];
          sections[i].lineRange[1] = next ? next.lineRange[0] - 1 : lines.length;
        }
      }
    } catch (err) {
      console.warn(`[json-parser] Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return sections;
  }
}
