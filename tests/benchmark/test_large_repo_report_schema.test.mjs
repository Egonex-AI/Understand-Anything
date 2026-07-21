import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(
  __dirname,
  '../../docs/benchmarks/large-repo-report-1.0.0.schema.json',
);
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const validateReport = new Ajv2020({
  allErrors: true,
  formats: { 'date-time': true },
}).compile(schema);

function expectValid(report) {
  expect(
    validateReport(report),
    JSON.stringify(validateReport.errors, null, 2),
  ).toBe(true);
}

function expectInvalid(report) {
  expect(validateReport(report)).toBe(false);
}

function regularStage(overrides = {}) {
  return {
    status: 'ok',
    durationMs: 1,
    peakRssBytes: 1024,
    userCpuTimeMicros: 10,
    systemCpuTimeMicros: 5,
    warningCount: 0,
    warningMessages: [],
    warningMessagesTruncated: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    outputBytes: 128,
    ...overrides,
  };
}

function validReport() {
  return {
    schemaUrl: schema.$id,
    schemaVersion: '1.0.0',
    pairId: '11111111-1111-4111-8111-111111111111',
    status: 'ok',
    mode: 'deterministic',
    run: {
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
    },
    tool: {
      commit: null,
      dirty: null,
      packageVersion: '0.1.0',
    },
    subject: {
      label: 'fixture',
      commit: null,
      dirty: null,
    },
    environment: {
      platform: 'linux',
      release: 'test',
      arch: 'x64',
      nodeVersion: 'v22.0.0',
      cpuModel: 'test',
      logicalCores: 1,
      totalMemoryBytes: 1024,
    },
    configuration: {
      concurrency: 1,
      stages: ['scan', 'imports', 'batching', 'structure'],
    },
    scale: {
      files: 1,
      lines: 1,
      bytes: 1,
      missingFiles: 0,
      filteredByUserIgnore: 0,
      byCategory: { code: 1 },
      byLanguage: { JavaScript: 1 },
    },
    stages: {
      scan: regularStage({
        files: 1,
        lines: 1,
        bytes: 1,
        filteredByUserIgnore: 0,
      }),
      imports: regularStage({
        filesScanned: 1,
        filesWithImports: 0,
        edges: 0,
      }),
      batching: regularStage({
        algorithm: 'semantic-v1',
        totalBatches: 1,
        batchSizes: { min: 1, p50: 1, p95: 1, max: 1, mean: 1 },
        estimatedAgentInputBytes: 1,
      }),
      structure: {
        status: 'ok',
        durationMs: 1,
        maxWorkerPeakRssBytes: 1024,
        userCpuTimeMicros: 10,
        systemCpuTimeMicros: 5,
        warningCount: 0,
        warningMessages: [],
        warningMessagesTruncated: false,
        failureSamples: [],
        failureSamplesTruncated: false,
        outputBytes: 128,
        batchesSucceeded: 1,
        batchesFailed: 0,
        filesAnalyzed: 1,
        filesSkipped: 0,
        structureSucceeded: 1,
        structureFailed: 0,
        callGraphSucceeded: 1,
        callGraphFailed: 0,
        callGraphSkipped: 0,
        entities: {
          functions: 0,
          classes: 0,
          exports: 0,
          callGraph: 0,
          definitions: 0,
          services: 0,
          endpoints: 0,
          steps: 0,
          resources: 0,
        },
        batchDurationMs: { min: 1, p50: 1, p95: 1, max: 1, mean: 1 },
      },
    },
    integrity: {
      allScannedFilesBatched: true,
      missingBatchFiles: 0,
      duplicateBatchFiles: 0,
      unexpectedBatchFiles: 0,
      missingImportTargets: 0,
      structureCoverage: 1,
      structureFailures: 0,
      callGraphFailures: 0,
      filesSkipped: 0,
      failedBatches: 0,
      missingStructurePaths: 0,
      duplicateStructurePaths: 0,
      unexpectedStructurePaths: 0,
      malformedStructureBatches: 0,
    },
    determinism: {
      algorithm: 'sha256',
      inputDigest: '0'.repeat(64),
      outputDigest: '1'.repeat(64),
    },
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
}

describe('large repository report schema 1.0.0', () => {
  it('accepts a complete ok report and a derived valid degraded report', () => {
    const ok = validReport();
    const degraded = structuredClone(ok);
    degraded.status = 'degraded';
    degraded.stages.structure.filesAnalyzed = 0;
    degraded.stages.structure.filesSkipped = 1;
    degraded.stages.structure.structureSucceeded = 0;
    degraded.stages.structure.callGraphSucceeded = 0;
    degraded.integrity.filesSkipped = 1;

    expectValid(ok);
    expectValid(degraded);
  });

  it.each([
    [
      'an incomplete ok report',
      (report) => {
        delete report.stages.structure;
      },
    ],
    [
      'the old warning shape',
      (report) => {
        report.status = 'degraded';
        report.warnings = [{ stage: 'scan', count: 1 }];
      },
    ],
    [
      'the old structure memory field',
      (report) => {
        report.stages.structure.peakRssBytes =
          report.stages.structure.maxWorkerPeakRssBytes;
        delete report.stages.structure.maxWorkerPeakRssBytes;
      },
    ],
    [
      'a failed report with a null error',
      (report) => {
        report.status = 'failed';
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const report = validReport();
    mutate(report);
    expectInvalid(report);
  });

  it.each([
    [
      'warnings',
      (report) => {
        report.warnings = [
          { stage: 'scan', count: 1, messages: ['warning'], truncated: false },
        ];
      },
    ],
    [
      'skipped files',
      (report) => {
        report.integrity.filesSkipped = 1;
      },
    ],
    [
      'a stage warning',
      (report) => {
        report.stages.scan.warningCount = 1;
        report.stages.scan.warningMessages = ['warning'];
      },
    ],
    [
      'a stage-level skipped file',
      (report) => {
        report.stages.structure.filesSkipped = 1;
      },
    ],
  ])('rejects ok status with %s', (_name, mutate) => {
    const report = validReport();
    mutate(report);
    expectInvalid(report);
  });

  it.each([
    ['allScannedFilesBatched', false],
    ['missingBatchFiles', 1],
    ['duplicateBatchFiles', 1],
    ['unexpectedBatchFiles', 1],
    ['missingImportTargets', 1],
    ['structureCoverage', 0.5],
    ['failedBatches', 1],
    ['missingStructurePaths', 1],
    ['duplicateStructurePaths', 1],
    ['unexpectedStructurePaths', 1],
    ['malformedStructureBatches', 1],
  ])('rejects successful status with failing integrity %s', (field, value) => {
    const report = validReport();
    report.integrity[field] = value;
    expectInvalid(report);
  });

  it('rejects degraded status without a warning or skipped-file reason', () => {
    const report = validReport();
    report.status = 'degraded';

    expectInvalid(report);
  });

  it('rejects warning summaries whose count is zero', () => {
    const report = validReport();
    report.status = 'degraded';
    report.warnings = [
      { stage: 'scan', count: 0, messages: [], truncated: false },
    ];

    expectInvalid(report);
  });
});
