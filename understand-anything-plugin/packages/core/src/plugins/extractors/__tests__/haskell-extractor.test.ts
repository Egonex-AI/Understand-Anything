import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { HaskellExtractor } from "../haskell-extractor.js";

const require = createRequire(import.meta.url);
let Parser: any;
let Language: any;
let haskellLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  haskellLang = await Language.load(
    require.resolve("tree-sitter-haskell/tree-sitter-haskell.wasm"),
  );
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(haskellLang);
  const tree = parser.parse(code);
  return { parser, tree, root: tree.rootNode };
}

describe("HaskellExtractor", () => {
  const extractor = new HaskellExtractor();

  it("extracts functions, signatures, imports, exports, and ADTs", () => {
    const { parser, tree, root } = parse(`module Demo (User(..), greet) where
import qualified Data.Text as T
import Project.Model (Model)

data User = User { userName :: String }

greet :: User -> String
greet user = T.unpack (userName user)

privateValue = 42
`);
    const result = extractor.extractStructure(root);

    expect(result.imports).toEqual([
      expect.objectContaining({ source: "Data.Text", specifiers: [] }),
      expect.objectContaining({ source: "Project.Model", specifiers: ["Model"] }),
    ]);
    expect(result.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "greet", returnType: "User -> String" }),
      expect.objectContaining({ name: "privateValue" }),
    ]));
    expect(result.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "User" }),
    ]));
    expect(result.exports.map((entry) => entry.name)).toEqual(["User", "greet"]);

    tree.delete();
    parser.delete();
  });

  it("extracts type-class members, instances, and nested calls", () => {
    const { parser, tree, root } = parse(`module Demo where
class Render a where
  render :: a -> String

instance Render Int where
  render value = show value

format value = length (render value)
`);
    const structure = extractor.extractStructure(root);
    const calls = extractor.extractCallGraph(root);

    expect(structure.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Render", methods: ["render"] }),
      expect.objectContaining({ name: expect.stringMatching(/^instance Render/) }),
    ]));
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ caller: "format", callee: "length" }),
      expect.objectContaining({ caller: "format", callee: "render" }),
    ]));

    tree.delete();
    parser.delete();
  });
});
