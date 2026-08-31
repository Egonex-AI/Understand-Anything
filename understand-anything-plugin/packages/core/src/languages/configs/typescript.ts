import type { LanguageConfig } from "../types.js";

export const typescriptConfig = {
  id: "typescript",
  displayName: "TypeScript",
  // Declaration files (.d.ts / .d.mts / .d.cts) are intentionally NOT listed
  // separately: getForFile() resolves by the final extension, so they fall
  // through to .ts / .mts / .cts and are parsed as ordinary (types-only)
  // TypeScript. They carry no runtime exports or call edges, so the extractor
  // simply yields an empty call graph for them — no special gating is applied.
  extensions: [".ts", ".tsx", ".mts", ".cts"],
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
    tests: ["*.test.ts", "*.spec.ts", "*.test.tsx", "*.spec.tsx"],
    config: ["tsconfig.json"],
  },
} satisfies LanguageConfig;
