#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { estimatedAgentInputBytes } from './analysis-metrics.mjs';
import {
  ANALYSIS_PLAN_ESTIMATOR_VERSION,
  ANALYSIS_PLAN_SCHEMA_URL,
  ANALYSIS_PLAN_SCHEMA_VERSION,
  atomicWriteJson,
  distribution,
  isCliEntry,
  normalizeRelativeScope,
  readJson,
  resolveSafeProjectFile,
  resolveUaDir,
  sha256,
  stableCompare,
  terminalText,
} from './analysis-report-utils.mjs';
const DEFAULT_PARALLELISM = 5;
const GENERATED_DIRECTORY_NAMES = new Set([
  'build',
  'coverage',
  'dist',
  'generated',
  'gen',
  'target',
  'vendor',
]);

export class AnalysisPlanInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalysisPlanInputError';
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateFile(file, context) {
  if (!file || typeof file !== 'object') {
    throw new AnalysisPlanInputError(`${context} must be an object`);
  }
  if (typeof file.path !== 'string' || file.path.length === 0) {
    throw new AnalysisPlanInputError(`${context}.path must be a non-empty string`);
  }
  if (!isNonNegativeInteger(file.sizeLines)) {
    throw new AnalysisPlanInputError(`${context}.sizeLines must be a non-negative integer`);
  }
  if (typeof file.language !== 'string' || file.language.length === 0) {
    throw new AnalysisPlanInputError(`${context}.language must be a non-empty string`);
  }
  if (typeof file.fileCategory !== 'string' || file.fileCategory.length === 0) {
    throw new AnalysisPlanInputError(`${context}.fileCategory must be a non-empty string`);
  }
}

export function validatePlanInputs(scan, batches, mode = 'full') {
  if (!scan || typeof scan !== 'object' || !Array.isArray(scan.files)) {
    throw new AnalysisPlanInputError('scan-result.json must contain a files array');
  }
  scan.files.forEach((file, index) => validateFile(file, `scan.files[${index}]`));
  const scanPaths = new Set(scan.files.map((file) => file.path));
  if (scanPaths.size !== scan.files.length) {
    throw new AnalysisPlanInputError('scan file paths must be unique');
  }
  if (!isNonNegativeInteger(scan.totalFiles) || scan.totalFiles !== scan.files.length) {
    throw new AnalysisPlanInputError('scan totalFiles must equal scan.files.length');
  }
  if (!batches || typeof batches !== 'object' || !Array.isArray(batches.batches)) {
    throw new AnalysisPlanInputError('batches.json must contain a batches array');
  }
  if (batches.schemaVersion !== 1) {
    throw new AnalysisPlanInputError('unsupported batches schemaVersion');
  }
  if (!isNonNegativeInteger(batches.totalBatches) || batches.totalBatches !== batches.batches.length) {
    throw new AnalysisPlanInputError('batch totalBatches must equal batches.length');
  }
  if (!isNonNegativeInteger(batches.totalFiles) || batches.totalFiles !== scan.totalFiles) {
    throw new AnalysisPlanInputError('batch totalFiles must equal scan totalFiles');
  }
  const selectedPaths = new Set();
  for (const [batchIndex, batch] of batches.batches.entries()) {
    if (!batch || typeof batch !== 'object' || !Array.isArray(batch.files)) {
      throw new AnalysisPlanInputError(`batches[${batchIndex}] must contain a files array`);
    }
    if (batch.files.length === 0) {
      throw new AnalysisPlanInputError(`batches[${batchIndex}].files must not be empty`);
    }
    batch.files.forEach((file, fileIndex) => {
      validateFile(file, `batches[${batchIndex}].files[${fileIndex}]`);
      if (!scanPaths.has(file.path)) {
        throw new AnalysisPlanInputError(`batch file is absent from the scan inventory: ${file.path}`);
      }
      selectedPaths.add(file.path);
    });
    if (!batch.batchImportData || typeof batch.batchImportData !== 'object') {
      throw new AnalysisPlanInputError(`batches[${batchIndex}].batchImportData must be an object`);
    }
    if (!batch.neighborMap || typeof batch.neighborMap !== 'object') {
      throw new AnalysisPlanInputError(`batches[${batchIndex}].neighborMap must be an object`);
    }
    if (!Number.isSafeInteger(batch.batchIndex) || batch.batchIndex < 1) {
      throw new AnalysisPlanInputError(`batches[${batchIndex}].batchIndex must be a positive integer`);
    }
  }
  const batchIndices = batches.batches.map((batch) => batch.batchIndex);
  if (new Set(batchIndices).size !== batchIndices.length) {
    throw new AnalysisPlanInputError('batchIndex values must be unique');
  }
  if (mode === 'full' && selectedPaths.size !== scanPaths.size) {
    throw new AnalysisPlanInputError('full analysis batches must cover every scanned file');
  }
}

function sortedCounts(entries, field) {
  const counts = new Map();
  for (const entry of entries) {
    const key = entry[field] || 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => stableCompare(left, right)));
}

function uniqueAnalysisFiles(batches) {
  const byPath = new Map();
  let duplicateAssignments = 0;
  for (const batch of batches.batches) {
    for (const file of batch.files) {
      if (byPath.has(file.path)) duplicateAssignments += 1;
      else byPath.set(file.path, file);
    }
  }
  return { files: [...byPath.values()], duplicateAssignments };
}

function sourceSize(projectRoot, files) {
  let bytes = 0;
  let missingFiles = 0;
  let unsafePaths = 0;
  const linesByPath = new Map();
  const sourceRecords = [];
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (const file of files) {
    const path = resolveSafeProjectFile(projectRoot, file.path);
    if (!path) {
      unsafePaths += 1;
      sourceRecords.push({ path: file.path, state: 'unsafe' });
      continue;
    }
    let descriptor;
    try {
      descriptor = openSync(path, 'r');
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) {
        missingFiles += 1;
        sourceRecords.push({ path: file.path, state: 'not-file' });
        continue;
      }
      const fileHash = createHash('sha256');
      let fileBytes = 0;
      let fileLines = 0;
      let bytesRead;
      while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
        const chunk = buffer.subarray(0, bytesRead);
        fileHash.update(chunk);
        for (let index = 0; index < bytesRead; index += 1) {
          if (buffer[index] === 0x0a) fileLines += 1;
        }
        fileBytes += bytesRead;
      }
      bytes += fileBytes;
      linesByPath.set(file.path, fileLines);
      sourceRecords.push({
        path: file.path,
        state: 'file',
        bytes: fileBytes,
        lines: fileLines,
        digest: fileHash.digest('hex'),
      });
    } catch {
      missingFiles += 1;
      sourceRecords.push({ path: file.path, state: 'missing' });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  sourceRecords.sort((left, right) => stableCompare(left.path, right.path));
  return { bytes, missingFiles, unsafePaths, digest: sha256(sourceRecords), linesByPath };
}

function generatedPattern(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const generatedDirectory = parts.find((part) => GENERATED_DIRECTORY_NAMES.has(part.toLowerCase()));
  if (generatedDirectory) return `**/${generatedDirectory}/**`;
  if (/\.generated\.[^/]+$/i.test(normalized)) return '**/*.generated.*';
  if (/\.g\.[^/]+$/i.test(normalized)) return '**/*.g.*';
  if (/(^|\/)[^/]+_generated\.[^/]+$/i.test(normalized)) return '**/*_generated.*';
  if (/\.min\.(?:js|css)$/i.test(normalized)) return '**/*.min.{js,css}';
  return null;
}

function directorySuggestions(files, totalLines) {
  const groups = new Map();
  for (const file of files) {
    const normalized = file.path.replaceAll('\\', '/');
    if (!normalized.includes('/')) continue;
    const topLevel = normalized.split('/')[0];
    const group = groups.get(topLevel) ?? { fileCount: 0, lines: 0 };
    group.fileCount += 1;
    group.lines += file.sizeLines;
    groups.set(topLevel, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.fileCount >= 5 && group.fileCount < files.length * 0.9)
    .sort(
      ([leftPath, left], [rightPath, right]) =>
        right.fileCount - left.fileCount ||
        right.lines - left.lines ||
        stableCompare(leftPath, rightPath),
    )
    .slice(0, 3)
    .map(([path, group]) => ({
      kind: 'subdirectory',
      value: path,
      fileCount: group.fileCount,
      lines: group.lines,
      estimatedReductionPercent:
        files.length === 0 ? 0 : Math.max(0, Math.round((1 - group.fileCount / files.length) * 100)),
      reason:
        `Analyze only ${path}/ to retain ${group.fileCount} files` +
        (totalLines > 0 ? ` and ${Math.round((group.lines / totalLines) * 100)}% of lines` : ''),
    }));
}

function generatedSuggestions(files) {
  const groups = new Map();
  for (const file of files) {
    const pattern = generatedPattern(file.path);
    if (!pattern) continue;
    const group = groups.get(pattern) ?? { fileCount: 0, lines: 0 };
    group.fileCount += 1;
    group.lines += file.sizeLines;
    groups.set(pattern, group);
  }
  return [...groups.entries()]
    .sort(
      ([leftPattern, left], [rightPattern, right]) =>
        right.lines - left.lines ||
        right.fileCount - left.fileCount ||
        stableCompare(leftPattern, rightPattern),
    )
    .slice(0, 3)
    .map(([pattern, group]) => ({
      kind: 'exclude',
      value: pattern,
      fileCount: group.fileCount,
      lines: group.lines,
      estimatedReductionPercent:
        files.length === 0 ? 0 : Math.max(0, Math.round((group.fileCount / files.length) * 100)),
      reason: `Generated-looking paths remain in scope; review before excluding ${pattern}`,
    }));
}

function risk(code, severity, message, evidence) {
  return { code, severity, message, evidence };
}

function buildRisks({
  analysisFiles,
  lines,
  sourceBytes,
  totalBatches,
  waves,
  missingFiles,
  unsafePaths,
  duplicateAssignments,
  generatedCount,
  hasContentDigest,
  mode,
}) {
  const risks = [];
  if (analysisFiles > 100) {
    risks.push(
      risk(
        'large-file-count',
        analysisFiles > 500 ? 'high' : 'medium',
        'The analysis exceeds the historical 100-file warning threshold and merits scope review.',
        `${analysisFiles} files`,
      ),
    );
  }
  if (totalBatches > 20) {
    risks.push(
      risk(
        'many-agent-batches',
        totalBatches > 50 ? 'high' : 'medium',
        'Many file-analyzer batches increase latency, retries, and model usage.',
        `${totalBatches} batches across ${waves} waves`,
      ),
    );
  }
  if (lines > 250_000 || sourceBytes > 20 * 1024 * 1024) {
    risks.push(
      risk(
        'large-known-input',
        lines > 1_000_000 || sourceBytes > 80 * 1024 * 1024 ? 'high' : 'medium',
        'Known source input is large; model output and reasoning are additional unmeasured usage.',
        `${lines} lines, ${sourceBytes} source bytes`,
      ),
    );
  }
  if (missingFiles > 0) {
    risks.push(
      risk(
        'missing-files',
        'medium',
        'Some scanned files could not be measured and may disappear before analysis.',
        `${missingFiles} files`,
      ),
    );
  }
  if (unsafePaths > 0) {
    risks.push(
      risk(
        'unsafe-file-paths',
        'high',
        'Some scan entries resolve outside the project root and were excluded from measurement.',
        `${unsafePaths} paths`,
      ),
    );
  }
  if (duplicateAssignments > 0) {
    risks.push(
      risk(
        'duplicate-batch-assignment',
        'high',
        'One or more files appear in multiple analysis batches.',
        `${duplicateAssignments} duplicate assignments`,
      ),
    );
  }
  if (generatedCount > 0) {
    risks.push(
      risk(
        'generated-looking-input',
        'low',
        'Generated-looking files remain in scope; verify that they are intentional.',
        `${generatedCount} files`,
      ),
    );
  }
  if (!hasContentDigest) {
    risks.push(
      risk(
        'missing-content-digest',
        'low',
        'The preserved scan artifact predates full-project content digests.',
        'Selected source is content-bound, but a full scan is needed to refresh scan metadata and import context.',
      ),
    );
  }
  if (mode === 'incremental') {
    risks.push(
      risk(
        'reused-scan-context',
        'medium',
        'Incremental planning reuses the preserved scan metadata and import map.',
        'Current selected bytes and lines are refreshed, but run a full scan to refresh classifications and imports.',
      ),
    );
  }
  risks.push(
    risk(
      'unmeasured-llm-overhead',
      'medium',
      'Token output, model reasoning, reviewer prompts, and provider latency are not observable here.',
      'The token range covers known Phase 2 input only; wall time and cost remain uncalibrated.',
    ),
  );
  return risks;
}

export function buildAnalysisPlan({
  projectRoot,
  scan,
  batches,
  mode = 'full',
  parallelism = DEFAULT_PARALLELISM,
  scope = '.',
}) {
  if (!['full', 'incremental'].includes(mode)) {
    throw new AnalysisPlanInputError('mode must be full or incremental');
  }
  validatePlanInputs(scan, batches, mode);
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 32) {
    throw new AnalysisPlanInputError('parallelism must be an integer between 1 and 32');
  }
  let normalizedScope;
  try {
    normalizedScope = normalizeRelativeScope(scope);
  } catch (error) {
    throw new AnalysisPlanInputError(error.message);
  }

  const { files, duplicateAssignments } = uniqueAnalysisFiles(batches);
  const measuredSource = sourceSize(resolve(projectRoot), files);
  const measuredFiles = files.map((file) => ({
    ...file,
    sizeLines: measuredSource.linesByPath.get(file.path) ?? 0,
  }));
  const lines = measuredFiles.reduce((sum, file) => sum + file.sizeLines, 0);
  const agentPayloadBytes = estimatedAgentInputBytes(batches.batches);
  const knownInputBytes = measuredSource.bytes + agentPayloadBytes;
  const tokenLower = Math.ceil(knownInputBytes / 4);
  const tokenUpper = Math.ceil(knownInputBytes / 2);
  const batchSizes = batches.batches.map((batch) => batch.files.length);
  const batchDetails = batches.batches.map((batch) => ({
    batchIndex: batch.batchIndex,
    files: batch.files.length,
    lines: batch.files.reduce(
      (sum, file) => sum + (measuredSource.linesByPath.get(file.path) ?? 0),
      0,
    ),
  }));
  const waves = Math.ceil(batches.totalBatches / parallelism);
  const generated = generatedSuggestions(measuredFiles);
  const generatedCount = generated.reduce((sum, suggestion) => sum + suggestion.fileCount, 0);
  const scopeSuggestions = [...generated, ...directorySuggestions(measuredFiles, lines)].slice(0, 6);

  const scanContentDigest =
    typeof scan.contentDigest === 'string' && /^[0-9a-f]{64}$/.test(scan.contentDigest)
      ? scan.contentDigest
      : null;
  const inputDigest = sha256({
    scanContentDigest,
    selectedSourceDigest: measuredSource.digest,
    scan: {
      files: scan.files,
      importMap: scan.importMap ?? {},
      filteredByIgnore: scan.filteredByIgnore ?? 0,
    },
    batches: {
      schemaVersion: batches.schemaVersion,
      algorithm: batches.algorithm ?? 'unknown',
      batches: batches.batches,
    },
  });

  const planWithoutId = {
    schemaUrl: ANALYSIS_PLAN_SCHEMA_URL,
    schemaVersion: ANALYSIS_PLAN_SCHEMA_VERSION,
    estimatorVersion: ANALYSIS_PLAN_ESTIMATOR_VERSION,
    mode,
    scope: { path: normalizedScope },
    inputDigest,
    scale: {
      projectFiles: scan.totalFiles,
      analysisFiles: files.length,
      lines,
      sourceBytes: measuredSource.bytes,
      selectedSourceDigest: measuredSource.digest,
      missingFiles: measuredSource.missingFiles,
      unsafePaths: measuredSource.unsafePaths,
      filteredByIgnore: isNonNegativeInteger(scan.filteredByIgnore) ? scan.filteredByIgnore : 0,
      byLanguage: sortedCounts(measuredFiles, 'language'),
      byCategory: sortedCounts(measuredFiles, 'fileCategory'),
    },
    batching: {
      algorithm: typeof batches.algorithm === 'string' ? batches.algorithm : 'unknown',
      totalBatches: batches.totalBatches,
      parallelism,
      waves,
      duplicateAssignments,
      batchSizes: distribution(batchSizes),
      batches: batchDetails,
      serializedBatchContextBytes: agentPayloadBytes,
    },
    estimates: {
      knownInputBytes,
      phase2InputTokens: {
        lower: tokenLower,
        upper: tokenUpper,
        confidence: 'low',
        method: 'source-plus-dispatch-bytes-envelope',
        includes: ['scoped source file bytes', 'batch file metadata', 'import data', 'neighbor data'],
        excludes: [
          'model output and reasoning tokens',
          'fixed agent instructions',
          'assemble, architecture, tour, and review agents',
        ],
      },
      wallTimeSeconds: {
        lower: null,
        upper: null,
        confidence: 'unavailable',
        method: 'uncalibrated',
        reason: 'Provider latency and model throughput are not exposed before the run.',
      },
      costUsd: {
        lower: null,
        upper: null,
        confidence: 'unavailable',
        method: 'provider-model-specific',
        reason: 'No provider, model, cache, or pricing contract is available to the skill.',
      },
    },
    risks: buildRisks({
      analysisFiles: files.length,
      lines,
      sourceBytes: measuredSource.bytes,
      totalBatches: batches.totalBatches,
      waves,
      missingFiles: measuredSource.missingFiles,
      unsafePaths: measuredSource.unsafePaths,
      duplicateAssignments,
      generatedCount,
      hasContentDigest: scanContentDigest !== null,
      mode,
    }),
    scopeSuggestions,
  };

  return {
    ...planWithoutId,
    planId: sha256({
      estimatorVersion: ANALYSIS_PLAN_ESTIMATOR_VERSION,
      mode,
      scope: planWithoutId.scope,
      parallelism,
      inputDigest,
    }),
  };
}

export function renderPlanSummary(plan) {
  const tokenRange =
    `${plan.estimates.phase2InputTokens.lower.toLocaleString('en-US')}-` +
    `${plan.estimates.phase2InputTokens.upper.toLocaleString('en-US')}`;
  const lines = [
    `Analysis preflight: ${plan.scale.analysisFiles}/${plan.scale.projectFiles} files, ` +
      `${plan.scale.lines.toLocaleString('en-US')} lines, ${plan.batching.totalBatches} batches ` +
      `(${plan.batching.waves} waves at concurrency ${plan.batching.parallelism}).`,
    `Known Phase 2 input estimate: ${tokenRange} tokens (low confidence; output/reasoning and later agents excluded).`,
    'Wall time and USD cost: unavailable until client/model telemetry or calibration is provided.',
  ];
  const elevated = plan.risks.filter((entry) => entry.severity !== 'low');
  if (elevated.length > 0) {
    lines.push(`Risks: ${elevated.map((entry) => `${entry.code} (${entry.severity})`).join(', ')}.`);
  }
  if (plan.scopeSuggestions.length > 0) {
    lines.push(
      `Scope suggestions: ${plan.scopeSuggestions
        .slice(0, 3)
        .map((suggestion) => `${suggestion.kind}=${terminalText(suggestion.value)}`)
        .join(', ')}.`,
    );
  }
  return lines.join('\n');
}

export function parseArgs(argv, cwd = process.cwd()) {
  let projectRoot = null;
  let mode = 'full';
  let parallelism = DEFAULT_PARALLELISM;
  let scope = '.';
  let scanResultPath = null;
  let batchesPath = null;
  let outputPath = null;
  let help = false;
  const seenOptions = new Set();

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const separator = arg.indexOf('=');
      const option = arg.slice(2, separator);
      const value = arg.slice(separator + 1);
      const allowed = new Set(['mode', 'parallelism', 'scope', 'scan-result', 'batches', 'output']);
      if (!allowed.has(option)) throw new AnalysisPlanInputError(`unknown option: --${option}`);
      if (!value || seenOptions.has(option)) {
        throw new AnalysisPlanInputError(`invalid or duplicate option: --${option}`);
      }
      seenOptions.add(option);
      if (option === 'mode') mode = value;
      else if (option === 'parallelism') parallelism = Number(value);
      else if (option === 'scope') scope = value;
      else if (option === 'scan-result') scanResultPath = resolve(cwd, value);
      else if (option === 'batches') batchesPath = resolve(cwd, value);
      else if (option === 'output') outputPath = resolve(cwd, value);
    } else if (arg.startsWith('-')) {
      throw new AnalysisPlanInputError(`unknown option: ${arg}`);
    } else if (projectRoot === null) {
      projectRoot = resolve(cwd, arg);
    } else {
      throw new AnalysisPlanInputError(`unexpected positional argument: ${arg}`);
    }
  }

  if (help) return { help: true };
  const root = projectRoot ?? resolve(cwd);
  const uaDir = resolveUaDir(root);
  return {
    projectRoot: root,
    mode,
    parallelism,
    scope,
    scanResultPath: scanResultPath ?? join(uaDir, 'intermediate', 'scan-result.json'),
    batchesPath: batchesPath ?? join(uaDir, 'intermediate', 'batches.json'),
    outputPath: outputPath ?? join(uaDir, 'analysis-plan.json'),
  };
}

export function helpText() {
  return [
    'Usage: node analysis-plan.mjs [project-root] [options]',
    '',
    'Options:',
    '  --mode=full|incremental',
    '  --parallelism=1..32',
    '  --scope=<relative-path>',
    '  --scan-result=<path>',
    '  --batches=<path>',
    '  --output=<path>',
  ].join('\n');
}

export function runCli(argv, cwd = process.cwd()) {
  const options = parseArgs(argv, cwd);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }
  if (!existsSync(options.projectRoot) || !statSync(options.projectRoot).isDirectory()) {
    throw new AnalysisPlanInputError('project root must exist and be a directory');
  }
  const scan = readJson(options.scanResultPath);
  const batches = readJson(options.batchesPath);
  const plan = buildAnalysisPlan({
    projectRoot: options.projectRoot,
    scan,
    batches,
    mode: options.mode,
    parallelism: options.parallelism,
    scope: options.scope,
  });
  atomicWriteJson(options.outputPath, plan);
  process.stdout.write(`${renderPlanSummary(plan)}\n`);
  process.stderr.write(`analysis-plan: wrote ${options.outputPath}\n`);
  return plan;
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`analysis-plan failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
