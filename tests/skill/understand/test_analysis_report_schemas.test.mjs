import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, describe, expect, it } from 'vitest';

import { buildAnalysisPlan } from '../../../understand-anything-plugin/skills/understand/analysis-plan.mjs';
import {
  STAGE_NAMES,
  attachPlan,
  createRunReport,
  finishBatch,
  finishRun,
  finishStage,
  recordDecision,
  skipStage,
  startBatch,
  startStage,
} from '../../../understand-anything-plugin/skills/understand/run-telemetry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const planSchema = JSON.parse(
  readFileSync(
    join(
      repoRoot,
      'understand-anything-plugin/skills/understand/schemas/analysis-plan-1.0.0.schema.json',
    ),
    'utf8',
  ),
);
const runSchema = JSON.parse(
  readFileSync(
    join(
      repoRoot,
      'understand-anything-plugin/skills/understand/schemas/run-report-1.0.0.schema.json',
    ),
    'utf8',
  ),
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: {
    'date-time': (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  },
});
const validatePlan = ajv.compile(planSchema);
const validateRun = ajv.compile(runSchema);
const root = mkdtempSync(join(tmpdir(), 'ua report schemas-'));

function expectValid(validate, value) {
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function realPlan() {
  const sourcePath = join(root, 'src', 'index.ts');
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, 'export const answer = 42;\n');
  const file = {
    path: 'src/index.ts',
    language: 'typescript',
    sizeLines: 1,
    fileCategory: 'code',
  };
  return buildAnalysisPlan({
    projectRoot: root,
    scan: {
      contentDigest: 'a'.repeat(64),
      files: [file],
      totalFiles: 1,
      filteredByIgnore: 0,
      importMap: { 'src/index.ts': [] },
    },
    batches: {
      schemaVersion: 1,
      algorithm: 'semantic-v1',
      totalFiles: 1,
      totalBatches: 1,
      batches: [
        {
          batchIndex: 1,
          files: [file],
          batchImportData: { 'src/index.ts': [] },
          neighborMap: { 'src/index.ts': [] },
        },
      ],
    },
  });
}

function completePendingStages(report) {
  for (const name of STAGE_NAMES) {
    if (report.stages[name].status !== 'pending') continue;
    startStage(report, name);
    finishStage(report, name, 'ok');
  }
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('analysis report schemas', () => {
  it('validates the real plan producer output', () => {
    const plan = realPlan();
    expectValid(validatePlan, plan);

    const extra = structuredClone(plan);
    extra.unversionedField = true;
    expect(validatePlan(extra)).toBe(false);

    const unsafeScope = structuredClone(plan);
    unsafeScope.scope.path = '..\\outside';
    expect(validatePlan(unsafeScope)).toBe(false);
  });

  it('validates running and terminal run-report producer states', () => {
    const plan = realPlan();
    const running = createRunReport({ mode: 'full', runId: randomUUID() });
    expectValid(validateRun, running);

    attachPlan(running, plan);
    recordDecision(running, 'continue');
    startStage(running, 'analysis');
    startBatch(running, 1);
    finishBatch(running, 1, 'ok');
    finishStage(running, 'analysis', 'ok', { filesProcessed: 1 });
    completePendingStages(running);
    finishRun(running, 'ok');
    expectValid(validateRun, running);

    const cancelled = createRunReport({ mode: 'full', runId: randomUUID() });
    finishRun(cancelled, 'cancelled');
    expectValid(validateRun, cancelled);

    const scoped = createRunReport({ mode: 'full', runId: randomUUID() });
    attachPlan(scoped, plan);
    recordDecision(scoped, 'scoped', 'packages/core');
    expectValid(validateRun, scoped);

    const review = createRunReport({ mode: 'review', runId: randomUUID() });
    for (const name of ['scan', 'batching', 'analysis', 'merge', 'assemble_review', 'architecture', 'tour']) {
      skipStage(review, name, 'review-only');
    }
    startStage(review, 'review');
    finishStage(review, 'review', 'ok');
    startStage(review, 'save');
    finishStage(review, 'save', 'ok');
    finishRun(review, 'ok');
    expectValid(validateRun, review);
  });

  it('rejects contradictory run, stage, decision, and usage states', () => {
    const plan = realPlan();
    const terminal = createRunReport({ mode: 'full', runId: randomUUID() });
    attachPlan(terminal, plan);
    recordDecision(terminal, 'continue');
    startStage(terminal, 'analysis');
    startBatch(terminal, 1);
    finishBatch(terminal, 1, 'ok');
    finishStage(terminal, 'analysis', 'ok');
    completePendingStages(terminal);
    finishRun(terminal, 'ok');

    const unfinished = structuredClone(terminal);
    unfinished.finishedAt = null;
    expect(validateRun(unfinished)).toBe(false);

    const runningStage = structuredClone(terminal);
    runningStage.stages.scan.status = 'running';
    runningStage.stages.scan.finishedAt = null;
    runningStage.stages.scan.durationMs = null;
    expect(validateRun(runningStage)).toBe(false);

    const fakeUsage = structuredClone(terminal);
    fakeUsage.usage.telemetryAvailable = false;
    fakeUsage.usage.inputTokens = 100;
    expect(validateRun(fakeUsage)).toBe(false);

    const badScope = structuredClone(terminal);
    badScope.plan.decision = 'scoped';
    badScope.plan.selectedScope = null;
    expect(validateRun(badScope)).toBe(false);

    const bypassedPreflight = structuredClone(terminal);
    bypassedPreflight.plan.decision = 'pending';
    bypassedPreflight.plan.planId = null;
    bypassedPreflight.plan.inputDigest = null;
    expect(validateRun(bypassedPreflight)).toBe(false);

    const unsafeRunScope = structuredClone(terminal);
    unsafeRunScope.scope.path = '\\absolute';
    expect(validateRun(unsafeRunScope)).toBe(false);

    const invalidTimestamp = structuredClone(terminal);
    invalidTimestamp.finishedAt = 'not-a-timestamp';
    expect(validateRun(invalidTimestamp)).toBe(false);

    const invalidUuid = structuredClone(terminal);
    invalidUuid.runId = 'not-a-uuid';
    expect(validateRun(invalidUuid)).toBe(false);
  });
});
