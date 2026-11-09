import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a Python `parameters` node.
 *
 * Handles: identifier (plain), typed_parameter, default_parameter,
 * typed_default_parameter, list_splat_pattern (*args),
 * dictionary_splat_pattern (**kwargs).
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    switch (child.type) {
      case "identifier":
        // Skip `self` and `cls` — they are implicit, not real parameters
        if (child.text !== "self" && child.text !== "cls") {
          params.push(child.text);
        }
        break;

      case "typed_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") {
          params.push(ident.text);
        }
        break;
      }

      case "default_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") {
          params.push(ident.text);
        }
        break;
      }

      case "typed_default_parameter": {
        const ident = findChild(child, "identifier");
        if (ident && ident.text !== "self" && ident.text !== "cls") {
          params.push(ident.text);
        }
        break;
      }

      case "list_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("*" + ident.text);
        break;
      }

      case "dictionary_splat_pattern": {
        const ident = findChild(child, "identifier");
        if (ident) params.push("**" + ident.text);
        break;
      }
    }
  }

  return params;
}

/**
 * Extract the return type annotation from a function_definition node.
 * Python AST has a `return_type` field (the `type` node after `->`) on function_definition.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const returnType = node.childForFieldName("return_type");
  if (returnType) {
    return returnType.text;
  }
  return undefined;
}

/**
 * Unwrap a `decorated_definition` to get the inner definition.
 * If the node is not a decorated_definition, returns the node itself.
 */
function unwrapDecorated(node: TreeSitterNode): TreeSitterNode {
  if (node.type === "decorated_definition") {
    const inner =
      findChild(node, "function_definition") ??
      findChild(node, "class_definition");
    if (inner) return inner;
  }
  return node;
}

/**
 * Python extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles functions, classes, imports, exports, and call graphs for Python code.
 * Python has no formal export syntax, so all top-level function and class
 * definitions are treated as exports.
 */
export class PythonExtractor implements LanguageExtractor {
  readonly languageIds = ["python"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      // Unwrap decorated definitions to get the inner node
      const inner = unwrapDecorated(node);

      switch (inner.type) {
        case "function_definition":
          this.extractFunction(inner, functions);
          // Top-level functions are exports in Python
          this.addExport(inner, node, exports);
          break;

        case "class_definition":
          this.extractClass(inner, classes);
          // Top-level classes are exports in Python
          this.addExport(inner, node, exports);
          break;

        case "import_statement":
          this.extractImport(inner, imports);
          break;

        case "import_from_statement":
          this.extractFromImport(inner, imports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering function/method definitions
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      // Extract call expressions
      if (node.type === "call") {
        const calleeNode = node.children.find(
          (c) =>
            c.type === "identifier" ||
            c.type === "attribute",
        );
        if (calleeNode && functionStack.length > 0) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee: calleeNode.text,
            lineNumber: node.startPosition.row + 1,
          });
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

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractReturnType(node);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });
  }

  private extractClass(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (!member) continue;

        // Methods: function_definition or decorated_definition wrapping a function_definition
        const innerMember = unwrapDecorated(member);
        if (innerMember.type === "function_definition") {
          const methodName = innerMember.childForFieldName("name");
          if (methodName) methods.push(methodName.text);
        }

        // Properties: type-annotated assignments at class body level
        // e.g., `name: str` or `value: int = 0`
        if (member.type === "expression_statement") {
          const assignment = findChild(member, "assignment");
          if (assignment) {
            // Check if this is a type-annotated class-level assignment (has `:` child = type annotation)
            const typeNode = findChild(assignment, "type");
            const nameIdent = findChild(assignment, "identifier");
            if (typeNode && nameIdent) {
              properties.push(nameIdent.text);
            }
          }
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
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // `import os` or `import os.path`
    // Can have multiple: `import os, sys`
    const dottedNames = findChildren(node, "dotted_name");
    const aliasedImports = findChildren(node, "aliased_import");

    for (const dn of dottedNames) {
      imports.push({
        source: dn.text,
        specifiers: [dn.text],
        lineNumber: node.startPosition.row + 1,
      });
    }

    for (const ai of aliasedImports) {
      const dottedName = findChild(ai, "dotted_name");
      const alias = ai.children.find(
        (c) => c.type === "identifier",
      );
      if (dottedName) {
        imports.push({
          source: dottedName.text,
          specifiers: [alias ? alias.text : dottedName.text],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }
  }

  private extractFromImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // `from pathlib import Path` or `from typing import Optional, List`
    const moduleNode = node.childForFieldName("module_name");
    const source = moduleNode ? moduleNode.text : "";
    const moduleNodeId = moduleNode?.id;

    const specifiers: string[] = [];

    // Collect dotted_name specifiers (non-aliased)
    // Skip the module_name dotted_name (compare by node id, not reference)
    const allDottedNames = findChildren(node, "dotted_name");
    for (const dn of allDottedNames) {
      if (dn.id === moduleNodeId) continue;
      specifiers.push(dn.text);
    }

    // Collect aliased imports: `from foo import bar as baz`
    const aliasedImports = findChildren(node, "aliased_import");
    for (const ai of aliasedImports) {
      // The alias identifier follows the `as` keyword
      const alias = ai.children.find(
        (c) => c.type === "identifier",
      );
      if (alias) {
        specifiers.push(alias.text);
      }
    }

    // Handle wildcard imports: `from os import *`
    if (findChild(node, "wildcard_import")) {
      specifiers.push("*");
    }

    imports.push({
      source,
      specifiers,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private addExport(
    inner: TreeSitterNode,
    outer: TreeSitterNode,
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = inner.childForFieldName("name");
    if (nameNode) {
      exports.push({
        name: nameNode.text,
        lineNumber: outer.startPosition.row + 1,
      });
    }
  }
}
