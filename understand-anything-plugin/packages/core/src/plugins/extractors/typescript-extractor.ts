import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { getStringValue } from "./base-extractor.js";

/**
 * Extract parameter names from a formal_parameters node.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;
    if (
      child.type === "required_parameter" ||
      child.type === "optional_parameter"
    ) {
      const ident =
        child.childForFieldName("pattern") ??
        child.childForFieldName("name");
      if (ident) {
        params.push(ident.text);
      } else {
        // Fallback: first identifier child
        for (let j = 0; j < child.childCount; j++) {
          const c = child.child(j);
          if (c && c.type === "identifier") {
            params.push(c.text);
            break;
          }
        }
      }
    } else if (child.type === "identifier") {
      // JavaScript parameters (no type annotation)
      params.push(child.text);
    } else if (
      child.type === "rest_pattern" ||
      child.type === "rest_element"
    ) {
      const ident = child.children.find(
        (c) => c.type === "identifier",
      );
      if (ident) params.push("..." + ident.text);
    }
  }
  return params;
}

/**
 * Extract return type annotation from a function-like node.
 */
function extractReturnType(
  node: TreeSitterNode,
): string | undefined {
  const typeAnnotation = node.childForFieldName("return_type");
  if (typeAnnotation && typeAnnotation.type === "type_annotation") {
    const text = typeAnnotation.text;
    return text.startsWith(":") ? text.slice(1).trim() : text;
  }
  return undefined;
}

/**
 * Extract import specifiers from an import_clause node.
 */
function extractImportSpecifiers(
  importClause: TreeSitterNode,
): string[] {
  const specifiers: string[] = [];

  for (let i = 0; i < importClause.childCount; i++) {
    const child = importClause.child(i);
    if (!child) continue;

    if (child.type === "named_imports") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j);
        if (spec && spec.type === "import_specifier") {
          const alias = spec.childForFieldName("alias");
          const name = spec.childForFieldName("name");
          specifiers.push(
            alias ? alias.text : name ? name.text : spec.text,
          );
        }
      }
    } else if (child.type === "namespace_import") {
      const ident = child.children.find(
        (c) => c.type === "identifier",
      );
      if (ident) specifiers.push("* as " + ident.text);
    } else if (child.type === "identifier") {
      // default import: import foo from '...'
      specifiers.push(child.text);
    }
  }

  return specifiers;
}

/**
 * TypeScript/JavaScript extractor.
 *
 * Handles structural analysis and call-graph extraction for
 * TypeScript and JavaScript ASTs produced by tree-sitter.
 */
export class TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ["typescript", "javascript"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const exportedNames = new Set<string>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      this.processTopLevelNode(
        node,
        functions,
        classes,
        imports,
        exports,
        exportedNames,
      );
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      const isFunctionLike =
        node.type === "function_declaration" ||
        node.type === "method_definition" ||
        node.type === "arrow_function" ||
        node.type === "function_expression";

      let pushedName = false;
      if (isFunctionLike) {
        let name: string | undefined;
        if (node.type === "function_declaration") {
          name = (
            node.childForFieldName("name") ??
            node.children.find((c) => c.type === "identifier")
          )?.text;
        } else if (node.type === "method_definition") {
          name = node.children.find(
            (c) => c.type === "property_identifier",
          )?.text;
        } else if (
          node.type === "arrow_function" ||
          node.type === "function_expression"
        ) {
          const parent = node.parent;
          if (parent && parent.type === "variable_declarator") {
            name = parent.childForFieldName("name")?.text;
          }
        }
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
      }

      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function");
        if (callee && functionStack.length > 0) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee: callee.text,
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

  // ---- Private extraction helpers ----

  private processTopLevelNode(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    exportedNames: Set<string>,
  ): void {
    switch (node.type) {
      case "function_declaration":
        this.extractFunction(node, functions);
        break;

      case "class_declaration":
        this.extractClass(node, classes);
        break;

      case "lexical_declaration":
      case "variable_declaration":
        this.extractVariableDeclarations(node, functions);
        break;

      case "import_statement":
        this.extractImport(node, imports);
        break;

      case "export_statement":
        this.processExportStatement(
          node,
          functions,
          classes,
          imports,
          exports,
          exportedNames,
        );
        break;
    }
  }

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    const nameNode =
      node.childForFieldName("name") ??
      node.children.find((c) => c.type === "identifier");
    if (!nameNode) return;

    const params = extractParams(
      node.childForFieldName("parameters") ??
        node.children.find(
          (c) => c.type === "formal_parameters",
        ) ??
        null,
    );
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
    const nameNode = node.children.find(
      (c) =>
        c.type === "type_identifier" || c.type === "identifier",
    );
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const classBody = node.children.find(
      (c) => c.type === "class_body",
    );
    if (classBody) {
      for (let j = 0; j < classBody.childCount; j++) {
        const member = classBody.child(j);
        if (!member) continue;

        if (member.type === "method_definition") {
          const methodName = member.children.find(
            (c) => c.type === "property_identifier",
          );
          if (methodName) methods.push(methodName.text);
        } else if (
          member.type === "public_field_definition" ||
          member.type === "property_definition"
        ) {
          const propName = member.children.find(
            (c) => c.type === "property_identifier",
          );
          if (propName) properties.push(propName.text);
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

  private extractVariableDeclarations(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child || child.type !== "variable_declarator") continue;

      const nameNode = child.childForFieldName("name");
      const valueNode = child.childForFieldName("value");

      if (
        nameNode &&
        valueNode &&
        (valueNode.type === "arrow_function" ||
          valueNode.type === "function_expression" ||
          valueNode.type === "function")
      ) {
        const params = extractParams(
          valueNode.childForFieldName("parameters") ??
            valueNode.children.find(
              (c) => c.type === "formal_parameters",
            ) ??
            null,
        );
        const returnType = extractReturnType(valueNode);

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
    }
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const sourceNode = node.children.find(
      (c) => c.type === "string",
    );
    if (!sourceNode) return;

    const source = getStringValue(sourceNode);
    const specifiers: string[] = [];

    const importClause = node.children.find(
      (c) => c.type === "import_clause",
    );
    if (importClause) {
      specifiers.push(...extractImportSpecifiers(importClause));
    }

    imports.push({
      source,
      specifiers,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private processExportStatement(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    _imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    exportedNames: Set<string>,
  ): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child) continue;

      switch (child.type) {
        case "function_declaration": {
          this.extractFunction(child, functions);
          const nameNode =
            child.childForFieldName("name") ??
            child.children.find((c) => c.type === "identifier");
          const isDefault = node.children.some((c) => c.type === "default");
          if (nameNode && !exportedNames.has(nameNode.text)) {
            exports.push({
              name: nameNode.text,
              lineNumber: node.startPosition.row + 1,
              isDefault,
            });
            exportedNames.add(nameNode.text);
          } else if (!nameNode && isDefault && !exportedNames.has("default")) {
            // `export default function () {}` — anonymous default export
            exports.push({
              name: "default",
              lineNumber: node.startPosition.row + 1,
              isDefault: true,
            });
            exportedNames.add("default");
          }
          break;
        }

        case "class_declaration": {
          this.extractClass(child, classes);
          const nameNode = child.children.find(
            (c) =>
              c.type === "type_identifier" ||
              c.type === "identifier",
          );
          const isDefault = node.children.some(
            (c) => c.type === "default",
          );
          if (nameNode && !exportedNames.has(nameNode.text)) {
            const exportName = isDefault
              ? "default"
              : nameNode.text;
            exports.push({
              name: exportName,
              lineNumber: node.startPosition.row + 1,
              isDefault,
            });
            exportedNames.add(exportName);
          }
          break;
        }

        case "lexical_declaration":
        case "variable_declaration": {
          this.extractVariableDeclarations(child, functions);
          for (let k = 0; k < child.childCount; k++) {
            const declarator = child.child(k);
            if (
              declarator &&
              declarator.type === "variable_declarator"
            ) {
              const nameNode =
                declarator.childForFieldName("name");
              if (
                nameNode &&
                !exportedNames.has(nameNode.text)
              ) {
                exports.push({
                  name: nameNode.text,
                  lineNumber: node.startPosition.row + 1,
                });
                exportedNames.add(nameNode.text);
              }
            }
          }
          break;
        }

        case "export_clause": {
          for (let k = 0; k < child.childCount; k++) {
            const spec = child.child(k);
            if (spec && spec.type === "export_specifier") {
              const alias = spec.childForFieldName("alias");
              const name = spec.childForFieldName("name");
              const exportName = alias
                ? alias.text
                : name
                  ? name.text
                  : spec.text;
              if (!exportedNames.has(exportName)) {
                exports.push({
                  name: exportName,
                  lineNumber: node.startPosition.row + 1,
                });
                exportedNames.add(exportName);
              }
            }
          }
          break;
        }
      }
    }
  }
}
