import type { LanguageConfig } from "../types.js";

export const tomlConfig = {
  id: "toml",
  displayName: "TOML",
  extensions: [".toml"],
  concepts: ["tables", "inline tables", "arrays of tables", "key-value pairs", "dotted keys"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: ["Cargo.toml", "pyproject.toml", "netlify.toml"],
  },
} satisfies LanguageConfig;
