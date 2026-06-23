import type { FrameworkConfig } from "../types.js";

export const vueConfig = {
  id: "vue",
  displayName: "Vue",
  languages: ["typescript", "javascript"],
  detectionKeywords: ["vue", "@vue/cli-service", "nuxt", "vite-plugin-vue"],
  manifestFiles: ["package.json"],
  promptSnippetPath: "./frameworks/vue.md",
  entryPoints: ["src/main.ts", "src/App.vue", "src/main.js"],
  layerHints: {
    components: "ui",
    views: "ui",
    store: "service",
    composables: "service",
    router: "config",
    plugins: "config",
  },
} satisfies FrameworkConfig;
