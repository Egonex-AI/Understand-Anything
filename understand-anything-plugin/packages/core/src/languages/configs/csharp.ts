import type { LanguageConfig } from "../types.js";

export const csharpConfig = {
  id: "csharp",
  displayName: "C#",
  extensions: [".cs"],
  treeSitter: {
    wasmPackage: "tree-sitter-c-sharp",
    wasmFile: "tree-sitter-c_sharp.wasm",
  },
  concepts: [
    "LINQ",
    "async/await",
    "generics",
    "properties",
    "delegates and events",
    "attributes",
    "nullable reference types",
    "pattern matching",
    "records",
    "dependency injection",
  ],
  filePatterns: {
    entryPoints: ["Program.cs", "**/Program.cs"],
    barrels: [],
    tests: ["*Tests.cs", "*Test.cs"],
    config: ["*.csproj", "*.sln"],
  },
} satisfies LanguageConfig;
