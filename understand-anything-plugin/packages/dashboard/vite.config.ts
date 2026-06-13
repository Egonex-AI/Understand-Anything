/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createApiRouter } from "./src/api/index";
import { writeApiResponse } from "./src/api/vite-adapter";
import { WikiDataService } from "./wiki-api";
import { findGraphFile, projectRootFromGraphFile } from "./src/api/utils";
import { VITEST_REACT_ALIASES } from "./vitest-react-aliases";

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/**/__tests__/**/*.test.tsx", "jsdom"],
    ],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup-dom.ts"],
    // Force single React instance — pnpm workspace creates two copies
    // (repo-level and plugin-level) which causes "Invalid hook call" errors.
    // Paths are validated at startup by vitest-react-aliases.ts.
    alias: {
      ...VITEST_REACT_ALIASES,
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/src/schema.ts"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/src/search.ts"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/src/types.ts"),
      "@understand-anything/core/system-graph": path.resolve(__dirname, "../core/src/system-graph.ts"),
      "@understand-anything/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    open: "/",
  },

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
      "@understand-anything/core/system-graph": path.resolve(__dirname, "../core/dist/system-graph.js"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          // ELK is ~1.6MB raw — split into its own chunk so it doesn't
          // bloat the main bundle. graphology is similarly large.
          if (id.includes("node_modules/elkjs/")) return "elk";
          if (id.includes("node_modules/graphology")) return "graphology";
          if (
            id.includes("node_modules/@dagrejs/") ||
            id.includes("node_modules/d3-force/")
          ) {
            return "graph-layout";
          }
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/hast-util-to-jsx-runtime/") ||
            /[\\/]node_modules[\\/](remark|rehype|mdast|hast|unist|micromark|decode-named-character-reference|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|devlop|bail|ccount|character-entities|is-plain-obj|trim-lines|trough|unified|vfile|zwitch)/.test(id)
          ) {
            return "markdown";
          }
        },
      },
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-knowledge-graph",
      configureServer(server) {
        // Print the access URL once so the developer can open it.
        server.httpServer?.once("listening", () => {
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : 5173;
          console.log(
            `\n  Dashboard URL (local):   http://127.0.0.1:${port}/` +
            `\n  Dashboard URL (network): http://0.0.0.0:${port}/\n`
          );
        });

        const router = createApiRouter();
        let wikiService: WikiDataService | null = null;
        function getWikiService(): WikiDataService {
          if (!wikiService) {
            const graphFile = findGraphFile("knowledge-graph.json");
            const projectRoot = graphFile
              ? projectRootFromGraphFile(graphFile)
              : process.env.GRAPH_DIR ?? process.cwd();
            wikiService = new WikiDataService(projectRoot);
          }
          return wikiService;
        }

        server.middlewares.use(async (req, res, next) => {
          try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");
            const apiRes = await router.handle(
              { pathname: url.pathname, searchParams: url.searchParams },
              { getWikiService },
            );
            if (apiRes === null) {
              next();
              return;
            }
            writeApiResponse(res, apiRes);
          } catch (error) {
            console.error(error);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
      },
    },
  ],
});
