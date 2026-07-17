import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
  chmodSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/scan-project.mjs',
);

function collectMembership(projectRoot, excludePatterns = []) {
  const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { collectProjectMembership } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
    const membership = collectProjectMembership(
      ${JSON.stringify(projectRoot)},
      ${JSON.stringify(excludePatterns)},
    );
    process.stdout.write(JSON.stringify({
      ...membership,
      realPaths: [...membership.realPaths],
    }));
  `], { encoding: 'utf-8' });
  expect(probe.status, probe.stderr).toBe(0);
  const membership = JSON.parse(probe.stdout);
  membership.realPaths = new Map(membership.realPaths);
  return membership;
}

function runProjectContext(projectRoot, membership) {
  const serializedMembership = {
    ...membership,
    realPaths: [...membership.realPaths],
  };
  const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { collectProjectContext } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
    const membership = ${JSON.stringify(serializedMembership)};
    membership.realPaths = new Map(membership.realPaths);
    const context = collectProjectContext(${JSON.stringify(projectRoot)}, membership);
    process.stdout.write(JSON.stringify(context));
  `], { encoding: 'utf-8' });
  return {
    status: probe.status,
    stderr: probe.stderr,
    output: probe.status === 0 ? JSON.parse(probe.stdout) : null,
  };
}

/**
 * Build a project tree from a `{ relPath: contents }` object. Creates parent
 * directories as needed. Initializes a real git repo so the script's preferred
 * `git ls-files` enumeration path is exercised — tests that need the walker
 * fallback can set `gitInit=false`.
 */
function setupTree(files, { gitInit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-scan-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  if (gitInit) {
    // `git ls-files -co --exclude-standard` returns BOTH cached and others
    // (modulo gitignore), so an `add` is unnecessary for our tests — the
    // bare repo init is enough for ls-files to enumerate.
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });
    if (init.status !== 0) {
      // CI without git: continue without it; the walker fallback will fire.
    }
  }
  return root;
}

/**
 * Tracks every temp output dir created by runScript() so the global
 * cleanup can sweep them between tests. The output file must live
 * OUTSIDE projectRoot so test output never becomes scanner input. The
 * reserved project data directories are covered directly below.
 */
const _runScriptOutputDirs = [];

/**
 * Run scan-project.mjs against `projectRoot`. Returns
 * { status, stdout, stderr, output } where `output` is the parsed JSON
 * written by the script (or null on failure).
 */
function runScript(projectRoot, extraArgs = [], env = process.env) {
  const outputDir = mkdtempSync(join(tmpdir(), 'ua-scan-out-'));
  _runScriptOutputDirs.push(outputDir);
  const outputPath = join(outputDir, 'scan-output.json');
  const result = spawnSync(process.execPath, [SCRIPT, projectRoot, outputPath, ...extraArgs], {
    encoding: 'utf-8',
    env,
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

/**
 * Look up the `files[]` entry for a given path. Returns undefined if not
 * present — callers should `expect(byPath('x')).toBeDefined()` first.
 */
function byPath(output, path) {
  return output.files.find(f => f.path === path);
}

// Sweep every output dir created during a test back to disk-empty between
// tests. The top-level afterEach fires after each `it()` regardless of which
// describe block it lives in, so a single hook covers the whole file.
afterEach(() => {
  while (_runScriptOutputDirs.length) {
    const d = _runScriptOutputDirs.pop();
    rmSync(d, { recursive: true, force: true });
  }
});

describe('scan-project.mjs — language detection', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('maps TypeScript/JavaScript extensions to typescript/javascript', () => {
    projectRoot = setupTree({
      'a.ts': 'export const a = 1;\n',
      'b.tsx': 'export const B = () => null;\n',
      'c.js': 'module.exports = {};\n',
      'd.jsx': 'export default () => null;\n',
      'e.mjs': 'export const e = 1;\n',
      'f.cjs': 'module.exports = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.ts').language).toBe('typescript');
    expect(byPath(r.output, 'b.tsx').language).toBe('typescript');
    expect(byPath(r.output, 'c.js').language).toBe('javascript');
    expect(byPath(r.output, 'd.jsx').language).toBe('javascript');
    expect(byPath(r.output, 'e.mjs').language).toBe('javascript');
    expect(byPath(r.output, 'f.cjs').language).toBe('javascript');
  });

  it('maps Python, Go, Rust, Java, Kotlin, C#, Swift to their language ids', () => {
    projectRoot = setupTree({
      'a.py': 'x = 1\n',
      'b.go': 'package main\n',
      'c.rs': 'fn main() {}\n',
      'd.java': 'class D {}\n',
      'e.kt': 'fun main() {}\n',
      'f.cs': 'class F {}\n',
      'g.swift': 'struct G {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.py').language).toBe('python');
    expect(byPath(r.output, 'b.go').language).toBe('go');
    expect(byPath(r.output, 'c.rs').language).toBe('rust');
    expect(byPath(r.output, 'd.java').language).toBe('java');
    expect(byPath(r.output, 'e.kt').language).toBe('kotlin');
    expect(byPath(r.output, 'f.cs').language).toBe('csharp');
    expect(byPath(r.output, 'g.swift').language).toBe('swift');
  });

  it('maps Scala extensions to scala (with .sbt categorized as config)', () => {
    projectRoot = setupTree({
      'src/main/scala/App.scala': 'object App\n',
      'scripts/task.sc': 'println(1)\n',
      'build.sbt': 'name := "demo"\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'src/main/scala/App.scala').language).toBe('scala');
    expect(byPath(r.output, 'src/main/scala/App.scala').fileCategory).toBe('code');
    expect(byPath(r.output, 'scripts/task.sc').language).toBe('scala');
    expect(byPath(r.output, 'build.sbt').language).toBe('scala');
    expect(byPath(r.output, 'build.sbt').fileCategory).toBe('config');
  });

  it('maps Ruby, PHP, C, C++ to their language ids', () => {
    projectRoot = setupTree({
      'a.rb': 'puts 1\n',
      'b.php': '<?php echo 1;\n',
      'c.c': 'int main() { return 0; }\n',
      'd.h': 'void f();\n',
      'e.cpp': 'int main() {}\n',
      'f.hpp': 'class F {};\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.rb').language).toBe('ruby');
    expect(byPath(r.output, 'b.php').language).toBe('php');
    expect(byPath(r.output, 'c.c').language).toBe('c');
    expect(byPath(r.output, 'd.h').language).toBe('c');
    expect(byPath(r.output, 'e.cpp').language).toBe('cpp');
    expect(byPath(r.output, 'f.hpp').language).toBe('cpp');
  });

  it('maps web markup (HTML, CSS) to their language ids', () => {
    projectRoot = setupTree({
      'a.html': '<!doctype html><html></html>\n',
      'b.htm': '<html></html>\n',
      'c.css': '.a { }\n',
      'd.scss': '$x: 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.html').language).toBe('html');
    expect(byPath(r.output, 'b.htm').language).toBe('html');
    expect(byPath(r.output, 'c.css').language).toBe('css');
    expect(byPath(r.output, 'd.scss').language).toBe('css');
  });

  it('maps configuration formats (YAML, JSON, JSONC, TOML, XML, Markdown) to their language ids', () => {
    projectRoot = setupTree({
      'a.yaml': 'x: 1\n',
      'b.yml': 'x: 1\n',
      'c.json': '{}\n',
      'd.jsonc': '{ /* c */ }\n',
      'e.toml': 'x = 1\n',
      'f.xml': '<x/>\n',
      'g.md': '# h\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.yaml').language).toBe('yaml');
    expect(byPath(r.output, 'b.yml').language).toBe('yaml');
    expect(byPath(r.output, 'c.json').language).toBe('json');
    expect(byPath(r.output, 'd.jsonc').language).toBe('jsonc');
    expect(byPath(r.output, 'e.toml').language).toBe('toml');
    expect(byPath(r.output, 'f.xml').language).toBe('xml');
    expect(byPath(r.output, 'g.md').language).toBe('markdown');
  });

  it('maps shell + batch + Dockerfile (no extension) to their language ids', () => {
    projectRoot = setupTree({
      'a.sh': 'echo 1\n',
      'b.bat': '@echo off\n',
      Dockerfile: 'FROM node:22\n',
      'Dockerfile.dev': 'FROM node:22\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.sh').language).toBe('shell');
    expect(byPath(r.output, 'b.bat').language).toBe('batch');
    expect(byPath(r.output, 'Dockerfile').language).toBe('dockerfile');
    expect(byPath(r.output, 'Dockerfile.dev').language).toBe('dockerfile');
  });

  it('falls back to "unknown" for files with no extension and no filename match', () => {
    projectRoot = setupTree({
      WEIRD_FILE: 'mystery contents\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'WEIRD_FILE').language).toBe('unknown');
  });

  it('falls back to bare extension (without dot) for unknown extensions', () => {
    projectRoot = setupTree({
      'data.weirdext': 'some data\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'data.weirdext').language).toBe('weirdext');
  });
});

describe('scan-project.mjs — category assignment (project-scanner.md Step 4)', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('assigns code to TypeScript, JavaScript, Python, Go, Rust, Swift source files', () => {
    projectRoot = setupTree({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.py': 'def b(): pass\n',
      'src/c.go': 'package main\n',
      'src/d.rs': 'fn main() {}\n',
      'src/e.swift': 'struct E {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'src/a.ts').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/b.py').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/c.go').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/d.rs').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/e.swift').fileCategory).toBe('code');
  });

  it('assigns config to JSON/YAML/TOML/INI/XML', () => {
    projectRoot = setupTree({
      'package.json': '{}\n',
      'tsconfig.json': '{}\n',
      'pyproject.toml': '[project]\nname = "p"\n',
      'config.yaml': 'x: 1\n',
      'app.ini': '[s]\nk=v\n',
      'data.xml': '<x/>\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'package.json').fileCategory).toBe('config');
    expect(byPath(r.output, 'tsconfig.json').fileCategory).toBe('config');
    expect(byPath(r.output, 'pyproject.toml').fileCategory).toBe('config');
    expect(byPath(r.output, 'config.yaml').fileCategory).toBe('config');
    expect(byPath(r.output, 'app.ini').fileCategory).toBe('config');
    expect(byPath(r.output, 'data.xml').fileCategory).toBe('config');
  });

  it('assigns docs to .md / .rst / .txt (but NOT to LICENSE)', () => {
    projectRoot = setupTree({
      'README.md': '# x\n',
      'docs/guide.rst': 'Guide\n=====\n',
      'NOTES.txt': 'notes\n',
      LICENSE: 'Apache-2.0\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'README.md').fileCategory).toBe('docs');
    expect(byPath(r.output, 'docs/guide.rst').fileCategory).toBe('docs');
    expect(byPath(r.output, 'NOTES.txt').fileCategory).toBe('docs');
    // LICENSE exception: must NOT be docs. The default ignore filter
    // normally drops LICENSE entirely, so we re-include it via
    // `!LICENSE` so the category test can fire.
    writeFileSync(join(projectRoot, '.understandignore'), '!LICENSE\n');
    const r2 = runScript(projectRoot);
    const license = byPath(r2.output, 'LICENSE');
    expect(license).toBeDefined();
    expect(license.fileCategory).not.toBe('docs');
  });

  it('assigns infra to Dockerfile, docker-compose, .gitlab-ci.yml, .tf, .github/workflows/, Makefile, Jenkinsfile, k8s paths', () => {
    projectRoot = setupTree({
      Dockerfile: 'FROM node:22\n',
      'docker-compose.yml': 'services: {}\n',
      '.gitlab-ci.yml': 'stages: []\n',
      'infra/main.tf': 'resource "x" "y" {}\n',
      '.github/workflows/ci.yml': 'name: ci\n',
      Makefile: 'all:\n\t@echo hi\n',
      Jenkinsfile: 'pipeline { }\n',
      'k8s/deploy.yaml': 'kind: Deployment\n',
      'kubernetes/svc.yaml': 'kind: Service\n',
      'foo.k8s.yaml': 'kind: ConfigMap\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'Dockerfile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'docker-compose.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, '.gitlab-ci.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'infra/main.tf').fileCategory).toBe('infra');
    expect(byPath(r.output, '.github/workflows/ci.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'Makefile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'Jenkinsfile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'k8s/deploy.yaml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'kubernetes/svc.yaml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'foo.k8s.yaml').fileCategory).toBe('infra');
  });

  it('assigns data to SQL, GraphQL, Proto, Prisma, CSV', () => {
    projectRoot = setupTree({
      'db/schema.sql': 'CREATE TABLE x (id INT);\n',
      'api/schema.graphql': 'type X { id: ID! }\n',
      'api/types.proto': 'syntax = "proto3";\n',
      'prisma/schema.prisma': 'model X { id Int @id }\n',
      'data/seed.csv': 'a,b\n1,2\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'db/schema.sql').fileCategory).toBe('data');
    expect(byPath(r.output, 'api/schema.graphql').fileCategory).toBe('data');
    expect(byPath(r.output, 'api/types.proto').fileCategory).toBe('data');
    expect(byPath(r.output, 'prisma/schema.prisma').fileCategory).toBe('data');
    expect(byPath(r.output, 'data/seed.csv').fileCategory).toBe('data');
  });

  it('assigns script to shell + batch files (.sh, .bash, .ps1, .bat)', () => {
    projectRoot = setupTree({
      'scripts/build.sh': '#!/bin/bash\necho 1\n',
      'scripts/run.bash': '#!/bin/bash\necho run\n',
      'scripts/build.ps1': 'Write-Output 1\n',
      'scripts/setup.bat': '@echo off\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'scripts/build.sh').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/run.bash').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/build.ps1').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/setup.bat').fileCategory).toBe('script');
  });

  it('assigns markup to HTML + CSS variants', () => {
    projectRoot = setupTree({
      'public/index.html': '<!doctype html>\n',
      'public/page.htm': '<html></html>\n',
      'styles/app.css': 'body { }\n',
      'styles/app.scss': '$x: 1;\n',
      'styles/app.less': '@x: 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'public/index.html').fileCategory).toBe('markup');
    expect(byPath(r.output, 'public/page.htm').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.css').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.scss').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.less').fileCategory).toBe('markup');
  });

  it('priority: docker-compose.yml maps to infra, not config', () => {
    // The .yml extension would normally route to `config`, but the
    // docker-compose.* filename rule fires first per Step 4 priority.
    projectRoot = setupTree({
      'docker-compose.yml': 'services: {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'docker-compose.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'docker-compose.yml').language).toBe('yaml');
  });

  // Regression: path.extname returns '' for `.env` and the second segment
  // for `.env.local` — neither hits CATEGORY_BY_EXT['.env']. Dotfile-style
  // configs were falling through to `code` / `unknown`. Caught by Codex
  // review on PR #204.
  it('dotfile configs (.env, .env.local, .env.production) map to config + env language', () => {
    projectRoot = setupTree({
      '.env': 'API_KEY=abc\n',
      '.env.local': 'LOCAL=1\n',
      '.env.production': 'PROD=1\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    for (const p of ['.env', '.env.local', '.env.production']) {
      expect(byPath(r.output, p).fileCategory).toBe('config');
      // LANGUAGE_BY_EXT['.env'] -> 'config' (the language id itself; not
      // a typo — the language for env files is the 'config' bucket).
      expect(byPath(r.output, p).language).toBe('config');
    }
  });
});

describe('scan-project.mjs — .understandignore handling', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('respects .understandignore patterns and increments filteredByIgnore', () => {
    // `**/*.log` is NOT in the hardcoded defaults at the recursive level
    // — wait, `*.log` is. Use a custom pattern to exercise user-driven drops.
    projectRoot = setupTree({
      '.understandignore': 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    // fixtures/ files dropped
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeUndefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeUndefined();
    // Counted as user-driven
    expect(r.output.filteredByIgnore).toBe(2);
  });

  it('preserves multiple ignore-file patterns in their original order', () => {
    projectRoot = setupTree({
      '.understandignore': 'fixtures/first.data\ngenerated/second.data\n',
      'fixtures/first.data': 'ignored first\n',
      'generated/second.data': 'ignored second\n',
      'src/keep.ts': 'export const keep = true;\n',
    });

    const result = runScript(projectRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(byPath(result.output, 'fixtures/first.data')).toBeUndefined();
    expect(byPath(result.output, 'generated/second.data')).toBeUndefined();
    expect(byPath(result.output, 'src/keep.ts')).toBeDefined();
    expect(result.output.filteredByIgnore).toBe(2);
  });

  it('supports `!pattern` negation to re-include defaults-excluded files', () => {
    // `*.log` is in the hardcoded defaults; the user re-includes a
    // specific file with `!keep.log`. After the override, keep.log MUST
    // appear in the output. It is NOT counted in filteredByIgnore (it
    // was re-included, not additionally filtered).
    projectRoot = setupTree({
      '.understandignore': '!keep.log\n',
      'src/index.ts': 'export const x = 1;\n',
      'keep.log': 'important diagnostic\n',
      'drop.log': 'noise\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'keep.log')).toBeDefined();
    // drop.log still excluded by defaults (no negation for it)
    expect(byPath(r.output, 'drop.log')).toBeUndefined();
    // The defaults dropped drop.log — that's a baseline default drop,
    // NOT a user-driven drop. filteredByIgnore should be 0.
    expect(r.output.filteredByIgnore).toBe(0);
  });
});

describe('scan-project.mjs membership-only enumeration', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('matches full-scan membership while applying every scanner filter without content metadata', () => {
    projectRoot = setupTree({
      '.gitignore': 'ignored-by-git.ts\n',
      '.understandignore': 'ignored-by-understand.ts\n',
      '.ua/private.ts': 'export const privateUa = true;\n',
      '.understand-anything/private.ts': 'export const privateLegacy = true;\n',
      'src/keep.ts': 'export const keep = true;\n',
      'tests/excluded.ts': 'export const excluded = true;\n',
      'ignored-by-git.ts': 'export const ignoredByGit = true;\n',
      'ignored-by-understand.ts': 'export const ignoredByUnderstand = true;\n',
    });

    const full = runScript(projectRoot, ['--exclude', 'tests/**']);
    expect(full.status, full.stderr).toBe(0);

    const membership = collectMembership(projectRoot, ['tests/**']);
    expect(membership.degraded).toBe(false);
    expect(membership.paths).toEqual(full.output.files.map(file => file.path));
    expect([...membership.realPaths.keys()]).toEqual(membership.paths);
    for (const [path, realPath] of membership.realPaths) {
      expect(realPath).toBe(realpathSync(join(projectRoot, ...path.split('/'))));
    }
    expect(membership).not.toHaveProperty('files');
    expect(membership).not.toHaveProperty('sizeLines');
  });

  it('marks fallback enumeration as degraded when a directory cannot be read', () => {
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) return;
    projectRoot = setupTree({
      'src/keep.ts': 'export const keep = true;\n',
      'locked/private.ts': 'export const privateValue = true;\n',
    }, { gitInit: false });
    const lockedDir = join(projectRoot, 'locked');
    chmodSync(lockedDir, 0o000);

    try {
      const membership = collectMembership(projectRoot);
      expect(membership.degraded).toBe(true);
      expect(membership.paths).toEqual(['src/keep.ts']);

      const full = runScript(projectRoot);
      expect(full.status, full.stderr).toBe(0);
      expect(full.output.degraded).toBe(true);
      expect(full.output.files.map(file => file.path)).toEqual(['src/keep.ts']);
    } finally {
      chmodSync(lockedDir, 0o755);
    }
  });

  it('deterministically skips an initialized gitlink directory without degrading membership', () => {
    projectRoot = setupTree({
      'root.txt': 'root file\n',
    });
    const add = spawnSync('git', ['add', 'root.txt'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    expect(add.status, add.stderr).toBe(0);
    const commit = spawnSync('git', [
      '-c', 'user.name=UA Test',
      '-c', 'user.email=ua-test@example.invalid',
      'commit', '-q', '-m', 'fixture root',
    ], { cwd: projectRoot, encoding: 'utf8' });
    expect(commit.status, commit.stderr).toBe(0);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).stdout.trim();
    mkdirSync(join(projectRoot, 'libs', 'child'), { recursive: true });
    writeFileSync(join(projectRoot, 'libs', 'child', 'child.txt'), 'child\n', 'utf8');
    const gitlink = spawnSync('git', [
      'update-index', '--add', '--cacheinfo', `160000,${head},libs/child`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    expect(gitlink.status, gitlink.stderr).toBe(0);
    const staged = spawnSync('git', ['ls-files', '--stage', '--', 'libs/child'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    expect(staged.stdout).toMatch(/^160000 /);

    const membership = collectMembership(projectRoot);
    const full = runScript(projectRoot);

    expect(membership.degraded).toBe(false);
    expect(membership.paths).toEqual(['root.txt']);
    expect(full.status, full.stderr).toBe(0);
    expect(full.output.degraded).toBe(false);
    expect(full.output.files.map(file => file.path)).toEqual(['root.txt']);
  });
});

describe('scan-project.mjs — CLI --exclude', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('applies comma-separated --exclude patterns and counts only additional drops', () => {
    projectRoot = setupTree({
      'src/keep.ts': 'export const keep = true;\n',
      'src/drop.ts': 'export const drop = true;\n',
      'docs/drop.md': '# excluded\n',
      'debug.log': 'default-only drop\n',
    });

    const r = runScript(projectRoot, [
      '--exclude',
      ' src/drop.ts, , docs/** ,',
    ]);

    expect(r.status, r.stderr).toBe(0);
    expect(r.output.excludePatterns).toEqual(['src/drop.ts', 'docs/**']);
    expect(byPath(r.output, 'src/keep.ts')).toBeDefined();
    expect(byPath(r.output, 'src/drop.ts')).toBeUndefined();
    expect(byPath(r.output, 'docs/drop.md')).toBeUndefined();
    expect(byPath(r.output, 'debug.log')).toBeUndefined();
    expect(r.output.filteredByIgnore).toBe(2);
  });

  it.each([
    ['Git', true],
    ['fallback walker', false],
  ])('keeps reserved roots hard-excluded and uncounted despite CLI negation via %s enumeration',
    (_label, gitInit) => {
      projectRoot = setupTree({
        '.ua/knowledge-graph.json': '{}\n',
        '.understand-anything/meta.json': '{}\n',
        'src/.ua/example.ts': 'export const nested = true;\n',
        'src/index.ts': 'export const keep = true;\n',
      }, { gitInit });

      const r = runScript(projectRoot, [
        '--exclude',
        '!.ua/**,!.understand-anything/**',
      ]);

      expect(r.status, r.stderr).toBe(0);
      expect(r.output.excludePatterns).toEqual([
        '!.ua/**',
        '!.understand-anything/**',
      ]);
      expect(byPath(r.output, '.ua/knowledge-graph.json')).toBeUndefined();
      expect(byPath(r.output, '.understand-anything/meta.json')).toBeUndefined();
      expect(byPath(r.output, 'src/.ua/example.ts')).toBeDefined();
      expect(byPath(r.output, 'src/index.ts')).toBeDefined();
      expect(r.output.filteredByIgnore).toBe(0);
    });
});

describe('scan-project.mjs — reserved root data directories', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it.each([
    ['Git', true],
    ['fallback walker', false],
  ])('hard-excludes reserved roots before ignore negation via %s enumeration', (_, gitInit) => {
    projectRoot = setupTree({
      '.understandignore': '!.ua/**\n!.understand-anything/**\n',
      '.ua/knowledge-graph.json': '{}\n',
      '.understand-anything/meta.json': '{}\n',
      'src/.ua/example.ts': 'export const nested = true;\n',
      'src/index.ts': 'export const x = 1;\n',
    }, { gitInit });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, '.ua/knowledge-graph.json')).toBeUndefined();
    expect(byPath(r.output, '.understand-anything/meta.json')).toBeUndefined();
    expect(byPath(r.output, 'src/.ua/example.ts')).toBeDefined();
    expect(byPath(r.output, 'src/index.ts')).toBeDefined();
    expect(r.output.filteredByIgnore).toBe(0);
  });

  it.each([
    ['Git', true],
    ['fallback walker', false],
  ])('matches uppercase root data directories by platform via %s enumeration', (_, gitInit) => {
    projectRoot = setupTree({
      '.UA/knowledge-graph.json': '{}\n',
      '.UNDERSTAND-ANYTHING/meta.json': '{}\n',
      'src/.UA/example.ts': 'export const nestedUa = true;\n',
      'src/.UNDERSTAND-ANYTHING/example.ts': 'export const nestedLegacy = true;\n',
    }, { gitInit });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);

    if (process.platform === 'win32') {
      expect(byPath(r.output, '.UA/knowledge-graph.json')).toBeUndefined();
      expect(byPath(r.output, '.UNDERSTAND-ANYTHING/meta.json')).toBeUndefined();
    } else {
      expect(byPath(r.output, '.UA/knowledge-graph.json')).toBeDefined();
      expect(byPath(r.output, '.UNDERSTAND-ANYTHING/meta.json')).toBeDefined();
    }

    expect(byPath(r.output, 'src/.UA/example.ts')).toBeDefined();
    expect(byPath(r.output, 'src/.UNDERSTAND-ANYTHING/example.ts')).toBeDefined();
  });

  it('hard-excludes Git-enumerated aliases whose canonical targets are reserved roots', () => {
    projectRoot = setupTree({
      '.ua/private.ts': 'export const privateUa = true;\n',
      '.understand-anything/private.ts': 'export const privateLegacy = true;\n',
      'src/keep.ts': 'export const keep = true;\n',
    });

    const aliases = process.platform === 'win32'
      ? [
          ['ua-alias', join(projectRoot, '.ua'), 'junction', 'ua-alias/private.ts'],
          [
            'legacy-alias',
            join(projectRoot, '.understand-anything'),
            'junction',
            'legacy-alias/private.ts',
          ],
        ]
      : [
          ['ua-alias.ts', join(projectRoot, '.ua', 'private.ts'), 'file', 'ua-alias.ts'],
          [
            'legacy-alias.ts',
            join(projectRoot, '.understand-anything', 'private.ts'),
            'file',
            'legacy-alias.ts',
          ],
        ];
    for (const [name, target, type] of aliases) {
      symlinkSync(target, join(projectRoot, name), type);
    }

    const enumerated = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(enumerated.status, enumerated.stderr).toBe(0);
    const enumeratedPaths = enumerated.stdout.split('\0').filter(Boolean);
    for (const [, , , expectedPath] of aliases) {
      expect(enumeratedPaths).toContain(expectedPath);
    }

    const membership = collectMembership(projectRoot);
    const full = runScript(projectRoot);
    expect(full.status, full.stderr).toBe(0);
    for (const [, , , expectedPath] of aliases) {
      expect(membership.paths).not.toContain(expectedPath);
      expect(byPath(full.output, expectedPath)).toBeUndefined();
    }
    expect(membership.paths).toContain('src/keep.ts');
    expect(byPath(full.output, 'src/keep.ts')).toBeDefined();
  });
});

describe('scan-project.mjs — validated project context', () => {
  let projectRoot;
  let outsideRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
    if (outsideRoot) {
      rmSync(outsideRoot, { recursive: true, force: true });
      outsideRoot = null;
    }
  });

  it('derives bounded context only from the validated membership', () => {
    projectRoot = setupTree({
      'README.md': 'r'.repeat(3500),
      'package.json': '{"name":"fixture"}\n',
      'go.mod': 'module example.test/fixture\n',
      'src/index.ts': 'export const entry = true;\n',
      'main.py': 'print("secondary")\n',
      'docs/guide.md': '# Guide\n',
      'docs/deep/hidden.md': '# Too deep\n',
    });

    const result = runScript(projectRoot, ['--include-context']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.output.projectContext).toEqual({
      readme: { path: 'README.md', content: 'r'.repeat(3000), truncated: true },
      manifests: [
        { path: 'package.json', content: '{"name":"fixture"}\n', truncated: false },
        { path: 'go.mod', content: 'module example.test/fixture\n', truncated: false },
      ],
      directoryTree: [
        'docs/guide.md',
        'go.mod',
        'main.py',
        'package.json',
        'README.md',
        'src/index.ts',
      ],
      entryPoint: 'src/index.ts',
    });
  });

  it('degrades instead of failing when optional context becomes unreadable', () => {
    projectRoot = setupTree({
      'README.md': '# Optional context\n',
      'src/local.ts': 'export const local = true;\n',
    });
    const preloadDir = mkdtempSync(join(tmpdir(), 'ua-context-preload-'));
    _runScriptOutputDirs.push(preloadDir);
    const preloadPath = join(preloadDir, 'reject-readme-open.cjs');
    writeFileSync(preloadPath, `
      const fs = require('node:fs');
      const { syncBuiltinESMExports } = require('node:module');
      const { basename } = require('node:path');
      const originalOpenSync = fs.openSync;
      let readmeOpenCount = 0;
      fs.openSync = function(path, ...args) {
        if (
          basename(String(path)).toLowerCase() === 'readme.md'
          && readmeOpenCount++ > 0
        ) {
          const error = new Error('simulated context access failure');
          error.code = 'EACCES';
          throw error;
        }
        return originalOpenSync.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    `, 'utf8');
    const preloadSpecifier = preloadPath.replaceAll('\\', '/');
    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--require="${preloadSpecifier}"`,
    ].filter(Boolean).join(' ');

    const result = runScript(projectRoot, ['--include-context'], {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.output.degraded).toBe(true);
    expect(byPath(result.output, 'README.md')).toBeDefined();
    expect(result.output.projectContext.readme).toBeNull();
    expect(result.stderr).toMatch(/optional project context unavailable.*entry omitted/i);
  });

  it('never reads an ignored external context alias', () => {
    projectRoot = setupTree({
      '.understandignore': 'README.md\n',
      'src/local.ts': 'export const local = true;\n',
    });
    outsideRoot = mkdtempSync(join(tmpdir(), 'ua-context-secret-'));
    const secret = 'SECRET_EXTERNAL_CONTEXT';
    const target = process.platform === 'win32'
      ? outsideRoot
      : join(outsideRoot, 'README.md');
    if (process.platform !== 'win32') writeFileSync(target, secret, 'utf8');
    symlinkSync(
      target,
      join(projectRoot, 'README.md'),
      process.platform === 'win32' ? 'junction' : 'file',
    );

    const result = runScript(projectRoot, ['--include-context']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.output.projectContext.readme).toBeNull();
    expect(result.output.projectContext.directoryTree).not.toContain('README.md');
    expect(JSON.stringify(result.output)).not.toContain(secret);
    expect(JSON.stringify(result.output)).not.toContain(outsideRoot);
  });

  it('rejects a context alias into an ignored in-project target', () => {
    const secret = 'SECRET_IGNORED_INTERNAL_CONTEXT';
    projectRoot = setupTree({
      '.understandignore': 'private/\n',
      'private/secret.txt': secret,
      'src/local.ts': 'export const local = true;\n',
    });
    const secretPath = join(projectRoot, 'private', 'secret.txt');
    const readmePath = join(projectRoot, 'README.md');
    let membership;
    try {
      symlinkSync(secretPath, readmePath, 'file');
      membership = collectMembership(projectRoot);
      expect(membership.paths).toContain('README.md');
    } catch (error) {
      if (error?.code !== 'EPERM') throw error;
      symlinkSync(dirname(secretPath), readmePath, 'junction');
      membership = {
        paths: ['README.md'],
        realPaths: new Map([['README.md', secretPath]]),
      };
    }

    const result = runProjectContext(projectRoot, membership);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/security policy.*unsafe project context/i);
  });

  it('bounds each manifest and the combined manifest context', () => {
    projectRoot = setupTree({
      'package.json': '€'.repeat(7_000),
      'pyproject.toml': 'b'.repeat(20_000),
      'Cargo.toml': 'c'.repeat(20_000),
      'go.mod': 'd'.repeat(20_000),
      'pom.xml': 'e'.repeat(20_000),
      'src/local.ts': 'export const local = true;\n',
    });

    const result = runScript(projectRoot, ['--include-context']);

    expect(result.status, result.stderr).toBe(0);
    const manifests = result.output.projectContext.manifests;
    expect(manifests).toHaveLength(5);
    expect(manifests.every(
      manifest => Buffer.byteLength(manifest.content) <= 16 * 1024,
    )).toBe(true);
    expect(manifests.reduce((sum, manifest) => sum + Buffer.byteLength(manifest.content), 0))
      .toBeLessThanOrEqual(64 * 1024);
    expect(manifests.every(manifest => manifest.truncated === true)).toBe(true);
  });

  it('applies CLI exclusions to every context field', () => {
    projectRoot = setupTree({
      'README.md': '# Hidden\n',
      'package.json': '{"name":"hidden"}\n',
      'src/index.ts': 'export const hidden = true;\n',
      'src/keep.ts': 'export const keep = true;\n',
    });

    const result = runScript(projectRoot, [
      '--include-context',
      '--exclude',
      'README.md,package.json,src/index.ts',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.output.projectContext).toEqual({
      readme: null,
      manifests: [],
      directoryTree: ['src/keep.ts'],
      entryPoint: null,
    });
  });
});

describe('scan-project.mjs — project-root containment', () => {
  let projectRoot;
  let outsideRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
    if (outsideRoot) {
      rmSync(outsideRoot, { recursive: true, force: true });
      outsideRoot = null;
    }
  });

  it('fails closed when Git enumeration reaches a file through an external filesystem link', () => {
    projectRoot = setupTree({
      'src/local.ts': 'export const local = true;\n',
    });
    outsideRoot = mkdtempSync(join(tmpdir(), 'ua-scan-outside-'));
    const outsideFile = join(outsideRoot, 'outside.ts');
    writeFileSync(outsideFile, 'export const secret = true;\n', 'utf-8');
    const enumeratedPath = process.platform === 'win32'
      ? 'linked-dir/outside.ts'
      : 'linked-file.ts';
    if (process.platform === 'win32') {
      symlinkSync(outsideRoot, join(projectRoot, 'linked-dir'), 'junction');
    } else {
      symlinkSync(outsideFile, join(projectRoot, enumeratedPath), 'file');
    }

    const result = runScript(projectRoot);
    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
    expect(result.stderr).toMatch(/security policy|outside project root/i);
    expect(result.stderr).not.toContain(outsideRoot);
  });

  it.each([
    ['root ignore file', 'root-ignore'],
    ['active data-dir ignore file', 'data-ignore'],
    ['active data directory', 'data-dir'],
  ])('rejects an external %s before ignore content is read', (_label, linkKind) => {
    projectRoot = setupTree({
      'src/local.ts': 'export const local = true;\n',
    });
    outsideRoot = mkdtempSync(join(tmpdir(), 'ua-scan-ignore-outside-'));
    const secret = '.understandignore\nsrc/\n# SECRET_EXTERNAL_IGNORE\n';

    if (linkKind === 'data-dir') {
      writeFileSync(join(outsideRoot, '.understandignore'), secret, 'utf8');
      symlinkSync(
        outsideRoot,
        join(projectRoot, '.ua'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } else {
      const parent = linkKind === 'root-ignore'
        ? projectRoot
        : join(projectRoot, '.ua');
      mkdirSync(parent, { recursive: true });
      const linkPath = join(parent, '.understandignore');
      const target = process.platform === 'win32'
        ? outsideRoot
        : join(outsideRoot, '.understandignore');
      if (process.platform === 'win32') {
        writeFileSync(join(outsideRoot, 'external-ignore.txt'), secret, 'utf8');
      } else {
        writeFileSync(target, secret, 'utf8');
      }
      symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'file');
    }

    const result = runScript(projectRoot);

    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
    expect(result.stderr).toMatch(/security policy.*unsafe/i);
    expect(result.stderr).not.toContain('SECRET_EXTERNAL_IGNORE');
    expect(result.stderr).not.toContain(outsideRoot);
  });

  it.each([
    ['root ignore file', 'root-ignore'],
    ['active data-dir ignore file', 'data-ignore'],
    ['active data directory', 'data-dir'],
  ])('rejects a dangling linked %s instead of treating it as missing', (_label, linkKind) => {
    projectRoot = setupTree({
      'src/local.ts': 'export const local = true;\n',
    });
    outsideRoot = mkdtempSync(join(tmpdir(), 'ua-scan-dangling-ignore-'));
    const target = join(outsideRoot, 'removed-target');
    const linkPath = linkKind === 'data-dir'
      ? join(projectRoot, '.ua')
      : join(
        linkKind === 'root-ignore' ? projectRoot : join(projectRoot, '.ua'),
        '.understandignore',
      );
    mkdirSync(dirname(linkPath), { recursive: true });

    if (process.platform === 'win32' || linkKind === 'data-dir') {
      mkdirSync(target);
      symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      rmSync(target, { recursive: true, force: true });
    } else {
      writeFileSync(target, 'src/\n', 'utf8');
      symlinkSync(target, linkPath, 'file');
      rmSync(target, { force: true });
    }

    const result = runScript(projectRoot);

    expect(result.status).not.toBe(0);
    expect(result.output).toBeNull();
    expect(result.stderr).toMatch(/security policy.*unsafe/i);
    expect(result.stderr).not.toContain(outsideRoot);
  });
});

describe('scan-project.mjs — data-dir resolution (.ua vs legacy)', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('honors .ua/.understandignore in a fresh project (no legacy dir)', () => {
    // scan-project delegates ignore handling to core's createIgnoreFilter,
    // which reads <resolveUaDir>/.understandignore — .ua/ for fresh projects.
    projectRoot = setupTree({
      '.ua/.understandignore': 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeUndefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeUndefined();
    // Counted as user-driven drops (dual-filter accounting saw the ua ignore).
    expect(r.output.filteredByIgnore).toBe(2);
  });

  it('honors legacy .understand-anything/.understandignore (legacy-compat)', () => {
    // Legacy-compat regression: projects with an existing
    // .understand-anything/ keep using it for the .understandignore lookup.
    projectRoot = setupTree({
      '.understand-anything/.understandignore': 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeUndefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeUndefined();
    expect(r.output.filteredByIgnore).toBe(2);
  });
});

describe('scan-project.mjs — special-file recognition', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('Dockerfile (no extension) is language=dockerfile, category=infra', () => {
    projectRoot = setupTree({
      Dockerfile: 'FROM alpine:3\nCMD ["sh"]\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const entry = byPath(r.output, 'Dockerfile');
    expect(entry).toBeDefined();
    expect(entry.language).toBe('dockerfile');
    expect(entry.fileCategory).toBe('infra');
  });
});

describe('scan-project.mjs — determinism', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('produces byte-identical output across runs for the same input tree', () => {
    projectRoot = setupTree({
      'README.md': '# project\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/lib/c.ts': 'export const c = 3;\n',
      'package.json': '{}\n',
      'tsconfig.json': '{}\n',
    });
    const r1 = runScript(projectRoot);
    const r2 = runScript(projectRoot);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
  });
});

describe('scan-project.mjs — empty repo', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('handles a project with zero files without crashing', () => {
    projectRoot = setupTree({}, { gitInit: true });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.scriptCompleted).toBe(true);
    expect(r.output.totalFiles).toBe(0);
    expect(r.output.files).toEqual([]);
    expect(r.output.filteredByIgnore).toBe(0);
    expect(r.output.estimatedComplexity).toBe('small');
  });
});

describe('scan-project.mjs — per-file failure resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      // Restore permissions on any chmod'd file before delete, so cleanup
      // succeeds even when a test left a 000-permission file behind.
      try {
        const f = join(projectRoot, 'src/unreadable.ts');
        if (existsSync(f)) chmodSync(f, 0o644);
      } catch { /* best-effort */ }
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('warns and skips a Git-tracked file that vanished after enumeration state was recorded', () => {
    projectRoot = setupTree({
      'src/good.ts': 'export const good = 1;\n',
      'src/vanished.ts': 'export const vanished = 2;\n',
    });
    const add = spawnSync('git', ['add', 'src/good.ts', 'src/vanished.ts'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(add.status, add.stderr).toBe(0);
    rmSync(join(projectRoot, 'src/vanished.ts'));

    const result = runScript(projectRoot);
    expect(result.status).toBe(0);
    expect(byPath(result.output, 'src/good.ts')).toBeDefined();
    expect(byPath(result.output, 'src/vanished.ts')).toBeUndefined();
    expect(result.output.degraded).toBe(false);
    expect(result.stderr).toMatch(/src\/vanished\.ts.*stat failed.*file skipped/i);
  });

  it('emits a Warning: and skips a file with unreadable permissions; other files survive', () => {
    if (process.platform === 'win32') {
      // chmod permission bits don't apply on Windows the same way; skip.
      return;
    }
    if (process.getuid && process.getuid() === 0) {
      // Running as root bypasses permission checks; the test cannot exercise
      // its failure mode. Skip rather than emit a false pass.
      return;
    }
    projectRoot = setupTree({
      'src/good.ts': 'export const good = 1;\n',
      'src/unreadable.ts': 'export const bad = 2;\n',
    });
    // Strip read permission on the synthetic file.
    chmodSync(join(projectRoot, 'src/unreadable.ts'), 0o000);

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.scriptCompleted).toBe(true);
    expect(r.output.degraded).toBe(true);
    // The good file is in the output.
    expect(byPath(r.output, 'src/good.ts')).toBeDefined();
    // The unreadable file is dropped.
    expect(byPath(r.output, 'src/unreadable.ts')).toBeUndefined();
    // A visible warning was emitted with the documented prefix.
    expect(r.stderr).toMatch(
      /Warning: scan-project: src\/unreadable\.ts — line count failed/,
    );
    expect(r.stderr).toMatch(/file skipped from output/);
    // Final summary line still fires.
    expect(r.stderr).toMatch(
      /scan-project: filesScanned=1 filteredByIgnore=0 complexity=small/,
    );
  });
});

describe('scan-project.mjs — estimatedComplexity thresholds', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  /**
   * Build a tree with exactly N .ts files at the top level. Used to
   * lock in the complexity-tier boundary points from project-scanner.md
   * Step 7: small (≤30), moderate (31-150), large (151-500), very-large
   * (>500).
   */
  function setupNFiles(n) {
    const tree = {};
    for (let i = 0; i < n; i++) {
      // Pad indices so localeCompare gives the natural order for any N.
      tree[`f${String(i).padStart(4, '0')}.ts`] = 'export const x = 1;\n';
    }
    return setupTree(tree);
  }

  it('30 files -> small (upper boundary of small)', () => {
    projectRoot = setupNFiles(30);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(30);
    expect(r.output.estimatedComplexity).toBe('small');
  });

  it('31 files -> moderate (lower boundary of moderate)', () => {
    projectRoot = setupNFiles(31);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(31);
    expect(r.output.estimatedComplexity).toBe('moderate');
  });

  it('150 files -> moderate (upper boundary of moderate)', () => {
    projectRoot = setupNFiles(150);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(150);
    expect(r.output.estimatedComplexity).toBe('moderate');
  });

  it('151 files -> large (lower boundary of large)', () => {
    projectRoot = setupNFiles(151);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(151);
    expect(r.output.estimatedComplexity).toBe('large');
  });

  it('501 files -> very-large (lower boundary of very-large)', () => {
    projectRoot = setupNFiles(501);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(501);
    expect(r.output.estimatedComplexity).toBe('very-large');
  });
});

describe('scan-project.mjs — CLI entry guard + invocation', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('invokes successfully via subprocess and produces a parseable output file', () => {
    projectRoot = setupTree({
      'README.md': '# proj\n',
      'src/index.ts': 'export const x = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output).not.toBeNull();
    expect(r.output.scriptCompleted).toBe(true);
    // Stats summary line fires on stderr.
    expect(r.stderr).toMatch(
      /scan-project: filesScanned=2 filteredByIgnore=0 complexity=small/,
    );
    // Two files captured.
    expect(r.output.totalFiles).toBe(2);
  });

  it('fails fast with usage message when projectRoot is missing', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage: node scan-project\.mjs/);
  });
});

describe('scan-project.mjs — output schema invariants', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits the documented top-level fields with correct shapes', () => {
    projectRoot = setupTree({
      'src/a.ts': 'export const a = 1;\n',
      'README.md': '# x\n',
      'package.json': '{}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const out = r.output;
    expect(out.scriptCompleted).toBe(true);
    expect(out.degraded).toBe(false);
    expect(out.excludePatterns).toEqual([]);
    expect(Array.isArray(out.files)).toBe(true);
    expect(typeof out.totalFiles).toBe('number');
    expect(out.totalFiles).toBe(out.files.length);
    expect(typeof out.filteredByIgnore).toBe('number');
    expect(['small', 'moderate', 'large', 'very-large']).toContain(
      out.estimatedComplexity,
    );
    expect(out.stats).toBeDefined();
    expect(out.stats.filesScanned).toBe(out.files.length);
    expect(typeof out.stats.byCategory).toBe('object');
    expect(typeof out.stats.byLanguage).toBe('object');
    // Per-file shape
    for (const f of out.files) {
      expect(typeof f.path).toBe('string');
      expect(typeof f.language).toBe('string');
      expect(typeof f.sizeLines).toBe('number');
      expect([
        'code', 'config', 'docs', 'infra', 'data', 'script', 'markup',
      ]).toContain(f.fileCategory);
    }
  });

  it('files[] is sorted by path.localeCompare', () => {
    projectRoot = setupTree({
      'zzz.ts': '\n',
      'aaa.ts': '\n',
      'mmm.ts': '\n',
      'subdir/file.ts': '\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const paths = r.output.files.map(f => f.path);
    const sortedPaths = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sortedPaths);
  });
});
