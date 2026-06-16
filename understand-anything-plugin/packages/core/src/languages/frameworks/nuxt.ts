import type { FrameworkConfig } from "../types.js";

export const nuxtConfig = {
  id: "nuxt",
  displayName: "Nuxt",
  languages: ["typescript", "javascript"],
  detectionKeywords: ["nuxt", "@nuxt/core", "defineNuxtConfig", "@nuxt/ui"],
  manifestFiles: ["package.json", "nuxt.config.ts", "nuxt.config.js"],
  promptSnippetPath: "./frameworks/nuxt.md",
  entryPoints: ["app.vue", "nuxt.config.ts", "pages/index.vue", "src/pages/index.vue"],
  layerHints: {
    pages: "ui",
    components: "ui",
    composables: "service",
    stores: "service",
    layouts: "ui",
    middleware: "middleware",
    plugins: "config",
    server: "api",
  },
} satisfies FrameworkConfig;
