import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { PuppetExtractor } from "../puppet-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Puppet grammar once.
//
// Deliberately NOT wrapped in try/catch: this is also the ABI smoke test for
// the bundled tree-sitter-puppet wasm. If the upstream artifact ever loses the
// dylink.0 section (the tree-sitter-dart lesson), this fails loudly instead of
// the plugin silently degrading at runtime.
let Parser: any;
let Language: any;
let puppetLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-puppet/tree-sitter-puppet.wasm",
  );
  puppetLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(puppetLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("PuppetExtractor", () => {
  const extractor = new PuppetExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["puppet"]);
  });

  describe("extractStructure - declarations", () => {
    it("extracts a simple class as a class entry + export", () => {
      const { tree, parser, root } = parse(`class base {
  notice('hello')
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("base");
      expect(result.classes[0].lineRange[0]).toBe(1);
      expect(result.exports.map(e => e.name)).toEqual(["base"]);

      tree.delete();
      parser.delete();
    });

    it("extracts class name, parameter names and inherits edge", () => {
      const { tree, parser, root } = parse(`class profile::web (
  String $docroot = '/var/www',
  Integer $port = 80,
) inherits base {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("profile::web");
      expect(result.classes[0].properties).toEqual(["docroot", "port"]);
      expect(result.imports).toEqual([
        { source: "base", specifiers: ["base"], lineNumber: 4 },
      ]);

      tree.delete();
      parser.delete();
    });

    it("extracts a defined type as a class entry", () => {
      const { tree, parser, root } = parse(`define cache_dir (
  String $owner = 'root',
) {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("cache_dir");
      expect(result.classes[0].properties).toEqual(["owner"]);
      expect(result.exports.map(e => e.name)).toEqual(["cache_dir"]);

      tree.delete();
      parser.delete();
    });

    it("lists nested defines as class methods", () => {
      const { tree, parser, root } = parse(`class outer {
  define inner_unit (String $path) {
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("outer");
      expect(result.classes[0].methods).toEqual(["inner_unit"]);

      tree.delete();
      parser.delete();
    });

    it("extracts functions with params and return type", () => {
      const { tree, parser, root } = parse(`function helper::greet(String $who, Optional[String] $greeting = undef) >> String {
  notice('x')
}

function old_style($x) {
  notice($x)
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("helper::greet");
      expect(result.functions[0].params).toEqual(["who", "greeting"]);
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("old_style");
      expect(result.functions[1].params).toEqual(["x"]);
      expect(result.functions[1].returnType).toBeUndefined();
      expect(result.exports.map(e => e.name)).toEqual(["helper::greet", "old_style"]);

      tree.delete();
      parser.delete();
    });

    it("skips the misparsed parameterized-class form without a crash", () => {
      // `class { 'x': }` parses as class_definition with a MISSING identifier;
      // no nameless entry may leak into classes[].
      const { tree, parser, root } = parse(`class { 'paraclas':
  param => 1,
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(0);
      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - references", () => {
    it("collects include lists and qualified names as imports", () => {
      const { tree, parser, root } = parse(`class svc {
  include stdlib
  include apache, ntp
  require profile::base
}
`);
      const sources = extractor.extractStructure(root).imports.map(i => i.source);
      expect(sources).toEqual(["stdlib", "apache", "ntp", "profile::base"]);

      tree.delete();
      parser.delete();
    });

    it("collects contain() string and array arguments as imports", () => {
      const { tree, parser, root } = parse(`class svc {
  contain('paren')
  contain(['two','three'])
}
`);
      const sources = extractor.extractStructure(root).imports.map(i => i.source);
      expect(sources).toEqual(["paren", "two", "three"]);

      tree.delete();
      parser.delete();
    });

    it("collects template()/epp() and puppet:/// source references", () => {
      const { tree, parser, root } = parse(`class svc {
  file { '/etc/motd':
    content => template('profile/motd.erb'),
  }
  file { '/etc/index':
    content => epp('profile/index.epp'),
  }
  file { '/etc/data':
    source => 'puppet:///modules/profile/data/thing',
  }
}
`);
      const sources = extractor.extractStructure(root).imports.map(i => i.source);
      expect(sources).toEqual([
        "profile/motd.erb",
        "profile/index.epp",
        "puppet:///modules/profile/data/thing",
      ]);

      tree.delete();
      parser.delete();
    });

    it("finds includes hidden inside if/case and relation nesting", () => {
      const { tree, parser, root } = parse(`class svc {
  if $role == 'web' {
    include apache
  } else {
    include postgresql
  }
  case $role {
    'a': { include a_thing }
    default: {}
  }
}
`);
      const sources = extractor.extractStructure(root).imports.map(i => i.source);
      expect(sources).toEqual(["apache", "postgresql", "a_thing"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - resources", () => {
    it("builds composite kind[title] names", () => {
      const { tree, parser, root } = parse(`class svc {
  file { '/etc/a':
    ensure => file,
  }
  package { 'httpd':
    ensure => installed,
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.resources).toHaveLength(2);
      expect(result.resources![0].name).toBe("file[/etc/a]");
      expect(result.resources![0].kind).toBe("file");
      expect(result.resources![1].name).toBe("package[httpd]");
      expect(result.resources![1].kind).toBe("package");

      tree.delete();
      parser.delete();
    });

    it("splits array titles into one resource per element", () => {
      const { tree, parser, root } = parse(`class svc {
  package { ['curl','wget']:
    ensure => installed,
  }
}
`);
      const names = extractor.extractStructure(root).resources!.map(r => r.name);
      expect(names).toEqual(["package[curl]", "package[wget]"]);

      tree.delete();
      parser.delete();
    });

    it("keeps interpolated titles verbatim", () => {
      const { tree, parser, root } = parse(`define cache_dir {
  file { "/srv/\${title}":
    ensure => directory,
  }
}
`);
      const names = extractor.extractStructure(root).resources!.map(r => r.name);
      expect(names).toEqual(["file[/srv/${title}]"]);

      tree.delete();
      parser.delete();
    });

    it("prefixes virtual and exported kinds and names", () => {
      const { tree, parser, root } = parse(`class svc {
  @file { 'conf':
    ensure => file,
  }
  @@concat { 'exp':
    target => '/tmp/x',
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.resources![0].kind).toBe("@file");
      expect(result.resources![0].name).toBe("@file[conf]");
      expect(result.resources![1].kind).toBe("@@concat");
      expect(result.resources![1].name).toBe("@@concat[exp]");

      tree.delete();
      parser.delete();
    });

    it("harvests resources from relation chains and node blocks", () => {
      const { tree, parser, root } = parse(`class svc {
  file { '/etc/a': } -> file { '/etc/b': }
}

node 'web01.example.com' {
  package { 'httpd':
    ensure => installed,
  }
}
`);
      const result = extractor.extractStructure(root);

      const names = result.resources!.map(r => r.name);
      expect(names).toContain("file[/etc/a]");
      expect(names).toContain("file[/etc/b]");
      expect(names).toContain("package[httpd]");
      // node_definition is not a scope and must not become a class entry
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("svc");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("scopes calls to the enclosing class and skips callerless calls", () => {
      const { tree, parser, root } = parse(`class svc {
  include base
  contain extra
  notice('hi')
  my_func()
  file { '/x': }
}

notice('top level')
include orphan
`);
      const entries = extractor.extractCallGraph(root);

      expect(entries.every(e => e.caller === "svc")).toBe(true);
      const callees = entries.map(e => e.callee);
      expect(callees).toContain("base");
      expect(callees).toContain("notice");
      expect(callees).toContain("my_func");
      expect(callees).toContain("file");
      // Top-level statements are outside every scope → no entries at all.
      expect(callees).not.toContain("orphan");

      tree.delete();
      parser.delete();
    });

    it("records qualified callees and nested argument calls", () => {
      const { tree, parser, root } = parse(`class svc {
  helper::greet(validate_x($y))
}
`);
      const callees = extractor.extractCallGraph(root).map(e => e.callee);
      expect(callees).toContain("helper::greet");
      expect(callees).toContain("validate_x");

      tree.delete();
      parser.delete();
    });

    it("does not treat node_definition bodies as scoped calls", () => {
      const { tree, parser, root } = parse(`node 'web01' {
  include profile::web
}
`);
      expect(extractor.extractCallGraph(root)).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("robustness", () => {
    it("returns an empty structure for a malformed manifest without throwing", () => {
      const { tree, parser, root } = parse(`class {{{ broken ----
  ]]]
`);
      expect(() => {
        const result = extractor.extractStructure(root);
        expect(result.functions).toEqual([]);
        expect(result.classes).toEqual([]);
        expect(result.imports).toEqual([]);
        expect(result.exports).toEqual([]);
      }).not.toThrow();

      tree.delete();
      parser.delete();
    });

    it("does not crash on legacy bareword contain", () => {
      // Bareword `contain foo` is not a function_call in tree-sitter-puppet
      // 1.x (two loose identifiers); the documented miss must yield no import
      // rather than garbage.
      const { tree, parser, root } = parse(`class svc {
  contain extra
}
`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });
});
