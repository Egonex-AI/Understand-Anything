import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../understand-anything-plugin/skills/understand');
const BUILD_SCRIPT = join(SKILL_DIR, 'build-fingerprints.mjs');
const CHECK_SCRIPT = join(SKILL_DIR, 'check-fingerprints.mjs');
const UPDATE_SCRIPT = join(SKILL_DIR, 'update-fingerprints.mjs');

function runNode(script, args) {
  return spawnSync('node', [script, ...args], { encoding: 'utf-8' });
}

function writeInput(root, name, data) {
  const p = join(root, '.ua', 'intermediate', name);
  writeFileSync(p, JSON.stringify(data));
  return p;
}

function readChangeAnalysis(root) {
  return JSON.parse(
    readFileSync(join(root, '.ua', 'intermediate', 'change-analysis.json'), 'utf-8'),
  );
}

function readStore(root) {
  return JSON.parse(readFileSync(join(root, '.ua', 'fingerprints.json'), 'utf-8'));
}

const UTILS_TS =
  "import { helper } from './helper';\n" +
  '\n' +
  'export function formatDate(d: Date): string {\n' +
  '  const iso = d.toISOString();\n' +
  '  return iso.slice(0, 10);\n' +
  '}\n' +
  '\n' +
  'export function sanitize(s: string): string {\n' +
  '  return s.trim().toLowerCase();\n' +
  '}\n';

const HELPER_TS =
  'export function helper(x: number): number {\n' +
  '  return x * 2;\n' +
  '}\n';

/** Seed a two-file TS project with a fingerprint baseline built by the
 *  bundled builder — the same pipeline auto-update compares against. */
function setupBaselinedProject() {
  const root = mkdtempSync(join(tmpdir(), 'ua-fp-test-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.ua', 'intermediate'), { recursive: true });
  writeFileSync(join(root, 'src', 'utils.ts'), UTILS_TS);
  writeFileSync(join(root, 'src', 'helper.ts'), HELPER_TS);

  const input = writeInput(root, 'fp-input.json', {
    projectRoot: root,
    sourceFilePaths: ['src/utils.ts', 'src/helper.ts'],
    gitCommitHash: 'baseline-commit',
  });
  const result = runNode(BUILD_SCRIPT, [input]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Fingerprints baseline: 2 files');
  return root;
}

describe('check-fingerprints.mjs', () => {
  let root;

  beforeEach(() => {
    root = setupBaselinedProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('classifies an unchanged file as NONE and skips', () => {
    const input = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts'],
    });
    const result = runNode(CHECK_SCRIPT, [input]);
    expect(result.status).toBe(0);

    const analysis = readChangeAnalysis(root);
    expect(analysis.action).toBe('SKIP');
    expect(analysis.unchangedFiles).toEqual(['src/utils.ts']);
  });

  it('classifies an internal-logic-only edit as COSMETIC → SKIP (the zero-token path)', () => {
    // Reformat formatDate's body without touching any signature/import/export.
    writeFileSync(
      join(root, 'src', 'utils.ts'),
      UTILS_TS.replace(
        '  const iso = d.toISOString();\n  return iso.slice(0, 10);\n',
        '  // reformatted internals only\n  const iso = d.toISOString();\n  const day = iso.slice(0, 10);\n  return day;\n',
      ),
    );

    const input = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts'],
    });
    const result = runNode(CHECK_SCRIPT, [input]);
    expect(result.status).toBe(0);

    const analysis = readChangeAnalysis(root);
    expect(analysis.action).toBe('SKIP');
    expect(analysis.cosmeticOnlyFiles).toEqual(['src/utils.ts']);
    expect(analysis.structurallyChangedFiles).toEqual([]);
  });

  it('classifies a new exported function as STRUCTURAL', () => {
    appendFileSync(
      join(root, 'src', 'utils.ts'),
      "\nexport function slugify(s: string): string {\n  return s.replace(/\\s+/g, '-');\n}\n",
    );

    const input = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts'],
    });
    const result = runNode(CHECK_SCRIPT, [input]);
    expect(result.status).toBe(0);

    const analysis = readChangeAnalysis(root);
    expect(analysis.structurallyChangedFiles).toEqual(['src/utils.ts']);
    expect(analysis.filesToReanalyze).toEqual(['src/utils.ts']);
    const change = analysis.fileChanges.find((c) => c.filePath === 'src/utils.ts');
    expect(change.changeLevel).toBe('STRUCTURAL');
    expect(change.details.join(' ')).toContain('slugify');
  });

  it('classifies new and deleted files as STRUCTURAL', () => {
    writeFileSync(join(root, 'src', 'extra.ts'), 'export const extra = 1;\n');
    rmSync(join(root, 'src', 'helper.ts'));

    const input = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/extra.ts', 'src/helper.ts'],
    });
    const result = runNode(CHECK_SCRIPT, [input]);
    expect(result.status).toBe(0);

    const analysis = readChangeAnalysis(root);
    expect(analysis.newFiles).toEqual(['src/extra.ts']);
    expect(analysis.deletedFiles).toEqual(['src/helper.ts']);
  });

  it('degrades to all-STRUCTURAL when the baseline is missing (no crash)', () => {
    rmSync(join(root, '.ua', 'fingerprints.json'));

    const input = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts'],
    });
    const result = runNode(CHECK_SCRIPT, [input]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('fingerprints.json missing or empty');

    const analysis = readChangeAnalysis(root);
    expect(analysis.baselineMissing).toBe(true);
    // Without a baseline every changed file is "new" → STRUCTURAL.
    expect(analysis.newFiles).toEqual(['src/utils.ts']);
  });
});

describe('update-fingerprints.mjs', () => {
  let root;

  beforeEach(() => {
    root = setupBaselinedProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('LOAD-PATCH-SAVEs into store.files and converges the next check to SKIP', () => {
    appendFileSync(
      join(root, 'src', 'utils.ts'),
      "\nexport function slugify(s: string): string {\n  return s.replace(/\\s+/g, '-');\n}\n",
    );
    rmSync(join(root, 'src', 'helper.ts'));

    const input = writeInput(root, 'update-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts', 'src/helper.ts'],
      gitCommitHash: 'next-commit',
    });
    const result = runNode(UPDATE_SCRIPT, [input]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('patched 1, removed 1');

    // The patch must land inside store.files (the FingerprintStore shape),
    // preserving the envelope — not as top-level keys next to it.
    const store = readStore(root);
    expect(store.gitCommitHash).toBe('next-commit');
    expect(Object.keys(store.files)).toEqual(['src/utils.ts']);
    expect(store.files['src/utils.ts'].functions.map((f) => f.name)).toContain('slugify');

    // Re-checking the same paths now finds nothing new — no permanent
    // STRUCTURAL escalation (issue #152 regression guard).
    const checkInput = writeInput(root, 'check-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts', 'src/helper.ts'],
    });
    const check = runNode(CHECK_SCRIPT, [checkInput]);
    expect(check.status).toBe(0);
    expect(readChangeAnalysis(root).action).toBe('SKIP');
  });

  it('refuses to write a partial baseline when the store is missing', () => {
    rmSync(join(root, '.ua', 'fingerprints.json'));

    const input = writeInput(root, 'update-input.json', {
      projectRoot: root,
      changedFilePaths: ['src/utils.ts'],
      gitCommitHash: 'next-commit',
    });
    const result = runNode(UPDATE_SCRIPT, [input]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to write a partial baseline');
  });
});
