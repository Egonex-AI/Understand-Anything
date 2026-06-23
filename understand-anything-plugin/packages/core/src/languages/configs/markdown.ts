import type { LanguageConfig } from "../types.js";

export const markdownConfig = {
  id: "markdown",
  displayName: "Markdown",
  extensions: [".md", ".mdx"],
  concepts: ["headings", "links", "code blocks", "front matter", "lists", "tables", "images"],
  filePatterns: {
    entryPoints: ["README.md"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
