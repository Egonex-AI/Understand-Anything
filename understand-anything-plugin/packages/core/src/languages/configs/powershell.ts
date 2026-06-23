import type { LanguageConfig } from "../types.js";

export const powershellConfig = {
  id: "powershell",
  displayName: "PowerShell",
  extensions: [".ps1", ".psm1", ".psd1"],
  concepts: ["cmdlets", "pipelines", "modules", "functions", "parameters", "variables", "error handling"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
