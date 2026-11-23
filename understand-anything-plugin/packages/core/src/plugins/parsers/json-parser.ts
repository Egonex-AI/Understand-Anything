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
      while (i < n && content[i] !== "\n" && content[i] !== "\r") i++;
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

  let result = "";
  i = 0;
  while (i < out.length) {
    const ch = out[i];

    if (ch === '"') {
      result += ch;
      i++;
      while (i < out.length) {
        const c = out[i];
        result += c;
        if (c === "\\" && i + 1 < out.length) {
          result += out[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (c === '"') break;
      }
      continue;
    }

    if (ch === ",") {
      let nextIndex = i + 1;
      while (nextIndex < out.length && /\s/.test(out[nextIndex])) nextIndex++;
      if (out[nextIndex] === "}" || out[nextIndex] === "]") {
        i++;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
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
        const keys = new Set(Object.keys(doc));
        const seen = new Set<string>();
        const entries = findTopLevelJsonKeys(content).filter(({ name }) => {
          if (!keys.has(name) || seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        for (const entry of entries) {
          sections.push({
            name: entry.name,
            level: 1,
            lineRange: [entry.line, entry.endLine],
          });
        }
      }
    } catch (err) {
      console.warn(`[json-parser] Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return sections;
  }
}

function findTopLevelJsonKeys(content: string): Array<{ name: string; line: number; endLine: number }> {
  const entries: Array<{ name: string; line: number; endLine: number }> = [];
  const stack: string[] = [];
  let activeEntry: (typeof entries)[number] | undefined;
  let lastSignificantLine = 1;
  let line = 1;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < content.length && content[i] !== "\n" && content[i] !== "\r") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        if (content[i] === "\r") {
          line++;
          if (content[i + 1] === "\n") i++;
        } else if (content[i] === "\n") {
          line++;
        }
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === '"') {
      const start = i;
      const startLine = line;
      i++;
      while (i < content.length) {
        const c = content[i];
        if (c === "\\" && i + 1 < content.length) {
          if (content[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (c === "\n") line++;
        i++;
        if (c === '"') break;
      }

      let nextIndex = i;
      while (nextIndex < content.length) {
        if (/\s/.test(content[nextIndex])) {
          nextIndex++;
          continue;
        }
        if (content[nextIndex] === "/" && content[nextIndex + 1] === "/") {
          nextIndex += 2;
          while (nextIndex < content.length && content[nextIndex] !== "\n" && content[nextIndex] !== "\r") nextIndex++;
          continue;
        }
        if (content[nextIndex] === "/" && content[nextIndex + 1] === "*") {
          nextIndex += 2;
          while (
            nextIndex < content.length
            && !(content[nextIndex] === "*" && content[nextIndex + 1] === "/")
          ) {
            nextIndex++;
          }
          nextIndex += 2;
          continue;
        }
        break;
      }

      if (stack.length === 1 && stack[0] === "{" && content[nextIndex] === ":") {
        activeEntry = {
          name: JSON.parse(content.slice(start, i)) as string,
          line: startLine,
          endLine: startLine,
        };
        entries.push(activeEntry);
      } else {
        lastSignificantLine = line;
      }
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      lastSignificantLine = line;
    } else if (ch === ",") {
      if (stack.length === 1 && activeEntry) {
        activeEntry.endLine = lastSignificantLine;
        activeEntry = undefined;
      }
    } else if (ch === "}" || ch === "]") {
      if (stack.length === 1 && activeEntry) {
        activeEntry.endLine = lastSignificantLine;
        activeEntry = undefined;
      }
      stack.pop();
      lastSignificantLine = line;
    } else if (ch === "\r") {
      line++;
      if (next === "\n") i++;
    } else if (ch === "\n") {
      line++;
    } else if (!/\s/.test(ch) && ch !== ":") {
      lastSignificantLine = line;
    }
    i++;
  }

  return entries;
}
