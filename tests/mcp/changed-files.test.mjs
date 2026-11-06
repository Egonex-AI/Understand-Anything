import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles } from '../../understand-anything-plugin/packages/mcp/lib/changed-files.mjs';

const repos = [];

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root, file, content = 'x\n') {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function commit(root, message = 'commit') {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', message]);
}

/** Repo with a root project and an analyzed subproject at apps/service. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ua-mcp-changed-'));
  repos.push(root);
  git(root, ['init', '-q']);
  // Default core.quotePath=true is what produces octal-escaped output.
  git(root, ['config', 'core.quotePath', 'true']);
  write(root, 'README.md');
  write(root, 'src/中文.py', 'v1\n');
  write(root, 'apps/service/src/main.py', 'v1\n');
  write(root, 'apps/service/src/中文.py', 'v1\n');
  write(root, 'apps/service/.ua/knowledge-graph.json', '{}');
  write(root, 'apps/other/src/x.py', 'v1\n');
  commit(root, 'init');
  return { root, service: join(root, 'apps/service') };
}

afterEach(() => {
  while (repos.length) rmSync(repos.pop(), { recursive: true, force: true });
});

describe('changedFiles — subprojects', () => {
  it('lists unstaged untracked files in a subproject relative to it', () => {
    const { service } = makeRepo();
    write(service, 'src/new.py');
    expect(changedFiles(service, {})).toEqual(['src/new.py']);
  });

  it('combines tracked and untracked changes on the same project-relative base', () => {
    const { root, service } = makeRepo();
    write(service, 'src/main.py', 'v2\n');
    write(service, 'src/new.py');
    write(root, 'apps/other/src/x.py', 'v2\n');
    write(root, 'apps/other/src/untracked.py');
    expect(changedFiles(service, {}).sort()).toEqual(['src/main.py', 'src/new.py']);
  });

  it('excludes analysis artifacts in the subproject', () => {
    const { service } = makeRepo();
    write(service, '.ua/knowledge-graph.json', '{"v":2}');
    write(service, '.ua/intermediate/x.json');
    expect(changedFiles(service, {})).toEqual([]);
  });
});

describe('changedFiles — non-ASCII paths', () => {
  it('returns modified non-ASCII paths verbatim at the repo root', () => {
    const { root } = makeRepo();
    write(root, 'src/中文.py', 'v2\n');
    expect(changedFiles(root, {})).toEqual(['src/中文.py']);
  });

  it('returns modified non-ASCII paths verbatim in a subproject', () => {
    const { service } = makeRepo();
    write(service, 'src/中文.py', 'v2\n');
    expect(changedFiles(service, {})).toEqual(['src/中文.py']);
  });

  it('returns untracked non-ASCII paths verbatim', () => {
    const { service } = makeRepo();
    write(service, 'src/新しい.py');
    expect(changedFiles(service, {})).toEqual(['src/新しい.py']);
  });

  it('preserves filenames with surrounding whitespace', () => {
    const { service } = makeRepo();
    write(service, 'src/ spaced .py');
    expect(changedFiles(service, {})).toEqual(['src/ spaced .py']);
  });
});

describe('changedFiles — staged and base modes', () => {
  it('staged=true reports only the index, relative to the subproject', () => {
    const { root, service } = makeRepo();
    write(service, 'src/中文.py', 'v2\n');
    git(root, ['add', 'apps/service/src/中文.py']);
    write(service, 'src/main.py', 'v2\n');
    write(service, 'src/new.py');
    expect(changedFiles(service, { staged: true })).toEqual(['src/中文.py']);
  });

  it('base compares a ref against HEAD, relative to the subproject', () => {
    const { root, service } = makeRepo();
    git(root, ['branch', 'base']);
    write(service, 'src/中文.py', 'v2\n');
    write(root, 'apps/other/src/x.py', 'v2\n');
    commit(root, 'change');
    write(service, 'src/new.py');
    expect(changedFiles(service, { base: 'base' })).toEqual(['src/中文.py']);
  });

  it('rejects option-shaped base refs', () => {
    const { service } = makeRepo();
    expect(() => changedFiles(service, { base: '--output=/tmp/x' })).toThrow(/Invalid base ref/);
    expect(() => changedFiles(service, { base: 'a..b' })).toThrow(/Invalid base ref/);
  });
});
