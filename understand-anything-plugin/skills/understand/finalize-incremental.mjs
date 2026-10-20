#!/usr/bin/env node
/**
 * Finalize a prepared incremental update without another LLM pass.
 *
 * Usage: node finalize-incremental.mjs <projectRoot>
 *
 * For PARTIAL_UPDATE / ARCHITECTURE_UPDATE, reads assembled-graph.json plus
 * either the previous or regenerated layers/tour, performs deterministic
 * dangling-reference cleanup and local layer placement, then atomically saves
 * knowledge-graph.json. Only after that succeeds does it patch fingerprints
 * and advance meta.json. SKIP applies the fingerprint/meta patch only; a
 * generated-artifact-only SKIP deliberately advances nothing.
 */

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { validateIncrementalSymbols, formatSymbolReport } from './validate-incremental-symbols.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { resolveUaDir } = core;
const LAYER_NODE_TYPES = new Set([
  'file',
  'config',
  'document',
  'service',
  'pipeline',
  'table',
  'schema',
  'resource',
  'endpoint',
]);
const WHOLE_FILE_TYPES = new Set([
  'file',
  'config',
  'document',
  'service',
  'pipeline',
  'schema',
  'resource',
]);

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function atomicWriteJson(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
  // Verify the durable target, not the temporary file.
  JSON.parse(readFileSync(path, 'utf-8'));
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)) return null;
  const platformPath = process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
  const path = platformPath.replace(/^\.\//, '');
  if (!path || path.split('/').some(part => part === '..')) return null;
  return path;
}

function unwrap(value, key) {
  return Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];
}

function slug(value) {
  const result = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return result || 'other';
}

function buildPathIndex(nodes) {
  const index = new Map();
  const selectedTypes = new Map();
  for (const node of nodes) {
    if (!WHOLE_FILE_TYPES.has(node.type)) continue;
    const path = normalizeRelativePath(node.filePath);
    if (!path || node.id !== `${node.type}:${path}`) continue;
    if (!index.has(path) || (node.type === 'file' && selectedTypes.get(path) !== 'file')) {
      index.set(path, node.id);
      selectedTypes.set(path, node.type);
    }
  }
  return index;
}

function hasAnalyzedFileCoverage(nodes, filePath) {
  return nodes.some(node => {
    const path = normalizeRelativePath(node.filePath);
    if (path !== filePath || typeof node.id !== 'string') return false;
    if (WHOLE_FILE_TYPES.has(node.type)) return node.id === `${node.type}:${filePath}`;
    if (node.type === 'table' || node.type === 'endpoint') {
      return node.id.startsWith(`${node.type}:${filePath}:`);
    }
    return false;
  });
}

function resolveNodeRef(value, nodeIds, pathIndex) {
  if (typeof value === 'object' && value) value = value.id;
  if (typeof value !== 'string' || !value) return null;
  if (nodeIds.has(value)) return value;
  const path = normalizeRelativePath(value);
  return path ? pathIndex.get(path) ?? null : null;
}

function normalizeLayerShape(rawLayers, nodeIds, pathIndex) {
  return unwrap(rawLayers, 'layers').map((layer, index) => {
    const refs = Array.isArray(layer?.nodeIds)
      ? layer.nodeIds
      : Array.isArray(layer?.nodes)
        ? layer.nodes
        : [];
    const name = typeof layer?.name === 'string' && layer.name ? layer.name : 'Other';
    return {
      id: typeof layer?.id === 'string' && layer.id ? layer.id : `layer:${slug(name)}`,
      name,
      description:
        typeof layer?.description === 'string'
          ? layer.description
          : index === 0
            ? 'Project files'
            : '',
      nodeIds: refs
        .map(ref => resolveNodeRef(ref, nodeIds, pathIndex))
        .filter(Boolean),
    };
  });
}

function directorySegments(filePath) {
  const parts = normalizeRelativePath(filePath)?.split('/') ?? [];
  return parts.slice(0, -1);
}

function commonParentDepth(leftPath, rightPath) {
  const left = directorySegments(leftPath);
  const right = directorySegments(rightPath);
  let depth = 0;
  while (depth < left.length && depth < right.length && left[depth] === right[depth]) depth++;
  return depth;
}

function assignLayers(rawLayers, nodes, edges) {
  const nodeIds = new Set(nodes.map(node => node.id));
  const pathIndex = buildPathIndex(nodes);
  const layerable = nodes.filter(node => LAYER_NODE_TYPES.has(node.type));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const layers = normalizeLayerShape(rawLayers, nodeIds, pathIndex);
  const assigned = new Set();

  for (const layer of layers) {
    layer.nodeIds = layer.nodeIds.filter(id => {
      if (assigned.has(id)) return false;
      assigned.add(id);
      return true;
    });
  }

  const adjacency = new Map();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }

  const candidates = layers.filter(layer => layer.nodeIds.length > 0);
  for (const node of layerable) {
    if (assigned.has(node.id)) continue;
    if (candidates.length === 0) {
      const fallback = {
        id: 'layer:other',
        name: 'Other',
        description: 'Files not assigned to another architectural layer',
        nodeIds: [],
      };
      layers.push(fallback);
      candidates.push(fallback);
    }

    let bestLayer = candidates[0];
    let bestDepth = -1;
    let bestConnections = -1;
    for (const layer of candidates) {
      let depth = 0;
      for (const memberId of layer.nodeIds) {
        const member = nodeById.get(memberId);
        if (member?.filePath && node.filePath) {
          depth = Math.max(depth, commonParentDepth(node.filePath, member.filePath));
        }
      }
      const neighborIds = adjacency.get(node.id) ?? new Set();
      const connections = layer.nodeIds.reduce(
        (count, memberId) => count + (neighborIds.has(memberId) ? 1 : 0),
        0,
      );
      // Strict comparisons preserve original layer order as the final tie-break.
      if (depth > bestDepth || (depth === bestDepth && connections > bestConnections)) {
        bestLayer = layer;
        bestDepth = depth;
        bestConnections = connections;
      }
    }
    bestLayer.nodeIds.push(node.id);
    assigned.add(node.id);
  }

  return layers.filter(layer => layer.nodeIds.length > 0);
}

function normalizeTour(rawTour, nodeIds, pathIndex) {
  return unwrap(rawTour, 'steps')
    .map((step, index) => {
      const refs = Array.isArray(step?.nodeIds)
        ? step.nodeIds
        : Array.isArray(step?.nodesToInspect)
          ? step.nodesToInspect
          : [];
      const normalized = {
        order: Number.isFinite(step?.order) ? step.order : index + 1,
        title: typeof step?.title === 'string' ? step.title : `Step ${index + 1}`,
        description:
          typeof step?.description === 'string'
            ? step.description
            : typeof step?.whyItMatters === 'string'
              ? step.whyItMatters
              : '',
        nodeIds: [...new Set(
          refs.map(ref => resolveNodeRef(ref, nodeIds, pathIndex)).filter(Boolean),
        )],
      };
      if (typeof step?.languageLesson === 'string') {
        normalized.languageLesson = step.languageLesson;
      }
      return normalized;
    })
    .sort((a, b) => a.order - b.order);
}

function normalizeAssembled(assembled) {
  const nodesById = new Map();
  for (const node of assembled?.nodes ?? []) {
    if (node && typeof node.id === 'string' && node.id) nodesById.set(node.id, node);
  }
  const nodes = [...nodesById.values()];
  const nodeIds = new Set(nodesById.keys());
  const seenEdges = new Set();
  const edges = [];
  for (const edge of assembled?.edges ?? []) {
    if (!nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) continue;
    if (edge.source === edge.target) continue;
    const key = `${edge.source}\0${edge.target}\0${edge.type}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push(edge);
  }
  return { nodes, edges };
}

function refreshGraphImports(graph, importMap, refreshPaths) {
  const pathIndex = buildPathIndex(graph.nodes);
  const refreshedSourceIds = new Set(
    refreshPaths.map(path => pathIndex.get(path)).filter(Boolean),
  );
  const edges = graph.edges.filter(
    edge => !(edge.type === 'imports' && refreshedSourceIds.has(edge.source)),
  );
  const seen = new Set(edges.map(edge => `${edge.source}\0${edge.target}\0${edge.type}`));

  for (const sourcePath of refreshPaths) {
    const source = pathIndex.get(sourcePath);
    if (!source) continue;
    const targets = Array.isArray(importMap?.[sourcePath]) ? importMap[sourcePath] : [];
    for (const targetPath of targets) {
      const target = pathIndex.get(targetPath);
      if (!target || source === target) continue;
      const key = `${source}\0${target}\0imports`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source,
        target,
        type: 'imports',
        direction: 'forward',
        weight: 0.7,
        recoveredFromImportMap: true,
      });
    }
  }
  return { ...graph, edges };
}

function normalizeFingerprintStore(raw, baseCommit) {
  if (raw && raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) {
    return raw;
  }
  return {
    version: '1.0.0',
    gitCommitHash: baseCommit,
    generatedAt: new Date(0).toISOString(),
    files: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {},
  };
}

function isGeneratedOnly(plan) {
  return plan.generatedArtifactFiles.length > 0
    && plan.filesToReanalyze.length === 0
    && plan.deletedFiles.length === 0
    && plan.cosmeticFiles.length === 0
    && plan.ignoredFiles.length === 0;
}

function patchFingerprints(uaDir, plan, patch) {
  const fingerprintPath = join(uaDir, 'fingerprints.json');
  const store = normalizeFingerprintStore(readJson(fingerprintPath, null), plan.baseCommit);
  const files = { ...store.files };
  for (const filePath of patch.deletedFiles ?? []) delete files[filePath];
  for (const [filePath, fingerprint] of Object.entries(patch.files ?? {})) {
    files[filePath] = fingerprint;
  }
  atomicWriteJson(fingerprintPath, {
    version: '1.0.0',
    gitCommitHash: plan.headCommit,
    generatedAt: new Date().toISOString(),
    files,
  });
}

function advanceMeta(uaDir, plan, analyzedFiles) {
  const metaPath = join(uaDir, 'meta.json');
  const previous = readJson(metaPath, {});
  atomicWriteJson(metaPath, {
    ...previous,
    lastAnalyzedAt: new Date().toISOString(),
    gitCommitHash: plan.headCommit,
    version: previous.version ?? '1.0.0',
    analyzedFiles,
  });
}

function projectMetadata(previousProject, plan, scan) {
  const languages = [...new Set(
    (scan.files ?? [])
      .map(file => file?.language)
      .filter(language => typeof language === 'string' && language.length > 0),
  )].sort();
  return {
    ...(previousProject ?? {}),
    languages,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: plan.headCommit,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('--')) {
    throw new Error('Usage: node finalize-incremental.mjs <projectRoot>');
  }
  const projectRoot = realpathSync(args[0]);
  const uaDir = resolveUaDir(projectRoot);
  const intermediateDir = join(uaDir, 'intermediate');
  const plan = readJson(join(intermediateDir, 'incremental-plan.json'));
  const patch = readJson(join(intermediateDir, 'fingerprint-patch.json'));
  const scan = readJson(join(intermediateDir, 'scan-result.json'), { totalFiles: 0 });
  if (!plan || !patch) throw new Error('Incremental plan or fingerprint patch is missing');
  if (patch.baseCommit !== plan.baseCommit || patch.headCommit !== plan.headCommit) {
    throw new Error('Fingerprint patch does not match the incremental plan commits');
  }

  if (plan.action === 'FULL_UPDATE') {
    throw new Error('FULL_UPDATE must run the full /understand pipeline');
  }
  if (plan.action === 'SKIP' && isGeneratedOnly(plan)) {
    process.stdout.write('Generated artifacts only: analysis baseline unchanged\n');
    return;
  }

  const graphPath = join(uaDir, 'knowledge-graph.json');
  const importMapRefreshPaths = Array.isArray(plan.importMapRefreshPaths)
    ? plan.importMapRefreshPaths
    : [];

  if (plan.action === 'SKIP') {
    const previousGraph = readJson(graphPath);
    if (!previousGraph || !Array.isArray(previousGraph.nodes) || !Array.isArray(previousGraph.edges)) {
      throw new Error('knowledge-graph.json is missing or invalid; baseline not advanced');
    }
    const refreshedGraph = refreshGraphImports(
      previousGraph,
      scan.importMap ?? {},
      importMapRefreshPaths,
    );
    atomicWriteJson(graphPath, {
      ...refreshedGraph,
      project: projectMetadata(previousGraph.project, plan, scan),
    });
  }

  if (plan.action !== 'SKIP') {
    const previousGraph = readJson(graphPath, {});
    const assembledRaw = readJson(join(intermediateDir, 'assembled-graph.json'));
    if (!assembledRaw || !Array.isArray(assembledRaw.nodes) || !Array.isArray(assembledRaw.edges)) {
      throw new Error('assembled-graph.json is missing or invalid; baseline not advanced');
    }
    const assembled = refreshGraphImports(
      normalizeAssembled(assembledRaw),
      scan.importMap ?? {},
      importMapRefreshPaths,
    );
    const nodeIds = new Set(assembled.nodes.map(node => node.id));
    const pathIndex = buildPathIndex(assembled.nodes);
    const missingAnalyzedPaths = plan.filesToReanalyze.filter(
      path => !hasAnalyzedFileCoverage(assembled.nodes, path),
    );
    if (missingAnalyzedPaths.length > 0) {
      throw new Error(
        `Assembled graph is missing whole-file nodes for analyzed paths: ` +
        `${missingAnalyzedPaths.join(', ')}; baseline not advanced`,
      );
    }
    if (plan.rerunArchitecture && !existsSync(join(intermediateDir, 'layers.json'))) {
      throw new Error('Architecture update requires layers.json; baseline not advanced');
    }
    if (plan.rerunTour && !existsSync(join(intermediateDir, 'tour.json'))) {
      throw new Error('Architecture update requires tour.json; baseline not advanced');
    }
    const rawLayers = plan.rerunArchitecture
      ? readJson(join(intermediateDir, 'layers.json'))
      : previousGraph.layers ?? [];
    const rawTour = plan.rerunTour
      ? readJson(join(intermediateDir, 'tour.json'))
      : previousGraph.tour ?? [];
    const now = new Date().toISOString();
    const graph = {
      ...previousGraph,
      version: previousGraph.version ?? '1.0.0',
      project: {
        ...projectMetadata(previousGraph.project, plan, scan),
        analyzedAt: now,
      },
      nodes: assembled.nodes,
      edges: assembled.edges,
      layers: assignLayers(rawLayers, assembled.nodes, assembled.edges),
      tour: normalizeTour(rawTour, nodeIds, pathIndex),
    };

    // Ordering is intentional: a failed graph save must never advance the
    // structural baseline and hide the failed update from the next run.
    // Recheck the actual graph being saved, never trust a prior merge report.
    const symbolReport = await validateIncrementalSymbols(projectRoot, { graph, intermediateDir });
    process.stderr.write(`${formatSymbolReport(symbolReport)}\n`);
    if (!symbolReport.ok) throw new Error('Unresolved incremental symbol loss; baseline not advanced');
    atomicWriteJson(graphPath, graph);
  }

  patchFingerprints(uaDir, plan, patch);
  advanceMeta(uaDir, plan, scan.totalFiles);
  process.stdout.write(
    `Incremental update finalized: ${plan.action}; analyzedFiles=${scan.totalFiles}\n`,
  );
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`finalize-incremental.mjs failed: ${error.message}\n${error.stack}\n`);
    process.exit(1);
  }
}

export {
  assignLayers,
  commonParentDepth,
  hasAnalyzedFileCoverage,
  normalizeTour,
  refreshGraphImports,
};
