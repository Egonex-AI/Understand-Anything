import { beforeAll, describe, expect, it } from 'vitest';
import { TreeSitterPlugin, builtinLanguageConfigs } from '../../../understand-anything-plugin/packages/core/dist/index.js';
import { compareFileSymbols } from '../../../understand-anything-plugin/skills/understand/validate-incremental-symbols.mjs';

let parser;
beforeAll(async () => {
  parser = new TreeSitterPlugin(builtinLanguageConfigs.filter(config => config.treeSitter));
  await parser.init();
});
const oldSource = {
  ts: 'class A { run() {} }\nclass B { keep() {} }',
  rb: 'class A\n def run; end\nend\nclass B\n def keep; end\nend',
  py: 'class A:\n def run(self): pass\nclass B:\n def keep(self): pass\n',
};
const shells = {
  ts: 'class A { keep() {} }\nclass B { keep() {} }\n',
  rb: 'class A\n def keep; end\nend\nclass B\n def keep; end\nend\n',
  py: 'class A:\n def keep(self): pass\nclass B:\n def keep(self): pass\n',
};
const installers = [
  { extension: 'ts', form: 'property assignment', source: (target, key) => `${target}.prototype[${key}] = function() {};` },
  { extension: 'tsx', form: 'property API', source: (target, key) => `Object.defineProperty(${target}.prototype, ${key}, { value() {} });` },
  { extension: 'js', form: 'reflection API', source: (target, key) => `Reflect.defineProperty(${target}.prototype, ${key}, { value() {} });` },
  { extension: 'rb', form: 'reader', source: (target, key) => `${target}.attr_reader(${key})` },
  { extension: 'rb', form: 'method installer', source: (target, key) => `${target}.define_method(${key}) { 1 }` },
  { extension: 'py', form: 'attribute installer', source: (target, key) => `setattr(${target}, ${key}, lambda self: None)` },
];
function classify(extension, currentSource, { beforeSource, name = 'A.run', newNodes = [], oldExtra = {} } = {}) {
  const family = ['ts', 'tsx', 'js', 'jsx'].includes(extension) ? 'ts' : extension;
  const path = `src/example.${extension}`;
  const node = { id: `function:${path}:${name}`, type: 'function', name, filePath: path, ...oldExtra };
  const previous = { filePath: path, nodes: [node], edges: [] };
  const current = { filePath: path, nodes: newNodes, edges: [] };
  const before = parser.analyzeFileStrict(path, beforeSource ?? oldSource[family]);
  const after = parser.analyzeFileStrict(path, currentSource);
  expect(before.status).toBe('succeeded');
  expect(after.status).toBe('succeeded');
  return { before, after, previous, current, result: compareFileSymbols(previous, current, before, after) };
}

const matrix = installers.flatMap(installer => ['A', 'B', 'target'].flatMap(owner => [
  { label: 'same name', key: '"run"', possibleMatch: true },
  { label: 'other name', key: '"other"', possibleMatch: false },
  { label: 'dynamic name', key: '("r" + "un")', possibleMatch: true },
].map(key => ({ ...installer, owner, ...key }))));

describe('scoped symbol evidence contract', () => {
  it.each(matrix)('$extension $form, owner=$owner, $label', ({ extension, owner, key, possibleMatch, source }) => {
    const family = ['ts', 'tsx', 'js'].includes(extension) ? 'ts' : extension;
    const outcome = classify(extension, shells[family] + source(owner, key));
    const status = possibleMatch && owner !== 'B' ? 'unknown' : 'deleted';
    expect(outcome.result.missing[0].status).toBe(status);
    if (status === 'unknown') {
      expect(outcome.result.missing[0].evidence).toContainEqual(expect.objectContaining({ scope: owner === 'target' ? {kind: 'unknown'} : {kind: 'class', name: owner} }));
    }
  });

  it.each(['attr', 'attr_reader', 'attr_accessor', 'attr_writer'])('scopes lexical Ruby %s to B and keeps writer names distinct', accessor => {
    for (const spelling of [':run', '"run"', ':"run"', '("r" + "un").to_sym']) {
      const current = `class A\n def keep; end\nend\nclass B\n ${accessor} ${spelling}\nend`;
      expect(classify('rb', current).result.missing[0].status).toBe('deleted');
      const onA = current.replace(`class B\n ${accessor}`, `class A\n ${accessor}`);
      expect(classify('rb', onA).result.missing[0].status).toBe(accessor === 'attr_writer' ? 'deleted' : 'unknown');
    }
  });

  it.each([':run', '"run"', ':"run"', '("r" + "un").to_sym'])('protects a matching Ruby writer with %s', spelling => {
    const beforeSource = 'class A\n def run=(value); end\nend';
    expect(classify('rb', `class A\n def keep; end\n attr_writer ${spelling}\nend`,
      { beforeSource, name: 'A.run=' }).result.missing[0].status).toBe('unknown');
  });

  it.each([
    ['ts', 'console.log("run"); function log(run) { return run; } socket.send("data");'],
    ['rb', 'puts "run"\nobj.attr\nobj.run'],
    ['py', 'print("run")\ndef log(run): return run\nsocket.send("data")\ntype(A)\n'],
  ])('ordinary %s reads, strings and parameters do not declare an old method', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('deleted');
  });

  it.each([
    ['ts', 'class A { keep() {} } class B { run() {} }'],
    ['rb', 'class A\n def keep; end\nend\nclass B\n def run; end\nend'],
    ['py', 'class A:\n def keep(self): pass\nclass B:\n def run(self): pass'],
  ])('a known different %s owner does not preserve A.run', (extension, code) => {
    expect(classify(extension, code).result.missing[0].status).toBe('deleted');
  });

  it.each([
    ['ts', 'const install = Object.defineProperty; install(A.prototype, "r" + "un", { value() {} });'],
    ['ts', 'const install = Object["define" + "Property"]; install(A.prototype, "r" + "un", { value() {} });'],
    ['rb', 'class A\n install = method(:attr)\n install.call(("r" + "un").to_sym)\nend'],
    ['py', 'install = setattr\ninstall(A, "r" + "un", lambda self: None)'],
  ])('unresolved %s installer aliases cannot authorize deletion', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('unknown');
  });

  it.each(['ts', 'tsx', 'js', 'jsx'])('scopes computed declarations and unextracted fields in %s', extension => {
    for (const declaration of ['["r" + "un"]() {}', 'run = () => {}', '"run"() {}']) {
      expect(classify(extension, `class A { keep() {} } class B { ${declaration} }`).result.missing[0].status).toBe('deleted');
      expect(classify(extension, `class A { keep() {} ${declaration} }`).result.missing[0].status).toBe('unknown');
    }
  });

  it('does not let baseline-only supplemental declarations taint a confirmed current deletion', () => {
    expect(classify('ts', 'function keep() {}', { beforeSource: 'const run = () => {};', name: 'run' })
      .result.missing[0].status).toBe('deleted');
  });

  it.each([
    ['ts', 'function run() {} class A { run() {} }'],
    ['rb', 'class A; def run; end; end; class B; def run; end; end'],
  ])('uses AST ownership for same-line %s declarations', (extension, code) => {
    const state = classify(extension, code, { beforeSource: code });
    expect(state.result.missing[0].status).toBe('still-present');
    expect(compareFileSymbols(state.previous, state.previous, state.before, state.after).missing).toEqual([]);
    if (extension === 'ts') {
      const ambiguous = classify(extension, code, { beforeSource: code, name: 'run', oldExtra: { lineRange: [1, 1] } });
      expect(compareFileSymbols(ambiguous.previous, ambiguous.previous, ambiguous.before, ambiguous.after)
        .missing[0].status).toBe('unknown');
    }
  });

  it('does not turn a same-name class collision into a unique method identity', () => {
    const beforeSource = 'class A { run() {} }\nclass A { keep() {} }';
    expect(classify('ts', 'class A { keep() {} }', { beforeSource }).result.missing[0].status).toBe('unknown');
  });

  it('does not treat escaped class ownership as a confirmed method deletion', () => {
    expect(classify('ts', String.raw`class \u0041 { run() {} keep() {} }`).result.missing[0].status).toBe('unknown');
    expect(classify('ts', 'class A { run() {} keep() {} }', {
      beforeSource: String.raw`class \u0041 { run() {} }`, name: String.raw`\u0041.run`,
    }).result.missing[0].status).toBe('unknown');
  });

  it('rejects duplicate old source identities even when a line locates one declaration', () => {
    expect(classify('ts', 'function run() {} class Keep {}', {
      beforeSource: 'function run() {}\nfunction run() {}', name: 'run', oldExtra: { lineRange: [1, 1] },
    }).result.missing[0].status).toBe('unknown');
  });

  it('requires valid versioned scope evidence before authorizing a deletion', () => {
    const state = classify('ts', shells.ts);
    for (const symbolEvidence of [undefined, { version: 0, possible: [] }, { version: 1, possible: [{}] }]) {
      expect(compareFileSymbols(state.previous, state.current, state.before, { ...state.after, symbolEvidence })
        .missing[0].status).toBe('unknown');
    }
  });

  it.each([
    ['ts', 'function install(B) { Object.defineProperty(B.prototype, "run", {value() {}}); } install(A);'],
    ['ts', 'function install({B}) { Object.defineProperty(B.prototype, "run", {value() {}}); } install({B: A});'],
    ['ts', String.raw`function install(\u0042) { Object.defineProperty(B.prototype, "run", {value() {}}); } install(A);`],
    ['ts', 'B = A; Object.defineProperty(B.prototype, "run", {value() {}});'],
    ['py', 'def install(B): setattr(B, "run", lambda self: None)\ninstall(A)'],
    ['py', 'B = A\nsetattr(B, "run", lambda self: None)'],
  ])('a shadowed or reassigned %s class reference has unknown ownership', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('unknown');
  });

  it.each([
    ['ts', 'function unrelated(B) {} Object.defineProperty(B.prototype, "run", {value() {}});'],
    ['ts', 'const unrelated = function B() {}; Object.defineProperty(B.prototype, "run", {value() {}});'],
    ['ts', 'import { B as unrelated } from "pkg"; Object.defineProperty(B.prototype, "run", {value() {}});'],
    ['py', 'def unrelated(B): pass\nsetattr(B, "run", lambda self: None)'],
    ['py', 'from pkg import B as unrelated\nsetattr(B, "run", lambda self: None)'],
  ])('an unrelated local %s binding does not erase known global ownership', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('deleted');
  });

  it('class member names do not create JavaScript lexical bindings', () => {
    expect(classify('ts', 'class A { keep() {} } class B { B() {} install() { Object.defineProperty(B.prototype, "run", {value() {}}); } }')
      .result.missing[0].status).toBe('deleted');
  });

  it.each([
    ['ts', 'function install(Object) { Object.defineProperty(B.prototype, "other", {}); }'],
    ['ts', 'Object = custom; Object.defineProperty(B.prototype, "other", {});'],
    ['py', 'def install(setattr): setattr(B, "other", value)'],
  ])('unresolved %s installer identity cannot authorize deletion based on its arguments', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('unknown');
  });

  it('standard reflection reads do not declare a method', () => {
    expect(classify('ts', shells.ts + 'Reflect.get(B.prototype, "run"); const get = Reflect.get;')
      .result.missing[0].status).toBe('deleted');
  });

  it('object-literal methods do not become methods of the lexically enclosing class', () => {
    expect(classify('ts', 'function run() {} class A { keep() { return { "run"() {}, ["r" + "un"]() {} }; } }')
      .result.missing[0].status).toBe('deleted');
  });

  it('a currently unresolved Rust receiver cannot prove an old inherent method disappeared', () => {
    expect(classify('rs', 'struct A; impl Trait for A { fn run(&self) {} }', {
      beforeSource: 'struct A; impl A { fn run(&self) {} }',
    }).result.missing[0].status).toBe('unknown');
  });

  it('receiver type formatting is not proof of deletion', () => {
    expect(classify('rs', 'struct A<T>{value:T} impl<T> A< T > { fn run(&self) {} }', {
      beforeSource: 'struct A<T>{value:T} impl<T> A<T> { fn run(&self) {} }', name: 'A<T>.run',
    }).result.missing[0].status).toBe('unknown');
  });

  it('private identifiers are concrete names and are distinct from runtime dot-prefixed keys', () => {
    expect(classify('ts', 'class A { #keep() {} }').result.missing[0].status).toBe('deleted');
    const state = classify('ts', 'class A { keep() {} }; Object.defineProperty(A.prototype, ".run", {value() {}});', {
      beforeSource: 'class A { #run() {} }', name: 'A.#run',
    });
    // The built-in extractor does not yet inventory private methods: that
    // missing baseline identity must remain unknown. The matcher contract also
    // supports extractor inventories that do include these literal names.
    expect(state.result.missing[0].status).toBe('unknown');
    state.before.structure.classes[0].methods.push('#run');
    expect(compareFileSymbols(state.previous, state.current, state.before, state.after).missing[0].status).toBe('deleted');
  });

  it('keeps Python file-level functions distinct from methods', () => {
    const state = classify('py', 'def keep(): pass\nclass A:\n def run(self): pass', {
      beforeSource: 'def run(): pass\nclass A:\n def run(self): pass', name: 'run', oldExtra: {lineRange: [1, 1]},
    });
    expect(state.result.missing[0].status).toBe('deleted');
  });

  it.each(['A', 'B'])('keeps C++ function-valued field uncertainty scoped to %s', owner => {
    const beforeSource = 'struct A { void run() {} }; struct B {};';
    const current = owner === 'A'
      ? 'struct A { void keep() {} std::function<void()> run; }; struct B {};'
      : 'struct A { void keep() {} }; struct B { std::function<void()> run; };';
    expect(classify('cpp', current, { beforeSource }).result.missing[0].status).toBe(owner === 'A' ? 'unknown' : 'deleted');
  });

  it.each(['N::A::run', '::N::A::run'])('cannot prove deletion when C++ qualification moves to %s', qualified => {
    expect(classify('cpp', `void ${qualified}() {} void keep() {}`, {
      beforeSource: 'namespace N { class A { void run() {} }; }',
    }).result.missing[0].status).toBe('unknown');
    expect(classify('cpp', 'void keep() {}', {
      beforeSource: `void ${qualified}() {}`, name: qualified.replace(/^::/, ''),
    }).result.missing[0].status).toBe('unknown');
  });

  it.each(['ts', 'tsx', 'js', 'jsx'])('retains classes and methods rewritten as %s class expressions', extension => {
    for (const binding of ['A', 'B']) for (const expression of ['class A', 'class B', 'class']) {
      const code = `const ${binding} = ${expression} { run() {} }; function keep() {}`;
      const status = binding === 'A' ? 'unknown' : 'deleted';
      expect(classify(extension, code, { beforeSource: 'class A {}', name: 'A', oldExtra: {type: 'class'} })
        .result.missing[0].status).toBe(status);
      expect(classify(extension, code).result.missing[0].status).toBe(status);
    }
    expect(classify(extension, 'const A = (class Named { run() {} }); function keep() {}')
      .result.missing[0].status).toBe('unknown');
    expect(classify(extension, 'A = class Named { run() {} }; function keep() {}')
      .result.missing[0].status).toBe('unknown');
  });

  it.each(['run keep', ':run :keep', ':"run" :"keep"', ':"r#{suffix}" :keep'])('scopes Ruby alias %s to its declaring class', declaration => {
    for (const owner of ['A', 'B']) {
      const code = `${shells.rb}class ${owner}\n alias ${declaration}\nend`;
      expect(classify('rb', code).result.missing[0].status).toBe(owner === 'A' ? 'unknown' : 'deleted');
    }
  });

  it.each(['ts', 'tsx', 'js', 'jsx'])('keeps unbound %s class expressions separate from external class bindings', extension => {
    for (const expression of ['class A', 'class B', 'class']) {
      for (const code of [`consume(${expression} { run() {} }); function keep() {}`,
        `(${expression} { run() {} }); function keep() {}`]) {
        expect(classify(extension, code).result.missing[0].status).toBe('deleted');
        expect(classify(extension, code, { beforeSource: 'class A {}', name: 'A', oldExtra: {type: 'class'} })
          .result.missing[0].status).toBe('deleted');
      }
    }
    // An external binding through a wrapper/property is still unresolved.
    for (const code of ['const A = consume(class B { run() {} }); function keep() {}',
      'target.A = class B { run() {} }; function keep() {}']) {
      expect(classify(extension, code).result.missing[0].status).toBe('unknown');
      expect(classify(extension, code, { beforeSource: 'class A {}', name: 'A', oldExtra: {type: 'class'} })
        .result.missing[0].status).toBe('unknown');
    }
  });

  it('distinguishes Ruby alias writer names, source names and global-variable aliases', () => {
    for (const declaration of ['keep run', ':"run=" :"keep="', '$run $keep']) {
      expect(classify('rb', `${shells.rb}class A\n alias ${declaration}\nend`).result.missing[0].status).toBe('deleted');
    }
    expect(classify('rb', 'class A\n def keep; end\n alias :"run=" :"keep="\nend', {
      beforeSource: 'class A\n def run=(value); end\nend', name: 'A.run=',
    }).result.missing[0].status).toBe('unknown');
  });
  it.each(['ts', 'tsx', 'js', 'jsx'])('keeps nested/local %s scope composition independent of unrelated names', extension => {
    const outerForms = [body => `class B { ${body} }`, body => `const B = class { ${body} };`,
      body => `const B = class Named { ${body} };`, body => `const B = wrap(class Named { ${body} });`];
    for (const outer of outerForms) for (const inner of ['class', 'class A', 'class B']) {
      const code = outer(`static Nested = ${inner} { run() {} };`) + ' function keep() {}';
      expect(classify(extension, code).result.missing[0].status).toBe('deleted');
    }
    for (const internal of ['A', 'B', '']) {
      const code = `class A { keep() {} } class B {} const C = class ${internal} {}; Object.defineProperty(B.prototype, "run", {});`;
      expect(classify(extension, code).result.missing[0].status).toBe('deleted');
    }
    expect(classify(extension, 'function f() { class B {}; Object.defineProperty(B.prototype, "run", {}); }')
      .result.missing[0].status).toBe('deleted');
    expect(classify(extension, 'function f() { B = class Named { run() {} }; let B; } function keep() {}')
      .result.missing[0].status).toBe('deleted');
  });

  it.each([
    ['ts', 'for (const B of items) { Object.defineProperty(B.prototype, "run", {}); }'],
    ['ts', 'try {} catch (B) { Object.defineProperty(B.prototype, "run", {}); }'],
    ['py', 'for B in items: setattr(B, "run", value)'],
    ['py', 'with lock() as B: setattr(B, "run", value)'],
    ['py', 'try: pass\nexcept Exception as B: setattr(B, "run", value)'],
  ])('an unresolved %s binding cannot inherit an outer class identity', (extension, code) => {
    expect(classify(extension, shells[extension] + code).result.missing[0].status).toBe('unknown');
  });

  it('treats missing, malformed and unknown coverage profiles as unavailable evidence', () => {
    const state = classify('ts', shells.ts);
    for (const coverage of [undefined, {profile: 'future', gaps: []}, {profile: 'structural-declarations-v1', gaps: [null]}]) {
      expect(compareFileSymbols(state.previous, state.current, state.before, {
        ...state.after, symbolEvidence: {...state.after.symbolEvidence, coverage},
      }).missing[0].status).toBe('unknown');
    }
  });

  it('reports an unextracted declaration as a coverage gap rather than runtime evidence', () => {
    const state = classify('ts', 'function* run() {} function keep() {}', {
      beforeSource: 'function run() {}', name: 'run',
    });
    expect(state.after.symbolEvidence.coverage.gaps).toContainEqual(expect.objectContaining({name: 'run'}));
    expect(state.result.missing[0].status).toBe('unknown');
    expect(state.result.missing[0].evidence).toContainEqual(expect.objectContaining({name: 'run', reason: 'Callable declaration is not covered by structural extraction'}));
  });

  it('requires an audited coverage adapter even when a grammar parses successfully', () => {
    const state = classify('java', 'class A { void keep() {} }', {
      beforeSource: 'class A { void run() {} }',
    });
    expect(state.result.missing[0].status).toBe('unknown');
    expect(state.after.symbolEvidence.coverage.gaps).toContainEqual(expect.objectContaining({scope: {kind: 'unknown'}}));
  });

  it.each(['ts', 'tsx'])('distinguishes %s parameter properties from ordinary parameters and other owners', extension => {
    for (const modifier of ['public', 'protected', 'private', 'readonly', 'public readonly']) {
      for (const binding of ['run = () => {}', 'run?: () => void', 'other = () => {}']) {
        for (const owner of ['A', 'B']) {
          const code = `class A { keep() {} } class ${owner} { constructor(${modifier} ${binding}) {} }`;
          const result = classify(extension, code).result.missing[0];
          expect(result.status).toBe(owner === 'A' && binding.startsWith('run') ? 'unknown' : 'deleted');
          if (result.status === 'unknown') expect(result.evidence).toContainEqual(expect.objectContaining({
            name: 'run', scope: {kind: 'class', name: 'A'},
            reason: 'Parameter-property callability is not covered by structural extraction',
          }));
        }
      }
    }
    expect(classify(extension, 'class A { constructor(run = () => {}) {} keep() {} }')
      .result.missing[0].status).toBe('deleted');
    expect(classify(extension, 'class B { static Nested = class { constructor(public run = () => {}) {} } }')
      .result.missing[0].status).toBe('deleted');
  });

});
