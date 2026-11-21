import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo, ReferenceResolution } from "../../types.js";

function isTrailingComma(content: string, commaIndex: number): boolean {
  let j = commaIndex + 1;
  const n = content.length;
  while (j < n) {
    const c = content[j];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      j++;
      continue;
    }
    if (c === "/" && content[j + 1] === "/") {
      j += 2;
      while (j < n && content[j] !== "\n") j++;
      continue;
    }
    if (c === "/" && content[j + 1] === "*") {
      j += 2;
      while (j < n && !(content[j] === "*" && content[j + 1] === "/")) j++;
      j += 2;
      continue;
    }
    return c === "}" || c === "]";
  }
  return false;
}

/**
 * Strip JSONC syntax (line comments, block comments, trailing commas) so the
 * result can be passed to the standard `JSON.parse`. Preserves string contents
 * verbatim — comment-like sequences and comma-bracket patterns inside strings
 * are not removed.
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

    if (ch === "," && isTrailingComma(content, i)) {
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function extractTopLevelSections(content: string): SectionInfo[] {
  const byKey = new Map<string, SectionInfo>();
  let line = 1;
  let depth = 0;
  let expectKey = false;
  let current: { name: string; startLine: number; endLine: number } | null = null;

  const commit = () => {
    if (!current) return;
    const existing = byKey.get(current.name);
    if (existing) {
      existing.lineRange = [current.startLine, current.endLine];
    } else {
      byKey.set(current.name, {
        name: current.name,
        level: 1,
        lineRange: [current.startLine, current.endLine],
      });
    }
    current = null;
  };

  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && content[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(content[i] === "*" && content[i + 1] === "/")) {
        if (content[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === '"') {
      const start = i;
      const startLine = line;
      i++;
      while (i < n) {
        const c = content[i];
        if (c === "\\" && i + 1 < n) {
          if (content[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (c === "\n") line++;
        i++;
        if (c === '"') break;
      }
      if (depth === 1 && expectKey) {
        const name = JSON.parse(content.slice(start, i)) as string;
        current = { name, startLine, endLine: line };
        expectKey = false;
      } else if (current) {
        current.endLine = line;
      }
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (depth === 0 && ch === "{") {
        depth = 1;
        expectKey = true;
      } else {
        depth++;
        if (current) current.endLine = line;
      }
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (depth === 1 && ch === "}") {
        commit();
        break;
      }
      depth--;
      if (current) current.endLine = line;
      i++;
      continue;
    }

    if (ch === "," && depth === 1) {
      commit();
      expectKey = true;
      i++;
      continue;
    }

    if (ch === ":" && depth === 1 && current && !expectKey) {
      i++;
      continue;
    }

    if (current) current.endLine = line;
    i++;
  }

  return [...byKey.values()];
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
    try {
      const doc = JSON.parse(stripJsoncSyntax(content));
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        return extractTopLevelSections(content);
      }
    } catch (err) {
      console.warn(`[json-parser] Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}
