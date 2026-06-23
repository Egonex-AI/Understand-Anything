import type { LanguageConfig } from "../types.js";

export const phpConfig = {
  id: "php",
  displayName: "PHP",
  extensions: [".php"],
  treeSitter: {
    wasmPackage: "tree-sitter-php",
    wasmFile: "tree-sitter-php.wasm",
  },
  concepts: [
    "namespaces",
    "traits",
    "type declarations",
    "attributes",
    "enums",
    "fibers",
    "closures",
    "magic methods",
    "dependency injection",
    "middleware",
  ],
  filePatterns: {
    entryPoints: ["index.php", "public/index.php", "artisan"],
    barrels: [],
    tests: ["*Test.php", "tests/**/*.php"],
    config: ["composer.json", "php.ini"],
  },
} satisfies LanguageConfig;
