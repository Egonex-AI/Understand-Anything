#!/usr/bin/env node
/**
 * cleanup-workdirs.mjs - Phase 7 cleanup for /understand
 *
 * Moves fresh per-run work directories into a timestamped trash directory
 * instead of deleting them in place. Old trash directories are purged after a
 * retention window, so hardened hosts do not need to approve immediate
 * recursive deletion of artifacts that were created moments earlier.
 *
 * Usage:
 *   node cleanup-workdirs.mjs <project-root> [--retention-days=7]
 *
 * Writes:
 *   <project-root>/.understand-anything/.trash-<timestamp>-<pid>/
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;
const WORK_DIRS = ['intermediate', 'tmp'];

function parseArgs(argv) {
  const [, , projectRootArg, ...rest] = argv;
  if (!projectRootArg) {
    throw new Error('Usage: node cleanup-workdirs.mjs <project-root> [--retention-days=7]');
  }

  const options = {
    projectRoot: resolve(projectRootArg),
    retentionDays: DEFAULT_RETENTION_DAYS,
    nowMs: Date.now(),
  };

  for (const arg of rest) {
    if (arg.startsWith('--retention-days=')) {
      const value = Number(arg.slice('--retention-days='.length));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --retention-days value: ${arg}`);
      }
      options.retentionDays = value;
    } else if (arg.startsWith('--now-ms=')) {
      // Test-only determinism hook. Normal skill usage should not pass this.
      const value = Number(arg.slice('--now-ms='.length));
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid --now-ms value: ${arg}`);
      }
      options.nowMs = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function timestampForPath(nowMs) {
  return new Date(nowMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/[.]/g, '')
    .replace('T', '-');
}

function purgeExpiredTrash(stateDir, nowMs, retentionDays) {
  if (!existsSync(stateDir)) return [];

  const cutoffMs = nowMs - retentionDays * MS_PER_DAY;
  const purged = [];

  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.trash-')) continue;

    const fullPath = join(stateDir, entry.name);
    const stat = statSync(fullPath);
    if (stat.mtimeMs > cutoffMs) continue;

    rmSync(fullPath, { recursive: true, force: true });
    purged.push(entry.name);
  }

  return purged;
}

function moveWorkDirs(stateDir, nowMs) {
  const moved = [];
  let trashDir = null;

  for (const name of WORK_DIRS) {
    const source = join(stateDir, name);
    if (!existsSync(source)) continue;

    if (name === 'intermediate') {
      const entries = readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.name !== 'scan-result.json');
      if (entries.length === 0) continue;

      if (!trashDir) {
        trashDir = join(stateDir, `.trash-${timestampForPath(nowMs)}-${process.pid}`);
        mkdirSync(trashDir, { recursive: true });
      }

      const destination = join(trashDir, basename(source));
      mkdirSync(destination, { recursive: true });
      for (const entry of entries) {
        renameSync(join(source, entry.name), join(destination, entry.name));
      }
      try {
        rmSync(source);
      } catch {
        // Keep intermediate/ when scan-result.json remains for incremental runs.
      }
      moved.push({ name, destination });
      continue;
    }

    if (!trashDir) {
      trashDir = join(stateDir, `.trash-${timestampForPath(nowMs)}-${process.pid}`);
      mkdirSync(trashDir, { recursive: true });
    }

    const destination = join(trashDir, basename(source));
    renameSync(source, destination);
    moved.push({ name, destination });
  }

  return { trashDir, moved };
}

function main() {
  const { projectRoot, retentionDays, nowMs } = parseArgs(process.argv);
  const stateDir = join(projectRoot, '.understand-anything');

  mkdirSync(stateDir, { recursive: true });

  const purged = purgeExpiredTrash(stateDir, nowMs, retentionDays);
  const { trashDir, moved } = moveWorkDirs(stateDir, nowMs);

  const movedNames = moved.map((item) => item.name).join(', ') || 'none';
  const trashMessage = trashDir ? ` into ${trashDir}` : '';
  process.stdout.write(
    `Cleanup complete: moved ${movedNames}${trashMessage}; ` +
    `purged ${purged.length} expired trash director${purged.length === 1 ? 'y' : 'ies'}.\n`,
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Cleanup failed: ${message}\n`);
  process.exit(1);
}
