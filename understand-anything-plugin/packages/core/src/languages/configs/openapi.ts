import type { LanguageConfig } from "../types.js";

export const openapiConfig = {
  id: "openapi",
  displayName: "OpenAPI",
  extensions: [],
  filenames: ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"],
  concepts: ["paths", "operations", "schemas", "parameters", "responses", "security schemes", "tags", "servers"],
  filePatterns: {
    entryPoints: ["openapi.yaml", "swagger.yaml"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
