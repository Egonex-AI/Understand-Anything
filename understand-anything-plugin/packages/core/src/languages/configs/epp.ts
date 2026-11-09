import type { LanguageConfig } from "../types.js";

// Markup-grade config (like html.ts): no `treeSitter` field. EPP has no
// maintained tree-sitter grammar; the analyzer reads these files as source.
export const eppConfig = {
  id: "epp",
  displayName: "Puppet Template (EPP)",
  extensions: [".epp"],
  concepts: [
    "typed parameter lists",
    "embedded Puppet code",
    "template includes",
  ],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
