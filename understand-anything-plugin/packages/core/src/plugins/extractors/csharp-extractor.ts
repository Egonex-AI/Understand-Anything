import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a C# `parameter_list` node.
 *
 * Each `parameter` child has a `name` field (identifier) and a `type` field.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  const paramNodes = findChildren(paramsNode, "parameter");
  for (const param of paramNodes) {
    const nameNode = param.childForFieldName("name");
    if (nameNode) {
      params.push(nameNode.text);
    }
  }

  return params;
}

/**
 * Extract the return type text from a method_declaration node.
 *
 * In tree-sitter-c-sharp, the return type is the `returns` named field.
 * It can be a predefined_type (void, int, string), generic_name (List<T>),
 * identifier, nullable_type, etc.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("returns");
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Check if a C# declaration node has a specific modifier.
 *
 * Unlike Java (which has a single `modifiers` container), C# tree-sitter
 * emits multiple separate `modifier` nodes as direct children of the
 * declaration. Each modifier node contains a single keyword child
 * (e.g., `public`, `private`, `static`).
 */
function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  const modifierNodes = findChildren(node, "modifier");
  for (const mod of modifierNodes) {
    for (let i = 0; i < mod.childCount; i++) {
      const child = mod.child(i);
      if (child && child.text === modifier) return true;
    }
  }
  return false;
}

/**
 * Extract the namespace source text from a using_directive.
 *
 * Handles both simple identifiers (`using System;`) and qualified names
 * (`using System.Collections.Generic;`). For aliased usings like
 * `using Alias = Some.Namespace;`, extracts the target namespace.
 */
function extractUsingSource(node: TreeSitterNode): string | null {
  // Check for alias form: `using Alias = Some.Namespace;`
  const hasEquals = findChild(node, "=") !== null;

  if (hasEquals) {
    // The target namespace is the qualified_name after the `=`
    const qualifiedName = findChild(node, "qualified_name");
    return qualifiedName ? qualifiedName.text : null;
  }

  // Simple or qualified using
  const qualifiedName = findChild(node, "qualified_name");
  if (qualifiedName) return qualifiedName.text;

  const identifier = findChild(node, "identifier");
  return identifier ? identifier.text : null;
}

/**
 * Get the last component of a dotted namespace path.
 * e.g. "System.Collections.Generic" -> "Generic"
 */
function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

/**
 * Extract the callee name from an invocation_expression node.
 *
 * Handles:
 * - Plain method call: `FetchFromDb(limit)` -> "FetchFromDb"
 *   (function field is an identifier)
 * - Qualified call: `Console.WriteLine(msg)` -> "Console.WriteLine"
 *   (function field is a member_access_expression)
 */
function extractInvocationName(node: TreeSitterNode): string | null {
  const funcNode = node.childForFieldName("function");
  if (!funcNode) return null;
  return funcNode.text;
}

/**
 * C# extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles classes, interfaces, methods, constructors, properties, fields,
 * using directives, visibility-based exports, and call graphs for C# source code.
 *
 * C#-specific mapping decisions:
 * - Classes and interfaces are mapped to the `classes` array.
 * - Constructors are mapped to the `functions` array (named after the class).
 * - Methods (including interface method signatures) are listed in the
 *   containing class/interface's `methods` array and also in the `functions` array.
 * - Properties (e.g., `public string Name { get; set; }`) are extracted into
 *   the containing class's `properties` array alongside fields.
 * - Exports are determined by the `public` modifier on classes, interfaces,
 *   methods, constructors, properties, and fields.
 * - Namespaces: both block-scoped (`namespace Foo { ... }`) and file-scoped
 *   (`namespace Foo;`) are traversed to find declarations.
 * - Using directives are mapped to imports, with the last dotted component
 *   as the specifier.
 */
export class CSharpExtractor implements LanguageExtractor {
  readonly languageIds = ["csharp"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    this.walkTopLevel(rootNode, functions, classes, imports, exports);

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering method/constructor declarations
      if (
        node.type === "method_declaration" ||
        node.type === "constructor_declaration"
      ) {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      // Extract method invocations: e.g. FetchFromDb(limit), Console.WriteLine(msg)
      if (node.type === "invocation_expression") {
        if (functionStack.length > 0) {
          const callee = extractInvocationName(node);
          if (callee) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      // Extract object creation: e.g. new Foo()
      if (node.type === "object_creation_expression") {
        if (functionStack.length > 0) {
          // The type is the child after `new` — can be identifier or generic_name
          const typeNode = findChild(node, "identifier") ?? findChild(node, "generic_name");
          if (typeNode) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee: `new ${typeNode.text}`,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkForCalls(child);
      }

      if (pushedName) {
        functionStack.pop();
      }
    };

    walkForCalls(rootNode);

    return entries;
  }

  // ---- Private helpers ----

  /**
   * Walk the top-level nodes of a compilation_unit, recursing into
   * namespace bodies to find declarations.
   */
  private walkTopLevel(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      switch (child.type) {
        case "using_directive":
          this.extractUsing(child, imports);
          break;

        case "namespace_declaration":
          // Recurse into namespace body (declaration_list)
          this.walkNamespaceBody(child, functions, classes, imports, exports);
          break;

        case "file_scoped_namespace_declaration":
          // File-scoped namespace: declarations are siblings at the root,
          // not children of this node. Nothing to recurse into.
          break;

        case "class_declaration":
          this.extractClass(child, functions, classes, exports);
          break;

        case "interface_declaration":
          this.extractInterface(child, functions, classes, exports);
          break;
      }
    }
  }

  /**
   * Walk into a namespace_declaration's body (declaration_list) to find
   * classes, interfaces, and nested namespaces.
   */
  private walkNamespaceBody(
    nsNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const body = nsNode.childForFieldName("body");
    if (!body) return;

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "class_declaration":
          this.extractClass(child, functions, classes, exports);
          break;

        case "interface_declaration":
          this.extractInterface(child, functions, classes, exports);
          break;

        case "namespace_declaration":
          // Nested namespaces
          this.walkNamespaceBody(child, functions, classes, imports, exports);
          break;
      }
    }
  }

  private extractUsing(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const source = extractUsingSource(node);
    if (!source) return;

    imports.push({
      source,
      specifiers: [lastComponent(source)],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClass(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      this.extractClassBodyMembers(body, methods, properties, functions, exports);
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractInterface(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      // Interface body contains method_declaration nodes (signatures without bodies)
      const methodNodes = findChildren(body, "method_declaration");
      for (const methodNode of methodNodes) {
        const methNameNode = methodNode.childForFieldName("name");
        if (methNameNode) {
          methods.push(methNameNode.text);
        }
      }

      // Interface can contain property_declaration nodes
      const propNodes = findChildren(body, "property_declaration");
      for (const propNode of propNodes) {
        const propNameNode = propNode.childForFieldName("name");
        if (propNameNode) {
          properties.push(propNameNode.text);
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Extract methods, constructors, properties, and fields from a
   * class declaration_list body.
   */
  private extractClassBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "method_declaration":
          this.extractMethod(child, methods, functions, exports);
          break;

        case "constructor_declaration":
          this.extractConstructor(child, methods, functions, exports);
          break;

        case "property_declaration":
          this.extractProperty(child, properties, exports);
          break;

        case "field_declaration":
          this.extractField(child, properties, exports);
          break;
      }
    }
  }

  private extractMethod(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractReturnType(node);

    methods.push(nameNode.text);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractConstructor(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);

    methods.push(nameNode.text);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      // Constructors have no return type
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractProperty(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    properties.push(nameNode.text);

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractField(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
  ): void {
    // field_declaration -> variable_declaration -> variable_declarator(s)
    const varDecl = findChild(node, "variable_declaration");
    if (!varDecl) return;

    const declarators = findChildren(varDecl, "variable_declarator");
    for (const decl of declarators) {
      // variable_declarator's first child is the identifier
      const nameNode = findChild(decl, "identifier");
      if (nameNode) {
        properties.push(nameNode.text);

        if (hasModifier(node, "public")) {
          exports.push({
            name: nameNode.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }
  }
}
