import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync as nativeRenameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  atomicWriteJson,
  normalizeRelativeScope,
  withFileLock,
} from '../../../understand-anything-plugin/skills/understand/analysis-report-utils.mjs';

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ua report utils-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('analysis report file safety', () => {
  it('creates and replaces JSON while cleaning transaction artifacts', () => {
    const root = makeRoot();
    const target = join(root, 'report.json');
    atomicWriteJson(target, { version: 1 });
    atomicWriteJson(target, { version: 2 });

    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ version: 2 });
    expect(existsSync(`${target}.lock`)).toBe(false);
    expect(readdirSync(root)).toEqual(['report.json']);
  });

  it('refuses to replace a directory target', () => {
    const root = makeRoot();
    const target = join(root, 'report.json');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep');

    expect(() => atomicWriteJson(target, { unsafe: true })).toThrow(/not a regular file/);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('restores the prior report if final delivery fails', () => {
    const root = makeRoot();
    const target = join(root, 'report.json');
    writeFileSync(target, '{"old":true}\n');
    let renameCalls = 0;

    expect(() =>
      atomicWriteJson(
        target,
        { new: true },
        {
          randomId: () => 'failure',
          renameSync(source, destination) {
            renameCalls += 1;
            if (renameCalls === 2) throw new Error('forced delivery failure');
            return nativeRenameSync(source, destination);
          },
        },
      ),
    ).toThrow(/forced delivery failure/);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ old: true });
  });

  it('holds an exclusive lock, releases it after errors, and recovers a stale lock', () => {
    const root = makeRoot();
    const target = join(root, 'run-report.json');

    withFileLock(target, () => {
      expect(() => withFileLock(target, () => {})).toThrow(/Unable to acquire report lock/);
      expect(existsSync(`${target}.lock`)).toBe(true);
      expect(() => withFileLock(target, () => {})).toThrow(/Unable to acquire report lock/);
    });
    expect(existsSync(`${target}.lock`)).toBe(false);

    expect(() =>
      withFileLock(target, () => {
        throw new Error('callback failed');
      }),
    ).toThrow(/callback failed/);
    expect(existsSync(`${target}.lock`)).toBe(false);

    writeFileSync(`${target}.lock`, 'stale');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(`${target}.lock`, old, old);
    expect(withFileLock(target, () => 'recovered')).toBe('recovered');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });
});

describe('relative scope normalization', () => {
  it('normalizes safe paths and rejects traversal, absolute, drive-relative, and controls', () => {
    expect(normalizeRelativeScope('.')).toBe('.');
    expect(normalizeRelativeScope('./packages\\core')).toBe('packages/core');
    for (const unsafe of [
      '../outside',
      '/absolute',
      'C:\\absolute',
      'C:relative',
      'src\nnext',
      'a'.repeat(1025),
    ]) {
      expect(() => normalizeRelativeScope(unsafe)).toThrow();
    }
  });
});
