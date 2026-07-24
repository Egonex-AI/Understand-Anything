import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { estimatedAgentInputBytes } from '../../../understand-anything-plugin/skills/understand/analysis-metrics.mjs';
import {
  AnalysisPlanInputError,
  buildAnalysisPlan,
  parseArgs,
  renderPlanSummary,
  runCli,
} from '../../../understand-anything-plugin/skills/understand/analysis-plan.mjs';

const roots = [];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function makeProject(fileContents = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua analysis plan-'));
  roots.push(root);
  const entries = Object.entries(fileContents);
  const files = entries.map(([path, contents]) => {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
    return {
      path,
      language: path.endsWith('.md') ? 'markdown' : 'typescript',
      sizeLines: contents === '' ? 0 : contents.split('\n').length,
      fileCategory: path.endsWith('.md') ? 'docs' : 'code',
    };
  });
  return { root, files };
}

function inputs(project, selectedPaths = project.files.map((file) => file.path), batchIndices = [1]) {
  const selected = new Set(selectedPaths);
  const selectedFiles = project.files.filter((file) => selected.has(file.path));
  const chunks = batchIndices.map(() => []);
  selectedFiles.forEach((file, index) => chunks[index % chunks.length].push(file));
  const batches = chunks.map((files, index) => ({
    batchIndex: batchIndices[index],
    files,
    batchImportData: Object.fromEntries(files.map((file) => [file.path, []])),
    neighborMap: Object.fromEntries(files.map((file) => [file.path, []])),
  }));
  return {
    scan: {
      name: 'fixture',
      description: 'fixture',
      languages: ['typescript'],
      frameworks: [],
      contentDigest: digest(
        project.files.map((file) => `${file.path}:${readFileSync(join(project.root, file.path))}`).join('|'),
      ),
      files: project.files,
      totalFiles: project.files.length,
      filteredByIgnore: 0,
      estimatedComplexity: 'small',
      importMap: Object.fromEntries(project.files.map((file) => [file.path, []])),
    },
    batches: {
      schemaVersion: 1,
      algorithm: 'semantic-v1',
      totalFiles: project.files.length,
      totalBatches: batches.length,
      exportsByPath: {},
      batches,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('analysis preflight plan', () => {
  it('builds a deterministic full plan from real scan and batch artifacts', () => {
    const project = makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'docs/readme.md': '# Fixture\n',
    });
    const artifacts = inputs(project, undefined, [1, 2]);

    const first = buildAnalysisPlan({ projectRoot: project.root, ...artifacts });
    const second = buildAnalysisPlan({ projectRoot: project.root, ...artifacts });

    expect(second).toEqual(first);
    expect(first.scale).toMatchObject({ projectFiles: 3, analysisFiles: 3, missingFiles: 0 });
    expect(first.batching.totalBatches).toBe(2);
    expect(first.batching.batches.map((batch) => batch.batchIndex)).toEqual([1, 2]);
    expect(first.batching.serializedBatchContextBytes).toBe(
      estimatedAgentInputBytes(artifacts.batches.batches),
    );
    expect(first.estimates.phase2InputTokens.lower).toBe(
      Math.ceil(first.estimates.knownInputBytes / 4),
    );
    expect(first.estimates.phase2InputTokens.upper).toBe(
      Math.ceil(first.estimates.knownInputBytes / 2),
    );
    expect(first.estimates.wallTimeSeconds.lower).toBeNull();
    expect(first.estimates.costUsd.lower).toBeNull();
  });

  it('uses only selected batch files for an incremental plan', () => {
    const project = makeProject({
      'src/a.ts': 'a\n',
      'src/b.ts': 'b\n',
      'src/c.ts': 'c\n',
      'src/d.ts': 'd\n',
    });
    const artifacts = inputs(project, ['src/b.ts', 'src/d.ts'], [2, 7]);

    const plan = buildAnalysisPlan({
      projectRoot: project.root,
      ...artifacts,
      mode: 'incremental',
    });

    expect(plan.scale.projectFiles).toBe(4);
    expect(plan.scale.analysisFiles).toBe(2);
    expect(plan.batching.batches.map((batch) => batch.batchIndex)).toEqual([2, 7]);
  });

  it('changes plan identity when the scanner content digest changes', () => {
    const project = makeProject({ 'src/a.ts': 'old contents\n' });
    const artifacts = inputs(project);
    const before = buildAnalysisPlan({ projectRoot: project.root, ...artifacts });
    artifacts.scan.contentDigest = digest('new contents');
    const after = buildAnalysisPlan({ projectRoot: project.root, ...artifacts });

    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.planId).not.toBe(before.planId);
  });

  it('changes plan identity when selected source changes without refreshed artifacts', () => {
    const project = makeProject({ 'src/a.ts': 'old contents\n' });
    const artifacts = inputs(project);
    const before = buildAnalysisPlan({ projectRoot: project.root, ...artifacts, mode: 'incremental' });

    writeFileSync(join(project.root, 'src/a.ts'), 'new contents\n');
    const after = buildAnalysisPlan({ projectRoot: project.root, ...artifacts, mode: 'incremental' });

    expect(after.scale.sourceBytes).toBe(before.scale.sourceBytes);
    expect(after.scale.selectedSourceDigest).not.toBe(before.scale.selectedSourceDigest);
    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.planId).not.toBe(before.planId);
  });

  it('refreshes selected line counts instead of trusting preserved scan metadata', () => {
    const project = makeProject({ 'src/a.ts': 'old\n' });
    const artifacts = inputs(project);
    writeFileSync(join(project.root, 'src/a.ts'), 'one\ntwo\nthree\n');

    const plan = buildAnalysisPlan({ projectRoot: project.root, ...artifacts, mode: 'incremental' });

    expect(artifacts.scan.files[0].sizeLines).toBe(2);
    expect(plan.scale.lines).toBe(3);
    expect(plan.batching.batches[0].lines).toBe(3);
    expect(plan.risks.map((entry) => entry.code)).toContain('reused-scan-context');
  });

  it('reports duplicate assignments, unsafe paths, and generated-looking input', () => {
    const project = makeProject({
      'src/a.ts': 'a\n',
      'generated/client.generated.ts': 'generated\n',
    });
    const artifacts = inputs(project, undefined, [1, 2]);
    artifacts.batches.batches[1].files.push(artifacts.batches.batches[0].files[0]);
    artifacts.batches.batches[1].batchImportData[artifacts.batches.batches[0].files[0].path] = [];
    artifacts.batches.batches[1].neighborMap[artifacts.batches.batches[0].files[0].path] = [];
    const unsafe = {
      path: '../outside.ts',
      language: 'typescript',
      sizeLines: 1,
      fileCategory: 'code',
    };
    artifacts.scan.files.push(unsafe);
    artifacts.scan.totalFiles += 1;
    artifacts.batches.totalFiles += 1;
    artifacts.scan.importMap[unsafe.path] = [];
    artifacts.batches.batches[0].files.push(unsafe);
    artifacts.batches.batches[0].batchImportData[unsafe.path] = [];
    artifacts.batches.batches[0].neighborMap[unsafe.path] = [];

    const plan = buildAnalysisPlan({ projectRoot: project.root, ...artifacts });
    const codes = plan.risks.map((entry) => entry.code);

    expect(codes).toContain('duplicate-batch-assignment');
    expect(codes).toContain('unsafe-file-paths');
    expect(codes).toContain('generated-looking-input');
    expect(plan.scopeSuggestions.some((entry) => entry.kind === 'exclude')).toBe(true);
  });

  it('rejects malformed artifacts, duplicate CLI flags, and escaping scopes', () => {
    const project = makeProject({ 'src/a.ts': 'a\n' });
    const artifacts = inputs(project);
    artifacts.batches.batches[0].batchIndex = 0;
    expect(() => buildAnalysisPlan({ projectRoot: project.root, ...artifacts })).toThrow(
      AnalysisPlanInputError,
    );
    expect(() => parseArgs(['--mode=full', '--mode=incremental'])).toThrow(/duplicate/);
    expect(() => parseArgs(['--output='])).toThrow(/invalid/);
    const mismatchedTotals = inputs(project);
    mismatchedTotals.batches.totalFiles = 0;
    expect(() => buildAnalysisPlan({ projectRoot: project.root, ...mismatchedTotals })).toThrow(
      /totalFiles/,
    );
    const incomplete = inputs(project, []);
    incomplete.batches.batches = [];
    incomplete.batches.totalBatches = 0;
    expect(() => buildAnalysisPlan({ projectRoot: project.root, ...incomplete })).toThrow(
      /cover every scanned file/,
    );
    expect(() =>
      buildAnalysisPlan({
        projectRoot: project.root,
        ...inputs(project),
        scope: '../outside',
      }),
    ).toThrow(/within the project root/);
  });

  it('writes to .ua by default and honors the legacy data directory', () => {
    for (const legacy of [false, true]) {
      const project = makeProject({ 'src/a.ts': 'a\n' });
      const dataDir = join(project.root, legacy ? '.understand-anything' : '.ua');
      mkdirSync(join(dataDir, 'intermediate'), { recursive: true });
      const artifacts = inputs(project);
      writeFileSync(join(dataDir, 'intermediate', 'scan-result.json'), JSON.stringify(artifacts.scan));
      writeFileSync(join(dataDir, 'intermediate', 'batches.json'), JSON.stringify(artifacts.batches));

      const plan = runCli([project.root]);

      expect(existsSync(join(dataDir, 'analysis-plan.json'))).toBe(true);
      expect(plan.scale.analysisFiles).toBe(1);
    }
  });

  it('escapes control characters in terminal summaries', () => {
    const project = makeProject({ 'src/a.ts': 'a\n' });
    const plan = buildAnalysisPlan({ projectRoot: project.root, ...inputs(project) });
    plan.scopeSuggestions = [
      {
        kind: 'subdirectory',
        value: 'src\nINJECTED',
        fileCount: 1,
        lines: 1,
        estimatedReductionPercent: 0,
        reason: 'fixture',
      },
    ];

    const summary = renderPlanSummary(plan);

    expect(summary).toContain('src\\nINJECTED');
    expect(summary.split('\n')).toHaveLength(5);
  });
});
