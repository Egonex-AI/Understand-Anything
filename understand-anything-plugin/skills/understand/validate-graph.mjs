#!/usr/bin/env node
/**
 * validate-graph.mjs
 *
 * Deterministic build-time validator for an assembled KnowledgeGraph. Invoked
 * from SKILL.md Phase 6 (default, no `--review` path); replaces the inline
 * `ua-inline-validate.cjs` that SKILL.md previously wrote to the project's tmp
 * dir on every run.
 *
 * Usage:
 *   node validate-graph.mjs <assembled-graph.json> <review.json>
 *
 * Reads the assembled graph, writes a `{ issues, warnings, stats }` report to
 * the output path, and exits 0. A malformed/unreadable input exits 1 with the
 * error on stderr (SKILL.md retries once).
 *
 * `issues` are blocking (Phase 6 step 5 fixes them or skips dashboard launch);
 * `warnings` are advisory (e.g. orphan nodes). The output contract is identical
 * to the former inline validator, with ONE addition: `graph.project` metadata
 * is now validated against the same required fields the dashboard enforces via
 * `ProjectMetaSchema` (core/schema.ts). Without this check a graph missing a
 * required project field (e.g. `description`) passed the build clean but the
 * dashboard rejected it on load with "Missing or invalid project metadata".
 */

import { readFileSync, writeFileSync } from 'node:fs';

const graphPath = process.argv[2];
const outputPath = process.argv[3];

// Mirrors ProjectMetaSchema in packages/core/src/schema.ts — keep in sync.
const PROJECT_STRING_FIELDS = ['name', 'description', 'analyzedAt', 'gitCommitHash'];
const PROJECT_ARRAY_FIELDS = ['languages', 'frameworks'];

try {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];

  // Project metadata — fatal at dashboard load, so block it at build time too.
  const project = graph.project;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    issues.push('graph.project metadata is missing or not an object');
  } else {
    for (const field of PROJECT_STRING_FIELDS) {
      if (typeof project[field] !== 'string' || !project[field].trim()) {
        issues.push(`graph.project.${field} is missing or not a non-empty string`);
      }
    }
    for (const field of PROJECT_ARRAY_FIELDS) {
      if (!Array.isArray(project[field])) {
        issues.push(`graph.project.${field} is missing or not an array`);
      }
    }
  }

  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type] || 0) + 1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {})
  };
  writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) {
  process.stderr.write(err.message + '\n');
  process.exit(1);
}
