import type { LanguageConfig } from "../types.js";

export const shellConfig = {
  id: "shell",
  displayName: "Shell Script",
  extensions: [".sh", ".bash", ".zsh"],
  // The Bash grammar is a strict superset of POSIX shell and parses
  // zsh-flavored scripts well enough for structural extraction (function
  // definitions, sourced files, command invocations). We use it for all
  // three extensions rather than skipping zsh — partial structural data is
  // far more useful than none.
  treeSitter: {
    wasmPackage: "tree-sitter-bash",
    wasmFile: "tree-sitter-bash.wasm",
  },
  concepts: ["variables", "functions", "conditionals", "loops", "pipes", "redirection", "subshells", "exit codes"],
  filePatterns: {
    entryPoints: ["main.sh", "deploy.sh", "build.sh", "bootstrap.sh"],
    barrels: [],
    tests: ["*test.sh", "*tests.sh", "*spec.sh"],
    config: [".bashrc", ".zshrc", ".profile"],
  },
} satisfies LanguageConfig;
