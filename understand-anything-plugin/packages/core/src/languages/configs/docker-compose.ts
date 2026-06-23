import type { LanguageConfig } from "../types.js";

export const dockerComposeConfig = {
  id: "docker-compose",
  displayName: "Docker Compose",
  extensions: [],
  filenames: ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],
  concepts: ["services", "networks", "volumes", "ports", "environment", "depends_on", "build context", "healthchecks"],
  filePatterns: {
    entryPoints: ["docker-compose.yml", "compose.yml"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
