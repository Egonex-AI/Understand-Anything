import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const skillDir = join(repoRoot, 'understand-anything-plugin', 'skills', 'understand');
const scanScript = join(skillDir, 'scan-project.mjs');
const importScript = join(skillDir, 'extract-import-map.mjs');
const fingerprintScript = join(skillDir, 'build-fingerprints.mjs');
const prepareScript = join(skillDir, 'prepare-incremental.mjs');
const finalizeScript = join(skillDir, 'finalize-incremental.mjs');
const mergeScript = join(skillDir, 'merge-batch-graphs.py');
const retryScript = join(skillDir, 'prepare-symbol-retry.mjs');

const python = (() => {
  for (const command of ['python3', 'python']) {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf-8' });
    if (probe.status === 0) return command;
  }
  throw new Error('Python 3 is required for incremental merge tests');
})();

const roots = [];

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function git(root, args) {
  return run('git', args, root).stdout.trim();
}

function writeProjectFile(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf-8');
}

function commit(root, message, { forcePaths = [] } = {}) {
  git(root, ['add', '-A']);
  for (const path of forcePaths) git(root, ['add', '-f', '--', path]);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function setupRepository(files) {
  const root = mkdtempSync(join(tmpdir(), 'ua-incremental-test-'));
  roots.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  // Keep fixture bytes literal on Windows so the LF -> CRLF regression
  // actually creates a commit instead of being normalized back to LF.
  git(root, ['config', 'core.autocrlf', 'false']);
  writeProjectFile(root, '.gitignore', '.ua/\n.understand-anything/\n');
  for (const [path, content] of Object.entries(files)) writeProjectFile(root, path, content);
  const baseCommit = commit(root, 'baseline');
  buildBaseline(root, baseCommit);
  return { root, baseCommit };
}

function buildBaseline(root, baseCommit) {
  const intermediate = join(root, '.ua', 'intermediate');
  mkdirSync(intermediate, { recursive: true });
  const rawScanPath = join(intermediate, 'baseline-scan.json');
  run(process.execPath, [scanScript, root, rawScanPath, '--exclude-analysis-data'], root);
  const rawScan = JSON.parse(readFileSync(rawScanPath, 'utf-8'));

  const importInput = join(intermediate, 'baseline-import-input.json');
  const importOutput = join(intermediate, 'baseline-import-output.json');
  writeFileSync(
    importInput,
    JSON.stringify({ projectRoot: root, files: rawScan.files }),
    'utf-8',
  );
  run(process.execPath, [importScript, importInput, importOutput], root);
  const importMap = JSON.parse(readFileSync(importOutput, 'utf-8')).importMap;
  const scan = {
    name: 'fixture',
    description: 'fixture project',
    languages: [...new Set(rawScan.files.map(file => file.language))].sort(),
    frameworks: [],
    contentDigest: rawScan.contentDigest,
    files: rawScan.files,
    totalFiles: rawScan.totalFiles,
    filteredByIgnore: rawScan.filteredByIgnore,
    estimatedComplexity: rawScan.estimatedComplexity,
    importMap,
  };
  writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify(scan), 'utf-8');

  const fingerprintInput = join(intermediate, 'fingerprint-input.json');
  writeFileSync(
    fingerprintInput,
    JSON.stringify({
      projectRoot: root,
      filePaths: rawScan.files.map(file => file.path),
      gitCommitHash: baseCommit,
    }),
    'utf-8',
  );
  run(process.execPath, [fingerprintScript, fingerprintInput], root);

  const nodes = rawScan.files.map(file => ({
    id: `file:${file.path}`,
    type: 'file',
    name: file.path.split('/').at(-1),
    filePath: file.path,
    summary: file.path,
    tags: ['fixture'],
    complexity: 'simple',
  }));
  const nodeIdByPath = new Map(nodes.map(node => [node.filePath, node.id]));
  const edges = Object.entries(importMap).flatMap(([sourcePath, targets]) =>
    targets
      .filter(targetPath => nodeIdByPath.has(sourcePath) && nodeIdByPath.has(targetPath))
      .map(targetPath => ({
        source: nodeIdByPath.get(sourcePath),
        target: nodeIdByPath.get(targetPath),
        type: 'imports',
        direction: 'forward',
        weight: 0.7,
      })),
  );
  writeFileSync(
    join(root, '.ua', 'knowledge-graph.json'),
    JSON.stringify({
      version: '1.0.0',
      project: {
        name: 'fixture',
        languages: scan.languages,
        frameworks: [],
        description: 'fixture project',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        gitCommitHash: baseCommit,
      },
      nodes,
      edges,
      layers: [{
        id: 'layer:source',
        name: 'Source',
        description: 'Source files',
        nodeIds: nodes.map(node => node.id),
      }],
      tour: [{
        order: 1,
        title: 'Overview',
        description: 'Read the project',
        nodeIds: nodes.map(node => node.id),
      }],
    }),
    'utf-8',
  );
  writeFileSync(
    join(root, '.ua', 'meta.json'),
    JSON.stringify({ gitCommitHash: baseCommit, analyzedFiles: nodes.length, version: '1.0.0' }),
    'utf-8',
  );
}

function prepare(root, baseCommit, extraArgs = []) {
  const result = run(process.execPath, [prepareScript, root, baseCommit, ...extraArgs], root);
  const intermediate = join(root, '.ua', 'intermediate');
  return {
    result,
    plan: JSON.parse(readFileSync(join(intermediate, 'incremental-plan.json'), 'utf-8')),
    scan: JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8')),
    changedFiles: JSON.parse(readFileSync(join(intermediate, 'changed-files.json'), 'utf-8')),
  };
}

function symbolFixture(count = 20, extraFiles = {}) {
  const source = methods => `export class Service {\n${methods.map(name => `  ${name}() { return 1; }`).join('\n')}\n}\n`;
  const names = Array.from({ length: count }, (_, i) => `method${i}`);
  const fixture = setupRepository({
    'src/a.ts': source(names),
    'src/b.ts': 'export const b = 1;\n',
    'src/c.ts': 'export const c = 1;\n',
    'src/d.ts': 'export const d = 1;\n',
    ...extraFiles,
  });
  const { root } = fixture;
  const dataDir = join(root, '.ua');
  const intermediate = join(dataDir, 'intermediate');
  const graphPath = join(dataDir, 'knowledge-graph.json');
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const classNode = {
    id: 'class:src/a.ts:Service', name: 'Service', type: 'class', filePath: 'src/a.ts',
    summary: 'Service', tags: [], complexity: 'simple',
  };
  const methodNodes = names.map(name => ({
    ...classNode, id: `function:src/a.ts:Service.${name}`, name: `Service.${name}`, type: 'function',
  }));
  graph.nodes.push(classNode, ...methodNodes);
  graph.edges.push(...methodNodes.map(node => ({
    source: classNode.id, target: node.id, type: 'contains', direction: 'forward', weight: 1,
  })));
  writeFileSync(graphPath, JSON.stringify(graph));
  const fileNode = graph.nodes.find(node => node.id === 'file:src/a.ts');
  const read = name => JSON.parse(readFileSync(join(intermediate, name), 'utf8'));
  const write = (name, value) => writeFileSync(join(intermediate, name), JSON.stringify(value));
  const persisted = () => ['knowledge-graph.json', 'fingerprints.json', 'meta.json']
    .map(name => readFileSync(join(dataDir, name), 'utf8'));
  return { ...fixture, intermediate, dataDir, source, names, fileNode, classNode, methodNodes, read, write, persisted };
}

afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  // These integration tests intentionally use synchronous child processes.
  // Yield between cases so Vitest workers can service task-update RPC replies,
  // especially on slower Windows runners where the full file exceeds 60s.
  await new Promise(resolve => setImmediate(resolve));
});

describe('incremental symbol publication gate', { timeout: 30_000 }, () => {
  it.each([
    ['rb', 'class A\n def run; end\nend\nclass B; end\n', 'class A\n def keep; end\nend\nclass B\n attr_reader :run\nend\n'],
    ['ts', 'class A { run() {} }\nclass B {}\n', 'class A { keep() {} }\nclass B {}\nObject.defineProperty(B.prototype, "run", { value() {} });\n'],
    ['py', 'class A:\n def run(self): pass\nclass B: pass\n', 'class A:\n def keep(self): pass\nclass B: pass\nsetattr(B, "run", lambda self: None)\n'],
  ])('publishes a genuine deletion while another %s owner installs the same name', (extension, oldSource, newSource) => {
    const path = `src/scopes.${extension}`;
    const f = symbolFixture(2, { [path]: oldSource });
    const previous = JSON.parse(f.persisted()[0]);
    const method = { ...f.methodNodes[0], id: `function:${path}:A.run`, name: 'A.run', filePath: path };
    previous.nodes.push(method);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, path, newSource);
    const head = commit(f.root, 'delete one owner method');
    prepare(f.root, f.baseCommit);
    f.write('batch-1.json', { nodes: [previous.nodes.find(node => node.id === `file:${path}`)], edges: [] });
    run(python, [mergeScript, f.root], f.root);
    run(process.execPath, [finalizeScript, f.root], f.root);
    const [graph, fingerprints, meta] = f.persisted().map(JSON.parse);
    expect(graph.nodes.some(node => node.id === method.id)).toBe(false);
    for (const baseline of [graph.project, fingerprints, meta]) expect(baseline.gitCommitHash).toBe(head);
  });

  it.each(['attr :name', 'attr_writer "run"', 'attr_writer :"run"'])('publishes genuine Ruby reader deletion beside %s and an ordinary attr call', accessor => {
    const path = 'src/accessor.rb';
    const f = symbolFixture(2, { [path]: `class A\n def run; end\n ${accessor}\nend\nobj.attr\n` });
    const previous = JSON.parse(f.persisted()[0]);
    const method = { ...f.methodNodes[0], id: `function:${path}:A.run`, name: 'A.run', filePath: path };
    previous.nodes.push(method);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, path, `class A\n def keep; end\n ${accessor}\nend\nobj.attr\n`);
    const head = commit(f.root, 'delete method beside static accessor');
    prepare(f.root, f.baseCommit);
    f.write('batch-1.json', { nodes: [previous.nodes.find(node => node.id === `file:${path}`)], edges: [] });
    run(python, [mergeScript, f.root], f.root);
    run(process.execPath, [finalizeScript, f.root], f.root);
    const published = JSON.parse(f.persisted()[0]);
    expect(published.project.gitCommitHash).toBe(head);
    expect(published.nodes.some(node => node.id === method.id)).toBe(false);
  });

  it.each([
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n define_method(("r" + "un").to_sym) { 1 }\nend\n'],
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n attr(("r" + "un").to_sym)\nend\n'],
    ['py', 'class A:\n def run(self): pass\n', 'class A:\n def keep(self): pass\nsetattr(A, "r" + "un", lambda self: None)\n'],
  ])('blocks publication of omitted runtime-installed %s methods', (extension, oldSource, newSource) => {
    const path = `src/dynamic.${extension}`;
    const f = symbolFixture(2, { [path]: oldSource });
    const previous = JSON.parse(f.persisted()[0]);
    const method = { ...f.methodNodes[0], id: `function:${path}:A.run`, name: 'A.run', filePath: path };
    previous.nodes.push(method);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, path, newSource);
    commit(f.root, 'install method dynamically');
    const before = f.persisted();
    expect(prepare(f.root, f.baseCommit).plan.filesToReanalyze).toContain(path);
    f.write('batch-1.json', { nodes: [previous.nodes.find(node => node.id === `file:${path}`)], edges: [] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('incremental-symbol-report.json').files.find(file => file.filePath === path).missing[0].status).toBe('unknown');
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it('reanalyzes changed Rust trait identities and blocks publication with unresolved receivers', () => {
    const path = 'src/method.rs';
    const f = symbolFixture(2, { [path]: 'impl TraitA for A { fn run(&self) {} }\n' });
    const previous = JSON.parse(f.persisted()[0]);
    const method = { ...f.methodNodes[0], id: `function:${path}:run`, name: 'run', filePath: path, lineRange: [1, 1] };
    previous.nodes.push(method);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, path, 'impl TraitB for B { fn run(&self) {} }\n');
    commit(f.root, 'change trait and receiver');
    const before = f.persisted();
    const { plan } = prepare(f.root, f.baseCommit);
    expect(plan.filesToReanalyze).toContain(path);
    f.write('batch-1.json', { nodes: [previous.nodes.find(node => node.id === `file:${path}`), method], edges: [] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('incremental-symbol-report.json').files.find(file => file.filePath === path).missing[0].status).toBe('unknown');
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it.each([
    ['declaration', 'export class Service { ["method" + "0"]() { return 1; } method1() {} }\n'],
    ['assignment', 'export class Service { method1() {} }; Service.prototype["method" + "0"] = function() {};\n'],
    ['property definition', 'export class Service { method1() {} }; Object.defineProperty(Service.prototype, "method" + "0", { value() {} });\n'],
    ['reflection', 'export class Service { method1() {} }; Reflect.defineProperty(Service.prototype, "method" + "0", { value() {} });\n'],
  ])('does not publish a missing method whose computed %s still denotes the old symbol', (_label, source) => {
    const f = symbolFixture(2);
    const result = new Function(source.replace('export ', '') + '\nreturn Service;')();
    expect(Object.hasOwn(result.prototype, 'method0')).toBe(true);
    writeProjectFile(f.root, 'src/a.ts', source);
    commit(f.root, 'use a computed method name');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    f.write('batch-1.json', { nodes: [f.fileNode, f.classNode, f.methodNodes[1]], edges: [] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('incremental-symbol-report.json').files[0].missing[0]).toMatchObject({
      id: f.methodNodes[0].id, status: 'unknown',
    });
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it('checks generic method identity against source when both graphs omit every class node', () => {
    const f = symbolFixture(2, { 'src/a.ts': 'export class A { run() {} }\n' });
    const generic = { ...f.methodNodes[0], id: 'function:src/a.ts:run', name: 'run', lineRange: [1, 1] };
    const previous = JSON.parse(f.persisted()[0]);
    previous.nodes = previous.nodes.filter(node => node.filePath !== 'src/a.ts' || node.type === 'file');
    previous.nodes.push(generic);
    previous.edges = [];
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, 'src/a.ts', 'export class B { run() {} }\n');
    commit(f.root, 'change owning class');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    f.write('batch-1.json', { nodes: [f.fileNode, generic], edges: [] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('incremental-symbol-report.json').files[0].missing[0]).toMatchObject({ id: generic.id, status: 'unknown' });
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it.each([false, true])('preserves current endpoint meanings when baseline IDs are reused (rename again=%s)', renameAgain => {
    const service = names => `export class Service { ${names.map(name => `${name}() { return 1; }`).join(' ')} }\n`;
    const other = 'export class Other { method0() { return 2; } }\n';
    const third = 'export class Third { method0() { return 3; } }\n';
    const a = 'src/a.ts';
    const b = 'src/b.ts';
    const f = symbolFixture(2, { [a]: service(['method0', 'method1']) + other + third, [b]: service(['method0']) + other });
    const cls = (filePath, name) => ({ ...f.classNode, id: `class:${filePath}:${name}`, filePath, name });
    const method = (filePath, owner, generic = false) => ({
      ...f.methodNodes[0], filePath,
      id: `function:${filePath}:${generic ? 'method0' : `${owner}.method0`}`,
      name: generic ? 'method0' : `${owner}.method0`,
    });
    const contains = (parent, child) => ({ source: parent.id, target: child.id, type: 'contains', direction: 'forward', weight: 1 });
    const oldA = method(a, 'Service', true);
    const oldB = method(b, 'Service', true);
    const aOther = cls(a, 'Other');
    const aThird = cls(a, 'Third');
    const bService = cls(b, 'Service');
    const bOther = cls(b, 'Other');
    const previous = JSON.parse(f.persisted()[0]);
    previous.nodes = previous.nodes.map(node => node.id === f.methodNodes[0].id ? oldA : node);
    previous.nodes.push(aOther, aThird, bService, bOther, oldB);
    previous.edges = previous.edges.map(edge => edge.target === f.methodNodes[0].id ? { ...edge, target: oldA.id } : edge);
    previous.edges.push(contains(bService, oldB));
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, a, service([...f.names, 'added']) + other + third);
    writeProjectFile(f.root, b, service(['method0', 'added']) + other);
    commit(f.root, 'change both services');
    prepare(f.root, f.baseCommit);
    const aServiceRun = method(a, 'Service');
    const bServiceRun = method(b, 'Service');
    const aOtherRun = method(a, 'Other', true);
    const bOtherRun = method(b, 'Other', true);
    f.write('batch-1.json', {
      nodes: [f.fileNode, f.classNode, aOther, aThird, aServiceRun, aOtherRun,
        previous.nodes.find(node => node.id === `file:${b}`), bService, bOther, bServiceRun, bOtherRun],
      edges: [contains(f.classNode, aServiceRun), contains(aOther, aOtherRun),
        contains(bService, bServiceRun), contains(bOther, bOtherRun),
        { source: bOtherRun.id, target: aOtherRun.id, type: 'calls', direction: 'forward', weight: 0.8 }],
    });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    run(process.execPath, [retryScript, f.root], f.root);
    const retry = f.read('incremental-symbol-retry.json');
    expect(retry.filesToReanalyze).toEqual([a]);
    expect(retry.inboundEdgeCandidates).toContainEqual(expect.objectContaining({ source: bOtherRun.id, target: aOtherRun.id }));
    const restoredOther = renameAgain ? method(a, 'Other') : aOtherRun;
    const thirdRun = method(a, 'Third', true);
    const repairedNodes = [f.fileNode, f.classNode, aOther, aThird, aServiceRun, f.methodNodes[1], restoredOther];
    const repairedEdges = [contains(f.classNode, aServiceRun), contains(f.classNode, f.methodNodes[1]), contains(aOther, restoredOther)];
    if (renameAgain) {
      repairedNodes.push(thirdRun);
      repairedEdges.push(contains(aThird, thirdRun));
    }
    for (const batch of retry.batches) f.write(`batch-${batch.batchIndex}.json`, { nodes: repairedNodes, edges: repairedEdges });
    run(python, [mergeScript, f.root], f.root);
    run(process.execPath, [finalizeScript, f.root], f.root);
    expect(JSON.parse(f.persisted()[0]).edges.filter(edge => edge.type === 'calls')).toEqual([
      { source: bOtherRun.id, target: restoredOther.id, type: 'calls', direction: 'forward', weight: 0.8 },
    ]);
  });

  it('blocks owner substitution behind an unchanged generic method ID in merge and finalize', () => {
    const otherSource = 'export class Other { method0() { return 2; } }\n';
    const f = symbolFixture(2, {
      'src/a.ts': 'export class Service { method0() { return 1; } method1() { return 1; } }\n' + otherSource,
    });
    const generic = { ...f.methodNodes[0], id: 'function:src/a.ts:method0', name: 'method0' };
    const otherClass = { ...f.classNode, id: 'class:src/a.ts:Other', name: 'Other' };
    const previous = JSON.parse(f.persisted()[0]);
    previous.nodes = previous.nodes.map(node => node.id === f.methodNodes[0].id ? generic : node);
    previous.nodes.push(otherClass);
    previous.edges = previous.edges.map(edge => edge.target === f.methodNodes[0].id ? { ...edge, target: generic.id } : edge);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']) + otherSource);
    commit(f.root, 'add method');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    f.write('batch-1.json', {
      nodes: [f.fileNode, f.classNode, otherClass, generic, f.methodNodes[1]],
      edges: [{ source: otherClass.id, target: generic.id, type: 'contains', direction: 'forward', weight: 1 }],
    });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('incremental-symbol-report.json').files[0].missing).toContainEqual(expect.objectContaining({
      id: generic.id, name: generic.name, status: 'still-present',
    }));
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it.each([
    ['go', 'Run', 'package p\n', owner => `func (x ${owner}) Run() {}\n`],
    ['rs', 'run', '', owner => `impl ${owner} { fn run(&self) {} }\n`],
    ['cpp', 'run', '', owner => `void ${owner}::run() {}\n`],
  ])('blocks a substituted %s receiver in merge and finalize when the type is in another file', (extension, name, prefix, method) => {
    const path = `src/method.${extension}`;
    const source = prefix + method('A') + method('B');
    const f = symbolFixture(2, { [path]: source });
    const first = prefix.split('\n').length;
    const generic = { ...f.methodNodes[0], id: `function:${path}:${name}`, name, filePath: path, lineRange: [first, first] };
    const previous = JSON.parse(f.persisted()[0]);
    previous.nodes.push(generic);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, path, source + method('C'));
    commit(f.root, 'add receiver method');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    expect(f.read('incremental-plan.json').filesToReanalyze).toContain(path);
    f.write('batch-1.json', {
      nodes: [previous.nodes.find(node => node.id === `file:${path}`), { ...generic, lineRange: [first + 1, first + 1] }],
      edges: [],
    });
    const merged = spawnSync(python, [mergeScript, f.root], { encoding: 'utf8' });
    expect(merged.status, merged.stderr).toBe(1);
    expect(f.read('incremental-symbol-report.json').files.find(file => file.filePath === path).missing)
      .toContainEqual(expect.objectContaining({ id: generic.id, status: 'still-present' }));
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it('reconciles accepted replacement IDs on the first pass without requiring a retry', () => {
    const f = symbolFixture(2, { 'src/b.ts': 'export function b() {}\n' });
    const oldSource = { ...f.methodNodes[0], id: 'func:src/b.ts:b', filePath: 'src/b.ts', name: 'b' };
    const previous = JSON.parse(f.persisted()[0]);
    previous.nodes.push(oldSource);
    writeFileSync(join(f.dataDir, 'knowledge-graph.json'), JSON.stringify(previous));
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    writeProjectFile(f.root, 'src/b.ts', 'export function b(value: number) { return value; }\n');
    commit(f.root, 'add method');
    prepare(f.root, f.baseCommit);
    const replacements = f.methodNodes.map(node => ({ ...node, id: node.id.replace('Service.', 'Service::') }));
    const newSource = { ...oldSource, id: 'function:src/b.ts:b' };
    const source = newSource.id;
    f.write('batch-1.json', {
      nodes: [f.fileNode, f.classNode, ...replacements, previous.nodes.find(node => node.id === 'file:src/b.ts'), newSource],
      edges: [{ source: oldSource.id, target: f.methodNodes[1].id, type: 'calls', direction: 'forward', weight: 0.7 }],
    });
    run(python, [mergeScript, f.root], f.root);
    const report = f.read('incremental-symbol-report.json');
    expect(report.ok).toBe(true);
    expect(report.unresolvedFiles).toEqual([]);
    expect(report.idReplacements).toContainEqual({ oldId: f.methodNodes[1].id, newId: replacements[1].id });
    expect(report.idReplacements).toContainEqual({ oldId: oldSource.id, newId: newSource.id });
    expect(() => f.read('incremental-symbol-retry.json')).toThrow();
    const assembled = f.read('assembled-graph.json');
    expect(assembled.edges.some(edge => edge.source === source && edge.target === replacements[1].id)).toBe(true);
    // The final save gate independently reconciles the same current evidence.
    assembled.edges = assembled.edges.filter(edge => edge.type !== 'calls');
    f.write('assembled-graph.json', assembled);
    run(process.execPath, [finalizeScript, f.root], f.root);
    expect(JSON.parse(f.persisted()[0]).edges.some(edge => edge.source === source
      && edge.target === replacements[1].id && edge.weight === 0.7)).toBe(true);
  });

  it('rejects changed analyzer inputs even when all old symbol IDs survive', () => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    commit(f.root, 'add method');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'uncommitted']));
    f.write('batch-0.json', { nodes: [f.fileNode, f.classNode, ...f.methodNodes], edges: [] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
    expect(f.persisted()).toEqual(before);
  });

  it.each([false, true])('uses Git cleanliness for CRLF source when dirty=%s', dirty => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, '.gitattributes', 'src/a.ts text eol=crlf\n');
    writeProjectFile(f.root, 'src/a.ts', f.source([f.names[0]]).replaceAll('\n', '\r\n'));
    commit(f.root, 'delete method with CRLF checkout');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    if (dirty) writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'dirty']).replaceAll('\n', '\r\n'));
    const attributes = { ...f.fileNode, id: 'file:.gitattributes', filePath: '.gitattributes', name: '.gitattributes' };
    f.write('batch-0.json', { nodes: [attributes, f.fileNode, f.classNode, f.methodNodes[0]], edges: [] });
    const merged = spawnSync(python, [mergeScript, f.root], { encoding: 'utf8' });
    const finalized = spawnSync(process.execPath, [finalizeScript, f.root], { encoding: 'utf8' });
    expect(merged.status, merged.stderr).toBe(dirty ? 1 : 0);
    expect(finalized.status, finalized.stderr).toBe(dirty ? 1 : 0);
    if (dirty) expect(f.persisted()).toEqual(before);
    else expect(f.read('incremental-symbol-report.json').files.find(file => file.filePath === 'src/a.ts').missing[0].status).toBe('deleted');
  });

  it.each(['success', 'failure', 'renamed-ids'])('retries only affected files once, preserves other results, and handles retry %s', outcome => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    writeProjectFile(f.root, 'src/b.ts', 'export function b() { return 2; }\n');
    const head = commit(f.root, 'change two files');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    const otherFile = { ...f.fileNode, id: 'file:src/b.ts', filePath: 'src/b.ts', name: 'b.ts' };
    const otherFunction = {
      ...f.methodNodes[0], id: 'function:src/b.ts:b', filePath: 'src/b.ts', name: 'b', summary: 'Fresh analysis to retain',
    };
    const obsolete = { ...f.methodNodes[0], id: 'function:src/a.ts:obsolete', name: 'obsolete' };
    const initialMethod = outcome === 'renamed-ids'
      ? { ...f.methodNodes[0], id: f.methodNodes[0].id.replace('Service.', 'Service#') }
      : f.methodNodes[0];
    const repairedMethods = outcome === 'renamed-ids'
      ? f.methodNodes.map(node => ({ ...node, id: node.id.replace('Service.', 'Service::') }))
      : outcome === 'success' ? f.methodNodes : [f.methodNodes[0]];
    f.write('batch-7-part-1.json', { nodes: [f.fileNode, f.classNode, initialMethod, otherFile], edges: [] });
    f.write('batch-7-part-2.json', { nodes: [otherFunction, obsolete], edges: [
      { source: otherFile.id, target: otherFunction.id, type: 'contains', direction: 'forward', weight: 1 },
      { source: otherFunction.id, target: obsolete.id, type: 'calls', direction: 'forward', weight: 1 },
      { source: otherFunction.id, target: initialMethod.id, type: 'calls', direction: 'forward', weight: 0.8 },
      { source: otherFunction.id, target: f.methodNodes[1].id, type: 'calls', direction: 'forward', weight: 0.6 },
      { source: otherFunction.id, target: f.methodNodes[1].id, type: 'calls', direction: 'forward', weight: 0.9 },
      { source: initialMethod.id, target: otherFunction.id, type: 'calls', direction: 'forward', weight: 0.5 },
    ] });
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    expect(f.read('assembled-graph.json').edges.some(edge => edge.target === f.methodNodes[1].id)).toBe(false);
    expect(f.read('incremental-edge-candidates.json').edges).toContainEqual(expect.objectContaining({
      source: otherFunction.id, target: f.methodNodes[1].id, weight: 0.9,
    }));
    run(process.execPath, [retryScript, f.root], f.root);
    const retry = f.read('incremental-symbol-retry.json');
    expect(retry.filesToReanalyze).toEqual(['src/a.ts']);
    expect(retry.batches.flatMap(batch => batch.files.map(file => file.path))).toEqual(['src/a.ts']);
    expect(retry.batches[0].previousSymbols.map(node => node.id)).toContain(f.methodNodes[1].id);
    expect(retry.batches[0].previousSymbols.some(node => 'summary' in node)).toBe(false);
    for (const name of ['batch-7-part-1.json', 'batch-7-part-2.json', 'assembled-graph.json']) {
      expect(() => f.read(name)).toThrow();
    }
    const retained = f.read('batch-0.json');
    expect(retained.nodes.find(node => node.id === otherFunction.id)?.summary).toBe(otherFunction.summary);
    expect(retained.nodes.some(node => node.filePath === 'src/a.ts')).toBe(false);
    expect(retained.edges.some(edge => edge.target === obsolete.id)).toBe(false);
    expect(retained.edges.some(edge => edge.source === otherFunction.id && edge.target === initialMethod.id)).toBe(false);
    expect(retry.inboundEdgeCandidates.some(edge => edge.source === otherFunction.id && edge.target === initialMethod.id)).toBe(true);
    expect(retained.edges.some(edge => edge.source === initialMethod.id)).toBe(false);
    expect(retained.edges.some(edge => edge.target === otherFunction.id)).toBe(true);
    for (const batch of retry.batches) f.write(`batch-${batch.batchIndex}.json`, {
      nodes: [f.fileNode, f.classNode, ...repairedMethods], edges: [],
    });
    const merged = spawnSync(python, [mergeScript, f.root], { encoding: 'utf8' });
    const finalized = spawnSync(process.execPath, [finalizeScript, f.root], { encoding: 'utf8' });
    if (outcome !== 'failure') {
      expect(merged.status, merged.stderr).toBe(0);
      expect(finalized.status, finalized.stderr).toBe(0);
      const graph = JSON.parse(f.persisted()[0]);
      expect(graph.project.gitCommitHash).toBe(head);
      expect(graph.nodes.find(node => node.id === otherFunction.id)?.summary).toBe(otherFunction.summary);
      expect(graph.nodes.some(node => node.id === obsolete.id)).toBe(false);
      expect(graph.edges.some(edge => edge.target === obsolete.id)).toBe(false);
      expect(graph.edges.find(edge => edge.source === otherFunction.id && edge.target === repairedMethods[0].id)?.weight).toBe(0.8);
      expect(graph.edges.find(edge => edge.source === otherFunction.id && edge.target === repairedMethods[1].id)?.weight).toBe(0.9);
      if (outcome === 'renamed-ids') {
        expect(f.read('incremental-symbol-report.json').currentIdBindings).toContainEqual({
          oldId: initialMethod.id, newId: repairedMethods[0].id,
        });
        // Finalize must reconcile independently if its candidate loses the
        // recovered edge after merge; the report is not a save authorization.
        const candidate = f.read('assembled-graph.json');
        candidate.edges = candidate.edges.filter(edge => edge.target !== repairedMethods[0].id);
        f.write('assembled-graph.json', candidate);
        run(process.execPath, [finalizeScript, f.root], f.root);
        expect(JSON.parse(f.persisted()[0]).edges.some(edge => edge.source === otherFunction.id
          && edge.target === repairedMethods[0].id)).toBe(true);
      }
    } else {
      expect(merged.status).toBe(1);
      expect(finalized.status).toBe(1);
      expect(f.persisted()).toEqual(before);
      const secondRetry = spawnSync(process.execPath, [retryScript, f.root], { encoding: 'utf8' });
      expect(secondRetry.status).toBe(1);
      expect(secondRetry.stderr).toContain('already used');
      prepare(f.root, f.baseCommit);
      expect(f.read('incremental-symbol-retry.json').attempt).toBe(1);
      expect(f.read('incremental-symbol-retry.json')).not.toHaveProperty('inboundEdgeCandidates');
      expect(f.read('incremental-symbol-retry.json')).not.toHaveProperty('currentFiles');
      expect(() => f.read('incremental-edge-candidates.json')).toThrow();
      expect(spawnSync(process.execPath, [retryScript, f.root]).status).toBe(1);
      expect(f.persisted()).toEqual(before);
    }
  });

  it('lists all 19 missing methods and blocks merge and direct finalize without advancing any baseline', () => {
    const f = symbolFixture();
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    commit(f.root, 'add method');
    const before = f.persisted();
    prepare(f.root, f.baseCommit);
    f.write('batch-0.json', { nodes: [f.fileNode, f.classNode, f.methodNodes[0]], edges: [] });
    const merge = spawnSync(python, [mergeScript, f.root], { encoding: 'utf8' });
    expect(merge.status).toBe(1);
    const report = f.read('incremental-symbol-report.json');
    expect(report.ok).toBe(false);
    expect(report.files[0].missing).toHaveLength(19);
    expect(report.files[0].missing.every(node => node.status === 'still-present')).toBe(true);
    for (const method of f.methodNodes.slice(1)) expect(merge.stderr).toContain(method.id);
    // A forged/stale merge success cannot bypass finalization's shared check.
    f.write('incremental-symbol-report.json', { ok: true });
    const finalize = spawnSync(process.execPath, [finalizeScript, f.root], { encoding: 'utf8' });
    expect(finalize.status).toBe(1);
    expect(finalize.stderr).toContain('baseline not advanced');
    expect(f.persisted()).toEqual(before);
  });

  it('keeps the original symbol baseline and removes stale complete/split batches on repeated prepare', () => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    const headCommit = commit(f.root, 'add method');
    prepare(f.root, f.baseCommit);
    const original = f.read('incremental-symbol-baseline.json');
    // Simulate a graph save followed by a failure before fingerprints/meta.
    const graphPath = join(f.dataDir, 'knowledge-graph.json');
    const partial = JSON.parse(readFileSync(graphPath, 'utf8'));
    partial.project.gitCommitHash = headCommit;
    partial.nodes = partial.nodes.filter(node => node.id !== f.methodNodes[1].id);
    writeFileSync(graphPath, JSON.stringify(partial));
    for (const name of ['batch-0.json', 'batch-0-part-1.json', 'batch-0-part-2.json']) {
      f.write(name, { nodes: [f.methodNodes[1]], edges: [] });
    }
    prepare(f.root, f.baseCommit);
    expect(f.read('incremental-symbol-baseline.json')).toEqual(original);
    for (const name of ['batch-0.json', 'batch-0-part-1.json', 'batch-0-part-2.json']) {
      expect(() => f.read(name)).toThrow();
    }
  });

  it('allows a source-confirmed method deletion and does not restore old nodes or edges', () => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, 'src/a.ts', f.source([f.names[0]]));
    const head = commit(f.root, 'delete method');
    prepare(f.root, f.baseCommit);
    f.write('batch-0.json', { nodes: [f.fileNode, f.classNode, f.methodNodes[0]], edges: [] });
    run(python, [mergeScript, f.root], f.root);
    expect(f.read('incremental-symbol-report.json').files[0].missing[0].status).toBe('deleted');
    run(process.execPath, [finalizeScript, f.root], f.root);
    const graph = JSON.parse(f.persisted()[0]);
    expect(graph.project.gitCommitHash).toBe(head);
    expect(graph.nodes.some(node => node.id === f.methodNodes[1].id)).toBe(false);
    expect(graph.edges.some(edge => edge.target === f.methodNodes[1].id)).toBe(false);
  });

  it.each(['delete', 'exclude'])('allows an explicit file %s with old symbols', operation => {
    const f = symbolFixture(2);
    if (operation === 'delete') {
      unlinkSync(join(f.root, 'src/a.ts'));
      commit(f.root, 'delete file');
    }
    prepare(f.root, f.baseCommit, operation === 'exclude' ? ['--exclude', 'src/a.ts'] : []);
    expect(f.read('incremental-symbol-baseline.json').files).toEqual([]);
    run(python, [mergeScript, f.root], f.root);
    run(process.execPath, [finalizeScript, f.root], f.root);
    expect(JSON.parse(f.persisted()[0]).nodes.some(node => node.filePath === 'src/a.ts')).toBe(false);
  });

  it('uses legacy data directories and refuses a missing or mismatched symbol snapshot', () => {
    const f = symbolFixture(2);
    writeProjectFile(f.root, 'src/a.ts', f.source([...f.names, 'added']));
    commit(f.root, 'add method');
    const legacy = join(f.root, '.understand-anything');
    renameSync(f.dataDir, legacy);
    run(process.execPath, [prepareScript, f.root, f.baseCommit], f.root);
    const intermediate = join(legacy, 'intermediate');
    const baselinePath = join(intermediate, 'incremental-symbol-baseline.json');
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    expect(baseline.files[0].nodes).toHaveLength(4);
    writeFileSync(join(intermediate, 'batch-0.json'), JSON.stringify({
      nodes: [f.fileNode, f.classNode, ...f.methodNodes], edges: [],
    }));
    baseline.headCommit = f.baseCommit;
    writeFileSync(baselinePath, JSON.stringify(baseline));
    expect(spawnSync(python, [mergeScript, f.root]).status).toBe(1);
    unlinkSync(baselinePath);
    expect(spawnSync(process.execPath, [finalizeScript, f.root]).status).toBe(1);
  });
});

describe('prepare-incremental.mjs', { timeout: 30_000 }, () => {
  it('refreshes imports in the same run and only schedules the structural source', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    commit(root, 'add import');

    const { plan, scan, changedFiles } = prepare(root, baseCommit);
    expect(plan.action).toBe('PARTIAL_UPDATE');
    expect(plan.filesToReanalyze).toEqual(['src/a.ts']);
    expect(changedFiles).toEqual(['src/a.ts']);
    expect(scan.importMap['src/a.ts']).toEqual(['src/b.ts']);
    expect(scan.importMap['src/c.ts']).toEqual([]);
  });

  it('turns a local deletion into cleanup with an empty analyzer list', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    unlinkSync(join(root, 'src/b.ts'));
    commit(root, 'delete b');
    writeFileSync(
      join(root, '.ua', 'intermediate', 'batch-99.json'),
      JSON.stringify({
        nodes: [{ id: 'file:src/b.ts', type: 'file', filePath: 'src/b.ts' }],
        edges: [],
      }),
      'utf-8',
    );

    const { plan, scan, changedFiles } = prepare(root, baseCommit);
    expect(plan.action).toBe('PARTIAL_UPDATE');
    expect(plan.filesToReanalyze).toEqual([]);
    expect(plan.deletedFiles).toEqual(['src/b.ts']);
    expect(changedFiles).toEqual([]);
    expect(scan.files.map(file => file.path)).not.toContain('src/b.ts');
    expect(scan.importMap).not.toHaveProperty('src/b.ts');
    expect(() => readFileSync(join(root, '.ua', 'intermediate', 'batch-99.json'))).toThrow();
    const retained = JSON.parse(
      readFileSync(join(root, '.ua', 'intermediate', 'batch-existing.json'), 'utf-8'),
    );
    expect(retained.nodes.map(node => node.filePath)).not.toContain('src/b.ts');

    run(python, [mergeScript, root], root);
    run(process.execPath, [finalizeScript, root], root);
    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    const fingerprints = JSON.parse(
      readFileSync(join(root, '.ua', 'fingerprints.json'), 'utf-8'),
    );
    expect(graph.nodes.map(node => node.filePath)).not.toContain('src/b.ts');
    expect(graph.layers.flatMap(layer => layer.nodeIds)).not.toContain('file:src/b.ts');
    expect(graph.tour.flatMap(step => step.nodeIds)).not.toContain('file:src/b.ts');
    expect(fingerprints.files).not.toHaveProperty('src/b.ts');
  });

  it('does not recover an import removed during this incremental run', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', 'export const a = 1;\n');
    commit(root, 'remove import');

    const { plan, scan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual(['src/a.ts']);
    expect(scan.importMap['src/a.ts']).toEqual([]);
    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    writeFileSync(
      join(intermediate, 'batch-0.json'),
      JSON.stringify({
        nodes: [{
          id: 'file:src/a.ts',
          type: 'file',
          name: 'a.ts',
          filePath: 'src/a.ts',
          summary: 'a',
          tags: ['fixture'],
          complexity: 'simple',
        }],
        edges: [],
      }),
      'utf-8',
    );
    expect(retained.nodes.map(node => node.filePath)).not.toContain('src/a.ts');
    run(python, [mergeScript, root], root);
    const assembled = JSON.parse(
      readFileSync(join(intermediate, 'assembled-graph.json'), 'utf-8'),
    );
    expect(assembled.edges.filter(edge => edge.type === 'imports')).toHaveLength(0);
  });

  it('removes a deleted target from unchanged import-map sources', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    unlinkSync(join(root, 'src/b.ts'));
    commit(root, 'delete imported target');

    const { plan, scan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(plan.deletedFiles).toEqual(['src/b.ts']);
    expect(scan.importMap['src/a.ts']).toEqual([]);
  });

  it('re-resolves unchanged importers when a preferred candidate is added', () => {
    const { root, baseCommit } = setupRepository({
      'src/index.ts': "import { value } from './foo';\nexport { value };\n",
      'src/foo.js': 'export const value = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
    });
    writeProjectFile(root, 'src/foo.ts', 'export const value = 2;\n');
    commit(root, 'add preferred typescript candidate');

    const { plan, scan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual(['src/foo.ts']);
    expect(scan.importMap['src/index.ts']).toEqual(['src/foo.ts']);
    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    expect(retained.edges).not.toContainEqual(
      expect.objectContaining({ source: 'file:src/index.ts', type: 'imports' }),
    );
    writeFileSync(
      join(intermediate, 'batch-0.json'),
      JSON.stringify({
        nodes: [{
          id: 'file:src/foo.ts',
          type: 'file',
          name: 'foo.ts',
          filePath: 'src/foo.ts',
          summary: 'Preferred TypeScript candidate',
          tags: ['typescript'],
          complexity: 'simple',
        }],
        edges: [],
      }),
      'utf-8',
    );
    run(python, [mergeScript, root], root);
    const assembled = JSON.parse(
      readFileSync(join(intermediate, 'assembled-graph.json'), 'utf-8'),
    );
    expect(assembled.edges.filter(edge => edge.source === 'file:src/index.ts')).toEqual([
      expect.objectContaining({ target: 'file:src/foo.ts', type: 'imports' }),
    ]);
  });

  it('re-resolves unchanged importers to a fallback when a preferred candidate is deleted', () => {
    const { root, baseCommit } = setupRepository({
      'src/index.ts': "import { value } from './foo';\nexport { value };\n",
      'src/foo.ts': 'export const value = 2;\n',
      'src/foo.js': 'export const value = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
    });
    unlinkSync(join(root, 'src/foo.ts'));
    commit(root, 'delete preferred typescript candidate');

    const { plan, scan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(scan.importMap['src/index.ts']).toEqual(['src/foo.js']);
  });

  it('re-resolves unchanged importers when resolver configuration changes', () => {
    const { root, baseCommit } = setupRepository({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
      }),
      'src/index.ts': "import { value } from '@/foo';\nexport { value };\n",
      'src/foo.ts': 'export const value = 1;\n',
      'alternate/foo.ts': 'export const value = 2;\n',
      'src/a.ts': 'export const a = 1;\n',
    });
    writeProjectFile(root, 'tsconfig.json', JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['alternate/*'] } },
    }));
    commit(root, 'change alias target');

    const { scan } = prepare(root, baseCommit);
    expect(scan.importMap['src/index.ts']).toEqual(['alternate/foo.ts']);
  });

  it('aborts without advancing baselines when import extraction reports a config failure', () => {
    const { root, baseCommit } = setupRepository({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
      }),
      'src/index.ts': "import { value } from '@/foo';\nexport { value };\n",
      'src/foo.ts': 'export const value = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
    });
    const graphPath = join(root, '.ua', 'knowledge-graph.json');
    const fingerprintPath = join(root, '.ua', 'fingerprints.json');
    const metaPath = join(root, '.ua', 'meta.json');
    const scanPath = join(root, '.ua', 'intermediate', 'scan-result.json');
    const graphBefore = readFileSync(graphPath, 'utf-8');
    const fingerprintsBefore = readFileSync(fingerprintPath, 'utf-8');
    const metaBefore = readFileSync(metaPath, 'utf-8');
    const scanBefore = readFileSync(scanPath, 'utf-8');
    writeProjectFile(root, 'tsconfig.json', '{"compilerOptions":{"paths":');
    commit(root, 'break resolver config');

    const result = spawnSync(process.execPath, [prepareScript, root, baseCommit], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Import extraction reported failures: tsconfig.json (resolver-config-parse)',
    );
    expect(readFileSync(graphPath, 'utf-8')).toBe(graphBefore);
    expect(readFileSync(fingerprintPath, 'utf-8')).toBe(fingerprintsBefore);
    expect(readFileSync(metaPath, 'utf-8')).toBe(metaBefore);
    expect(readFileSync(scanPath, 'utf-8')).toBe(scanBefore);
  });

  it('refreshes supplemental require imports even when fingerprints classify the edit as cosmetic', () => {
    const { root, baseCommit } = setupRepository({
      'src/index.js': "const value = require('./a');\nmodule.exports = value;\n",
      'src/a.js': 'module.exports = 1;\n',
      'src/b.js': 'module.exports = 2;\n',
      'src/c.js': 'module.exports = 3;\n',
    });
    writeProjectFile(
      root,
      'src/index.js',
      "const value = require('./b');\nmodule.exports = value;\n",
    );
    commit(root, 'change supplemental require');

    const { plan, scan } = prepare(root, baseCommit);
    expect(plan.action).toBe('SKIP');
    expect(plan.cosmeticFiles).toEqual(['src/index.js']);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(scan.importMap['src/index.js']).toEqual(['src/b.js']);
    run(process.execPath, [finalizeScript, root], root);
    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.edges.filter(edge => edge.source === 'file:src/index.js')).toEqual([
      expect.objectContaining({ target: 'file:src/b.js', type: 'imports' }),
    ]);
  });

  it('treats LF-to-CRLF conversion as cosmetic and schedules no analyzer', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export function value() {\n  return 1;\n}\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', 'export function value() {\r\n  return 1;\r\n}\r\n');
    commit(root, 'convert line endings');

    const { plan, changedFiles } = prepare(root, baseCommit);
    expect(plan.action).toBe('SKIP');
    expect(plan.cosmeticFiles).toEqual(['src/a.ts']);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(changedFiles).toEqual([]);
  });

  it('applies a new explicit exclude against the current inventory at the same commit', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'feature/old.ts': 'export const old = true;\n',
    });

    const { plan, scan } = prepare(root, baseCommit, ['--exclude', 'feature/']);
    expect(plan.headCommit).toBe(baseCommit);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(plan.deletedFiles).toEqual(['feature/old.ts']);
    expect(scan.files.map(file => file.path)).not.toContain('feature/old.ts');
  });

  it('conservatively analyzes an existing non-code file missing from a legacy fingerprint baseline', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'docs/guide.md': '# Guide\n\nOld body.\n',
    });
    const fingerprintPath = join(root, '.ua', 'fingerprints.json');
    const fingerprints = JSON.parse(readFileSync(fingerprintPath, 'utf-8'));
    delete fingerprints.files['docs/guide.md'];
    writeFileSync(fingerprintPath, JSON.stringify(fingerprints), 'utf-8');
    writeProjectFile(root, 'docs/guide.md', '# Guide\n\nNew body.\n');
    commit(root, 'update legacy-unfingerprinted docs');

    const { plan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual(['docs/guide.md']);
    expect(plan.reason).toContain('structural changes');
  });

  it('treats parsed non-code content changes as structural', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'docs/guide.md': '# Guide\n\nOld body.\n',
    });
    const fingerprints = JSON.parse(
      readFileSync(join(root, '.ua', 'fingerprints.json'), 'utf-8'),
    );
    expect(fingerprints.files['docs/guide.md'].hasStructuralAnalysis).toBe(false);
    writeProjectFile(root, 'docs/guide.md', '# Guide\n\nNew body.\n');
    commit(root, 'update parsed non-code content');

    const { plan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual(['docs/guide.md']);
  });

  it('classifies implementation-only edits as SKIP and advances fingerprints via finalize', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export function value() { return 1; }\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', 'export function value() { return 2; }\n');
    const headCommit = commit(root, 'implementation only');

    const { plan } = prepare(root, baseCommit);
    expect(plan.action).toBe('SKIP');
    expect(plan.cosmeticFiles).toEqual(['src/a.ts']);
    run(process.execPath, [finalizeScript, root], root);

    const meta = JSON.parse(readFileSync(join(root, '.ua', 'meta.json'), 'utf-8'));
    const fingerprints = JSON.parse(
      readFileSync(join(root, '.ua', 'fingerprints.json'), 'utf-8'),
    );
    const graph = JSON.parse(
      readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'),
    );
    expect(meta.gitCommitHash).toBe(headCommit);
    expect(fingerprints.gitCommitHash).toBe(headCommit);
    expect(Object.keys(fingerprints.files)).toHaveLength(4);
    expect(graph.project.gitCommitHash).toBe(headCommit);
    expect(graph.project.analyzedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('removes files newly covered by .understandignore without analyzing them', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'legacy/old.ts': 'export const old = true;\n',
    });
    writeProjectFile(root, '.understandignore', 'legacy/\n');
    commit(root, 'ignore legacy');

    const { plan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual([]);
    expect(plan.deletedFiles).toEqual(['legacy/old.ts']);
    expect(plan.ignoredFiles).toContain('.understandignore');
    expect(plan.action).toBe('ARCHITECTURE_UPDATE');
  });

  it('handles renames and spaces as a delete plus add', () => {
    const { root, baseCommit } = setupRepository({
      'src/old name.ts': 'export const value = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
    });
    renameSync(join(root, 'src/old name.ts'), join(root, 'src/new name.ts'));
    commit(root, 'rename spaced file');

    const { plan } = prepare(root, baseCommit);
    expect(plan.deletedFiles).toEqual(['src/old name.ts']);
    expect(plan.filesToReanalyze).toEqual(['src/new name.ts']);
  });

  it.skipIf(process.platform === 'win32')(
    'preserves literal backslashes in POSIX project paths',
    () => {
      const literalPath = 'src/foo\\bar.js';
      const { root, baseCommit } = setupRepository({
        [literalPath]: 'function before() { return 1; }\nmodule.exports = before;\n',
        'src/a.js': 'module.exports = 1;\n',
        'src/b.js': 'module.exports = 2;\n',
        'src/c.js': 'module.exports = 3;\n',
      });
      writeProjectFile(root, literalPath, 'function after() { return 1; }\nmodule.exports = after;\n');
      commit(root, 'change literal backslash path');

      const { plan, scan } = prepare(root, baseCommit);
      expect(plan.filesToReanalyze).toEqual([literalPath]);
      expect(scan.files.map(file => file.path)).toContain(literalPath);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'preserves newline-containing paths in the JSON analyzer handoff',
    () => {
      const newlinePath = 'src/line\nbreak.js';
      const { root, baseCommit } = setupRepository({
        [newlinePath]: 'function before() { return 1; }\nmodule.exports = before;\n',
        'src/a.js': 'module.exports = 1;\n',
        'src/b.js': 'module.exports = 2;\n',
        'src/c.js': 'module.exports = 3;\n',
      });
      writeProjectFile(
        root,
        newlinePath,
        'function after() { return 1; }\nmodule.exports = after;\n',
      );
      commit(root, 'change newline path');

      const { plan, changedFiles } = prepare(root, baseCommit);
      expect(plan.filesToReanalyze).toEqual([newlinePath]);
      expect(changedFiles).toEqual([newlinePath]);
    },
  );

  it('keeps the same new-directory decision when preparation is retried', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'new-package/index.ts', 'export const added = true;\n');
    commit(root, 'add package');

    const first = prepare(root, baseCommit).plan;
    const second = prepare(root, baseCommit).plan;
    expect(first.action).toBe('ARCHITECTURE_UPDATE');
    expect(second.action).toBe(first.action);
    expect(second.filesToReanalyze).toEqual(['new-package/index.ts']);
  });

  it('reuses the preserved import map when retrying a different head', () => {
    const { root, baseCommit } = setupRepository({
      'src/index.js': "const value = require('./a');\nmodule.exports = value;\n",
      'src/a.js': 'module.exports = 1;\n',
      'src/b.js': 'module.exports = 2;\n',
      'src/c.js': 'function c() { return 3; }\nmodule.exports = c;\n',
    });
    writeProjectFile(
      root,
      'src/index.js',
      "const value = require('./b');\nmodule.exports = value;\n",
    );
    commit(root, 'abandoned head changes import');
    const abandoned = prepare(root, baseCommit);
    expect(abandoned.scan.importMap['src/index.js']).toEqual(['src/b.js']);

    git(root, ['reset', '--hard', baseCommit]);
    writeProjectFile(
      root,
      'src/c.js',
      'function changedC() { return 3; }\nmodule.exports = changedC;\n',
    );
    commit(root, 'replacement head changes another file');
    const replacement = prepare(root, baseCommit);

    expect(replacement.scan.importMap['src/index.js']).toEqual(['src/a.js']);
    expect(replacement.plan.filesToReanalyze).toEqual(['src/c.js']);
  });

  it('does not advance the baseline for generated-artifact-only commits', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, '.ua/tracked-generated.json', '{}\n');
    commit(root, 'generated output', { forcePaths: ['.ua/tracked-generated.json'] });

    const { plan } = prepare(root, baseCommit);
    expect(plan.action).toBe('SKIP');
    expect(plan.generatedArtifactFiles).toEqual(['.ua/tracked-generated.json']);
    run(process.execPath, [finalizeScript, root], root);
    const meta = JSON.parse(readFileSync(join(root, '.ua', 'meta.json'), 'utf-8'));
    expect(meta.gitCommitHash).toBe(baseCommit);
  });

  it('refuses to stamp HEAD when an analyzable untracked file is present', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    const metaPath = join(root, '.ua', 'meta.json');
    const metaBefore = readFileSync(metaPath, 'utf-8');
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'committed structural change');
    writeProjectFile(root, 'src/uncommitted.ts', 'export const dirty = true;\n');

    const result = spawnSync(process.execPath, [prepareScript, root, baseCommit], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('relevant uncommitted changes: src/uncommitted.ts');
    expect(readFileSync(metaPath, 'utf-8')).toBe(metaBefore);
  });

  it('refuses a partial-commit update when another analyzed file is still unstaged', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'partial commit');
    writeProjectFile(root, 'src/b.ts', 'export const stillDirty = 2;\n');

    const result = spawnSync(process.execPath, [prepareScript, root, baseCommit], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('relevant uncommitted changes: src/b.ts');
  });

  it('allows uncommitted files excluded by deterministic analysis rules', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'committed structural change');
    writeProjectFile(root, 'dist/untracked.js', 'generated();\n');

    const { plan } = prepare(root, baseCommit);
    expect(plan.filesToReanalyze).toEqual(['src/a.ts']);
  });

  it('aborts rather than treating a transient scan read failure as deletion', () => {
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) return;
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    const graphPath = join(root, '.ua', 'knowledge-graph.json');
    const metaPath = join(root, '.ua', 'meta.json');
    const graphBefore = readFileSync(graphPath, 'utf-8');
    const metaBefore = readFileSync(metaPath, 'utf-8');
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'committed structural change');
    chmodSync(join(root, 'src/b.ts'), 0o000);

    const result = spawnSync(process.execPath, [prepareScript, root, baseCommit], {
      cwd: root,
      encoding: 'utf-8',
    });
    chmodSync(join(root, 'src/b.ts'), 0o644);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /(?:Project scan reported failures|Working tree has relevant uncommitted changes): src\/b\.ts/,
    );
    expect(readFileSync(graphPath, 'utf-8')).toBe(graphBefore);
    expect(readFileSync(metaPath, 'utf-8')).toBe(metaBefore);
  });
});

describe('finalize-incremental.mjs', { timeout: 30_000 }, () => {
  it('preserves local layer/tour text, removes dangling refs, and places new nodes by path', () => {
    const { root, baseCommit } = setupRepository({
      'src/api/a.ts': 'export const a = 1;\n',
      'src/ui/view.ts': 'export const view = 1;\n',
      'src/other.ts': 'export const other = 1;\n',
      'docs/readme.md': '# Docs\n',
    });
    const graphPath = join(root, '.ua', 'knowledge-graph.json');
    const previousGraph = JSON.parse(readFileSync(graphPath, 'utf-8'));
    previousGraph.layers = [
      {
        id: 'layer:api',
        name: 'API',
        description: 'API files',
        nodeIds: ['file:src/api/a.ts', 'file:missing.ts'],
      },
      {
        id: 'layer:ui',
        name: 'UI',
        description: 'UI files',
        nodeIds: ['file:src/ui/view.ts', 'file:src/other.ts', 'file:docs/readme.md'],
      },
    ];
    previousGraph.tour[0].nodeIds.push('file:missing.ts');
    writeFileSync(graphPath, JSON.stringify(previousGraph), 'utf-8');
    writeProjectFile(root, 'src/api/new.ts', "import { a } from './a';\nexport const value = a;\n");
    const headCommit = commit(root, 'add api file');
    const { plan } = prepare(root, baseCommit);
    expect(plan.action).toBe('PARTIAL_UPDATE');

    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    const newNode = {
      id: 'file:src/api/new.ts',
      type: 'file',
      name: 'new.ts',
      filePath: 'src/api/new.ts',
      summary: 'new api',
      tags: ['api'],
      complexity: 'simple',
    };
    const aId = 'file:src/api/a.ts';
    writeFileSync(
      join(intermediate, 'assembled-graph.json'),
      JSON.stringify({
        nodes: [...retained.nodes, newNode],
        edges: [{ source: newNode.id, target: aId, type: 'imports', direction: 'forward', weight: 0.7 }],
      }),
      'utf-8',
    );

    run(process.execPath, [finalizeScript, root], root);
    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.project.gitCommitHash).toBe(headCommit);
    expect(graph.layers.find(layer => layer.id === 'layer:api').nodeIds).toContain(newNode.id);
    expect(graph.layers.flatMap(layer => layer.nodeIds)).not.toContain('file:missing.ts');
    expect(graph.tour[0].title).toBe('Overview');
    expect(graph.tour[0].description).toBe('Read the project');
    expect(graph.tour[0].nodeIds.every(id => graph.nodes.some(node => node.id === id))).toBe(true);
    const fingerprints = JSON.parse(
      readFileSync(join(root, '.ua', 'fingerprints.json'), 'utf-8'),
    );
    expect(fingerprints.gitCommitHash).toBe(headCommit);
    expect(fingerprints.files).toHaveProperty('src/api/new.ts');
    expect(Object.keys(fingerprints.files)).toHaveLength(5);
  });

  it('does not advance graph, fingerprints, or meta when assembled output is missing', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    const graphPath = join(root, '.ua', 'knowledge-graph.json');
    const fingerprintPath = join(root, '.ua', 'fingerprints.json');
    const metaPath = join(root, '.ua', 'meta.json');
    const graphBefore = readFileSync(graphPath, 'utf-8');
    const fingerprintsBefore = readFileSync(fingerprintPath, 'utf-8');
    const metaBefore = readFileSync(metaPath, 'utf-8');
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'structural change');
    prepare(root, baseCommit);

    const result = spawnSync(process.execPath, [finalizeScript, root], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('assembled-graph.json is missing or invalid');
    expect(readFileSync(graphPath, 'utf-8')).toBe(graphBefore);
    expect(readFileSync(fingerprintPath, 'utf-8')).toBe(fingerprintsBefore);
    expect(readFileSync(metaPath, 'utf-8')).toBe(metaBefore);
  });

  it.each([
    ['table', 'db/schema.sql', 'users'],
    ['endpoint', 'api/openapi.yaml', 'GET-users'],
  ])('accepts a valid %s node as analyzed-file coverage', (nodeType, changedPath, name) => {
    const initialContent = nodeType === 'table'
      ? 'CREATE TABLE users (id INT);\n'
      : 'openapi: 3.0.0\npaths: {}\n';
    const changedContent = nodeType === 'table'
      ? 'CREATE TABLE users (id INT, name TEXT);\n'
      : 'openapi: 3.0.0\npaths:\n  /users: {}\n';
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      [changedPath]: initialContent,
    });
    writeProjectFile(root, changedPath, changedContent);
    const headCommit = commit(root, `change ${nodeType} file`);
    prepare(root, baseCommit);

    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    const analyzedNode = {
      id: `${nodeType}:${changedPath}:${name}`,
      type: nodeType,
      name,
      filePath: changedPath,
      summary: `${nodeType} definition`,
      tags: [nodeType],
      complexity: 'simple',
    };
    writeFileSync(
      join(intermediate, 'assembled-graph.json'),
      JSON.stringify({ nodes: [...retained.nodes, analyzedNode], edges: retained.edges }),
      'utf-8',
    );
    run(process.execPath, [finalizeScript, root], root);

    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.project.gitCommitHash).toBe(headCommit);
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: analyzedNode.id }));
  });

  it('adds a newly introduced language to graph project metadata', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    writeProjectFile(root, 'src/script.py', 'value = 1\n');
    commit(root, 'add first python file');
    prepare(root, baseCommit);

    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    writeFileSync(
      join(intermediate, 'assembled-graph.json'),
      JSON.stringify({
        nodes: [
          ...retained.nodes,
          {
            id: 'file:src/script.py',
            type: 'file',
            name: 'script.py',
            filePath: 'src/script.py',
            summary: 'Python script',
            tags: ['python'],
            complexity: 'simple',
          },
        ],
        edges: retained.edges,
      }),
      'utf-8',
    );
    run(process.execPath, [finalizeScript, root], root);

    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.project.languages).toEqual(['python', 'typescript']);
  });

  it('removes a language from graph metadata when its last file is deleted', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/script.py': 'value = 1\n',
    });
    unlinkSync(join(root, 'src/script.py'));
    commit(root, 'remove last python file');
    prepare(root, baseCommit);
    run(python, [mergeScript, root], root);
    run(process.execPath, [finalizeScript, root], root);

    const graph = JSON.parse(readFileSync(join(root, '.ua', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.project.languages).toEqual(['typescript']);
  });

  it('does not advance the baseline when analyzer output omits a changed file node', () => {
    const { root, baseCommit } = setupRepository({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/c.ts': 'export const c = 3;\n',
      'src/d.ts': 'export const d = 4;\n',
    });
    const graphPath = join(root, '.ua', 'knowledge-graph.json');
    const fingerprintPath = join(root, '.ua', 'fingerprints.json');
    const metaPath = join(root, '.ua', 'meta.json');
    const graphBefore = readFileSync(graphPath, 'utf-8');
    const fingerprintsBefore = readFileSync(fingerprintPath, 'utf-8');
    const metaBefore = readFileSync(metaPath, 'utf-8');
    writeProjectFile(root, 'src/a.ts', 'export const renamed = 1;\n');
    commit(root, 'structural change omitted by analyzer');
    prepare(root, baseCommit);

    const intermediate = join(root, '.ua', 'intermediate');
    const retained = JSON.parse(readFileSync(join(intermediate, 'batch-existing.json'), 'utf-8'));
    writeFileSync(
      join(intermediate, 'assembled-graph.json'),
      JSON.stringify(retained),
      'utf-8',
    );
    const result = spawnSync(process.execPath, [finalizeScript, root], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing whole-file nodes for analyzed paths: src/a.ts');
    expect(readFileSync(graphPath, 'utf-8')).toBe(graphBefore);
    expect(readFileSync(fingerprintPath, 'utf-8')).toBe(fingerprintsBefore);
    expect(readFileSync(metaPath, 'utf-8')).toBe(metaBefore);
  });
});
