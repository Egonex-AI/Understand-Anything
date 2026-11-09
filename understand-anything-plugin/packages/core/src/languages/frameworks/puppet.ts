import type { FrameworkConfig } from "../types.js";

export const puppetFrameworkConfig = {
  id: "puppet",
  displayName: "Puppet",
  languages: ["puppet"],
  // metadata.json alone is ambiguous (VS Code extensions ship one too);
  // the keyword match on its content disambiguates, rails/Gemfile precedent.
  detectionKeywords: ["puppet", "puppetlabs", "hiera"],
  manifestFiles: ["metadata.json", "Puppetfile"],
  promptSnippetPath: "./frameworks/puppet.md",
  entryPoints: ["manifests/site.pp"],
  layerHints: {
    manifests: "service",
    functions: "utility",
    lib: "service",
    templates: "config",
    data: "data",
    spec: "test",
  },
} satisfies FrameworkConfig;
