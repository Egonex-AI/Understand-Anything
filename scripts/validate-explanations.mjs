#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateExplanations } from "./lib/explanation-validator.mjs";

function usage() {
  return "Usage: node scripts/validate-explanations.mjs <knowledge-graph.json> [--expected-files N] [--min-ready-ratio R] [--beginner-quality] [--no-integrity]";
}

function parseArgs(args) {
  const options = {};
  let graphPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--expected-files") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 0) throw new Error("--expected-files must be a non-negative integer");
      options.expectedFileNodes = value;
    } else if (arg === "--min-ready-ratio") {
      const value = Number(args[++index]);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("--min-ready-ratio must be between 0 and 1");
      options.minimumReadyRatio = value;
    } else if (arg === "--no-integrity") {
      options.checkGraphIntegrity = false;
    } else if (arg === "--beginner-quality") {
      options.beginnerQuality = true;
    } else if (!graphPath) {
      graphPath = arg;
    } else {
      throw new Error(`Unknown argument '${arg}'`);
    }
  }
  if (!graphPath) throw new Error(usage());
  return { graphPath, options };
}

export function validateExplanationFile(graphPath, options) {
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  return validateExplanations(graph, options);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { graphPath, options } = parseArgs(process.argv.slice(2));
    const report = validateExplanationFile(graphPath, options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.valid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
  }
}
