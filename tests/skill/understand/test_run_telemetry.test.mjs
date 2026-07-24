import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RunTelemetryError,
  STAGE_NAMES,
  addWarning,
  attachPlan,
  createRunReport,
  finishBatch,
  finishRun,
  finishStage,
  recordDecision,
  recordUsage,
  runCli,
  skipStage,
  startBatch,
  startRun,
  startStage,
} from '../../../understand-anything-plugin/skills/understand/run-telemetry.mjs';
import {
  ANALYSIS_PLAN_ESTIMATOR_VERSION,
  ANALYSIS_PLAN_SCHEMA_URL,
  sha256,
} from '../../../understand-anything-plugin/skills/understand/analysis-report-utils.mjs';

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ua run telemetry-'));
  roots.push(root);
  return root;
}

function fakeClock() {
  let value = Date.parse('2026-01-01T00:00:00.000Z');
  return () => {
    value += 100;
    return value;
  };
}

function plan(mode = 'full', scope = '.') {
  const inputDigest = '2'.repeat(64);
  const parallelism = 5;
  const planScope = { path: scope };
  return {
    schemaUrl: ANALYSIS_PLAN_SCHEMA_URL,
    schemaVersion: '1.0.0',
    estimatorVersion: ANALYSIS_PLAN_ESTIMATOR_VERSION,
    mode,
    scope: planScope,
    planId: sha256({
      estimatorVersion: ANALYSIS_PLAN_ESTIMATOR_VERSION,
      mode,
      scope: planScope,
      parallelism,
      inputDigest,
    }),
    inputDigest,
    scale: { selectedSourceDigest: '3'.repeat(64) },
    batching: {
      parallelism,
      totalBatches: 2,
      batches: [
        { batchIndex: 2, files: 3, lines: 30 },
        { batchIndex: 7, files: 1, lines: 10 },
      ],
    },
    estimates: {
      phase2InputTokens: { lower: 100, upper: 200, confidence: 'low' },
    },
  };
}

function completePendingStages(report, clock) {
  for (const name of STAGE_NAMES) {
    if (report.stages[name].status !== 'pending') continue;
    startStage(report, name, clock);
    finishStage(report, name, 'ok', {}, null, clock);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('analysis run telemetry', () => {
  it('records stage and per-batch retries while retaining failure history', () => {
    const clock = fakeClock();
    const report = createRunReport({ mode: 'full', clock, runId: randomUUID() });
    attachPlan(report, plan());
    recordDecision(report, 'continue', null, clock);
    startStage(report, 'analysis', clock);

    startBatch(report, 2, clock);
    finishBatch(report, 2, 'failed', 'temporary model failure', clock);
    startBatch(report, 2, clock);
    finishBatch(report, 2, 'ok', null, clock);
    startBatch(report, 7, clock);
    finishBatch(report, 7, 'ok', null, clock);
    finishStage(report, 'analysis', 'ok', { filesProcessed: 4 }, null, clock);
    completePendingStages(report, clock);
    finishRun(report, 'ok', null, clock);

    const retried = report.analysisBatches.items[0];
    expect(retried).toMatchObject({ status: 'ok', attempts: 2, retries: 1 });
    expect(retried.error).toBeNull();
    expect(retried.failures).toEqual([
      expect.objectContaining({ attempt: 1, error: 'temporary model failure' }),
    ]);
    expect(retried.durationMs).toBe(
      Date.parse(retried.finishedAt) - Date.parse(retried.startedAt),
    );
    expect(report.stages.analysis.metrics).toMatchObject({
      totalBatches: 2,
      completedBatches: 2,
      failedBatches: 0,
      filesProcessed: 4,
    });
    expect(report.status).toBe('ok');
    expect(report.durationMs).toBe(Date.parse(report.finishedAt) - Date.parse(report.startedAt));
    expect(report.usage).toMatchObject({
      telemetryAvailable: false,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
  });

  it('makes scoped and cancelled decisions terminal so stale artifacts cannot continue', () => {
    const clock = fakeClock();
    for (const [decision, selectedScope] of [
      ['scoped', 'packages/core'],
      ['cancelled', null],
    ]) {
      const report = createRunReport({ mode: 'full', clock, runId: randomUUID() });
      attachPlan(report, plan());
      recordDecision(report, decision, selectedScope, clock);

      expect(report.status).toBe('cancelled');
      expect(report.plan.decision).toBe(decision);
      expect(Object.values(report.stages).every((stage) => stage.status === 'skipped')).toBe(true);
      expect(report.analysisBatches.items.every((batch) => batch.status === 'skipped')).toBe(true);
      expect(() => startStage(report, 'analysis', clock)).toThrow(/already cancelled/);
    }
  });

  it('locks plan and decision transitions and rejects unknown batches', () => {
    const report = createRunReport({ mode: 'incremental', runId: randomUUID() });
    attachPlan(report, plan('incremental'));
    expect(() => attachPlan(report, plan('incremental'))).toThrow(/only be attached once/);
    recordDecision(report, 'continue');
    expect(() => recordDecision(report, 'continue')).toThrow(/already recorded/);
    startStage(report, 'analysis');
    expect(() => startBatch(report, 99)).toThrow(/not present/);
  });

  it('downgrades an otherwise successful run when warnings are present', () => {
    const root = makeRoot();
    const clock = fakeClock();
    const report = createRunReport({ mode: 'review', clock, runId: randomUUID() });
    addWarning(report, 'analysis', `${root}\\private.ts failed`, root);
    completePendingStages(report, clock);
    finishRun(report, 'ok', null, clock);

    expect(report.status).toBe('degraded');
    expect(report.warnings[0].message).not.toContain(root);
    expect(report.warnings[0].message).toContain('<project>');
  });

  it('accepts optional external usage without fabricating unavailable fields', () => {
    const report = createRunReport({ mode: 'full', runId: randomUUID() });
    recordUsage(report, { inputTokens: 123, source: 'client-export' });

    expect(report.usage).toMatchObject({
      telemetryAvailable: true,
      source: 'client-export',
      inputTokens: 123,
      outputTokens: null,
      costUsd: null,
    });
    expect(() => recordUsage(report, {})).toThrow(/at least one/);
    expect(() => recordUsage(report, { inputTokens: 1.5 })).toThrow(/integer/);
  });

  it('archives a terminal report and marks an active predecessor interrupted', () => {
    const root = makeRoot();
    const dataDir = join(root, '.ua');
    mkdirSync(dataDir, { recursive: true });
    const reportPath = join(dataDir, 'run-report.json');
    const old = createRunReport({ mode: 'full', runId: randomUUID() });
    startStage(old, 'scan');
    writeFileSync(reportPath, JSON.stringify(old));

    const { report } = startRun({ projectRoot: root, mode: 'incremental', outputPath: reportPath });
    const archives = readdirSync(join(dataDir, 'run-reports'));
    const archived = JSON.parse(readFileSync(join(dataDir, 'run-reports', archives[0]), 'utf8'));

    expect(report.mode).toBe('incremental');
    expect(archived.status).toBe('interrupted');
    expect(archived.stages.scan.status).toBe('failed');
    expect(archived.stages.scan.error).toMatch(/Interrupted/);
  });

  it('enforces legal stage transitions and bounded metrics', () => {
    const report = createRunReport({ mode: 'full', runId: randomUUID() });
    expect(() => finishStage(report, 'scan', 'ok')).toThrow(/not running/);
    startStage(report, 'scan');
    expect(() => startStage(report, 'scan')).toThrow(/cannot start/);
    expect(() =>
      finishStage(report, 'scan', 'ok', { totalBatches: 1, completedBatches: 2 }),
    ).toThrow(/cannot exceed/);
    expect(() => skipStage(report, 'scan', 'unused')).toThrow(/cannot be skipped/);
    expect(() => createRunReport({ mode: 'full', runId: 'not-a-uuid' })).toThrow(
      RunTelemetryError,
    );
  });

  it('enforces the preflight decision and matching plan identity before analysis', () => {
    const report = createRunReport({ mode: 'full', scope: 'packages/core', runId: randomUUID() });

    expect(() => startStage(report, 'analysis')).toThrow(/continue decision/);
    expect(() => finishRun(report, 'ok')).toThrow(/continue decision/);
    expect(() => attachPlan(report, plan('incremental', 'packages/core'))).toThrow(/mode/);
    expect(() => attachPlan(report, plan('full', 'packages/other'))).toThrow(/scope/);

    const tampered = plan('full', 'packages/core');
    tampered.batching.parallelism = 6;
    expect(() => attachPlan(report, tampered)).toThrow(/identity/);

    attachPlan(report, plan('full', 'packages/core'));
    expect(() => recordDecision(report, 'scoped', 'a'.repeat(1025))).toThrow(/1024 bytes/);
    expect(() => startStage(report, 'analysis')).toThrow(/continue decision/);
    recordDecision(report, 'continue');
    expect(() => finishRun(report, 'ok')).toThrow(/pending stages or batches/);
    startStage(report, 'analysis');
    startBatch(report, 2);
    expect(() => finishStage(report, 'analysis', 'ok')).toThrow(/batches are running/);
    expect(() => finishRun(report, 'ok')).toThrow(/stages are running/);
  });

  it('keeps terminal and text states schema-compatible at producer boundaries', () => {
    const cancelled = createRunReport({ mode: 'full', runId: randomUUID() });
    finishRun(cancelled, 'cancelled', '   ');
    expect(cancelled).toMatchObject({ status: 'cancelled', error: 'Run cancelled.' });

    const report = createRunReport({ mode: 'full', runId: randomUUID() });
    recordUsage(report, { inputTokens: 1, source: '   ' });
    expect(report.usage.source).toBe('external-client');
    expect(() => addWarning(report, 'scan', '   ', makeRoot())).toThrow(/must not be empty/);
  });

  it('propagates degraded batch outcomes to the analysis stage and run', () => {
    const report = createRunReport({ mode: 'full', runId: randomUUID() });
    attachPlan(report, plan());
    recordDecision(report, 'continue');
    startStage(report, 'analysis');
    startBatch(report, 2);
    finishBatch(report, 2, 'degraded');
    startBatch(report, 7);
    finishBatch(report, 7, 'ok');

    expect(() => finishStage(report, 'analysis', 'ok')).toThrow(/must be degraded/);
    finishStage(report, 'analysis', 'degraded');
    completePendingStages(report);
    finishRun(report, 'ok');

    expect(report.status).toBe('degraded');
  });

  it('drives the persisted report through the production CLI contract', () => {
    const root = makeRoot();
    const dataDir = join(root, '.ua');
    const tempDir = join(dataDir, 'tmp');
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(dataDir, 'analysis-plan.json'), JSON.stringify(plan()));

    runCli(['start', root, '--mode=full']);
    expect(() => runCli(['attach-plan', root, `--plan=${join(dataDir, 'analysis-plan.json')}`])).toThrow(
      /unknown option/,
    );
    runCli(['attach-plan', root]);
    runCli(['decision', root, 'continue']);
    runCli(['stage-start', root, 'analysis']);
    runCli(['batch-start', root, '2']);
    const errorPath = join(tempDir, 'batch-2-error.txt');
    writeFileSync(errorPath, `temporary failure at ${root}\n${'x'.repeat(100_000)}`);
    runCli(['batch-finish', root, '2', '--status=failed', `--error-file=${errorPath}`]);
    runCli(['batch-start', root, '2']);
    runCli(['batch-finish', root, '2', '--status=ok']);
    runCli(['batch-start', root, '7']);
    runCli(['batch-finish', root, '7', '--status=ok']);
    runCli(['stage-finish', root, 'analysis', '--status=ok', '--files-processed=4']);

    for (const name of STAGE_NAMES) {
      if (name === 'analysis') continue;
      runCli(['stage-start', root, name]);
      runCli(['stage-finish', root, name, '--status=ok']);
    }
    const warningPath = join(tempDir, 'warning.txt');
    writeFileSync(warningPath, `warning from ${root}`);
    runCli(['warning', root, 'analysis', `--message-file=${warningPath}`]);
    runCli(['finish', root, '--status=ok']);

    const report = JSON.parse(readFileSync(join(dataDir, 'run-report.json'), 'utf8'));
    expect(report.status).toBe('degraded');
    expect(report.analysisBatches.items[0]).toMatchObject({ status: 'ok', attempts: 2, retries: 1 });
    expect(report.analysisBatches.items[0].failures).toHaveLength(1);
    expect(report.analysisBatches.items[0].failures[0].error.length).toBeLessThanOrEqual(4096);
    expect(report.analysisBatches.items[0].failures[0].error).not.toContain(root);
    expect(report.warnings[0].message).toBe('warning from <project>');
  });

  it('degrades a full run when an unexpected stage is skipped', () => {
    const report = createRunReport({ mode: 'full', runId: randomUUID() });
    attachPlan(report, plan());
    recordDecision(report, 'continue');
    skipStage(report, 'scan', 'unexpected skip');
    startStage(report, 'analysis');
    for (const batch of [2, 7]) {
      startBatch(report, batch);
      finishBatch(report, batch, 'ok');
    }
    finishStage(report, 'analysis', 'ok');
    completePendingStages(report);
    finishRun(report, 'ok');

    expect(report.status).toBe('degraded');
  });
});
