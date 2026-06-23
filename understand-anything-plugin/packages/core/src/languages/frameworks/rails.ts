import type { FrameworkConfig } from "../types.js";

export const railsConfig = {
  id: "rails",
  displayName: "Ruby on Rails",
  languages: ["ruby"],
  detectionKeywords: [
    "rails",
    "railties",
    "actionpack",
    "activerecord",
    "actionview",
  ],
  manifestFiles: ["Gemfile"],
  promptSnippetPath: "./frameworks/rails.md",
  entryPoints: ["config.ru", "bin/rails"],
  layerHints: {
    controllers: "api",
    models: "data",
    views: "ui",
    helpers: "utility",
    mailers: "service",
    jobs: "service",
    channels: "service",
    middleware: "middleware",
    lib: "service",
  },
} satisfies FrameworkConfig;
