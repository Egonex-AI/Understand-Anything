import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync as realRenameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand',
);
const REFRESH_SCRIPT = join(SKILL_DIR, 'refresh-scan-result.mjs');
const SCAN_SCRIPT = join(SKILL_DIR, 'scan-project.mjs');
const IMPORT_SCRIPT = join(SKILL_DIR, 'extract-import-map.mjs');

const tempRoots = [];

function makeTempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeTree(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, 'utf8');
  }
}

function file(path, language = 'typescript', fileCategory = 'code') {
  return { path, language, sizeLines: 1, fileCategory };
}

function previousScan(files = [file('src/existing.ts')]) {
  return {
    name: 'preserved-name',
    description: 'preserved description',
    languages: ['stale-language'],
    frameworks: ['React', 'Express'],
    narrativeMetadata: { owner: 'kept', nested: true },
    files,
    totalFiles: files.length,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
    importMap: Object.fromEntries(files.map(entry => [entry.path, []])),
  };
}

function inventory(files, totalFiles = files.length) {
  return {
    scriptCompleted: true,
    files,
    totalFiles,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
  };
}

function setupProject({
  uaDirName = '.ua',
  diskFiles,
  previous = previousScan(),
  ignore,
} = {}) {
  const root = makeTempRoot('ua-refresh-test-');
  writeTree(root, diskFiles ?? {
    'src/existing.ts': 'export const existing = 1;\n',
    'src/added.ts': "import { existing } from './existing';\nexport { existing };\n",
  });

  const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  if (init.status !== 0) {
    throw new Error(`fixture git init failed: ${init.stderr}`);
  }

  const uaDir = join(root, uaDirName);
  const intermediateDir = join(uaDir, 'intermediate');
  const tmpDir = join(uaDir, 'tmp');
  mkdirSync(intermediateDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  if (ignore !== undefined) {
    writeFileSync(join(uaDir, '.understandignore'), ignore, 'utf8');
  }

  const scanPath = join(intermediateDir, 'scan-result.json');
  writeFileSync(scanPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
  return { root, uaDir, intermediateDir, tmpDir, scanPath, previous };
}

function runRefresh(projectRoot) {
  return spawnSync(process.execPath, [REFRESH_SCRIPT, projectRoot], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertNoOwnedTemps(project, sentinel = null) {
  const tmpEntries = existsSync(project.tmpDir) ? readdirSync(project.tmpDir) : [];
  expect(tmpEntries).toEqual(sentinel ? [sentinel] : []);
  const candidatePrefix = `${basename(project.scanPath)}.refresh-`;
  expect(readdirSync(project.intermediateDir).filter(name => name.startsWith(candidatePrefix))).toEqual([]);
}

async function loadRefreshModule() {
  return import(pathToFileURL(REFRESH_SCRIPT).href);
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('refresh-scan-result.mjs fixtures', () => {
  it('runs the existing scanner and import extractor before the refresh helper exists', () => {
    const project = setupProject();
    const outputDir = makeTempRoot('ua-refresh-prereq-');
    const inventoryPath = join(outputDir, 'inventory.json');
    const inputPath = join(outputDir, 'import-input.json');
    const importPath = join(outputDir, 'imports.json');

    const scan = spawnSync(process.execPath, [SCAN_SCRIPT, project.root, inventoryPath], {
      encoding: 'utf8',
    });
    expect(scan.status).toBe(0);
    const inventory = readJson(inventoryPath);
    writeFileSync(inputPath, JSON.stringify({
      projectRoot: project.root,
      files: inventory.files,
    }), 'utf8');

    const imports = spawnSync(process.execPath, [IMPORT_SCRIPT, inputPath, importPath], {
      encoding: 'utf8',
    });
    expect(imports.status).toBe(0);
    expect(readJson(importPath).importMap['src/added.ts']).toContain('src/existing.ts');
  });
});

describe('refresh-scan-result.mjs CLI integration', () => {
  it('refreshes added and non-TypeScript files while preserving narrative fields', () => {
    const project = setupProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = 1;\n',
        'src/added.ts': "import { existing } from './existing';\nexport { existing };\n",
        'README.md': '# Fixture\n',
        'config/app.yaml': 'enabled: true\n',
        'scripts/tool.py': 'print("ok")\n',
        'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", ',
      },
    });

    const result = runRefresh(project.root);
    expect(result.status, result.stderr).toBe(0);

    const scan = readJson(project.scanPath);
    const paths = scan.files.map(entry => entry.path);
    expect(paths).toContain('src/added.ts');
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(scan.importMap['src/added.ts']).toContain('src/existing.ts');
    expect(Object.keys(scan.importMap).sort()).toEqual([...paths].sort());
    expect(scan.totalFiles).toBe(scan.files.length);
    expect(scan.name).toBe(project.previous.name);
    expect(scan.description).toBe(project.previous.description);
    expect(scan.frameworks).toEqual(project.previous.frameworks);
    expect(scan.narrativeMetadata).toEqual(project.previous.narrativeMetadata);
    expect(scan.languages).toEqual(
      [...new Set(scan.files.map(entry => entry.language))]
        .sort((a, b) => a.localeCompare(b)),
    );
    expect(scan).not.toHaveProperty('scriptCompleted');
    expect(scan).not.toHaveProperty('stats');
    expect(result.stderr).toContain('scan-project: filesScanned=');
    expect(result.stderr).toContain('extract-import-map: filesScanned=');
    expect(result.stderr).toContain('Warning: extract-import-map:');
    expect(result.stderr).toMatch(
      /refresh-scan-result: files=6 added=5 removed=0 importEdges=1/,
    );
    expect(readFileSync(project.scanPath, 'utf8')).toMatch(/\n$/);
    assertNoOwnedTemps(project);
  });

  it('removes renamed-away paths from both files and importMap', () => {
    const old = file('src/old-name.ts');
    const project = setupProject({
      previous: previousScan([old]),
      diskFiles: { 'src/new-name.ts': 'export const renamed = true;\n' },
    });

    const result = runRefresh(project.root);
    expect(result.status, result.stderr).toBe(0);
    const scan = readJson(project.scanPath);
    const paths = scan.files.map(entry => entry.path);
    expect(paths).toContain('src/new-name.ts');
    expect(paths).not.toContain('src/old-name.ts');
    expect(scan.importMap).not.toHaveProperty('src/old-name.ts');
    expect(scan.importMap).toHaveProperty('src/new-name.ts', []);
  });

  it('uses the legacy data directory, honors its ignore file, and preserves unrelated files', () => {
    const project = setupProject({
      uaDirName: '.understand-anything',
      ignore: 'src/ignored.ts\n',
      diskFiles: {
        'src/existing.ts': 'export const existing = 1;\n',
        'src/ignored.ts': 'export const ignored = true;\n',
      },
    });
    writeFileSync(join(project.uaDir, 'knowledge-graph.json'), '{"kept":true}\n', 'utf8');
    writeFileSync(join(project.tmpDir, 'other-process.tmp'), 'keep', 'utf8');

    const result = runRefresh(project.root);
    expect(result.status, result.stderr).toBe(0);
    const scan = readJson(project.scanPath);
    expect(scan.files.map(entry => entry.path)).toEqual(['src/existing.ts']);
    expect(scan.filteredByIgnore).toBe(1);
    expect(existsSync(join(project.root, '.ua'))).toBe(false);
    expect(readFileSync(join(project.uaDir, 'knowledge-graph.json'), 'utf8')).toBe('{"kept":true}\n');
    assertNoOwnedTemps(project, 'other-process.tmp');
  });

  it('is byte-deterministic when the project inventory is unchanged', () => {
    const project = setupProject();
    const first = runRefresh(project.root);
    expect(first.status, first.stderr).toBe(0);
    const firstBytes = readFileSync(project.scanPath);
    const second = runRefresh(project.root);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(project.scanPath)).toEqual(firstBytes);
  }, 15_000);

  it('fails clearly when the old scan is invalid JSON without replacing it', () => {
    const project = setupProject();
    writeFileSync(project.scanPath, '{ invalid old scan', 'utf8');
    const before = readFileSync(project.scanPath);

    const result = runRefresh(project.root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refresh-scan-result.*scan-result.*JSON/i);
    expect(readFileSync(project.scanPath)).toEqual(before);
    assertNoOwnedTemps(project);
  });

  it('fails clearly when the old scan is missing', () => {
    const project = setupProject();
    rmSync(project.scanPath);

    const result = runRefresh(project.root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refresh-scan-result.*scan-result.*missing|unreadable/i);
    expect(existsSync(project.scanPath)).toBe(false);
    assertNoOwnedTemps(project);
  });
});

describe('refresh-scan-result.mjs validation', () => {
  it('rejects duplicate inventory paths and mismatched totalFiles', async () => {
    const { validateInventory } = await loadRefreshModule();
    const validFile = file('src/a.ts');
    expect(() => validateInventory(inventory([validFile, validFile])))
      .toThrow(/duplicate.*src\/a\.ts/i);
    expect(() => validateInventory(inventory([validFile], 2))).toThrow(/totalFiles/i);
  });

  it.each([
    ['missing sizeLines', file('src/a.ts'), entry => { delete entry.sizeLines; }],
    ['negative sizeLines', file('src/a.ts'), entry => { entry.sizeLines = -1; }],
    ['fractional sizeLines', file('src/a.ts'), entry => { entry.sizeLines = 1.5; }],
    ['missing fileCategory', file('src/a.ts'), entry => { delete entry.fileCategory; }],
    ['unknown fileCategory', file('src/a.ts'), entry => { entry.fileCategory = 'binary'; }],
  ])('rejects inventory entries with %s', async (_label, validEntry, mutate) => {
    const { validateInventory } = await loadRefreshModule();
    mutate(validEntry);
    expect(() => validateInventory(inventory([validEntry])))
      .toThrow(/sizeLines|fileCategory/i);
  });

  it.each([
    '/absolute.ts',
    'C:/absolute.ts',
    'src\\windows.ts',
    './src/dot.ts',
    'src/../escape.ts',
    'src//double.ts',
    '.ua/intermediate/leak.json',
    '.understand-anything/tmp/leak.json',
  ])('rejects non-normalized relative POSIX inventory path %s', async invalidPath => {
    const { validateInventory } = await loadRefreshModule();
    expect(() => validateInventory(inventory([file(invalidPath)])))
      .toThrow(/relative POSIX|reserved data path/i);
  });

  it('matches reserved root data directories case-insensitively only on Windows', async () => {
    const { validateInventory } = await loadRefreshModule();
    const uppercaseRootPaths = [
      '.UA/intermediate/leak.json',
      '.UNDERSTAND-ANYTHING/tmp/leak.json',
    ];

    for (const path of uppercaseRootPaths) {
      if (process.platform === 'win32') {
        expect(() => validateInventory(inventory([file(path)])))
          .toThrow(/reserved data path/i);
      } else {
        expect(() => validateInventory(inventory([file(path)]))).not.toThrow();
      }
    }

    expect(() => validateInventory(inventory([
      file('src/.UA/example.ts'),
      file('src/.UNDERSTAND-ANYTHING/example.ts'),
    ]))).not.toThrow();
  });

  it('requires importMap keys to equal inventory paths exactly', async () => {
    const { validateImportResult } = await loadRefreshModule();
    const paths = ['src/a.ts', 'src/b.ts'];
    expect(() => validateImportResult({
      scriptCompleted: true,
      importMap: { 'src/a.ts': [] },
    }, paths)).toThrow(/missing.*src\/b\.ts/i);
    expect(() => validateImportResult({
      scriptCompleted: true,
      importMap: { 'src/a.ts': [], 'src/b.ts': [], 'src/extra.ts': [] },
    }, paths)).toThrow(/extra.*src\/extra\.ts/i);
  });

  it('rejects non-array imports and targets outside the refreshed inventory', async () => {
    const { validateImportResult } = await loadRefreshModule();
    expect(() => validateImportResult({
      scriptCompleted: true,
      importMap: { 'src/a.ts': 'src/b.ts', 'src/b.ts': [] },
    }, ['src/a.ts', 'src/b.ts'])).toThrow(/array/i);
    expect(() => validateImportResult({
      scriptCompleted: true,
      importMap: { 'src/a.ts': ['src/missing.ts'], 'src/b.ts': [] },
    }, ['src/a.ts', 'src/b.ts'])).toThrow(/internal target.*src\/missing\.ts/i);
  });
});

describe('refresh-scan-result.mjs failure protection', () => {
  async function expectProtected(project, overrides, message) {
    const { main } = await loadRefreshModule();
    const before = readFileSync(project.scanPath);
    const beforeHash = sha256(before);
    expect(() => main(project.root, overrides)).toThrow(message);
    const after = readFileSync(project.scanPath);
    expect(after).toEqual(before);
    expect(sha256(after)).toBe(beforeHash);
    assertNoOwnedTemps(project, 'other-process.tmp');
  }

  function protectedProject() {
    const project = setupProject();
    writeFileSync(join(project.tmpDir, 'other-process.tmp'), 'keep', 'utf8');
    return project;
  }

  it('keeps the old scan byte-identical when the scanner child process fails', async () => {
    const module = await loadRefreshModule();
    const project = protectedProject();
    const failureDir = makeTempRoot('ua-refresh-failing-child-');
    const failureScript = join(failureDir, 'fail.mjs');
    writeFileSync(failureScript, 'process.exit(17);\n', 'utf8');
    await expectProtected(project, {
      runBundledScript(scriptPath, args, label) {
        if (basename(scriptPath) === 'scan-project.mjs') {
          return module.runBundledScript(failureScript, [], label);
        }
        return module.runBundledScript(scriptPath, args, label);
      },
    }, /scan-project exited with status 17/);
  });

  it('rejects an invalid scanner entry before import extraction or replacement', async () => {
    const project = protectedProject();
    let importRuns = 0;
    let renameCalls = 0;

    await expectProtected(project, {
      runBundledScript(scriptPath, args) {
        if (basename(scriptPath) === 'scan-project.mjs') {
          const invalidEntry = file('src/existing.ts');
          delete invalidEntry.sizeLines;
          writeFileSync(args[1], JSON.stringify(inventory([invalidEntry])), 'utf8');
          return;
        }
        importRuns += 1;
      },
      renameSync() {
        renameCalls += 1;
      },
    }, /sizeLines/i);

    expect(importRuns).toBe(0);
    expect(renameCalls).toBe(0);
  });

  it('rejects an external junction inventory path before import extraction', async () => {
    const project = protectedProject();
    const outsideRoot = makeTempRoot('ua-refresh-outside-');
    writeFileSync(join(outsideRoot, 'outside.ts'), 'export const secret = true;\n', 'utf8');
    symlinkSync(outsideRoot, join(project.root, 'linked-dir'), 'junction');
    let importRuns = 0;

    await expectProtected(project, {
      runBundledScript(scriptPath, args) {
        if (basename(scriptPath) === 'scan-project.mjs') {
          writeFileSync(
            args[1],
            JSON.stringify(inventory([file('linked-dir/outside.ts')])),
            'utf8',
          );
          return;
        }
        importRuns += 1;
      },
    }, /unsafe|outside project root/i);

    expect(importRuns).toBe(0);
  });

  it('rejects missing inventory files before import extraction', async () => {
    const project = protectedProject();
    let importRuns = 0;

    await expectProtected(project, {
      runBundledScript(scriptPath, args) {
        if (basename(scriptPath) === 'scan-project.mjs') {
          writeFileSync(
            args[1],
            JSON.stringify(inventory([file('src/missing.ts')])),
            'utf8',
          );
          return;
        }
        importRuns += 1;
      },
    }, /unavailable|unsafe/i);

    expect(importRuns).toBe(0);
  });

  it('fails closed on inventory realpath errors before import extraction', async () => {
    const project = protectedProject();
    let importRuns = 0;

    await expectProtected(project, {
      runBundledScript(scriptPath, args) {
        if (basename(scriptPath) === 'scan-project.mjs') {
          writeFileSync(
            args[1],
            JSON.stringify(inventory([file('src/existing.ts')])),
            'utf8',
          );
          return;
        }
        importRuns += 1;
      },
      realpathSync(path) {
        if (basename(path) === 'existing.ts') throw new Error('injected realpath failure');
        return path;
      },
    }, /unavailable|unsafe/i);

    expect(importRuns).toBe(0);
  });

  it('keeps the old scan byte-identical when import output is invalid JSON', async () => {
    const module = await loadRefreshModule();
    const project = protectedProject();
    await expectProtected(project, {
      runBundledScript(scriptPath, args, label) {
        if (basename(scriptPath) === 'extract-import-map.mjs') {
          writeFileSync(args[1], '{ invalid import JSON', 'utf8');
          return;
        }
        return module.runBundledScript(scriptPath, args, label);
      },
    }, /import.*JSON/i);
  });

  it('keeps the old scan byte-identical when importMap keys are incomplete', async () => {
    const module = await loadRefreshModule();
    const project = protectedProject();
    await expectProtected(project, {
      runBundledScript(scriptPath, args, label) {
        if (basename(scriptPath) === 'extract-import-map.mjs') {
          writeFileSync(args[1], JSON.stringify({
            scriptCompleted: true,
            importMap: {},
          }), 'utf8');
          return;
        }
        return module.runBundledScript(scriptPath, args, label);
      },
    }, /missing importMap key/i);
  });

  it('keeps the old scan byte-identical when candidate writing fails', async () => {
    const project = protectedProject();
    await expectProtected(project, {
      writeFileSync(path, contents, encoding) {
        if (dirname(path) === project.intermediateDir) {
          throw new Error('injected candidate write failure');
        }
        return writeFileSync(path, contents, encoding);
      },
    }, /injected candidate write failure/);
  });

  it('keeps the old scan byte-identical and cleans the candidate when rename fails', async () => {
    const project = protectedProject();
    await expectProtected(project, {
      renameSync() {
        throw new Error('injected rename failure');
      },
    }, /injected rename failure/);
  });

  it('does not replace the old scan when owned work-temp cleanup fails before rename', async () => {
    const project = protectedProject();
    let cleanupFailureInjected = false;
    let renameCalls = 0;

    await expectProtected(project, {
      rmSync(path, options) {
        if (!cleanupFailureInjected && basename(path).startsWith('refresh-inventory-')) {
          cleanupFailureInjected = true;
          throw new Error('injected pre-rename cleanup failure');
        }
        return rmSync(path, options);
      },
      renameSync(...args) {
        renameCalls += 1;
        return realRenameSync(...args);
      },
    }, /injected pre-rename cleanup failure/);

    expect(cleanupFailureInjected).toBe(true);
    expect(renameCalls).toBe(0);
  });

  it('does not turn a committed refresh into failure when summary logging fails', async () => {
    const { main } = await loadRefreshModule();
    const project = protectedProject();
    let summaryAttempts = 0;

    expect(() => main(project.root, {
      writeSummary() {
        summaryAttempts += 1;
        throw new Error('injected post-rename summary failure');
      },
    })).not.toThrow();

    expect(summaryAttempts).toBe(1);
    expect(readJson(project.scanPath).files.map(entry => entry.path))
      .toContain('src/added.ts');
    assertNoOwnedTemps(project, 'other-process.tmp');
  });
});
