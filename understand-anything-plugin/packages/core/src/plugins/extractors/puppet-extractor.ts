import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { traverse, getStringValue, findChild, findChildren } from "./base-extractor.js";

/**
 * Puppet (.pp) extractor for tree-sitter-puppet@1.x.
 *
 * Grammar shape notes (verified against a real parse of tree-sitter-puppet
 * 1.3.0, not just node-types.json):
 *  - `source_file` children are the declarations directly — there is NO
 *    `statement` wrapper node in this grammar version.
 *  - `class_definition` / `defined_resource_type`: positional children are
 *    `class_identifier`|`identifier` (the name), optional `parameter_list`,
 *    optional `class_inherits`, then `block`. A parameterized class
 *    declaration `class { 'x': ... }` misparses as `class_definition` with a
 *    MISSING identifier — nameless, so it yields no entry.
 *  - `function_declaration`: name (`class_identifier` when qualified),
 *    optional return type positioned AFTER `parameter_list`, then `block`.
 *  - `resource_declaration`: fields `type` and `title`; virtual/exported
 *    resources carry anonymous `@`/`@@` first children.
 *  - Relationship chains (`a -> b`, `~>`) wrap their operands in a `relation`
 *    node, so flat per-block iteration loses declarations — the flat
 *    collections (resources, includes, template refs) walk the whole tree.
 *  - Legacy bareword `contain foo` is NOT a function_call in this grammar
 *    (it becomes two loose identifier tokens); only `contain('foo')` and
 *    `contain(['a','b'])` produce edges. Never a wrong edge from the miss.
 *
 * Mapping decisions (mirrors ruby-extractor.ts conventions):
 *  - Puppet classes and defined types are the reusable units → `classes[]`.
 *    Code-category files get `class:`/`function:` graph nodes from these, so
 *    defined types belong here, not in `definitions[]` (which is gated to
 *    non-code categories downstream).
 *  - `class_inherits`, `include`/`require` statements, `contain(...)` class
 *    names, `template()`/`epp()` string arguments, and `source => 'puppet:///...'`
 *    attribute values all become `imports[]` entries; the skill-layer
 *    import-map resolver maps them onto `.pp`, `lib/puppet/functions/*.rb`,
 *    `lib/puppet/type/*.rb` and `templates/*.erb|epp` files. Anything that
 *    misses the file set is dropped there, so builtin types and stdlib names
 *    are safe to emit here.
 *  - `resource_declaration` → `resources[]` with composite `kind[title]`
 *    names (e.g. `package[httpd]`): GraphBuilder derives `resource:<path>:<name>`
 *    node ids from the name alone, so bare titles would collide across types.
 *    Virtual/exported resources carry the `@`/`@@` prefix on both `kind` and
 *    the composite name (`@file[conf]`) so they stay distinct from plain
 *    `file[conf]` nodes. Interpolated titles keep their raw `${...}` text
 *    verbatim. Array titles (`package { ['a','b']: }`) split into one entry
 *    per element.
 *  - `node_definition` is not a named scope: it selects certnames, it is not
 *    autoloadable, and adding it to classes[] would pollute import targets.
 *    Its body still yields resources via the tree-wide walk.
 *  - `extractCallGraph` scopes calls by enclosing class/define/function
 *    (calls outside any — top-level `site.pp`, node blocks — get no entry,
 *    same rule as Ruby). Callees are function-call names (qualified allowed),
 *    included/required class names, `contain` arguments, and resource type
 *    names; unresolved builtins (`notice`, `file`) simply resolve to nothing
 *    downstream. These callees also feed the skill-layer Puppet→Ruby interop
 *    pass, which resolves custom function/type names to their `.rb` files.
 */

const NAME_TYPES = new Set(["identifier", "class_identifier"]);
const DECL_TYPES = new Set(["class_definition", "defined_resource_type", "function_declaration"]);

function isQualifiedName(text: string): boolean {
  return /^(?:::)?[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(text);
}

/** First name node (identifier/class_identifier) of a declaration, or null
 *  (e.g. the `class { 'x': }` misparse whose identifier is MISSING). */
function declNameNode(node: TreeSitterNode): TreeSitterNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.isNamed && NAME_TYPES.has(child.type) && !child.isMissing) {
      return child;
    }
  }
  return null;
}

function declName(node: TreeSitterNode): string | null {
  return declNameNode(node)?.text ?? null;
}

/** Direct children that are identifier / class_identifier, in order. */
function nameChildren(node: TreeSitterNode): TreeSitterNode[] {
  const out: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.isNamed && NAME_TYPES.has(child.type)) out.push(child);
  }
  return out;
}

/** `$name` → `name` for each parameter in a parameter_list. */
function paramNames(list: TreeSitterNode | null): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const param of findChildren(list, "parameter")) {
    const variable = findChild(param, "variable");
    if (variable) {
      const id = findChild(variable, "identifier");
      out.push(id ? id.text : variable.text.replace(/^\$/, ""));
    }
  }
  return out;
}

/** Function return type: the first named child after the name and
 *  parameter_list, before the block (e.g. `>> String`). Compares by
 *  position/type, never node identity — web-tree-sitter returns a fresh
 *  Node wrapper per child() call, so `a === b` across calls is never true. */
function returnTypeOf(node: TreeSitterNode): string | undefined {
  let skippedName = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "block") break;
    if (!child.isNamed) continue;
    if (!skippedName && NAME_TYPES.has(child.type)) {
      skippedName = true;
      continue;
    }
    if (child.type === "parameter_list") continue;
    return child.text;
  }
  return undefined;
}

/** Literal string argument values of a call: direct `string` children plus
 *  `string` elements of a direct `array` child. */
function stringArgs(node: TreeSitterNode): string[] {
  const out: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "string") out.push(getStringValue(child));
    else if (child.type === "array") {
      for (const el of findChildren(child, "string")) out.push(getStringValue(el));
    }
  }
  return out;
}

/** Title text for a resource_declaration's `title` field. */
function titleEntries(title: TreeSitterNode | null): string[] {
  if (!title) return [""];
  if (title.type === "array") {
    const strings = findChildren(title, "string");
    if (strings.length > 0) return strings.map(s => getStringValue(s));
    return [title.text.replace(/^\[|\]$/g, "")];
  }
  return [getStringValue(title)];
}

export class PuppetExtractor implements LanguageExtractor {
  languageIds = ["puppet"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const resources: StructuralAnalysis["resources"] = [];

    // ---- Named scopes: direct children of source_file only ----
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node || !DECL_TYPES.has(node.type)) continue;

      const name = declName(node);
      if (!name) continue; // parameterized-class misparse, truncated header, …

      const lineRange: [number, number] = [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ];

      if (node.type === "function_declaration") {
        const returnType = returnTypeOf(node);
        functions.push({
          name,
          lineRange,
          params: paramNames(findChild(node, "parameter_list")),
          ...(returnType ? { returnType } : {}),
        });
      } else {
        const block = findChild(node, "block");
        // Nested `define x {}` inside a class body: the class's methods.
        const methods: string[] = [];
        if (block) {
          traverse(block, inner => {
            if (inner.type === "defined_resource_type") {
              const innerName = declName(inner);
              if (innerName) methods.push(innerName);
            }
          });
        }
        classes.push({
          name,
          lineRange,
          methods,
          properties: paramNames(findChild(node, "parameter_list")),
        });

        const inherits = findChild(node, "class_inherits");
        if (inherits) {
          for (const target of nameChildren(inherits)) {
            imports.push({
              source: target.text,
              specifiers: [target.text],
              lineNumber: inherits.startPosition.row + 1,
            });
          }
        }
      }
      exports.push({ name, lineNumber: node.startPosition.row + 1 });
    }

    // ---- Tree-wide collection: relation/if/case nesting hides these ----
    traverse(rootNode, node => {
      switch (node.type) {
        case "include_statement":
        case "require_statement":
          for (const target of nameChildren(node)) {
            imports.push({
              source: target.text,
              specifiers: [target.text],
              lineNumber: node.startPosition.row + 1,
            });
          }
          break;

        case "function_call": {
          const callee = nameChildren(node)[0];
          if (!callee) break;
          if (callee.text === "contain") {
            for (const cls of stringArgs(node)) {
              if (isQualifiedName(cls)) {
                imports.push({ source: cls, specifiers: [cls], lineNumber: node.startPosition.row + 1 });
              }
            }
          } else if (callee.text === "template" || callee.text === "epp") {
            for (const ref of stringArgs(node)) {
              imports.push({ source: ref, specifiers: [ref], lineNumber: node.startPosition.row + 1 });
            }
          }
          break;
        }

        case "resource_declaration": {
          const typeNode = node.childForFieldName("type");
          const resourceType = typeNode?.text ?? "";
          if (!resourceType) break;
          let prefix = "";
          for (let j = 0; j < node.childCount; j++) {
            const anon = node.child(j);
            if (anon && (anon.type === "@" || anon.type === "@@")) {
              prefix = anon.type;
              break;
            }
          }
          const kind = `${prefix}${resourceType}`;
          const lineRange: [number, number] = [
            node.startPosition.row + 1,
            node.endPosition.row + 1,
          ];
          for (const title of titleEntries(node.childForFieldName("title"))) {
            resources.push({ name: `${kind}[${title}]`, kind, lineRange });
          }
          // File-database / static file references: source => 'puppet:///...'
          for (const attr of findChildren(node, "attribute")) {
            const attrName = attr.childForFieldName("name")?.text;
            if (attrName !== "source") continue;
            const value = attr.childForFieldName("value");
            if (value?.type === "string") {
              const ref = getStringValue(value);
              if (ref.startsWith("puppet:///")) {
                imports.push({ source: ref, specifiers: [ref], lineNumber: node.startPosition.row + 1 });
              }
            }
          }
          break;
        }

        default:
          break;
      }
    });

    return { functions, classes, imports, exports, resources };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];

    const walk = (node: TreeSitterNode, scope: string | null): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (DECL_TYPES.has(child.type)) {
          const name = declName(child);
          // Nameless declaration: keep the enclosing scope rather than invent one.
          walk(child, name ?? scope);
        } else if (child.type === "node_definition") {
          // Certname selector, not a scope: body calls stay callerless (skipped).
          walk(child, null);
        } else if (scope) {
          const lineNumber = child.startPosition.row + 1;
          if (child.type === "function_call") {
            const callee = nameChildren(child)[0];
            if (callee && isQualifiedName(callee.text)) {
              entries.push({ caller: scope, callee: callee.text, lineNumber });
            }
            // Recurse: nested calls in arguments are real calls too.
            walk(child, scope);
            continue;
          } else if (child.type === "include_statement" || child.type === "require_statement") {
            for (const target of nameChildren(child)) {
              entries.push({ caller: scope, callee: target.text, lineNumber });
            }
          } else if (child.type === "resource_declaration") {
            const resourceType = child.childForFieldName("type")?.text;
            if (resourceType) {
              entries.push({ caller: scope, callee: resourceType, lineNumber });
            }
          }
          walk(child, scope);
        }
      }
    };

    walk(rootNode, null);
    return entries;
  }
}
