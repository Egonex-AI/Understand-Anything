import type { LanguageConfig } from "../types.js";

export const htmlConfig = {
  id: "html",
  displayName: "HTML",
  extensions: [".html", ".htm"],
  concepts: ["elements", "attributes", "semantic tags", "forms", "meta tags", "scripts", "stylesheets", "accessibility"],
  filePatterns: {
    entryPoints: ["index.html"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
