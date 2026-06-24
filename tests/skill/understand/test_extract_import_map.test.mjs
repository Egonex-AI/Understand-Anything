import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/extract-import-map.mjs');

/**
 * Helper: write a source tree from a `files` object: { 'a/b.ts': '...', ... }.
 * Creates parent dirs as needed. Returns the temp project root.
 */
function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-eim-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  return root;
}

/**
 * Run the extract-import-map.mjs script. Returns
 * { status, stdout, stderr, output } where `output` is the parsed JSON
 * written by the script (or null on failure to read).
 *
 * `extraNodeArgs` is prepended to the node argv before the script path, so
 * tests can pass `--import` loader hooks to force specific failure modes.
 */
function runScript(projectRoot, input, extraNodeArgs = []) {
  const inputPath = join(projectRoot, 'ua-eim-input.json');
  const outputPath = join(projectRoot, 'ua-eim-output.json');
  writeFileSync(inputPath, JSON.stringify(input), 'utf-8');
  const result = spawnSync(
    'node',
    [...extraNodeArgs, SCRIPT, inputPath, outputPath],
    { encoding: 'utf-8' },
  );
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

describe('extract-import-map.mjs — TypeScript / JavaScript resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves typescript relative imports with extension probes', () => {
    projectRoot = setupTree({
      'src/index.ts': `import { foo } from './utils';\nimport cfg from './config';\nfoo(cfg);\n`,
      'src/utils.ts': `export function foo(x: unknown) { return x; }\n`,
      'src/config.ts': `export default { debug: true };\n`,
      'README.md': '# project\n',
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/config.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'README.md', language: 'markdown', fileCategory: 'docs' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.scriptCompleted).toBe(true);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/config.ts',
      'src/utils.ts',
    ]);
    expect(result.output.importMap['src/utils.ts']).toEqual([]);
    // Non-code file gets empty array
    expect(result.output.importMap['README.md']).toEqual([]);

    expect(result.output.stats.filesScanned).toBe(4);
    expect(result.output.stats.filesWithImports).toBe(1);
    expect(result.output.stats.totalEdges).toBe(2);
  });

  it('resolves tsconfig paths aliases', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '~lib/*': ['src/lib/*'],
          },
        },
      }),
      'src/index.ts': `import { greet } from '@/utils/greet';\nimport { add } from '~lib/math';\n`,
      'src/utils/greet.ts': `export function greet(name: string) { return 'hi ' + name; }\n`,
      'src/lib/math.ts': `export const add = (a: number, b: number) => a + b;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils/greet.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/lib/math.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/lib/math.ts',
      'src/utils/greet.ts',
    ]);
  });

  it('resolves /index.ts barrel imports', () => {
    projectRoot = setupTree({
      'src/index.ts': `import { thing } from './stuff';\n`,
      'src/stuff/index.ts': `export const thing = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/stuff/index.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/stuff/index.ts']);
  });

  it('drops external package imports', () => {
    projectRoot = setupTree({
      'src/index.ts': `import express from 'express';\nimport { z } from 'zod';\nimport { foo } from './local';\n`,
      'src/local.ts': `export const foo = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/local.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Only the local import survives; express/zod are external.
    expect(result.output.importMap['src/index.ts']).toEqual(['src/local.ts']);
  });

  it('resolves javascript require() calls', () => {
    projectRoot = setupTree({
      'src/index.js': `const cfg = require('./config');\nconst utils = require('../shared/utils');\n`,
      'src/config.js': `module.exports = { x: 1 };\n`,
      'shared/utils.js': `module.exports = { y: 2 };\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/config.js', language: 'javascript', fileCategory: 'code' },
        { path: 'shared/utils.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.js']).toEqual([
      'shared/utils.js',
      'src/config.js',
    ]);
  });

  it('resolves per-package tsconfig paths in a monorepo without cross-package leakage', () => {
    // Two pnpm-workspace packages, each carrying its own tsconfig with its
    // own `paths`. The resolver MUST dispatch per-importer to the nearest
    // tsconfig — and aliases from one package must NOT resolve files in
    // another package (each tsconfig anchors its baseUrl at its own dir).
    projectRoot = setupTree({
      'packages/foo/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@foo/*': ['src/*'] },
        },
      }),
      'packages/foo/src/x.ts': `import { y } from '@foo/y';\nexport const x = y;\n`,
      'packages/foo/src/y.ts': `export const y = 1;\n`,
      'packages/bar/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@bar/*': ['src/*'] },
        },
      }),
      'packages/bar/src/x.ts':
        `import { y } from '@bar/y';\n` +
        `import { fy } from '@foo/y';\n` +   // must NOT resolve from bar
        `export const x = y;\n`,
      'packages/bar/src/y.ts': `export const y = 2;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'packages/foo/tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/foo/src/x.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/foo/src/y.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/bar/tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/bar/src/x.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'packages/bar/src/y.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // foo/x sees its own @foo/y -> foo/src/y.ts only.
    expect(result.output.importMap['packages/foo/src/x.ts']).toEqual([
      'packages/foo/src/y.ts',
    ]);
    // bar/x sees its own @bar/y -> bar/src/y.ts. The cross-package @foo/y
    // import does NOT resolve because bar's tsconfig has no @foo/* alias.
    expect(result.output.importMap['packages/bar/src/x.ts']).toEqual([
      'packages/bar/src/y.ts',
    ]);
    expect(result.output.importMap['packages/bar/src/x.ts']).not.toContain(
      'packages/foo/src/y.ts',
    );
  });

  // ── Issue #214: tsconfig path-alias targets with leading "./" ───────────
  // create-next-app ships `"@/*": ["./*"]` as the default. With a root
  // tsconfig the candidate would stay as "./lib/thing" while ctx.fileSet
  // stores normalized "lib/thing", silently dropping every cross-module
  // import edge. Three originally broken cases plus one regression guard
  // for the already working `["*"]` form.

  it('resolves tsconfig paths with leading "./" target and no baseUrl (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });

  it('resolves tsconfig paths with leading "./" target and baseUrl "." (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });

  it('resolves tsconfig paths with leading "./" target and baseUrl "src" (#214)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: 'src',
          paths: { '@/*': ['./*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/thing';\nconst _ = x;\n`,
      'src/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('src/thing.ts');
  });

  it('keeps resolving tsconfig paths with bare "*" target (#214 regression guard)', () => {
    projectRoot = setupTree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@/*': ['*'] },
        },
      }),
      'src/app.ts': `import { x } from '@/lib/thing';\nconst _ = x;\n`,
      'lib/thing.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/app.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'lib/thing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.ts']).toContain('lib/thing.ts');
  });

  // ── #294: NodeNext / ESM TypeScript `.js → .ts` rewrite ────────────────
  //
  // Under `moduleResolution: NodeNext`, TypeScript does NOT rewrite import
  // specifiers during compilation — what you write in the .ts source is
  // emitted verbatim. Because Node's ESM loader requires explicit file
  // extensions at runtime, the TS source must already spell the import with
  // the `.js` extension that will only be correct AFTER compilation:
  //
  //   import { x } from './config.js';   // on disk: config.ts
  //
  // Before the fix, every such import resolved to null, leaving ESM-TS
  // projects with a near-edgeless knowledge graph.

  it('resolves NodeNext .js → .ts relative imports (the main #294 case)', () => {
    projectRoot = setupTree({
      'src/index.ts': `import { resolveBackend } from './llm-backend-selector.js';\nimport { loadConfig } from './config.js';\n`,
      'src/llm-backend-selector.ts': `export function resolveBackend() {}\n`,
      'src/config.ts': `export function loadConfig() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/llm-backend-selector.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/config.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/config.ts',
      'src/llm-backend-selector.ts',
    ]);
  });

  it('resolves NodeNext .jsx → .tsx and .mjs → .mts rewrites', () => {
    projectRoot = setupTree({
      'src/index.ts': `import Comp from './Comp.jsx';\nimport { fn } from './worker.mjs';\n`,
      'src/Comp.tsx': `export default function Comp() {}\n`,
      'src/worker.mts': `export function fn() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/Comp.tsx', language: 'typescript', fileCategory: 'code' },
        { path: 'src/worker.mts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual([
      'src/Comp.tsx',
      'src/worker.mts',
    ]);
  });

  it('resolves to the .js when both .ts and .js exist on disk', () => {
    // Rare but possible during a partial migration: both `config.ts` and
    // `config.js` exist. An `import './config.js'` is an exact-disk match
    // and should resolve to that exact file — the NodeNext rewrite only
    // kicks in when the .js *doesn't* exist on disk. We assert this to
    // pin the disambiguation and avoid future regressions where the rewrite
    // accidentally prefers `.ts` over an existing `.js`.
    projectRoot = setupTree({
      'src/index.ts': `import { x } from './config.js';\n`,
      'src/config.ts': `export const x = 1;\n`,
      'src/config.js': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/config.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/config.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/config.js']);
  });

  it('still resolves traditional .js → .js imports unchanged', () => {
    // The rewrite must not break the case where `.js` IS the real file on
    // disk (pure JavaScript projects, untyped libraries).
    projectRoot = setupTree({
      'src/index.js': `import { x } from './util.js';\n`,
      'src/util.js': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/util.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.js']).toEqual(['src/util.js']);
  });

  it('leaves the historical "no extension" probe behaviour intact', () => {
    // An import like `./utils` (no extension) must still go through the
    // append-extensions loop and resolve to `./utils.ts` — the new rewrite
    // path is only triggered when the import already ends with a compiled
    // extension.
    projectRoot = setupTree({
      'src/index.ts': `import { foo } from './utils';\n`,
      'src/utils.ts': `export function foo() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/utils.ts']);
  });

  it('returns null (no resolution) for a .js import whose .ts source is missing', () => {
    // The rewrite must NOT silently invent a target when neither the .js nor
    // the .ts file exists. The old behaviour would also return null for this
    // case — we're verifying the rewrite path doesn't regress it.
    projectRoot = setupTree({
      'src/index.ts': `import './completely-missing.js';\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [{ path: 'src/index.ts', language: 'typescript', fileCategory: 'code' }],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/index.ts']).toEqual([]);
  });
});

describe('extract-import-map.mjs — Python resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves python relative imports', () => {
    projectRoot = setupTree({
      'src/app.py': `from . import helpers\nfrom .utils import shout\nfrom ..core import boot\n`,
      'src/helpers.py': `def help(): pass\n`,
      'src/utils.py': `def shout(): pass\n`,
      'core.py': `def boot(): pass\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/app.py', language: 'python', fileCategory: 'code' },
        { path: 'src/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils.py', language: 'python', fileCategory: 'code' },
        { path: 'core.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `from . import helpers` resolves `helpers` as a sibling submodule
    // (`src/helpers.py`) even though `src/__init__.py` is absent — PEP 328
    // implicit namespace packages don't require it. `from .utils import shout`
    // resolves to `src/utils.py`. `from ..core import boot` -> `core.py`.
    expect(result.output.importMap['src/app.py']).toEqual([
      'core.py',
      'src/helpers.py',
      'src/utils.py',
    ]);
  });

  // Regression for Codex review #2 on PR #204: `from . import x` was
  // dropped when no `__init__.py` was present at the importer's package
  // dir, because resolvePythonProbe gated specifier probing on the package
  // marker. Modern Python (PEP 420 namespace packages) commonly omits it.
  it('resolves `from . import x` for namespace packages (no __init__.py)', () => {
    projectRoot = setupTree({
      'src/svc/main.py':
        `from . import helpers, util\nfrom . import nested\n`,
      'src/svc/helpers.py': `def help(): pass\n`,
      'src/svc/util.py': `def u(): pass\n`,
      'src/svc/nested/__init__.py': `# package\n`,
      // Crucially: NO src/svc/__init__.py — namespace package
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/svc/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/util.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc/nested/__init__.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // All three siblings should resolve — helpers.py + util.py as direct
    // .py modules, nested/ as a package via its __init__.py.
    expect(result.output.importMap['src/svc/main.py']).toEqual([
      'src/svc/helpers.py',
      'src/svc/nested/__init__.py',
      'src/svc/util.py',
    ]);
  });

  it('resolves python absolute imports and __init__.py matching', () => {
    projectRoot = setupTree({
      'main.py': `import src.utils.formatter\nfrom src.utils import formatter\nfrom src import config\n`,
      'src/__init__.py': '',
      'src/utils/__init__.py': '',
      'src/utils/formatter.py': `def fmt(): pass\n`,
      'src/config.py': `DEBUG = True\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/__init__.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils/__init__.py', language: 'python', fileCategory: 'code' },
        { path: 'src/utils/formatter.py', language: 'python', fileCategory: 'code' },
        { path: 'src/config.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `import src.utils.formatter` -> src/utils/formatter.py
    // `from src.utils import formatter` -> src/utils/__init__.py + src/utils/formatter.py
    // `from src import config` -> src/__init__.py + src/config.py
    expect(result.output.importMap['main.py']).toEqual([
      'src/__init__.py',
      'src/config.py',
      'src/utils/__init__.py',
      'src/utils/formatter.py',
    ]);
  });

  it('drops python external package imports', () => {
    projectRoot = setupTree({
      'app.py': `import os\nimport sys\nimport requests\nfrom datetime import datetime\nfrom .local import thing\n`,
      'local.py': `thing = 1\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'app.py', language: 'python', fileCategory: 'code' },
        { path: 'local.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // os/sys/requests/datetime are external; only ./local resolves.
    expect(result.output.importMap['app.py']).toEqual(['local.py']);
  });

  it('resolves absolute imports against the importers per-service root in multi-service repos', () => {
    // Mirrors microservices-demo: each service ships its own sibling files
    // under src/<service>/, and uses bare `import helpers` to reach them.
    // The probe MUST walk up from the importer's dir (not just probe
    // projectRoot). The same module name in two services must NOT cross-
    // resolve — importer-dir scope wins.
    projectRoot = setupTree({
      'src/svc_a/main.py':
        `import helpers\nfrom helpers import shout\n`,
      'src/svc_a/helpers.py':
        `def shout(): pass\n`,
      'src/svc_b/main.py':
        `import helpers\nfrom helpers import shout\n`,
      'src/svc_b/helpers.py':
        `def shout(): pass\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/svc_a/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_a/helpers.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_b/main.py', language: 'python', fileCategory: 'code' },
        { path: 'src/svc_b/helpers.py', language: 'python', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Each service's main.py resolves to its OWN helpers.py — no cross-link.
    expect(result.output.importMap['src/svc_a/main.py']).toEqual([
      'src/svc_a/helpers.py',
    ]);
    expect(result.output.importMap['src/svc_a/main.py']).not.toContain(
      'src/svc_b/helpers.py',
    );
    expect(result.output.importMap['src/svc_b/main.py']).toEqual([
      'src/svc_b/helpers.py',
    ]);
    expect(result.output.importMap['src/svc_b/main.py']).not.toContain(
      'src/svc_a/helpers.py',
    );
  });
});

describe('extract-import-map.mjs — Go resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves go imports by stripping the go.mod module prefix', () => {
    projectRoot = setupTree({
      'go.mod': `module github.com/foo/bar\n\ngo 1.21\n`,
      'main.go': `package main\n\nimport (\n\t"fmt"\n\t"github.com/foo/bar/util"\n\t"github.com/foo/bar/db"\n)\n\nfunc main() {\n\tfmt.Println(util.Hi())\n\tdb.Connect()\n}\n`,
      'util/hello.go': `package util\n\nfunc Hi() string { return "hi" }\n`,
      'util/world.go': `package util\n\nfunc World() string { return "world" }\n`,
      'db/db.go': `package db\n\nfunc Connect() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'go.mod', language: 'config', fileCategory: 'config' },
        { path: 'main.go', language: 'go', fileCategory: 'code' },
        { path: 'util/hello.go', language: 'go', fileCategory: 'code' },
        { path: 'util/world.go', language: 'go', fileCategory: 'code' },
        { path: 'db/db.go', language: 'go', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `github.com/foo/bar/util` -> all .go files under util/
    // `github.com/foo/bar/db` -> all .go files under db/
    // `fmt` is stdlib (no module prefix match) -> dropped
    expect(result.output.importMap['main.go']).toEqual([
      'db/db.go',
      'util/hello.go',
      'util/world.go',
    ]);
  });

  it('resolves per-service imports in a multi-go.mod monorepo', () => {
    // Mirrors Google's microservices-demo layout: every service ships its
    // own go.mod, so the resolver MUST dispatch per-importer to the nearest
    // ancestor module. Imports of a SIBLING module (a's file importing b's
    // package) must be classified as external — from a's perspective, b is
    // a third-party dependency.
    projectRoot = setupTree({
      'src/a/go.mod': `module github.com/org/a\n\ngo 1.21\n`,
      'src/a/main.go':
        `package main\n\nimport (\n\t"github.com/org/a/sub"\n\t"github.com/org/b/sub"\n)\n\nfunc main() { sub.X() }\n`,
      'src/a/sub/sub.go':
        `package sub\n\nfunc X() {}\n`,
      'src/b/go.mod': `module github.com/org/b\n\ngo 1.21\n`,
      'src/b/main.go':
        `package main\n\nimport (\n\t"github.com/org/b/sub"\n)\n\nfunc main() { sub.Y() }\n`,
      'src/b/sub/sub.go':
        `package sub\n\nfunc Y() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/a/go.mod', language: 'config', fileCategory: 'config' },
        { path: 'src/a/main.go', language: 'go', fileCategory: 'code' },
        { path: 'src/a/sub/sub.go', language: 'go', fileCategory: 'code' },
        { path: 'src/b/go.mod', language: 'config', fileCategory: 'config' },
        { path: 'src/b/main.go', language: 'go', fileCategory: 'code' },
        { path: 'src/b/sub/sub.go', language: 'go', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // a/main resolves its own a/sub but NOT b/sub (b is external from a's
    // module's perspective — different go.mod).
    expect(result.output.importMap['src/a/main.go']).toEqual([
      'src/a/sub/sub.go',
    ]);
    // b/main resolves its own b/sub.
    expect(result.output.importMap['src/b/main.go']).toEqual([
      'src/b/sub/sub.go',
    ]);
  });

  it('emits a one-time Warning: when a .go file has no ancestor go.mod', () => {
    // A .go file outside any module. Multiple module-prefix imports should
    // produce ONE warning (deduped by importer path), and the importMap
    // entry stays empty.
    projectRoot = setupTree({
      'orphan/main.go':
        `package main\n\nimport (\n\t"github.com/foo/bar/util"\n\t"github.com/foo/bar/db"\n)\n\nfunc main() {}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'orphan/main.go', language: 'go', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['orphan/main.go']).toEqual([]);
    const goModWarnings = result.stderr
      .split('\n')
      .filter(l => l.includes('no ancestor go.mod'));
    expect(goModWarnings).toHaveLength(1);
    expect(goModWarnings[0]).toMatch(
      /Warning: extract-import-map: Go file orphan\/main\.go has no ancestor go\.mod/,
    );
    expect(goModWarnings[0]).toMatch(/module-prefix imports skipped/);
  });
});

describe('extract-import-map.mjs — Java resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves java dotted imports via suffix probe', () => {
    projectRoot = setupTree({
      'src/main/java/com/example/App.java':
        `package com.example;\n\nimport com.example.foo.Bar;\nimport com.example.util.Helper;\n\npublic class App { }\n`,
      'src/main/java/com/example/foo/Bar.java':
        `package com.example.foo;\n\npublic class Bar { }\n`,
      'src/main/java/com/example/util/Helper.java':
        `package com.example.util;\n\npublic class Helper { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/main/java/com/example/App.java', language: 'java', fileCategory: 'code' },
        { path: 'src/main/java/com/example/foo/Bar.java', language: 'java', fileCategory: 'code' },
        { path: 'src/main/java/com/example/util/Helper.java', language: 'java', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/main/java/com/example/App.java']).toEqual([
      'src/main/java/com/example/foo/Bar.java',
      'src/main/java/com/example/util/Helper.java',
    ]);
  });

  it('drops java external imports (java.util, etc.)', () => {
    projectRoot = setupTree({
      'src/x/App.java':
        `package x;\nimport java.util.List;\nimport java.io.IOException;\nimport x.Local;\npublic class App { }\n`,
      'src/x/Local.java':
        `package x;\npublic class Local { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/x/App.java', language: 'java', fileCategory: 'code' },
        { path: 'src/x/Local.java', language: 'java', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // java.util/java.io are external (no project file matches the suffix);
    // x.Local maps via suffix to src/x/Local.java.
    expect(result.output.importMap['src/x/App.java']).toEqual(['src/x/Local.java']);
  });
});

describe('extract-import-map.mjs — Kotlin resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves kotlin dotted imports via suffix probe', () => {
    projectRoot = setupTree({
      'src/main/kotlin/com/example/Main.kt':
        `package com.example\n\nimport com.example.foo.Bar\nimport com.example.util.Helper\n\nfun main() { }\n`,
      'src/main/kotlin/com/example/foo/Bar.kt':
        `package com.example.foo\n\nclass Bar\n`,
      'src/main/kotlin/com/example/util/Helper.kt':
        `package com.example.util\n\nobject Helper\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/main/kotlin/com/example/Main.kt', language: 'kotlin', fileCategory: 'code' },
        { path: 'src/main/kotlin/com/example/foo/Bar.kt', language: 'kotlin', fileCategory: 'code' },
        { path: 'src/main/kotlin/com/example/util/Helper.kt', language: 'kotlin', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/main/kotlin/com/example/Main.kt']).toEqual([
      'src/main/kotlin/com/example/foo/Bar.kt',
      'src/main/kotlin/com/example/util/Helper.kt',
    ]);
  });
});

describe('extract-import-map.mjs — C# resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves c# using directives via dotted-suffix probe', () => {
    projectRoot = setupTree({
      'Program.cs':
        `using System;\nusing MyApp.Util.Helper;\nusing MyApp.Models.User;\n\nnamespace MyApp { class Program { } }\n`,
      'MyApp/Util/Helper.cs':
        `namespace MyApp.Util { public class Helper { } }\n`,
      'MyApp/Models/User.cs':
        `namespace MyApp.Models { public class User { } }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Program.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'MyApp/Util/Helper.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'MyApp/Models/User.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['Program.cs']).toEqual([
      'MyApp/Models/User.cs',
      'MyApp/Util/Helper.cs',
    ]);
  });
});

describe('extract-import-map.mjs — Ruby resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves ruby require_relative + require load-path probes', () => {
    projectRoot = setupTree({
      'app/controllers/users_controller.rb':
        `require_relative '../helpers/auth'\nrequire 'shared/logger'\nrequire 'json'\n\nclass UsersController\nend\n`,
      'app/helpers/auth.rb':
        `module Auth\nend\n`,
      'lib/shared/logger.rb':
        `module Shared\n  module Logger\n  end\nend\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'app/controllers/users_controller.rb', language: 'ruby', fileCategory: 'code' },
        { path: 'app/helpers/auth.rb', language: 'ruby', fileCategory: 'code' },
        { path: 'lib/shared/logger.rb', language: 'ruby', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // require_relative '../helpers/auth' -> app/helpers/auth.rb
    // require 'shared/logger' -> lib/shared/logger.rb (load-path probe)
    // require 'json' -> external (no project file)
    expect(result.output.importMap['app/controllers/users_controller.rb']).toEqual([
      'app/helpers/auth.rb',
      'lib/shared/logger.rb',
    ]);
  });
});

describe('extract-import-map.mjs — PHP resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves php use directives via composer.json PSR-4 autoload', () => {
    projectRoot = setupTree({
      'composer.json': JSON.stringify({
        autoload: {
          'psr-4': {
            'App\\': 'src/',
            'App\\Tests\\': 'tests/',
          },
        },
      }),
      'src/Http/Controller.php':
        `<?php\nnamespace App\\Http;\n\nuse App\\Models\\User;\nuse App\\Util\\Logger;\nuse Symfony\\Component\\HttpFoundation\\Request;\n\nclass Controller { }\n`,
      'src/Models/User.php':
        `<?php\nnamespace App\\Models;\nclass User { }\n`,
      'src/Util/Logger.php':
        `<?php\nnamespace App\\Util;\nclass Logger { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'composer.json', language: 'json', fileCategory: 'config' },
        { path: 'src/Http/Controller.php', language: 'php', fileCategory: 'code' },
        { path: 'src/Models/User.php', language: 'php', fileCategory: 'code' },
        { path: 'src/Util/Logger.php', language: 'php', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // App\Models\User -> src/Models/User.php (App\ -> src/)
    // App\Util\Logger -> src/Util/Logger.php
    // Symfony\... -> external (no autoload entry)
    expect(result.output.importMap['src/Http/Controller.php']).toEqual([
      'src/Models/User.php',
      'src/Util/Logger.php',
    ]);
  });

  it('resolves per-package composer.json PSR-4 without cross-package leakage', () => {
    // Multi-package Composer layout (think: Symfony or Laravel-style mono
    // with package-scoped autoload). Each package's composer.json declares
    // its own PSR-4 namespace. Cross-package `use` should NOT resolve via
    // a sibling's autoload — that's exactly the silent miscompile the
    // single-root assumption would introduce.
    projectRoot = setupTree({
      'packages/foo/composer.json': JSON.stringify({
        autoload: { 'psr-4': { 'App\\Foo\\': 'src/' } },
      }),
      'packages/foo/src/X.php':
        `<?php\nnamespace App\\Foo;\n\nuse App\\Foo\\Y;\n` +
        `use App\\Bar\\Z;\n` + // must NOT resolve from foo
        `class X { }\n`,
      'packages/foo/src/Y.php':
        `<?php\nnamespace App\\Foo;\nclass Y { }\n`,
      'packages/bar/composer.json': JSON.stringify({
        autoload: { 'psr-4': { 'App\\Bar\\': 'src/' } },
      }),
      'packages/bar/src/Z.php':
        `<?php\nnamespace App\\Bar;\nclass Z { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'packages/foo/composer.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/foo/src/X.php', language: 'php', fileCategory: 'code' },
        { path: 'packages/foo/src/Y.php', language: 'php', fileCategory: 'code' },
        { path: 'packages/bar/composer.json', language: 'json', fileCategory: 'config' },
        { path: 'packages/bar/src/Z.php', language: 'php', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // foo/src/X.php resolves App\Foo\Y -> packages/foo/src/Y.php only.
    // The App\Bar\Z `use` is unresolvable from foo's perspective (foo's
    // composer.json has no App\Bar entry).
    expect(result.output.importMap['packages/foo/src/X.php']).toEqual([
      'packages/foo/src/Y.php',
    ]);
    expect(result.output.importMap['packages/foo/src/X.php']).not.toContain(
      'packages/bar/src/Z.php',
    );
  });

  // Regression: Composer's fallback autoload mapping `"psr-4": {"": "src/"}`
  // means "any namespace resolves under src/". Earlier code appended `\` to
  // every prefix (so `""` became `"\\"`, matching nothing) AND the
  // longest-prefix loop initialized bestPrefix to `''` and required
  // strict `>` — so even when the empty prefix WAS preserved it could
  // never win. Both fixes are required for this test to pass. Caught by
  // Codex review on PR #204.
  it('resolves PSR-4 empty-prefix fallback ("": "src/")', () => {
    projectRoot = setupTree({
      'composer.json': JSON.stringify({
        autoload: {
          'psr-4': { '': 'src/' },
        },
      }),
      'src/Foo/Bar.php':
        `<?php\nnamespace Foo;\n\nuse Foo\\Baz;\n\nclass Bar { }\n`,
      'src/Foo/Baz.php':
        `<?php\nnamespace Foo;\nclass Baz { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'composer.json', language: 'json', fileCategory: 'config' },
        { path: 'src/Foo/Bar.php', language: 'php', fileCategory: 'code' },
        { path: 'src/Foo/Baz.php', language: 'php', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Empty prefix means `Foo\Baz` -> `src/Foo/Baz.php` directly.
    expect(result.output.importMap['src/Foo/Bar.php']).toEqual([
      'src/Foo/Baz.php',
    ]);
  });
});

describe('extract-import-map.mjs — Rust resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves rust use crate:: and mod declarations', () => {
    projectRoot = setupTree({
      'Cargo.toml': `[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n`,
      'src/lib.rs':
        `pub mod auth;\npub mod db;\n\nuse crate::auth::login;\nuse crate::db::query;\n\nfn boot() { login(); query(); }\n`,
      'src/auth.rs':
        `pub fn login() { }\n`,
      'src/db.rs':
        `pub fn query() { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Cargo.toml', language: 'toml', fileCategory: 'config' },
        { path: 'src/lib.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/auth.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/db.rs', language: 'rust', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // `pub mod auth;` and `pub mod db;` declare submodules in the same dir.
    // `use crate::auth::login;` and `use crate::db::query;` resolve via crate src.
    expect(result.output.importMap['src/lib.rs']).toEqual([
      'src/auth.rs',
      'src/db.rs',
    ]);
  });

  it('resolves rust super:: walking up one directory', () => {
    projectRoot = setupTree({
      'Cargo.toml': `[package]\nname = "demo"\nversion = "0.1.0"\n`,
      'src/lib.rs': `pub mod inner;\npub mod sibling;\n`,
      'src/sibling.rs': `pub fn hi() { }\n`,
      'src/inner/mod.rs': `use super::sibling::hi;\nfn boot() { hi(); }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Cargo.toml', language: 'toml', fileCategory: 'config' },
        { path: 'src/lib.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/sibling.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/inner/mod.rs', language: 'rust', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/inner/mod.rs']).toEqual(['src/sibling.rs']);
  });
});

describe('extract-import-map.mjs — C/C++ resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('resolves c/c++ #include probes (relative + include/ + src/)', () => {
    projectRoot = setupTree({
      'src/main.cpp':
        `#include <iostream>\n#include "util.h"\n#include "helpers/log.h"\n\nint main() { return 0; }\n`,
      'src/util.h':
        `#ifndef UTIL_H\n#define UTIL_H\nvoid util();\n#endif\n`,
      'src/helpers/log.h':
        `#pragma once\nvoid log_msg(const char*);\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/main.cpp', language: 'cpp', fileCategory: 'code' },
        { path: 'src/util.h', language: 'cpp', fileCategory: 'code' },
        { path: 'src/helpers/log.h', language: 'cpp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // iostream is external; util.h resolves relative to importer dir;
    // helpers/log.h also relative.
    expect(result.output.importMap['src/main.cpp']).toEqual([
      'src/helpers/log.h',
      'src/util.h',
    ]);
  });

  it('resolves c #include via project-level include/ fallback', () => {
    projectRoot = setupTree({
      'src/app.c':
        `#include "config.h"\n#include "shared.h"\n\nint main() { return 0; }\n`,
      'include/config.h': `#pragma once\n`,
      'src/shared.h': `#pragma once\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/app.c', language: 'c', fileCategory: 'code' },
        { path: 'include/config.h', language: 'c', fileCategory: 'code' },
        { path: 'src/shared.h', language: 'c', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/app.c']).toEqual([
      'include/config.h',
      'src/shared.h',
    ]);
  });
});

describe('extract-import-map.mjs — per-file failure resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('continues processing when a file is missing from disk', () => {
    // Build a project with one real file and one declared-but-missing file.
    // The missing file is still in the input list (the project-scanner
    // discovered it before something deleted it), so the resolver must
    // emit a Warning: line and set importMap[<missing>] = [] without
    // aborting the whole script.
    projectRoot = setupTree({
      'src/real.ts': `import { thing } from './other';\nexport const x = 1;\n`,
      'src/other.ts': `export const thing = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/real.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/other.ts', language: 'typescript', fileCategory: 'code' },
        // Declared but does not exist on disk
        { path: 'src/missing.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Script completed cleanly
    expect(result.output.scriptCompleted).toBe(true);
    // Real files resolved
    expect(result.output.importMap['src/real.ts']).toEqual(['src/other.ts']);
    expect(result.output.importMap['src/other.ts']).toEqual([]);
    // Missing file is in importMap with []
    expect(result.output.importMap['src/missing.ts']).toEqual([]);
    // A warning was emitted on stderr for the missing file
    expect(result.stderr).toMatch(/Warning: extract-import-map: import resolution failed for src\/missing\.ts/);
    expect(result.stderr).toMatch(/importMap\[src\/missing\.ts\]=\[\]/);
  });

  it('emits a stats summary on stderr', () => {
    projectRoot = setupTree({
      'a.ts': `import { b } from './b';\n`,
      'b.ts': `export const b = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'b.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /extract-import-map: filesScanned=2 filesWithImports=1 totalEdges=1/,
    );
  });
});

describe('extract-import-map.mjs — output schema invariants', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('every input file appears in importMap (even with zero imports)', () => {
    projectRoot = setupTree({
      'a.ts': `// no imports\nexport const a = 1;\n`,
      'README.md': '# x\n',
      'Dockerfile': 'FROM node:22\n',
      'package.json': '{}\n',
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'README.md', language: 'markdown', fileCategory: 'docs' },
        { path: 'Dockerfile', language: 'dockerfile', fileCategory: 'infra' },
        { path: 'package.json', language: 'json', fileCategory: 'config' },
      ],
    });

    expect(result.status).toBe(0);
    expect(Object.keys(result.output.importMap).sort()).toEqual([
      'Dockerfile', 'README.md', 'a.ts', 'package.json',
    ]);
    for (const arr of Object.values(result.output.importMap)) {
      expect(Array.isArray(arr)).toBe(true);
    }
  });

  it('produces deterministic output across runs', () => {
    projectRoot = setupTree({
      'src/a.ts': `import { b } from './b';\nimport { c } from './c';\n`,
      'src/b.ts': `export const b = 1;\n`,
      'src/c.ts': `export const c = 2;\n`,
    });

    const input = {
      projectRoot,
      files: [
        { path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/b.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/c.ts', language: 'typescript', fileCategory: 'code' },
      ],
    };

    const r1 = runScript(projectRoot, input);
    const r2 = runScript(projectRoot, input);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
  });
});

// ===========================================================================
// Hardening regression tests
//
// These tests cover the failure modes called out in code review:
//   - graceful tree-sitter init failure (IMPORTANT 1)
//   - tsconfig parse resilience (IMPORTANT 2)
//   - comment-aware import regexes for JS/Ruby/Rust (MINOR 4)
//   - tighter Kotlin import grammar (MINOR 5)
//   - multi-match Gradle/Maven dotted-FQN behavior (MINOR 6)
//   - composer.json malformed warning (MINOR 7)
//   - Rust 'use crate::' with no crate root — one-time warning (MINOR 9)
// ===========================================================================

describe('extract-import-map.mjs — regex comment-strip resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('JS require() inside a // line comment is NOT picked up', () => {
    projectRoot = setupTree({
      'src/index.js':
        `// require('./fake');  <- commented out, must be ignored\n` +
        `/* require('./alsofake'); also commented */\n` +
        `const real = require('./real');\n`,
      'src/real.js': `module.exports = { x: 1 };\n`,
      'src/fake.js': `module.exports = { fake: true };\n`,
      'src/alsofake.js': `module.exports = { fake: true };\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/index.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/real.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/fake.js', language: 'javascript', fileCategory: 'code' },
        { path: 'src/alsofake.js', language: 'javascript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Only the real require survives; both commented-out requires are dropped.
    expect(result.output.importMap['src/index.js']).toEqual(['src/real.js']);
    expect(result.output.importMap['src/index.js']).not.toContain('src/fake.js');
    expect(result.output.importMap['src/index.js']).not.toContain('src/alsofake.js');
  });

  it('Ruby require inside a # line comment is NOT picked up', () => {
    projectRoot = setupTree({
      'app.rb':
        `# require 'fake'  -- commented out, must be ignored\n` +
        `require 'real'\n`,
      'lib/real.rb': `module Real; end\n`,
      'lib/fake.rb': `module Fake; end\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'app.rb', language: 'ruby', fileCategory: 'code' },
        { path: 'lib/real.rb', language: 'ruby', fileCategory: 'code' },
        { path: 'lib/fake.rb', language: 'ruby', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['app.rb']).toEqual(['lib/real.rb']);
    expect(result.output.importMap['app.rb']).not.toContain('lib/fake.rb');
  });

  it('Rust mod declarations inside // and /* */ comments are NOT picked up', () => {
    projectRoot = setupTree({
      'Cargo.toml': `[package]\nname = "demo"\nversion = "0.1.0"\n`,
      'src/lib.rs':
        `// mod fake_line;  <- commented out\n` +
        `/* mod fake_block; */\n` +
        `pub mod real;\n`,
      'src/real.rs': `pub fn r() { }\n`,
      'src/fake_line.rs': `pub fn f() { }\n`,
      'src/fake_block.rs': `pub fn f() { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Cargo.toml', language: 'toml', fileCategory: 'config' },
        { path: 'src/lib.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/real.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/fake_line.rs', language: 'rust', fileCategory: 'code' },
        { path: 'src/fake_block.rs', language: 'rust', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['src/lib.rs']).toEqual(['src/real.rs']);
    expect(result.output.importMap['src/lib.rs']).not.toContain('src/fake_line.rs');
    expect(result.output.importMap['src/lib.rs']).not.toContain('src/fake_block.rs');
  });
});

describe('extract-import-map.mjs — Kotlin import grammar', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('does NOT phantom-resolve `import ...` or `import .foo`', () => {
    // Pathological inputs the tightened regex should reject. If they slipped
    // through, the dotted resolver would turn '...' into '/.../<ext>' lookups
    // or '.foo' into '/foo.kt' — both bogus.
    projectRoot = setupTree({
      'src/Main.kt':
        `package com.example\n\n` +
        `import ...\n` +              // garbage line
        `import .foo\n` +              // leading-dot garbage line
        `import com.example.real.Bar\n`,
      'src/com/example/real/Bar.kt':
        `package com.example.real\nclass Bar\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/Main.kt', language: 'kotlin', fileCategory: 'code' },
        { path: 'src/com/example/real/Bar.kt', language: 'kotlin', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Only the valid import resolves. The garbage lines must not produce
    // phantom entries.
    expect(result.output.importMap['src/Main.kt']).toEqual([
      'src/com/example/real/Bar.kt',
    ]);
  });
});

describe('extract-import-map.mjs — multi-source-root dotted FQN (Gradle/Maven)', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('returns BOTH matches when a Java FQN suffix exists in two source roots', () => {
    // Multi-module Gradle layout: two `Bar.java` files both at .../com/foo/Bar.java
    // but rooted in different source trees. The resolver intentionally returns
    // both so the structural graph reflects every plausible target.
    projectRoot = setupTree({
      'src/main/java/com/example/App.java':
        `package com.example;\nimport com.foo.Bar;\npublic class App { }\n`,
      'src/main/java/com/foo/Bar.java':
        `package com.foo;\npublic class Bar { }\n`,
      'lib/src/main/java/com/foo/Bar.java':
        `package com.foo;\npublic class Bar { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'src/main/java/com/example/App.java', language: 'java', fileCategory: 'code' },
        { path: 'src/main/java/com/foo/Bar.java', language: 'java', fileCategory: 'code' },
        { path: 'lib/src/main/java/com/foo/Bar.java', language: 'java', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Both source-root candidates appear, sorted via localeCompare.
    expect(result.output.importMap['src/main/java/com/example/App.java']).toEqual([
      'lib/src/main/java/com/foo/Bar.java',
      'src/main/java/com/foo/Bar.java',
    ]);
  });
});

describe('extract-import-map.mjs — composer.json malformed', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: and PHP imports fall back to empty when composer.json is broken', () => {
    projectRoot = setupTree({
      'composer.json': '{ "autoload": { "psr-4": { "App\\\\": "src/" }, ', // unterminated
      'src/Http/Controller.php':
        `<?php\nnamespace App\\Http;\n\nuse App\\Models\\User;\n\nclass Controller { }\n`,
      'src/Models/User.php':
        `<?php\nnamespace App\\Models;\nclass User { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'composer.json', language: 'json', fileCategory: 'config' },
        { path: 'src/Http/Controller.php', language: 'php', fileCategory: 'code' },
        { path: 'src/Models/User.php', language: 'php', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Warning fired on stderr (with the parse error context).
    expect(result.stderr).toMatch(
      /Warning: extract-import-map: composer\.json at .* failed to parse/,
    );
    expect(result.stderr).toMatch(/PSR-4 namespace mapping unavailable/);
    // Resolver returns empty for PHP imports — the autoload map is empty.
    expect(result.output.importMap['src/Http/Controller.php']).toEqual([]);
  });
});

describe('extract-import-map.mjs — tsconfig parse resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: when tsconfig.json is malformed and falls back to no aliases', () => {
    projectRoot = setupTree({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", ', // unterminated
      'src/index.ts':
        `import { foo } from '@/utils';\nimport { bar } from './sibling';\n`,
      'src/sibling.ts': `export const bar = 1;\n`,
      'src/utils.ts': `export const foo = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/sibling.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/utils.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /Warning: extract-import-map: tsconfig\.json at .* failed to parse/,
    );
    // Phrased "from this config" in the plural-tsconfigs implementation
    // because per-file walk-up now identifies the specific bad tsconfig.
    expect(result.stderr).toMatch(/path aliases.*will not be applied/);
    // Aliased import unresolved; relative import still resolves.
    expect(result.output.importMap['src/index.ts']).toEqual(['src/sibling.ts']);
  });

  it('falls back to raw-text parse when a paths value contains "//" that the stripper would damage', () => {
    // tsconfig with NO comments but a string literal containing "//". The
    // naive stripper would chew the second `//` away and break the JSON;
    // the raw-text fallback should rescue the parse.
    const tsconfigRaw = `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@scheme//foo/*": ["src/foo/*"]
    }
  }
}
`;
    projectRoot = setupTree({
      'tsconfig.json': tsconfigRaw,
      'src/index.ts': `import { x } from '@scheme//foo/bar';\n`,
      'src/foo/bar.ts': `export const x = 1;\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/foo/bar.ts', language: 'typescript', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Either path: the stripper damages the string but the raw retry rescues,
    // OR the stripper happens not to damage it. Either way, no warning fires
    // and the alias must resolve.
    expect(result.stderr).not.toMatch(/tsconfig\.json .* failed to parse/);
    expect(result.output.importMap['src/index.ts']).toEqual(['src/foo/bar.ts']);
  });
});

describe('extract-import-map.mjs — Rust crate root missing', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a one-time Warning: per file when use crate:: has no crate root', () => {
    // A Rust file that uses `crate::` but has neither src/lib.rs nor
    // src/main.rs anywhere up its tree. Two `use crate::` statements should
    // produce ONE warning, not two.
    projectRoot = setupTree({
      'Cargo.toml': `[package]\nname = "demo"\nversion = "0.1.0"\n`,
      // No src/lib.rs and no src/main.rs — but two `use crate::` calls.
      'app/something.rs':
        `use crate::auth::login;\nuse crate::db::query;\nfn boot() { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Cargo.toml', language: 'toml', fileCategory: 'config' },
        { path: 'app/something.rs', language: 'rust', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Importer file gets the warning exactly once even though there are two
    // unresolvable `use crate::` statements.
    const crateRootWarnings = result.stderr
      .split('\n')
      .filter(l => l.includes('no crate root'));
    expect(crateRootWarnings).toHaveLength(1);
    expect(crateRootWarnings[0]).toMatch(
      /Warning: extract-import-map: Rust file app\/something\.rs has 'use crate::' but no crate root/,
    );
    // And the importMap stays empty for that file.
    expect(result.output.importMap['app/something.rs']).toEqual([]);
  });
});

describe('extract-import-map.mjs — tree-sitter init graceful failure', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: and produces empty importMap entries when tree-sitter init throws', () => {
    // Force tree-sitter init to fail by intercepting the `web-tree-sitter`
    // module load with an ESM loader hook. This simulates the real-world
    // failure mode where the WASM grammar binaries are missing or
    // inaccessible (cache eviction, restricted sandbox, etc.).
    projectRoot = setupTree({
      'src/index.ts': `import { x } from './lib';\nexport const y = x;\n`,
      'src/lib.ts': `export const x = 1;\n`,
    });

    // Write the loader hook + register module to the temp project root.
    const hookPath = join(projectRoot, 'ua-eim-fail-hook.mjs');
    const loaderPath = join(projectRoot, 'ua-eim-fail-loader.mjs');
    writeFileSync(
      hookPath,
      `export async function resolve(specifier, ctx, nextResolve) {\n` +
      `  if (specifier === 'web-tree-sitter') {\n` +
      `    throw new Error('synthetic: web-tree-sitter unavailable in test');\n` +
      `  }\n` +
      `  return nextResolve(specifier, ctx);\n` +
      `}\n`,
      'utf-8',
    );
    writeFileSync(
      loaderPath,
      `import { register } from 'node:module';\n` +
      `import { pathToFileURL } from 'node:url';\n` +
      `register(pathToFileURL(${JSON.stringify(hookPath)}).href);\n`,
      'utf-8',
    );

    const result = runScript(
      projectRoot,
      {
        projectRoot,
        files: [
          { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
          { path: 'src/lib.ts', language: 'typescript', fileCategory: 'code' },
        ],
      },
      ['--import', loaderPath],
    );

    expect(result.status).toBe(0);
    // Script completed cleanly with the documented degraded output.
    expect(result.output.scriptCompleted).toBe(true);
    expect(result.stderr).toMatch(
      /Warning: extract-import-map: tree-sitter init failed/,
    );
    expect(result.stderr).toMatch(/structural graph will have no import edges/);
    // Both code files get empty importMap entries.
    expect(result.output.importMap['src/index.ts']).toEqual([]);
    expect(result.output.importMap['src/lib.ts']).toEqual([]);
    // Stats reflect the degraded run: no edges, no files with imports.
    expect(result.output.stats.filesScanned).toBe(2);
    expect(result.output.stats.filesWithImports).toBe(0);
    expect(result.output.stats.totalEdges).toBe(0);
  });
});

describe('extract-import-map.mjs — deterministic stderr ordering across loaders', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  // Regression for the parallel-loader stderr-order bug surfaced in
  // PR #346 review: tsconfig / go.mod / composer.json loaders now run
  // concurrently, but warnings must still emit in the pre-PR canonical
  // order (tsconfig → go → php). If the loaders streamed warnings
  // mid-flight, I/O timing could reorder them — the assertions below
  // catch that regression.
  it('emits warnings in canonical order (tsconfig, go, php) regardless of I/O timing', () => {
    projectRoot = setupTree({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", ', // unterminated
      'composer.json': '{ "autoload": { "psr-4": { "App\\\\": "src/" }, ', // unterminated
      'src/index.ts': `import { foo } from './foo';\n`,
      'src/foo.ts': `export const foo = 1;\n`,
      'src/Http/Controller.php':
        `<?php\nnamespace App\\Http;\n\nuse App\\Models\\User;\n\nclass Controller { }\n`,
      'src/Models/User.php':
        `<?php\nnamespace App\\Models;\nclass User { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'tsconfig.json', language: 'json', fileCategory: 'config' },
        { path: 'composer.json', language: 'json', fileCategory: 'config' },
        { path: 'src/index.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/foo.ts', language: 'typescript', fileCategory: 'code' },
        { path: 'src/Http/Controller.php', language: 'php', fileCategory: 'code' },
        { path: 'src/Models/User.php', language: 'php', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    const tsLineIdx = result.stderr.indexOf('tsconfig.json at');
    const composerLineIdx = result.stderr.indexOf('composer.json at');
    expect(tsLineIdx).toBeGreaterThanOrEqual(0);
    expect(composerLineIdx).toBeGreaterThanOrEqual(0);
    // Canonical order: tsconfig warnings precede composer warnings.
    // Pre-PR-346 this fell out of sequential loader passes; post-fix it
    // falls out of buffering + ordered drain in buildResolutionContext.
    expect(tsLineIdx).toBeLessThan(composerLineIdx);
  });
});
