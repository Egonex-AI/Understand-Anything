import type { LanguageConfig } from "../types.js";

export const pascalConfig = {
  id: "pascal",
  displayName: "Pascal / Delphi",
  extensions: [".pas", ".pp", ".dpr", ".dpk", ".inc"],
  treeSitter: {
    wasmPackage: "tree-sitter-pascal",
    wasmFile: "tree-sitter-pascal.wasm",
  },
  concepts: [
    "units",
    "uses clauses",
    "interface and implementation sections",
    "classes and inheritance",
    "interfaces",
    "published properties",
    "data modules",
    "form/data-module pairing with DFM files",
    "RTTI attributes",
    "anonymous methods",
    "generics",
    "initialization and finalization sections",
  ],
  filePatterns: {
    entryPoints: ["*.dpr", "*.dpk"],
    barrels: [],
    tests: ["test_*.pas", "*_test.pas", "*Tests.pas"],
    config: ["*.dproj", "*.cfg", "*.bpg", "*.groupproj"],
  },
} satisfies LanguageConfig;
