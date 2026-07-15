import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
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
  'code',
  'config',
  'docs',
  'infra',
  'data',
  'script',
  'markup',
]);

function isReservedDataPath(path) {
  if (typeof path !== 'string') return false;
  const [rootSegment] = path.split('/', 1);
  const comparable = process.platform === 'win32'
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

function writeSummary(message) {
  process.stderr.write(message);
}

export function validateInventory(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('inventory must be a plain object');
  }
  if (value.scriptCompleted !== true) {
    throw new Error('inventory scriptCompleted must be true');
  }
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
    if (
      entry === null
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      throw new Error('inventory file entry must be a plain object');
    }

    const path = entry.path;
    const reserved = isReservedDataPath(path);
    const normalized = typeof path === 'string' && posix.normalize(path) === path;
    if (
      typeof path !== 'string'
      || path.length === 0
      || path.includes('\\')
      || path.includes('\0')
      || path.endsWith('/')
      || posix.isAbsolute(path)
      || win32.isAbsolute(path)
      || /^[A-Za-z]:/.test(path)
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

function validateInventoryFilesOnDisk(projectRoot, inventory, resolveRealpath) {
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
    ) {
      throw new Error(
        `refresh-scan-result: inventory path is outside project root: ${entry.path}`,
      );
    }
  }
}

export function validateImportResult(value, filePaths) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('import result must be a plain object');
  }
  if (value.scriptCompleted !== true) {
    throw new Error('import result scriptCompleted must be true');
  }
  if (
    value.importMap === null
    || typeof value.importMap !== 'object'
    || Array.isArray(value.importMap)
    || Object.getPrototypeOf(value.importMap) !== Object.prototype
  ) {
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
    files: inventory.files,
    totalFiles: inventory.totalFiles,
    filteredByIgnore: inventory.filteredByIgnore,
    estimatedComplexity: inventory.estimatedComplexity,
    languages: [...new Set(inventory.files.map(entry => entry.language))]
      .sort((a, b) => a.localeCompare(b)),
    importMap: importResult.importMap,
  };
  delete refreshed.scriptCompleted;
  delete refreshed.stats;
  return refreshed;
}

export function main(projectRootArg = process.argv[2], overrides = {}) {
  if (!projectRootArg) {
    throw new Error('Usage: node refresh-scan-result.mjs <project-root>');
  }

  const projectRoot = resolve(projectRootArg);
  const uaDir = resolveUaDir(projectRoot);
  const intermediateDir = join(uaDir, 'intermediate');
  const scanResultPath = join(intermediateDir, 'scan-result.json');

  let previousRaw;
  try {
    previousRaw = readFileSync(scanResultPath, 'utf8');
  } catch (error) {
    throw new Error(`refresh-scan-result: scan-result missing or unreadable: ${error.message}`);
  }

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

  const ops = {
    runBundledScript,
    writeFileSync,
    renameSync,
    rmSync,
    realpathSync,
    writeSummary,
    ...overrides,
  };
  const suffix = randomBytes(8).toString('hex');
  const tmpDir = join(uaDir, 'tmp');
  const inventoryPath = join(tmpDir, `refresh-inventory-${process.pid}-${suffix}.json`);
  const importInputPath = join(tmpDir, `refresh-import-input-${process.pid}-${suffix}.json`);
  const importOutputPath = join(tmpDir, `refresh-import-output-${process.pid}-${suffix}.json`);
  const candidatePath = join(
    intermediateDir,
    `scan-result.json.refresh-${process.pid}-${suffix}.tmp`,
  );
  const workTemps = [inventoryPath, importInputPath, importOutputPath];
  const pendingOwnedTemps = new Set([...workTemps, candidatePath]);

  function removeOwnedTemp(tempPath) {
    ops.rmSync(tempPath, { force: true });
    pendingOwnedTemps.delete(tempPath);
  }

  mkdirSync(tmpDir, { recursive: true });
  try {
    ops.runBundledScript(SCAN_SCRIPT, [projectRoot, inventoryPath], 'scan-project');

    let inventory;
    try {
      inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    } catch (error) {
      throw new Error(`refresh-scan-result: inventory JSON parse failed: ${error.message}`);
    }
    validateInventory(inventory);
    validateInventoryFilesOnDisk(projectRoot, inventory, ops.realpathSync);

    ops.writeFileSync(importInputPath, `${JSON.stringify({
      projectRoot,
      files: inventory.files,
    }, null, 2)}\n`, 'utf8');
    ops.runBundledScript(
      IMPORT_SCRIPT,
      [importInputPath, importOutputPath],
      'extract-import-map',
    );

    let importResult;
    try {
      importResult = JSON.parse(readFileSync(importOutputPath, 'utf8'));
    } catch (error) {
      throw new Error(`refresh-scan-result: import result JSON parse failed: ${error.message}`);
    }
    const filePaths = inventory.files.map(entry => entry.path);
    validateImportResult(importResult, filePaths);

    const candidate = buildRefreshedScan(previous, inventory, importResult);
    ops.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');

    let writtenCandidate;
    try {
      writtenCandidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
    } catch (error) {
      throw new Error(`refresh-scan-result: candidate JSON parse failed: ${error.message}`);
    }
    validateInventory({
      scriptCompleted: true,
      files: writtenCandidate.files,
      totalFiles: writtenCandidate.totalFiles,
      filteredByIgnore: writtenCandidate.filteredByIgnore,
      estimatedComplexity: writtenCandidate.estimatedComplexity,
    });
    validateImportResult({
      scriptCompleted: true,
      importMap: writtenCandidate.importMap,
    }, writtenCandidate.files.map(entry => entry.path));

    const oldPaths = new Set(previous.files.map(entry => entry?.path).filter(path => typeof path === 'string'));
    const newPaths = new Set(filePaths);
    let added = 0;
    let removed = 0;
    for (const path of newPaths) if (!oldPaths.has(path)) added += 1;
    for (const path of oldPaths) if (!newPaths.has(path)) removed += 1;
    const importEdges = Object.values(importResult.importMap)
      .reduce((total, targets) => total + targets.length, 0);

    for (const tempPath of workTemps) removeOwnedTemp(tempPath);
    ops.renameSync(candidatePath, scanResultPath);
    pendingOwnedTemps.delete(candidatePath);
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
        ops.rmSync(tempPath, { force: true });
        pendingOwnedTemps.delete(tempPath);
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
