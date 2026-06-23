import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo } from "../../types.js";
import { parse as parseYAML } from "yaml";

/**
 * Parses YAML configuration files to extract top-level key sections.
 * Uses the `yaml` library for parsing with a regex fallback for malformed input.
 * Only extracts top-level keys; does not descend into nested structures.
 *
 * The `languages` array also lists YAML-flavored special formats
 * (`docker-compose`, `kubernetes`, `github-actions`, `openapi`) so files
 * the language-registry tags with those ids don't fall through to the
 * "no parser matched" branch and lose all structural extraction.
 */
export class YAMLConfigParser implements AnalyzerPlugin {
  name = "yaml-config-parser";
  languages = [
    "yaml",
    "kubernetes",
    "docker-compose",
    "github-actions",
    "openapi",
  ];

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

  private extractSections(content: string): SectionInfo[] {
    const sections: SectionInfo[] = [];
    try {
      const doc = parseYAML(content);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        const lines = content.split("\n");
        for (const key of Object.keys(doc)) {
          // Match plain or quoted top-level keys (some YAMLs use `"on": push`
          // for GitHub Actions where `on` is a reserved word in YAML 1.1).
          const escaped = this.escapeRegex(key);
          const lineIdx = lines.findIndex((l) =>
            l.match(new RegExp(`^["']?${escaped}["']?\\s*:`)),
          );
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
      } else if (Array.isArray(doc)) {
        // Array-root YAML (e.g. CloudFormation snippets, K8s `List` documents).
        // Emit one section per array entry, naming it from `name`/`id`/`kind`.
        const lines = content.split("\n");
        for (let i = 0; i < doc.length; i++) {
          const entry = doc[i] as Record<string, unknown> | unknown;
          let name = `[${i}]`;
          if (entry && typeof entry === "object") {
            const e = entry as Record<string, unknown>;
            if (typeof e.name === "string") name = e.name;
            else if (typeof e.id === "string") name = e.id;
            else if (typeof e.kind === "string") name = e.kind;
          }
          sections.push({
            name,
            level: 1,
            lineRange: [1, lines.length],
          });
        }
      }
    } catch (err) {
      console.warn(`[yaml-parser] YAML parse failed, falling back to regex extraction: ${err instanceof Error ? err.message : String(err)}`);
      // If YAML parsing fails, fall back to regex
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\w[\w-]*)\s*:/);
        if (match) {
          sections.push({
            name: match[1],
            level: 1,
            lineRange: [i + 1, i + 1],
          });
        }
      }
      for (let i = 0; i < sections.length; i++) {
        const next = sections[i + 1];
        sections[i].lineRange[1] = next ? next.lineRange[0] - 1 : lines.length;
      }
    }
    return sections;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
