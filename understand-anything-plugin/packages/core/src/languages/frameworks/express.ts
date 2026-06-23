import type { FrameworkConfig } from "../types.js";

export const expressConfig = {
  id: "express",
  displayName: "Express",
  languages: ["javascript", "typescript"],
  detectionKeywords: ["\"express\":", "express-validator", "express-session"],
  manifestFiles: ["package.json"],
  promptSnippetPath: "./frameworks/express.md",
  entryPoints: [
    "src/index.js",
    "src/app.js",
    "server.js",
    "app.js",
    "src/index.ts",
    "src/app.ts",
  ],
  layerHints: {
    routes: "api",
    controllers: "service",
    models: "data",
    middleware: "middleware",
    services: "service",
    db: "data",
  },
} satisfies FrameworkConfig;
