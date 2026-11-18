import type { LanguageConfig } from "../types.js";

export const puppetConfig = {
  id: "puppet",
  displayName: "Puppet",
  extensions: [".pp"],
  treeSitter: {
    wasmPackage: "tree-sitter-puppet",
    wasmFile: "tree-sitter-puppet.wasm",
  },
  concepts: [
    "resources",
    "classes and defined types",
    "facts",
    "catalogs",
    "Hiera data binding",
    "resource relationships",
    "virtual and exported resources",
    "modules and environments",
    "node definitions",
    "templates (ERB / EPP)",
  ],
  filePatterns: {
    entryPoints: ["manifests/site.pp", "site.pp"],
    barrels: [],
    // rspec-puppet tests live as *_spec.rb and are matched by the Ruby config.
    tests: [],
    config: ["metadata.json", "Puppetfile", "hiera.yaml"],
  },
} satisfies LanguageConfig;
