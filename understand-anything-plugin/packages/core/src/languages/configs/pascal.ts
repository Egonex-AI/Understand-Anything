import type { LanguageConfig } from "../types.js";

export const pascalConfig = {
  id: "pascal",
  displayName: "Pascal",
  extensions: [".pas", ".dpr", ".lpr", ".pp"],
  treeSitter: {
    // Install via: pnpm add tree-sitter-pascal@github:jimmckeeth/tree-sitter-pascal#main
    // WASM: download from https://github.com/jimmckeeth/tree-sitter-pascal/releases
    //        or build via: scripts/build-pascal-wasm.ps1 / build-pascal-wasm.sh
    // The plugin degrades gracefully if the WASM is absent.
    wasmPackage: "tree-sitter-pascal",
    wasmFile: "tree-sitter-pascal.wasm",
  },
  concepts: [
    "units and interfaces",
    "classes and records",
    "properties and RTTI",
    "generics",
    "interfaces (COM-compatible)",
    "anonymous methods",
    "operator overloading",
    "inline variables",
    "attributes",
    "message handling",
  ],
  filePatterns: {
    entryPoints: ["*.dpr", "*.lpr"],
    barrels: [],
    tests: ["*Test.pas", "*Tests.pas", "*_test.pas"],
    config: ["*.dproj", "*.lpi", "*.cfg", "*.ini"],
  },
} satisfies LanguageConfig;
