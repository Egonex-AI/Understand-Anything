import type { LanguageConfig } from "../types.js";

export const solidityConfig = {
  id: "solidity",
  displayName: "Solidity",
  extensions: [".sol"],
  treeSitter: {
    wasmPackage: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-solidity.wasm",
  },
  concepts: [
    "contracts",
    "interfaces",
    "libraries",
    "modifiers",
    "events",
    "state variables",
    "visibility (public, external, internal, private)",
    "state mutability (view, pure, payable)",
    "inheritance",
    "ERC standards",
  ],
  filePatterns: {
    entryPoints: ["contracts/*.sol", "src/*.sol"],
    barrels: [],
    tests: ["test/**/*.t.sol", "test/**/*Test.sol"],
    config: ["foundry.toml", "hardhat.config.js", "hardhat.config.ts", "truffle-config.js"],
  },
} satisfies LanguageConfig;
