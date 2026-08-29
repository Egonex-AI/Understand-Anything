import type { LanguageConfig } from "../types.js";

export const kotlinConfig = {
  id: "kotlin",
  displayName: "Kotlin",
  extensions: [".kt", ".kts"],
  treeSitter: {
    wasmPackage: "@tree-sitter-grammars/tree-sitter-kotlin",
    wasmFile: "tree-sitter-kotlin.wasm",
  },
  concepts: [
    "coroutines",
    "data classes",
    "sealed classes",
    "extension functions",
    "null safety",
    "delegation",
    "DSL builders",
    "inline functions",
    "companion objects",
    "flow",
  ],
  filePatterns: {
    entryPoints: ["**/Application.kt", "**/Main.kt"],
    barrels: [],
    tests: ["*Test.kt", "*Tests.kt"],
    config: ["build.gradle.kts", "build.gradle"],
  },
} satisfies LanguageConfig;
