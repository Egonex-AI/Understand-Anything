import type { LanguageConfig } from "../types.js";

export const rubyConfig = {
  id: "ruby",
  displayName: "Ruby",
  extensions: [".rb", ".rake"],
  treeSitter: {
    wasmPackage: "tree-sitter-ruby",
    wasmFile: "tree-sitter-ruby.wasm",
  },
  concepts: [
    "blocks and procs",
    "mixins",
    "metaprogramming",
    "duck typing",
    "DSLs",
    "monkey patching",
    "symbols",
    "method_missing",
    "open classes",
  ],
  filePatterns: {
    entryPoints: ["config.ru", "app.rb"],
    barrels: [],
    tests: ["*_test.rb", "*_spec.rb", "spec_helper.rb"],
    config: ["Gemfile", "Rakefile"],
  },
} satisfies LanguageConfig;
