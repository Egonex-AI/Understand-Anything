#!/usr/bin/env node
/**
 * Prepare a deterministic incremental /understand update.
 *
 * Usage:
 *   node prepare-incremental.mjs <projectRoot> <baseCommit>
 *     [--exclude <comma-separated-patterns>]
 *
 * Writes under <UA_DIR>/intermediate:
 *   - incremental-plan.json
 *   - changed-files.json
 *   - fingerprint-patch.json
 *   - incremental-baseline.json (retry-safe copy of the pre-update scan)
 *   - incremental-symbol-baseline.json (old nodes for reanalyzed files)
 *   - batch-existing.json (PARTIAL/ARCHITECTURE only)
 *
 * It also atomically refreshes scan-result.json (except for a commit whose
 * only changes are generated analysis artifacts). All git subprocess
 * arguments are parameterized and all path lists use Git's NUL-delimited
 * format so spaces, renames, and non-ASCII filenames round-trip safely.
 */

import { createRequire } from 'node:module';
import { dirname, basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const {
  TreeSitterPlugin,
  PluginRegistry,
  builtinLanguageConfigs,
  registerAllParsers,
  buildFingerprintStore,
  compareFingerprints,
  classifyUpdate,
  createIgnoreFilter,
  resolveUaDir,
} = core;

const SCAN_SCRIPT = join(__dirname, 'scan-project.mjs');
const IMPORT_SCRIPT = join(__dirname, 'extract-import-map.mjs');
const GENERATED_ROOTS = new Set(['.ua', '.understand-anything']);
const WHOLE_FILE_TYPES = new Set([
  'file',
  'config',
  'document',
  'service',
  'pipeline',
  'schema',
  'resource',
]);

function comparePaths(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sorted(values) {
  return [...new Set(values)].sort(comparePaths);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) return null;
  const platformPath = process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
  const posix = platformPath.replace(/^\.\//, '');
  if (!posix || posix.split('/').some(part => part === '..')) return null;
  return posix;
}

function isGeneratedArtifact(path) {
  return GENERATED_ROOTS.has(path.split('/')[0]);
}

function isImportResolverConfig(path) {
  const name = path.split('/').at(-1);
  return name === 'tsconfig.json'
    || name === 'go.mod'
    || name === 'composer.json'
    || name === 'Package.swift';
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error.message}`);
  }
}

function atomicWriteJson(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
}

function clearIncrementalScratch(intermediateDir) {
  const exactNames = new Set([
    'assembled-graph.json',
    'batch-existing.json',
    'batches.json',
    'layers.json',
    'tour.json',
    'incremental-symbol-report.json',
    'incremental-edge-candidates.json',
  ]);
  for (const name of readdirSync(intermediateDir)) {
    if (exactNames.has(name) || /^batch-\d+(?:-part-\d+)?\.json$/.test(name)) {
      unlinkSync(join(intermediateDir, name));
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

function resolveCommit(projectRoot, value) {
  return run(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`],
    { cwd: projectRoot },
  ).trim();
}

function parseNameStatusZ(output) {
  if (!output) return [];
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!status) continue;
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = normalizeRelativePath(fields[i++]);
      const newPath = normalizeRelativePath(fields[i++]);
      if (!oldPath || !newPath) throw new Error(`Invalid ${kind} path in git diff`);
      changes.push({ status, oldPath, newPath });
    } else {
      const path = normalizeRelativePath(fields[i++]);
      if (!path) throw new Error(`Invalid path in git diff for status ${status}`);
      changes.push({ status, path });
    }
  }
  return changes;
}

function pathsFromChanges(changes) {
  const paths = [];
  for (const change of changes) {
    if (change.path) paths.push(change.path);
    if (change.oldPath) paths.push(change.oldPath);
    if (change.newPath) paths.push(change.newPath);
  }
  return sorted(paths);
}

function parseNulPaths(output) {
  return output
    .split('\0')
    .map(normalizeRelativePath)
    .filter(Boolean);
}

function relevantWorktreeChanges(projectRoot, excludePatterns) {
  const paths = sorted([
    ...parseNulPaths(run(
      'git',
      ['diff', '--cached', '--name-only', '-z', '--relative', '--', '.'],
      { cwd: projectRoot },
    )),
    ...parseNulPaths(run(
      'git',
      ['diff', '--name-only', '-z', '--relative', '--', '.'],
      { cwd: projectRoot },
    )),
    ...parseNulPaths(run(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'],
      { cwd: projectRoot },
    )),
  ]);
  const ignoreFilter = createIgnoreFilter(projectRoot, excludePatterns);
  return paths.filter(path => {
    if (isGeneratedArtifact(path)) return false;
    const name = path.split('/').at(-1);
    // These control which files the live scanner can see, so a dirty version
    // is relevant even though the control file itself is not analyzed.
    if (name === '.gitignore' || name === '.understandignore') return true;
    return !ignoreFilter.isIgnored(path);
  });
}

function isTrackedSymlink(projectRoot, filePath) {
  try {
    return lstatSync(join(projectRoot, filePath)).isSymbolicLink();
  } catch {
    return false;
  }
}

function normalizeFingerprintStore(raw, baseCommit) {
  if (raw && raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) {
    return raw;
  }
  // Compatibility with the early auto-update prompt, which wrote a bare
  // path -> fingerprint dictionary instead of FingerprintStore.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      version: '1.0.0',
      gitCommitHash: baseCommit,
      generatedAt: new Date(0).toISOString(),
      files: raw,
    };
  }
  return {
    version: '1.0.0',
    gitCommitHash: baseCommit,
    generatedAt: new Date(0).toISOString(),
    files: {},
  };
}

function inventoryFrom(scan, graph, fingerprints) {
  const paths = [];
  for (const file of scan?.files ?? []) paths.push(file?.path);
  for (const node of graph?.nodes ?? []) paths.push(node?.filePath);
  paths.push(...Object.keys(fingerprints.files ?? {}));
  return sorted(
    paths
      .map(normalizeRelativePath)
      .filter(path => path && !isGeneratedArtifact(path)),
  );
}

function contentOnlyFingerprint(filePath) {
  const content = readFileSync(filePath.absolutePath, 'utf-8');
  const contentHash = require('node:crypto').createHash('sha256').update(content).digest('hex');
  return {
    filePath: filePath.relativePath,
    contentHash,
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    totalLines: content.split('\n').length,
    hasStructuralAnalysis: false,
  };
}

async function buildCurrentFingerprints(projectRoot, paths, headCommit) {
  if (paths.length === 0) {
    return {
      version: '1.0.0',
      gitCommitHash: headCommit,
      generatedAt: new Date().toISOString(),
      files: {},
    };
  }

  try {
    const tsConfigs = builtinLanguageConfigs.filter(config => config.treeSitter);
    const treeSitter = new TreeSitterPlugin(tsConfigs);
    await treeSitter.init();
    const registry = new PluginRegistry();
    registry.register(treeSitter);
    registerAllParsers(registry);
    const structuralFingerprintLanguages = new Set(tsConfigs.map(config => config.id));
    return buildFingerprintStore(projectRoot, paths, registry, headCommit, {
      structuralFingerprintLanguages,
    });
  } catch (error) {
    process.stderr.write(
      `Warning: prepare-incremental: structural parser initialization failed ` +
      `(${error.message}); changed files will be classified conservatively\n`,
    );
    const files = {};
    for (const relativePath of paths) {
      files[relativePath] = contentOnlyFingerprint({
        relativePath,
        absolutePath: join(projectRoot, relativePath),
      });
    }
    return {
      version: '1.0.0',
      gitCommitHash: headCommit,
      generatedAt: new Date().toISOString(),
      files,
    };
  }
}

function analyzeInventoryChanges({
  currentChangedPaths,
  currentFingerprints,
  oldFingerprints,
  oldInventory,
  deletedFiles,
}) {
  const oldInventorySet = new Set(oldInventory);
  const fileChanges = [];
  const newFiles = [];
  const structurallyChangedFiles = [];
  const cosmeticOnlyFiles = [];
  const unchangedFiles = [];

  for (const filePath of currentChangedPaths) {
    const current = currentFingerprints.files[filePath];
    if (!current) {
      throw new Error(`File disappeared while preparing incremental update: ${filePath}`);
    }
    const previous = oldFingerprints.files[filePath];
    if (!oldInventorySet.has(filePath)) {
      newFiles.push(filePath);
      fileChanges.push({ filePath, changeLevel: 'STRUCTURAL', details: ['new file'] });
      continue;
    }
    if (!previous) {
      structurallyChangedFiles.push(filePath);
      fileChanges.push({
        filePath,
        changeLevel: 'STRUCTURAL',
        details: ['no fingerprint baseline — conservative classification'],
      });
      continue;
    }
    const result = compareFingerprints(previous, current);
    fileChanges.push(result);
    if (result.changeLevel === 'STRUCTURAL') structurallyChangedFiles.push(filePath);
    else if (result.changeLevel === 'COSMETIC') cosmeticOnlyFiles.push(filePath);
    else unchangedFiles.push(filePath);
  }

  for (const filePath of deletedFiles) {
    fileChanges.push({ filePath, changeLevel: 'STRUCTURAL', details: ['file deleted or ignored'] });
  }

  return {
    fileChanges,
    newFiles: sorted(newFiles),
    deletedFiles: sorted(deletedFiles),
    structurallyChangedFiles: sorted(structurallyChangedFiles),
    cosmeticOnlyFiles: sorted(cosmeticOnlyFiles),
    unchangedFiles: sorted(unchangedFiles),
  };
}

function runScan(projectRoot, outputPath, excludePatterns) {
  const args = [SCAN_SCRIPT, projectRoot, outputPath, '--exclude-analysis-data'];
  if (excludePatterns.length > 0) args.push('--exclude', excludePatterns.join(','));
  run(process.execPath, args);
  return readJson(outputPath);
}

function refreshImportMap({ projectRoot, intermediateDir, previousScan, currentScan, analysisPaths }) {
  const inputPath = join(intermediateDir, 'incremental-import-input.json');
  const outputPath = join(intermediateDir, 'incremental-import-output.json');
  atomicWriteJson(inputPath, {
    projectRoot,
    files: currentScan.files,
    analysisPaths,
  });
  run(process.execPath, [IMPORT_SCRIPT, inputPath, outputPath]);
  const extraction = readJson(outputPath);
  const failures = Array.isArray(extraction?.failures) ? extraction.failures : [];
  if (failures.length > 0) {
    const preview = failures
      .slice(0, 5)
      .map(failure => `${failure.path ?? '<global>'} (${failure.stage})`)
      .join(', ');
    const suffix = failures.length > 5 ? ` (+${failures.length - 5} more)` : '';
    throw new Error(`Import extraction reported failures: ${preview}${suffix}`);
  }
  const selective = extraction?.importMap ?? {};
  const currentPaths = new Set(currentScan.files.map(file => file.path));
  const importMap = {};
  for (const file of currentScan.files) {
    const path = file.path;
    const candidate = Object.hasOwn(selective, path)
      ? selective[path]
      : previousScan?.importMap?.[path];
    importMap[path] = Array.isArray(candidate)
      ? sorted(candidate.filter(target => typeof target === 'string' && currentPaths.has(target)))
      : [];
  }
  return importMap;
}

function pruneExistingGraph(graph, pathsToReplace, importPathsToRefresh = new Set()) {
  const removedNodeIds = new Set();
  const refreshedImportSourceIds = new Set();
  const nodes = [];
  for (const node of graph?.nodes ?? []) {
    const path = normalizeRelativePath(node?.filePath);
    if (path && pathsToReplace.has(path)) removedNodeIds.add(node.id);
    else {
      nodes.push(node);
      if (
        path
        && importPathsToRefresh.has(path)
        && WHOLE_FILE_TYPES.has(node.type)
        && node.id === `${node.type}:${path}`
      ) {
        refreshedImportSourceIds.add(node.id);
      }
    }
  }
  const retainedIds = new Set(nodes.map(node => node.id));
  const edges = (graph?.edges ?? []).filter(
    edge =>
      !removedNodeIds.has(edge.source)
      && !removedNodeIds.has(edge.target)
      && !(edge.type === 'imports' && refreshedImportSourceIds.has(edge.source))
      && retainedIds.has(edge.source)
      && retainedIds.has(edge.target),
  );
  return { nodes, edges };
}

function parseArgs(argv) {
  const positionals = [];
  const excludePatterns = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--exclude') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--exclude requires patterns');
      excludePatterns.push(...value.split(',').map(item => item.trim()).filter(Boolean));
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 2) {
    throw new Error(
      'Usage: node prepare-incremental.mjs <projectRoot> <baseCommit> [--exclude <patterns>]',
    );
  }
  return { projectRoot: positionals[0], baseCommit: positionals[1], excludePatterns };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = realpathSync(args.projectRoot);
  const uaDir = resolveUaDir(projectRoot);
  const intermediateDir = join(uaDir, 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });

  const baseCommit = resolveCommit(projectRoot, args.baseCommit);
  const headCommit = resolveCommit(projectRoot, 'HEAD');
  const dirtyPaths = relevantWorktreeChanges(projectRoot, args.excludePatterns);
  if (dirtyPaths.length > 0) {
    const preview = dirtyPaths.slice(0, 10).join(', ');
    const suffix = dirtyPaths.length > 10 ? ` (+${dirtyPaths.length - 10} more)` : '';
    throw new Error(
      `Working tree has relevant uncommitted changes: ${preview}${suffix}. ` +
      `Commit or stash them before incremental analysis so the HEAD baseline remains reproducible.`,
    );
  }
  const changes = parseNameStatusZ(
    run(
      'git',
      ['diff', '--name-status', '-z', '--relative', baseCommit, headCommit, '--', '.'],
      { cwd: projectRoot },
    ),
  );
  const diffPaths = pathsFromChanges(changes);

  const scanPath = join(intermediateDir, 'scan-result.json');
  const oldScan = readJson(scanPath, {});
  const graph = readJson(join(uaDir, 'knowledge-graph.json'), {});
  const oldFingerprints = normalizeFingerprintStore(
    readJson(join(uaDir, 'fingerprints.json'), null),
    baseCommit,
  );
  const baselineSnapshotPath = join(intermediateDir, 'incremental-baseline.json');
  const existingSnapshot = readJson(baselineSnapshotPath, null);
  const baselineScan = existingSnapshot?.baseCommit === baseCommit
    ? existingSnapshot.scan
    : oldScan;
  const baselineGraph = existingSnapshot?.baseCommit === baseCommit && existingSnapshot.graph
    ? existingSnapshot.graph
    : graph;
  if (!Array.isArray(baselineGraph.nodes) || !Array.isArray(baselineGraph.edges)) {
    throw new Error('A valid previous graph is required for incremental symbol protection');
  }
  if (existingSnapshot?.baseCommit !== baseCommit || !existingSnapshot.graph) {
    if (graph?.project?.gitCommitHash && graph.project.gitCommitHash !== baseCommit) {
      throw new Error('Previous graph commit does not match the requested base and no symbol baseline exists; cannot safely retry');
    }
    atomicWriteJson(baselineSnapshotPath, { baseCommit, scan: baselineScan, graph: baselineGraph });
  }
  // A failed prior attempt can leave complete or split analyzer batches behind.
  // Remove only known internal scratch names before planning the retry so the
  // merge cannot resurrect deleted nodes from stale output.
  clearIncrementalScratch(intermediateDir);

  const currentScanPath = join(intermediateDir, 'current-scan.json');
  const currentScan = runScan(projectRoot, currentScanPath, args.excludePatterns);
  const scanFailures = Array.isArray(currentScan?.failures) ? currentScan.failures : [];
  if (scanFailures.length > 0) {
    const preview = scanFailures
      .slice(0, 5)
      .map(failure => `${failure.path ?? '<global>'} (${failure.stage})`)
      .join(', ');
    const suffix = scanFailures.length > 5 ? ` (+${scanFailures.length - 5} more)` : '';
    throw new Error(`Project scan reported failures: ${preview}${suffix}`);
  }
  const currentInventory = sorted(currentScan.files.map(file => file.path));
  const currentInventorySet = new Set(currentInventory);
  // The durable graph may have advanced before a failed fingerprints/meta save.
  // Use only the preserved graph, even when retrying against a different HEAD.
  const oldInventory = inventoryFrom(baselineScan, baselineGraph, oldFingerprints);
  const oldInventorySet = new Set(oldInventory);
  const trackedPaths = new Set(parseNulPaths(run(
    'git',
    ['ls-files', '--cached', '-z', '--', '.'],
    { cwd: projectRoot },
  )));
  const currentIgnoreFilter = createIgnoreFilter(projectRoot, args.excludePatterns);
  const unexplainedMissingFiles = oldInventory.filter(path =>
    !currentInventorySet.has(path)
    && trackedPaths.has(path)
    && !currentIgnoreFilter.isIgnored(path)
    && !isTrackedSymlink(projectRoot, path),
  );
  if (unexplainedMissingFiles.length > 0) {
    throw new Error(
      `Project scan omitted tracked, non-ignored files: ` +
      `${unexplainedMissingFiles.slice(0, 10).join(', ')}. Baseline not advanced.`,
    );
  }

  const generatedArtifactFiles = sorted(diffPaths.filter(isGeneratedArtifact));
  const nonGeneratedDiffPaths = diffPaths.filter(path => !isGeneratedArtifact(path));
  const deletedFiles = sorted(oldInventory.filter(path => !currentInventorySet.has(path)));
  const ignoredFiles = sorted(
    nonGeneratedDiffPaths.filter(
      path => !currentInventorySet.has(path) && !oldInventorySet.has(path),
    ),
  );
  const currentChangedPaths = sorted([
    ...nonGeneratedDiffPaths.filter(path => currentInventorySet.has(path)),
    ...currentInventory.filter(path => !oldInventorySet.has(path)),
  ]);

  const currentFingerprints = await buildCurrentFingerprints(
    projectRoot,
    currentChangedPaths,
    headCommit,
  );
  const analysis = analyzeInventoryChanges({
    currentChangedPaths,
    currentFingerprints,
    oldFingerprints,
    oldInventory,
    deletedFiles,
  });
  const decision = classifyUpdate(
    analysis,
    oldInventory.length,
    oldInventory,
    currentInventory,
  );

  const onlyGeneratedArtifacts =
    generatedArtifactFiles.length > 0
    && nonGeneratedDiffPaths.length === 0
    && deletedFiles.length === 0
    && currentChangedPaths.length === 0;
  if (decision.action === 'SKIP') {
    if (onlyGeneratedArtifacts) {
      decision.reason = 'Only generated analysis artifacts changed; baseline not advanced';
    } else if (ignoredFiles.length > 0 && analysis.cosmeticOnlyFiles.length === 0) {
      decision.reason = `${ignoredFiles.length} changed file(s) are outside the current analysis inventory`;
    }
  }

  const filesToReanalyze = sorted(
    decision.filesToReanalyze.filter(path => currentInventorySet.has(path)),
  );
  const missingImportEntries = currentInventory.filter(
    path => !Object.hasOwn(baselineScan?.importMap ?? {}, path),
  );
  // Adding/removing a resolution candidate can change an unchanged importer's
  // winner (foo.ts vs foo.js vs foo/index.ts). Resolver configuration edits
  // likewise affect importers that did not change. Recompute the complete map
  // for those inventory/context changes; ordinary file edits remain selective.
  const importResolutionContextChanged =
    analysis.newFiles.length > 0
    || deletedFiles.length > 0
    || currentChangedPaths.some(isImportResolverConfig);
  const importAnalysisPaths = importResolutionContextChanged
    ? currentInventory
    : sorted([...currentChangedPaths, ...missingImportEntries]);
  const importMap = refreshImportMap({
    projectRoot,
    intermediateDir,
    previousScan: baselineScan,
    currentScan,
    analysisPaths: importAnalysisPaths,
  });

  const refreshedScan = {
    ...oldScan,
    contentDigest: currentScan.contentDigest,
    files: currentScan.files,
    totalFiles: currentScan.totalFiles,
    filteredByIgnore: currentScan.filteredByIgnore,
    estimatedComplexity: currentScan.estimatedComplexity,
    importMap,
  };
  delete refreshedScan.scriptCompleted;
  delete refreshedScan.stats;
  if (!Object.hasOwn(refreshedScan, 'name')) refreshedScan.name = basename(projectRoot);
  if (!Object.hasOwn(refreshedScan, 'description')) refreshedScan.description = 'No description available';
  if (!Array.isArray(refreshedScan.languages)) refreshedScan.languages = [];
  if (!Array.isArray(refreshedScan.frameworks)) refreshedScan.frameworks = [];

  // Generated-only commits intentionally keep every baseline artifact tied to
  // the last analyzed source commit. Other zero-token paths still refresh the
  // deterministic scan so cosmetic line counts and ignore changes are saved.
  if (!onlyGeneratedArtifacts) atomicWriteJson(scanPath, refreshedScan);

  const plan = {
    baseCommit,
    headCommit,
    action: decision.action,
    filesToReanalyze,
    deletedFiles,
    cosmeticFiles: analysis.cosmeticOnlyFiles,
    ignoredFiles,
    generatedArtifactFiles,
    importMapRefreshPaths: importAnalysisPaths,
    rerunArchitecture: decision.rerunArchitecture,
    rerunTour: decision.rerunTour,
    reason: decision.reason,
  };

  // Always derive this manifest from the immutable pre-update graph, including
  // on repeated prepare calls after an unsuccessful merge/finalization.
  const symbolFiles = filesToReanalyze.map(filePath => {
    const nodes = baselineGraph.nodes.filter(node => normalizeRelativePath(node.filePath) === filePath);
    const ids = new Set(nodes.map(node => node.id));
    return {
      filePath,
      nodes,
      edges: baselineGraph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
    };
  });
  atomicWriteJson(join(intermediateDir, 'incremental-symbol-baseline.json'), {
    version: 1, baseCommit, headCommit, files: symbolFiles,
  });
  const retryPath = join(intermediateDir, 'incremental-symbol-retry.json');
  const retry = readJson(retryPath);
  if (retry && (retry.baseCommit !== baseCommit || retry.headCommit !== headCommit)) {
    unlinkSync(retryPath);
  } else if (retry) {
    // Retain the attempt limit, but never import current-analysis candidates
    // from a discarded batch generation into a fresh prepare run.
    delete retry.inboundEdgeCandidates;
    delete retry.replacedFiles;
    delete retry.currentFiles;
    atomicWriteJson(retryPath, retry);
  }

  atomicWriteJson(join(intermediateDir, 'fingerprint-patch.json'), {
    version: '1.0.0',
    baseCommit,
    headCommit,
    generatedAt: currentFingerprints.generatedAt,
    files: currentFingerprints.files,
    deletedFiles,
  });
  atomicWriteJson(join(intermediateDir, 'changed-files.json'), filesToReanalyze);

  if (decision.action === 'PARTIAL_UPDATE' || decision.action === 'ARCHITECTURE_UPDATE') {
    const pathsToReplace = new Set([...filesToReanalyze, ...deletedFiles]);
    atomicWriteJson(
      join(intermediateDir, 'batch-existing.json'),
      pruneExistingGraph(baselineGraph, pathsToReplace, new Set(importAnalysisPaths)),
    );
  }
  atomicWriteJson(join(intermediateDir, 'incremental-plan.json'), plan);

  process.stdout.write(
    `Incremental plan: ${plan.action}; analyze=${filesToReanalyze.length}; ` +
    `delete=${deletedFiles.length}; cosmetic=${plan.cosmeticFiles.length}; ` +
    `ignored=${ignoredFiles.length}; generated=${generatedArtifactFiles.length}\n`,
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
    process.stderr.write(`prepare-incremental.mjs failed: ${error.message}\n${error.stack}\n`);
    process.exit(1);
  }
}

export {
  isGeneratedArtifact,
  isImportResolverConfig,
  normalizeRelativePath,
  relevantWorktreeChanges,
  parseNameStatusZ,
  pruneExistingGraph,
};
