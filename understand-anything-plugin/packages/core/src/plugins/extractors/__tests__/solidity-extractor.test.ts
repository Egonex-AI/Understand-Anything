import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { SolidityExtractor } from "../solidity-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let solLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@repomix/tree-sitter-wasms/out/tree-sitter-solidity.wasm",
  );
  solLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(solLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

const PRAGMA = "pragma solidity ^0.8.0;\n";

describe("SolidityExtractor", () => {
  const extractor = new SolidityExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["solidity"]);
  });

  describe("extractStructure - contracts", () => {
    it("extracts a contract with a state variable + public function", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract Token {
    uint256 public totalSupply;

    function transfer(address to, uint256 amount) public returns (bool) {
        return true;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Token");
      expect(result.classes[0].properties).toContain("totalSupply");
      expect(result.classes[0].methods).toContain("transfer");

      // The function returns bool — single-value return is rendered as the type
      const fn = result.functions.find((f) => f.name === "transfer");
      expect(fn).toBeDefined();
      expect(fn!.params).toEqual(["to", "amount"]);
      expect(fn!.returnType).toBe("bool");

      tree.delete();
      parser.delete();
    });

    it("treats constructor as a method named 'constructor'", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract Token {
    string public name;

    constructor(string memory _name) {
        name = _name;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("constructor");
      const ctor = result.functions.find((f) => f.name === "constructor");
      expect(ctor).toBeDefined();
      expect(ctor!.params).toEqual(["_name"]);

      tree.delete();
      parser.delete();
    });

    it("surfaces modifiers and events as members of the contract", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract Owned {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        owner = newOwner;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining([
          "OwnershipTransferred",
          "onlyOwner",
          "transferOwnership",
        ]),
      );

      tree.delete();
      parser.delete();
    });

    it("handles multi-value return types as a parenthesised tuple", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    function pair() public pure returns (uint256, address) {
        return (0, address(0));
    }
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "pair");
      expect(fn).toBeDefined();
      expect(fn!.returnType).toBe("(uint256, address)");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - interfaces & libraries", () => {
    it("extracts an interface with method declarations", () => {
      const { tree, parser, root } = parse(`${PRAGMA}interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("IERC20");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["totalSupply", "balanceOf"]),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts a library with internal functions", () => {
      const { tree, parser, root } = parse(`${PRAGMA}library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("SafeMath");
      expect(result.classes[0].methods).toContain("add");
      // `internal` visibility — function should NOT be in exports
      expect(result.exports.map((e) => e.name)).not.toContain("add");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts a plain path import and derives the specifier from the filename", () => {
      const { tree, parser, root } = parse(`${PRAGMA}import "./IERC20.sol";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./IERC20.sol");
      expect(result.imports[0].specifiers).toEqual(["IERC20"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a named-import form", () => {
      const { tree, parser, root } = parse(`${PRAGMA}import {SafeMath} from "./SafeMath.sol";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./SafeMath.sol");
      expect(result.imports[0].specifiers).toEqual(["SafeMath"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a `* as Alias` import", () => {
      const { tree, parser, root } = parse(`${PRAGMA}import * as ERC20 from "./ERC20.sol";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./ERC20.sol");
      expect(result.imports[0].specifiers).toEqual(["ERC20"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("treats public and external functions as exported", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    function open() public {}
    function ext() external {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(expect.arrayContaining(["open", "ext"]));

      tree.delete();
      parser.delete();
    });

    it("does NOT export internal or private functions", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    function helper() internal {}
    function secret() private {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).not.toContain("helper");
      expect(exportNames).not.toContain("secret");

      tree.delete();
      parser.delete();
    });

    it("exports public state variables (Solidity auto-generates a getter)", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    uint256 public total;
    string private label;
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("total");
      expect(exportNames).not.toContain("label");

      tree.delete();
      parser.delete();
    });

    it("contracts are always exported by name", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {}
interface I {}
library L {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(expect.arrayContaining(["C", "I", "L"]));

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("attributes a function-internal call to the enclosing function", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    function helper() internal returns (uint256) { return 1; }

    function caller() public returns (uint256) {
        return helper();
    }
}
`);
      const entries = extractor.extractCallGraph(root);

      const helperCall = entries.find((e) => e.callee === "helper");
      expect(helperCall).toBeDefined();
      expect(helperCall!.caller).toBe("caller");

      tree.delete();
      parser.delete();
    });

    it("attributes a require() call inside a modifier to the modifier name", () => {
      const { tree, parser, root } = parse(`${PRAGMA}contract C {
    address owner;
    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }
}
`);
      const entries = extractor.extractCallGraph(root);

      const reqCall = entries.find((e) => e.callee === "require");
      expect(reqCall).toBeDefined();
      expect(reqCall!.caller).toBe("onlyOwner");

      tree.delete();
      parser.delete();
    });
  });
});
