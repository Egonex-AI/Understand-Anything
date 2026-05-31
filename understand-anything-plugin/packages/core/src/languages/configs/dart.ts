import type { LanguageConfig } from "../types.js";

export const dartConfig = {
  id: "dart",
  displayName: "Dart",
  extensions: [".dart"],
  treeSitter: {
    wasmPackage: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-dart.wasm",
  },
  concepts: [
    "null safety",
    "async/await",
    "Future and Stream",
    "mixins",
    "extension methods",
    "named constructors",
    "factory constructors",
    "isolates",
    "widgets",
    "state management",
  ],
  filePatterns: {
    entryPoints: ["lib/main.dart", "bin/main.dart"],
    barrels: [],
    tests: ["test/**/*_test.dart"],
    config: ["pubspec.yaml", "analysis_options.yaml"],
  },
} satisfies LanguageConfig;
