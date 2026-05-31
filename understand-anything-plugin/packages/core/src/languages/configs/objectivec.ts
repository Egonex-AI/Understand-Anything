import type { LanguageConfig } from "../types.js";

export const objectiveCConfig = {
  id: "objectivec",
  displayName: "Objective-C",
  // We only claim `.m` and `.mm` because `.h` is already mapped to C/C++ in
  // the language registry (the schema rejects duplicate extension mappings
  // across configs). The Obj-C extractor can parse .h files — they're just
  // C-with-Obj-C-extensions — but in practice most .h files in an Obj-C
  // project coexist with a .m file whose extractor pulls the same symbols
  // into the graph, so we don't lose meaningful structural data by skipping
  // headers.
  extensions: [".m", ".mm"],
  treeSitter: {
    wasmPackage: "tree-sitter-objc",
    wasmFile: "tree-sitter-objc.wasm",
  },
  concepts: [
    "categories",
    "protocols",
    "properties",
    "selectors",
    "blocks",
    "ARC",
  ],
  filePatterns: {
    entryPoints: ["main.m"],
    barrels: [],
    tests: [
      "*Tests.m",
      "*Spec.m",
      "Tests/*.m",
    ],
    config: [
      "Info.plist",
      "Podfile",
    ],
  },
} as const satisfies LanguageConfig;
