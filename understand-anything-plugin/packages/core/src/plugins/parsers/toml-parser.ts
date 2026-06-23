import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo } from "../../types.js";

/**
 * Parses TOML files to extract section headers ([section] and [[array-of-tables]]).
 * Computes section nesting level from dotted key paths (e.g., [tool.poetry] = level 2).
 * Does not parse individual key-value pairs within sections.
 */
export class TOMLParser implements AnalyzerPlugin {
  name = "toml-parser";
  languages = ["toml"];

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
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Match [section] and [[array-of-tables]] headers
      const match = lines[i].match(/^\s*\[(\[?)([^\]]+)\]?\]/);
      if (match) {
        const isArray = match[1] === "[";
        const name = match[2].trim();
        sections.push({
          name: isArray ? `[[${name}]]` : name,
          level: name.split(".").length,
          lineRange: [i + 1, i + 1],
        });
      }
    }
    // Fix lineRange end
    for (let i = 0; i < sections.length; i++) {
      const next = sections[i + 1];
      sections[i].lineRange[1] = next ? next.lineRange[0] - 1 : lines.length;
    }
    return sections;
  }
}
