import type { LanguageConfig } from "../types.js";

export const shellConfig = {
  id: "shell",
  displayName: "Shell Script",
  extensions: [".sh", ".bash", ".zsh"],
  concepts: ["variables", "functions", "conditionals", "loops", "pipes", "redirection", "subshells", "exit codes"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [".bashrc", ".zshrc", ".profile"],
  },
} satisfies LanguageConfig;
