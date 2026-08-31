import type { FrameworkConfig } from "../types.js";

export const angularConfig = {
  id: "angular",
  displayName: "Angular",
  languages: ["typescript", "javascript"],
  detectionKeywords: ["@angular/core", "@angular/common", "@angular/router"],
  manifestFiles: ["package.json"],
  promptSnippetPath: "./frameworks/angular.md",
  entryPoints: [
    "src/main.ts",
    "src/app/app.component.ts",
    "src/app/app.config.ts",
    "src/app/app.routes.ts",
    "src/app/app.module.ts",
  ],
  layerHints: {
    components: "ui",
    services: "service",
    guards: "middleware",
    interceptors: "middleware",
    pipes: "utility",
    directives: "utility",
    models: "types",
    environments: "config",
  },
} satisfies FrameworkConfig;
