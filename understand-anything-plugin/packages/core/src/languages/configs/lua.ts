import type { LanguageConfig } from "../types.js";

export const luaConfig = {
  id: "lua",
  displayName: "Lua",
  extensions: [".lua"],
  concepts: [
    "tables",
    "metatables",
    "coroutines",
    "closures",
    "prototype-based OOP",
    "varargs",
    "weak references",
    "environments",
  ],
  filePatterns: {
    entryPoints: ["main.lua", "init.lua"],
    barrels: [],
    tests: ["*_test.lua", "test_*.lua", "*_spec.lua"],
    config: [".luacheckrc", "rockspec"],
  },
} satisfies LanguageConfig;
