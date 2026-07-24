import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  arch,
  cpus,
  platform,
  release,
  tmpdir,
  totalmem,
} from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { estimatedAgentInputBytes } from '../../understand-anything-plugin/skills/understand/analysis-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
export const REPORT_SCHEMA_VERSION = '1.0.0';
export const REPORT_SCHEMA_URL =
  'https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/docs/benchmarks/large-repo-report-1.0.0.schema.json';

const WORKER = resolve(__dirname, 'benchmark-stage-worker.mjs');
const SCAN_SCRIPT = resolve(
  REPO_ROOT,
  'understand-anything-plugin/skills/understand/scan-project.mjs',
);
const IMPORT_SCRIPT = resolve(
  REPO_ROOT,
  'understand-anything-plugin/skills/understand/extract-import-map.mjs',
);
const BATCH_SCRIPT = resolve(
  REPO_ROOT,
  'understand-anything-plugin/skills/understand/compute-batches.mjs',
);
const STRUCTURE_SCRIPT = resolve(
  REPO_ROOT,
  'understand-anything-plugin/skills/understand/extract-structure.mjs',
);

export const STAGE_METRICS_PREFIX = '__UA_BENCHMARK_METRICS__';
const DEFAULT_CONCURRENCY = 5;
export const GIT_METADATA_MAX_BUFFER = 64 * 1024;
// Child helpers can be noisy on large repositories. Retain at most 128 KiB
// from each stream while continuing to drain and inspect all child output.
export const STAGE_OUTPUT_MAX_BYTES = 128 * 1024;
export const WARNING_SAMPLE_LIMIT = 5;
export const STRUCTURE_DIAGNOSTIC_SAMPLE_MAX_BYTES = 4 * 1024;
const ENTITY_FIELDS = [
  'functions',
  'classes',
  'exports',
  'callGraph',
  'definitions',
  'services',
  'endpoints',
  'steps',
  'resources',
];

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export class BenchmarkStageError extends Error {
  constructor(stage) {
    super(`Benchmark stage failed: ${stage.name}`);
    this.name = 'BenchmarkStageError';
    this.stage = stage;
  }
}

export class BenchmarkReportWriteError extends Error {
  constructor(artifactRoot = null, recovery = {}) {
    super('Unable to write benchmark report files');
    this.name = 'BenchmarkReportWriteError';
    this.artifactRoot = artifactRoot;
    this.recovery = {
      lockAcquisitionFailed: recovery.lockAcquisitionFailed ?? false,
      rollbackRemoveFailures: recovery.rollbackRemoveFailures ?? 0,
      restoreFailures: recovery.restoreFailures ?? 0,
      tempCleanupFailures: recovery.tempCleanupFailures ?? 0,
      backupCleanupFailures: recovery.backupCleanupFailures ?? 0,
      lockReleaseFailures: recovery.lockReleaseFailures ?? 0,
    };
  }
}

export class BenchmarkArtifactCleanupError extends Error {
  constructor() {
    super('Unable to remove temporary benchmark artifacts');
    this.name = 'BenchmarkArtifactCleanupError';
  }
}

export function cleanupBenchmarkArtifacts(artifactRoot, operations = {}) {
  const remove = operations.rmSync ?? rmSync;
  try {
    remove(artifactRoot, { recursive: true, force: true });
  } catch {
    throw new BenchmarkArtifactCleanupError();
  }
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

function parseConcurrency(value) {
  return /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
}

function canonicalizePhysicalPath(pathValue) {
  const lexicalPath = resolve(withoutExtendedWindowsPrefix(pathValue));
  const missingComponents = [];
  let existingAncestor = lexicalPath;
  let ancestorExists = existsSync(existingAncestor);

  while (!ancestorExists) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingComponents.unshift(basename(existingAncestor));
    existingAncestor = parent;
    ancestorExists = existsSync(existingAncestor);
  }

  let physicalAncestor = existingAncestor;
  if (ancestorExists) {
    try {
      const nativeRealpath = realpathSync.native ?? realpathSync;
      physicalAncestor = nativeRealpath(existingAncestor);
    } catch {
      // Fall back to the resolved lexical ancestor if metadata becomes unavailable.
    }
  }
  return resolve(
    withoutExtendedWindowsPrefix(physicalAncestor),
    ...missingComponents,
  );
}

export function isPathInsideOrEqual(rootPath, candidatePath) {
  const relationship = relative(
    canonicalizePhysicalPath(rootPath),
    canonicalizePhysicalPath(candidatePath),
  );
  return (
    relationship === '' ||
    (relationship !== '..' &&
      !relationship.startsWith(`..${sep}`) &&
      !isAbsolute(relationship))
  );
}

export function parseArgs(argv, cwd = process.cwd()) {
  let repoValue = null;
  let outputValue = null;
  let label = null;
  let concurrency = DEFAULT_CONCURRENCY;
  let keepArtifacts = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--keep-artifacts') {
      keepArtifacts = true;
      continue;
    }
    if (arg === '--repo') {
      repoValue = takeValue(argv, i, '--repo');
      i += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      repoValue = arg.slice('--repo='.length);
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      outputValue = takeValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      outputValue = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--label') {
      label = takeValue(argv, i, '--label');
      i += 1;
      continue;
    }
    if (arg.startsWith('--label=')) {
      label = arg.slice('--label='.length);
      continue;
    }
    if (arg === '--concurrency') {
      const raw = takeValue(argv, i, '--concurrency');
      concurrency = parseConcurrency(raw);
      i += 1;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      concurrency = parseConcurrency(arg.slice('--concurrency='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    if (repoValue) {
      throw new CliUsageError(`Unexpected positional argument: ${arg}`);
    }
    repoValue = arg;
  }

  if (help) return { help: true };
  if (!repoValue) throw new CliUsageError('A repository path is required');
  if (outputValue === null || outputValue.trim() === '') {
    throw new CliUsageError('--output is required and must be non-empty');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new CliUsageError('--concurrency must be an integer between 1 and 32');
  }

  const repoRoot = resolve(cwd, repoValue);
  if (!existsSync(repoRoot)) {
    throw new CliUsageError(`Repository path does not exist: ${repoValue}`);
  }
  if (!statSync(repoRoot).isDirectory()) {
    throw new CliUsageError(`Repository path is not a directory: ${repoValue}`);
  }

  const outputPath = resolve(cwd, outputValue);
  const markdownPath = resolve(
    cwd,
    outputPath.toLowerCase().endsWith('.json')
      ? `${outputPath.slice(0, -'.json'.length)}.md`
      : `${outputPath}.md`,
  );
  if (isPathInsideOrEqual(repoRoot, outputPath)) {
    throw new CliUsageError('--output must be outside the subject repository');
  }
  if (isPathInsideOrEqual(repoRoot, markdownPath)) {
    throw new CliUsageError('Markdown report path must be outside the subject repository');
  }

  return {
    help: false,
    repoRoot,
    outputPath,
    markdownPath,
    label: label || basename(repoRoot),
    concurrency,
    keepArtifacts,
  };
}

export function helpText() {
  return `Usage:
  node scripts/benchmark-large-repo.mjs <repo-path> --output <path> [options]
  node scripts/benchmark-large-repo.mjs --repo <repo-path> --output <path> [options]

Options:
  -o, --output <path>       JSON report path (required)
      --label <name>        Public label for the subject repository
      --concurrency <1-32>  Structural extraction workers (default: 5)
      --keep-artifacts      Preserve temporary deterministic outputs
  -h, --help                Show this help

This v1 runner measures deterministic helpers only. It does not invoke an LLM
and keeps all intermediate artifacts outside the subject repository.
`;
}

function gitProbe(directory, args) {
  return spawnSync(
    'git',
    ['-c', 'core.optionalLocks=false', '-C', directory, ...args],
    {
      encoding: 'utf-8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      maxBuffer: GIT_METADATA_MAX_BUFFER,
      windowsHide: true,
    },
  );
}

export function gitMetadata(directory) {
  const commit = gitProbe(directory, ['rev-parse', 'HEAD']);
  if (commit.status !== 0) return { commit: null, dirty: null };

  const status = gitProbe(directory, ['status', '--porcelain']);
  return {
    commit: commit.stdout.trim() || null,
    dirty:
      status.error?.code === 'ENOBUFS'
        ? true
        : status.status === 0
          ? status.stdout.trim().length > 0
          : null,
  };
}

function environmentMetadata() {
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    nodeVersion: process.version,
    cpuModel: processors[0]?.model ?? 'unknown',
    logicalCores: processors.length,
    totalMemoryBytes: totalmem(),
  };
}

function packageVersion() {
  const packageJson = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'understand-anything-plugin/package.json'), 'utf-8'),
  );
  return packageJson.version;
}

function withoutExtendedWindowsPrefix(pathValue) {
  const extendedUncPrefix = pathValue.match(/^[\\/]{2}\?[\\/]unc[\\/]/i)?.[0];
  if (extendedUncPrefix) {
    return `\\\\${pathValue
      .slice(extendedUncPrefix.length)
      .replaceAll('/', '\\')}`;
  }
  const extendedPrefix = pathValue.match(/^[\\/]{2}\?[\\/]/)?.[0];
  if (extendedPrefix) {
    return pathValue.slice(extendedPrefix.length);
  }
  return pathValue;
}

function extendedWindowsPath(pathValue) {
  const windowsPath = pathValue.replaceAll('/', '\\');
  if (windowsPath.startsWith('\\\\?\\')) return windowsPath;
  if (/^[A-Za-z]:\\/.test(windowsPath)) return `\\\\?\\${windowsPath}`;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return null;
}

function addRootAliases(aliases, root, replacement) {
  if (!root) return;
  const resolvedRoot = resolve(root);
  const resolvedAliases = new Set([resolvedRoot]);
  try {
    const nativeRealpath = realpathSync.native ?? realpathSync;
    resolvedAliases.add(nativeRealpath(resolvedRoot));
  } catch {
    // Missing or inaccessible roots still retain their lexical aliases.
  }

  for (const resolvedAlias of resolvedAliases) {
    const plainAlias = withoutExtendedWindowsPrefix(resolvedAlias);
    const pathAliases = new Set([resolvedAlias, plainAlias]);
    for (const pathAlias of pathAliases) {
      aliases.push([pathAlias, replacement]);
      aliases.push([pathAlias.replaceAll('\\', '/'), replacement]);
      aliases.push([pathAlias.replaceAll('/', '\\'), replacement]);
      const extendedAlias = extendedWindowsPath(pathAlias);
      if (extendedAlias) aliases.push([extendedAlias, replacement]);
      try {
        aliases.push([pathToFileURL(pathAlias).href, replacement]);
      } catch {
        // Non-file path aliases are already represented in native forms.
      }
    }
  }
}

function hasPathBoundary(text, index) {
  if (index >= text.length) return true;
  return (
    text[index] === '/' ||
    text[index] === '\\' ||
    text[index] === '\n' ||
    text[index] === '\r' ||
    text[index] === '\t'
  );
}

function replacePathAlias(text, alias, replacement, caseInsensitive) {
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? alias.toLowerCase() : alias;
  let emittedUntil = 0;
  let searchFrom = 0;
  let result = '';

  while (searchFrom < haystack.length) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) break;
    const end = index + needle.length;
    if (hasPathBoundary(text, end)) {
      result += text.slice(emittedUntil, index) + replacement;
      emittedUntil = end;
      searchFrom = end;
    } else {
      searchFrom = index + 1;
    }
  }
  return result + text.slice(emittedUntil);
}

export function redactPaths(text, roots) {
  const aliases = [];
  for (const [root, replacement] of roots) {
    addRootAliases(aliases, root, replacement);
  }
  const caseInsensitive = process.platform === 'win32';
  const uniqueAliases = new Map();
  for (const [alias, replacement] of aliases) {
    const key = caseInsensitive ? alias.toLowerCase() : alias;
    if (alias && !uniqueAliases.has(key)) {
      uniqueAliases.set(key, [alias, replacement]);
    }
  }

  let redacted = text;
  for (const [alias, replacement] of [...uniqueAliases.values()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    redacted = replacePathAlias(
      redacted,
      alias,
      replacement,
      caseInsensitive,
    );
  }
  return redacted;
}

function createBoundedByteCollector(maxBytes = STAGE_OUTPUT_MAX_BYTES) {
  const buffer = Buffer.allocUnsafe(maxBytes);
  let length = 0;
  let truncated = false;

  return {
    append(value) {
      const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const copyLength = Math.min(source.length, maxBytes - length);
      if (copyLength > 0) {
        source.copy(buffer, length, 0, copyLength);
        length += copyLength;
      }
      if (copyLength < source.length) truncated = true;
    },
    text() {
      return buffer.subarray(0, length).toString('utf-8');
    },
    get truncated() {
      return truncated;
    },
  };
}

function boundUtf8(text, maxBytes = STAGE_OUTPUT_MAX_BYTES) {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const decoder = new StringDecoder('utf8');
  return {
    text: decoder.write(bytes.subarray(0, maxBytes)),
    truncated: true,
  };
}

function sanitizeBounded(text, redactionRoots) {
  return boundUtf8(redactPaths(text, redactionRoots));
}

function createStderrInspector() {
  const decoder = new StringDecoder('utf8');
  const retained = createBoundedByteCollector();
  const rawWarningMessages = [];
  let warningCount = 0;
  let warningMessageTruncated = false;
  let metrics = null;
  let lineKind = 'probing';
  let lineProbe = '';
  let lineCollector = null;

  function classifyProbe() {
    if (lineProbe === STAGE_METRICS_PREFIX) {
      lineKind = 'metrics';
      lineCollector = createBoundedByteCollector();
      return;
    }
    if (lineProbe === 'Warning:') {
      lineKind = 'warning';
      retained.append(lineProbe);
      if (rawWarningMessages.length < WARNING_SAMPLE_LIMIT) {
        lineCollector = createBoundedByteCollector();
        lineCollector.append(lineProbe);
      }
      return;
    }
    if (
      STAGE_METRICS_PREFIX.startsWith(lineProbe) ||
      'Warning:'.startsWith(lineProbe)
    ) {
      return;
    }
    lineKind = 'ordinary';
    retained.append(lineProbe);
  }

  function processFragment(fragment) {
    let offset = 0;
    while (lineKind === 'probing' && offset < fragment.length) {
      lineProbe += fragment[offset];
      offset += 1;
      classifyProbe();
    }
    if (offset >= fragment.length) return;
    const remainder = fragment.slice(offset);
    if (lineKind === 'metrics') {
      lineCollector.append(remainder);
    } else {
      retained.append(remainder);
      if (lineKind === 'warning' && lineCollector) {
        lineCollector.append(remainder);
      }
    }
  }

  function finishLine(retainNewline) {
    if (lineKind === 'probing') retained.append(lineProbe);
    if (lineKind === 'metrics') {
      try {
        metrics = JSON.parse(lineCollector.text().replace(/\r$/, ''));
      } catch {
        // A malformed or oversized marker means telemetry is unavailable;
        // child exit status and parent wall clock remain authoritative.
      }
    } else {
      if (lineKind === 'warning') {
        warningCount += 1;
        if (lineCollector) {
          rawWarningMessages.push(lineCollector.text().replace(/\r$/, ''));
          warningMessageTruncated ||= lineCollector.truncated;
        }
      }
      if (retainNewline) retained.append('\n');
    }
    lineKind = 'probing';
    lineProbe = '';
    lineCollector = null;
  }

  function processText(text) {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      if (newline === -1) {
        processFragment(text.slice(offset));
        return;
      }
      processFragment(text.slice(offset, newline));
      finishLine(true);
      offset = newline + 1;
    }
  }

  return {
    write(chunk) {
      processText(decoder.write(chunk));
    },
    finish(redactionRoots) {
      processText(decoder.end());
      if (lineKind !== 'probing' || lineProbe.length > 0) finishLine(false);
      const retainedStderr = retained.text().replace(/[\r\n]+$/, '');
      const safeStderr = sanitizeBounded(retainedStderr, redactionRoots);
      const warningMessages = rawWarningMessages.map((message) =>
        sanitizeBounded(message, redactionRoots),
      );
      return {
        metrics,
        stderr: safeStderr.text,
        stderrTruncated: retained.truncated || safeStderr.truncated,
        warningCount,
        warningMessages: warningMessages.map((message) => message.text),
        warningMessagesTruncated:
          warningCount > warningMessages.length ||
          warningMessageTruncated ||
          warningMessages.some((message) => message.truncated),
      };
    },
  };
}

export function runNodeStage(name, scriptPath, args, redactionRoots = []) {
  const startedAt = performance.now();
  return new Promise((resolveStage) => {
    const child = spawn(
      process.execPath,
      [WORKER, scriptPath, ...args],
      { cwd: REPO_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const stdoutCollector = createBoundedByteCollector();
    const stderrInspector = createStderrInspector();
    let settled = false;

    child.stdout.on('data', (chunk) => stdoutCollector.append(chunk));
    child.stderr.on('data', (chunk) => stderrInspector.write(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const safeError = sanitizeBounded(error.message, redactionRoots);
      resolveStage({
        name,
        status: 'failed',
        exitCode: null,
        durationMs,
        peakRssBytes: null,
        userCpuTimeMicros: null,
        systemCpuTimeMicros: null,
        warningCount: 0,
        warningMessages: [],
        warningMessagesTruncated: false,
        stdout: '',
        stderr: safeError.text,
        stdoutTruncated: false,
        stderrTruncated: safeError.truncated,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const safeStdout = sanitizeBounded(stdoutCollector.text(), redactionRoots);
      const inspectedStderr = stderrInspector.finish(redactionRoots);
      const { metrics } = inspectedStderr;
      resolveStage({
        name,
        status: code === 0 ? 'ok' : 'failed',
        exitCode: code,
        durationMs,
        peakRssBytes: metrics?.peakRssBytes ?? null,
        userCpuTimeMicros: metrics?.userCpuTimeMicros ?? null,
        systemCpuTimeMicros: metrics?.systemCpuTimeMicros ?? null,
        warningCount: inspectedStderr.warningCount,
        warningMessages: inspectedStderr.warningMessages,
        warningMessagesTruncated: inspectedStderr.warningMessagesTruncated,
        stdout: safeStdout.text,
        stderr: inspectedStderr.stderr,
        stdoutTruncated: stdoutCollector.truncated || safeStdout.truncated,
        stderrTruncated: inspectedStderr.stderrTruncated,
      });
    });
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isStringCountMap(value) {
  return (
    isRecord(value) && Object.values(value).every(isNonNegativeInteger)
  );
}

function validateScanArtifact(scan) {
  if (
    !isRecord(scan) ||
    scan.scriptCompleted !== true ||
    !Array.isArray(scan.files) ||
    !isNonNegativeInteger(scan.totalFiles) ||
    scan.totalFiles !== scan.files.length ||
    !isNonNegativeInteger(scan.filteredByIgnore) ||
    !isRecord(scan.stats) ||
    !isNonNegativeInteger(scan.stats.filesScanned) ||
    scan.stats.filesScanned !== scan.totalFiles ||
    !isStringCountMap(scan.stats.byCategory) ||
    !isStringCountMap(scan.stats.byLanguage) ||
    typeof scan.contentDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(scan.contentDigest) ||
    scan.files.some(
      (file) =>
        !isRecord(file) ||
        typeof file.path !== 'string' ||
        file.path.length === 0 ||
        !isNonNegativeInteger(file.sizeLines),
    )
  ) {
    throw new Error('Scan artifact does not match the required shape');
  }
}

function validateImportArtifact(imports) {
  if (
    !isRecord(imports) ||
    imports.scriptCompleted !== true ||
    !isRecord(imports.importMap) ||
    !isRecord(imports.stats) ||
    !isNonNegativeInteger(imports.stats.filesScanned) ||
    !isNonNegativeInteger(imports.stats.filesWithImports) ||
    !isNonNegativeInteger(imports.stats.totalEdges) ||
    Object.values(imports.importMap).some(
      (targets) =>
        !Array.isArray(targets) ||
        targets.some((target) => typeof target !== 'string'),
    )
  ) {
    throw new Error('Import artifact does not match the required shape');
  }
}

function validateBatchArtifact(batches) {
  if (
    !isRecord(batches) ||
    batches.schemaVersion !== 1 ||
    typeof batches.algorithm !== 'string' ||
    batches.algorithm.length === 0 ||
    !Array.isArray(batches.batches) ||
    !isNonNegativeInteger(batches.totalBatches) ||
    batches.totalBatches !== batches.batches.length ||
    batches.batches.some(
      (batch) =>
        !isRecord(batch) ||
        !isNonNegativeInteger(batch.batchIndex) ||
        !Array.isArray(batch.files) ||
        !isRecord(batch.batchImportData) ||
        !isRecord(batch.neighborMap),
    )
  ) {
    throw new Error('Batch artifact does not match the required shape');
  }
}

function markArtifactFailure(stage, stageName, error, redactionRoots) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = sanitizeBounded(
    `${stageName} stage produced an invalid artifact: ${rawMessage}`,
    redactionRoots,
  );
  stage.status = 'failed';
  stage.stderr = safeMessage.text;
  stage.stderrTruncated ||= safeMessage.truncated;
}

function fileSizeOrZero(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function preflightReportTargets(paths, fileSystem) {
  for (const path of paths) {
    if (fileSystem.existsSync(path) && fileSystem.statSync(path).isDirectory()) {
      throw new Error('A benchmark report target is a directory');
    }
  }
}

function tryRemove(path, fileSystem) {
  try {
    fileSystem.rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function rollbackReportEntry(entry, fileSystem, recovery) {
  if (entry.backupMoved) {
    if (!tryRemove(entry.targetPath, fileSystem)) {
      recovery.rollbackRemoveFailures += 1;
    }
    try {
      fileSystem.renameSync(entry.backupPath, entry.targetPath);
    } catch {
      recovery.restoreFailures += 1;
    }
  } else if (!entry.hadOriginal && entry.installAttempted) {
    if (!tryRemove(entry.targetPath, fileSystem)) {
      recovery.rollbackRemoveFailures += 1;
    }
  }
}

export function reportPairLockPath(outputPath, markdownPath) {
  const outputDirectory = canonicalizePhysicalPath(dirname(outputPath));
  const markdownDirectory = canonicalizePhysicalPath(dirname(markdownPath));
  const normalizePairPath = (pathValue) =>
    process.platform === 'win32' ? pathValue.toLowerCase() : pathValue;
  if (
    normalizePairPath(outputDirectory) !==
    normalizePairPath(markdownDirectory)
  ) {
    throw new Error('Benchmark report files must share a directory');
  }
  const normalizedOutputPath = normalizePairPath(
    canonicalizePhysicalPath(outputPath),
  );
  const normalizedMarkdownPath = normalizePairPath(
    canonicalizePhysicalPath(markdownPath),
  );
  const pairKey = createHash('sha256')
    .update(normalizedOutputPath)
    .update('\0')
    .update(normalizedMarkdownPath)
    .digest('hex')
    .slice(0, 24);
  return join(resolve(dirname(outputPath)), `.ua-report-pair-${pairKey}.lock`);
}

function stageReportEntry(entry, fileSystem) {
  let descriptor;
  let stageError = null;
  try {
    descriptor = fileSystem.openSync(entry.tempPath, 'wx');
    entry.tempCreated = true;
    fileSystem.writeFileSync(descriptor, entry.contents, {
      encoding: 'utf-8',
    });
  } catch (error) {
    stageError = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fileSystem.closeSync(descriptor);
      } catch (error) {
        stageError ??= error;
      }
    }
  }
  if (stageError) throw stageError;
}

export function deliverBenchmarkReports(reportFiles, operations = {}) {
  const fileSystem = {
    closeSync: operations.closeSync ?? closeSync,
    existsSync: operations.existsSync ?? existsSync,
    mkdirSync: operations.mkdirSync ?? mkdirSync,
    openSync: operations.openSync ?? openSync,
    renameSync: operations.renameSync ?? renameSync,
    rmSync: operations.rmSync ?? rmSync,
    statSync: operations.statSync ?? statSync,
    writeFileSync: operations.writeFileSync ?? writeFileSync,
  };
  const transactionId = randomUUID();
  const recovery = {
    lockAcquisitionFailed: false,
    rollbackRemoveFailures: 0,
    restoreFailures: 0,
    tempCleanupFailures: 0,
    backupCleanupFailures: 0,
    lockReleaseFailures: 0,
  };
  let deliveryFailed = false;
  let lockOwned = false;
  let lockPath = null;
  const entries = [
    [reportFiles.outputPath, reportFiles.jsonContents],
    [reportFiles.markdownPath, reportFiles.markdownContents],
  ].map(([targetPath, contents]) => ({
    targetPath,
    contents,
    tempPath: join(
      dirname(targetPath),
      `.${basename(targetPath)}.ua-report-${transactionId}.tmp`,
    ),
    backupPath: join(
      dirname(targetPath),
      `.${basename(targetPath)}.ua-report-${transactionId}.backup`,
    ),
    hadOriginal: false,
    tempCreated: false,
    backupMoved: false,
    installAttempted: false,
  }));

  try {
    for (const entry of entries) {
      fileSystem.mkdirSync(dirname(entry.targetPath), { recursive: true });
    }
    lockPath = reportPairLockPath(
      reportFiles.outputPath,
      reportFiles.markdownPath,
    );
    let lockDescriptor;
    try {
      lockDescriptor = fileSystem.openSync(lockPath, 'wx');
      lockOwned = true;
      fileSystem.closeSync(lockDescriptor);
    } catch (error) {
      if (!lockOwned) recovery.lockAcquisitionFailed = true;
      throw error;
    }
    preflightReportTargets(
      entries.map((entry) => entry.targetPath),
      fileSystem,
    );
    for (const entry of entries) {
      if (
        fileSystem.existsSync(entry.tempPath) ||
        fileSystem.existsSync(entry.backupPath)
      ) {
        throw new Error('A report transaction path already exists');
      }
      entry.hadOriginal = fileSystem.existsSync(entry.targetPath);
      stageReportEntry(entry, fileSystem);
    }
    for (const entry of entries) {
      if (entry.hadOriginal) {
        fileSystem.renameSync(entry.targetPath, entry.backupPath);
        entry.backupMoved = true;
      }
    }
    for (const entry of entries) {
      entry.installAttempted = true;
      fileSystem.renameSync(entry.tempPath, entry.targetPath);
    }
    for (const entry of entries) {
      if (entry.backupMoved) {
        if (!tryRemove(entry.backupPath, fileSystem)) {
          recovery.backupCleanupFailures += 1;
        }
      }
    }
  } catch {
    deliveryFailed = true;
    for (const entry of [...entries].reverse()) {
      rollbackReportEntry(entry, fileSystem, recovery);
    }
  } finally {
    for (const entry of entries) {
      if (entry.tempCreated) {
        if (!tryRemove(entry.tempPath, fileSystem)) {
          recovery.tempCleanupFailures += 1;
        }
      }
    }
    if (lockOwned && !tryRemove(lockPath, fileSystem)) {
      recovery.lockReleaseFailures += 1;
    }
  }

  if (
    deliveryFailed ||
    recovery.tempCleanupFailures > 0 ||
    recovery.backupCleanupFailures > 0 ||
    recovery.lockReleaseFailures > 0
  ) {
    throw new BenchmarkReportWriteError(null, recovery);
  }
}

function markdownValue(value) {
  if (value === null || value === undefined) return 'n/a';
  return String(value).replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function metricRow(label, value) {
  return `| ${label} | ${markdownValue(value)} |`;
}

function duration(value) {
  return value === null || value === undefined ? 'n/a' : `${value} ms`;
}

function bytes(value) {
  return value === null || value === undefined
    ? 'n/a'
    : new Intl.NumberFormat('en-US').format(value);
}

export function renderMarkdownReport(report) {
  const scale = report.scale ?? {};
  const integrity = report.integrity ?? {};
  const stageRows = Object.entries(report.stages)
    .map(([name, stage]) =>
      `| ${markdownValue(name)} | ${markdownValue(stage.status)} | ${duration(
        stage.durationMs,
      )} | ${bytes(
        stage.maxWorkerPeakRssBytes ?? stage.peakRssBytes,
      )} | ${bytes(stage.userCpuTimeMicros)} | ${bytes(
        stage.systemCpuTimeMicros,
      )} | ${bytes(stage.outputBytes)} |`,
    )
    .join('\n');

  const lines = [
    '# Large Repository Benchmark Report',
    '',
    'This report covers deterministic static-analysis stages only. It does not include LLM inference or dashboard generation.',
    '',
    '## Run',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    metricRow('Status', report.status),
    metricRow('Pair ID', report.pairId),
    metricRow('Subject', report.subject.label),
    metricRow('Subject commit', report.subject.commit),
    metricRow('Subject dirty', report.subject.dirty),
    metricRow('Tool commit', report.tool.commit),
    metricRow('Tool dirty', report.tool.dirty),
    metricRow('Tool version', report.tool.packageVersion),
    metricRow('Started (UTC)', report.run.startedAt),
    metricRow('Total duration', duration(report.run.durationMs)),
    metricRow('Concurrency', report.configuration.concurrency),
    metricRow('LLM invoked', report.llm.invoked ? 'Yes' : 'No'),
    '',
    '## Scale',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    metricRow('Files', scale.files),
    metricRow('Lines', scale.lines),
    metricRow('Source bytes', scale.bytes),
    metricRow('Filtered by user ignore', scale.filteredByUserIgnore),
    metricRow('Missing during measurement', scale.missingFiles),
    '',
    '## Stages',
    '',
    '| Stage | Status | Duration | Peak / max worker RSS (bytes) | User CPU (micros) | System CPU (micros) | Output (bytes) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    stageRows || '| n/a | n/a | n/a | n/a | n/a | n/a | n/a |',
    '',
    '## Integrity and reproducibility',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    metricRow('All scanned files batched', integrity.allScannedFilesBatched),
    metricRow('Structure coverage', integrity.structureCoverage),
    metricRow('Files skipped', integrity.filesSkipped),
    metricRow('Failed batches', integrity.failedBatches),
    metricRow('Missing structure paths', integrity.missingStructurePaths),
    metricRow('Duplicate structure paths', integrity.duplicateStructurePaths),
    metricRow('Unexpected structure paths', integrity.unexpectedStructurePaths),
    metricRow('Malformed structure batches', integrity.malformedStructureBatches),
    metricRow('Input digest (SHA-256)', report.determinism?.inputDigest),
    metricRow('Output digest (SHA-256)', report.determinism?.outputDigest),
    metricRow('Schema version', report.schemaVersion),
    '',
    '## Environment',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    metricRow('Platform', report.environment.platform),
    metricRow('OS release', report.environment.release),
    metricRow('Architecture', report.environment.arch),
    metricRow('Node.js', report.environment.nodeVersion),
    metricRow('CPU', report.environment.cpuModel),
    metricRow('Logical cores', report.environment.logicalCores),
    metricRow('Memory (bytes)', report.environment.totalMemoryBytes),
  ];

  if (report.subject.dirty === true || report.tool.dirty === true) {
    lines.push(
      '',
      '> **Warning:** The subject or tool worktree was dirty; commit hashes alone do not reproduce this run.',
    );
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ${markdownValue(warning.stage)}: ${warning.count}`);
    }
  }
  if ((report.secondaryErrors?.length ?? 0) > 0) {
    lines.push('', '## Secondary errors', '');
    for (const secondaryError of report.secondaryErrors) {
      lines.push(
        `- ${markdownValue(secondaryError.stage)}: ${markdownValue(
          secondaryError.message,
        )}`,
      );
    }
  }
  if (report.error) {
    lines.push('', '## Error', '', markdownValue(report.error));
  }
  lines.push('');
  return lines.join('\n');
}

function updateCanonicalHash(hash, value) {
  if (Array.isArray(value)) {
    hash.update('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) hash.update(',');
      updateCanonicalHash(hash, value[index]);
    }
    hash.update(']');
    return;
  }
  if (value && typeof value === 'object') {
    hash.update('{');
    const keys = Object.keys(value).sort();
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) hash.update(',');
      const key = keys[index];
      hash.update(JSON.stringify(key));
      hash.update(':');
      updateCanonicalHash(hash, value[key]);
    }
    hash.update('}');
    return;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  }
  hash.update(encoded);
}

export function canonicalSha256(value) {
  const hash = createHash('sha256');
  updateCanonicalHash(hash, value);
  return hash.digest('hex');
}

export function buildOutputDigest(importMap, batches, structureSummaries) {
  const digestByBatchIndex = new Map(
    structureSummaries.map((summary) => [summary.batchIndex, summary.digest]),
  );
  const structureBatchDigests = batches.batches.map((batch) => ({
    batchIndex: batch.batchIndex,
    digest: digestByBatchIndex.get(batch.batchIndex) ?? null,
  }));
  return canonicalSha256({
    importMapDigest: canonicalSha256(importMap),
    batchesDigest: canonicalSha256(batches),
    structureBatchDigests,
  });
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function distribution(values) {
  if (values.length === 0) {
    return { min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    mean: Math.round((total / values.length) * 100) / 100,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => consume(),
  );
  await Promise.all(workers);
  return results;
}

function emptyEntityCounts() {
  return Object.fromEntries(ENTITY_FIELDS.map((field) => [field, 0]));
}

export function aggregateStructureSummaries(structureSummaries) {
  const aggregate = {
    filesAnalyzed: 0,
    filesSkipped: 0,
    structureSucceeded: 0,
    structureFailed: 0,
    callGraphSucceeded: 0,
    callGraphFailed: 0,
    callGraphSkipped: 0,
    entities: emptyEntityCounts(),
  };
  for (const summary of structureSummaries) {
    aggregate.filesAnalyzed += summary.filesAnalyzed;
    aggregate.filesSkipped += summary.filesSkipped;
    aggregate.structureSucceeded += summary.structureSucceeded;
    aggregate.structureFailed += summary.structureFailed;
    aggregate.callGraphSucceeded += summary.callGraphSucceeded;
    aggregate.callGraphFailed += summary.callGraphFailed;
    aggregate.callGraphSkipped += summary.callGraphSkipped;
    for (const field of ENTITY_FIELDS) {
      aggregate.entities[field] += summary.entities[field];
    }
  }
  return aggregate;
}

export function summarizeStructureOutput(batch, output) {
  const expectedPaths = new Set(batch.files.map((file) => file.path));
  const results = Array.isArray(output?.results) ? output.results : [];
  const skippedPaths = Array.isArray(output?.filesSkipped)
    ? output.filesSkipped
    : [];
  const outcomeCounts = output?.analysisOutcomes;
  const hasOutcomeCounts = outcomeCounts !== undefined;
  const isCount = (value) => Number.isInteger(value) && value >= 0;
  const structureSucceeded = hasOutcomeCounts
    ? outcomeCounts?.structure?.succeeded
    : results.length;
  const structureFailed = hasOutcomeCounts
    ? outcomeCounts?.structure?.failed
    : 0;
  const callGraphSucceeded = hasOutcomeCounts
    ? outcomeCounts?.callGraph?.succeeded
    : 0;
  const callGraphFailed = hasOutcomeCounts
    ? outcomeCounts?.callGraph?.failed
    : 0;
  const callGraphSkipped = hasOutcomeCounts
    ? outcomeCounts?.callGraph?.skipped
    : results.length;
  let malformed =
    !output ||
    typeof output !== 'object' ||
    Array.isArray(output) ||
    output.scriptCompleted !== true ||
    !Array.isArray(output.results) ||
    !Array.isArray(output.filesSkipped) ||
    !Number.isInteger(output.filesAnalyzed) ||
    output.filesAnalyzed !== results.length ||
    !isCount(structureSucceeded) ||
    !isCount(structureFailed) ||
    !isCount(callGraphSucceeded) ||
    !isCount(callGraphFailed) ||
    !isCount(callGraphSkipped) ||
    structureSucceeded + structureFailed !== results.length ||
    callGraphSucceeded + callGraphFailed + callGraphSkipped !== results.length;

  const pathCounts = new Map();
  const entities = emptyEntityCounts();
  for (const result of results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      malformed = true;
      continue;
    }
    if (typeof result.path !== 'string' || result.path.length === 0) {
      malformed = true;
    } else {
      pathCounts.set(result.path, (pathCounts.get(result.path) ?? 0) + 1);
    }
    for (const field of ENTITY_FIELDS) {
      entities[field] += Array.isArray(result[field]) ? result[field].length : 0;
    }
  }
  for (const path of skippedPaths) {
    if (typeof path !== 'string' || path.length === 0) {
      malformed = true;
      continue;
    }
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }

  const accountedExpectedPaths = [...expectedPaths].filter((path) =>
    pathCounts.has(path),
  ).length;
  const missingStructurePaths = expectedPaths.size - accountedExpectedPaths;
  const duplicateStructurePaths = [...pathCounts.values()].filter(
    (count) => count > 1,
  ).length;
  const unexpectedStructurePaths = [...pathCounts.keys()].filter(
    (path) => !expectedPaths.has(path),
  ).length;

  return {
    batchIndex: batch.batchIndex,
    digest: canonicalSha256(output),
    complete:
      !malformed &&
      structureFailed === 0 &&
      callGraphFailed === 0 &&
      missingStructurePaths === 0 &&
      duplicateStructurePaths === 0 &&
      unexpectedStructurePaths === 0,
    malformed,
    expectedFiles: expectedPaths.size,
    accountedExpectedPaths,
    filesAnalyzed: results.length,
    filesSkipped: skippedPaths.length,
    structureSucceeded: isCount(structureSucceeded) ? structureSucceeded : 0,
    structureFailed: isCount(structureFailed) ? structureFailed : 0,
    callGraphSucceeded: isCount(callGraphSucceeded) ? callGraphSucceeded : 0,
    callGraphFailed: isCount(callGraphFailed) ? callGraphFailed : 0,
    callGraphSkipped: isCount(callGraphSkipped) ? callGraphSkipped : 0,
    missingStructurePaths,
    duplicateStructurePaths,
    unexpectedStructurePaths,
    entities,
  };
}

export function aggregateStructureResources(stages) {
  if (stages.length === 0) {
    return {
      maxWorkerPeakRssBytes: null,
      userCpuTimeMicros: null,
      systemCpuTimeMicros: null,
    };
  }
  const values = (field) => stages.map((stage) => stage[field]);
  const peakRssValues = values('peakRssBytes');
  const userCpuValues = values('userCpuTimeMicros');
  const systemCpuValues = values('systemCpuTimeMicros');
  const allNumbers = (items) => items.every((value) => Number.isFinite(value));
  const sum = (items) => items.reduce((total, value) => total + value, 0);
  return {
    maxWorkerPeakRssBytes: allNumbers(peakRssValues)
      ? Math.max(...peakRssValues)
      : null,
    userCpuTimeMicros: allNumbers(userCpuValues) ? sum(userCpuValues) : null,
    systemCpuTimeMicros: allNumbers(systemCpuValues)
      ? sum(systemCpuValues)
      : null,
  };
}

function summarizeStage(stage, outputBytes, extra = {}) {
  return {
    status: stage.status,
    durationMs: stage.durationMs,
    peakRssBytes: stage.peakRssBytes,
    userCpuTimeMicros: stage.userCpuTimeMicros,
    systemCpuTimeMicros: stage.systemCpuTimeMicros,
    warningCount: stage.warningCount,
    warningMessages: stage.warningMessages,
    warningMessagesTruncated: stage.warningMessagesTruncated,
    stdoutTruncated: stage.stdoutTruncated,
    stderrTruncated: stage.stderrTruncated,
    outputBytes,
    ...extra,
  };
}

function subjectScale(repoRoot, scan) {
  let bytes = 0;
  let missingFiles = 0;
  for (const file of scan.files) {
    try {
      bytes += statSync(resolve(repoRoot, file.path)).size;
    } catch {
      missingFiles += 1;
    }
  }
  return {
    files: scan.totalFiles,
    lines: scan.files.reduce((sum, file) => sum + (file.sizeLines ?? 0), 0),
    bytes,
    missingFiles,
    filteredByUserIgnore: scan.filteredByIgnore ?? 0,
    byCategory: scan.stats?.byCategory ?? {},
    byLanguage: scan.stats?.byLanguage ?? {},
  };
}

export function buildBenchmarkIntegrity(
  scan,
  importMap,
  batches,
  structureSummaries,
  failedBatches,
) {
  const scannedPaths = new Set(scan.files.map((file) => file.path));
  const counts = new Map();
  for (const batch of batches.batches) {
    for (const file of batch.files) {
      counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
    }
  }
  const missingBatchFiles = [...scannedPaths].filter((path) => !counts.has(path));
  const duplicateBatchFiles = [...counts.values()].filter((count) => count > 1).length;
  const unexpectedBatchFiles = [...counts.keys()].filter((path) => !scannedPaths.has(path));
  let missingImportTargets = 0;
  for (const targets of Object.values(importMap)) {
    for (const target of targets) {
      if (!scannedPaths.has(target)) missingImportTargets += 1;
    }
  }

  const structureSucceeded = structureSummaries.reduce(
    (sum, summary) => sum + summary.structureSucceeded,
    0,
  );
  const structureFailures = structureSummaries.reduce(
    (sum, summary) => sum + summary.structureFailed,
    0,
  );
  const callGraphFailures = structureSummaries.reduce(
    (sum, summary) => sum + summary.callGraphFailed,
    0,
  );
  const filesSkipped = structureSummaries.reduce(
    (sum, summary) => sum + summary.filesSkipped,
    0,
  );
  const missingStructurePaths = structureSummaries.reduce(
    (sum, summary) => sum + summary.missingStructurePaths,
    0,
  );
  const duplicateStructurePaths = structureSummaries.reduce(
    (sum, summary) => sum + summary.duplicateStructurePaths,
    0,
  );
  const unexpectedStructurePaths = structureSummaries.reduce(
    (sum, summary) => sum + summary.unexpectedStructurePaths,
    0,
  );
  const malformedStructureBatches = structureSummaries.filter(
    (summary) => summary.malformed,
  ).length;
  return {
    allScannedFilesBatched:
      missingBatchFiles.length === 0 &&
      duplicateBatchFiles === 0 &&
      unexpectedBatchFiles.length === 0,
    missingBatchFiles: missingBatchFiles.length,
    duplicateBatchFiles,
    unexpectedBatchFiles: unexpectedBatchFiles.length,
    missingImportTargets,
    structureCoverage:
      structureSucceeded + structureFailures === 0
        ? 1
        : Math.round(
            (structureSucceeded / (structureSucceeded + structureFailures)) *
              10000,
          ) / 10000,
    structureFailures,
    callGraphFailures,
    filesSkipped,
    failedBatches,
    missingStructurePaths,
    duplicateStructurePaths,
    unexpectedStructurePaths,
    malformedStructureBatches,
  };
}

export function hasFailedIntegrity(integrity) {
  return (
    !integrity.allScannedFilesBatched ||
    integrity.missingImportTargets > 0 ||
    integrity.structureCoverage !== 1 ||
    integrity.structureFailures > 0 ||
    integrity.callGraphFailures > 0 ||
    integrity.failedBatches > 0 ||
    integrity.missingStructurePaths > 0 ||
    integrity.duplicateStructurePaths > 0 ||
    integrity.unexpectedStructurePaths > 0 ||
    integrity.malformedStructureBatches > 0
  );
}

export function aggregateStageWarnings(stages) {
  let warningCount = 0;
  const warningMessages = [];
  let warningMessagesTruncated = false;

  for (const stage of stages) {
    const stageCount = stage.warningCount ?? 0;
    const stageMessages = stage.warningMessages ?? [];
    warningCount += stageCount;
    for (const message of stageMessages) {
      if (warningMessages.length < WARNING_SAMPLE_LIMIT) {
        warningMessages.push(message);
      } else {
        warningMessagesTruncated = true;
      }
    }
    if (
      stage.warningMessagesTruncated ||
      stageCount > stageMessages.length
    ) {
      warningMessagesTruncated = true;
    }
  }

  return {
    warningCount,
    warningMessages,
    warningMessagesTruncated,
  };
}

export function createStructureDiagnosticsAccumulator() {
  const warningCandidates = [];
  const failureCandidates = [];
  let warningCount = 0;
  let warningMessagesTruncated = false;
  let failureSamplesTruncated = false;

  function retainCandidate(candidates, candidate) {
    candidates.push(candidate);
    candidates.sort(
      (left, right) =>
        left.inputIndex - right.inputIndex ||
        left.sampleIndex - right.sampleIndex,
    );
    if (candidates.length > WARNING_SAMPLE_LIMIT) {
      candidates.pop();
      return true;
    }
    return false;
  }

  function retainFailure(inputIndex, batchIndex, message, sampleIndex = 0) {
    const safeMessage = boundUtf8(
      `[batch ${batchIndex}] ${message}`,
      STRUCTURE_DIAGNOSTIC_SAMPLE_MAX_BYTES,
    );
    const omitted = retainCandidate(failureCandidates, {
      inputIndex,
      sampleIndex,
      batchIndex,
      message: safeMessage.text,
    });
    failureSamplesTruncated ||=
      safeMessage.truncated || omitted;
  }

  return {
    record(inputIndex, batchIndex, stage) {
      const stageMessages = stage.warningMessages ?? [];
      const stageWarningCount = stage.warningCount ?? 0;
      warningCount += stageWarningCount;
      for (let sampleIndex = 0; sampleIndex < stageMessages.length; sampleIndex += 1) {
        const safeMessage = boundUtf8(
          `[batch ${batchIndex}] ${stageMessages[sampleIndex]}`,
          STRUCTURE_DIAGNOSTIC_SAMPLE_MAX_BYTES,
        );
        const omitted = retainCandidate(warningCandidates, {
          inputIndex,
          sampleIndex,
          message: safeMessage.text,
        });
        warningMessagesTruncated ||=
          safeMessage.truncated || omitted;
      }
      warningMessagesTruncated ||=
        stage.warningMessagesTruncated ||
        stageWarningCount > stageMessages.length;

      if (stage.status === 'failed') {
        const message = stage.stderr?.trim()
          ? stage.stderr.trim()
          : `Structure worker failed with exit code ${stage.exitCode ?? 'unknown'}`;
        retainFailure(inputIndex, batchIndex, message);
      }

      return {
        name: stage.name,
        status: stage.status,
        exitCode: stage.exitCode,
        durationMs: stage.durationMs,
        peakRssBytes: stage.peakRssBytes,
        userCpuTimeMicros: stage.userCpuTimeMicros,
        systemCpuTimeMicros: stage.systemCpuTimeMicros,
        warningCount: stageWarningCount,
        warningMessagesTruncated:
          stage.warningMessagesTruncated ||
          stageWarningCount > stageMessages.length,
        stdoutTruncated: stage.stdoutTruncated,
        stderrTruncated: stage.stderrTruncated,
      };
    },
    recordAnalysisOutcome(inputIndex, batchIndex, summary) {
      if (summary.structureFailed > 0 || summary.callGraphFailed > 0) {
        retainFailure(
          inputIndex,
          batchIndex,
          `Analysis outcomes: ${summary.structureFailed} structure failure(s), ${summary.callGraphFailed} call-graph failure(s)`,
          1,
        );
      }
    },
    summary() {
      return {
        warningCount,
        warningMessages: warningCandidates.map((candidate) => candidate.message),
        warningMessagesTruncated,
        failureSamples: failureCandidates.map(({ batchIndex, message }) => ({
          batchIndex,
          message,
        })),
        failureSamplesTruncated,
      };
    },
  };
}

export function warningSummary(stageResults) {
  return stageResults
    .filter((stage) => stage.warningCount > 0)
    .map((stage) => {
      const warnings = aggregateStageWarnings([stage]);
      return {
        stage: stage.name,
        count: warnings.warningCount,
        messages: warnings.warningMessages,
        truncated: warnings.warningMessagesTruncated,
      };
    });
}

export async function runBenchmark(options, hooks = {}) {
  const startedAt = new Date();
  const overallStart = performance.now();
  const artifactRoot = mkdtempSync(join(tmpdir(), 'ua-large-bench-'));
  const redactionRoots = [
    [options.repoRoot, '<subject>'],
    [REPO_ROOT, '<tool>'],
    [artifactRoot, '<artifacts>'],
  ];
  const onProgress = hooks.onProgress ?? (() => {});
  const runStage = hooks.runStage ?? runNodeStage;
  const toolGit = gitMetadata(REPO_ROOT);
  const subjectGit = gitMetadata(options.repoRoot);
  const stageResults = [];

  const report = {
    schemaUrl: REPORT_SCHEMA_URL,
    schemaVersion: REPORT_SCHEMA_VERSION,
    pairId: randomUUID(),
    status: 'failed',
    mode: 'deterministic',
    run: {
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: null,
    },
    tool: {
      commit: toolGit.commit,
      dirty: toolGit.dirty,
      packageVersion: packageVersion(),
    },
    subject: {
      label: options.label,
      commit: subjectGit.commit,
      dirty: subjectGit.dirty,
    },
    environment: environmentMetadata(),
    configuration: {
      concurrency: options.concurrency,
      stages: ['scan', 'imports', 'batching', 'structure'],
    },
    scale: null,
    stages: {},
    integrity: null,
    determinism: null,
    llm: {
      invoked: false,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    },
    warnings: [],
    secondaryErrors: [],
    error: null,
  };

  let exitCode = 1;
  try {
    const scanPath = join(artifactRoot, 'scan-result.json');
    onProgress('scan');
    const scanStage = await runStage(
      'scan',
      SCAN_SCRIPT,
      [options.repoRoot, scanPath, '--exclude-analysis-data'],
      redactionRoots,
    );
    stageResults.push(scanStage);
    report.stages.scan = summarizeStage(
      scanStage,
      fileSizeOrZero(scanPath),
    );
    let scan = null;
    if (scanStage.status === 'ok') {
      try {
        scan = readJson(scanPath);
        validateScanArtifact(scan);
      } catch (error) {
        markArtifactFailure(scanStage, 'scan', error, redactionRoots);
        report.stages.scan = summarizeStage(
          scanStage,
          fileSizeOrZero(scanPath),
        );
      }
    }
    if (scanStage.status === 'failed') throw new BenchmarkStageError(scanStage);
    report.scale = subjectScale(options.repoRoot, scan);
    report.stages.scan = summarizeStage(scanStage, fileSizeOrZero(scanPath), {
      files: scan.totalFiles,
      lines: report.scale.lines,
      bytes: report.scale.bytes,
      filteredByUserIgnore: scan.filteredByIgnore ?? 0,
    });

    const importInputPath = join(artifactRoot, 'import-input.json');
    const importOutputPath = join(artifactRoot, 'import-map.json');
    writeJson(importInputPath, {
      projectRoot: options.repoRoot,
      files: scan.files,
    });
    onProgress('imports');
    const importStage = await runStage(
      'imports',
      IMPORT_SCRIPT,
      [importInputPath, importOutputPath],
      redactionRoots,
    );
    stageResults.push(importStage);
    report.stages.imports = summarizeStage(
      importStage,
      fileSizeOrZero(importOutputPath),
    );
    let imports = null;
    if (importStage.status === 'ok') {
      try {
        imports = readJson(importOutputPath);
        validateImportArtifact(imports);
      } catch (error) {
        markArtifactFailure(importStage, 'imports', error, redactionRoots);
        report.stages.imports = summarizeStage(
          importStage,
          fileSizeOrZero(importOutputPath),
        );
      }
    }
    if (importStage.status === 'failed') throw new BenchmarkStageError(importStage);
    report.stages.imports = summarizeStage(
      importStage,
      fileSizeOrZero(importOutputPath),
      {
        filesScanned: imports.stats?.filesScanned ?? 0,
        filesWithImports: imports.stats?.filesWithImports ?? 0,
        edges: imports.stats?.totalEdges ?? 0,
      },
    );

    const enrichedScanPath = join(artifactRoot, 'scan-result-with-imports.json');
    const batchesPath = join(artifactRoot, 'batches.json');
    const enrichedScan = { ...scan, importMap: imports.importMap };
    writeJson(enrichedScanPath, enrichedScan);
    onProgress('batching');
    const batchStage = await runStage(
      'batching',
      BATCH_SCRIPT,
      [
        options.repoRoot,
        `--scan-result=${enrichedScanPath}`,
        `--output=${batchesPath}`,
      ],
      redactionRoots,
    );
    stageResults.push(batchStage);
    report.stages.batching = summarizeStage(
      batchStage,
      fileSizeOrZero(batchesPath),
    );
    let batches = null;
    if (batchStage.status === 'ok') {
      try {
        batches = readJson(batchesPath);
        validateBatchArtifact(batches);
      } catch (error) {
        markArtifactFailure(batchStage, 'batching', error, redactionRoots);
        report.stages.batching = summarizeStage(
          batchStage,
          fileSizeOrZero(batchesPath),
        );
      }
    }
    if (batchStage.status === 'failed') throw new BenchmarkStageError(batchStage);
    const batchSizes = batches.batches.map((batch) => batch.files.length);
    const agentInputBytes = estimatedAgentInputBytes(batches.batches);
    report.stages.batching = summarizeStage(
      batchStage,
      fileSizeOrZero(batchesPath),
      {
        algorithm: batches.algorithm,
        totalBatches: batches.totalBatches,
        batchSizes: distribution(batchSizes),
        estimatedAgentInputBytes: agentInputBytes,
      },
    );

    onProgress('structure');
    const structureStart = performance.now();
    let completedBatches = 0;
    const structureDiagnostics = createStructureDiagnosticsAccumulator();
    const structureRuns = await mapWithConcurrency(
      batches.batches,
      options.concurrency,
      async (batch, inputIndex) => {
        const inputPath = join(artifactRoot, `structure-input-${batch.batchIndex}.json`);
        const outputPath = join(artifactRoot, `structure-output-${batch.batchIndex}.json`);
        writeJson(inputPath, {
          projectRoot: options.repoRoot,
          batchFiles: batch.files,
          batchImportData: batch.batchImportData,
        });
        const stage = await runStage(
          `structure:${batch.batchIndex}`,
          STRUCTURE_SCRIPT,
          [inputPath, outputPath],
          redactionRoots,
        );
        completedBatches += 1;
        hooks.onBatchProgress?.(completedBatches, batches.totalBatches);
        let summary = null;
        if (stage.status === 'ok') {
          try {
            const output = readJson(outputPath);
            summary = summarizeStructureOutput(batch, output);
            structureDiagnostics.recordAnalysisOutcome(
              inputIndex,
              batch.batchIndex,
              summary,
            );
          } catch (error) {
            stage.status = 'failed';
            stage.stderr = redactPaths(
              error instanceof Error ? error.message : String(error),
              redactionRoots,
            );
          }
        }
        const compactStage = structureDiagnostics.record(
          inputIndex,
          batch.batchIndex,
          stage,
        );
        return {
          stage: compactStage,
          summary,
          outputBytes: fileSizeOrZero(outputPath),
        };
      },
    );

    const structureSummaries = structureRuns
      .filter((run) => run.summary)
      .map((run) => run.summary);
    const structureAggregate = aggregateStructureSummaries(structureSummaries);
    const failedBatches = structureRuns.filter(
      (run) => run.stage.status === 'failed' || run.summary?.complete === false,
    ).length;
    const structureDurationMs =
      Math.round((performance.now() - structureStart) * 100) / 100;
    const structureDiagnosticsSummary = structureDiagnostics.summary();
    const structureWarnings = {
      warningCount: structureDiagnosticsSummary.warningCount,
      warningMessages: structureDiagnosticsSummary.warningMessages,
      warningMessagesTruncated:
        structureDiagnosticsSummary.warningMessagesTruncated,
    };
    const structureResources = aggregateStructureResources(
      structureRuns.map((run) => run.stage),
    );
    const structureSummaryStage = {
      name: 'structure',
      status: failedBatches === 0 ? 'ok' : 'failed',
      durationMs: structureDurationMs,
      peakRssBytes: structureResources.maxWorkerPeakRssBytes,
      userCpuTimeMicros: structureResources.userCpuTimeMicros,
      systemCpuTimeMicros: structureResources.systemCpuTimeMicros,
      ...structureWarnings,
    };
    stageResults.push(structureSummaryStage);
    report.stages.structure = {
      status: structureSummaryStage.status,
      durationMs: structureDurationMs,
      maxWorkerPeakRssBytes: structureResources.maxWorkerPeakRssBytes,
      userCpuTimeMicros: structureResources.userCpuTimeMicros,
      systemCpuTimeMicros: structureResources.systemCpuTimeMicros,
      ...structureWarnings,
      failureSamples: structureDiagnosticsSummary.failureSamples,
      failureSamplesTruncated:
        structureDiagnosticsSummary.failureSamplesTruncated,
      outputBytes: structureRuns.reduce((sum, run) => sum + run.outputBytes, 0),
      batchesSucceeded: structureRuns.length - failedBatches,
      batchesFailed: failedBatches,
      filesAnalyzed: structureAggregate.filesAnalyzed,
      filesSkipped: structureAggregate.filesSkipped,
      structureSucceeded: structureAggregate.structureSucceeded,
      structureFailed: structureAggregate.structureFailed,
      callGraphSucceeded: structureAggregate.callGraphSucceeded,
      callGraphFailed: structureAggregate.callGraphFailed,
      callGraphSkipped: structureAggregate.callGraphSkipped,
      entities: structureAggregate.entities,
      batchDurationMs: distribution(
        structureRuns.map((run) => run.stage.durationMs),
      ),
    };

    report.integrity = buildBenchmarkIntegrity(
      scan,
      imports.importMap,
      batches,
      structureSummaries,
      failedBatches,
    );
    report.determinism = {
      algorithm: 'sha256',
      inputDigest: scan.contentDigest,
      outputDigest: buildOutputDigest(
        imports.importMap,
        batches,
        structureSummaries,
      ),
    };
    report.warnings = warningSummary(stageResults);

    if (hasFailedIntegrity(report.integrity)) {
      report.status = 'failed';
      report.error = 'One or more deterministic integrity checks failed';
      exitCode = 1;
    } else if (
      report.warnings.length > 0 ||
      report.integrity.filesSkipped > 0
    ) {
      report.status = 'degraded';
      exitCode = 0;
    } else {
      report.status = 'ok';
      exitCode = 0;
    }
  } catch (error) {
    report.status = 'failed';
    report.warnings = warningSummary(stageResults);
    const rawMessage =
      error instanceof BenchmarkStageError
        ? error.stage.stderr || error.message
        : error instanceof Error
          ? error.message
          : String(error);
    report.error = redactPaths(rawMessage, redactionRoots);
    exitCode = 1;
  } finally {
    report.run.finishedAt = new Date().toISOString();
    report.run.durationMs =
      Math.round((performance.now() - overallStart) * 100) / 100;
  }

  if (!options.keepArtifacts) {
    try {
      const cleanupArtifacts =
        hooks.cleanupArtifacts ?? cleanupBenchmarkArtifacts;
      cleanupArtifacts(artifactRoot);
    } catch {
      const cleanupMessage = 'Unable to remove temporary benchmark artifacts';
      report.secondaryErrors.push({
        stage: 'cleanup',
        message: cleanupMessage,
      });
      report.error ??= cleanupMessage;
      report.status = 'failed';
      exitCode = 1;
    }
  }

  try {
    deliverBenchmarkReports({
      outputPath: options.outputPath,
      markdownPath: options.markdownPath,
      jsonContents: `${JSON.stringify(report, null, 2)}\n`,
      markdownContents: renderMarkdownReport(report),
    });
  } catch (error) {
    throw new BenchmarkReportWriteError(
      options.keepArtifacts ? artifactRoot : null,
      error instanceof BenchmarkReportWriteError ? error.recovery : {},
    );
  }

  return {
    report,
    exitCode,
    artifactRoot: options.keepArtifacts ? artifactRoot : null,
  };
}
