#!/usr/bin/env node
/**
 * validate-graph.mjs
 *
 * Validates a knowledge graph JSON file against @understand-anything/core schemas.
 * Auto-fixes recoverable issues (missing fields, aliases, type coercion).
 *
 * Usage:
 *   node validate-graph.mjs <input.json> <output-report.json>
 *
 * Exit codes:
 *   0 = passed (no issues or only auto-corrected)
 *   1 = fatal (invalid input, no valid nodes)
 *   2 = dropped issues (some nodes/edges removed, but graph is usable)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const coreDist = join(pluginRoot, "packages/core/dist/index.js");

if (!existsSync(coreDist)) {
  console.error(
    `[validate-graph] Core package not built. Run: cd ${pluginRoot} && pnpm --filter @understand-anything/core build`,
  );
  process.exit(1);
}

const core = await import(pathToFileURL(coreDist).href);

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const outputPath = args.find((a) => a.endsWith(".json") && a !== inputPath) || args[1];

if (!inputPath || !outputPath) {
  console.error("Usage: node validate-graph.mjs <input.json> <output-report.json>");
  process.exit(1);
}

// Read input
let rawData;
try {
  rawData = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (err) {
  const report = {
    passed: false,
    issues: [],
    fatal: `Failed to parse JSON: ${err.message}`,
    stats: {},
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  process.exit(1);
}

// Validate
const result = core.validateGraph(rawData);

// Build report
const report = {
  passed: result.success && !result.issues.some((i) => i.level === "dropped"),
  issues: result.issues,
  fatal: result.fatal || null,
  data: result.data ?? null,
  stats: result.data
    ? {
        totalNodes: result.data.nodes.length,
        totalEdges: result.data.edges.length,
        totalLayers: result.data.layers.length,
        tourSteps: result.data.tour.length,
        hasProject: !!result.data.project?.name,
        nodeTypes: result.data.nodes.reduce((acc, n) => {
          acc[n.type] = (acc[n.type] || 0) + 1;
          return acc;
        }, {}),
        edgeTypes: result.data.edges.reduce((acc, e) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {}),
      }
    : {},
};

writeFileSync(outputPath, JSON.stringify(report, null, 2));

// Exit code
if (result.fatal) {
  process.exit(1);
}
if (result.issues.some((i) => i.level === "dropped")) {
  process.exit(2);
}
process.exit(0);
