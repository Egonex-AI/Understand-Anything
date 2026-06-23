import type { LanguageConfig } from "../types.js";

export const yamlConfig = {
  id: "yaml",
  displayName: "YAML",
  extensions: [".yaml", ".yml"],
  concepts: ["mappings", "sequences", "anchors", "aliases", "multi-document", "tags"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: ["*.yaml", "*.yml"],
  },
} satisfies LanguageConfig;
