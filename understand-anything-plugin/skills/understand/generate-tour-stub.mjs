#!/usr/bin/env node
/**
 * generate-tour-stub.mjs
 *
 * Deterministic stub tour generator for caveman mode.
 * Replaces the LLM tour-builder agent with a fast, zero-token heuristic
 * that creates a 5-7 step tour from README, entry point, and key directories.
 *
 * Usage:
 *   node generate-tour-stub.mjs <assembled-graph.json> <layers.json> <output-tour.json> [entry-point]
 *
 * Input:
 *   - assembled-graph.json with { nodes: [...], edges: [...] }
 *   - layers.json — array of layer objects from assign-layers-simple.mjs
 *   - Optional entry point file path (e.g., "src/index.ts")
 *
 * Output: tour.json — array of { order, title, description, nodeIds }
 *
 * Exit codes: 0 success; 1 bad usage; 2 unreadable/malformed input.
 *
 * Tour titles and descriptions are intentionally English-only — caveman mode
 * trades localization for zero-LLM execution. `--language` still applies to
 * file-node summaries produced by the file-analyzer agent.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// File-level node types
export const FILE_LEVEL_TYPES = new Set([
  'file', 'config', 'document', 'service', 'pipeline',
  'table', 'schema', 'resource', 'endpoint',
]);

/**
 * Pure tour-generation function. Takes a parsed graph, layers array, and
 * optional entry-point path. Returns a tour array matching the
 * TourStepSchema in core/src/schema.ts.
 */
export function generateTour(graph, layers, entryPoint) {
  const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  const layerArr = Array.isArray(layers) ? layers : [];

  // Build a lookup: filePath -> nodeId
  const pathToId = new Map();
  for (const n of nodes) {
    if (n && FILE_LEVEL_TYPES.has(n.type) && typeof n.filePath === 'string') {
      pathToId.set(n.filePath, n.id);
    }
  }

  const tour = [];
  let order = 1;

  // Step 1: README
  const readmeId = pathToId.get('README.md') || pathToId.get('readme.md') || pathToId.get('README.rst');
  if (readmeId) {
    tour.push({
      order: order++,
      title: 'Project Overview',
      description: "Start with the README to understand the project's purpose, setup instructions, and high-level architecture.",
      nodeIds: [readmeId],
    });
  }

  // Step 2: Entry point
  if (entryPoint) {
    const entryId = pathToId.get(entryPoint);
    if (entryId) {
      tour.push({
        order: order++,
        title: 'Application Entry Point',
        description: `This is where the application boots. Trace the startup sequence from ${entryPoint} to understand initialization flow.`,
        nodeIds: [entryId],
      });
    }
  }

  // Step 3: Configuration (pick the most important config files)
  const configLayer = layerArr.find((l) => l.id === 'layer:config');
  if (configLayer && configLayer.nodeIds.length > 0) {
    const configSet = new Set(configLayer.nodeIds);
    const priorityConfigs = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'];
    const picked = [];
    // Resolve each priority config by its actual filePath, scoped to the
    // config layer — `pathToId` already keys by filePath, so this naturally
    // matches the root file and ignores nested same-named files like
    // `packages/server/package.json`.
    for (const name of priorityConfigs) {
      const id = pathToId.get(name);
      if (id && configSet.has(id)) {
        picked.push(id);
        break;
      }
    }
    if (picked.length === 0) {
      picked.push(configLayer.nodeIds[0]);
    }
    tour.push({
      order: order++,
      title: 'Project Configuration',
      description: 'Review the project configuration to understand dependencies, build settings, and project metadata.',
      nodeIds: picked.slice(0, 3).sort(),
    });
  }

  // Step 4: Core/Business logic or API layer
  const apiLayer = layerArr.find((l) => l.id === 'layer:api');
  const serviceLayer = layerArr.find((l) => l.id === 'layer:services');
  const coreLayer = layerArr.find((l) => l.id === 'layer:core');

  const logicLayer = apiLayer || serviceLayer || coreLayer;
  if (logicLayer && logicLayer.nodeIds.length > 0) {
    tour.push({
      order: order++,
      title: logicLayer.name,
      description: `Explore the ${logicLayer.name.toLowerCase()} layer to understand the main functionality of the project.`,
      nodeIds: [...logicLayer.nodeIds].sort().slice(0, 5),
    });
  }

  // Step 5: Data layer (if exists and not already covered)
  const dataLayer = layerArr.find((l) => l.id === 'layer:data');
  if (dataLayer && dataLayer.nodeIds.length > 0) {
    tour.push({
      order: order++,
      title: 'Data & Models',
      description: 'Understand the data structures, database schemas, and models that power the application.',
      nodeIds: [...dataLayer.nodeIds].sort().slice(0, 5),
    });
  }

  // Step 6: Infrastructure (if exists)
  const infraLayer = layerArr.find((l) => l.id === 'layer:infra');
  if (infraLayer && infraLayer.nodeIds.length > 0) {
    tour.push({
      order: order++,
      title: 'Infrastructure & Deployment',
      description: 'Review the deployment setup, CI/CD pipelines, and infrastructure configuration.',
      nodeIds: [...infraLayer.nodeIds].sort().slice(0, 3),
    });
  }

  // Step 7: Testing (if exists)
  const testLayer = layerArr.find((l) => l.id === 'layer:testing');
  if (testLayer && testLayer.nodeIds.length > 0) {
    tour.push({
      order: order++,
      title: 'Test Suite',
      description: 'Explore the test suite to understand quality assurance practices and how the codebase is verified.',
      nodeIds: [...testLayer.nodeIds].sort().slice(0, 3),
    });
  }

  // Fallback: if we ended up with fewer than 3 steps, add remaining layers
  if (tour.length < 3) {
    for (const layer of layerArr) {
      if (tour.length >= 7) break;
      const alreadyUsed = tour.some((t) => t.nodeIds.some((id) => layer.nodeIds.includes(id)));
      if (!alreadyUsed && layer.nodeIds.length > 0) {
        tour.push({
          order: order++,
          title: layer.name,
          description: layer.description,
          nodeIds: [...layer.nodeIds].sort().slice(0, 5),
        });
      }
    }
  }

  return tour;
}

export function main(argv = process.argv) {
  const [,, graphPath, layersPath, outputPath, entryPoint] = argv;
  if (!graphPath || !layersPath || !outputPath) {
    process.stderr.write(
      'Usage: node generate-tour-stub.mjs <assembled-graph.json> <layers.json> <output-tour.json> [entry-point]\n',
    );
    process.exit(1);
  }

  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch (e) {
    process.stderr.write(`Error: could not read/parse ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }

  let layers;
  try {
    layers = JSON.parse(readFileSync(layersPath, 'utf-8'));
  } catch (e) {
    process.stderr.write(`Error: could not read/parse ${layersPath}: ${e.message}\n`);
    process.exit(2);
  }

  const tour = generateTour(graph, layers, entryPoint);

  try {
    writeFileSync(outputPath, JSON.stringify(tour, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`Error: could not write ${outputPath}: ${e.message}\n`);
    process.exit(2);
  }

  process.stdout.write(`Tour generated: ${tour.length} steps\n`);
}

// Run CLI only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
