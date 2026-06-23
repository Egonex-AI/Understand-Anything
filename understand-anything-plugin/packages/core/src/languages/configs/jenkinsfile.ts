import type { LanguageConfig } from "../types.js";

export const jenkinsfileConfig = {
  id: "jenkinsfile",
  displayName: "Jenkinsfile",
  extensions: [],
  filenames: ["Jenkinsfile"],
  concepts: ["pipeline", "stages", "steps", "agents", "environment", "post actions", "parallel execution", "shared libraries"],
  filePatterns: {
    entryPoints: ["Jenkinsfile"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
