import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANALYSIS_PLAN_SCHEMA_VERSION = '1.0.0';
export const ANALYSIS_PLAN_ESTIMATOR_VERSION = 'known-input-v1';
export const ANALYSIS_PLAN_SCHEMA_URL =
  'https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/' +
  'understand-anything-plugin/skills/understand/schemas/analysis-plan-1.0.0.schema.json';

export const RUN_REPORT_SCHEMA_VERSION = '1.0.0';
export const RUN_REPORT_SCHEMA_URL =
  'https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/' +
  'understand-anything-plugin/skills/understand/schemas/run-report-1.0.0.schema.json';

export function resolveUaDir(projectRoot) {
  const root = resolve(projectRoot);
  const legacy = join(root, '.understand-anything');
  return existsSync(legacy) ? legacy : join(root, '.ua');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const input = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(input).digest('hex');
}

export function distribution(values) {
  if (values.length === 0) {
    return { min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return {
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1),
    mean: Math.round((sorted.reduce((sum, value) => sum + value, 0) / sorted.length) * 100) / 100,
  };
}

export function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isPathInsideOrEqual(rootPath, candidatePath) {
  const relationship = relative(resolve(rootPath), resolve(candidatePath));
  return (
    relationship === '' ||
    (relationship !== '..' &&
      !relationship.startsWith(`..${sep}`) &&
      !isAbsolute(relationship))
  );
}

export function resolveSafeProjectFile(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    return null;
  }
  const root = resolve(projectRoot);
  const candidate = resolve(root, ...relativePath.replaceAll('\\', '/').split('/'));
  if (!isPathInsideOrEqual(root, candidate)) return null;
  if (!existsSync(candidate)) return candidate;

  try {
    const physicalRoot = realpathSync.native?.(root) ?? realpathSync(root);
    const physicalCandidate = realpathSync.native?.(candidate) ?? realpathSync(candidate);
    return isPathInsideOrEqual(physicalRoot, physicalCandidate) ? candidate : null;
  } catch {
    return null;
  }
}

function hasPathControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export function normalizeRelativeScope(scope) {
  if (
    typeof scope !== 'string' ||
    scope.trim().length === 0 ||
    Buffer.byteLength(scope) > 1024 ||
    isAbsolute(scope) ||
    /^[A-Za-z]:/.test(scope.trim()) ||
    hasPathControlCharacter(scope)
  ) {
    throw new Error('scope must be a non-empty relative path of at most 1024 bytes');
  }
  const normalized = scope.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  const resolvedFromSentinel = resolve('/scope-root', ...normalized.split('/'));
  if (!isPathInsideOrEqual('/scope-root', resolvedFromSentinel)) {
    throw new Error('scope must stay within the project root');
  }
  const relativeScope = relative('/scope-root', resolvedFromSentinel).replaceAll('\\', '/');
  return relativeScope === '' ? '.' : relativeScope;
}

export function isCliEntry(moduleUrl, argvPath) {
  if (!argvPath) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(moduleUrl));
    const invokedPath = realpathSync(resolve(argvPath));
    return process.platform === 'win32'
      ? modulePath.toLowerCase() === invokedPath.toLowerCase()
      : modulePath === invokedPath;
  } catch {
    return fileURLToPath(moduleUrl) === resolve(argvPath);
  }
}

export function atomicWriteJson(path, value, operations = {}) {
  const makeDir = operations.mkdirSync ?? mkdirSync;
  const write = operations.writeFileSync ?? writeFileSync;
  const rename = operations.renameSync ?? renameSync;
  const remove = operations.rmSync ?? rmSync;
  const id = operations.randomId?.() ?? `${process.pid}-${randomUUID()}`;
  const target = resolve(path);
  const temp = join(dirname(target), `.${basename(target)}.${id}.tmp`);
  const backup = join(dirname(target), `.${basename(target)}.${id}.bak`);

  makeDir(dirname(target), { recursive: true });
  if (existsSync(target) && !lstatSync(target).isFile()) {
    throw new Error(`JSON output target is not a regular file: ${target}`);
  }
  let backupCreated = false;
  try {
    write(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const hadTarget = existsSync(target);
    if (hadTarget) {
      rename(target, backup);
      backupCreated = true;
    }
    try {
      rename(temp, target);
    } catch (error) {
      if (backupCreated && existsSync(backup)) {
        try {
          rename(backup, target);
          backupCreated = false;
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `Unable to replace ${target}; previous contents remain at ${backup}`,
          );
        }
      }
      throw error;
    }
    if (backupCreated) {
      try {
        remove(backup, { force: true });
        backupCreated = false;
      } catch {
        // Delivery succeeded. A leftover backup is safer than failing the run.
      }
    }
  } catch (error) {
    try {
      remove(temp, { force: true });
    } catch {
      // Preserve the primary write error.
    }
    throw error;
  }
}

export function withFileLock(path, callback, operations = {}) {
  const open = operations.openSync ?? openSync;
  const close = operations.closeSync ?? closeSync;
  const write = operations.writeFileSync ?? writeFileSync;
  const remove = operations.rmSync ?? rmSync;
  const stat = operations.statSync ?? statSync;
  const now = operations.now ?? Date.now;
  const lockPath = `${resolve(path)}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  let descriptor;
  let ownsLock = false;
  const openLock = () => {
    const opened = open(lockPath, 'wx', 0o600);
    ownsLock = true;
    return opened;
  };
  try {
    try {
      descriptor = openLock();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = now() - stat(lockPath).mtimeMs > 5 * 60 * 1000;
      } catch {
        // A disappearing lock is retried once below.
        stale = true;
      }
      if (!stale) throw error;
      remove(lockPath, { force: true });
      descriptor = openLock();
    }
    write(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch {
        // Preserve the lock acquisition error.
      }
    }
    if (ownsLock) {
      try {
        remove(lockPath, { force: true });
      } catch {
        // Preserve the lock acquisition error.
      }
    }
    throw new Error(`Unable to acquire report lock ${lockPath}: ${error.message}`);
  }

  try {
    return callback();
  } finally {
    try {
      close(descriptor);
    } finally {
      if (ownsLock) remove(lockPath, { force: true });
    }
  }
}

export function terminalText(value, maxBytes = 256) {
  const bounded = boundedText(value, maxBytes) ?? '';
  return [...bounded]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      const isTerminalControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      if (!isTerminalControl) return character;
      if (character === '\n') return '\\n';
      if (character === '\r') return '\\r';
      if (character === '\t') return '\\t';
      return `\\u${codePoint.toString(16).padStart(4, '0')}`;
    })
    .join('');
}

export function boundedText(value, maxBytes = 4096) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replaceAll('\0', '').trim();
  if (Buffer.byteLength(normalized) <= maxBytes) return normalized;
  let end = Math.min(normalized.length, maxBytes);
  while (end > 0 && Buffer.byteLength(normalized.slice(0, end)) > maxBytes - 3) end -= 1;
  return `${normalized.slice(0, end)}...`;
}
