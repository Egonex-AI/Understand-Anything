import { beforeAll, describe, expect, it } from 'vitest';
import { TreeSitterPlugin, builtinLanguageConfigs } from '../../../understand-anything-plugin/packages/core/dist/index.js';
import { compareFileSymbols } from '../../../understand-anything-plugin/skills/understand/validate-incremental-symbols.mjs';

let parser;
beforeAll(async () => {
  parser = new TreeSitterPlugin(builtinLanguageConfigs.filter(config => config.treeSitter));
  await parser.init();
});

const node = (name, extra = {}) => ({
  id: `function:src/a.ts:${name}`, name, type: 'function', filePath: 'src/a.ts', ...extra,
});
const graph = nodes => ({ filePath: 'src/a.ts', nodes, edges: [] });
const parse = content => parser.analyzeFileStrict('src/a.ts', content);
const compare = (oldNodes, newNodes, oldSource, newSource) => compareFileSymbols(
  graph(oldNodes), graph(newNodes), parse(oldSource), parse(newSource),
);

describe('incremental symbol matching', () => {
  it.each(['attr :name', 'attr "name"', 'attr :"name"', 'attr :name, true', 'attr_reader :name',
    'attr_writer :name', 'attr_accessor :name', 'obj.attr', 'attr_writer "run"', 'attr_writer :"run"'])('allows unrelated Ruby deletion beside %s', accessor => {
    const before = parser.analyzeFileStrict('a.rb', 'class A\n def run; end\nend');
    const after = parser.analyzeFileStrict('a.rb', `class A\n def keep; end\n ${accessor}\nend`);
    expect(after.symbolEvidence?.version).toBe(2);
    expect(compareFileSymbols(graph([node('A.run')]), graph([]), before, after).missing[0].status).toBe('deleted');
  });

  it.each([
    ['run', 'attr :run'], ['run=', 'attr :run, true'], ['run=', 'attr_writer :run'],
    ['run=', 'attr_writer "run"'], ['run=', 'attr_writer :"run"'],
    ['run', 'attr_accessor :run'], ['run=', 'attr_accessor :run'], ['run', 'attr_reader :run'],
  ])('does not confirm deletion of Ruby %s still installed by %s', (name, accessor) => {
    const before = parser.analyzeFileStrict('a.rb', `class A\n def ${name}${name.endsWith('=') ? '(value)' : ''}; end\nend`);
    const after = parser.analyzeFileStrict('a.rb', `class A\n def keep; end\n ${accessor}\nend`);
    expect(before.status).toBe('succeeded');
    expect(after.symbolEvidence?.version).toBe(2);
    expect(compareFileSymbols(graph([node(`A.${name}`)]), graph([]), before, after).missing[0].status).toBe('unknown');
  });

  it.each([
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n define_method(("r" + "un").to_sym) { 1 }\nend\n'],
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n attr(("r" + "un").to_sym)\nend\n'],
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n install = method(:attr)\n install.call(("r" + "un").to_sym)\nend\n'],
    ['rb', 'class A\n def run; end\nend\n', 'class A\n def keep; end\n send(:define_method, ("r" + "un").to_sym) { 1 }\nend\n'],
    ['py', 'class A:\n def run(self): pass\n', 'class A:\n def keep(self): pass\nsetattr(A, "r" + "un", lambda self: None)\n'],
    ['py', 'class A:\n def run(self): pass\n', 'class A:\n def keep(self): pass\ninstall = setattr\ninstall(A, "r" + "un", lambda self: None)\n'],
  ])('keeps runtime-installed %s methods unresolved', (extension, oldSource, newSource) => {
    const filePath = `src/a.${extension}`;
    const before = parser.analyzeFileStrict(filePath, oldSource);
    const after = parser.analyzeFileStrict(filePath, newSource);
    expect(before.status).toBe('succeeded');
    expect(after.status).toBe('succeeded');
    expect(after.symbolEvidence?.effects.length).toBeGreaterThan(0);
    const previous = graph([node('A.run', { filePath, id: `function:${filePath}:A.run` })]);
    expect(compareFileSymbols(previous, graph([]), before, after).missing[0].status).toBe('unknown');
    const ordinary = parser.analyzeFileStrict(filePath, extension === 'rb'
      ? 'class A\n def keep; end\nend\n' : 'class A:\n def keep(self): pass\n');
    expect(compareFileSymbols(previous, graph([]), before, ordinary).missing[0].status).toBe('deleted');
  });

  it.each(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'])('rejects computed assignment deletion evidence in .%s', extension => {
    const filePath = `src/a.${extension}`;
    const before = parser.analyzeFileStrict(filePath, 'class A { run() {} }');
    const after = parser.analyzeFileStrict(filePath, 'class A { keep() {} }; A.prototype["r" + "un"] = function() {};');
    // The built-in language registry does not yet enable .mts/.cts parsing;
    // those extensions must still block instead of implying source deletion.
    const expectedStatus = ['mts', 'cts'].includes(extension) ? 'unsupported' : 'succeeded';
    expect(before.status).toBe(expectedStatus);
    expect(after.status).toBe(expectedStatus);
    const previous = graph([node('A.run', { filePath, id: `function:${filePath}:A.run` })]);
    expect(compareFileSymbols(previous, graph([]), before, after).missing[0].status).toBe('unknown');
  });

  it.each([
    ['go', 'Run', 'package p\ntype A struct{}\ntype B struct{}\n', owner => `func (x ${owner}) Run() {}\n`, 'func Run() {}\n'],
    ['rs', 'run', 'struct A;\nstruct B;\n', owner => `impl ${owner} { fn run(&self) {} }\n`, 'fn run() {}\n'],
    ['cpp', 'run', 'struct A { void run(); };\nstruct B { void run(); };\n', owner => `void ${owner}::run() {}\n`, 'void run() {}\n'],
  ])('keeps %s receiver methods distinct from each other and a free function', (extension, name, types, method, free) => {
    const filePath = `src/a.${extension}`;
    const evidence = source => parser.analyzeFileStrict(filePath, source);
    const descriptor = line => node(name, { id: `function:${filePath}:${name}`, filePath, lineRange: [line, line] });
    const check = (oldSource, headSource, oldLine, newLine) => {
      const base = evidence(oldSource);
      const head = evidence(headSource);
      expect(base.status).toBe('succeeded');
      expect(head.status).toBe('succeeded');
      return compareFileSymbols(graph([descriptor(oldLine)]), graph([descriptor(newLine)]), base, head);
    };
    const start = types.split('\n').length;
    const both = types + method('A') + method('B') + free;
    expect(check(both, both, start, start + 1).missing[0].status).toBe('still-present');
    expect(check(both, both, start, start).missing).toEqual([]);
    expect(check(both, both, start + 2, start + 2).missing).toEqual([]);
    // A receiver-only file has no class range available for deduplication.
    const prefix = extension === 'go' ? 'package p\n' : '';
    const first = prefix.split('\n').length;
    expect(check(prefix + method('A'), prefix + method('B'), first, first).missing[0].status).toBe('unknown');
  });

  it('does not treat legacy or unresolved receiver metadata as a free function', () => {
    const code = 'package p\ntype A struct{}\nfunc (x A) Run() {}\n';
    const evidence = parser.analyzeFileStrict('a.go', code);
    const nodes = graph([node('Run', { lineRange: [3, 3] })]);
    for (const owner of [undefined, null]) {
      const old = structuredClone(evidence);
      old.structure.functions[0].owner = owner;
      expect(compareFileSymbols(nodes, nodes, old, evidence).missing[0].status).toBe('unknown');
    }
    const trait = parser.analyzeFileStrict('a.rs', 'struct A; impl Trait for A { fn run(&self) {} }');
    expect(compareFileSymbols(graph([node('A.run')]), graph([node('A.run')]), trait, trait)
      .missing[0].status).toBe('unknown');
  });

  it('detects an omitted old method even when total node counts stay the same', () => {
    const result = compare([node('A.keep'), node('A.lost')], [node('A.keep'), node('A.added')],
      'class A { keep() {} lost() {} }', 'class A { keep() {} lost() {} added() {} }');
    expect(result.beforeCount).toBe(result.afterCount);
    expect(result.missing).toEqual([expect.objectContaining({ name: 'A.lost', status: 'still-present' })]);
  });

  it('accepts spelling changes and moved lines for a uniquely identified method', () => {
    const result = compare([node('A.run', { lineRange: [2, 2] })],
      [node('run', { id: 'func:src/a.ts:A::run', lineRange: [6, 6] })],
      'class A {\n run() {}\n}', '\n\n\n\nclass A {\n run() {}\n}');
    expect(result.missing).toEqual([]);
    expect(result.replacements).toEqual([{ oldId: 'function:src/a.ts:A.run', newId: 'func:src/a.ts:A::run' }]);
  });

  it('does not substitute a different class with the same method name', () => {
    const code = 'class A { run() {} }\nclass B { run() {} }';
    const result = compare([node('A.run'), node('B.run')], [node('B.run')], code, code);
    expect(result.missing).toEqual([expect.objectContaining({ name: 'A.run', status: 'still-present' })]);
    expect(compare([node('run')], [], code, code).missing[0].status).toBe('unknown');
  });

  it('uses class containment when graph method names are unqualified', () => {
    const code = 'class A { run() {} }\nclass B { run() {} }';
    const previous = graph([node('A', { id: 'class:src/a.ts:A', type: 'class' }), node('run')]);
    previous.edges.push({ type: 'contains', source: 'class:src/a.ts:A', target: node('run').id });
    const result = compareFileSymbols(previous, graph([previous.nodes[0]]), parse(code), parse(code));
    expect(result.missing[0]).toMatchObject({ name: 'run', status: 'still-present' });
  });

  it('does not let an unchanged generic ID hide a changed or missing class owner', () => {
    const code = 'class A { run() {} }\nclass B { run() {} }';
    const classes = ['A', 'B'].map(name => node(name, { id: `class:src/a.ts:${name}`, type: 'class' }));
    const previous = graph([...classes, node('run')]);
    previous.edges = [{ source: classes[0].id, target: node('run').id, type: 'contains' }];
    for (const edges of [[], [{ source: classes[1].id, target: node('run').id, type: 'contains' }]]) {
      const current = { ...graph([...classes, node('run')]), edges };
      const result = compareFileSymbols(previous, current, parse(code), parse(code));
      expect(result.missing[0]).toMatchObject({ id: node('run').id, status: 'still-present' });
      expect(compareFileSymbols(previous, current, { status: 'unsupported' }, { status: 'unsupported' })
        .missing[0].status).toBe('unknown');
    }
    expect(compareFileSymbols(previous, previous).missing).toEqual([]);
    const ambiguous = graph([...classes, node('run')]);
    expect(compareFileSymbols(ambiguous, ambiguous, parse(code), parse(code)).missing[0].status).toBe('unknown');
  });

  it('accepts a top-level function sharing a name with a method when source locations establish ownership', () => {
    const code = 'function run() {}\nclass A { run() {} }';
    const nodes = [node('A', { type: 'class', id: 'class:src/a.ts:A' }), node('run', { lineRange: [1, 1] })];
    expect(compare(nodes, nodes, code, code).missing).toEqual([]);
  });

  it('verifies generic callables even when neither graph contains class nodes', () => {
    const nodes = [node('run', { lineRange: [1, 1] })];
    expect(compare(nodes, nodes, 'class A { run() {} }', 'class B { run() {} }')
      .missing[0].status).toBe('unknown');
    const opaqueIds = [node('run', { id: 'function:src/a.ts:method.run', lineRange: [1, 1] })];
    expect(compare(opaqueIds, opaqueIds, 'class A { run() {} }', 'class B { run() {} }')
      .missing[0].status).toBe('unknown');
    expect(compare(nodes, [node('run', { lineRange: [2, 2] })],
      'class A { run() {} }', 'class A { run() {} }\nclass B { run() {} }')
      .missing[0].status).toBe('still-present');
    expect(compare(nodes, nodes, 'class A { run() {} }', 'class A { run() {} added() {} }').missing).toEqual([]);
    const unknown = { status: 'unsupported' };
    expect(compareFileSymbols(graph(nodes), graph(nodes), unknown, unknown).missing[0].status).toBe('unknown');
    // Preserving identical current descriptors within one HEAD is a different
    // operation from accepting an old symbol across source revisions.
    expect(compareFileSymbols(graph(nodes), graph(nodes), unknown, unknown, true).missing).toEqual([]);
  });

  it('confirms genuine function, class, and method deletions without restoring them', () => {
    const result = compare([node('gone'), node('Old', { type: 'class' }), node('A.removed')], [],
      'function gone() {} class Old {} class A { removed() {} keep() {} }',
      'class A { keep() {} }');
    expect(result.missing.map(entry => entry.status)).toEqual(['deleted', 'deleted', 'deleted']);
  });

  it.each([
    ['parse error', 'class A {'],
    ['empty extraction', '// everything removed'],
    ['unextracted arrow method', 'class A { run = () => {}; }'],
    ['computed method', 'class A { ["run"]() {} }'],
    ['computed name fragments', 'class A { ["r" + "un"]() {} keep() {} }'],
    ['computed method assignment', 'class A { keep() {} }; A.prototype["r" + "un"] = function() {};'],
    ['computed property-definition call', 'class A { keep() {} }; Object.defineProperty(A.prototype, "r" + "un", { value() {} });'],
    ['computed reflection call', 'class A { keep() {} }; Reflect.defineProperty(A.prototype, "r" + "un", { value() {} });'],
    ['escaped method assignment', String.raw`class A { keep() {} }; A.prototype.r\u0075n = function() {};`],
    ['escaped identifier', String.raw`class A { r\u0075n() {} keep() {} }`],
    ['escaped string method name', String.raw`class A { "r\u0075n"() {} keep() {} }`],
  ])('treats %s as unknown, never deletion', (_label, code) => {
    expect(compare([node('A.run')], [], 'class A { run() {} }', code).missing[0].status).toBe('unknown');
  });

  it('requires valid baseline extraction and rejects unsupported languages', () => {
    for (const evidence of [{ status: 'unsupported' }, parse('class Broken {')]) {
      const result = compareFileSymbols(graph([node('lost')]), graph([]), evidence, parse('function keep() {}'));
      expect(result.missing[0].status).toBe('unknown');
    }
  });

  it('does not confirm deletion when escaped names disappear or strict-parser evidence is outdated', () => {
    const escaped = String.raw`A.r\u0075n`;
    expect(compare([node(escaped)], [], String.raw`class A { r\u0075n() {} }`, 'class A { run() {} keep() {} }')
      .missing[0].status).toBe('unknown');
    const outdated = { ...parse('class A { keep() {} }') };
    delete outdated.symbolEvidence;
    const result = compareFileSymbols(graph([node('A.run')]), graph([]), parse('class A { run() {} }'), outdated);
    expect(result.missing[0].status).toBe('unknown');
  });

  it('cannot use one new node to replace two old nodes with the same source identity', () => {
    const code = 'function f() {}';
    const result = compare([node('f', { id: 'old:one' }), node('f', { id: 'old:two' })],
      [node('f', { id: 'new:one' })], code, code);
    expect(result.missing.map(entry => entry.status)).toEqual(['unknown', 'unknown']);
  });

  it('keeps overloads ambiguous even when a qualified name is available', () => {
    const result = compare([node('A.run')], [],
      'class A { run() {} run(n: number) {} }', 'class A { keep() {} }');
    expect(result.missing[0].status).toBe('unknown');
  });
});
