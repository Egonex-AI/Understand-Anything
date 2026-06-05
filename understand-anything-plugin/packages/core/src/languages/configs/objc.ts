import type { LanguageConfig } from "../types.js";

export const objcConfig = {
  id: "objc",
  displayName: "Objective-C",
  extensions: [".m", ".mm"],
  treeSitter: {
    wasmPackage: "tree-sitter-objc",
    wasmFile: "tree-sitter-objc.wasm",
  },
  concepts: [
    "protocols",
    "categories",
    "message passing",
    "properties",
    "memory management",
    "blocks",
    "KVC/KVO",
    "runtime",
    "delegation",
    "notifications",
  ],
  filePatterns: {
    entryPoints: ["main.m", "AppDelegate.m"],
    barrels: [],
    tests: ["*Tests.m", "Tests/**/*.m"],
    config: ["Podfile", "*.xcodeproj/project.pbxproj"],
  },
} satisfies LanguageConfig;
