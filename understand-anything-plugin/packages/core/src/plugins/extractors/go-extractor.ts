import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a Go `parameter_list` node.
 *
 * Each child `parameter_declaration` has one or more `identifier` name children
 * followed by a type node.  Go allows unnamed params (e.g. in interface method
 * signatures), which we skip since they have no user-visible name.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  const declarations = findChildren(paramsNode, "parameter_declaration");
  for (const decl of declarations) {
    // A parameter_declaration can have multiple name identifiers sharing
    // a type, e.g. `a, b int`.  Collect all identifiers.
    for (let i = 0; i < decl.childCount; i++) {
      const child = decl.child(i);
      if (child && child.type === "identifier") {
        params.push(child.text);
      }
    }
  }

  return params;
}

/**
 * Extract the return type text from a function/method declaration's `result` field.
 *
 * Go supports three forms:
 * - single type: `error` -> "error"
 * - pointer type: `*Server` -> "*Server"
 * - multiple returns via parameter_list: `(string, error)` -> "(string, error)"
 */
function extractResultType(node: TreeSitterNode): string | undefined {
  const result = node.childForFieldName("result");
  if (!result) return undefined;
  return result.text;
}

/**
 * Extract the receiver type name from a method_declaration's receiver parameter_list.
 * Returns the base type name (without pointer star), e.g. `(s *Server)` -> "Server".
 */
function extractReceiverType(receiverNode: TreeSitterNode): string | undefined {
  const decl = findChild(receiverNode, "parameter_declaration");
  if (!decl) return undefined;

  // Look for type_identifier directly or inside pointer_type
  for (let i = 0; i < decl.childCount; i++) {
    const child = decl.child(i);
    if (!child) continue;
    if (child.type === "type_identifier") {
      return child.text;
    }
    if (child.type === "pointer_type") {
      const typeId = findChild(child, "type_identifier");
      if (typeId) return typeId.text;
    }
  }
  return undefined;
}

/**
 * Check if a name is exported in Go (starts with an uppercase letter).
 */
function isExported(name: string): boolean {
  if (name.length === 0) return false;
  const first = name.charCodeAt(0);
  return first >= 65 && first <= 90; // A-Z
}

/**
 * Go extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles functions, methods, structs, interfaces, imports, exports, and
 * call graphs for Go source code.
 *
 * Go-specific mapping decisions:
 * - Structs and interfaces are mapped to the `classes` array.
 * - Methods (with receivers) are stored as functions and also listed
 *   in the corresponding struct's `methods` array.
 * - Exports are determined by Go's capitalization convention.
 */
export class GoExtractor implements LanguageExtractor {
  readonly languageIds = ["go"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Track methods per receiver type so we can attach them to structs
    const methodsByReceiver = new Map<string, string[]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_declaration":
          this.extractFunction(node, functions, exports);
          break;

        case "method_declaration":
          this.extractMethod(node, functions, exports, methodsByReceiver);
          break;

        case "type_declaration":
          this.extractTypeDeclaration(node, classes, exports);
          break;

        case "import_declaration":
          this.extractImportDeclaration(node, imports);
          break;
      }
    }

    // Attach collected methods to their receiver structs/interfaces
    for (const cls of classes) {
      const methods = methodsByReceiver.get(cls.name);
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

      // Track entering function/method declarations
      if (node.type === "function_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      } else if (node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      // Extract call expressions
      if (node.type === "call_expression") {
        const calleeNode = node.childForFieldName("function");
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
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractResultType(node);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });

    if (isExported(nameNode.text)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractMethod(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    methodsByReceiver: Map<string, string[]>,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractResultType(node);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });

    // Track receiver type for struct association
    const receiverNode = node.childForFieldName("receiver");
    if (receiverNode) {
      const receiverType = extractReceiverType(receiverNode);
      if (receiverType) {
        if (!methodsByReceiver.has(receiverType)) {
          methodsByReceiver.set(receiverType, []);
        }
        methodsByReceiver.get(receiverType)!.push(nameNode.text);
      }
    }

    if (isExported(nameNode.text)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractTypeDeclaration(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const typeSpec = findChild(node, "type_spec");
    if (!typeSpec) return;

    const nameNode = typeSpec.childForFieldName("name");
    const typeNode = typeSpec.childForFieldName("type");
    if (!nameNode || !typeNode) return;

    if (typeNode.type === "struct_type") {
      this.extractStruct(node, nameNode, typeNode, classes, exports);
    } else if (typeNode.type === "interface_type") {
      this.extractInterface(node, nameNode, typeNode, classes, exports);
    }
  }

  private extractStruct(
    declNode: TreeSitterNode,
    nameNode: TreeSitterNode,
    structNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const properties: string[] = [];

    const fieldList = findChild(structNode, "field_declaration_list");
    if (fieldList) {
      const fields = findChildren(fieldList, "field_declaration");
      for (const field of fields) {
        // A field_declaration can have multiple names: `X, Y int`
        for (let i = 0; i < field.childCount; i++) {
          const child = field.child(i);
          if (child && child.type === "field_identifier") {
            properties.push(child.text);
          }
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      methods: [], // Methods are attached later from methodsByReceiver
      properties,
    });

    if (isExported(nameNode.text)) {
      exports.push({
        name: nameNode.text,
        lineNumber: declNode.startPosition.row + 1,
      });
    }
  }

  private extractInterface(
    declNode: TreeSitterNode,
    nameNode: TreeSitterNode,
    interfaceNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const methods: string[] = [];

    const methodElems = findChildren(interfaceNode, "method_elem");
    for (const elem of methodElems) {
      const methName = elem.childForFieldName("name");
      if (methName) {
        methods.push(methName.text);
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      methods,
      properties: [], // Interfaces have no properties
    });

    if (isExported(nameNode.text)) {
      exports.push({
        name: nameNode.text,
        lineNumber: declNode.startPosition.row + 1,
      });
    }
  }

  private extractImportDeclaration(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Grouped imports: import ( ... )
    const specList = findChild(node, "import_spec_list");
    if (specList) {
      const specs = findChildren(specList, "import_spec");
      for (const spec of specs) {
        this.extractImportSpec(spec, imports);
      }
    } else {
      // Single import: import "fmt"
      const spec = findChild(node, "import_spec");
      if (spec) {
        this.extractImportSpec(spec, imports);
      }
    }
  }

  private extractImportSpec(
    spec: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const pathNode = spec.childForFieldName("path");
    if (!pathNode) return;

    // Extract unquoted path
    const pathContent = findChild(pathNode, "interpreted_string_literal_content");
    const source = pathContent ? pathContent.text : pathNode.text.replace(/^"|"$/g, "");

    // Determine the specifier: alias if present, otherwise last path component
    const nameNode = spec.childForFieldName("name");
    let specifier: string;
    if (nameNode) {
      specifier = nameNode.text;
    } else {
      // Use last path component, e.g. "net/http" -> "http"
      const parts = source.split("/");
      specifier = parts[parts.length - 1];
    }

    imports.push({
      source,
      specifiers: [specifier],
      lineNumber: spec.startPosition.row + 1,
    });
  }
}
