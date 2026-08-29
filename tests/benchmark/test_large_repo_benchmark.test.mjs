import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';

import * as benchmark from '../../scripts/lib/large-repo-benchmark.mjs';

const { CliUsageError, parseArgs } = benchmark;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/benchmark-large-repo.mjs');
const REPORT_SCHEMA = resolve(
  __dirname,
  '../../docs/benchmarks/large-repo-report-1.0.0.schema.json',
);
const reportSchema = JSON.parse(readFileSync(REPORT_SCHEMA, 'utf-8'));
const validateReport = new Ajv2020({
  allErrors: true,
  formats: { 'date-time': true },
}).compile(reportSchema);

function expectValidReport(report) {
  expect(
    validateReport(report),
    JSON.stringify(validateReport.errors, null, 2),
  ).toBe(true);
}

function makeSubject() {
  const root = mkdtempSync(join(tmpdir(), 'ua benchmark subject-'));
  const subject = join(root, '项目 with spaces');
  mkdirSync(join(subject, 'src'), { recursive: true });
  writeFileSync(
    join(subject, 'src', 'math.ts'),
    'export function add(a: number, b: number) { return a + b; }\n',
  );
  writeFileSync(
    join(subject, 'src', 'index.ts'),
    'import { add } from "./math";\nexport const answer = add(20, 22);\n',
  );
  writeFileSync(
    join(subject, 'README.md'),
    '# Mini repository\n\nA deterministic benchmark fixture.\n',
  );
  return { root, subject };
}

function snapshotTree(root) {
  const entries = [];

  function visit(directory, relativeDirectory = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const relativePath = join(relativeDirectory, entry.name).replaceAll('\\', '/');
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push([relativePath, 'directory']);
        visit(absolutePath, relativePath);
      } else {
        entries.push([
          relativePath,
          'file',
          readFileSync(absolutePath).toString('base64'),
        ]);
      }
    }
  }

  visit(root);
  return entries;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    ...options,
  });
}

function benchmarkArtifactEntries() {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('ua-large-bench-'),
    )
    .map((entry) => entry.name)
    .sort();
}

function expectSafeReportWriteFailure(result, sensitivePaths) {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(
    /^(?:\[benchmark\] [^\r\n]+\r?\n)*Error: Unable to write benchmark report files\r?\n$/,
  );
  expect(result.stderr).not.toMatch(
    /UnhandledPromiseRejection|node:fs:|(?:^|\r?\n)\s*at\s|\bError: EISDIR\b/,
  );
  for (const sensitivePath of sensitivePaths) {
    for (const alias of new Set([
      sensitivePath,
      sensitivePath.replaceAll('\\', '/'),
      sensitivePath.replaceAll('/', '\\'),
    ])) {
      expect(result.stderr).not.toContain(alias);
    }
  }
  expect(result.stderr).not.toContain('ua-large-bench-');
}

function runGit(directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function makeGitSubject() {
  const root = mkdtempSync(join(tmpdir(), 'ua benchmark git-'));
  const subject = join(root, 'subject repo');
  mkdirSync(subject);
  runGit(subject, ['init', '--quiet']);
  writeFileSync(join(subject, 'tracked.txt'), 'clean\n');
  runGit(subject, ['add', 'tracked.txt']);
  runGit(subject, [
    '-c',
    'user.name=Benchmark Test',
    '-c',
    'user.email=benchmark@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'initial',
  ]);
  return { root, subject };
}

describe('bounded benchmark stage output', () => {
  const cleanup = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('bounds retained streams while parsing late metrics and all warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark noisy-stage-'));
    cleanup.push(root);
    const subject = join(root, 'private subject');
    const artifacts = join(root, 'private artifacts');
    mkdirSync(subject);
    mkdirSync(artifacts);
    const helperPath = join(root, 'noisy-helper.mjs');
    writeFileSync(
      helperPath,
      `
const [subject, tool, artifacts, cap] = process.argv.slice(2);
process.stdout.write(\`stdout roots: \${subject}/out.txt \${tool}/worker.mjs \${artifacts}/out.json\\n\`);
process.stdout.write('s'.repeat(Number(cap) * 2));
process.stderr.write(\`stderr roots: \${subject}/error.txt \${tool}/worker.mjs \${artifacts}/error.json\\n\`);
process.stderr.write('n'.repeat(Number(cap) * 2));
process.stderr.write('\\n');
for (let index = 0; index < 12; index += 1) {
  const root = [subject, tool, artifacts][index % 3];
  const warning = Buffer.from(\`Warning: \${String(index).padStart(2, '0')} \\u{1F9EA} \${root}/warning.txt\\n\`);
  if (index === 0) {
    for (const byte of warning) process.stderr.write(Buffer.from([byte]));
  } else {
    process.stderr.write(warning);
  }
}
throw new Error(\`helper failed below \${subject}/failed.txt\`);
`,
    );
    const redactionRoots = [
      [subject, '<subject>'],
      [benchmark.REPO_ROOT, '<tool>'],
      [artifacts, '<artifacts>'],
    ];

    const stage = await benchmark.runNodeStage(
      'noisy',
      helperPath,
      [
        subject,
        benchmark.REPO_ROOT,
        artifacts,
        String(benchmark.STAGE_OUTPUT_MAX_BYTES),
      ],
      redactionRoots,
    );

    expect(benchmark.STAGE_OUTPUT_MAX_BYTES).toBe(128 * 1024);
    expect(benchmark.WARNING_SAMPLE_LIMIT).toBe(5);
    expect(stage.status).toBe('failed');
    expect(stage.stdoutTruncated).toBe(true);
    expect(stage.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(stage.stdout)).toBeLessThanOrEqual(
      benchmark.STAGE_OUTPUT_MAX_BYTES,
    );
    expect(Buffer.byteLength(stage.stderr)).toBeLessThanOrEqual(
      benchmark.STAGE_OUTPUT_MAX_BYTES,
    );
    expect(stage.warningCount).toBe(12);
    expect(stage.warningMessages).toHaveLength(benchmark.WARNING_SAMPLE_LIMIT);
    expect(stage.warningMessagesTruncated).toBe(true);
    expect(stage.warningMessages.map((message) => message.slice(0, 11))).toEqual([
      'Warning: 00',
      'Warning: 01',
      'Warning: 02',
      'Warning: 03',
      'Warning: 04',
    ]);
    expect(
      stage.warningMessages.every(
        (message) =>
          Buffer.byteLength(message) <= benchmark.STAGE_OUTPUT_MAX_BYTES,
      ),
    ).toBe(true);
    expect(stage.peakRssBytes).toBeGreaterThan(0);
    expect(stage.userCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(stage.systemCpuTimeMicros).toBeGreaterThanOrEqual(0);
    const retained = [stage.stdout, stage.stderr, ...stage.warningMessages].join(
      '\n',
    );
    expect(retained).toContain('<subject>');
    expect(retained).toContain('<tool>');
    expect(retained).toContain('<artifacts>');
    expect(retained).not.toContain('__UA_BENCHMARK_METRICS__');
    expect(retained).not.toContain(subject);
    expect(retained).not.toContain(benchmark.REPO_ROOT);
    expect(retained).not.toContain(artifacts);
  });

  it('keeps unterminated helper stderr separate from worker metrics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark eof-metrics-'));
    cleanup.push(root);
    const helperPath = join(root, 'eof-metrics-helper.mjs');
    writeFileSync(
      helperPath,
      `
import { writeSync } from 'node:fs';
writeSync(2, 'ordinary final stderr');
`,
    );

    const stage = await benchmark.runNodeStage('eof-metrics', helperPath, []);

    expect(stage.status).toBe('ok');
    expect(stage.peakRssBytes).toBeGreaterThan(0);
    expect(stage.userCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(stage.systemCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(stage.stderr).toBe('ordinary final stderr');
    expect(stage.warningCount).toBe(0);
  });

  it('counts and samples a final warning without a newline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark eof-warning-'));
    cleanup.push(root);
    const subject = join(root, 'private subject');
    mkdirSync(subject);
    const helperPath = join(root, 'eof-warning-helper.mjs');
    writeFileSync(
      helperPath,
      `
import { writeSync } from 'node:fs';
writeSync(2, \`Warning: final \${process.argv[2]}/file.ts\`);
`,
    );

    const stage = await benchmark.runNodeStage(
      'eof-warning',
      helperPath,
      [subject],
      [[subject, '<subject>']],
    );

    expect(stage.status).toBe('ok');
    expect(stage.warningCount).toBe(1);
    expect(stage.warningMessages).toEqual([
      'Warning: final <subject>/file.ts',
    ]);
    expect(stage.warningMessagesTruncated).toBe(false);
    expect(stage.stderr).toBe('Warning: final <subject>/file.ts');
    expect(stage.stderr.endsWith('\n')).toBe(false);
    expect(stage.peakRssBytes).toBeGreaterThan(0);
  });

  it('captures resource metrics before failing an imported helper process.exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark helper-exit-'));
    cleanup.push(root);
    const helperPath = join(root, 'exit-helper.mjs');
    writeFileSync(
      helperPath,
      `process.stderr.write('helper requested exit\\n');\nprocess.exit(7);\n`,
    );

    const stage = await benchmark.runNodeStage('helper-exit', helperPath, []);

    expect(stage.status).toBe('failed');
    expect(stage.exitCode).not.toBe(0);
    expect(stage.peakRssBytes).toBeGreaterThan(0);
    expect(stage.userCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(stage.systemCpuTimeMicros).toBeGreaterThanOrEqual(0);
  });
});

describe('benchmark warning aggregation', () => {
  it('samples structure warnings in deterministic batch input order', () => {
    const warnings = benchmark.aggregateStageWarnings([
      {
        warningCount: 3,
        warningMessages: [
          'Warning: batch-0 first',
          'Warning: batch-0 second',
          'Warning: batch-0 third',
        ],
        warningMessagesTruncated: false,
      },
      {
        warningCount: 4,
        warningMessages: [
          'Warning: batch-1 first',
          'Warning: batch-1 second',
          'Warning: batch-1 third',
          'Warning: batch-1 fourth',
        ],
        warningMessagesTruncated: false,
      },
    ]);

    expect(warnings).toEqual({
      warningCount: 7,
      warningMessages: [
        'Warning: batch-0 first',
        'Warning: batch-0 second',
        'Warning: batch-0 third',
        'Warning: batch-1 first',
        'Warning: batch-1 second',
      ],
      warningMessagesTruncated: true,
    });
    expect(
      benchmark.warningSummary([{ name: 'structure', ...warnings }]),
    ).toEqual([
      {
        stage: 'structure',
        count: 7,
        messages: warnings.warningMessages,
        truncated: true,
      },
    ]);
  });

  it('compacts completed structure workers into a globally bounded deterministic sample', () => {
    expect(benchmark.createStructureDiagnosticsAccumulator).toBeTypeOf(
      'function',
    );
    const diagnostics = benchmark.createStructureDiagnosticsAccumulator();
    const compactStages = [];
    for (let inputIndex = 999; inputIndex >= 0; inputIndex -= 1) {
      compactStages.push(
        diagnostics.record(inputIndex, inputIndex + 10, {
          name: `structure:${inputIndex + 10}`,
          status: inputIndex % 2 === 0 ? 'failed' : 'ok',
          exitCode: inputIndex % 2 === 0 ? 1 : 0,
          durationMs: 1,
          peakRssBytes: 1024,
          userCpuTimeMicros: 1,
          systemCpuTimeMicros: 1,
          warningCount: 1,
          warningMessages: [`Warning: batch ${inputIndex} ${'w'.repeat(200_000)}`],
          warningMessagesTruncated: false,
          stdout: 'o'.repeat(200_000),
          stderr: `failure ${inputIndex} ${'e'.repeat(200_000)}`,
          stdoutTruncated: true,
          stderrTruncated: true,
        }),
      );
    }

    expect(
      compactStages.every(
        (stage) =>
          !Object.hasOwn(stage, 'stdout') &&
          !Object.hasOwn(stage, 'stderr') &&
          !Object.hasOwn(stage, 'warningMessages'),
      ),
    ).toBe(true);
    const summary = diagnostics.summary();
    expect(summary.warningMessages).toHaveLength(benchmark.WARNING_SAMPLE_LIMIT);
    expect(summary.warningMessages[0]).toContain('batch 0');
    expect(summary.failureSamples).toHaveLength(benchmark.WARNING_SAMPLE_LIMIT);
    expect(summary.failureSamples.map((sample) => sample.batchIndex)).toEqual([
      10,
      12,
      14,
      16,
      18,
    ]);
    expect(summary.warningMessagesTruncated).toBe(true);
    expect(summary.failureSamplesTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(
      64 * 1024,
    );
  });
});

describe('canonical benchmark digests', () => {
  it('sorts object keys while preserving array order', () => {
    expect(benchmark.canonicalSha256).toBeTypeOf('function');
    const value = { z: 1, nested: { b: null, a: true }, a: [3, 2, 1] };
    const canonicalJson = '{"a":[3,2,1],"nested":{"a":true,"b":null},"z":1}';
    const expected = createHash('sha256').update(canonicalJson).digest('hex');

    expect(benchmark.canonicalSha256(value)).toBe(expected);
    expect(
      benchmark.canonicalSha256({ a: [3, 2, 1], nested: { a: true, b: null }, z: 1 }),
    ).toBe(expected);
    expect(benchmark.canonicalSha256({ ...value, a: [1, 2, 3] })).not.toBe(
      expected,
    );
  });

  it('combines structure digests in deterministic batch input order', () => {
    expect(benchmark.buildOutputDigest).toBeTypeOf('function');
    const batches = {
      batches: [{ batchIndex: 1 }, { batchIndex: 2 }],
    };
    const first = { batchIndex: 1, digest: 'a'.repeat(64) };
    const second = { batchIndex: 2, digest: 'b'.repeat(64) };

    const ordered = benchmark.buildOutputDigest({}, batches, [first, second]);
    expect(benchmark.buildOutputDigest({}, batches, [second, first])).toBe(
      ordered,
    );
    expect(
      benchmark.buildOutputDigest({}, batches, [
        first,
        { ...second, digest: 'c'.repeat(64) },
      ]),
    ).not.toBe(ordered);
  });
});

describe('structure output summaries', () => {
  const batch = {
    batchIndex: 7,
    files: [
      { path: 'src/a.ts' },
      { path: 'src/b.ts' },
      { path: 'src/c.ts' },
    ],
  };

  it('accepts the exact union of analyzed and skipped paths', () => {
    expect(benchmark.summarizeStructureOutput).toBeTypeOf('function');
    const output = {
      scriptCompleted: true,
      filesAnalyzed: 2,
      filesSkipped: ['src/b.ts'],
      results: [
        { path: 'src/a.ts', functions: [{ name: 'a' }], exports: ['a'] },
        { path: 'src/c.ts', classes: [{ name: 'C' }] },
      ],
    };

    expect(benchmark.summarizeStructureOutput(batch, output)).toEqual({
      batchIndex: 7,
      digest: benchmark.canonicalSha256(output),
      complete: true,
      malformed: false,
      expectedFiles: 3,
      accountedExpectedPaths: 3,
      filesAnalyzed: 2,
      filesSkipped: 1,
      structureSucceeded: 2,
      structureFailed: 0,
      callGraphSucceeded: 0,
      callGraphFailed: 0,
      callGraphSkipped: 2,
      missingStructurePaths: 0,
      duplicateStructurePaths: 0,
      unexpectedStructurePaths: 0,
      entities: {
        functions: 1,
        classes: 1,
        exports: 1,
        callGraph: 0,
        definitions: 0,
        services: 0,
        endpoints: 0,
        steps: 0,
        resources: 0,
      },
    });
  });

  it('reports missing, duplicate, and unexpected paths', () => {
    expect(benchmark.summarizeStructureOutput).toBeTypeOf('function');
    const summary = benchmark.summarizeStructureOutput(batch, {
      scriptCompleted: true,
      filesAnalyzed: 3,
      filesSkipped: ['src/b.ts'],
      results: [
        { path: 'src/a.ts' },
        { path: 'src/a.ts' },
        { path: 'src/unexpected.ts' },
      ],
    });

    expect(summary).toMatchObject({
      complete: false,
      malformed: false,
      accountedExpectedPaths: 2,
      missingStructurePaths: 1,
      duplicateStructurePaths: 1,
      unexpectedStructurePaths: 1,
    });
  });

  it('treats an object without the required output shape as malformed', () => {
    expect(benchmark.summarizeStructureOutput).toBeTypeOf('function');
    expect(benchmark.summarizeStructureOutput(batch, {})).toMatchObject({
      complete: false,
      malformed: true,
      accountedExpectedPaths: 0,
      missingStructurePaths: 3,
    });
  });

  it('retains explicit parser outcomes instead of treating every returned path as success', () => {
    const output = {
      scriptCompleted: true,
      filesAnalyzed: 3,
      filesSkipped: [],
      analysisOutcomes: {
        structure: { succeeded: 2, failed: 1 },
        callGraph: { succeeded: 1, failed: 1, skipped: 1 },
      },
      results: [
        { path: 'src/a.ts' },
        { path: 'src/b.ts' },
        { path: 'src/c.ts' },
      ],
    };

    expect(benchmark.summarizeStructureOutput(batch, output)).toMatchObject({
      complete: false,
      malformed: false,
      structureSucceeded: 2,
      structureFailed: 1,
      callGraphSucceeded: 1,
      callGraphFailed: 1,
      callGraphSkipped: 1,
    });
  });

  it('aggregates file and entity counts from compact summaries', () => {
    expect(benchmark.aggregateStructureSummaries).toBeTypeOf('function');
    const first = benchmark.summarizeStructureOutput(batch, {
      scriptCompleted: true,
      filesAnalyzed: 2,
      filesSkipped: ['src/b.ts'],
      results: [
        { path: 'src/a.ts', functions: [{ name: 'a' }] },
        { path: 'src/c.ts', classes: [{ name: 'C' }] },
      ],
    });
    const secondBatch = {
      batchIndex: 8,
      files: [{ path: 'src/d.ts' }],
    };
    const second = benchmark.summarizeStructureOutput(secondBatch, {
      scriptCompleted: true,
      filesAnalyzed: 1,
      filesSkipped: [],
      results: [{ path: 'src/d.ts', functions: [{}, {}], exports: [{}] }],
    });

    expect(benchmark.aggregateStructureSummaries([first, second])).toEqual({
      filesAnalyzed: 3,
      filesSkipped: 1,
      structureSucceeded: 3,
      structureFailed: 0,
      callGraphSucceeded: 0,
      callGraphFailed: 0,
      callGraphSkipped: 3,
      entities: {
        functions: 3,
        classes: 1,
        exports: 1,
        callGraph: 0,
        definitions: 0,
        services: 0,
        endpoints: 0,
        steps: 0,
        resources: 0,
      },
    });
    expect(first).not.toHaveProperty('results');
    expect(second).not.toHaveProperty('results');
  });
});

describe('structure resource aggregation', () => {
  it('sums worker CPU while retaining only the maximum worker RSS', () => {
    expect(benchmark.aggregateStructureResources).toBeTypeOf('function');
    expect(
      benchmark.aggregateStructureResources([
        {
          peakRssBytes: 100,
          userCpuTimeMicros: 20,
          systemCpuTimeMicros: 4,
        },
        {
          peakRssBytes: 250,
          userCpuTimeMicros: 30,
          systemCpuTimeMicros: 6,
        },
      ]),
    ).toEqual({
      maxWorkerPeakRssBytes: 250,
      userCpuTimeMicros: 50,
      systemCpuTimeMicros: 10,
    });
    expect(benchmark.aggregateStructureResources([])).toEqual({
      maxWorkerPeakRssBytes: null,
      userCpuTimeMicros: null,
      systemCpuTimeMicros: null,
    });
  });

  it('renders the structure worker maximum and summed CPU values', () => {
    expect(benchmark.renderMarkdownReport).toBeTypeOf('function');
    const markdown = benchmark.renderMarkdownReport({
      schemaVersion: '1.0.0',
      pairId: '11111111-1111-4111-8111-111111111111',
      status: 'ok',
      subject: { label: 'fixture', commit: null, dirty: true },
      tool: { commit: null, dirty: true, packageVersion: '0.0.0' },
      run: { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 12 },
      configuration: { concurrency: 2 },
      llm: { invoked: false },
      scale: {},
      stages: {
        structure: {
          status: 'ok',
          durationMs: 12,
          maxWorkerPeakRssBytes: 250,
          userCpuTimeMicros: 50,
          systemCpuTimeMicros: 10,
          outputBytes: 99,
        },
      },
      integrity: {},
      determinism: {},
      environment: {
        platform: 'test',
        release: 'test',
        arch: 'test',
        nodeVersion: 'test',
        cpuModel: 'test',
        logicalCores: 1,
        totalMemoryBytes: 1,
      },
      warnings: [],
      error: null,
    });

    expect(markdown).toContain(
      '| Stage | Status | Duration | Peak / max worker RSS (bytes) | User CPU (micros) | System CPU (micros) | Output (bytes) |',
    );
    expect(markdown).toContain('| structure | ok | 12 ms | 250 | 50 | 10 | 99 |');
    expect(markdown).toContain(
      '| Pair ID | 11111111-1111-4111-8111-111111111111 |',
    );
    expect(markdown).toContain('| Tool dirty | true |');
    expect(markdown).toContain('| Subject dirty | true |');
    expect(markdown).toMatch(/warning.*dirty/i);
  });
});

describe('benchmark integrity aggregation', () => {
  const scan = {
    totalFiles: 3,
    files: [
      { path: 'src/a.ts' },
      { path: 'src/b.ts' },
      { path: 'src/c.ts' },
    ],
  };
  const batch = {
    batchIndex: 1,
    files: scan.files,
  };
  const batches = { batches: [batch] };

  it('keeps exact skipped-path accounting complete but degraded-capable', () => {
    expect(benchmark.buildBenchmarkIntegrity).toBeTypeOf('function');
    expect(benchmark.hasFailedIntegrity).toBeTypeOf('function');
    const summary = benchmark.summarizeStructureOutput(batch, {
      scriptCompleted: true,
      filesAnalyzed: 2,
      filesSkipped: ['src/b.ts'],
      results: [{ path: 'src/a.ts' }, { path: 'src/c.ts' }],
    });
    const integrity = benchmark.buildBenchmarkIntegrity(
      scan,
      {},
      batches,
      [summary],
      0,
    );

    expect(integrity).toMatchObject({
      structureCoverage: 1,
      filesSkipped: 1,
      missingStructurePaths: 0,
      duplicateStructurePaths: 0,
      unexpectedStructurePaths: 0,
      malformedStructureBatches: 0,
    });
    expect(benchmark.hasFailedIntegrity(integrity)).toBe(false);
  });

  it('fails incomplete and conflicting structure path accounting', () => {
    expect(benchmark.buildBenchmarkIntegrity).toBeTypeOf('function');
    expect(benchmark.hasFailedIntegrity).toBeTypeOf('function');
    const summary = benchmark.summarizeStructureOutput(batch, {
      scriptCompleted: true,
      filesAnalyzed: 3,
      filesSkipped: ['src/b.ts'],
      results: [
        { path: 'src/a.ts' },
        { path: 'src/a.ts' },
        { path: 'src/unexpected.ts' },
      ],
    });
    const integrity = benchmark.buildBenchmarkIntegrity(
      scan,
      {},
      batches,
      [summary],
      1,
    );

    expect(integrity).toMatchObject({
      structureCoverage: 1,
      missingStructurePaths: 1,
      duplicateStructurePaths: 1,
      unexpectedStructurePaths: 1,
      failedBatches: 1,
    });
    expect(benchmark.hasFailedIntegrity(integrity)).toBe(true);
  });

  it('fails integrity when explicit structure or call-graph outcomes fail', () => {
    const summary = benchmark.summarizeStructureOutput(batch, {
      scriptCompleted: true,
      filesAnalyzed: 3,
      filesSkipped: [],
      analysisOutcomes: {
        structure: { succeeded: 2, failed: 1 },
        callGraph: { succeeded: 1, failed: 1, skipped: 1 },
      },
      results: [
        { path: 'src/a.ts' },
        { path: 'src/b.ts' },
        { path: 'src/c.ts' },
      ],
    });
    const integrity = benchmark.buildBenchmarkIntegrity(
      scan,
      {},
      batches,
      [summary],
      0,
    );

    expect(integrity).toMatchObject({
      structureCoverage: 0.6667,
      structureFailures: 1,
      callGraphFailures: 1,
    });
    expect(benchmark.hasFailedIntegrity(integrity)).toBe(true);
  });

  it('rejects malformed output even when the expected path set is empty', () => {
    const emptyScan = { totalFiles: 0, files: [] };
    const emptyBatch = { batchIndex: 1, files: [] };
    const summary = benchmark.summarizeStructureOutput(emptyBatch, {});
    const integrity = benchmark.buildBenchmarkIntegrity(
      emptyScan,
      {},
      { batches: [emptyBatch] },
      [summary],
      0,
    );

    expect(integrity).toMatchObject({
      structureCoverage: 1,
      missingStructurePaths: 0,
      malformedStructureBatches: 1,
    });
    expect(benchmark.hasFailedIntegrity(integrity)).toBe(true);
  });

  it.each([
    ['missing paths', { structureCoverage: 0.5, missingStructurePaths: 1 }],
    ['duplicate paths', { duplicateStructurePaths: 1 }],
    ['unexpected paths', { unexpectedStructurePaths: 1 }],
    ['malformed output', { malformedStructureBatches: 1 }],
    ['failed batches', { failedBatches: 1 }],
  ])('rejects %s independently', (_label, overrides) => {
    const completeIntegrity = {
      allScannedFilesBatched: true,
      missingImportTargets: 0,
      structureCoverage: 1,
      failedBatches: 0,
      missingStructurePaths: 0,
      duplicateStructurePaths: 0,
      unexpectedStructurePaths: 0,
      malformedStructureBatches: 0,
    };

    expect(
      benchmark.hasFailedIntegrity({ ...completeIntegrity, ...overrides }),
    ).toBe(true);
  });
});

describe('path redaction', () => {
  const cleanup = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('redacts native, separator, file URL, and Windows aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark redact-'));
    cleanup.push(root);
    const subject = join(root, 'subject root');
    const tool = join(root, 'tool root');
    const artifacts = join(root, 'artifact root');
    mkdirSync(subject);
    mkdirSync(tool);
    mkdirSync(artifacts);

    const slashSubject = subject.replaceAll('\\', '/');
    const backslashSubject = subject.replaceAll('/', '\\');
    const messages = [
      `native ${join(subject, 'src', 'file.ts')}`,
      `slash ${slashSubject}/src/file.ts`,
      `backslash ${backslashSubject}\\src\\file.ts`,
      `url ${pathToFileURL(subject).href}/src/file%20name.ts`,
      `tool ${join(tool, 'worker.mjs')}`,
      `artifacts ${join(artifacts, 'result.json')}`,
    ];
    if (process.platform === 'win32') {
      messages.push(`extended \\\\?\\${backslashSubject}\\src\\file.ts`);
      messages.push(`case ${subject.toUpperCase()}\\SRC\\FILE.TS`);
    }

    expect(benchmark.redactPaths).toBeTypeOf('function');
    const redacted = benchmark.redactPaths(messages.join('\n'), [
      [subject, '<subject>'],
      [tool, '<tool>'],
      [artifacts, '<artifacts>'],
    ]);

    expect(redacted).toContain('native <subject>');
    expect(redacted).toContain('slash <subject>/src/file.ts');
    expect(redacted).toContain('backslash <subject>\\src\\file.ts');
    expect(redacted).toContain('url <subject>/src/file%20name.ts');
    expect(redacted).toContain('tool <tool>');
    expect(redacted).toContain('artifacts <artifacts>');
    for (const privateRoot of [
      subject,
      slashSubject,
      backslashSubject,
      pathToFileURL(subject).href,
      tool,
      artifacts,
    ]) {
      expect(redacted).not.toContain(privateRoot);
    }
    if (process.platform === 'win32') {
      expect(redacted).toContain('extended <subject>\\src\\file.ts');
      expect(redacted).toContain('case <subject>\\SRC\\FILE.TS');
    }
  });

  it('uses the longest realpath alias and preserves sibling prefixes', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark aliases-'));
    cleanup.push(root);
    const physicalSubject = join(root, 'physical subject');
    const lexicalSubject = join(root, 'subject');
    mkdirSync(physicalSubject);
    symlinkSync(
      physicalSubject,
      lexicalSubject,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const realSubject = realpathSync.native(lexicalSubject);
    const sibling = `${lexicalSubject}-copy`;

    expect(benchmark.redactPaths).toBeTypeOf('function');
    const redacted = benchmark.redactPaths(
      [
        join(lexicalSubject, 'lexical.txt'),
        join(realSubject, 'physical.txt'),
        join(sibling, 'public.txt'),
      ].join('\n'),
      [
        [root, '<tool>'],
        [lexicalSubject, '<subject>'],
      ],
    );

    expect(redacted).toContain(join('<subject>', 'lexical.txt'));
    expect(redacted).toContain(join('<subject>', 'physical.txt'));
    expect(redacted).toContain(join('<tool>', 'subject-copy', 'public.txt'));
    expect(redacted).not.toContain(join('<subject>-copy', 'public.txt'));
    expect(redacted).not.toContain(join('<tool>', 'subject', 'lexical.txt'));
  });

  it.runIf(process.platform === 'win32')(
    'redacts mixed-case extended UNC roots through ordinary aliases',
    () => {
      const extendedRoot = '\\\\?\\uNc\\localhost\\missing-share\\Repo Root';
      const ordinaryRoot = '\\\\localhost\\missing-share\\Repo Root';
      const redacted = benchmark.redactPaths(
        [
          `${extendedRoot}\\extended.txt`,
          `${ordinaryRoot}\\ordinary.txt`,
        ].join('\n'),
        [[extendedRoot, '<subject>']],
      );

      expect(redacted).toBe(
        ['<subject>\\extended.txt', '<subject>\\ordinary.txt'].join('\n'),
      );
    },
  );

  it('does not treat a terminal dot as a path boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark dot-'));
    cleanup.push(root);
    const subject = join(root, 'repo');
    mkdirSync(subject);
    const sibling = `${subject.replaceAll('\\', '/')}.`;

    expect(benchmark.redactPaths(sibling, [[subject, '<subject>']])).toBe(
      sibling,
    );
  });

  it('redacts exact roots and descendants without rewriting real siblings', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark boundary-'));
    cleanup.push(root);
    const subject = join(root, 'repo');
    const descendant = join(subject, 'src', 'private.txt');
    const spacedSibling = join(`${subject} copy`, 'public.txt');
    const punctuatedSibling = join(`${subject},copy`, 'public.txt');
    mkdirSync(dirname(descendant), { recursive: true });
    mkdirSync(dirname(spacedSibling), { recursive: true });
    mkdirSync(dirname(punctuatedSibling), { recursive: true });
    writeFileSync(descendant, 'private\n');
    writeFileSync(spacedSibling, 'public\n');
    writeFileSync(punctuatedSibling, 'public\n');
    const roots = [[subject, '<subject>']];

    expect(benchmark.redactPaths(subject, roots)).toBe('<subject>');
    expect(benchmark.redactPaths(descendant, roots)).toBe(
      join('<subject>', 'src', 'private.txt'),
    );
    expect(benchmark.redactPaths(spacedSibling, roots)).toBe(spacedSibling);
    expect(benchmark.redactPaths(punctuatedSibling, roots)).toBe(
      punctuatedSibling,
    );
  });

  it.runIf(process.platform !== 'win32')(
    'preserves a valid POSIX terminal-dot sibling',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'ua benchmark posix-dot-'));
      cleanup.push(root);
      const subject = join(root, 'repo');
      mkdirSync(subject);
      const sibling = `${subject}.`;

      expect(benchmark.redactPaths(sibling, [[subject, '<subject>']])).toBe(
        sibling,
      );
    },
  );
});

describe('Git metadata probes', () => {
  const cleanup = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('reports ordinary clean and dirty repositories', () => {
    const { root, subject } = makeGitSubject();
    cleanup.push(root);
    const commit = runGit(subject, ['rev-parse', 'HEAD']);

    expect(benchmark.gitMetadata).toBeTypeOf('function');
    expect(benchmark.gitMetadata(subject)).toEqual({ commit, dirty: false });

    writeFileSync(join(subject, 'tracked.txt'), 'dirty\n');
    expect(benchmark.gitMetadata(subject)).toEqual({ commit, dirty: true });
  });

  it('conservatively reports dirty when porcelain output exceeds its cap', () => {
    const { root, subject } = makeGitSubject();
    cleanup.push(root);

    expect(benchmark.GIT_METADATA_MAX_BUFFER).toBeGreaterThan(0);
    const fileCount =
      Math.ceil(benchmark.GIT_METADATA_MAX_BUFFER / 60) + 200;
    for (let index = 0; index < fileCount; index += 1) {
      writeFileSync(
        join(
          subject,
          `overflow-${String(index).padStart(5, '0')}-${'x'.repeat(40)}.txt`,
        ),
        '',
      );
    }

    const boundedStatus = spawnSync(
      'git',
      ['-C', subject, 'status', '--porcelain'],
      {
        encoding: 'utf-8',
        maxBuffer: benchmark.GIT_METADATA_MAX_BUFFER,
        windowsHide: true,
      },
    );
    expect(boundedStatus.error?.code).toBe('ENOBUFS');
    expect(benchmark.gitMetadata(subject).dirty).toBe(true);
  });
});

describe('large repository benchmark CLI', () => {
  const cleanup = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('parses a positional repository and validates concurrency', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);

    const options = parseArgs(
      [
        subject,
        '--output',
        join(root, 'report.json'),
        '--concurrency',
        '3',
        '--label',
        'polyglot-mini',
      ],
      root,
    );
    expect(options.repoRoot).toBe(subject);
    expect(options.concurrency).toBe(3);
    expect(options.label).toBe('polyglot-mini');
    expect(options.markdownPath).toBe(join(root, 'report.md'));
    expect(() => parseArgs([subject, '--concurrency', '0'], root)).toThrow(
      CliUsageError,
    );
  });

  it('requires a non-empty explicit output path and reports usage exit 2', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);

    expect(() => parseArgs([subject], root)).toThrow(/--output/);
    expect(() => parseArgs([subject, '--output='], root)).toThrow(/--output/);
    const result = runCli([subject]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--output <path>');
    expect(result.stderr).toMatch(/required/i);
  });

  it.each(['2.5', '3junk', '1e1', ''])(
    'rejects malformed concurrency %j in split and equals forms',
    (rawConcurrency) => {
      const { root, subject } = makeSubject();
      cleanup.push(root);

      expect(() =>
        parseArgs([subject, '--concurrency', rawConcurrency], root),
      ).toThrow(CliUsageError);
      expect(() =>
        parseArgs([subject, `--concurrency=${rawConcurrency}`], root),
      ).toThrow(CliUsageError);
    },
  );

  it('rejects report output paths equal to or inside the subject repository', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);

    expect(() => parseArgs([subject, '--output', subject], root)).toThrow(
      CliUsageError,
    );
    expect(() =>
      parseArgs([subject, `--output=${join(subject, 'reports', 'result.json')}`], root),
    ).toThrow(CliUsageError);
    expect(() => parseArgs([subject], subject)).toThrow(CliUsageError);
  });

  it('rejects an outside JSON path whose derived Markdown path is the subject', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark output-'));
    cleanup.push(root);
    const subject = join(root, 'subject.md');
    mkdirSync(subject);

    expect(() =>
      parseArgs([subject, '--output', join(root, 'subject.json')], root),
    ).toThrow(CliUsageError);
  });

  it('accepts report paths under an outside sibling-prefix directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark sibling-'));
    cleanup.push(root);
    const subject = join(root, 'repo');
    const outputPath = join(root, 'repo-copy', 'result.json');
    mkdirSync(subject);

    const options = parseArgs([subject, '--output', outputPath], root);

    expect(options.outputPath).toBe(outputPath);
    expect(options.markdownPath).toBe(join(root, 'repo-copy', 'result.md'));
  });

  it('rejects a non-existing report path through a physical repository alias', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark containment-'));
    cleanup.push(root);
    const subject = join(root, 'physical repo');
    const subjectAlias = join(root, 'repo alias');
    mkdirSync(subject);
    symlinkSync(
      subject,
      subjectAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const reportPath = join(subjectAlias, 'missing', 'report.json');

    expect(() =>
      parseArgs([subject, '--output', reportPath], root),
    ).toThrow(CliUsageError);
    expect(
      benchmark.isPathInsideOrEqual(
        subjectAlias,
        join(subject, 'missing', 'report.json'),
      ),
    ).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    'normalizes extended drive and UNC namespaces for containment',
    () => {
      const lexicalRoot = join(tmpdir(), 'ua namespace repo');
      const extendedRoot = `\\\\?\\${lexicalRoot}`;
      const ordinaryUncRoot = '\\\\localhost\\missing-share\\repo';
      const extendedUncOutput =
        '\\\\?\\UNC\\localhost\\missing-share\\repo\\report.json';

      expect(
        benchmark.isPathInsideOrEqual(
          extendedRoot,
          join(lexicalRoot, 'report.json'),
        ),
      ).toBe(true);
      expect(
        benchmark.isPathInsideOrEqual(ordinaryUncRoot, extendedUncOutput),
      ).toBe(true);
    },
  );

  it('records failed scan telemetry before writing the failed report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua failed scan benchmark-'));
    cleanup.push(root);
    const subject = join(root, 'not-a-directory.txt');
    const outputPath = join(root, 'reports', 'failed.json');
    const markdownPath = join(root, 'reports', 'failed.md');
    writeFileSync(subject, 'not a repository directory\n');

    const result = await benchmark.runBenchmark({
      repoRoot: subject,
      outputPath,
      markdownPath,
      label: 'invalid-subject',
      concurrency: 1,
      keepArtifacts: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('failed');
    expectValidReport(result.report);
    expect(result.report.stages.scan).toMatchObject({
      status: 'failed',
      outputBytes: 0,
      warningCount: 0,
      warningMessages: [],
      warningMessagesTruncated: false,
    });
    expect(result.report.stages.scan.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.report.stages.scan.peakRssBytes).toBeGreaterThan(0);
    expect(result.report.stages.scan.userCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(result.report.stages.scan.systemCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    const serialized = readFileSync(outputPath, 'utf-8');
    const persisted = JSON.parse(serialized);
    expect(persisted.stages.scan.status).toBe('failed');
    expect(persisted.error).not.toContain(subject);
    expect(persisted.error).not.toContain(benchmark.REPO_ROOT);
    expect(readFileSync(markdownPath, 'utf-8')).not.toContain(subject);
  });

  it.each([
    ['scan', 'missing'],
    ['imports', 'malformed'],
    ['batching', 'wrong-shape'],
  ])(
    'marks an exit-zero %s stage failed for a %s artifact and emits schema-valid partial telemetry',
    async (targetStage, corruption) => {
      const { root, subject } = makeSubject();
      cleanup.push(root);
      const outputPath = join(root, 'reports', `${targetStage}.json`);
      const markdownPath = join(root, 'reports', `${targetStage}.md`);

      const result = await benchmark.runBenchmark(
        {
          repoRoot: subject,
          outputPath,
          markdownPath,
          label: `corrupt-${targetStage}`,
          concurrency: 1,
          keepArtifacts: false,
        },
        {
          async runStage(name, scriptPath, args, redactionRoots) {
            const stage = await benchmark.runNodeStage(
              name,
              scriptPath,
              args,
              redactionRoots,
            );
            if (name === targetStage && stage.status === 'ok') {
              const artifactPath =
                name === 'batching'
                  ? args.find((arg) => arg.startsWith('--output=')).slice(
                      '--output='.length,
                    )
                  : args[1];
              if (corruption === 'missing') {
                rmSync(artifactPath, { force: true });
              } else if (corruption === 'malformed') {
                writeFileSync(artifactPath, '{ definitely not JSON', 'utf-8');
              } else {
                writeFileSync(artifactPath, '{}\n', 'utf-8');
              }
            }
            return stage;
          },
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.report.status).toBe('failed');
      expect(result.report.stages[targetStage].status).toBe('failed');
      expect(result.report.error).toBeTruthy();
      expectValidReport(result.report);
      expectValidReport(JSON.parse(readFileSync(outputPath, 'utf-8')));
      expect(existsSync(markdownPath)).toBe(true);
    },
    70_000,
  );

  it.each([
    [
      'string file.sizeLines',
      (scan, subject) => {
        scan.files[0].sizeLines = subject;
      },
    ],
    [
      'negative file.sizeLines',
      (scan) => {
        scan.files[0].sizeLines = -1;
      },
    ],
    [
      'string filteredByIgnore',
      (scan, subject) => {
        scan.filteredByIgnore = subject;
      },
    ],
    [
      'negative filteredByIgnore',
      (scan) => {
        scan.filteredByIgnore = -1;
      },
    ],
    [
      'non-record stats',
      (scan) => {
        scan.stats = null;
      },
    ],
    [
      'non-record stats.byCategory',
      (scan) => {
        scan.stats.byCategory = [];
      },
    ],
    [
      'non-count stats.byCategory value',
      (scan, subject) => {
        scan.stats.byCategory = { code: subject };
      },
    ],
    [
      'non-record stats.byLanguage',
      (scan) => {
        scan.stats.byLanguage = [];
      },
    ],
    [
      'negative stats.byLanguage value',
      (scan) => {
        scan.stats.byLanguage = { TypeScript: -1 };
      },
    ],
    [
      'stats.filesScanned inconsistent with totalFiles',
      (scan) => {
        scan.stats.filesScanned = scan.totalFiles + 1;
      },
    ],
  ])(
    'rejects an exit-zero scan artifact with %s before copying nested values into the report',
    async (_description, corruptScan) => {
      const { root, subject } = makeSubject();
      cleanup.push(root);
      const outputPath = join(root, 'reports', 'nested-scan.json');
      const markdownPath = join(root, 'reports', 'nested-scan.md');
      const stagesStarted = [];

      const result = await benchmark.runBenchmark(
        {
          repoRoot: subject,
          outputPath,
          markdownPath,
          label: 'nested-corrupt-scan',
          concurrency: 1,
          keepArtifacts: false,
        },
        {
          async runStage(name, scriptPath, args, redactionRoots) {
            stagesStarted.push(name);
            if (name !== 'scan') {
              throw new Error('nested scan corruption reached a later stage');
            }
            const stage = await benchmark.runNodeStage(
              name,
              scriptPath,
              args,
              redactionRoots,
            );
            expect(stage.status).toBe('ok');
            const artifactPath = args[1];
            const scan = JSON.parse(readFileSync(artifactPath, 'utf-8'));
            corruptScan(scan, subject);
            writeFileSync(artifactPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf-8');
            return stage;
          },
        },
      );

      expect(stagesStarted).toEqual(['scan']);
      expect(result.exitCode).toBe(1);
      expect(result.report.status).toBe('failed');
      expect(result.report.scale).toBeNull();
      expect(result.report.stages.scan.status).toBe('failed');
      expect(result.report.stages.scan).not.toHaveProperty('files');
      expectValidReport(result.report);
      const serialized = readFileSync(outputPath, 'utf-8');
      const persisted = JSON.parse(serialized);
      expectValidReport(persisted);
      expect(serialized).not.toContain(subject);
      expect(readFileSync(markdownPath, 'utf-8')).not.toContain(subject);
    },
    70_000,
  );

  it('wraps cleanup operation failures without exposing artifact paths', () => {
    const artifactRoot = join(tmpdir(), 'ua-large-bench-private-cleanup');
    let cleanupError;

    try {
      benchmark.cleanupBenchmarkArtifacts(artifactRoot, {
        rmSync() {
          throw new Error(`EPERM while removing ${artifactRoot}`);
        },
      });
    } catch (error) {
      cleanupError = error;
    }

    expect(cleanupError).toBeInstanceOf(benchmark.BenchmarkArtifactCleanupError);
    expect(cleanupError).toMatchObject({
      message: 'Unable to remove temporary benchmark artifacts',
      name: 'BenchmarkArtifactCleanupError',
    });
    expect(cleanupError).not.toHaveProperty('artifactRoot');
    expect(cleanupError).not.toHaveProperty('cause');
    expect(cleanupError.message).not.toContain(artifactRoot);
    expect(cleanupError.message).not.toContain('EPERM');
  });

  it('preserves a primary stage failure, records cleanup as secondary, and still delivers both reports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua stage cleanup failure-'));
    cleanup.push(root);
    const subject = join(root, 'not-a-directory.txt');
    const outputPath = join(root, 'reports', 'failed.json');
    const markdownPath = join(root, 'reports', 'failed.md');
    writeFileSync(subject, 'not a directory\n');
    let artifactRoot;

    const result = await benchmark.runBenchmark(
      {
        repoRoot: subject,
        outputPath,
        markdownPath,
        label: 'stage-and-cleanup-failure',
        concurrency: 1,
        keepArtifacts: false,
      },
      {
        cleanupArtifacts(path) {
          artifactRoot = path;
          throw new benchmark.BenchmarkArtifactCleanupError();
        },
      },
    );
    if (artifactRoot) cleanup.push(artifactRoot);

    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('failed');
    expect(result.report.error).not.toBe(
      'Unable to remove temporary benchmark artifacts',
    );
    expect(result.report.secondaryErrors).toEqual([
      {
        stage: 'cleanup',
        message: 'Unable to remove temporary benchmark artifacts',
      },
    ]);
    expect(result.artifactRoot).toBeNull();
    expectValidReport(result.report);
    expect(JSON.parse(readFileSync(outputPath, 'utf-8')).error).toBe(
      result.report.error,
    );
    const markdown = readFileSync(markdownPath, 'utf-8');
    expect(markdown).toContain(result.report.error.split(/\r?\n/, 1)[0]);
    expect(markdown).toContain('Unable to remove temporary benchmark artifacts');
    expect(JSON.stringify(result.report)).not.toContain(artifactRoot);
  });

  it('turns an otherwise successful run into exit 1 when artifact cleanup fails', async () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const outputPath = join(root, 'reports', 'cleanup-failed.json');
    const markdownPath = join(root, 'reports', 'cleanup-failed.md');
    let artifactRoot;

    const result = await benchmark.runBenchmark(
      {
        repoRoot: subject,
        outputPath,
        markdownPath,
        label: 'cleanup-failure',
        concurrency: 1,
        keepArtifacts: false,
      },
      {
        cleanupArtifacts(path) {
          artifactRoot = path;
          throw new benchmark.BenchmarkArtifactCleanupError();
        },
      },
    );
    if (artifactRoot) cleanup.push(artifactRoot);

    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('failed');
    expect(result.report.error).toBe(
      'Unable to remove temporary benchmark artifacts',
    );
    expect(result.report.secondaryErrors).toHaveLength(1);
    expectValidReport(result.report);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
  }, 70_000);

  it('rolls back both reports when the second report commit fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua report transaction-'));
    cleanup.push(root);
    const reportsDirectory = join(root, 'reports');
    const outputPath = join(reportsDirectory, 'result.json');
    const markdownPath = join(reportsDirectory, 'result.md');
    const sentinelPath = join(reportsDirectory, 'sentinel.txt');
    mkdirSync(reportsDirectory);
    writeFileSync(outputPath, 'old json\n');
    writeFileSync(markdownPath, 'old markdown\n');
    writeFileSync(sentinelPath, 'unrelated\n');
    const entriesBefore = readdirSync(reportsDirectory).sort();
    let failedSecondCommit = false;
    let deliveryError;

    try {
      benchmark.deliverBenchmarkReports(
        {
          outputPath,
          markdownPath,
          jsonContents: 'new json\n',
          markdownContents: 'new markdown\n',
        },
        {
          renameSync(source, destination) {
            if (destination === markdownPath && source.endsWith('.tmp')) {
              failedSecondCommit = true;
              throw new Error(`EPERM renaming ${source} to ${destination}`);
            }
            renameSync(source, destination);
          },
        },
      );
    } catch (error) {
      deliveryError = error;
    }

    expect(failedSecondCommit).toBe(true);
    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(deliveryError).toMatchObject({
      message: 'Unable to write benchmark report files',
      name: 'BenchmarkReportWriteError',
    });
    expect(deliveryError).not.toHaveProperty('cause');
    expect(deliveryError.message).not.toContain(root);
    expect(deliveryError.message).not.toContain('EPERM');
    expect(readFileSync(outputPath, 'utf-8')).toBe('old json\n');
    expect(readFileSync(markdownPath, 'utf-8')).toBe('old markdown\n');
    expect(readFileSync(sentinelPath, 'utf-8')).toBe('unrelated\n');
    expect(readdirSync(reportsDirectory).sort()).toEqual(entriesBefore);
  });

  it('excludes a concurrent writer while the shared pair lock is held', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua report pair lock-'));
    cleanup.push(root);
    const outputPath = join(root, 'result.json');
    const markdownPath = join(root, 'result.md');
    expect(benchmark.reportPairLockPath).toBeTypeOf('function');
    const lockPath = benchmark.reportPairLockPath(outputPath, markdownPath);
    writeFileSync(lockPath, 'held by another writer\n', { flag: 'wx' });
    let deliveryError;

    try {
      benchmark.deliverBenchmarkReports({
        outputPath,
        markdownPath,
        jsonContents: 'new json\n',
        markdownContents: 'new markdown\n',
      });
    } catch (error) {
      deliveryError = error;
    }

    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(deliveryError.recovery).toMatchObject({
      lockAcquisitionFailed: true,
    });
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(markdownPath)).toBe(false);
    expect(JSON.stringify(deliveryError.recovery)).not.toContain(root);
  });

  it.runIf(process.platform === 'win32')(
    'uses one pair lock for Windows path-case aliases',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'ua report case lock-'));
      cleanup.push(root);
      const outputPath = join(root, 'result.json');
      const markdownPath = join(root, 'result.md');
      const caseAliasRoot = root.toUpperCase();

      expect(
        basename(
          benchmark.reportPairLockPath(
            join(caseAliasRoot, 'RESULT.JSON'),
            join(caseAliasRoot, 'RESULT.MD'),
          ),
        ),
      ).toBe(
        basename(benchmark.reportPairLockPath(outputPath, markdownPath)),
      );
    },
  );

  it('surfaces a rollback restore failure as bounded path-free recovery metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua report rollback recovery-'));
    cleanup.push(root);
    const outputPath = join(root, 'result.json');
    const markdownPath = join(root, 'result.md');
    writeFileSync(outputPath, 'old json\n');
    writeFileSync(markdownPath, 'old markdown\n');
    let deliveryError;

    try {
      benchmark.deliverBenchmarkReports(
        {
          outputPath,
          markdownPath,
          jsonContents: 'new json\n',
          markdownContents: 'new markdown\n',
        },
        {
          renameSync(source, destination) {
            if (destination === markdownPath && source.endsWith('.tmp')) {
              throw new Error('injected second install failure');
            }
            if (destination === markdownPath && source.endsWith('.backup')) {
              throw new Error('injected restore failure');
            }
            renameSync(source, destination);
          },
        },
      );
    } catch (error) {
      deliveryError = error;
    }

    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(deliveryError.recovery).toMatchObject({
      restoreFailures: 1,
    });
    expect(JSON.stringify(deliveryError.recovery)).not.toContain(root);
    expect(JSON.stringify(deliveryError.recovery)).not.toContain('injected');
  });

  it('surfaces a rollback target-removal failure as path-free recovery metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua report rollback removal-'));
    cleanup.push(root);
    const outputPath = join(root, 'result.json');
    const markdownPath = join(root, 'result.md');
    writeFileSync(outputPath, 'old json\n');
    writeFileSync(markdownPath, 'old markdown\n');
    let removalFailed = false;
    let deliveryError;

    try {
      benchmark.deliverBenchmarkReports(
        {
          outputPath,
          markdownPath,
          jsonContents: 'new json\n',
          markdownContents: 'new markdown\n',
        },
        {
          renameSync(source, destination) {
            if (destination === markdownPath && source.endsWith('.tmp')) {
              throw new Error('injected second install failure');
            }
            renameSync(source, destination);
          },
          rmSync(path, options) {
            if (path === markdownPath && !removalFailed) {
              removalFailed = true;
              throw new Error('injected rollback removal failure');
            }
            rmSync(path, options);
          },
        },
      );
    } catch (error) {
      deliveryError = error;
    }

    expect(removalFailed).toBe(true);
    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(deliveryError.recovery).toMatchObject({
      rollbackRemoveFailures: 1,
    });
    expect(JSON.stringify(deliveryError.recovery)).not.toContain(root);
    expect(JSON.stringify(deliveryError.recovery)).not.toContain('injected');
  });

  it('removes an owned partial temp when a staging write fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua report partial write-'));
    cleanup.push(root);
    const reportsDirectory = join(root, 'reports');
    const outputPath = join(reportsDirectory, 'result.json');
    const markdownPath = join(reportsDirectory, 'result.md');
    mkdirSync(reportsDirectory);
    writeFileSync(outputPath, 'old json\n');
    writeFileSync(markdownPath, 'old markdown\n');
    const entriesBefore = readdirSync(reportsDirectory).sort();
    let injectedFailure = false;
    let deliveryError;

    try {
      benchmark.deliverBenchmarkReports(
        {
          outputPath,
          markdownPath,
          jsonContents: 'new json\n',
          markdownContents: 'new markdown\n',
        },
        {
          writeFileSync(path, contents, options) {
            writeFileSync(path, contents.slice(0, 1), options);
            injectedFailure = true;
            throw new Error(`ENOSPC while writing ${path}`);
          },
        },
      );
    } catch (error) {
      deliveryError = error;
    }

    expect(injectedFailure).toBe(true);
    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(deliveryError).not.toHaveProperty('cause');
    expect(deliveryError.message).not.toContain(root);
    expect(deliveryError.message).not.toContain('ENOSPC');
    expect(readFileSync(outputPath, 'utf-8')).toBe('old json\n');
    expect(readFileSync(markdownPath, 'utf-8')).toBe('old markdown\n');
    expect(readdirSync(reportsDirectory).sort()).toEqual(entriesBefore);
  });

  it('handles an existing directory at the JSON report path without leaking artifacts', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'result.json');
    const sentinelPath = join(reportPath, 'sentinel.txt');
    mkdirSync(reportPath, { recursive: true });
    writeFileSync(sentinelPath, 'keep me\n');
    const artifactsBefore = benchmarkArtifactEntries();

    const result = runCli([subject, '--output', reportPath]);

    expectSafeReportWriteFailure(result, [
      subject,
      benchmark.REPO_ROOT,
      reportPath,
    ]);
    expect(benchmarkArtifactEntries()).toEqual(artifactsBefore);
    expect(readFileSync(sentinelPath, 'utf-8')).toBe('keep me\n');
  }, 70_000);

  it('preflights an existing Markdown directory before writing the JSON report', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'result.json');
    const markdownPath = join(root, 'reports', 'result.md');
    const sentinelPath = join(markdownPath, 'sentinel.txt');
    mkdirSync(markdownPath, { recursive: true });
    writeFileSync(sentinelPath, 'keep me too\n');
    const artifactsBefore = benchmarkArtifactEntries();

    const result = runCli([subject, '--output', reportPath]);

    expectSafeReportWriteFailure(result, [
      subject,
      benchmark.REPO_ROOT,
      reportPath,
      markdownPath,
    ]);
    expect(benchmarkArtifactEntries()).toEqual(artifactsBefore);
    expect(existsSync(reportPath)).toBe(false);
    expect(readFileSync(sentinelPath, 'utf-8')).toBe('keep me too\n');
  }, 70_000);

  it('preserves but does not print artifacts when report delivery fails with keep-artifacts', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'result.json');
    mkdirSync(reportPath, { recursive: true });
    const artifactsBefore = benchmarkArtifactEntries();

    const result = runCli([
      subject,
      '--output',
      reportPath,
      '--keep-artifacts',
    ]);
    const newArtifactEntries = benchmarkArtifactEntries().filter(
      (entry) => !artifactsBefore.includes(entry),
    );
    for (const entry of newArtifactEntries) {
      cleanup.push(join(tmpdir(), entry));
    }

    expectSafeReportWriteFailure(result, [
      subject,
      benchmark.REPO_ROOT,
      reportPath,
    ]);
    expect(newArtifactEntries).toHaveLength(1);
    expect(existsSync(join(tmpdir(), newArtifactEntries[0]))).toBe(true);
  }, 70_000);

  it('exposes a preserved artifact root as report delivery error metadata', async () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'result.json');
    mkdirSync(reportPath, { recursive: true });
    const options = parseArgs(
      [subject, '--output', reportPath, '--keep-artifacts'],
      root,
    );
    const artifactsBefore = benchmarkArtifactEntries();
    let deliveryError;

    try {
      await benchmark.runBenchmark(options);
    } catch (error) {
      deliveryError = error;
    }
    const newArtifactEntries = benchmarkArtifactEntries().filter(
      (entry) => !artifactsBefore.includes(entry),
    );
    for (const entry of newArtifactEntries) {
      cleanup.push(join(tmpdir(), entry));
    }

    expect(deliveryError).toBeInstanceOf(benchmark.BenchmarkReportWriteError);
    expect(newArtifactEntries).toHaveLength(1);
    expect(deliveryError).toMatchObject({
      message: 'Unable to write benchmark report files',
      artifactRoot: join(tmpdir(), newArtifactEntries[0]),
    });
    expect(existsSync(deliveryError.artifactRoot)).toBe(true);
  }, 70_000);

  it('runs all deterministic stages without writing into the subject repo', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'result.json');
    const markdownPath = join(root, 'reports', 'result.md');
    const secondReportPath = join(root, 'reports', 'result-second.json');
    mkdirSync(join(subject, '.ua'), { recursive: true });
    mkdirSync(join(subject, '.understand-anything'), { recursive: true });
    writeFileSync(join(subject, '.ua', 'sentinel.txt'), 'keep me\n');
    writeFileSync(
      join(subject, '.understand-anything', 'sentinel.txt'),
      'keep me too\n',
    );
    const before = snapshotTree(subject);

    const result = runCli(
      [
        subject,
        '--output',
        reportPath,
        '--label',
        'polyglot-mini',
        '--concurrency',
        '2',
      ],
    );

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(reportPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(snapshotTree(subject)).toEqual(before);

    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    const schema = JSON.parse(readFileSync(REPORT_SCHEMA, 'utf-8'));
    const markdown = readFileSync(markdownPath, 'utf-8');
    expectValidReport(report);
    expect(report.schemaUrl).toBe(schema.$id);
    expect(report.schemaVersion).toBe('1.0.0');
    expect(report.pairId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(report.status).toBe('ok');
    expect(report.mode).toBe('deterministic');
    expect(report.subject).toEqual({
      label: 'polyglot-mini',
      commit: null,
      dirty: null,
    });
    expect(report.scale.files).toBe(3);
    expect(report.scale.lines).toBeGreaterThan(0);
    expect(report.stages.scan.status).toBe('ok');
    expect(report.stages.imports.edges).toBe(1);
    expect(report.stages.batching.totalBatches).toBeGreaterThan(0);
    expect(report.stages.structure.filesAnalyzed).toBe(3);
    expect(report.stages.structure.maxWorkerPeakRssBytes).toBeGreaterThan(0);
    expect(report.stages.structure.userCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(report.stages.structure.systemCpuTimeMicros).toBeGreaterThanOrEqual(0);
    expect(report.stages.structure).not.toHaveProperty('peakRssBytes');
    expect(report.integrity.allScannedFilesBatched).toBe(true);
    expect(report.integrity.structureCoverage).toBe(1);
    expect(report.llm.invoked).toBe(false);
    expect(report.determinism.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.determinism.outputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain(subject);
    expect(markdown).toContain('# Large Repository Benchmark Report');
    expect(markdown).toContain(`| Pair ID | ${report.pairId} |`);
    expect(markdown).toContain('| Files | 3 |');
    expect(markdown).toContain('| LLM invoked | No |');
    expect(markdown).toContain('Peak / max worker RSS (bytes)');
    expect(markdown).not.toContain(subject);

    const secondResult = runCli([
      subject,
      '--output',
      secondReportPath,
      '--label',
      'polyglot-mini',
      '--concurrency',
      '1',
    ]);
    expect(secondResult.status, secondResult.stderr).toBe(0);
    expect(snapshotTree(subject)).toEqual(before);
    const secondReport = JSON.parse(readFileSync(secondReportPath, 'utf-8'));
    expect(report.configuration.concurrency).toBe(2);
    expect(secondReport.configuration.concurrency).toBe(1);
    expect(secondReport.scale).toEqual(report.scale);
    expect(secondReport.integrity).toEqual(report.integrity);
    expect(secondReport.determinism).toEqual(report.determinism);
    expect(secondReport.stages.batching.batchSizes).toEqual(
      report.stages.batching.batchSizes,
    );
  }, 70_000);

  it('keeps full Unicode benchmark digests stable across locale environments', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const firstReportPath = join(root, 'locale-c.json');
    const secondReportPath = join(root, 'locale-sv.json');
    for (const name of ['Z', 'a', 'ä']) {
      writeFileSync(join(subject, 'src', `${name}.ts`), `export const ${
        name === 'ä' ? 'accented' : name
      } = 1;\n`);
    }
    writeFileSync(
      join(subject, 'src', 'index.ts'),
      [
        'import "./ä";',
        'import "./Z";',
        'import "./a";',
        'export const answer = 42;',
        '',
      ].join('\n'),
    );

    const runWithLocale = (locale, reportPath) =>
      runCli([subject, '--output', reportPath, '--concurrency', '2'], {
        env: { ...process.env, LANG: locale, LC_ALL: locale },
      });
    const firstResult = runWithLocale('C', firstReportPath);
    const secondResult = runWithLocale('sv_SE.UTF-8', secondReportPath);

    expect(firstResult.status, firstResult.stderr).toBe(0);
    expect(secondResult.status, secondResult.stderr).toBe(0);
    const firstReport = JSON.parse(readFileSync(firstReportPath, 'utf-8'));
    const secondReport = JSON.parse(readFileSync(secondReportPath, 'utf-8'));
    expectValidReport(firstReport);
    expectValidReport(secondReport);
    expect(secondReport.determinism).toEqual(firstReport.determinism);
    expect(secondReport.stages.imports.edges).toBe(3);
  }, 70_000);

  it('handles an empty repository as a valid deterministic run', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua empty benchmark-'));
    cleanup.push(root);
    const subject = join(root, 'empty subject');
    const reportPath = join(root, 'empty.json');
    mkdirSync(subject);

    const result = runCli([subject, '--output', reportPath]);

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    expectValidReport(report);
    expect(report.status).toBe('ok');
    expect(report.scale.files).toBe(0);
    expect(report.stages.batching.totalBatches).toBe(0);
    expect(report.stages.structure.batchesSucceeded).toBe(0);
    expect(report.integrity.structureCoverage).toBe(1);
  }, 70_000);

  it('degrades for an accounted skip and uses the scan content digest', async () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const reportPath = join(root, 'reports', 'degraded.json');
    const options = parseArgs(
      [subject, '--output', reportPath, '--keep-artifacts'],
      root,
    );
    let removedAtStructure = false;

    const result = await benchmark.runBenchmark(options, {
      onProgress(stage) {
        if (stage === 'structure') {
          rmSync(join(subject, 'src', 'math.ts'));
          removedAtStructure = true;
        }
      },
    });
    cleanup.push(result.artifactRoot);
    const scan = JSON.parse(
      readFileSync(join(result.artifactRoot, 'scan-result.json'), 'utf-8'),
    );

    expect(removedAtStructure).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('degraded');
    expectValidReport(result.report);
    expect(result.report.integrity).toMatchObject({
      structureCoverage: 1,
      filesSkipped: 1,
      failedBatches: 0,
      missingStructurePaths: 0,
      duplicateStructurePaths: 0,
      unexpectedStructurePaths: 0,
      malformedStructureBatches: 0,
    });
    expect(result.report.determinism.inputDigest).toBe(scan.contentDigest);
  }, 70_000);

  it('changes the input digest when source bytes change but scan counts do not', () => {
    const { root, subject } = makeSubject();
    cleanup.push(root);
    const firstReportPath = join(root, 'digest-first.json');
    const secondReportPath = join(root, 'digest-second.json');

    const firstResult = runCli([subject, '--output', firstReportPath]);
    expect(firstResult.status, firstResult.stderr).toBe(0);
    const firstReport = JSON.parse(readFileSync(firstReportPath, 'utf-8'));

    writeFileSync(
      join(subject, 'src', 'math.ts'),
      'export function add(a: number, b: number) { return a - b; }\n',
    );
    const secondResult = runCli([subject, '--output', secondReportPath]);
    expect(secondResult.status, secondResult.stderr).toBe(0);
    const secondReport = JSON.parse(readFileSync(secondReportPath, 'utf-8'));

    expect(secondReport.scale.files).toBe(firstReport.scale.files);
    expect(secondReport.scale.lines).toBe(firstReport.scale.lines);
    expect(secondReport.scale.bytes).toBe(firstReport.scale.bytes);
    expect(secondReport.determinism.inputDigest).not.toBe(
      firstReport.determinism.inputDigest,
    );
  }, 70_000);

  it('returns usage errors without creating reports', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua benchmark usage-'));
    cleanup.push(root);
    const reportPath = join(root, 'should-not-exist.json');

    const help = runCli(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage:');

    const invalid = runCli([
      '--repo',
      join(root, 'missing'),
      '--output',
      reportPath,
    ]);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain('Repository path does not exist');
    expect(existsSync(reportPath)).toBe(false);
  });
});
