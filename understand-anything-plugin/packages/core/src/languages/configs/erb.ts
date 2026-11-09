import type { LanguageConfig } from "../types.js";

// Markup-grade config (like html.ts): deliberately has no `treeSitter` field,
// so grammar loading skips it. ERB's only tree-sitter grammar parses bare
// `<% %>` spans with no nameable symbols, which would add nothing.
export const erbConfig = {
  id: "erb",
  displayName: "ERB Template",
  extensions: [".erb"],
  concepts: [
    "interpolation tags",
    "control-flow tags",
    "partials",
    "helper calls",
  ],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
