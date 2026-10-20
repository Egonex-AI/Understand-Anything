import { describe, it, expect, afterEach } from 'vitest';

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This synchronous subprocess suite can exceed 60 seconds on Windows. Yield
// between cases so Vitest can service onTaskUpdate replies while tests run.
afterEach(async () => {
  await new Promise(resolve => setImmediate(resolve));
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/extract-structure.mjs');

/** Write a source tree from a `files` object: { 'a/b.ts': '...', ... }. */
function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-xstruct-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  return root;
}

/**
 * Run extract-structure.mjs. Returns { status, stderr, output } where `output`
 * is the parsed JSON written by the script (or null when unreadable).
 */
function runScript(input) {
  const scratch = mkdtempSync(join(tmpdir(), 'ua-xstruct-run-'));
  const inputPath = join(scratch, 'input.json');
  const outputPath = join(scratch, 'output.json');
  writeFileSync(inputPath, JSON.stringify(input), 'utf-8');
  const result = spawnSync('node', [SCRIPT, inputPath, outputPath], { encoding: 'utf-8' });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stderr: result.stderr, output, scratch };
}

const batchFile = (path, language = 'typescript') => ({
  path,
  language,
  fileCategory: 'code',
});

describe('extract-structure.mjs — unreadable files vs. files with no parser', () => {
  let projectRoot;
  const scratchDirs = [];

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
    for (const dir of scratchDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a file that cannot be read separately from a file with no parser', () => {
    projectRoot = setupTree({
      'src/readable.ts': 'export function alpha(x) { return x + 1; }\n',
      'src/unsupported.xyz': 'no parser handles this\n',
    });

    const run = runScript({
      projectRoot,
      batchFiles: [batchFile('src/readable.ts'), batchFile('src/missing.ts'), batchFile('src/unsupported.xyz', 'unknown')],
      batchImportData: {},
    });
    scratchDirs.push(run.scratch);

    // One file read fine, so this is not the pathological case and must not fail.
    expect(run.status).toBe(0);
    expect(run.output.scriptCompleted).toBe(true);
    expect(run.output.filesAnalyzed).toBe(1);

    // Only the genuinely unreadable file is reported as unreadable, with its error code.
    expect(run.output.filesUnreadable).toEqual([{ path: 'src/missing.ts', code: 'ENOENT' }]);

    // filesSkipped stays the superset so "every batch file is accounted for" holds.
    expect(run.output.filesSkipped.sort()).toEqual(['src/missing.ts', 'src/unsupported.xyz']);

    // The unreadable file is surfaced on stderr rather than reading as routine.
    expect(run.stderr).toContain('src/missing.ts');
    expect(run.stderr).toContain('projectRoot');
  });

  it('fails loudly when no file in the batch could be read', () => {
    // The reported scenario: a projectRoot that does not resolve, so every
    // join(projectRoot, file.path) misses.
    projectRoot = setupTree({
      'src/alpha.ts': 'export function alpha(x) { return x + 1; }\n',
      'src/beta.ts': 'export function beta(y) { return y * 2; }\n',
    });

    const run = runScript({
      projectRoot: join(projectRoot, 'wrong-root'),
      batchFiles: [batchFile('src/alpha.ts'), batchFile('src/beta.ts')],
      batchImportData: {},
    });
    scratchDirs.push(run.scratch);

    // Non-zero so the caller aborts instead of accepting stub nodes.
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('projectRoot');

    // The output is still written so the caller can inspect what failed.
    expect(run.output.scriptCompleted).toBe(true);
    expect(run.output.filesAnalyzed).toBe(0);
    expect(run.output.filesUnreadable).toEqual([
      { path: 'src/alpha.ts', code: 'ENOENT' },
      { path: 'src/beta.ts', code: 'ENOENT' },
    ]);
    expect(run.output.filesSkipped.sort()).toEqual(['src/alpha.ts', 'src/beta.ts']);
  });

  it('does not fail a batch that contains no files', () => {
    projectRoot = setupTree({});

    const run = runScript({ projectRoot, batchFiles: [], batchImportData: {} });
    scratchDirs.push(run.scratch);

    expect(run.status).toBe(0);
    expect(run.output.filesAnalyzed).toBe(0);
    expect(run.output.filesUnreadable).toEqual([]);
    expect(run.output.filesSkipped).toEqual([]);
  });

  it('keeps both buckets empty for a fully readable batch', () => {
    projectRoot = setupTree({
      'src/alpha.ts': 'export function alpha(x) { return x + 1; }\n',
      'src/beta.ts': 'export function beta(y) { return y * 2; }\n',
    });

    const run = runScript({
      projectRoot,
      batchFiles: [batchFile('src/alpha.ts'), batchFile('src/beta.ts')],
      batchImportData: {},
    });
    scratchDirs.push(run.scratch);

    expect(run.status).toBe(0);
    expect(run.output.filesAnalyzed).toBe(2);
    expect(run.output.filesUnreadable).toEqual([]);
    expect(run.output.filesSkipped).toEqual([]);
    expect(run.stderr).toBe('');
  });
});
