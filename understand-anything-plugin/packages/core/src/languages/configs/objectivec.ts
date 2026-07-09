import type { LanguageConfig } from "../types.js";

export const objectivecConfig = {
  id: "objective-c",
  displayName: "Objective-C",
  extensions: [".m", ".mm"],
  treeSitter: {
    wasmPackage: "tree-sitter-objc",
    wasmFile: "tree-sitter-objc.wasm",
  },
  concepts: [
    "message sending",
    "protocols",
    "categories",
    "class extensions",
    "property attributes",
    "ARC memory management",
    "blocks",
    "dynamic dispatch",
    "key-value observing",
    "Objective-C runtime",
  ],
  filePatterns: {
    entryPoints: ["main.m", "AppDelegate.m"],
    barrels: [],
    tests: ["*Tests.m", "*Spec.m", "Tests/**/*.m"],
    config: ["Podfile", "*.xcodeproj", "*.xcworkspace"],
  },
} satisfies LanguageConfig;
