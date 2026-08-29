import type { LanguageConfig } from "../types.js";

export const dartConfig = {
  id: "dart",
  displayName: "Dart",
  extensions: [".dart"],
  treeSitter: {
    wasmPackage: "@understand-anything/tree-sitter-dart-wasm",
    wasmFile: "tree-sitter-dart.wasm",
  },
  concepts: [
    "null safety",
    "mixins",
    "extensions",
    "isolates",
    "async/await",
    "streams",
    "factory constructors",
    "named constructors",
    "records",
    "sealed classes",
  ],
  filePatterns: {
    entryPoints: ["lib/main.dart", "bin/*.dart"],
    barrels: ["lib/*.dart"],
    tests: ["test/**/*_test.dart"],
    config: ["pubspec.yaml", "analysis_options.yaml"],
  },
} satisfies LanguageConfig;
