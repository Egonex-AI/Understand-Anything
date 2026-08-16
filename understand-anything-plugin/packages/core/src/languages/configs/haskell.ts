import type { LanguageConfig } from "../types.js";

export const haskellConfig = {
  id: "haskell",
  displayName: "Haskell",
  extensions: [".hs", ".lhs"],
  treeSitter: {
    wasmPackage: "tree-sitter-haskell",
    wasmFile: "tree-sitter-haskell.wasm",
  },
  concepts: [
    "pure functions",
    "algebraic data types",
    "pattern matching",
    "type classes",
    "higher-kinded types",
    "monads and applicatives",
    "lazy evaluation",
    "newtypes",
    "GADTs",
    "language extensions",
  ],
  filePatterns: {
    entryPoints: ["app/Main.hs", "src/Main.hs", "Main.hs"],
    barrels: [],
    tests: [
      "*Spec.hs",
      "*Test.hs",
      "*Tests.hs",
      "*Spec.lhs",
      "*Test.lhs",
      "*Tests.lhs",
      "test/Main.hs",
      "tests/Main.hs",
      "test/Main.lhs",
      "tests/Main.lhs",
    ],
    config: ["*.cabal", "cabal.project", "stack.yaml", "package.yaml"],
  },
} satisfies LanguageConfig;
