import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Whether a Dart identifier is library-private. Dart has no `private`
 * keyword — instead, leading underscore on the identifier makes the
 * declaration visible only within its own library.
 */
function isPrivateName(name: string): boolean {
  return name.startsWith("_");
}

/**
 * Get the first `identifier` text under a node. Used to recover the name
 * from a function_signature, constructor_signature, etc.
 */
function firstIdentifierText(node: TreeSitterNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "identifier") return child.text;
  }
  return null;
}

/**
 * Extract the parameter names from a Dart `formal_parameter_list`.
 *
 * The grammar distinguishes several parameter shapes:
 * - Regular     `Type name`          → `formal_parameter` with leading type + `identifier`
 * - This-init   `this.field`         → `formal_parameter` with no leading `identifier`
 *                                       (just `this`, `.`, `identifier`)
 * - Optional    `[Type name = expr]` / `{Type name}` — wrapped in
 *               `optional_formal_parameters` / `named_formal_parameters`
 *
 * For all shapes, we want the user-visible parameter name. For `this.x`
 * we return `x`; for `Type name` we return `name`; for unrecognised shapes
 * we fall back to the LAST `identifier` text under the parameter node.
 */
function extractParamName(paramNode: TreeSitterNode): string | null {
  let lastIdentifier: string | null = null;
  for (let i = 0; i < paramNode.childCount; i++) {
    const child = paramNode.child(i);
    if (!child) continue;
    if (child.type === "identifier") {
      lastIdentifier = child.text;
    }
  }
  return lastIdentifier;
}

function extractParams(signatureNode: TreeSitterNode): string[] {
  const params: string[] = [];
  const list = findChild(signatureNode, "formal_parameter_list");
  if (!list) return params;
  for (let i = 0; i < list.childCount; i++) {
    const child = list.child(i);
    if (!child) continue;
    if (child.type === "formal_parameter") {
      const name = extractParamName(child);
      if (name) params.push(name);
    } else if (
      child.type === "optional_formal_parameters" ||
      child.type === "named_formal_parameters"
    ) {
      // Wrappers around `[...]` / `{...}` — walk one level deeper.
      for (const sub of findChildren(child, "formal_parameter")) {
        const name = extractParamName(sub);
        if (name) params.push(name);
      }
    }
  }
  return params;
}

/**
 * Extract the return type text from a `function_signature`. Dart puts the
 * return type as a leading non-identifier child (e.g., `type_identifier`,
 * `void_type`, or a more complex type construct). We take the first named
 * child that's NOT the function's own identifier or its parameter list.
 */
function extractReturnType(signatureNode: TreeSitterNode): string | undefined {
  for (let i = 0; i < signatureNode.childCount; i++) {
    const child = signatureNode.child(i);
    if (!child || !child.isNamed) continue;
    if (
      child.type === "identifier" ||
      child.type === "formal_parameter_list" ||
      child.type === "type_parameters"
    ) {
      continue;
    }
    // Likely the return type (type_identifier, void_type, function_type, …)
    return child.text;
  }
  return undefined;
}

/**
 * Dart extractor for tree-sitter structural analysis and call graph
 * extraction. Handles classes, mixins, enums, extensions, top-level
 * functions, library imports, and Dart's underscore-prefix privacy rule.
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
          this.extractClassLike(node, "class_body", classes, functions, exports);
          break;

        case "mixin_declaration":
          this.extractClassLike(node, "class_body", classes, functions, exports);
          break;

        case "extension_declaration":
          this.extractClassLike(
            node,
            "extension_body",
            classes,
            functions,
            exports,
          );
          break;

        case "enum_declaration":
          this.extractEnum(node, classes, exports);
          break;

        case "import_or_export":
          this.extractImport(node, imports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    // Dart's grammar makes `function_signature` and `function_body` SIBLINGS
    // under their common parent (the program or a class body), so calls
    // inside the body would not see the surrounding name if we only pushed
    // on entering `function_signature`. Instead, we push when entering a
    // `function_body` by looking at the preceding sibling for its name.
    //
    // web-tree-sitter returns a fresh JS wrapper each time you call
    // `parent.child(i)`, so `===` identity comparisons against the body
    // node always fail. We compare via `id` (a tree-unique node identity
    // preserved across wrappers) instead.
    const nameForFunctionBody = (body: TreeSitterNode): string | null => {
      const parent = body.parent;
      if (!parent) return null;
      const bodyId = body.id;
      let bodyIndex = -1;
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child && child.id === bodyId) {
          bodyIndex = i;
          break;
        }
      }
      if (bodyIndex < 0) return null;
      // Walk backwards to find the function_signature / constructor_signature
      for (let i = bodyIndex - 1; i >= 0; i--) {
        const sib = parent.child(i);
        if (!sib) continue;
        if (sib.type === "function_signature") return firstIdentifierText(sib);
        if (sib.type === "method_signature") {
          const sig = findChild(sib, "function_signature");
          return sig ? firstIdentifierText(sig) : null;
        }
        if (
          sib.type === "constructor_signature" ||
          sib.type === "constant_constructor_signature" ||
          sib.type === "factory_constructor_signature"
        ) {
          return firstIdentifierText(sib) ?? "constructor";
        }
      }
      return null;
    };

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      if (node.type === "function_body") {
        const name = nameForFunctionBody(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }

      // A call shows up as an `argument_part` (the `(...)` after a callee
      // expression). We attribute it to the enclosing function and resolve
      // the callee name by looking at the preceding sibling of its parent
      // `selector` — either an `identifier` (plain `foo()`) or a
      // `selector > unconditional_assignable_selector > identifier`
      // (method call `x.foo()`).
      if (node.type === "argument_part" && functionStack.length > 0) {
        const callee = this.extractCalleeForArgumentPart(node);
        if (callee) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushed) functionStack.pop();
    };

    walk(rootNode);
    return entries;
  }

  // ---- Private helpers ----

  private extractTopLevelFunction(
    signatureNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = firstIdentifierText(signatureNode);
    if (!name) return;
    functions.push({
      name,
      lineRange: [
        signatureNode.startPosition.row + 1,
        signatureNode.endPosition.row + 1,
      ],
      params: extractParams(signatureNode),
      returnType: extractReturnType(signatureNode),
    });
    if (!isPrivateName(name)) {
      exports.push({ name, lineNumber: signatureNode.startPosition.row + 1 });
    }
  }

  private extractClassLike(
    declNode: TreeSitterNode,
    bodyType: "class_body" | "extension_body",
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = firstIdentifierText(declNode);
    if (!name) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = findChild(declNode, bodyType);
    if (body) {
      this.collectBodyMembers(body, methods, properties, functions, exports);
    }

    classes.push({
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      methods,
      properties,
    });

    if (!isPrivateName(name)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  private extractEnum(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = firstIdentifierText(declNode);
    if (!name) return;

    const properties: string[] = [];
    const body = findChild(declNode, "enum_body");
    if (body) {
      for (const entry of findChildren(body, "enum_constant")) {
        const id = findChild(entry, "identifier");
        if (id) properties.push(id.text);
      }
    }

    classes.push({
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      methods: [],
      properties,
    });

    if (!isPrivateName(name)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  /**
   * Walk a class_body / extension_body / mixin_body and collect methods
   * and properties.
   *
   * The Dart grammar wraps most class members in a `declaration` node, but
   * regular methods appear as a top-level `method_signature` (which wraps
   * a `function_signature`) followed by a sibling `function_body`. Fields
   * live inside `declaration > initialized_identifier_list`. Constructors
   * live inside `declaration > constructor_signature`.
   */
  private collectBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === "method_signature") {
        const sig = findChild(child, "function_signature");
        if (!sig) continue;
        const name = firstIdentifierText(sig);
        if (!name) continue;
        methods.push(name);
        functions.push({
          name,
          lineRange: [sig.startPosition.row + 1, sig.endPosition.row + 1],
          params: extractParams(sig),
          returnType: extractReturnType(sig),
        });
        if (!isPrivateName(name)) {
          exports.push({ name, lineNumber: sig.startPosition.row + 1 });
        }
      } else if (child.type === "declaration") {
        this.handleClassDeclaration(child, methods, properties, functions, exports);
      }
    }
  }

  private handleClassDeclaration(
    decl: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    // A `declaration` inside a class body can be a constructor, a field,
    // or a function signature (e.g. abstract methods which have no body).
    const ctor =
      findChild(decl, "constructor_signature") ||
      findChild(decl, "constant_constructor_signature") ||
      findChild(decl, "factory_constructor_signature");
    if (ctor) {
      const name = firstIdentifierText(ctor) ?? "constructor";
      methods.push(name);
      return;
    }

    const fnSig = findChild(decl, "function_signature");
    if (fnSig) {
      const name = firstIdentifierText(fnSig);
      if (name) {
        methods.push(name);
        functions.push({
          name,
          lineRange: [fnSig.startPosition.row + 1, fnSig.endPosition.row + 1],
          params: extractParams(fnSig),
          returnType: extractReturnType(fnSig),
        });
        if (!isPrivateName(name)) {
          exports.push({ name, lineNumber: fnSig.startPosition.row + 1 });
        }
      }
      return;
    }

    // Field declaration — initialized_identifier_list holds one or more
    // identifiers sharing a type.
    const initList = findChild(decl, "initialized_identifier_list");
    if (initList) {
      for (const entry of findChildren(initList, "initialized_identifier")) {
        const id = findChild(entry, "identifier");
        if (id) properties.push(id.text);
      }
    }
  }

  /**
   * Extract a Dart import.
   *
   * Grammar:
   *   import_or_export > library_import > import_specification
   *     - `import` keyword
   *     - configurable_uri > uri > string_literal (the URI text)
   *     - optional `as <identifier>` for an alias
   *     - optional `combinator > show <ids> / hide <ids>`
   */
  private extractImport(
    declNode: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const libImport = findChild(declNode, "library_import");
    if (!libImport) return;
    const spec = findChild(libImport, "import_specification");
    if (!spec) return;

    const uriContainer = findChild(spec, "configurable_uri");
    if (!uriContainer) return;
    const uriNode = findChild(uriContainer, "uri");
    if (!uriNode) return;
    const stringLit = findChild(uriNode, "string_literal");
    const source = stringLit
      ? stringLit.text.replace(/^["']|["']$/g, "")
      : uriNode.text.replace(/^["']|["']$/g, "");

    // Default specifier: last `/`-delimited segment of the URI's path
    // portion (e.g. "package:foo/bar.dart" → "bar.dart"). For Dart's core
    // libs ("dart:io"), use the portion after `:`.
    let defaultSpecifier = source;
    if (source.includes("/")) {
      defaultSpecifier = source.slice(source.lastIndexOf("/") + 1);
    } else if (source.includes(":")) {
      defaultSpecifier = source.slice(source.lastIndexOf(":") + 1);
    }

    // Collect aliases / combinator identifiers
    const specifiers: string[] = [];
    let sawAs = false;
    for (let i = 0; i < spec.childCount; i++) {
      const child = spec.child(i);
      if (!child) continue;
      if (child.type === "as") sawAs = true;
      else if (sawAs && child.type === "identifier") {
        specifiers.push(child.text);
        sawAs = false;
      } else if (child.type === "combinator") {
        for (const id of findChildren(child, "identifier")) {
          specifiers.push(id.text);
        }
      }
    }

    if (specifiers.length === 0) specifiers.push(defaultSpecifier);

    imports.push({
      source,
      specifiers,
      lineNumber: declNode.startPosition.row + 1,
    });
  }

  /**
   * Resolve the callee identifier for an `argument_part` node.
   *
   * Dart represents both `foo()` and `x.foo()` by following the callee
   * expression with a `selector` whose child is the `argument_part`. The
   * callee itself lives in the GRANDPARENT chain, immediately before the
   * call-selector.
   *
   * For `foo()`:
   *   <parent>
   *     identifier "foo"      ← we want this
   *     selector              ← argument_part's parent
   *       argument_part ()
   *
   * For `x.foo()`:
   *   <parent>
   *     <receiver expression>
   *     selector              ← `.foo` (assignable selector)
   *       unconditional_assignable_selector
   *         . , identifier "foo"   ← we want this
   *     selector              ← argument_part's parent (call selector)
   *       argument_part ()
   *
   * Walk from the argument_part's parent (selector) up to the
   * grandparent, find the parent-selector's index, then look at the
   * sibling immediately before it. If that sibling is an `identifier` use
   * its text; if it's a `selector`, dig into its assignable-selector
   * child for the method name.
   */
  private extractCalleeForArgumentPart(
    argPartNode: TreeSitterNode,
  ): string | null {
    const callSelector = argPartNode.parent;
    if (!callSelector) return null;
    const grandparent = callSelector.parent;
    if (!grandparent) return null;

    // Find the call-selector's index among the grandparent's children.
    // web-tree-sitter returns fresh node wrappers from .child(i), so we
    // identify the call-selector by its `id` rather than by reference.
    const callSelectorId = callSelector.id;
    let selectorIndex = -1;
    for (let i = 0; i < grandparent.childCount; i++) {
      const child = grandparent.child(i);
      if (child && child.id === callSelectorId) {
        selectorIndex = i;
        break;
      }
    }
    if (selectorIndex <= 0) return null;

    // The sibling immediately before the call-selector is the callee.
    const prev = grandparent.child(selectorIndex - 1);
    if (!prev) return null;

    if (prev.type === "identifier") return prev.text;

    if (prev.type === "selector") {
      const assignable =
        findChild(prev, "unconditional_assignable_selector") ||
        findChild(prev, "conditional_assignable_selector");
      if (assignable) {
        const id = findChild(assignable, "identifier");
        if (id) return id.text;
      }
      // Fallback: any identifier directly inside the prior selector
      const id = findChild(prev, "identifier");
      if (id) return id.text;
    }
    return null;
  }
}
