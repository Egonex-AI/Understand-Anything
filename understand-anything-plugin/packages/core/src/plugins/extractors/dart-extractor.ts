import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren, getStringValue } from "./base-extractor.js";

/**
 * Whether a Dart name is exported.
 *
 * Dart's visibility rule is name-based and the INVERSE of Kotlin's: names
 * starting with `_` are library-private, everything else is exported. There
 * is no `public` / `private` keyword to inspect — only the leading character.
 */
function isExported(name: string): boolean {
  return !name.startsWith("_");
}

/**
 * Extract the identifier name from a `function_signature` node.
 *
 * NOTE: this helper expects a `function_signature` node. The Dart grammar
 * wraps the function_signature inside two different parent shapes:
 *   - `method_signature > function_signature` for CONCRETE class methods.
 *   - `declaration > function_signature` for ABSTRACT class methods (no body).
 * Callers (`collectClassBody`) unwrap to the inner `function_signature`
 * before invoking this helper.
 */
function extractFunctionName(sig: TreeSitterNode): string | null {
  const id = findChild(sig, "identifier");
  return id ? id.text : null;
}

/**
 * Extract the user-visible name from a `formal_parameter` (or one of its
 * specialized children).
 *
 * Three shapes seen in the AST:
 *   - Regular     `Type name`     → `formal_parameter > { type_identifier, identifier }`
 *   - This-init   `this.field`    → `formal_parameter > constructor_param > { this, ., identifier }`
 *   - Super-init  `super.field`   → `formal_parameter > super_formal_parameter > { super, ., identifier }`
 *
 * Strategy: scan all direct children for an `identifier`; if absent, recurse
 * one level into `constructor_param` / `super_formal_parameter` and pick the
 * LAST identifier (the field name in `this.field`).
 */
function extractParamName(paramNode: TreeSitterNode): string | null {
  // Direct identifier child wins (regular `Type name` parameter).
  const direct = findChild(paramNode, "identifier");
  if (direct) return direct.text;

  // Nested wrappers — pick the last identifier we can find inside.
  for (let i = 0; i < paramNode.childCount; i++) {
    const child = paramNode.child(i);
    if (!child) continue;
    if (child.type === "constructor_param" || child.type === "super_formal_parameter") {
      let last: string | null = null;
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner && inner.type === "identifier") last = inner.text;
      }
      if (last) return last;
    }
  }
  return null;
}

/**
 * Extract parameter names from a `formal_parameter_list`.
 *
 * Walks both required parameters (`formal_parameter` direct children) and the
 * `optional_formal_parameters` wrapper, which the Dart grammar uses for BOTH
 * optional positional `[...]` and named `{...}` parameters (the leading
 * unnamed `[` vs `{` token distinguishes them — we don't need to for the
 * project graph, both go into the same `params[]` list).
 *
 * Drops `this.x` and `super.x` initializer parameters' types and surfaces
 * just the field name (see `extractParamName`).
 */
function extractParams(sig: TreeSitterNode): string[] {
  const params: string[] = [];
  const list = findChild(sig, "formal_parameter_list");
  if (!list) return params;
  for (let i = 0; i < list.childCount; i++) {
    const child = list.child(i);
    if (!child) continue;
    if (child.type === "formal_parameter") {
      const name = extractParamName(child);
      if (name) params.push(name);
    } else if (child.type === "optional_formal_parameters") {
      // Walk one level deeper — children are again `formal_parameter`.
      for (const sub of findChildren(child, "formal_parameter")) {
        const name = extractParamName(sub);
        if (name) params.push(name);
      }
    }
  }
  return params;
}

/**
 * Extract the return type from a function_signature. The return type is the
 * sequence of NAMED children that appear before the function name
 * (`identifier`) or `formal_parameter_list`. If there is no such child, the
 * function has no declared return type (Dart infers it).
 *
 * Common shapes seen during AST probing:
 *   `int add(int a, int b)` →  [type_identifier "int"]
 *   `void noop()`           →  [void_type]
 *   `Future<String> fetch()`→  [type_identifier "Future", type_arguments "<String>"]
 *
 * For generic types the grammar emits the base type and the type arguments as
 * separate sibling nodes, so we collect ALL nodes before `identifier` and
 * concatenate their text to reconstruct the full type spelling.
 */
function extractReturnType(sig: TreeSitterNode): string | undefined {
  const parts: string[] = [];
  for (let i = 0; i < sig.childCount; i++) {
    const child = sig.child(i);
    if (!child || !child.isNamed) continue;
    if (
      child.type === "identifier" ||
      child.type === "formal_parameter_list" ||
      child.type === "type_parameters"
    ) {
      // Reached the function NAME (`identifier`), the parameter list, or the
      // generic-parameter list (`type_parameters` is the function's own
      // generics, e.g. `<T>` in `T fn<T>(T x)`). Anything we passed before
      // this point WAS the return type; if we hit this stop without having
      // collected anything, the function has no declared return type.
      break;
    }
    parts.push(child.text);
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

/**
 * Push a method/function entry. Used by `collectClassBody` for both
 * `method_signature` and `declaration > function_signature` shapes so a
 * future change to the entry's fields lands in one place.
 */
function pushMethod(
  declNode: TreeSitterNode,
  sig: TreeSitterNode,
  name: string,
  methods: string[],
  functions: StructuralAnalysis["functions"],
  exports: StructuralAnalysis["exports"],
): void {
  methods.push(name);
  functions.push({
    name,
    lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
    params: extractParams(sig),
    returnType: extractReturnType(sig),
  });
  if (isExported(name)) {
    exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
  }
}

/**
 * Unwrap the string-literal text from `uri > string_literal` via
 * `base-extractor.getStringValue` so the quote-stripping logic lives in
 * exactly one place across all extractors.
 */
function uriText(uriNode: TreeSitterNode): string | null {
  const lit = findChild(uriNode, "string_literal");
  if (!lit) return null;
  return getStringValue(lit);
}

/**
 * Build a constructor's method-graph name from a constructor_signature /
 * factory_constructor_signature node:
 *   - one identifier  → unnamed constructor, name = "<Class>"
 *   - two identifiers → named constructor,   name = "<Class>.<named>"
 *
 * Returns null when no identifier is present (defensive — should not happen
 * for a real constructor declaration).
 *
 * Probe findings (2026-06-13): the plan's claimed AST shapes match exactly.
 *   - Unnamed: constructor_signature { identifier[Foo], formal_parameter_list }
 *   - Named:   constructor_signature { identifier[Foo], identifier[zero], formal_parameter_list, ... }
 *   - Factory: factory_constructor_signature { <unnamed "factory">, identifier[Foo], identifier[fromString], formal_parameter_list }
 * extractReturnType returns undefined for all three (factory keyword is unnamed,
 * so it is skipped; the loop stops at the first identifier).
 */
function constructorName(sig: TreeSitterNode): string | null {
  const ids = findChildren(sig, "identifier");
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0].text;
  return `${ids[0].text}.${ids[1].text}`;
}

/**
 * Walk a `class_body` (or `extension_body` / `enum_body`) and collect
 * `method_signature` declarations into the class's `methods` array AND the
 * top-level `functions` array, mirroring KotlinExtractor.collectClassBody.
 *
 * Field extraction: `int count = 0;` and `String? label;` inside a class body
 * both parse as `declaration > initialized_identifier_list > initialized_identifier
 * > identifier`. The nullable `?` is an unnamed sibling of `type_identifier`,
 * so it does not affect this path.
 */
function collectClassBody(
  body: TreeSitterNode,
  methods: string[],
  properties: string[],
  functions: StructuralAnalysis["functions"],
  exports: StructuralAnalysis["exports"],
): void {
  for (let i = 0; i < body.childCount; i++) {
    const member = body.child(i);
    if (!member) continue;

    if (member.type === "method_signature") {
      // Factory constructor lives inside method_signature.
      const factory = findChild(member, "factory_constructor_signature");
      if (factory) {
        const name = constructorName(factory);
        if (name) {
          pushMethod(member, factory, name, methods, functions, exports);
        }
        continue;
      }
      // Getter (`int get value`) — wrapped in method_signature with a
      // sibling function_body. The name is the only identifier in getter_signature.
      const getter = findChild(member, "getter_signature");
      if (getter) {
        const name = extractFunctionName(getter);
        if (name) pushMethod(member, getter, name, methods, functions, exports);
        continue;
      }
      // Setter (`set value(int x)`) — wrapped in method_signature with a
      // sibling function_body. The first identifier is the name; the
      // formal_parameter_list holds the assigned value.
      const setter = findChild(member, "setter_signature");
      if (setter) {
        const name = extractFunctionName(setter);
        if (name) pushMethod(member, setter, name, methods, functions, exports);
        continue;
      }
      // Concrete method: `method_signature > function_signature`.
      const inner = findChild(member, "function_signature");
      if (!inner) continue;
      const name = extractFunctionName(inner);
      if (!name) continue;
      pushMethod(member, inner, name, methods, functions, exports);
    } else if (member.type === "declaration") {
      // Regular constructor: `declaration > constructor_signature`.
      const ctor = findChild(member, "constructor_signature");
      if (ctor) {
        const name = constructorName(ctor);
        if (name) {
          pushMethod(member, ctor, name, methods, functions, exports);
        }
        continue;
      }
      // Abstract getter (`int get area;`) — `declaration > getter_signature`.
      const absGetter = findChild(member, "getter_signature");
      if (absGetter) {
        const name = extractFunctionName(absGetter);
        if (name) pushMethod(member, absGetter, name, methods, functions, exports);
        continue;
      }
      // Abstract setter (`set width(int w);`) — `declaration > setter_signature`.
      const absSetter = findChild(member, "setter_signature");
      if (absSetter) {
        const name = extractFunctionName(absSetter);
        if (name) pushMethod(member, absSetter, name, methods, functions, exports);
        continue;
      }
      // Abstract method declarations (e.g. `double area();`) appear as
      // `declaration > function_signature` — not wrapped in `method_signature`.
      const fnSig = findChild(member, "function_signature");
      if (fnSig) {
        const name = extractFunctionName(fnSig);
        if (name) {
          pushMethod(member, fnSig, name, methods, functions, exports);
        }
        continue;
      }
      // Field declaration — surface initialized_identifier names as properties.
      // Comma-lists like `int a, b, c;` produce multiple initialized_identifier
      // children inside a single initialized_identifier_list.
      const list = findChild(member, "initialized_identifier_list");
      if (!list) continue;
      for (const init of findChildren(list, "initialized_identifier")) {
        const id = findChild(init, "identifier");
        if (id) properties.push(id.text);
      }
    }
  }
}

/**
 * Dart extractor for tree-sitter structural analysis + call graph.
 *
 * Approach (matching `KotlinExtractor` convention): mixin / extension / enum
 * declarations are folded into `StructuralAnalysis.classes[]` because the
 * shared schema does not have a first-class slot for them. Extension
 * declarations without a name surface as `"on <TargetType>"` so they aren't
 * silently dropped.
 */
export class DartExtractor implements LanguageExtractor {
  readonly languageIds = ["dart"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_signature":
          this.extractTopLevelFunction(node, functions, exports);
          break;
        case "class_definition":
          this.extractClassLikeDeclaration(node, "class_body", classes, functions, exports);
          break;
        case "mixin_declaration":
          this.extractClassLikeDeclaration(node, "class_body", classes, functions, exports);
          break;
        case "extension_declaration":
          this.extractExtensionDeclaration(node, classes, functions, exports);
          break;
        case "enum_declaration":
          this.extractEnumDeclaration(node, classes, exports);
          break;
        case "import_or_export":
          this.extractImportOrExport(node, imports, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  // ---- Private helpers ----

  private extractTopLevelFunction(
    sig: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractFunctionName(sig);
    if (!name) return;
    functions.push({
      name,
      lineRange: [sig.startPosition.row + 1, sig.endPosition.row + 1],
      params: extractParams(sig),
      returnType: extractReturnType(sig),
    });
    if (isExported(name)) {
      exports.push({ name, lineNumber: sig.startPosition.row + 1 });
    }
  }

  /**
   * Extract a class-like declaration that uses a `class_body`-shaped member
   * container. Used by `class_definition`, `mixin_declaration`, and (Task 8)
   * `extension_declaration`. The only difference between these shapes is the
   * body's node type name, which is passed in via `bodyNodeType`.
   *
   * When `nameOverride` is provided, it is used as the entry's name instead of
   * looking up a leading `identifier` child — used by anonymous extensions,
   * which have no name in the source.
   */
  private extractClassLikeDeclaration(
    declNode: TreeSitterNode,
    bodyNodeType: string,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    nameOverride?: string,
  ): void {
    let name: string;
    if (nameOverride !== undefined) {
      name = nameOverride;
    } else {
      const nameNode = findChild(declNode, "identifier");
      if (!nameNode) return;
      name = nameNode.text;
    }

    const methods: string[] = [];
    const properties: string[] = [];

    const body = findChild(declNode, bodyNodeType);
    if (body) {
      collectClassBody(body, methods, properties, functions, exports);
    }

    classes.push({
      name,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods,
      properties,
    });

    if (isExported(name)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  private extractExtensionDeclaration(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    // Named extension — extractClassLikeDeclaration finds the leading identifier itself.
    const idNode = findChild(declNode, "identifier");
    if (idNode) {
      this.extractClassLikeDeclaration(
        declNode,
        "extension_body",
        classes,
        functions,
        exports,
      );
      return;
    }

    // Anonymous extension — no `identifier` child. The on-type is the first
    // `type_identifier`. Name the entry "on <TargetType>" so the graph
    // builder doesn't drop it for having an empty name.
    const onType = findChild(declNode, "type_identifier");
    if (!onType) return;
    this.extractClassLikeDeclaration(
      declNode,
      "extension_body",
      classes,
      functions,
      exports,
      `on ${onType.text}`,
    );
  }

  private extractEnumDeclaration(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(declNode, "identifier");
    if (!nameNode) return;
    const name = nameNode.text;

    const properties: string[] = [];
    const body = findChild(declNode, "enum_body");
    if (body) {
      for (const k of findChildren(body, "enum_constant")) {
        const id = findChild(k, "identifier");
        if (id) properties.push(id.text);
      }
    }

    classes.push({
      name,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods: [],
      properties,
    });

    if (isExported(name)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  private extractImportOrExport(
    declNode: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const libImport = findChild(declNode, "library_import");
    if (libImport) {
      this.extractLibraryImport(libImport, imports);
      return;
    }
    const libExport = findChild(declNode, "library_export");
    if (libExport) {
      this.extractLibraryExport(libExport, declNode, exports);
    }
  }

  private extractLibraryImport(
    libImport: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const spec = findChild(libImport, "import_specification");
    if (!spec) return;

    const configurable = findChild(spec, "configurable_uri");
    const uri = configurable ? findChild(configurable, "uri") : null;
    if (!uri) return;
    const source = uriText(uri);
    if (!source) return;

    const specifiers: string[] = [];

    // Combinators come in two flavours:
    //   show Bar, Baz  → leading keyword "show", names are specifiers
    //   hide Qux       → leading keyword "hide", names are excluded — skip
    const combinators = findChildren(spec, "combinator");
    for (const c of combinators) {
      // Inspect the first child to determine show vs hide. The keyword is an
      // unnamed token; use `child()` not `namedChild()`.
      const first = c.child(0);
      if (first && first.type === "hide") continue;
      for (const id of findChildren(c, "identifier")) {
        specifiers.push(id.text);
      }
    }

    // `as Foo` → direct `identifier` child of import_specification.
    // Only treat as alias when there were no `show`/`hide` specifiers.
    const asId = findChild(spec, "identifier");
    if (asId && specifiers.length === 0) {
      specifiers.push(asId.text);
    }

    imports.push({
      source,
      specifiers,
      lineNumber: libImport.startPosition.row + 1,
    });
  }

  /**
   * Extract an `export` directive's URI into `exports[]`.
   *
   * Takes both `libExport` (the `library_export` node containing the URI)
   * and `outerNode` (the wrapping `import_or_export` node). The line number
   * uses `outerNode.startPosition` because `library_export` may start one
   * child deeper than the `export` keyword, while `import_or_export` is
   * guaranteed to start at the keyword.
   */
  private extractLibraryExport(
    libExport: TreeSitterNode,
    outerNode: TreeSitterNode,
    exports: StructuralAnalysis["exports"],
  ): void {
    const configurable = findChild(libExport, "configurable_uri");
    const uri = configurable ? findChild(configurable, "uri") : null;
    if (!uri) return;
    const source = uriText(uri);
    if (!source) return;
    exports.push({
      name: source,
      lineNumber: outerNode.startPosition.row + 1,
    });
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    /**
     * Walk a single node, recursing into its children. Detects call sites
     * (selector nodes containing argument_part) and records them against the
     * current function on the stack.
     *
     * In Dart's AST, `function_signature` and `function_body` are SIBLINGS
     * within their parent (program, class_body, etc.), NOT parent/child. This
     * differs from Kotlin where `function_declaration` wraps both signature and
     * body. We handle this by scanning siblings at the parent level:
     * `walkSiblings` iterates the children of a container, remembers the name
     * from each `function_signature` / `method_signature`, and pushes it onto
     * the stack only for the duration of the following `function_body`.
     */
    const walkNode = (node: TreeSitterNode) => {
      if (
        node.type === "selector" &&
        findChild(node, "argument_part") &&
        functionStack.length > 0
      ) {
        // A call site: selector containing argument_part.
        const callee = this.extractCalleeName(node);
        if (callee) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // Constructor-call shapes that bypass the `selector > argument_part`
      // pattern:
      //   const Foo(...)  → `const_object_expression { const_builtin, type_identifier, arguments }`
      //   new Foo(...)    → `new_expression { (unnamed `new`), type_identifier, arguments }`
      // Both are extremely common in Flutter widget trees; without this branch
      // the construction edge would be silently dropped. The callee is the
      // `type_identifier` child.
      if (
        (node.type === "const_object_expression" ||
          node.type === "new_expression") &&
        functionStack.length > 0
      ) {
        const typeNode = findChild(node, "type_identifier");
        if (typeNode) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee: typeNode.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      walkSiblings(node);
    };

    /**
     * Iterate a node's children, pairing each function_signature /
     * method_signature with its subsequent function_body sibling.
     */
    const walkSiblings = (parent: TreeSitterNode) => {
      let pendingName: string | null = null;

      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (!child) continue;

        if (child.type === "function_signature") {
          pendingName = extractFunctionName(child);
          // Recurse into signature (no calls expected, but stay complete).
          walkSiblings(child);
        } else if (child.type === "method_signature") {
          // method_signature wraps one of:
          //   function_signature           → normal method
          //   getter_signature             → getter (with body)
          //   setter_signature             → setter (with body)
          //   constructor_signature        → constructor (with body)
          //   factory_constructor_signature → factory (with body)
          // All five carry the name as their first `identifier` child (factory
          // ctors carry two — class + named — handled by `constructorName`).
          // Without this dispatch, ctor/factory/getter/setter bodies were
          // walked with an empty functionStack and their internal calls were
          // dropped from the graph.
          const fn =
            findChild(child, "function_signature") ??
            findChild(child, "getter_signature") ??
            findChild(child, "setter_signature");
          if (fn) {
            pendingName = extractFunctionName(fn);
          } else {
            const ctor =
              findChild(child, "constructor_signature") ??
              findChild(child, "factory_constructor_signature");
            if (ctor) pendingName = constructorName(ctor);
          }
          walkSiblings(child);
        } else if (child.type === "function_body") {
          // Consume pendingName: push for the duration of this body.
          const pushed = pendingName !== null;
          if (pendingName) {
            functionStack.push(pendingName);
            pendingName = null;
          }
          walkNode(child);
          if (pushed) functionStack.pop();
        } else {
          // For every other node (including selector nodes at this level),
          // do NOT clear pendingName — anonymous tokens (`;`, `{`, etc.)
          // appear between the signature and body and must not reset the
          // pending name.
          walkNode(child);
        }
      }
    };

    walkSiblings(rootNode);
    return entries;
  }

  /**
   * Find the callee name for a `selector` node that contains an
   * `argument_part`. Look at the parent's children:
   *   - Bare call `foo(...)`: the previous sibling is an `identifier`.
   *   - Method call `target.foo(...)`: the previous sibling is itself a
   *     `selector` wrapping `unconditional_assignable_selector` with the
   *     method-name `identifier`.
   *
   * Probe finding (2026-06-13): the plan's claimed AST shapes match exactly.
   *   - Bare call:   return_statement > identifier[helper] + selector(argument_part)
   *   - Method call: expression_statement > string_literal + selector(unconditional_assignable_selector > identifier[toUpperCase]) + selector(argument_part)
   * The plan claimed `expression_statement` as parent for bare calls but the
   * actual parent for `return helper()` is `return_statement`. This does not
   * affect the strategy since we only look at the preceding sibling, not the
   * parent type.
   *
   * IMPORTANT: web-tree-sitter returns a NEW wrapper object each time `.child(i)`
   * is called — node identity (`===`) does NOT work for sibling lookup. We
   * compare by `startIndex` (byte offset) which is stable and unique per node.
   */
  private extractCalleeName(callSelector: TreeSitterNode): string | null {
    const parent = callSelector.parent;
    if (!parent) return null;

    // Find this selector's index in the parent using startIndex (not ===).
    let myIdx = -1;
    for (let i = 0; i < parent.childCount; i++) {
      const c = parent.child(i);
      if (c && c.startIndex === callSelector.startIndex) {
        myIdx = i;
        break;
      }
    }
    if (myIdx <= 0) return null;

    const prev = parent.child(myIdx - 1);
    if (!prev) return null;

    if (prev.type === "identifier") return prev.text;

    if (prev.type === "selector") {
      // Method call shape: previous selector wraps unconditional_assignable_selector.
      const inner = findChild(prev, "unconditional_assignable_selector");
      if (inner) {
        // Pick the LAST identifier inside the inner selector — that's the
        // method name (earlier identifiers, if any, are receiver fragments).
        let last: string | null = null;
        for (let i = 0; i < inner.childCount; i++) {
          const child = inner.child(i);
          if (child && child.type === "identifier") last = child.text;
        }
        return last;
      }
    }

    return null;
  }
}
