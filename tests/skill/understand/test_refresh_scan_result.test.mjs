import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../understand-anything-plugin/skills/understand');
const REFRESH_SCRIPT = join(SKILL_DIR, 'refresh-scan-result.mjs');
const {
  main: refresh,
  runBundledScript,
  validateImportResult,
  validateInventory,
} = await import(pathToFileURL(REFRESH_SCRIPT).href);

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

const file = (path, language = 'typescript', fileCategory = 'code') => (
  { path, language, sizeLines: 1, fileCategory });

function previousScan(files = [file('src/existing.ts')]) {
  return {
    name: 'preserved-name', description: 'preserved description',
    languages: ['stale-language'],
    frameworks: ['React', 'Express'], narrativeMetadata: { owner: 'kept', nested: true },
    files,
    totalFiles: files.length,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
    importMap: Object.fromEntries(files.map(entry => [entry.path, []])),
  };
}

function inventory(files, totalFiles = files.length) {
  return {
    scriptCompleted: true, files, totalFiles,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
  };
}

function pipelineOverrides({ inventoryValue, importValue, calls } = {}) {
  return {
    runBundledScript(scriptPath, args) {
      const scriptName = basename(scriptPath);
      calls?.push(scriptName);
      const value = scriptName === 'scan-project.mjs'
        ? (inventoryValue ?? inventory([file('src/existing.ts'), file('src/added.ts')]))
        : (importValue ?? {
            scriptCompleted: true,
            importMap: {
              'src/existing.ts': [],
              'src/added.ts': ['src/existing.ts'],
            },
          });
      const contents = typeof value === 'string' ? value : JSON.stringify(value);
      writeFileSync(args[1], contents, 'utf8');
    },
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

  const uaDir = join(root, uaDirName);
  const intermediateDir = join(uaDir, 'intermediate');
  const tmpDir = join(uaDir, 'tmp');
  mkdirSync(intermediateDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  if (ignore !== undefined) writeFileSync(join(uaDir, '.understandignore'), ignore, 'utf8');

  const scanPath = join(intermediateDir, 'scan-result.json');
  writeFileSync(scanPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
  return { root, uaDir, intermediateDir, tmpDir, scanPath, previous };
}

function setupCliProject(options) {
  const project = setupProject(options);
  const init = spawnSync('git', ['init', '-q'], { cwd: project.root, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`fixture git init failed: ${init.stderr}`);
  return project;
}

function runRefresh(projectRoot) {
  return spawnSync(process.execPath, [REFRESH_SCRIPT, projectRoot], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

function assertNoOwnedTemps(project, sentinel = null) {
  const tmpEntries = existsSync(project.tmpDir) ? readdirSync(project.tmpDir) : [];
  expect(tmpEntries).toEqual(sentinel ? [sentinel] : []);
  const candidatePrefix = `${basename(project.scanPath)}.refresh-`;
  expect(readdirSync(project.intermediateDir).filter(name => name.startsWith(candidatePrefix))).toEqual([]);
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('refresh-scan-result.mjs CLI integration', () => {
  it('refreshes added and non-TypeScript files while preserving narrative fields', () => {
    const project = setupCliProject({
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
    for (const field of ['name', 'description', 'frameworks', 'narrativeMetadata']) {
      expect(scan[field]).toEqual(project.previous[field]);
    }
    expect(scan.languages).toEqual(
      [...new Set(scan.files.map(entry => entry.language))]
        .sort((a, b) => a.localeCompare(b)),
    );
    expect(scan).not.toHaveProperty('scriptCompleted');
    expect(scan).not.toHaveProperty('stats');
    expect(result.stderr).toContain('scan-project: filesScanned=');
    expect(result.stderr).toContain('extract-import-map: filesScanned=');
    expect(result.stderr).toContain('Warning: extract-import-map:');
    expect(result.stderr).toMatch(/refresh-scan-result: files=6 added=5 removed=0 importEdges=1/);
    expect(readFileSync(project.scanPath, 'utf8')).toMatch(/\n$/);
    assertNoOwnedTemps(project);
  });

  it('removes renamed-away paths from both files and importMap', () => {
    const old = file('src/old-name.ts');
    const project = setupCliProject({
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
    const project = setupCliProject({
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
    const project = setupCliProject();
    const first = runRefresh(project.root);
    expect(first.status, first.stderr).toBe(0);
    const firstBytes = readFileSync(project.scanPath);
    const second = runRefresh(project.root);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(project.scanPath)).toEqual(firstBytes);
  }, 15_000);

  it.each([
    ['invalid JSON', '{ invalid old scan', /refresh-scan-result.*scan-result.*JSON/i],
    ['missing', null, /refresh-scan-result.*scan-result.*missing|unreadable/i],
  ])('fails clearly when the old scan is %s without replacement',
    (_label, oldScanContents, message) => {
      const project = setupProject();
      if (oldScanContents === null) rmSync(project.scanPath);
      else writeFileSync(project.scanPath, oldScanContents, 'utf8');
      const before = oldScanContents === null ? null : readFileSync(project.scanPath);
      const result = runRefresh(project.root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(message);
      expect(existsSync(project.scanPath)).toBe(oldScanContents !== null);
      if (before) expect(readFileSync(project.scanPath)).toEqual(before);
      assertNoOwnedTemps(project);
    });
});

describe('refresh-scan-result.mjs validation', () => {
  it.each([
    ['duplicate paths', inventory([file('src/a.ts'), file('src/a.ts')]), /duplicate.*src\/a\.ts/i],
    ['a totalFiles mismatch', inventory([file('src/a.ts')], 2), /totalFiles/i],
  ])('rejects inventory with %s', (_label, value, message) => {
    expect(() => validateInventory(value)).toThrow(message);
  });

  it.each([
    ['missing sizeLines', file('src/a.ts'), entry => { delete entry.sizeLines; }],
    ['negative sizeLines', file('src/a.ts'), entry => { entry.sizeLines = -1; }],
    ['fractional sizeLines', file('src/a.ts'), entry => { entry.sizeLines = 1.5; }],
    ['missing fileCategory', file('src/a.ts'), entry => { delete entry.fileCategory; }],
    ['unknown fileCategory', file('src/a.ts'), entry => { entry.fileCategory = 'binary'; }],
  ])('rejects inventory entries with %s', (_label, validEntry, mutate) => {
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
  ])('rejects non-normalized relative POSIX inventory path %s', invalidPath => {
    expect(() => validateInventory(inventory([file(invalidPath)]))).toThrow(
      /relative POSIX|reserved data path/i,
    );
  });

  it('matches reserved roots case-insensitively on Windows and allows nested lookalikes', () => {
    const uppercaseRootPaths = [
      '.UA/intermediate/leak.json',
      '.UNDERSTAND-ANYTHING/tmp/leak.json',
    ];

    for (const path of uppercaseRootPaths) {
      const validate = () => validateInventory(inventory([file(path)]));
      if (process.platform === 'win32') expect(validate).toThrow(/reserved data path/i);
      else expect(validate).not.toThrow();
    }

    const nested = ['.ua', '.understand-anything', '.UA', '.UNDERSTAND-ANYTHING']
      .map(dir => file(`src/${dir}/example.ts`));
    expect(() => validateInventory(inventory(nested))).not.toThrow();
  });

  it.each([
    ['a missing exact key', { 'src/a.ts': [] }, /missing.*src\/b\.ts/i],
    ['an extra exact key', { 'src/a.ts': [], 'src/b.ts': [], 'src/extra.ts': [] }, /extra.*src\/extra\.ts/i],
    ['a non-array value', { 'src/a.ts': 'src/b.ts', 'src/b.ts': [] }, /array/i],
    ['a target outside inventory', { 'src/a.ts': ['src/missing.ts'], 'src/b.ts': [] },
      /internal target.*src\/missing\.ts/i],
  ])('rejects importMap with %s', (_label, importMap, message) => {
    expect(() => validateImportResult({ scriptCompleted: true, importMap }, [
      'src/a.ts', 'src/b.ts',
    ])).toThrow(message);
  });
});

describe('refresh-scan-result.mjs failure protection', () => {
  function expectProtected(project, overrides = {}, message) {
    const before = readFileSync(project.scanPath);
    expect(() => refresh(project.root, { ...pipelineOverrides(), ...overrides }))
      .toThrow(message);
    expect(readFileSync(project.scanPath)).toEqual(before);
    assertNoOwnedTemps(project, 'other-process.tmp');
  }

  function protectedProject() {
    const project = setupProject();
    writeFileSync(join(project.tmpDir, 'other-process.tmp'), 'keep', 'utf8');
    return project;
  }

  function expectBeforeImport(project, inventoryValue, overrides, message) {
    const calls = [];
    expectProtected(project, {
      ...pipelineOverrides({ inventoryValue, calls }),
      ...overrides,
    }, message);
    expect(calls).toEqual(['scan-project.mjs']);
  }

  it('keeps the old scan byte-identical when the scanner child process fails', () => {
    const project = protectedProject();
    const failureDir = makeTempRoot('ua-refresh-failing-child-');
    const failureScript = join(failureDir, 'fail.mjs');
    const pipeline = pipelineOverrides();
    writeFileSync(failureScript, 'process.exit(17);\n', 'utf8');
    expectProtected(project, {
      ...pipeline,
      runBundledScript(scriptPath, args, label) {
        if (basename(scriptPath) === 'scan-project.mjs') return runBundledScript(failureScript, [], label);
        return pipeline.runBundledScript(scriptPath, args, label);
      },
    }, /scan-project exited with status 17/);
  });

  it('rejects an invalid scanner entry before import extraction or replacement', () => {
    const project = protectedProject();
    const invalidEntry = file('src/existing.ts');
    let renameCalls = 0;
    delete invalidEntry.sizeLines;

    expectBeforeImport(project, inventory([invalidEntry]), {
      renameSync: () => { renameCalls += 1; },
    }, /sizeLines/i);
    expect(renameCalls).toBe(0);
  });

  it.each([
    [
      'an external junction inventory path',
      project => {
        const outsideRoot = makeTempRoot('ua-refresh-outside-');
        writeFileSync(join(outsideRoot, 'outside.ts'), 'export const secret = true;\n', 'utf8');
        symlinkSync(outsideRoot, join(project.root, 'linked-dir'), 'junction');
        return [inventory([file('linked-dir/outside.ts')]), {}, /unsafe|outside project root/i];
      },
    ],
    ['a missing inventory file', () => [
      inventory([file('src/missing.ts')]), {}, /unavailable|unsafe/i,
    ]],
    [
      'an inventory realpath error',
      () => [
        inventory([file('src/existing.ts')]),
        {
          realpathSync(path) {
            if (basename(path) === 'existing.ts') throw new Error('injected realpath failure');
            return path;
          },
        },
        /unavailable|unsafe/i,
      ],
    ],
  ])('rejects %s before import extraction', (_label, arrange) => {
    const project = protectedProject();
    const [inventoryValue, overrides, message] = arrange(project);
    expectBeforeImport(project, inventoryValue, overrides, message);
  });

  it.each([
    ['invalid JSON', '{ invalid import JSON', /import.*JSON/i],
    ['incomplete keys', { scriptCompleted: true, importMap: {} }, /missing importMap key/i],
  ])('keeps the old scan byte-identical when import output has %s',
    (_label, importValue, message) => {
    const project = protectedProject();
    expectProtected(project, pipelineOverrides({ importValue }), message);
    });

  it('keeps the old scan byte-identical when candidate writing fails', () => {
    const project = protectedProject();
    let renameCalls = 0;
    expectProtected(project, {
      writeFileSync(path, contents, encoding) {
        if (dirname(path) === project.intermediateDir) throw new Error('injected candidate write failure');
        return writeFileSync(path, contents, encoding);
      },
      renameSync: () => { renameCalls += 1; },
    }, /injected candidate write failure/);
    expect(renameCalls).toBe(0);
  });

  it('keeps the old scan byte-identical and cleans the candidate when rename fails', () => {
    const project = protectedProject();
    let renameCalls = 0;
    expectProtected(project, {
      renameSync() {
        renameCalls += 1;
        throw new Error('injected rename failure');
      },
    }, /injected rename failure/);
    expect(renameCalls).toBe(1);
  });

  it('does not replace the old scan when owned work-temp cleanup fails before rename', () => {
    const project = protectedProject();
    let cleanupFailureInjected = false;
    let renameCalls = 0;

    expectProtected(project, {
      rmSync(path, options) {
        if (!cleanupFailureInjected && basename(path).startsWith('refresh-inventory-')) {
          cleanupFailureInjected = true;
          throw new Error('injected pre-rename cleanup failure');
        }
        return rmSync(path, options);
      },
      renameSync: () => { renameCalls += 1; },
    }, /injected pre-rename cleanup failure/);

    expect(cleanupFailureInjected).toBe(true);
    expect(renameCalls).toBe(0);
  });

  it('does not turn a committed refresh into failure when summary logging fails', () => {
    const project = protectedProject();
    let summaryAttempts = 0;

    expect(() => refresh(project.root, {
      ...pipelineOverrides(),
      writeSummary() {
        summaryAttempts += 1;
        throw new Error('injected post-rename summary failure');
      },
    })).not.toThrow();

    expect(summaryAttempts).toBe(1);
    expect(readJson(project.scanPath).files.map(entry => entry.path)).toContain('src/added.ts');
    assertNoOwnedTemps(project, 'other-process.tmp');
  });
});
