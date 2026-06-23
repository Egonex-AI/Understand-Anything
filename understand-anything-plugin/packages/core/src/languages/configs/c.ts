import type { LanguageConfig } from "../types.js";

export const cConfig = {
  id: "c",
  displayName: "C",
  extensions: [".c", ".h"],
  treeSitter: {
    wasmPackage: "tree-sitter-cpp",
    wasmFile: "tree-sitter-cpp.wasm",
  },
  concepts: [
    "pointers",
    "manual memory management",
    "structs",
    "unions",
    "function pointers",
    "preprocessor macros",
    "header files",
    "static vs dynamic linking",
  ],
  filePatterns: {
    entryPoints: ["main.c", "src/main.c"],
    barrels: [],
    tests: ["*_test.c", "test_*.c"],
    config: ["Makefile", "CMakeLists.txt", "meson.build"],
  },
} satisfies LanguageConfig;
