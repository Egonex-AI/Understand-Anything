import type { LanguageConfig } from "../types.js";

export const envConfig = {
  id: "env",
  displayName: "Environment Variables",
  extensions: [".env"],
  filenames: [".env", ".env.local", ".env.development", ".env.production", ".env.test", ".env.example"],
  concepts: ["key-value pairs", "variable interpolation", "secrets", "environment-specific config"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [".env", ".env.*"],
  },
} satisfies LanguageConfig;
