import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Set of Swift visibility modifier keywords that count as exported across
 * module boundaries. `internal` (the default) is module-private, so it is
 * not in this set.
 */
const EXPORTED_VISIBILITIES = new Set(["public", "open"]);

/**
 * Tree-sitter `class_declaration` is overloaded for several Swift declarations
 * distinguished by the `declaration_kind` field. We treat all of them as
 * `class`-like entries in the StructuralAnalysis output.
 */
type SwiftTypeKind = "class" | "struct" | "enum" | "actor" | "extension";

/**
 * Extract the visibility keyword text (e.g., "public", "private") from a
 * declaration's `modifiers` child, or return null when no modifier is present.
 */
function extractVisibility(declNode: TreeSitterNode): string | null {
  const modifiers = findChild(declNode, "modifiers");
  if (!modifiers) return null;
  const visibility = findChild(modifiers, "visibility_modifier");
  if (!visibility) return null;
  return visibility.text;
}

function isExported(declNode: TreeSitterNode): boolean {
  const visibility = extractVisibility(declNode);
  return visibility !== null && EXPORTED_VISIBILITIES.has(visibility);
}

/**
 * Extract the parameter name from a Swift `parameter` node.
 *
 * Swift parameters can take several forms:
 * - `name: Type`            → internal name = "name"
 * - `_ name: Type`          → internal name = "name" (no external label)
 * - `label name: Type`      → internal name = "name" (external label = "label")
 *
 * The internal name is what's used inside the function body, so that's what
 * we return. It is always the last `simple_identifier` that appears before
 * the `:` separator.
 */
function extractParamName(paramNode: TreeSitterNode): string | null {
  let lastBeforeColon: string | null = null;
  for (let i = 0; i < paramNode.childCount; i++) {
    const child = paramNode.child(i);
    if (!child) continue;
    if (child.type === ":") break;
    if (child.type === "simple_identifier") {
      lastBeforeColon = child.text;
    }
  }
  return lastBeforeColon;
}

function extractParams(declNode: TreeSitterNode): string[] {
  const params: string[] = [];
  for (const param of findChildren(declNode, "parameter")) {
    const name = extractParamName(param);
    if (name) params.push(name);
  }
  return params;
}

/**
 * Extract the return type text from a `function_declaration` by finding the
 * `->` token and taking the next named child. Returns undefined for `Void`
 * functions and initializers (which never have a return arrow).
 */
function extractReturnType(declNode: TreeSitterNode): string | undefined {
  for (let i = 0; i < declNode.childCount - 1; i++) {
    const child = declNode.child(i);
    if (child && child.type === "->") {
      // Find the next non-anonymous child, which is the return type node
      for (let j = i + 1; j < declNode.childCount; j++) {
        const next = declNode.child(j);
        if (next && next.isNamed) return next.text;
      }
    }
  }
  return undefined;
}

/**
 * Extract the function's own `simple_identifier` name. This is the first
 * `simple_identifier` child (the one immediately following `func`); later
 * `simple_identifier`s belong to type parameters or the return type.
 */
function extractFunctionName(declNode: TreeSitterNode): string | null {
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (child && child.type === "simple_identifier") return child.text;
  }
  return null;
}

/**
 * Resolve the user-facing type name for a `class_declaration` node, handling
 * the fact that `extension`s use a `user_type` child while named types use a
 * bare `type_identifier`.
 */
function extractTypeName(declNode: TreeSitterNode): string | null {
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (!child) continue;
    if (child.type === "type_identifier") return child.text;
    if (child.type === "user_type") {
      const inner = findChild(child, "type_identifier");
      if (inner) return inner.text;
      return child.text.trim();
    }
  }
  return null;
}

function getSwiftTypeKind(declNode: TreeSitterNode): SwiftTypeKind {
  // declaration_kind is the keyword token (class/struct/enum/actor/extension)
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (!child) continue;
    if (
      child.type === "class" ||
      child.type === "struct" ||
      child.type === "enum" ||
      child.type === "actor" ||
      child.type === "extension"
    ) {
      return child.type as SwiftTypeKind;
    }
  }
  // Fallback — should never hit because the grammar guarantees one of these
  return "class";
}

/**
 * Swift extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Maps Swift's many type-like declarations (class, struct, enum, actor,
 * extension, protocol) to the project's shared `StructuralAnalysis.classes`
 * array. Extension methods on a type declared in the same file are merged
 * onto the existing entry rather than creating a duplicate.
 */
export class SwiftExtractor implements LanguageExtractor {
  readonly languageIds = ["swift"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Index of classes by name so extensions can merge into the existing entry
    const classByName = new Map<string, StructuralAnalysis["classes"][number]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_declaration":
          this.extractTopLevelFunction(node, functions, exports);
          break;

        case "class_declaration":
          this.extractClassLike(node, classes, classByName, functions, exports);
          break;

        case "protocol_declaration":
          this.extractProtocol(node, classes, classByName, exports);
          break;

        case "import_declaration":
          this.extractImport(node, imports);
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

      // Track entering function-bearing declarations so calls inside are
      // attributed to the enclosing function name.
      if (
        node.type === "function_declaration" ||
        node.type === "protocol_function_declaration"
      ) {
        const name = extractFunctionName(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      } else if (node.type === "init_declaration") {
        functionStack.push("init");
        pushed = true;
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

  // ---- Top-level helpers ----

  private extractTopLevelFunction(
    declNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const fn = this.buildFunctionEntry(declNode);
    if (!fn) return;
    functions.push(fn);
    if (isExported(declNode)) {
      exports.push({ name: fn.name, lineNumber: fn.lineRange[0] });
    }
  }

  private buildFunctionEntry(
    declNode: TreeSitterNode,
  ): StructuralAnalysis["functions"][number] | null {
    const name = extractFunctionName(declNode);
    if (!name) return null;
    return {
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      params: extractParams(declNode),
      returnType: extractReturnType(declNode),
    };
  }

  private extractClassLike(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const kind = getSwiftTypeKind(declNode);
    const name = extractTypeName(declNode);
    if (!name) return;

    const body = findChild(declNode, "class_body") ?? findChild(declNode, "enum_class_body");
    const methods: string[] = [];
    const properties: string[] = [];

    if (body) {
      this.collectBodyMembers(body, methods, properties, functions, exports);
    }

    if (kind === "extension") {
      // Merge into existing entry if the extended type was declared earlier
      // in the same file; otherwise create a synthetic entry.
      const existing = classByName.get(name);
      if (existing) {
        existing.methods.push(...methods);
        existing.properties.push(...properties);
        // Extension methods exported by the extended type's visibility — but
        // explicit `public` modifiers on the extension's members are already
        // captured in `collectBodyMembers`.
        return;
      }
    }

    const entry = {
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ] as [number, number],
      methods,
      properties,
    };
    classes.push(entry);
    classByName.set(name, entry);

    if (isExported(declNode)) {
      exports.push({ name, lineNumber: entry.lineRange[0] });
    }
  }

  private extractProtocol(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractTypeName(declNode);
    if (!name) return;

    const body = findChild(declNode, "protocol_body");
    const methods: string[] = [];
    const properties: string[] = [];

    if (body) {
      // Protocol method requirements live in `protocol_function_declaration`;
      // property requirements live in `protocol_property_declaration`.
      for (const fn of findChildren(body, "protocol_function_declaration")) {
        const fnName = extractFunctionName(fn);
        if (fnName) methods.push(fnName);
      }
      for (const prop of findChildren(body, "protocol_property_declaration")) {
        const propName = this.extractPropertyName(prop);
        if (propName) properties.push(propName);
      }
    }

    const entry = {
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ] as [number, number],
      methods,
      properties,
    };
    classes.push(entry);
    classByName.set(name, entry);

    if (isExported(declNode)) {
      exports.push({ name, lineNumber: entry.lineRange[0] });
    }
  }

  private collectBodyMembers(
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
        const fn = this.buildFunctionEntry(member);
        if (fn) {
          functions.push(fn);
          methods.push(fn.name);
          if (isExported(member)) {
            exports.push({ name: fn.name, lineNumber: fn.lineRange[0] });
          }
        }
      } else if (member.type === "init_declaration") {
        // Swift initializers don't have a `simple_identifier` name; record as "init"
        methods.push("init");
        functions.push({
          name: "init",
          lineRange: [
            member.startPosition.row + 1,
            member.endPosition.row + 1,
          ],
          params: extractParams(member),
          returnType: undefined,
        });
        if (isExported(member)) {
          exports.push({
            name: "init",
            lineNumber: member.startPosition.row + 1,
          });
        }
      } else if (member.type === "property_declaration") {
        const name = this.extractPropertyName(member);
        if (name) properties.push(name);
        if (name && isExported(member)) {
          exports.push({
            name,
            lineNumber: member.startPosition.row + 1,
          });
        }
      } else if (member.type === "enum_entry") {
        // Each `case` in an enum can declare multiple comma-separated cases;
        // we record the simple identifier for each.
        for (const id of findChildren(member, "simple_identifier")) {
          properties.push(id.text);
        }
      }
    }
  }

  private extractPropertyName(propNode: TreeSitterNode): string | null {
    // property_declaration -> pattern -> simple_identifier (bound_identifier field)
    const pattern = findChild(propNode, "pattern");
    if (!pattern) return null;
    const id = findChild(pattern, "simple_identifier");
    return id ? id.text : null;
  }

  private extractImport(
    declNode: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // The module path lives in the `identifier` child; e.g. for
    // `import struct Combine.AnyPublisher` it contains both "Combine" and "AnyPublisher".
    const identifier = findChild(declNode, "identifier");
    if (!identifier) return;

    const parts: string[] = [];
    for (const id of findChildren(identifier, "simple_identifier")) {
      parts.push(id.text);
    }
    if (parts.length === 0) return;

    const source = parts.join(".");
    const specifier = parts[parts.length - 1];
    imports.push({
      source,
      specifiers: [specifier],
      lineNumber: declNode.startPosition.row + 1,
    });
  }

  /**
   * Extract the callee name from a `call_expression`. Swift call expressions
   * can take two shapes:
   * - `foo(...)`           → first child is `simple_identifier "foo"`
   * - `target.method(...)` → first child is `navigation_expression`; the
   *                          method name is the trailing `navigation_suffix`'s
   *                          `simple_identifier`.
   */
  private extractCalleeName(callNode: TreeSitterNode): string | null {
    const first = callNode.child(0);
    if (!first) return null;

    if (first.type === "simple_identifier") return first.text;

    if (first.type === "navigation_expression") {
      const suffix = findChild(first, "navigation_suffix");
      if (suffix) {
        const id = findChild(suffix, "simple_identifier");
        if (id) return id.text;
      }
    }
    return null;
  }
}
