import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseGitNameStatus }
  from '../../../understand-anything-plugin/skills/understand/parse-git-changes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/parse-git-changes.mjs',
);

describe('parseGitNameStatus — module API', () => {
  it('returns empty sets for empty input', () => {
    const { changedSet, pruneSet } = parseGitNameStatus('');
    expect([...changedSet]).toEqual([]);
    expect([...pruneSet]).toEqual([]);
  });

  it('returns empty sets for null/undefined input', () => {
    expect(parseGitNameStatus(null).changedSet.size).toBe(0);
    expect(parseGitNameStatus(undefined).pruneSet.size).toBe(0);
  });

  it('classifies M / A as changed-only', () => {
    const diff = ['M\tsrc/a.ts', 'A\tsrc/b.ts'].join('\n');
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...pruneSet]).toEqual([]);
  });

  it('classifies D as prune-only (no analyze)', () => {
    const diff = 'D\tsrc/gone.ts';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual([]);
    expect([...pruneSet]).toEqual(['src/gone.ts']);
  });

  it('classifies R<score> as BOTH prune-old AND analyze-new (the Bug 1 fix)', () => {
    // The exact repro from issue #366: `git mv docs/a.md docs/b.md`.
    const diff = 'R100\tdocs/a.md\tdocs/b.md';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['docs/b.md']);
    expect([...pruneSet]).toEqual(['docs/a.md']);
  });

  it('classifies R with a non-100 similarity score (rename + small edit)', () => {
    // Renamed AND modified — git emits R<score> with score < 100.
    const diff = 'R087\tsrc/old/util.ts\tsrc/new/util.ts';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['src/new/util.ts']);
    expect([...pruneSet]).toEqual(['src/old/util.ts']);
  });

  it('classifies C<score> as analyze-new only (source file still exists)', () => {
    // Copy detection: original survives, must NOT be pruned.
    const diff = 'C50\tsrc/template.ts\tsrc/copy.ts';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['src/copy.ts']);
    expect([...pruneSet]).toEqual([]);
  });

  it('classifies T (type change) as changed-only', () => {
    // T appears when a file flips between regular file / symlink / submodule.
    const diff = 'T\tsrc/link.ts';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['src/link.ts']);
    expect([...pruneSet]).toEqual([]);
  });

  it('classifies U (unmerged) as changed so user must resolve it', () => {
    const diff = 'U\tsrc/conflict.ts';
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['src/conflict.ts']);
    expect([...pruneSet]).toEqual([]);
  });

  it('skips blank lines silently', () => {
    const diff = ['', 'M\tsrc/a.ts', '', '', 'A\tsrc/b.ts', ''].join('\n');
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...pruneSet]).toEqual([]);
  });

  it('handles a realistic mixed diff (M + A + D + R + C)', () => {
    const diff = [
      'M\tpackages/core/src/foo.ts',
      'A\tpackages/core/src/new.ts',
      'D\tpackages/core/src/dead.ts',
      'R100\tdocs/a.md\tdocs/b.md',
      'R087\tsrc/util.ts\tsrc/utils/index.ts',
      'C75\tsrc/template.ts\tsrc/copy.ts',
    ].join('\n');
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet].sort()).toEqual([
      'docs/b.md',
      'packages/core/src/foo.ts',
      'packages/core/src/new.ts',
      'src/copy.ts',
      'src/utils/index.ts',
    ]);
    expect([...pruneSet].sort()).toEqual([
      'docs/a.md',
      'packages/core/src/dead.ts',
      'src/util.ts',
    ]);
    // No path may appear in BOTH sets — they MUST be disjoint, otherwise the
    // prune step would delete the freshly-re-analyzed nodes.
    for (const p of changedSet) expect(pruneSet.has(p)).toBe(false);
  });

  it('emits a warning to stderr for unknown status codes (does not throw)', () => {
    // Use a status code git would never emit today (e.g. 'X' = unknown).
    // We don't actually capture stderr from inside the test, but we can at
    // least assert the parser is robust enough to skip and continue.
    const diff = ['X\tsomething/weird.ts', 'M\tsrc/a.ts'].join('\n');
    const { changedSet, pruneSet } = parseGitNameStatus(diff);
    expect([...changedSet]).toEqual(['src/a.ts']);
    expect([...pruneSet]).toEqual([]);
  });
});

describe('parse-git-changes.mjs — CLI', () => {
  let tmp;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('writes sorted changed + prune sets to the two output files', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ua-pgc-'));
    const diffPath = join(tmp, 'diff.txt');
    const changedPath = join(tmp, 'changed.txt');
    const prunePath = join(tmp, 'prune.txt');

    // Mixed diff covering every branch the parser handles.
    const diff = [
      'M\tsrc/a.ts',
      'A\tsrc/b.ts',
      'D\tsrc/dead.ts',
      'R100\tdocs/old.md\tdocs/new.md',
      'C50\tsrc/template.ts\tsrc/copy.ts',
    ].join('\n');
    writeFileSync(diffPath, diff);

    const r = spawnSync('node', [SCRIPT, diffPath, changedPath, prunePath], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    // Stderr summary line is informational, not a Warning:
    expect(r.stderr).toMatch(/parse-git-changes: 4 changed, 2 prune-only/);

    // Outputs are sorted, newline-terminated.
    expect(readFileSync(changedPath, 'utf-8')).toBe(
      ['docs/new.md', 'src/a.ts', 'src/b.ts', 'src/copy.ts'].join('\n') + '\n',
    );
    expect(readFileSync(prunePath, 'utf-8')).toBe(
      ['docs/old.md', 'src/dead.ts'].join('\n') + '\n',
    );
  });

  it('CLI handles empty diff (no commits between base..HEAD)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ua-pgc-empty-'));
    const diffPath = join(tmp, 'diff.txt');
    const changedPath = join(tmp, 'changed.txt');
    const prunePath = join(tmp, 'prune.txt');
    writeFileSync(diffPath, '');

    const r = spawnSync('node', [SCRIPT, diffPath, changedPath, prunePath], {
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    // Empty outputs — empty strings, not "missing files".
    expect(readFileSync(changedPath, 'utf-8')).toBe('');
    expect(readFileSync(prunePath, 'utf-8')).toBe('');
  });

  it('CLI exits non-zero with no args', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Usage: node parse-git-changes\.mjs/);
  });

  it('CLI exits non-zero when diff file is missing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ua-pgc-miss-'));
    const r = spawnSync(
      'node',
      [SCRIPT, join(tmp, 'no-such.txt'), join(tmp, 'c.txt'), join(tmp, 'p.txt')],
      { encoding: 'utf-8' },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cannot read diff input/);
  });
});
