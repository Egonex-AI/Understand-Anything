#!/usr/bin/env node
/**
 * assign-layers-simple.mjs
 *
 * Deterministic directory-pattern-based layer assignment for caveman mode.
 * Replaces the LLM architecture-analyzer agent with a fast, zero-token
 * heuristic that groups files by top-level directory and known patterns.
 *
 * Usage:
 *   node assign-layers-simple.mjs <assembled-graph.json> <output-layers.json>
 *
 * Input:  assembled-graph.json with { nodes: [...], edges: [...] }
 * Output: layers.json — array of { id, name, description, nodeIds }
 *
 * Exit codes: 0 success; 1 bad usage; 2 unreadable/malformed input.
 *
 * Layer labels (name/description) are intentionally English-only — caveman
 * mode trades localization for zero-LLM execution. `--language` still
 * applies to file-node summaries produced by the file-analyzer agent.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Directory-pattern → layer mapping
// Order matters: first match wins. Patterns are matched against the first
// path segment(s) of each file's relative path.
// ---------------------------------------------------------------------------
export const LAYER_RULES = [
  {
    id: 'layer:api',
    name: 'API & Routes',
    description: 'API endpoints, route handlers, and controllers.',
    patterns: [/^(src\/)?(routes|api|controllers|handlers|endpoints|pages\/api)\b/i],
  },
  {
    id: 'layer:ui',
    name: 'UI & Components',
    description: 'Frontend components, views, layouts, and templates.',
    patterns: [/^(src\/)?(components|views|pages|layouts|templates|screens|widgets|ui)\b/i],
  },
  {
    id: 'layer:services',
    name: 'Business Logic',
    description: 'Services, use cases, and core business logic.',
    patterns: [/^(src\/)?(services|usecases|use-cases|domain|core|business|logic|lib)\b/i],
  },
  {
    id: 'layer:data',
    name: 'Data & Models',
    description: 'Data models, database access, repositories, and schemas.',
    patterns: [/^(src\/)?(models|entities|schemas|prisma|database|db|repositories|repo|data|orm|migrations?)\b/i],
  },
  {
    id: 'layer:utils',
    name: 'Utilities & Helpers',
    description: 'Shared utilities, helpers, constants, and type definitions.',
    patterns: [/^(src\/)?(utils|helpers|common|shared|constants|types|typings|interfaces|enums)\b/i],
  },
  {
    id: 'layer:middleware',
    name: 'Middleware & Plugins',
    description: 'Middleware, interceptors, guards, and plugin hooks.',
    patterns: [/^(src\/)?(middleware|middlewares|interceptors|guards|plugins|hooks)\b/i],
  },
  {
    id: 'layer:testing',
    name: 'Testing',
    description: 'Test suites, fixtures, and test utilities.',
    patterns: [/^(src\/)?(__tests__|tests?|spec|fixtures|testdata|test-utils|cypress|e2e|playwright)\b/i],
  },
  {
    id: 'layer:infra',
    name: 'Infrastructure & CI/CD',
    description: 'Deployment configs, Docker, CI/CD pipelines, and infrastructure-as-code.',
    patterns: [/^(\.github|\.gitlab|\.circleci|k8s|kubernetes|infra|infrastructure|deploy|terraform|ansible|helm)\b/i],
  },
  {
    id: 'layer:config',
    name: 'Configuration',
    description: 'Project configuration files at the root level.',
    patterns: [/^[^/]*\.(json|yaml|yml|toml|ini|cfg|env(\.example)?)$/i, /^\.(?!github|gitlab|circleci)/],
  },
  {
    id: 'layer:docs',
    name: 'Documentation',
    description: 'Project documentation, guides, and READMEs.',
    patterns: [/^(docs|documentation|guides|wiki|READMEs?)\b/i, /^README/i, /^CONTRIBUTING/i, /^CHANGELOG/i],
  },
];

// File-level node types that should be assigned to layers
export const FILE_LEVEL_TYPES = new Set([
  'file', 'config', 'document', 'service', 'pipeline',
  'table', 'schema', 'resource', 'endpoint',
]);

/**
 * Pure layer-assignment function. Takes a parsed graph object and returns
 * a layers array matching the LayerSchema in core/src/schema.ts.
 *
 * Layer ordering matches LAYER_RULES; `layer:core` (catch-all) is appended
 * last and may contain entry-point files (e.g., `src/index.ts`) and any
 * other file that didn't match a directory rule.
 */
export function assignLayers(graph) {
  const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];

  // Collect file-level nodes with a filePath
  const fileNodes = nodes.filter((n) => n && FILE_LEVEL_TYPES.has(n.type) && typeof n.filePath === 'string');

  // layerId -> Set<nodeId>
  const layerBuckets = new Map();
  for (const rule of LAYER_RULES) {
    layerBuckets.set(rule.id, new Set());
  }
  layerBuckets.set('layer:core', new Set()); // catch-all (see file header)

  for (const node of fileNodes) {
    const filePath = node.filePath;
    const tags = Array.isArray(node.tags) ? node.tags : [];

    if (tags.includes('test')) {
      // Tag-based override: explicit `test` tag wins over directory pattern.
      layerBuckets.get('layer:testing').add(node.id);
    } else if (node.type === 'service' || node.type === 'pipeline' || node.type === 'resource') {
      // Infra-shaped node types route to infra regardless of path — these
      // are non-code things (Dockerfiles, CI pipelines, IaC) whose role is
      // defined by their kind, not by where they sit on disk. This must run
      // before pattern matching so a root `release.yml` (type=pipeline)
      // doesn't get pulled into layer:config by the `\.yml$` pattern.
      layerBuckets.get('layer:infra').add(node.id);
    } else if (matchAgainstRules(filePath, layerBuckets, node.id)) {
      // Directory pattern matched and the helper already added the node.
    } else if (node.type === 'document') {
      layerBuckets.get('layer:docs').add(node.id);
    } else if (node.type === 'config') {
      layerBuckets.get('layer:config').add(node.id);
    } else if (node.type === 'table' || node.type === 'schema' || node.type === 'endpoint') {
      layerBuckets.get('layer:data').add(node.id);
    } else {
      // Catch-all: unmatched file (often entry points like src/index.ts).
      layerBuckets.get('layer:core').add(node.id);
    }
  }

  // Build layers array in LAYER_RULES order, then catch-all. Skip empty layers.
  const layers = [];
  for (const rule of LAYER_RULES) {
    const nodeIds = layerBuckets.get(rule.id);
    if (nodeIds.size > 0) {
      layers.push({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        nodeIds: [...nodeIds].sort(),
      });
    }
  }
  const coreNodes = layerBuckets.get('layer:core');
  if (coreNodes.size > 0) {
    layers.push({
      id: 'layer:core',
      name: 'Core',
      description: 'Core application source files and other files not matching a specific layer.',
      nodeIds: [...coreNodes].sort(),
    });
  }

  return layers;
}

// Internal: try each LAYER_RULES pattern; on first match add node and return true.
function matchAgainstRules(filePath, layerBuckets, nodeId) {
  for (const rule of LAYER_RULES) {
    if (rule.patterns.some((p) => p.test(filePath))) {
      layerBuckets.get(rule.id).add(nodeId);
      return true;
    }
  }
  return false;
}

export function main(argv = process.argv) {
  const [,, graphPath, outputPath] = argv;
  if (!graphPath || !outputPath) {
    process.stderr.write('Usage: node assign-layers-simple.mjs <assembled-graph.json> <output-layers.json>\n');
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(graphPath, 'utf-8');
  } catch (e) {
    process.stderr.write(`Error: could not read ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }

  let graph;
  try {
    graph = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Error: could not parse ${graphPath} as JSON: ${e.message}\n`);
    process.exit(2);
  }

  const layers = assignLayers(graph);
  const totalFiles = layers.reduce((acc, l) => acc + l.nodeIds.length, 0);

  try {
    writeFileSync(outputPath, JSON.stringify(layers, null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`Error: could not write ${outputPath}: ${e.message}\n`);
    process.exit(2);
  }

  process.stdout.write(`Layers assigned: ${layers.length} layers, ${totalFiles} files\n`);
}

// Run CLI only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
