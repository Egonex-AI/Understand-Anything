import type { LanguageConfig } from "../types.js";

export const githubActionsConfig = {
  id: "github-actions",
  displayName: "GitHub Actions",
  extensions: [],
  concepts: ["workflows", "jobs", "steps", "actions", "triggers", "secrets", "matrix strategy", "artifacts"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [".github/workflows/*.yml"],
  },
} satisfies LanguageConfig;
