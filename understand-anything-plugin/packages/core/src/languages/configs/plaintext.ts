import type { LanguageConfig } from "../types.js";

export const plaintextConfig = {
  id: "plaintext",
  displayName: "Plain Text",
  extensions: [".txt", ".text"],
  concepts: ["paragraphs", "lists", "sections"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
