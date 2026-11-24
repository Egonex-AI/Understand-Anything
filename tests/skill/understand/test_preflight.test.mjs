import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/preflight.sh',
);

/**
 * Resolve the real node binary on PATH so we can put its directory into
 * tightly-scoped test PATHs (vs. inheriting the parent process's full PATH,
 * which would let preflight see things we don't want it to in negative tests).
 */
function realNodeDir() {
  const which = spawnSync('which', ['node'], { encoding: 'utf-8' });
  if (which.status !== 0 || !which.stdout.trim()) {
    throw new Error('test environment has no `node` on PATH — cannot test preflight.sh');
  }
  return dirname(which.stdout.trim());
}

function realPnpmDir() {
  const which = spawnSync('which', ['pnpm'], { encoding: 'utf-8' });
  if (which.status !== 0 || !which.stdout.trim()) {
    return null; // pnpm may be unavailable in some envs — happy-path test will skip
  }
  return dirname(which.stdout.trim());
}

/**
 * Resolve bash by absolute path. spawnSync uses the *child env's* PATH to
 * locate the executable, not the parent's — so tests that strip PATH down to
 * just a fixture directory would otherwise fail with ENOENT for bash itself.
 */
const BASH = (() => {
  const which = spawnSync('which', ['bash'], { encoding: 'utf-8' });
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : '/bin/bash';
})();

/**
 * Track every temp dir created so afterEach can sweep them.
 */
const tempDirs = [];

function mkTemp() {
  const dir = mkdtempSync(join(tmpdir(), 'ua-preflight-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Write a shell-script shim into `dir/name` that responds to specific argv
 * patterns. Used to fake old-node and similar scenarios without touching the
 * real toolchain.
 */
function writeShim(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body, 'utf-8');
  chmodSync(path, 0o755);
  return path;
}

/**
 * Run preflight.sh under a controlled PATH. `env` overrides go on top of a
 * minimal {PATH, HOME} base so tests are deterministic across hosts.
 */
// System bin dirs the preflight script itself needs (for `cat`, etc.) but
// which never contain node or pnpm on a stock install. Tests prepend their
// own fixture dirs to this baseline so they can control whether node/pnpm
// are visible without losing access to coreutils.
const SYSTEM_BIN = ['/bin', '/usr/bin'];

function runPreflight({ path = '', extraEnv = {} } = {}) {
  const fullPath = [path, ...SYSTEM_BIN].filter(Boolean).join(':');
  return spawnSync(BASH, [SCRIPT], {
    env: {
      PATH: fullPath,
      HOME: process.env.HOME ?? '/tmp',
      ...extraEnv,
    },
    encoding: 'utf-8',
  });
}

describe('preflight.sh', () => {
  it('succeeds when node >= 22 and pnpm are both on PATH', () => {
    const pnpmDir = realPnpmDir();
    if (!pnpmDir) {
      // Skip in environments without pnpm — the negative tests still cover the
      // pnpm-missing branch, so we don't lose coverage.
      return;
    }

    const result = runPreflight({
      path: [realNodeDir(), pnpmDir].join(':'),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^preflight: node v\d+\.\d+\.\d+, pnpm \d+\.\d+\.\d+/);
    expect(result.stderr).toBe('');
  });

  it('exits 1 with an actionable message when node is missing', () => {
    const empty = mkTemp();
    const result = runPreflight({ path: empty });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('`node` is not on PATH');
    expect(result.stderr).toContain('non-interactive shells');
    // The error mentions at least one of the version managers users may have
    // installed Node through; we don't pin the exact name so the test stays
    // resilient to wording tweaks.
    expect(result.stderr).toMatch(/nvm|fnm|mise|asdf/);
    expect(result.stdout).toBe('');
  });

  it('exits 1 with a version message when node < 22 is on PATH', () => {
    const shimDir = mkTemp();
    // Fake node that responds to the exact two invocations preflight makes:
    //   node --version
    //   node -e 'console.log(process.versions.node.split(".")[0])'
    writeShim(
      shimDir,
      'node',
      `#!/usr/bin/env bash
case "$1" in
  --version) echo "v20.11.0" ;;
  -e) echo "20" ;;
  *) echo "mock node: unexpected args: $*" >&2; exit 1 ;;
esac
`,
    );

    const result = runPreflight({ path: shimDir });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Node.js >= 22 required');
    expect(result.stderr).toContain('v20.11.0');
    expect(result.stdout).toBe('');
  });

  it('exits 1 when node >= 22 is present but pnpm is missing', () => {
    // Real node, nothing else — preflight should fail at the pnpm check, not
    // the node checks.
    const result = runPreflight({ path: realNodeDir() });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('`pnpm` is not on PATH');
    expect(result.stdout).toBe('');
  });

  it('exits 1 when `node` is on PATH but the binary itself is broken', () => {
    const shimDir = mkTemp();
    // A "node" that prints nothing and exits non-zero — simulates a corrupt
    // install or a broken nvm symlink.
    writeShim(
      shimDir,
      'node',
      `#!/usr/bin/env bash
exit 1
`,
    );

    const result = runPreflight({ path: shimDir });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('`node -e` failed');
    expect(result.stdout).toBe('');
  });
});
