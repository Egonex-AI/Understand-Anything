#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ANALYSIS_PLAN_ESTIMATOR_VERSION,
  ANALYSIS_PLAN_SCHEMA_URL,
  ANALYSIS_PLAN_SCHEMA_VERSION,
  RUN_REPORT_SCHEMA_URL,
  RUN_REPORT_SCHEMA_VERSION,
  atomicWriteJson,
  boundedText,
  isCliEntry,
  normalizeRelativeScope,
  readJson,
  resolveUaDir,
  sha256,
  withFileLock,
} from './analysis-report-utils.mjs';

export const STAGE_NAMES = [
  'scan',
  'batching',
  'analysis',
  'merge',
  'assemble_review',
  'architecture',
  'tour',
  'review',
  'save',
];

const EXPECTED_SKIPPED_STAGES = {
  full: new Set(),
  incremental: new Set(['scan']),
  review: new Set(['scan', 'batching', 'analysis', 'merge', 'assemble_review', 'architecture', 'tour']),
};

const MAX_WARNINGS = 100;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class RunTelemetryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunTelemetryError';
  }
}

function requiredBoundedText(value, fallback, maxBytes = 4096) {
  return boundedText(value, maxBytes) || fallback;
}

function clockMilliseconds(clock) {
  return typeof clock === 'function' ? clock() : Date.now();
}

function clockSnapshot(clock) {
  const milliseconds = clockMilliseconds(clock);
  return { milliseconds, timestamp: new Date(milliseconds).toISOString() };
}

function timestamp(clock) {
  return clockSnapshot(clock).timestamp;
}

function durationSince(isoTimestamp, nowMilliseconds) {
  return Math.max(0, nowMilliseconds - Date.parse(isoTimestamp));
}

function emptyMetrics() {
  return {
    totalBatches: null,
    completedBatches: null,
    failedBatches: null,
    filesProcessed: null,
  };
}

function emptyStage() {
  return {
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    attempts: 0,
    retries: 0,
    metrics: emptyMetrics(),
    failures: [],
    error: null,
  };
}

export function createRunReport({ mode, scope = '.', clock, runId = randomUUID() }) {
  if (!['full', 'incremental', 'review'].includes(mode)) {
    throw new RunTelemetryError('mode must be full, incremental, or review');
  }
  if (
    typeof runId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)
  ) {
    throw new RunTelemetryError('runId must be a UUID');
  }
  let normalizedScope;
  try {
    normalizedScope = normalizeRelativeScope(scope);
  } catch (error) {
    throw new RunTelemetryError(error.message);
  }
  const startedAt = timestamp(clock);
  return {
    schemaUrl: RUN_REPORT_SCHEMA_URL,
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    runId,
    mode,
    status: 'running',
    startedAt,
    finishedAt: null,
    durationMs: null,
    scope: { path: normalizedScope },
    plan: {
      path: 'analysis-plan.json',
      planId: null,
      inputDigest: null,
      decision: 'pending',
      selectedScope: null,
    },
    stages: Object.fromEntries(STAGE_NAMES.map((name) => [name, emptyStage()])),
    analysisBatches: {
      total: 0,
      completed: 0,
      failed: 0,
      items: [],
    },
    usage: {
      telemetryAvailable: false,
      source: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      estimatedPhase2InputTokens: null,
    },
    warnings: [],
    warningOverflow: 0,
    error: null,
  };
}

function normalizeStageName(name) {
  const normalized = String(name ?? '').replaceAll('-', '_');
  if (!STAGE_NAMES.includes(normalized)) {
    throw new RunTelemetryError(`unknown stage: ${name}`);
  }
  return normalized;
}

function terminalize(report, status, clock, error = null) {
  const now = clockSnapshot(clock);
  report.status = status;
  report.finishedAt = now.timestamp;
  report.durationMs = durationSince(report.startedAt, now.milliseconds);
  report.error = error;
  return report;
}

function archivePreviousReport(outputPath, previous, clock) {
  if (!previous || typeof previous !== 'object') return;
  const archived = structuredClone(previous);
  if (archived.status === 'running') {
    interruptWork(archived, clock);
    terminalize(
      archived,
      'interrupted',
      clock,
      'A new run started before this report reached a terminal state.',
    );
  }
  const safeRunId =
    typeof archived.runId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      archived.runId,
    )
      ? archived.runId
      : `invalid-${sha256(archived).slice(0, 16)}`;
  const archiveName = `${safeRunId}-${clockMilliseconds(clock)}.json`;
  atomicWriteJson(join(resolveUaDirFromOutput(outputPath), 'run-reports', archiveName), archived);
}

function resolveUaDirFromOutput(outputPath) {
  return dirname(resolve(outputPath));
}

export function startRun({ projectRoot, mode, scope = '.', outputPath, clock, runId }) {
  const root = resolve(projectRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new RunTelemetryError('project root must exist and be a directory');
  }
  const target = outputPath ?? join(resolveUaDir(root), 'run-report.json');
  return withFileLock(target, () => {
    if (existsSync(target)) {
      archivePreviousReport(target, readJson(target), clock);
    }
    const report = createRunReport({ mode, scope, clock, runId });
    atomicWriteJson(target, report);
    return { report, outputPath: target };
  });
}

export function loadRun(outputPath) {
  if (!existsSync(outputPath)) {
    throw new RunTelemetryError(`run report not found: ${outputPath}`);
  }
  const report = readJson(outputPath);
  if (report.schemaVersion !== RUN_REPORT_SCHEMA_VERSION || typeof report.runId !== 'string') {
    throw new RunTelemetryError('run report has an unsupported or malformed schema');
  }
  return report;
}

function requireRunning(report) {
  if (report.status !== 'running') {
    throw new RunTelemetryError(`run is already ${report.status}`);
  }
}

export function attachPlan(report, plan) {
  requireRunning(report);
  if (report.mode === 'review') {
    throw new RunTelemetryError('review-only runs do not attach an analysis plan');
  }
  if (
    !plan ||
    plan.schemaVersion !== ANALYSIS_PLAN_SCHEMA_VERSION ||
    plan.schemaUrl !== ANALYSIS_PLAN_SCHEMA_URL ||
    plan.estimatorVersion !== ANALYSIS_PLAN_ESTIMATOR_VERSION ||
    !SHA256_PATTERN.test(plan.planId ?? '') ||
    !SHA256_PATTERN.test(plan.inputDigest ?? '') ||
    !SHA256_PATTERN.test(plan.scale?.selectedSourceDigest ?? '')
  ) {
    throw new RunTelemetryError('analysis plan has an unsupported or malformed schema');
  }
  if (plan.mode !== report.mode) {
    throw new RunTelemetryError(`analysis plan mode ${plan.mode} does not match run mode ${report.mode}`);
  }
  let planScope;
  try {
    planScope = normalizeRelativeScope(plan.scope?.path);
  } catch {
    throw new RunTelemetryError('analysis plan scope is malformed');
  }
  if (plan.scope.path !== planScope) {
    throw new RunTelemetryError('analysis plan scope must use its canonical relative form');
  }
  if (planScope !== report.scope.path) {
    throw new RunTelemetryError('analysis plan scope does not match the run scope');
  }
  const planBatches = plan.batching?.batches;
  const tokenEstimate = plan.estimates?.phase2InputTokens;
  if (
    !Number.isSafeInteger(plan.batching?.totalBatches) ||
    plan.batching.totalBatches < 0 ||
    !Number.isSafeInteger(plan.batching?.parallelism) ||
    plan.batching.parallelism < 1 ||
    plan.batching.parallelism > 32 ||
    !Array.isArray(planBatches) ||
    plan.batching.totalBatches !== planBatches.length ||
    !Number.isSafeInteger(tokenEstimate?.lower) ||
    tokenEstimate.lower < 0 ||
    !Number.isSafeInteger(tokenEstimate?.upper) ||
    tokenEstimate.upper < tokenEstimate.lower ||
    tokenEstimate.confidence !== 'low'
  ) {
    throw new RunTelemetryError('analysis plan workload is malformed');
  }
  const expectedPlanId = sha256({
    estimatorVersion: plan.estimatorVersion,
    mode: plan.mode,
    scope: plan.scope,
    parallelism: plan.batching.parallelism,
    inputDigest: plan.inputDigest,
  });
  if (plan.planId !== expectedPlanId) {
    throw new RunTelemetryError('analysis plan identity does not match its workload metadata');
  }
  const batchIndices = new Set();
  for (const batch of planBatches) {
    if (
      !Number.isSafeInteger(batch?.batchIndex) ||
      batch.batchIndex < 1 ||
      batchIndices.has(batch.batchIndex) ||
      !Number.isSafeInteger(batch.files) ||
      batch.files < 0 ||
      !Number.isSafeInteger(batch.lines) ||
      batch.lines < 0
    ) {
      throw new RunTelemetryError('analysis plan batch metadata is malformed');
    }
    batchIndices.add(batch.batchIndex);
  }
  if (report.plan.planId !== null || report.plan.decision !== 'pending') {
    throw new RunTelemetryError('an analysis plan can only be attached once before a decision');
  }
  report.plan.path = 'analysis-plan.json';
  report.plan.planId = plan.planId;
  report.plan.inputDigest = plan.inputDigest;
  report.usage.estimatedPhase2InputTokens = {
    lower: plan.estimates.phase2InputTokens.lower,
    upper: plan.estimates.phase2InputTokens.upper,
    confidence: plan.estimates.phase2InputTokens.confidence,
  };
  report.analysisBatches.total = plan.batching.totalBatches;
  report.analysisBatches.items = plan.batching.batches.map((batch) => ({
    batchIndex: batch.batchIndex,
    status: 'pending',
    files: batch.files,
    lines: batch.lines,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    attempts: 0,
    retries: 0,
    failures: [],
    error: null,
  }));
  return report;
}

export function recordDecision(report, decision, selectedScope = null, clock) {
  requireRunning(report);
  if (!['continue', 'scoped', 'cancelled'].includes(decision)) {
    throw new RunTelemetryError('decision must be continue, scoped, or cancelled');
  }
  if (report.plan.planId === null) {
    throw new RunTelemetryError('attach an analysis plan before recording a decision');
  }
  if (report.plan.decision !== 'pending') throw new RunTelemetryError('preflight decision is already recorded');
  const runningStages = STAGE_NAMES.filter((name) => report.stages[name].status === 'running');
  const runningBatches = report.analysisBatches.items.filter((batch) => batch.status === 'running');
  if (runningStages.length > 0 || runningBatches.length > 0) {
    throw new RunTelemetryError('cannot record a preflight decision while analysis work is running');
  }
  if (decision !== 'scoped' && selectedScope !== null) {
    throw new RunTelemetryError('selected scope is only valid for the scoped decision');
  }
  let normalizedScope = null;
  if (decision === 'scoped') {
    try {
      normalizedScope = normalizeRelativeScope(selectedScope);
    } catch (error) {
      throw new RunTelemetryError(error.message);
    }
  }
  report.plan.decision = decision;
  report.plan.selectedScope = normalizedScope;
  if (decision === 'cancelled' || decision === 'scoped') {
    const reason =
      decision === 'scoped'
        ? `Scope adjustment requested: ${normalizedScope}. Start a fresh scan and plan for that scope.`
        : 'Cancelled after preflight review.';
    skipPendingWork(report, clock, reason);
    terminalize(report, 'cancelled', clock, reason);
  }
  return report;
}

function batchByIndex(report, batchIndex) {
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 1) {
    throw new RunTelemetryError('batch index must be a positive integer');
  }
  const batch = report.analysisBatches.items.find((entry) => entry.batchIndex === batchIndex);
  if (!batch) throw new RunTelemetryError(`batch ${batchIndex} is not present in the attached plan`);
  return batch;
}

function synchronizeBatchCounts(report) {
  report.analysisBatches.completed = report.analysisBatches.items.filter((batch) =>
    ['ok', 'degraded'].includes(batch.status),
  ).length;
  report.analysisBatches.failed = report.analysisBatches.items.filter(
    (batch) => batch.status === 'failed',
  ).length;
}

export function startBatch(report, batchIndex, clock) {
  requireRunning(report);
  if (report.plan.decision !== 'continue') {
    throw new RunTelemetryError('batch analysis requires an explicit continue decision');
  }
  if (report.stages.analysis.status !== 'running') {
    throw new RunTelemetryError('batch analysis requires the analysis stage to be running');
  }
  const batch = batchByIndex(report, batchIndex);
  if (!['pending', 'failed'].includes(batch.status)) {
    throw new RunTelemetryError(`batch ${batchIndex} cannot start from status ${batch.status}`);
  }
  const now = timestamp(clock);
  batch.status = 'running';
  batch.startedAt ??= now;
  batch.finishedAt = null;
  batch.durationMs = null;
  batch.attempts += 1;
  batch.retries = Math.max(0, batch.attempts - 1);
  batch.error = null;
  synchronizeBatchCounts(report);
  return report;
}

export function finishBatch(report, batchIndex, status, error = null, clock) {
  requireRunning(report);
  const batch = batchByIndex(report, batchIndex);
  if (batch.status !== 'running') throw new RunTelemetryError(`batch ${batchIndex} is not running`);
  if (!['ok', 'degraded', 'failed'].includes(status)) {
    throw new RunTelemetryError('batch status must be ok, degraded, or failed');
  }
  batch.status = status;
  const now = clockSnapshot(clock);
  batch.finishedAt = now.timestamp;
  batch.durationMs = durationSince(batch.startedAt, now.milliseconds);
  batch.error =
    status === 'failed' ? requiredBoundedText(error, 'Batch failed without an error message.') : null;
  if (status === 'failed') {
    batch.failures.push({ attempt: batch.attempts, finishedAt: batch.finishedAt, error: batch.error });
  }
  synchronizeBatchCounts(report);
  return report;
}

export function skipBatch(report, batchIndex, reason, clock) {
  requireRunning(report);
  const batch = batchByIndex(report, batchIndex);
  if (batch.status !== 'pending') {
    throw new RunTelemetryError(`batch ${batchIndex} cannot be skipped from status ${batch.status}`);
  }
  const now = timestamp(clock);
  batch.status = 'skipped';
  batch.startedAt = now;
  batch.finishedAt = now;
  batch.durationMs = 0;
  batch.error = requiredBoundedText(reason, 'Batch was not attempted.');
  synchronizeBatchCounts(report);
  return report;
}

export function startStage(report, stageName, clock) {
  requireRunning(report);
  const name = normalizeStageName(stageName);
  const stage = report.stages[name];
  if (name === 'analysis' && report.mode !== 'review' && report.plan.decision !== 'continue') {
    throw new RunTelemetryError('analysis stage requires an explicit continue decision');
  }
  if (!['pending', 'failed'].includes(stage.status)) {
    throw new RunTelemetryError(`stage ${name} cannot start from status ${stage.status}`);
  }
  const now = timestamp(clock);
  stage.status = 'running';
  stage.startedAt ??= now;
  stage.finishedAt = null;
  stage.durationMs = null;
  stage.attempts += 1;
  stage.retries = Math.max(0, stage.attempts - 1);
  stage.error = null;
  return report;
}

function applyMetrics(stage, metrics = {}) {
  const nextMetrics = { ...stage.metrics };
  for (const key of Object.keys(stage.metrics)) {
    if (metrics[key] === undefined) continue;
    const value = metrics[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RunTelemetryError(`${key} must be a non-negative integer`);
    }
    nextMetrics[key] = value;
  }
  if (
    nextMetrics.totalBatches !== null &&
    nextMetrics.completedBatches !== null &&
    nextMetrics.completedBatches > nextMetrics.totalBatches
  ) {
    throw new RunTelemetryError('completedBatches cannot exceed totalBatches');
  }
  if (
    nextMetrics.totalBatches !== null &&
    nextMetrics.failedBatches !== null &&
    nextMetrics.failedBatches > nextMetrics.totalBatches
  ) {
    throw new RunTelemetryError('failedBatches cannot exceed totalBatches');
  }
  if (
    nextMetrics.totalBatches !== null &&
    nextMetrics.completedBatches !== null &&
    nextMetrics.failedBatches !== null &&
    nextMetrics.completedBatches + nextMetrics.failedBatches > nextMetrics.totalBatches
  ) {
    throw new RunTelemetryError('completedBatches plus failedBatches cannot exceed totalBatches');
  }
  stage.metrics = nextMetrics;
}

export function finishStage(report, stageName, status, metrics = {}, error = null, clock) {
  requireRunning(report);
  const name = normalizeStageName(stageName);
  const stage = report.stages[name];
  if (stage.status !== 'running') {
    throw new RunTelemetryError(`stage ${name} is not running`);
  }
  if (!['ok', 'degraded', 'failed'].includes(status)) {
    throw new RunTelemetryError('stage status must be ok, degraded, or failed');
  }
  if (name === 'analysis' && report.analysisBatches.total > 0) {
    const runningBatches = report.analysisBatches.items.filter((batch) => batch.status === 'running');
    const pendingBatches = report.analysisBatches.items.filter((batch) => batch.status === 'pending');
    const skippedBatches = report.analysisBatches.items.filter((batch) => batch.status === 'skipped');
    const degradedBatches = report.analysisBatches.items.filter((batch) => batch.status === 'degraded');
    if (runningBatches.length > 0) {
      throw new RunTelemetryError('cannot finish analysis while batches are running');
    }
    if (status !== 'failed' && pendingBatches.length > 0) {
      throw new RunTelemetryError('cannot finish successful analysis while batches are pending');
    }
    synchronizeBatchCounts(report);
    if (
      status === 'ok' &&
      (report.analysisBatches.failed > 0 || skippedBatches.length > 0 || degradedBatches.length > 0)
    ) {
      throw new RunTelemetryError(
        'analysis with degraded, failed, or skipped batches must be degraded or failed',
      );
    }
  }
  applyMetrics(stage, metrics);
  if (name === 'analysis' && report.analysisBatches.total > 0) {
    synchronizeBatchCounts(report);
    stage.metrics.totalBatches = report.analysisBatches.total;
    stage.metrics.completedBatches = report.analysisBatches.completed;
    stage.metrics.failedBatches = report.analysisBatches.failed;
  }
  stage.status = status;
  const now = clockSnapshot(clock);
  stage.finishedAt = now.timestamp;
  stage.durationMs = durationSince(stage.startedAt, now.milliseconds);
  stage.error =
    status === 'failed' ? requiredBoundedText(error, 'Stage failed without an error message.') : null;
  if (status === 'failed') {
    stage.failures.push({ attempt: stage.attempts, finishedAt: stage.finishedAt, error: stage.error });
  }
  return report;
}

export function skipStage(report, stageName, reason, clock) {
  requireRunning(report);
  const name = normalizeStageName(stageName);
  const stage = report.stages[name];
  if (stage.status !== 'pending') {
    throw new RunTelemetryError(`stage ${name} cannot be skipped from status ${stage.status}`);
  }
  const now = timestamp(clock);
  stage.status = 'skipped';
  stage.startedAt = now;
  stage.finishedAt = now;
  stage.durationMs = 0;
  stage.error = requiredBoundedText(reason, 'Not required for this run mode.');
  return report;
}

function redactProjectRoot(message, projectRoot) {
  if (!message) return null;
  const root = resolve(projectRoot);
  const aliases = new Set([
    root,
    root.replaceAll('\\', '/'),
    root.replaceAll('/', '\\'),
    pathToFileURL(root).href,
  ]);
  let redacted = boundedText(message);
  for (const alias of aliases) {
    if (!alias) continue;
    if (process.platform === 'win32') {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      redacted = redacted.replace(new RegExp(escaped, 'gi'), '<project>');
    } else {
      redacted = redacted.replaceAll(alias, '<project>');
    }
  }
  return redacted;
}

export function addWarning(report, stageName, message, projectRoot) {
  requireRunning(report);
  const stage = normalizeStageName(stageName);
  if (report.warnings.length >= MAX_WARNINGS) {
    report.warningOverflow += 1;
    return report;
  }
  const redacted = redactProjectRoot(message, projectRoot);
  if (!redacted) throw new RunTelemetryError('warning message must not be empty');
  report.warnings.push({ stage, message: redacted });
  return report;
}

export function recordUsage(report, usage) {
  requireRunning(report);
  const numericFields = ['inputTokens', 'outputTokens', 'costUsd'];
  const providedFields = numericFields.filter((field) => usage[field] !== undefined);
  if (providedFields.length === 0) {
    throw new RunTelemetryError('usage requires at least one numeric telemetry value');
  }
  for (const field of providedFields) {
    const value = usage[field];
    const valid =
      field === 'costUsd'
        ? typeof value === 'number' && Number.isFinite(value) && value >= 0
        : Number.isSafeInteger(value) && value >= 0;
    if (!valid) {
      throw new RunTelemetryError(
        `${field} must be a non-negative ${field === 'costUsd' ? 'number' : 'integer'}`,
      );
    }
  }
  for (const field of providedFields) report.usage[field] = usage[field];
  report.usage.telemetryAvailable = true;
  report.usage.source = requiredBoundedText(usage.source, 'external-client', 256);
  return report;
}

export function finishRun(report, requestedStatus, error, clock) {
  requireRunning(report);
  if (!['ok', 'degraded', 'failed', 'cancelled'].includes(requestedStatus)) {
    throw new RunTelemetryError('run status must be ok, degraded, failed, or cancelled');
  }
  const runningStages = STAGE_NAMES.filter((name) => report.stages[name].status === 'running');
  if (runningStages.length > 0) {
    throw new RunTelemetryError(`cannot finish while stages are running: ${runningStages.join(', ')}`);
  }
  const runningBatches = report.analysisBatches.items.filter((batch) => batch.status === 'running');
  if (runningBatches.length > 0) {
    throw new RunTelemetryError(
      `cannot finish while batches are running: ${runningBatches.map((batch) => batch.batchIndex).join(', ')}`,
    );
  }
  if (
    ['ok', 'degraded'].includes(requestedStatus) &&
    report.mode !== 'review' &&
    report.plan.decision !== 'continue'
  ) {
    throw new RunTelemetryError('successful analysis requires an explicit continue decision');
  }
  if (['ok', 'degraded'].includes(requestedStatus)) {
    const pendingStages = STAGE_NAMES.filter((name) => report.stages[name].status === 'pending');
    const pendingBatches = report.analysisBatches.items.filter((batch) => batch.status === 'pending');
    if (pendingStages.length > 0 || pendingBatches.length > 0) {
      throw new RunTelemetryError('successful analysis cannot leave pending stages or batches');
    }
    if (!['ok', 'degraded'].includes(report.stages.save.status)) {
      throw new RunTelemetryError('successful analysis requires the save stage to complete');
    }
  }
  let status = requestedStatus;
  const unexpectedSkippedStages = STAGE_NAMES.filter(
    (name) =>
      report.stages[name].status === 'skipped' && !EXPECTED_SKIPPED_STAGES[report.mode].has(name),
  );
  if (
    status === 'ok' &&
    (STAGE_NAMES.some((name) => ['degraded', 'failed'].includes(report.stages[name].status)) ||
      unexpectedSkippedStages.length > 0 ||
      report.analysisBatches.failed > 0 ||
      report.analysisBatches.items.some((batch) => ['degraded', 'skipped'].includes(batch.status)) ||
      report.warnings.length > 0 ||
      report.warningOverflow > 0)
  ) {
    status = 'degraded';
  }
  skipPendingWork(report, clock, 'Not reached in this run.');
  let terminalError = null;
  if (status === 'failed') terminalError = requiredBoundedText(error, 'Run failed.');
  if (status === 'cancelled') terminalError = requiredBoundedText(error, 'Run cancelled.');
  terminalize(report, status, clock, terminalError);
  return report;
}

function skipPendingWork(report, clock, reason) {
  const now = timestamp(clock);
  for (const name of STAGE_NAMES) {
    if (report.stages[name].status === 'pending') {
      report.stages[name] = {
        ...emptyStage(),
        status: 'skipped',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        error: reason,
      };
    }
  }
  for (const batch of report.analysisBatches.items) {
    if (batch.status === 'pending') {
      batch.status = 'skipped';
      batch.startedAt = now;
      batch.finishedAt = now;
      batch.durationMs = 0;
      batch.error = reason;
    }
  }
  synchronizeBatchCounts(report);
}

function interruptWork(report, clock) {
  const now = timestamp(clock);
  for (const name of STAGE_NAMES) {
    const stage = report.stages?.[name];
    if (!stage) continue;
    if (stage.status === 'running') {
      stage.status = 'failed';
      stage.finishedAt = now;
      stage.durationMs = stage.startedAt ? Math.max(0, Date.parse(now) - Date.parse(stage.startedAt)) : 0;
      stage.error = 'Interrupted by a newer analysis run.';
      stage.failures ??= [];
      stage.failures.push({ attempt: Math.max(1, stage.attempts), finishedAt: now, error: stage.error });
    } else if (stage.status === 'pending') {
      stage.status = 'skipped';
      stage.startedAt = now;
      stage.finishedAt = now;
      stage.durationMs = 0;
      stage.error = 'Not reached before interruption.';
    }
  }
  for (const batch of report.analysisBatches?.items ?? []) {
    if (batch.status === 'running') {
      batch.status = 'failed';
      batch.finishedAt = now;
      batch.durationMs = batch.startedAt ? Math.max(0, Date.parse(now) - Date.parse(batch.startedAt)) : 0;
      batch.error = 'Interrupted by a newer analysis run.';
      batch.failures ??= [];
      batch.failures.push({ attempt: Math.max(1, batch.attempts), finishedAt: now, error: batch.error });
    } else if (batch.status === 'pending') {
      batch.status = 'skipped';
      batch.startedAt = now;
      batch.finishedAt = now;
      batch.durationMs = 0;
      batch.error = 'Not reached before interruption.';
    }
  }
  if (report.analysisBatches) synchronizeBatchCounts(report);
}

function writeUpdatedReport(outputPath, mutate) {
  return withFileLock(outputPath, () => {
    const report = loadRun(outputPath);
    mutate(report);
    atomicWriteJson(outputPath, report);
    return report;
  });
}

function flagMap(args) {
  const flags = new Map();
  for (const arg of args) {
    if (!arg.startsWith('--') || !arg.includes('=')) {
      throw new RunTelemetryError(`invalid option: ${arg}`);
    }
    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    if (!value || flags.has(key)) throw new RunTelemetryError(`invalid or duplicate option: --${key}`);
    flags.set(key, value);
  }
  return flags;
}

function nonNegativeIntegerFlag(flags, name) {
  if (!flags.has(name)) return undefined;
  const value = Number(flags.get(name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RunTelemetryError(`--${name} must be a non-negative integer`);
  }
  return value;
}

function exclusiveTextOption(flags, inlineName, fileName) {
  if (flags.has(inlineName) && flags.has(fileName)) {
    throw new RunTelemetryError(`use only one of --${inlineName} or --${fileName}`);
  }
  if (flags.has(fileName)) {
    let descriptor;
    try {
      descriptor = openSync(resolve(flags.get(fileName)), 'r');
      const buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return buffer.subarray(0, offset).toString('utf8');
    } catch (error) {
      throw new RunTelemetryError(`unable to read --${fileName}: ${error.message}`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  return flags.get(inlineName) ?? null;
}

function reportPath(projectRoot, flags) {
  return flags.has('report')
    ? resolve(flags.get('report'))
    : join(resolveUaDir(projectRoot), 'run-report.json');
}

export function helpText() {
  return [
    'Usage: node run-telemetry.mjs <command> <project-root> [argument] [options]',
    '',
    'Commands:',
    '  start --mode=full|incremental|review [--scope=.]',
    '  attach-plan',
    '  decision <continue|scoped|cancelled> [--scope=<relative-path>]',
    '  stage-start <stage>',
    '  stage-finish <stage> --status=ok|degraded|failed [batch metrics]',
    '  stage-skip <stage> --reason=<text>',
    '  batch-start <batch-index>',
    '  batch-finish <batch-index> --status=ok|degraded|failed [--error=<text>]',
    '  batch-skip <batch-index> --reason=<text>',
    '  warning <stage> --message=<text>',
    '  usage [--input-tokens=N] [--output-tokens=N] [--cost-usd=N] [--source=name]',
    '  finish --status=ok|degraded|failed|cancelled [--error=<text>]',
    '',
    'All commands accept --report=<path>.',
  ].join('\n');
}

export function runCli(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }
  const [command, rootValue, argument, ...rest] = argv;
  if (!rootValue) throw new RunTelemetryError('project root is required');
  const projectRoot = resolve(rootValue);
  const positionalCommands = new Set([
    'decision',
    'stage-start',
    'stage-finish',
    'stage-skip',
    'batch-start',
    'batch-finish',
    'batch-skip',
    'warning',
  ]);
  const flagArgs = positionalCommands.has(command) ? rest : [argument, ...rest].filter(Boolean);
  const flags = flagMap(flagArgs);
  const outputPath = reportPath(projectRoot, flags);
  flags.delete('report');
  let report;

  if (command === 'start') {
    const allowed = new Set(['mode', 'scope']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    const result = startRun({
      projectRoot,
      mode: flags.get('mode') ?? 'full',
      scope: flags.get('scope') ?? '.',
      outputPath,
    });
    report = result.report;
  } else if (command === 'attach-plan') {
    if (flags.size > 0) throw new RunTelemetryError(`unknown option: --${[...flags.keys()][0]}`);
    const planPath = join(resolveUaDir(projectRoot), 'analysis-plan.json');
    report = writeUpdatedReport(outputPath, (current) => attachPlan(current, readJson(planPath)));
  } else if (command === 'decision') {
    const allowed = new Set(['scope']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    report = writeUpdatedReport(outputPath, (current) =>
      recordDecision(current, argument, flags.get('scope') ?? null),
    );
  } else if (command === 'stage-start') {
    if (flags.size > 0) throw new RunTelemetryError(`unknown option: --${[...flags.keys()][0]}`);
    report = writeUpdatedReport(outputPath, (current) => startStage(current, argument));
  } else if (command === 'stage-finish') {
    const allowed = new Set([
      'status',
      'error',
      'error-file',
      'total-batches',
      'completed-batches',
      'failed-batches',
      'files-processed',
    ]);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    const metrics = {
      totalBatches: nonNegativeIntegerFlag(flags, 'total-batches'),
      completedBatches: nonNegativeIntegerFlag(flags, 'completed-batches'),
      failedBatches: nonNegativeIntegerFlag(flags, 'failed-batches'),
      filesProcessed: nonNegativeIntegerFlag(flags, 'files-processed'),
    };
    report = writeUpdatedReport(outputPath, (current) =>
      finishStage(
        current,
        argument,
        flags.get('status') ?? 'ok',
        metrics,
        redactProjectRoot(exclusiveTextOption(flags, 'error', 'error-file'), projectRoot),
      ),
    );
  } else if (command === 'stage-skip') {
    const allowed = new Set(['reason']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    report = writeUpdatedReport(outputPath, (current) =>
      skipStage(
        current,
        argument,
        redactProjectRoot(flags.get('reason') ?? 'Not required for this run mode.', projectRoot),
      ),
    );
  } else if (command === 'batch-start') {
    if (flags.size > 0) throw new RunTelemetryError(`unknown option: --${[...flags.keys()][0]}`);
    report = writeUpdatedReport(outputPath, (current) => startBatch(current, Number(argument)));
  } else if (command === 'batch-finish') {
    const allowed = new Set(['status', 'error', 'error-file']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    report = writeUpdatedReport(outputPath, (current) =>
      finishBatch(
        current,
        Number(argument),
        flags.get('status') ?? 'ok',
        redactProjectRoot(exclusiveTextOption(flags, 'error', 'error-file'), projectRoot),
      ),
    );
  } else if (command === 'batch-skip') {
    const allowed = new Set(['reason']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    report = writeUpdatedReport(outputPath, (current) =>
      skipBatch(
        current,
        Number(argument),
        redactProjectRoot(flags.get('reason') ?? 'Batch was not attempted.', projectRoot),
      ),
    );
  } else if (command === 'warning') {
    const allowed = new Set(['message', 'message-file']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    const message = exclusiveTextOption(flags, 'message', 'message-file');
    if (!message) throw new RunTelemetryError('--message or --message-file is required');
    report = writeUpdatedReport(outputPath, (current) =>
      addWarning(current, argument, message, projectRoot),
    );
  } else if (command === 'usage') {
    const allowed = new Set(['input-tokens', 'output-tokens', 'cost-usd', 'source']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    const numeric = (name) => (flags.has(name) ? Number(flags.get(name)) : undefined);
    report = writeUpdatedReport(outputPath, (current) =>
      recordUsage(current, {
        inputTokens: numeric('input-tokens'),
        outputTokens: numeric('output-tokens'),
        costUsd: numeric('cost-usd'),
        source: flags.get('source'),
      }),
    );
  } else if (command === 'finish') {
    const allowed = new Set(['status', 'error', 'error-file']);
    for (const key of flags.keys()) if (!allowed.has(key)) throw new RunTelemetryError(`unknown option: --${key}`);
    report = writeUpdatedReport(outputPath, (current) =>
      finishRun(
        current,
        flags.get('status') ?? 'ok',
        redactProjectRoot(exclusiveTextOption(flags, 'error', 'error-file'), projectRoot),
      ),
    );
  } else {
    throw new RunTelemetryError(`unknown command: ${command}`);
  }

  process.stderr.write(`run-telemetry: ${command} -> ${outputPath} (${report.status})\n`);
  return report;
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`run-telemetry failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
