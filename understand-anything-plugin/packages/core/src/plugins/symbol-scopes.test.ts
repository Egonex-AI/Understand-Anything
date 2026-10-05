import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { buildSymbolScopes, type SymbolScope } from "./symbol-scopes.js";
import type { TreeSitterNode as Node } from "./extractors/types.js";

const require = createRequire(import.meta.url);
let language: Language;
beforeAll(async () => {
  await Parser.init();
  language = await Language.load(require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"));
});
function inspect(code: string, check: (nodes: Node[], scopes: ReturnType<typeof buildSymbolScopes>) => void) {
  const parser = new Parser(); parser.setLanguage(language);
  const tree = parser.parse(code)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const nodes: Node[] = [];
    const visit = (node: Node) => { nodes.push(node); node.namedChildren.forEach(visit); };
    visit(tree.rootNode);
    check(nodes, buildSymbolScopes(tree.rootNode, "typescript"));
  } finally { tree.delete(); parser.delete(); }
}
const owner = (name: string): SymbolScope => ({ kind: "class", name });
const local = expect.objectContaining({ kind: "local" });
const unknown = { kind: "unknown" };

describe("source scope composition", () => {
  it.each(["A", "B", ""])('keeps expression-internal name "%s" inside its class', internal => {
    inspect(`class B {} const C = class ${internal} { run() {} }; Object.defineProperty(B.prototype, "run", {});`, (nodes, scopes) => {
      const method = nodes.find(node => node.type === "method_definition")!;
      expect(scopes.declaration(method)).toEqual(owner("C"));
      const receiver = nodes.find(node => node.type === "identifier" && node.text === "B" && node.parent?.type === "member_expression")!;
      expect(scopes.reference(receiver, "B")).toEqual(owner("B"));
      if (internal) expect(scopes.reference(method, internal)).toEqual(owner("C"));
    });
  });
  const contexts = [
    { label: "declaration", wrap: (body: string) => `class B { ${body} }` },
    { label: "expression", wrap: (body: string) => `const B = class { ${body} };` },
    { label: "named expression", wrap: (body: string) => `const B = class Named { ${body} };` },
    { label: "wrapped expression", wrap: (body: string) => `const B = wrap(class Named { ${body} });` },
  ];
  it.each(contexts)("separates nested class fields inside $label", ({ wrap }) => {
    for (const inner of ["class", "class A", "class B"]) for (const field of ["Nested", "static Nested"]) {
      inspect(wrap(`${field} = ${inner} { run() {} };`), (nodes, scopes) => {
        expect(scopes.declaration(nodes.find(node => node.type === "method_definition")!)).toEqual(local);
      });
    }
  });
  it.each([
    ["consume(class A { run() {} });", local],
    ["(class A { run() {} });", local],
    ["function f() { const B = class A { run() {} }; }", local],
    ["const B = wrap(class A { run() {} });", unknown],
    ["target.B = class A { run() {} };", unknown],
    ["const B = (class A { run() {} });", owner("B")],
    ["B = class A { run() {} };", owner("B")],
  ])("models the value region for %s", (code, expected) => {
    inspect(code as string, (nodes, scopes) => {
      expect(scopes.declaration(nodes.find(node => node.type === "method_definition")!)).toEqual(expected);
    });
  });
  it("resolves local classes without requiring a graph extractor inventory", () => {
    inspect('function f() { class B {}; Object.defineProperty(B.prototype, "run", {}); }', (nodes, scopes) => {
      const receiver = nodes.find(node => node.type === "identifier" && node.text === "B" && node.parent?.type === "member_expression")!;
      expect(scopes.reference(receiver, "B")).toEqual(local);
    });
  });
  it.each(["let A; A = class B { run() {} };", "A = class B { run() {} }; let A;"])("indexes assignment bindings independently of declaration order: %s", body => {
    inspect(`class A {} function f() { ${body} }`, (nodes, scopes) => {
      expect(scopes.declaration(nodes.find(node => node.type === "method_definition")!)).toEqual(local);
    });
  });
  it.each(["class B {} B = A;", "B = A; class B {}", "function f(B) { USE }"])("does not invent a known owner for shadowed or reassigned references: %s", template => {
    const use = 'Object.defineProperty(B.prototype, "run", {});';
    inspect(template.includes("USE") ? template.replace("USE", use) : template + use, (nodes, scopes) => {
      const receiver = nodes.find(node => node.type === "identifier" && node.text === "B" && node.parent?.type === "member_expression")!;
      expect(scopes.reference(receiver, "B")).toEqual(unknown);
    });
  });
});
