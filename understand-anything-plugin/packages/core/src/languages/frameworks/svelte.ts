import type { FrameworkConfig } from "../types.js";

export const svelteConfig = {
  id: "svelte",
  displayName: "Svelte",
  languages: ["typescript", "javascript"],
  detectionKeywords: ["svelte", "@sveltejs/kit", "svelte-kit"],
  manifestFiles: ["package.json", "svelte.config.js", "svelte.config.ts"],
  promptSnippetPath: "./frameworks/svelte.md",
  entryPoints: ["src/routes/+page.svelte", "src/app.html", "src/routes/+layout.svelte"],
  layerHints: {
    routes: "ui",
    lib: "service",
    components: "ui",
    stores: "service",
    hooks: "middleware",
    params: "config",
  },
} satisfies FrameworkConfig;
