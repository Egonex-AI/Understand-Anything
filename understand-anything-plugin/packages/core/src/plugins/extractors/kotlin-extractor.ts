import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract the visibility keyword text (e.g., "public", "private") from a
 * declaration's `modifiers` child, or return null when no modifier is present.
 *
 * Kotlin's default visibility is `public`, so a `null` result means the
 * declaration IS exported — callers must treat absence as exported, not the
 * other way around.
 */
function extractVisibility(declNode: TreeSitterNode): string | null {
  const modifiers = findChild(declNode, "modifiers");
  if (!modifiers) return null;
  const visibility = findChild(modifiers, "visibility_modifier");
  if (!visibility) return null;
  return visibility.text;
}

/**
 * Whether a Kotlin declaration is visible to other files.
 *
 * Default visibility in Kotlin is `public`, so a declaration with NO
 * modifier counts as exported. Only an explicit `private` opts out.
 * `internal` and `protected` remain exported in the project-graph sense
 * because they are still resolvable from other files (within the module
 * or via inheritance respectively).
 */
function isExported(declNode: TreeSitterNode): boolean {
  const visibility = extractVisibility(declNode);
  return visibility === null || visibility !== "private";
}

/**
 * Get the identifier-text name of a Kotlin declaration. Works for
 * function_declaration / class_declaration / object_declaration / interface
 * — all carry the name as the first `identifier` child after the keyword.
 */
function extractDeclarationName(declNode: TreeSitterNode): string | null {
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (child && child.type === "identifier") return child.text;
  }
  return null;
}

/**
 * Extract parameter names from a `function_value_parameters` node. Each
 * `parameter` child carries a leading `identifier` for the parameter name;
 * the optional trailing `: <type>` annotation is ignored.
 */
function extractParams(declNode: TreeSitterNode): string[] {
  const params: string[] = [];
  const valueParams = findChild(declNode, "function_value_parameters");
  if (!valueParams) return params;
  for (const param of findChildren(valueParams, "parameter")) {
    // The first `identifier` inside a parameter is its name.
    const id = findChild(param, "identifier");
    if (id) params.push(id.text);
  }
  return params;
}

/**
 * Extract the return type text from a `function_declaration` by looking for
 * the `:` separator and taking the next named child, which is the type node.
 * Returns undefined for `Unit`-returning functions (no annotation present).
 */
function extractReturnType(declNode: TreeSitterNode): string | undefined {
  // function_value_parameters comes before the optional `: <type>` block;
  // walk children from after the parameters to find `:` followed by a type.
  let sawParams = false;
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (!child) continue;
    if (child.type === "function_value_parameters") {
      sawParams = true;
      continue;
    }
    if (sawParams && child.type === ":") {
      // The next named sibling is the type
      for (let j = i + 1; j < declNode.childCount; j++) {
        const next = declNode.child(j);
        if (next && next.isNamed) return next.text;
      }
    }
  }
  return undefined;
}

/**
 * Walk a `class_body` and collect functions + properties. Function entries
 * are added to both the class's `methods` array and the top-level
 * `functions` array (matching the GoExtractor / SwiftExtractor convention).
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

    if (member.type === "function_declaration") {
      const name = extractDeclarationName(member);
      if (!name) continue;
      methods.push(name);
      functions.push({
        name,
        lineRange: [member.startPosition.row + 1, member.endPosition.row + 1],
        params: extractParams(member),
        returnType: extractReturnType(member),
      });
      if (isExported(member)) {
        exports.push({ name, lineNumber: member.startPosition.row + 1 });
      }
    } else if (member.type === "property_declaration") {
      const name = extractPropertyName(member);
      if (name) properties.push(name);
      if (name && isExported(member)) {
        exports.push({ name, lineNumber: member.startPosition.row + 1 });
      }
    } else if (member.type === "object_declaration") {
      // Nested companion-object / object members are surfaced as a single
      // synthetic property pointing at the inner object's name — enough for
      // the graph builder to keep the relationship without exploding scope.
      const name = extractDeclarationName(member);
      if (name) properties.push(name);
    } else if (member.type === "companion_object") {
      // `companion object { ... }` is its OWN node type in
      // tree-sitter-kotlin (@tree-sitter-grammars/tree-sitter-kotlin), a
      // sibling branch of class_member_declaration — NOT a subtype of
      // object_declaration — so it does not match the branch above. The
      // companion name is optional (`companion object Factory` vs the
      // common anonymous `companion object`); surface it as a property when
      // present, and recurse into its `class_body` so the companion's
      // functions/properties land in methods[]/functions[]/exports[].
      const name = extractDeclarationName(member);
      if (name) properties.push(name);
      const companionBody = findChild(member, "class_body");
      if (companionBody) {
        collectClassBody(
          companionBody,
          methods,
          properties,
          functions,
          exports,
        );
      }
    } else if (member.type === "enum_entry") {
      // Enum constants (e.g. NORTH, SOUTH) are `enum_entry` direct children
      // of `enum_class_body` in tree-sitter-kotlin, each carrying its name
      // as an `identifier` child. They are the canonical members of an enum,
      // so surface them as properties (parallels primary-constructor
      // val/var handling). Enum entries are always public, hence also
      // exported.
      const id = findChild(member, "identifier");
      if (id) {
        properties.push(id.text);
        exports.push({ name: id.text, lineNumber: member.startPosition.row + 1 });
      }
    }
  }
}

/**
 * Extract the property name from a `property_declaration`. The name lives
 * inside the `variable_declaration` child as its `identifier`.
 */
function extractPropertyName(propNode: TreeSitterNode): string | null {
  const varDecl = findChild(propNode, "variable_declaration");
  if (!varDecl) return null;
  const id = findChild(varDecl, "identifier");
  return id ? id.text : null;
}

/**
 * Walk a `primary_constructor`'s `class_parameters` and surface every
 * `val` / `var` parameter as a class property. Plain `parameter` entries
 * (no val/var keyword) are constructor-only and are NOT properties — they
 * vanish after the constructor returns.
 */
function collectPrimaryConstructorProperties(
  declNode: TreeSitterNode,
  properties: string[],
): void {
  const primary = findChild(declNode, "primary_constructor");
  if (!primary) return;
  const params = findChild(primary, "class_parameters");
  if (!params) return;
  for (const param of findChildren(params, "class_parameter")) {
    // A class_parameter that starts with `val` or `var` is a property.
    let isProperty = false;
    for (let i = 0; i < param.childCount; i++) {
      const child = param.child(i);
      if (child && (child.type === "val" || child.type === "var")) {
        isProperty = true;
        break;
      }
    }
    if (!isProperty) continue;
    const id = findChild(param, "identifier");
    if (id) properties.push(id.text);
  }
}

/**
 * Kotlin extractor for tree-sitter structural analysis and call graph
 * extraction. Maps Kotlin's class / interface / object / data-class
 * declarations to the project's shared `StructuralAnalysis.classes` array.
 */
export class KotlinExtractor implements LanguageExtractor {
  readonly languageIds = ["kotlin"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "package_header":
          // Package is metadata about this file, not a graph member. Skip.
          break;

        case "import":
          this.extractImport(node, imports);
          break;

        case "function_declaration":
          this.extractTopLevelFunction(node, functions, exports);
          break;

        case "class_declaration":
          this.extractClassDeclaration(node, classes, functions, exports);
          break;

        case "object_declaration":
          this.extractObjectDeclaration(node, classes, functions, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      if (node.type === "function_declaration") {
        const name = extractDeclarationName(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }

      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = this.extractCalleeName(node);
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
    declNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractDeclarationName(declNode);
    if (!name) return;
    functions.push({
      name,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      params: extractParams(declNode),
      returnType: extractReturnType(declNode),
    });
    if (isExported(declNode)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  private extractClassDeclaration(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractDeclarationName(declNode);
    if (!name) return;

    const properties: string[] = [];
    const methods: string[] = [];

    // 1. Primary-constructor `val`/`var` parameters become properties.
    collectPrimaryConstructorProperties(declNode, properties);

    // 2. Body members (if any). Some Kotlin declarations have no body
    //    (e.g. `class Empty` or `data class Point(...)` without `{}`).
    //    An `enum class` body is parsed as `enum_class_body`, not
    //    `class_body` (node name per the
    //    @tree-sitter-grammars/tree-sitter-kotlin grammar's
    //    `enum_class_body` rule).
    const body =
      findChild(declNode, "class_body") ??
      findChild(declNode, "enum_class_body");
    if (body) {
      collectClassBody(body, methods, properties, functions, exports);
    }

    classes.push({
      name,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods,
      properties,
    });

    if (isExported(declNode)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  private extractObjectDeclaration(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractDeclarationName(declNode);
    if (!name) return;

    const properties: string[] = [];
    const methods: string[] = [];

    const body = findChild(declNode, "class_body");
    if (body) {
      collectClassBody(body, methods, properties, functions, exports);
    }

    classes.push({
      name,
      lineRange: [declNode.startPosition.row + 1, declNode.endPosition.row + 1],
      methods,
      properties,
    });

    if (isExported(declNode)) {
      exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
    }
  }

  /**
   * Extract a Kotlin import.
   *
   * The grammar gives us a single `qualified_identifier` child holding the
   * dotted module path. Three trailing variants must be distinguished:
   *
   * - `import foo.bar.Baz`            → source="foo.bar.Baz", specifier="Baz"
   * - `import foo.bar.*`              → source="foo.bar",     specifier="*"
   * - `import foo.bar.Baz as Quux`    → source="foo.bar.Baz", specifier="Quux"
   *
   * The grammar represents the wildcard as a trailing `*` token AFTER the
   * qualified_identifier (which holds the dotted prefix). The alias
   * appears as `as` + a top-level `identifier` sibling.
   */
  private extractImport(
    declNode: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const qualified = findChild(declNode, "qualified_identifier");
    if (!qualified) return;

    const parts: string[] = [];
    for (const id of findChildren(qualified, "identifier")) {
      parts.push(id.text);
    }
    if (parts.length === 0) return;

    const source = parts.join(".");

    // Look for a sibling `*` (wildcard) or an `as` keyword + identifier
    // after the qualified_identifier.
    let specifier = parts[parts.length - 1];
    let sawWildcardStar = false;
    let sawAs = false;
    for (let i = 0; i < declNode.childCount; i++) {
      const child = declNode.child(i);
      if (!child) continue;
      if (child.type === "*") sawWildcardStar = true;
      if (child.type === "as") sawAs = true;
      else if (sawAs && child.type === "identifier") {
        specifier = child.text;
        sawAs = false;
      }
    }
    if (sawWildcardStar) specifier = "*";

    imports.push({
      source,
      specifiers: [specifier],
      lineNumber: declNode.startPosition.row + 1,
    });
  }

  /**
   * Extract the callee name from a Kotlin `call_expression`. Two shapes:
   *
   *   foo(...)              → first child is `identifier "foo"`
   *   target.method(...)    → first child is `navigation_expression` whose
   *                           last `navigation_suffix > identifier` is the
   *                           method name
   */
  private extractCalleeName(callNode: TreeSitterNode): string | null {
    const first = callNode.child(0);
    if (!first) return null;

    if (first.type === "identifier") return first.text;

    if (first.type === "navigation_expression") {
      // The Kotlin grammar flattens navigation: `x.foo` is
      //   navigation_expression { x, ".", identifier "foo" }
      // The method name is the LAST `identifier` child of the navigation.
      let lastIdentifier: string | null = null;
      for (let i = 0; i < first.childCount; i++) {
        const child = first.child(i);
        if (child && child.type === "identifier") {
          lastIdentifier = child.text;
        }
      }
      return lastIdentifier;
    }
    return null;
  }
}
