import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { getStringValue } from "../base-extractor.js";
import { TypeScriptExtractor } from "../typescript-extractor.js";
import type { TreeSitterNode } from "../types.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + TypeScript grammar once
let Parser: any;
let Language: any;
let tsLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  tsLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(tsLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

/** Find the first descendant of the given type. */
function findFirst(node: TreeSitterNode, type: string): TreeSitterNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      const found = findFirst(child, type);
      if (found) return found;
    }
  }
  return null;
}

describe("getStringValue", () => {
  it("returns the full string value even when an escape sequence splits the fragments", () => {
    const { tree, parser, root } = parse(`import x from './a\\tb';`);
    const stringNode = findFirst(root, "string");
    expect(stringNode).not.toBeNull();

    // tree-sitter splits the contents into [string_fragment 'a', escape_sequence '\t', string_fragment 'b'].
    // The full raw value must be preserved, not truncated at the first escape.
    expect(getStringValue(stringNode!)).toBe("./a\\tb");

    tree.delete();
    parser.delete();
  });

  it("preserves trailing fragments after an escaped quote", () => {
    const { tree, parser, root } = parse(`import x from "a\\"b";`);
    const stringNode = findFirst(root, "string");
    expect(stringNode).not.toBeNull();

    // Raw inner text, escape sequence preserved verbatim (backslash + quote),
    // not decoded. toBe (not toContain) so a regression to the truncated
    // first-fragment ("a") would fail this assertion.
    expect(getStringValue(stringNode!)).toBe('a\\"b');

    tree.delete();
    parser.delete();
  });

  it("returns plain strings without escapes unchanged", () => {
    const { tree, parser, root } = parse(`import x from './a';`);
    const stringNode = findFirst(root, "string");
    expect(stringNode).not.toBeNull();

    expect(getStringValue(stringNode!)).toBe("./a");

    tree.delete();
    parser.delete();
  });

  it("falls back to stripping surrounding quotes for nodes without JS-family content children", () => {
    // Grammars outside the JS/TS family (e.g. Python `string_content`) do not
    // produce `string_fragment` / `escape_sequence` children, so the loop finds
    // nothing and the quote-stripping fallback runs. Exercise that branch with a
    // synthetic node whose text is the whole quoted literal and which has no
    // children.
    const makeNode = (text: string): TreeSitterNode =>
      ({ type: "string", text, childCount: 0, child: () => null }) as unknown as TreeSitterNode;

    expect(getStringValue(makeNode(`'./x'`))).toBe("./x");
    expect(getStringValue(makeNode(`"./y"`))).toBe("./y");
    expect(getStringValue(makeNode("`abc`"))).toBe("abc");
  });
});

describe("TypeScriptExtractor import source with escapes", () => {
  const extractor = new TypeScriptExtractor();

  it("records the full import source for paths containing an escape sequence", () => {
    const { tree, parser, root } = parse(`import x from './a\\tb';`);
    const result = extractor.extractStructure(root);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("./a\\tb");

    tree.delete();
    parser.delete();
  });
});
