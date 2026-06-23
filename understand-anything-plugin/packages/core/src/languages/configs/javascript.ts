import type { LanguageConfig } from "../types.js";

export const javascriptConfig = {
  id: "javascript",
  displayName: "JavaScript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  treeSitter: {
    wasmPackage: "tree-sitter-javascript",
    wasmFile: "tree-sitter-javascript.wasm",
  },
  concepts: [
    "closures",
    "prototypes",
    "promises",
    "async/await",
    "event loop",
    "destructuring",
    "spread operator",
    "proxies",
    "generators",
    "modules (ESM/CJS)",
  ],
  filePatterns: {
    entryPoints: ["index.js", "src/index.js", "main.js"],
    barrels: ["index.js"],
    tests: ["*.test.js", "*.spec.js"],
    config: ["package.json", "jsconfig.json"],
  },
} satisfies LanguageConfig;
