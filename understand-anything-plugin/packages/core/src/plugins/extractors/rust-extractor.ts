import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a Rust `parameters` node.
 *
 * Each `parameter` child has a `pattern` field (identifier) and a `type` field.
 * `self_parameter` nodes (&self, &mut self, self) are skipped since they are
 * implicit receivers, not user-facing parameters.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    if (child.type === "parameter") {
      const pattern = child.childForFieldName("pattern");
      if (pattern) {
        params.push(pattern.text);
      }
    }
    // Skip self_parameter — it's the receiver, not a real parameter
  }

  return params;
}

/**
 * Extract the return type from a function_item node.
 *
 * In tree-sitter-rust, the return type is accessed via the `return_type` named
 * field on function_item. The field value is the type node itself (e.g.
 * primitive_type "bool", type_identifier "Self").
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const returnType = node.childForFieldName("return_type");
  if (returnType) {
    return returnType.text;
  }
  return undefined;
}

/**
 * Check if a node has a `visibility_modifier` child whose text starts with "pub".
 * Covers `pub`, `pub(crate)`, `pub(super)`, etc.
 */
function isPublic(node: TreeSitterNode): boolean {
  const visMod = findChild(node, "visibility_modifier");
  return visMod !== null && visMod.text.startsWith("pub");
}

/**
 * Recursively extract the path portion of a scoped_identifier.
 *
 * `scoped_identifier` nests: `std::collections::HashMap` is
 * scoped_identifier(path: scoped_identifier(path: identifier "std", name: identifier "collections"), name: identifier "HashMap")
 *
 * This function collects all path segments into a flat "a::b::c" string,
 * excluding the final `name` (which is the imported specifier).
 */
function extractScopedPath(node: TreeSitterNode): { path: string; name: string } {
  if (node.type === "scoped_identifier") {
    const pathNode = node.childForFieldName("path");
    const nameNode = node.childForFieldName("name");
    const name = nameNode ? nameNode.text : "";
    const path = pathNode ? pathNode.text : "";
    return { path, name };
  }
  // Bare identifier: `use foo;`
  return { path: "", name: node.text };
}

/**
 * Rust extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles functions, structs, enums, traits, impl blocks, use declarations,
 * visibility-based exports, and call graphs for Rust source code.
 *
 * Rust-specific mapping decisions:
 * - Structs, enums, and traits are mapped to the `classes` array.
 * - Methods inside `impl` blocks are stored as functions and also listed
 *   in the corresponding struct/enum's `methods` array.
 * - Trait method signatures (function_signature_item) are listed in the
 *   trait's `methods` array.
 * - Exports are determined by the `pub` visibility modifier.
 * - Enum variants are extracted as `properties` of the enum class entry.
 */
export class RustExtractor implements LanguageExtractor {
  readonly languageIds = ["rust"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Track methods per impl type so we can attach them to structs/enums
    const methodsByType = new Map<string, string[]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_item":
          this.extractFunction(node, functions, exports);
          break;

        case "struct_item":
          this.extractStruct(node, classes, exports);
          break;

        case "enum_item":
          this.extractEnum(node, classes, exports);
          break;

        case "trait_item":
          this.extractTrait(node, classes, exports);
          break;

        case "impl_item":
          this.extractImpl(node, functions, exports, methodsByType);
          break;

        case "use_declaration":
          this.extractUseDeclaration(node, imports);
          break;
      }
    }

    // Attach collected methods to their corresponding structs/enums/traits
    for (const cls of classes) {
      const methods = methodsByType.get(cls.name);
      if (methods) {
        cls.methods.push(...methods);
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering function_item declarations
      if (node.type === "function_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      // Extract call expressions
      if (node.type === "call_expression") {
        if (functionStack.length > 0) {
          const callee = this.extractCalleeName(node);
          if (callee) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
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
   * Extract the callee name from a call_expression.
   *
   * Handles:
   * - Plain function call: `check_port(x)` -> "check_port"
   * - Method call via field_expression: `self.validate()` -> "self.validate"
   * - Scoped call: `Vec::new()` -> "Vec::new"
   */
  private extractCalleeName(callNode: TreeSitterNode): string | null {
    const funcNode = callNode.child(0);
    if (!funcNode) return null;

    if (funcNode.type === "identifier") {
      return funcNode.text;
    }

    if (funcNode.type === "field_expression") {
      // e.g., self.validate or obj.method
      const field = funcNode.childForFieldName("field");
      const value = funcNode.childForFieldName("value");
      if (field && value) {
        return value.text + "." + field.text;
      }
    }

    if (funcNode.type === "scoped_identifier") {
      // e.g., Vec::new
      return funcNode.text;
    }

    // Fallback: use the full text of the function child
    return funcNode.text;
  }

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
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

    if (isPublic(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractStruct(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "field_declaration_list") {
      const fields = findChildren(body, "field_declaration");
      for (const field of fields) {
        const fieldName = findChild(field, "field_identifier");
        if (fieldName) {
          properties.push(fieldName.text);
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods: [], // Methods are attached later from methodsByType
      properties,
    });

    if (isPublic(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractEnum(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const properties: string[] = [];
    const body = node.childForFieldName("body");
    if (body && body.type === "enum_variant_list") {
      const variants = findChildren(body, "enum_variant");
      for (const variant of variants) {
        const variantName = variant.childForFieldName("name");
        if (variantName) {
          properties.push(variantName.text);
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods: [], // Methods are attached later if there's an impl block
      properties,
    });

    if (isPublic(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractTrait(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const body = findChild(node, "declaration_list");
    if (body) {
      // Trait bodies contain function_signature_item for method declarations
      const sigs = findChildren(body, "function_signature_item");
      for (const sig of sigs) {
        const sigName = findChild(sig, "identifier");
        if (sigName) {
          methods.push(sigName.text);
        }
      }
      // Also handle default method implementations (function_item)
      const fns = findChildren(body, "function_item");
      for (const fn of fns) {
        const fnName = fn.childForFieldName("name");
        if (fnName) {
          methods.push(fnName.text);
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
      properties: [],
    });

    if (isPublic(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractImpl(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    methodsByType: Map<string, string[]>,
  ): void {
    const typeNode = node.childForFieldName("type");
    const typeName = typeNode ? typeNode.text : null;

    const body = node.childForFieldName("body");
    if (!body) return;

    const fns = findChildren(body, "function_item");
    for (const fn of fns) {
      const nameNode = fn.childForFieldName("name");
      if (!nameNode) continue;

      const paramsNode = fn.childForFieldName("parameters");
      const params = extractParams(paramsNode ?? null);
      const returnType = extractReturnType(fn);

      functions.push({
        name: nameNode.text,
        lineRange: [
          fn.startPosition.row + 1,
          fn.endPosition.row + 1,
        ],
        params,
        returnType,
      });

      // Track method association with the impl type
      if (typeName) {
        if (!methodsByType.has(typeName)) {
          methodsByType.set(typeName, []);
        }
        methodsByType.get(typeName)!.push(nameNode.text);
      }

      // pub methods inside impl blocks are exports
      if (isPublic(fn)) {
        exports.push({
          name: nameNode.text,
          lineNumber: fn.startPosition.row + 1,
        });
      }
    }
  }

  private extractUseDeclaration(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const argument = node.childForFieldName("argument");
    if (!argument) return;

    switch (argument.type) {
      case "identifier":
        // `use foo;`
        imports.push({
          source: argument.text,
          specifiers: [argument.text],
          lineNumber: node.startPosition.row + 1,
        });
        break;

      case "scoped_identifier": {
        // `use std::collections::HashMap;`
        const { path, name } = extractScopedPath(argument);
        imports.push({
          source: path,
          specifiers: [name],
          lineNumber: node.startPosition.row + 1,
        });
        break;
      }

      case "scoped_use_list": {
        // `use std::io::{self, Read, Write};`
        const pathNode = argument.childForFieldName("path");
        const listNode = argument.childForFieldName("list");
        const source = pathNode ? pathNode.text : "";
        const specifiers: string[] = [];

        if (listNode) {
          for (let j = 0; j < listNode.childCount; j++) {
            const ch = listNode.child(j);
            if (!ch) continue;
            if (ch.type === "self" || ch.type === "identifier") {
              specifiers.push(ch.text);
            } else if (ch.type === "scoped_identifier") {
              // Nested scoped identifier inside a use list
              specifiers.push(ch.text);
            }
          }
        }

        imports.push({
          source,
          specifiers,
          lineNumber: node.startPosition.row + 1,
        });
        break;
      }

      case "use_wildcard": {
        // `use std::prelude::*;`
        // The path is the scoped_identifier child
        const scopedId = findChild(argument, "scoped_identifier");
        const source = scopedId ? scopedId.text : "";
        imports.push({
          source,
          specifiers: ["*"],
          lineNumber: node.startPosition.row + 1,
        });
        break;
      }

      default: {
        // Fallback for any unhandled pattern
        imports.push({
          source: argument.text,
          specifiers: [argument.text],
          lineNumber: node.startPosition.row + 1,
        });
        break;
      }
    }
  }
}
