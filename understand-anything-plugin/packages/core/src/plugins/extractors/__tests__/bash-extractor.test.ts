import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { BashExtractor } from "../bash-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let bashLang: any;

beforeAll(async () => {
  const wts = await import("web-tree-sitter");
  Parser = wts.Parser;
  Language = wts.Language;
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  bashLang = await Language.load(wasmPath);
});

function parse(source: string) {
  const parser = new Parser();
  parser.setLanguage(bashLang);
  const tree = parser.parse(source);
  return { root: tree.rootNode, tree, parser };
}

describe("BashExtractor", () => {
  const extractor = new BashExtractor();

  describe("languageIds", () => {
    it("claims both 'shell' and 'bash' language ids", () => {
      // The language registry registers shell scripts under id 'shell',
      // but third-party plugins may pass 'bash' — we claim both for safety.
      expect(extractor.languageIds).toContain("shell");
      expect(extractor.languageIds).toContain("bash");
    });
  });

  describe("extractStructure - functions", () => {
    it("extracts the parentheses form: `name() { ... }`", () => {
      const { root, tree, parser } = parse(`
deploy() {
  echo "go"
}`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("deploy");
      expect(result.functions[0].params).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("extracts the keyword form: `function name { ... }`", () => {
      const { root, tree, parser } = parse(`
function helper {
  return 0
}`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("helper");
      tree.delete();
      parser.delete();
    });

    it("extracts the combined form: `function name() { ... }`", () => {
      const { root, tree, parser } = parse(`
function build() {
  make
}`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("build");
      tree.delete();
      parser.delete();
    });

    it("captures the function's line range", () => {
      const { root, tree, parser } = parse(`
# header comment

my_func() {
  echo a
  echo b
  echo c
}`);
      const result = extractor.extractStructure(root);
      // 1-indexed; the function starts on line 4 and ends on line 8
      expect(result.functions[0].lineRange[0]).toBe(4);
      expect(result.functions[0].lineRange[1]).toBe(8);
      tree.delete();
      parser.delete();
    });

    it("returns empty functions[] for a script with no function definitions", () => {
      const { root, tree, parser } = parse(`
#!/bin/bash
echo hello
ls -la`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toEqual([]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - sourced imports", () => {
    it("extracts `source ./path.sh`", () => {
      const { root, tree, parser } = parse(`source ./lib.sh`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./lib.sh");
      tree.delete();
      parser.delete();
    });

    it("extracts `. /path/to/file.sh` (POSIX dot)", () => {
      const { root, tree, parser } = parse(`. /etc/profile`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("/etc/profile");
      tree.delete();
      parser.delete();
    });

    it("strips surrounding quotes from quoted source paths", () => {
      const { root, tree, parser } = parse(`source "./common.sh"`);
      const result = extractor.extractStructure(root);
      expect(result.imports[0].source).toBe("./common.sh");
      tree.delete();
      parser.delete();
    });

    it("preserves unresolved variable expansions in the source path", () => {
      // We can't resolve $DIR at static-analysis time — we surface the raw
      // path so downstream consumers can choose how to handle it.
      const { root, tree, parser } = parse(`source "$DIR/util.sh"`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toContain("util.sh");
      tree.delete();
      parser.delete();
    });

    it("does NOT treat ordinary commands as imports", () => {
      const { root, tree, parser } = parse(`echo hello\nls -la\ngit status`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toEqual([]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("treats every top-level function as exported", () => {
      const { root, tree, parser } = parse(`
foo() { echo foo; }
bar() { echo bar; }`);
      const result = extractor.extractStructure(root);
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toEqual(["bar", "foo"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("returns an empty classes array — bash has no class concept", () => {
      const { root, tree, parser } = parse(`
deploy() { echo a; }`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toEqual([]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("attributes calls inside a function to that function", () => {
      const { root, tree, parser } = parse(`
deploy() {
  build_artifact
  ./upload.sh prod
}`);
      const calls = extractor.extractCallGraph(root);
      const fromDeploy = calls.filter((c) => c.caller === "deploy").map((c) => c.callee);
      expect(fromDeploy).toContain("build_artifact");
      expect(fromDeploy).toContain("./upload.sh");
      tree.delete();
      parser.delete();
    });

    it("filters out shell built-ins (echo, cd, [, export, etc.)", () => {
      const { root, tree, parser } = parse(`
go() {
  echo "starting"
  cd /tmp
  export FOO=bar
  do_real_work
  return 0
}`);
      const calls = extractor.extractCallGraph(root);
      const callees = calls.filter((c) => c.caller === "go").map((c) => c.callee);
      // Only the user-defined call survives
      expect(callees).toEqual(["do_real_work"]);
      tree.delete();
      parser.delete();
    });

    it("captures calls inside pipelines and conditionals", () => {
      const { root, tree, parser } = parse(`
main() {
  if check_health; then
    restart_service
  fi
  fetch_logs | parse_logs
}`);
      const calls = extractor.extractCallGraph(root);
      const callees = calls.filter((c) => c.caller === "main").map((c) => c.callee).sort();
      expect(callees).toContain("check_health");
      expect(callees).toContain("restart_service");
      expect(callees).toContain("fetch_logs");
      expect(callees).toContain("parse_logs");
      tree.delete();
      parser.delete();
    });
  });

  describe("comprehensive script", () => {
    it("extracts a realistic mix of imports, functions, and calls", () => {
      const { root, tree, parser } = parse(`#!/bin/bash
# Deployment script

source ./lib/common.sh
. /etc/deployment.conf

build() {
  echo "building..."
  make clean
  make all
}

deploy() {
  build
  upload_artifact "$BUILD_DIR/app.tar.gz"
  notify_team
}

if [ "$1" = "prod" ]; then
  deploy
fi
`);
      const result = extractor.extractStructure(root);

      expect(result.imports.map((i) => i.source).sort()).toEqual([
        "./lib/common.sh",
        "/etc/deployment.conf",
      ]);

      const funcNames = result.functions.map((f) => f.name).sort();
      expect(funcNames).toEqual(["build", "deploy"]);

      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toEqual(["build", "deploy"]);

      const calls = extractor.extractCallGraph(root);
      const fromDeploy = calls.filter((c) => c.caller === "deploy").map((c) => c.callee);
      expect(fromDeploy).toContain("build");
      expect(fromDeploy).toContain("upload_artifact");
      expect(fromDeploy).toContain("notify_team");

      // `make clean` and `make all` are interesting calls — `make` is not a builtin
      const fromBuild = calls.filter((c) => c.caller === "build").map((c) => c.callee);
      expect(fromBuild).toContain("make");

      tree.delete();
      parser.delete();
    });
  });
});
