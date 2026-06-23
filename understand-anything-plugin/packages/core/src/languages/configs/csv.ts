import type { LanguageConfig } from "../types.js";

export const csvConfig = {
  id: "csv",
  displayName: "CSV",
  extensions: [".csv", ".tsv"],
  concepts: ["headers", "rows", "delimiters", "quoting", "escaping"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
