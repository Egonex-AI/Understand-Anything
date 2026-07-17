import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { resolveUaDir } = core;
const SCAN_SCRIPT = join(__dirname, 'scan-project.mjs');
const IMPORT_SCRIPT = join(__dirname, 'extract-import-map.mjs');
const COMPLEXITIES = new Set(['small', 'moderate', 'large', 'very-large']);
const FILE_CATEGORIES = new Set([
  'code', 'config', 'docs', 'infra', 'data', 'script', 'markup',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

const PENDING_JOURNAL_VERSION = 1;
const PENDING_JOURNAL_KEYS = [
  'fromDigest',
  'paths',
  'resultDigest',
  'version',
];
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function inventoryPathDigest(paths) {
  return createHash('sha256')
    .update(JSON.stringify([...paths].sort()))
    .digest('hex');
}

function isValidPendingPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.includes('\0')
    && !path.endsWith('/')
    && !posix.isAbsolute(path)
    && (
      process.platform !== 'win32'
      || (!path.includes('\\') && !win32.isAbsolute(path) && !/^[A-Za-z]:/.test(path))
    )
    && path !== '.'
    && !path.startsWith('../')
    && posix.normalize(path) === path
    && !isReservedDataPath(path);
}

export function validatePendingInventoryJournal(value) {
  const keys = isPlainObject(value) ? Object.keys(value).sort() : [];
  const paths = value?.paths;
  if (
    !isPlainObject(value)
    || keys.length !== PENDING_JOURNAL_KEYS.length
    || keys.some((key, index) => key !== PENDING_JOURNAL_KEYS[index])
    || value.version !== PENDING_JOURNAL_VERSION
    || typeof value.fromDigest !== 'string'
    || !SHA256_HEX.test(value.fromDigest)
    || typeof value.resultDigest !== 'string'
    || !SHA256_HEX.test(value.resultDigest)
    || !Array.isArray(paths)
    || paths.some(path => !isValidPendingPath(path))
    || paths.some((path, index) => index > 0 && paths[index - 1] >= path)
  ) {
    throw new Error('pending inventory journal is invalid');
  }
  return value;
}

function isPathWithinProject(realProjectRoot, realPath) {
  const fromRoot = relative(realProjectRoot, realPath);
  return fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
    && (process.platform !== 'win32' || !win32.isAbsolute(fromRoot));
}

function resolveRealProjectRoot(projectRoot, ops) {
  try {
    return ops.realpathSync(projectRoot);
  } catch {
    throw new Error('refresh-scan-result: project root is unsafe');
  }
}

function assertSafeDirectory(trustedParentReal, path, ops, label) {
  let directoryStat;
  let realPath;
  try {
    directoryStat = ops.lstatSync(path);
    realPath = ops.realpathSync(path);
  } catch {
    throw new Error(`${label} is unsafe`);
  }
  if (
    directoryStat.isSymbolicLink()
    || !directoryStat.isDirectory()
    || !isPathWithinProject(trustedParentReal, realPath)
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return realPath;
}

function assertSafeRegularFileWithin(
  trustedParentReal,
  path,
  ops,
  label,
  { allowMissing = false } = {},
) {
  let fileStat;
  let realPath;
  try {
    fileStat = ops.lstatSync(path);
    realPath = ops.realpathSync(path);
  } catch (error) {
    if (allowMissing && (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')) {
      return null;
    }
    throw new Error(`${label} is unsafe`);
  }
  if (
    fileStat.isSymbolicLink()
    || !fileStat.isFile()
    || !isPathWithinProject(trustedParentReal, realPath)
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return realPath;
}

export function readPendingInventoryJournal(
  projectRoot,
  uaDir,
  currentInventoryPaths,
  overrides = {},
) {
  const journalPath = join(uaDir, 'intermediate', 'pending-inventory-changes.json');
  const ops = { lstatSync, readFileSync, realpathSync, ...overrides };
  const projectRootReal = resolveRealProjectRoot(projectRoot, ops);
  const uaDirReal = assertSafeDirectory(
    projectRootReal,
    uaDir,
    ops,
    'project data directory',
  );
  const intermediateReal = assertSafeDirectory(
    uaDirReal,
    join(uaDir, 'intermediate'),
    ops,
    'intermediate directory',
  );
  const journalReal = assertSafeRegularFileWithin(
    intermediateReal,
    journalPath,
    ops,
    'pending inventory journal',
    { allowMissing: true },
  );
  if (journalReal === null) return null;

  let journal;
  try {
    journal = JSON.parse(ops.readFileSync(journalPath, 'utf8'));
  } catch {
    throw new Error('pending inventory journal is invalid');
  }
  validatePendingInventoryJournal(journal);

  const currentDigest = inventoryPathDigest(currentInventoryPaths);
  if (
    journal.fromDigest !== currentDigest
    && journal.resultDigest !== currentDigest
  ) {
    throw new Error('pending inventory journal does not match current inventory');
  }
  return journal;
}

function validateExcludePatterns(value, label, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return [];
  if (
    !Array.isArray(value)
    || value.some(pattern => (
      typeof pattern !== 'string'
      || pattern.length === 0
      || pattern.trim() !== pattern
      || pattern.includes(',')
    ))
  ) {
    throw new Error(
      `${label} excludePatterns must be an array of normalized non-empty strings`,
    );
  }
  return value;
}

function readJson(path, label, read = readFileSync) {
  try {
    return JSON.parse(read(path, 'utf8'));
  } catch (error) {
    throw new Error(`refresh-scan-result: ${label} JSON parse failed: ${error.message}`);
  }
}

function isReservedDataPath(path, platform = process.platform) {
  if (typeof path !== 'string') return false;
  const [rootSegment] = path.split('/', 1);
  const comparable = platform === 'win32'
    ? rootSegment.toLowerCase()
    : rootSegment;
  return comparable === '.ua' || comparable === '.understand-anything';
}

export function runBundledScript(scriptPath, args, label) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `status ${result.status}`;
    throw new Error(`${label} exited with ${outcome}`);
  }
}

export function validateInventory(value, platform = process.platform) {
  if (!isPlainObject(value)) {
    throw new Error('inventory must be a plain object');
  }
  if (value.scriptCompleted !== true) {
    throw new Error('inventory scriptCompleted must be true');
  }
  if (value.degraded !== false) {
    throw new Error('inventory degraded must be the boolean false');
  }
  validateExcludePatterns(value.excludePatterns, 'inventory');
  if (!Array.isArray(value.files)) {
    throw new Error('inventory files must be an array');
  }
  if (!Number.isInteger(value.totalFiles) || value.totalFiles < 0) {
    throw new Error('inventory totalFiles must be a non-negative integer');
  }
  if (value.totalFiles !== value.files.length) {
    throw new Error(
      `inventory totalFiles (${value.totalFiles}) does not match files.length (${value.files.length})`,
    );
  }
  if (!Number.isInteger(value.filteredByIgnore) || value.filteredByIgnore < 0) {
    throw new Error('inventory filteredByIgnore must be a non-negative integer');
  }
  if (!COMPLEXITIES.has(value.estimatedComplexity)) {
    throw new Error('inventory estimatedComplexity is invalid');
  }

  const paths = new Set();
  for (const entry of value.files) {
    if (!isPlainObject(entry)) {
      throw new Error('inventory file entry must be a plain object');
    }

    const path = entry.path;
    const reserved = isReservedDataPath(path, platform);
    const normalized = typeof path === 'string' && posix.normalize(path) === path;
    if (
      typeof path !== 'string'
      || path.length === 0
      || path.includes('\0')
      || path.endsWith('/')
      || posix.isAbsolute(path)
      || (
        platform === 'win32'
        && (path.includes('\\') || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path))
      )
      || path === '.'
      || path.startsWith('../')
      || !normalized
    ) {
      throw new Error(`inventory path must be a normalized relative POSIX path: ${path}`);
    }
    if (reserved) {
      throw new Error(`inventory path uses a reserved data path: ${path}`);
    }
    if (paths.has(path)) {
      throw new Error(`duplicate inventory path: ${path}`);
    }
    if (typeof entry.language !== 'string' || entry.language.length === 0) {
      throw new Error(`inventory language must be a non-empty string: ${path}`);
    }
    if (!Number.isInteger(entry.sizeLines) || entry.sizeLines < 0) {
      throw new Error(`inventory sizeLines must be a non-negative integer: ${path}`);
    }
    if (!FILE_CATEGORIES.has(entry.fileCategory)) {
      throw new Error(`inventory fileCategory is invalid: ${path}`);
    }
    paths.add(path);
  }

  return value;
}

function validateInventoryFilesOnDisk(projectRoot, inventory, resolveRealpath, stat) {
  let projectRootReal;
  try {
    projectRootReal = resolveRealpath(projectRoot);
  } catch {
    throw new Error('refresh-scan-result: project root is unavailable or unsafe');
  }

  for (const entry of inventory.files) {
    let candidateReal;
    try {
      candidateReal = resolveRealpath(join(projectRoot, entry.path));
      if (!stat(candidateReal).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(
        `refresh-scan-result: inventory path is unavailable or unsafe: ${entry.path}`,
      );
    }

    const fromRoot = relative(projectRootReal, candidateReal);
    if (
      fromRoot === '..'
      || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot)
      || (process.platform === 'win32' && win32.isAbsolute(fromRoot))
    ) {
      throw new Error(
        `refresh-scan-result: inventory path is outside project root: ${entry.path}`,
      );
    }
    if (isReservedDataPath(fromRoot.split(sep).join('/'))) {
      throw new Error(
        `refresh-scan-result: inventory path is inside a reserved data root: ${entry.path}`,
      );
    }
  }
}

export function validateImportResult(value, filePaths) {
  if (!isPlainObject(value)) {
    throw new Error('import result must be a plain object');
  }
  if (value.scriptCompleted !== true) {
    throw new Error('import result scriptCompleted must be true');
  }
  if (value.degraded !== false) {
    throw new Error('import result degraded must be the boolean false');
  }
  if (!isPlainObject(value.importMap)) {
    throw new Error('importMap must be a plain object');
  }

  const expected = new Set(filePaths);
  const actual = new Set(Object.keys(value.importMap));
  for (const path of expected) {
    if (!actual.has(path)) throw new Error(`missing importMap key: ${path}`);
  }
  for (const path of actual) {
    if (!expected.has(path)) throw new Error(`extra importMap key: ${path}`);
  }

  for (const [source, targets] of Object.entries(value.importMap)) {
    if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) {
      throw new Error(`importMap value must be a string array: ${source}`);
    }
    const seen = new Set();
    for (const target of targets) {
      if (!expected.has(target)) {
        throw new Error(`internal target is not in inventory: ${target}`);
      }
      if (seen.has(target)) {
        throw new Error(`duplicate internal target for ${source}: ${target}`);
      }
      seen.add(target);
    }
  }

  return value;
}

export function buildRefreshedScan(previous, inventory, importResult) {
  const refreshed = {
    ...previous,
    excludePatterns: inventory.excludePatterns,
    files: inventory.files,
    totalFiles: inventory.totalFiles,
    filteredByIgnore: inventory.filteredByIgnore,
    estimatedComplexity: inventory.estimatedComplexity,
    languages: [...new Set(inventory.files.map(entry => entry.language))]
      .sort((a, b) => a.localeCompare(b)),
    importMap: importResult.importMap,
  };
  delete refreshed.scriptCompleted;
  delete refreshed.degraded;
  delete refreshed.stats;
  return refreshed;
}

function sameCanonicalPath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertRefreshState(state, { requireTmp = true } = {}) {
  const currentProjectRootReal = resolveRealProjectRoot(state.projectRoot, state.ops);
  if (!sameCanonicalPath(currentProjectRootReal, state.projectRootReal)) {
    throw new Error('refresh-scan-result: project root is unsafe');
  }
  const uaDirReal = assertSafeDirectory(
    state.projectRootReal,
    state.uaDir,
    state.ops,
    'project data directory',
  );
  const intermediateReal = assertSafeDirectory(
    uaDirReal,
    state.intermediateDir,
    state.ops,
    'intermediate directory',
  );
  const tmpReal = requireTmp
    ? assertSafeDirectory(uaDirReal, state.tmpDir, state.ops, 'tmp directory')
    : null;
  assertSafeRegularFileWithin(
    intermediateReal,
    state.scanResultPath,
    state.ops,
    'refresh-scan-result: scan-result missing or unsafe',
  );
  assertSafeRegularFileWithin(
    intermediateReal,
    state.pendingJournalPath,
    state.ops,
    'pending inventory journal',
    { allowMissing: true },
  );
  return { uaDirReal, intermediateReal, tmpReal };
}

function ensureSafeTmpDirectory(state) {
  assertRefreshState(state, { requireTmp: false });
  try {
    state.ops.lstatSync(state.tmpDir);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      throw new Error('tmp directory is unsafe');
    }
    try {
      state.ops.mkdirSync(state.tmpDir);
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError;
    }
  }
  return assertRefreshState(state);
}

function assertOriginalScanUnchanged(state, previousRaw) {
  assertRefreshState(state);
  let currentRaw;
  try {
    currentRaw = state.ops.readFileSync(state.scanResultPath, 'utf8');
  } catch {
    throw new Error('refresh-scan-result: scan-result is unsafe');
  }
  if (currentRaw !== previousRaw) {
    throw new Error('refresh-scan-result: scan-result changed during refresh');
  }
}

export function main(projectRootArg = process.argv[2], overrides = {}) {
  if (!projectRootArg) {
    throw new Error('Usage: node refresh-scan-result.mjs <project-root>');
  }

  const ops = {
    mkdirSync,
    lstatSync,
    readFileSync,
    runBundledScript,
    writeFileSync,
    renameSync,
    rmSync,
    realpathSync,
    statSync,
    writeSummary: message => process.stderr.write(message),
    ...overrides,
  };
  const projectRoot = resolve(projectRootArg);
  const projectRootReal = resolveRealProjectRoot(projectRoot, ops);
  const uaDir = resolveUaDir(projectRoot);
  const intermediateDir = join(uaDir, 'intermediate');
  const tmpDir = join(uaDir, 'tmp');
  const scanResultPath = join(intermediateDir, 'scan-result.json');
  const pendingJournalPath = join(
    intermediateDir,
    'pending-inventory-changes.json',
  );
  const state = {
    projectRoot,
    projectRootReal,
    uaDir,
    intermediateDir,
    tmpDir,
    scanResultPath,
    pendingJournalPath,
    ops,
  };

  assertRefreshState(state, { requireTmp: false });
  let previousRaw;
  try {
    previousRaw = ops.readFileSync(scanResultPath, 'utf8');
  } catch (error) {
    throw new Error(`refresh-scan-result: scan-result missing or unreadable: ${error.message}`);
  }
  assertRefreshState(state, { requireTmp: false });

  let previous;
  try {
    previous = JSON.parse(previousRaw);
  } catch (error) {
    throw new Error(`refresh-scan-result: scan-result JSON parse failed: ${error.message}`);
  }
  if (
    previous === null
    || typeof previous !== 'object'
    || Array.isArray(previous)
    || !Array.isArray(previous.files)
  ) {
    throw new Error('refresh-scan-result: old scan-result must be an object with files array');
  }
  const excludePatterns = validateExcludePatterns(
    previous.excludePatterns,
    'retained scan',
    { allowMissing: true },
  );
  const previousPaths = previous.files
    .map(entry => entry?.path)
    .filter(path => typeof path === 'string');
  const priorJournal = readPendingInventoryJournal(
    projectRoot,
    uaDir,
    previousPaths,
    ops,
  );
  const suffix = randomBytes(8).toString('hex');
  const inventoryPath = join(tmpDir, `refresh-inventory-${process.pid}-${suffix}.json`);
  const importInputPath = join(tmpDir, `refresh-import-input-${process.pid}-${suffix}.json`);
  const importOutputPath = join(tmpDir, `refresh-import-output-${process.pid}-${suffix}.json`);
  const candidatePath = join(
    intermediateDir,
    `scan-result.json.refresh-${process.pid}-${suffix}.tmp`,
  );
  const journalCandidatePath = join(
    intermediateDir,
    `pending-inventory-changes.json.refresh-${process.pid}-${suffix}.tmp`,
  );
  const workTemps = [inventoryPath, importInputPath, importOutputPath];
  const pendingOwnedTemps = new Set([
    ...workTemps,
    candidatePath,
    journalCandidatePath,
  ]);

  function removeOwnedTemp(tempPath) {
    const safeState = assertRefreshState(state);
    const trustedParentReal = dirname(tempPath) === tmpDir
      ? safeState.tmpReal
      : safeState.intermediateReal;
    assertSafeRegularFileWithin(
      trustedParentReal,
      tempPath,
      ops,
      'refresh temporary file',
    );
    ops.rmSync(tempPath, { force: true });
    pendingOwnedTemps.delete(tempPath);
  }

  ensureSafeTmpDirectory(state);
  try {
    const scanArgs = [projectRoot, inventoryPath];
    if (excludePatterns.length > 0) {
      scanArgs.push('--exclude', excludePatterns.join(','));
    }
    assertRefreshState(state);
    ops.runBundledScript(SCAN_SCRIPT, scanArgs, 'scan-project');

    let safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.tmpReal,
      inventoryPath,
      ops,
      'refresh inventory output',
    );
    const inventory = readJson(inventoryPath, 'inventory', ops.readFileSync);
    validateInventory(inventory);
    if (
      inventory.excludePatterns.length !== excludePatterns.length
      || inventory.excludePatterns.some((pattern, index) => pattern !== excludePatterns[index])
    ) {
      throw new Error('inventory excludePatterns must match retained scan');
    }
    validateInventoryFilesOnDisk(projectRoot, inventory, ops.realpathSync, ops.statSync);

    assertRefreshState(state);
    ops.writeFileSync(importInputPath, `${JSON.stringify({
      projectRoot,
      files: inventory.files,
    }, null, 2)}\n`, 'utf8');
    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.tmpReal,
      importInputPath,
      ops,
      'refresh import input',
    );
    assertRefreshState(state);
    ops.runBundledScript(
      IMPORT_SCRIPT,
      [importInputPath, importOutputPath],
      'extract-import-map',
    );

    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.tmpReal,
      importOutputPath,
      ops,
      'refresh import output',
    );
    const importResult = readJson(importOutputPath, 'import result', ops.readFileSync);
    const filePaths = inventory.files.map(entry => entry.path);
    validateImportResult(importResult, filePaths);

    assertOriginalScanUnchanged(state, previousRaw);
    const candidate = buildRefreshedScan(previous, inventory, importResult);
    assertRefreshState(state);
    ops.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');

    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.intermediateReal,
      candidatePath,
      ops,
      'refresh scan candidate',
    );
    const writtenCandidate = readJson(candidatePath, 'candidate', ops.readFileSync);
    validateInventory({
      scriptCompleted: true,
      degraded: false,
      excludePatterns: writtenCandidate.excludePatterns,
      files: writtenCandidate.files,
      totalFiles: writtenCandidate.totalFiles,
      filteredByIgnore: writtenCandidate.filteredByIgnore,
      estimatedComplexity: writtenCandidate.estimatedComplexity,
    });
    validateImportResult({
      scriptCompleted: true,
      degraded: false,
      importMap: writtenCandidate.importMap,
    }, writtenCandidate.files.map(entry => entry.path));
    validateInventoryFilesOnDisk(projectRoot, writtenCandidate, ops.realpathSync, ops.statSync);

    const oldPaths = new Set(previousPaths);
    const newPaths = new Set(filePaths);
    const pendingPaths = new Set(priorJournal?.paths ?? []);
    let added = 0;
    let removed = 0;
    for (const path of newPaths) {
      if (!oldPaths.has(path)) {
        added += 1;
        pendingPaths.add(path);
      }
    }
    for (const path of oldPaths) {
      if (!newPaths.has(path)) {
        removed += 1;
        pendingPaths.add(path);
      }
    }
    const importEdges = Object.values(importResult.importMap)
      .reduce((total, targets) => total + targets.length, 0);

    for (const tempPath of workTemps) removeOwnedTemp(tempPath);
    assertOriginalScanUnchanged(state, previousRaw);
    const pendingJournal = {
      version: PENDING_JOURNAL_VERSION,
      fromDigest: inventoryPathDigest(oldPaths),
      resultDigest: inventoryPathDigest(newPaths),
      paths: [...pendingPaths].sort(),
    };
    validatePendingInventoryJournal(pendingJournal);
    assertRefreshState(state);
    ops.writeFileSync(
      journalCandidatePath,
      `${JSON.stringify(pendingJournal, null, 2)}\n`,
      'utf8',
    );
    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.intermediateReal,
      journalCandidatePath,
      ops,
      'pending inventory journal candidate',
    );
    let writtenJournal;
    try {
      writtenJournal = JSON.parse(ops.readFileSync(journalCandidatePath, 'utf8'));
    } catch {
      throw new Error('pending inventory journal is invalid');
    }
    validatePendingInventoryJournal(writtenJournal);
    if (JSON.stringify(writtenJournal) !== JSON.stringify(pendingJournal)) {
      throw new Error('pending inventory journal is invalid');
    }
    assertOriginalScanUnchanged(state, previousRaw);
    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.intermediateReal,
      candidatePath,
      ops,
      'refresh scan candidate',
    );
    assertSafeRegularFileWithin(
      safeState.intermediateReal,
      journalCandidatePath,
      ops,
      'pending inventory journal candidate',
    );
    ops.renameSync(journalCandidatePath, pendingJournalPath);
    pendingOwnedTemps.delete(journalCandidatePath);
    assertOriginalScanUnchanged(state, previousRaw);
    safeState = assertRefreshState(state);
    assertSafeRegularFileWithin(
      safeState.intermediateReal,
      candidatePath,
      ops,
      'refresh scan candidate',
    );
    ops.renameSync(candidatePath, scanResultPath);
    pendingOwnedTemps.delete(candidatePath);
    assertRefreshState(state);
    try {
      ops.writeSummary(
        `refresh-scan-result: files=${filePaths.length} added=${added} `
        + `removed=${removed} importEdges=${importEdges}\n`,
      );
    } catch {
      // The replacement is already committed; diagnostics must remain non-fatal.
    }
  } finally {
    for (const tempPath of pendingOwnedTemps) {
      try {
        removeOwnedTemp(tempPath);
      } catch {
        // Preserve the original failure while making a best-effort cleanup pass.
      }
    }
  }
}

let isCliEntry = false;
if (process.argv[1]) {
  try {
    isCliEntry = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    isCliEntry = false;
  }
}

if (isCliEntry) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`refresh-scan-result.mjs failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
