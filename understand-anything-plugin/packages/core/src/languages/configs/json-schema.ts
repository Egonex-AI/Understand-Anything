import type { LanguageConfig } from "../types.js";

// TODO: JSON Schema files have no unique extension — *.schema.json files will match
// `jsonConfigConfig` by the `.json` extension. Detection requires content-based
// heuristics (e.g., checking for `"$schema"` or `"type"` keys at the root level).
// A future content-based detection pass could re-classify them as JSON Schema.
export const jsonSchemaConfig = {
  id: "json-schema",
  displayName: "JSON Schema",
  extensions: [],
  concepts: ["types", "properties", "required fields", "$ref", "$defs", "allOf/anyOf/oneOf", "patterns", "validation"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
