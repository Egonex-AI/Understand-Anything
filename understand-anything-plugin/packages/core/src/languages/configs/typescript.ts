import type { LanguageConfig } from "../types.js";

export const typescriptConfig = {
  id: "typescript",
  displayName: "TypeScript",
  extensions: [".ts", ".tsx"],
  treeSitter: {
    wasmPackage: "tree-sitter-typescript",
    wasmFile: "tree-sitter-typescript.wasm",
  },
  concepts: [
    "generics",
    "type guards",
    "discriminated unions",
    "utility types",
    "decorators",
    "enums",
    "interfaces",
    "type inference",
    "mapped types",
    "conditional types",
    "template literal types",
  ],
  filePatterns: {
    entryPoints: ["src/index.ts", "src/main.ts", "src/App.tsx", "index.ts"],
    barrels: ["index.ts"],
    tests: ["*.test.ts", "*.spec.ts", "*.test.tsx"],
    config: ["tsconfig.json"],
  },
} satisfies LanguageConfig;
