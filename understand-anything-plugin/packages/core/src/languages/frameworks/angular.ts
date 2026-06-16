import type { FrameworkConfig } from "../types.js";

export const angularConfig = {
  id: "angular",
  displayName: "Angular",
  languages: ["typescript"],
  detectionKeywords: ["@angular/core", "@angular/common", "@angular/router"],
  manifestFiles: ["package.json", "angular.json"],
  promptSnippetPath: "./frameworks/angular.md",
  entryPoints: ["src/main.ts", "src/app/app.module.ts", "src/app/app.component.ts"],
  layerHints: {
    app: "ui",
    components: "ui",
    services: "service",
    guards: "middleware",
    interceptors: "middleware",
    pipes: "utility",
    directives: "ui",
    resolvers: "service",
    models: "data",
  },
} satisfies FrameworkConfig;
