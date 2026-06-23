import type { LanguageConfig } from "../types.js";

export const sqlConfig = {
  id: "sql",
  displayName: "SQL",
  extensions: [".sql"],
  concepts: ["tables", "columns", "indexes", "foreign keys", "views", "stored procedures", "triggers", "migrations"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
