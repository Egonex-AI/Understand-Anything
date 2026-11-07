import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { getStringValue } from "./base-extractor.js";

interface CommonJsGlobals {
  require: boolean;
  module: boolean;
  exports: boolean;
}

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
    const commonJs = this.commonJsGlobals(rootNode);

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
        commonJs,
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
    commonJs: CommonJsGlobals,
  ): void {
    switch (node.type) {
      case "function_declaration":
        this.extractFunction(node, functions);
        break;

      case "abstract_class_declaration":
      case "class_declaration":
        this.extractClass(node, classes);
        break;

      case "lexical_declaration":
      case "variable_declaration":
        this.extractVariableDeclarations(node, functions);
        for (const declaration of node.namedChildren) {
          if (declaration.type !== "variable_declarator") continue;
          const source = commonJs.require
            ? this.requireSource(declaration.childForFieldName("value"))
            : null;
          if (source === null) continue;
          imports.push({
            source,
            specifiers: this.bindingNames(declaration.childForFieldName("name")),
            lineNumber: declaration.startPosition.row + 1,
          });
        }
        break;

      case "expression_statement":
        this.extractCommonJsStatement(node, imports, exports, exportedNames, commonJs);
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

        if (
          member.type === "method_definition" ||
          member.type === "abstract_method_signature"
        ) {
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

  private commonJsGlobals(root: TreeSitterNode): CommonJsGlobals {
    const bound = new Set<string>();
    const factories = new Set<string>();
    const nativeModules = new Set<string>();
    const declarations = root.namedChildren.flatMap((node) =>
      node.type === "export_statement" ? node.namedChildren : [node],
    );

    for (const node of declarations) {
      if (
        node.type === "lexical_declaration" ||
        node.type === "variable_declaration"
      ) {
        for (const declaration of node.namedChildren) {
          if (declaration.type !== "variable_declarator") continue;
          for (const name of this.bindingNames(
            declaration.childForFieldName("name"),
          ))
            bound.add(name);
        }
      } else if (
        [
          "function_declaration",
          "generator_function_declaration",
          "class_declaration",
          "abstract_class_declaration",
          "enum_declaration",
          "internal_module",
        ].includes(node.type)
      ) {
        const name = node.childForFieldName("name");
        if (name) bound.add(name.text);
      } else if (
        node.type === "import_statement" &&
        !node.children.some((child) => child.type === "type")
      ) {
        const source = node.childForFieldName("source");
        const native =
          source && ["module", "node:module"].includes(getStringValue(source));
        const clause = node.namedChildren.find(
          (child) => child.type === "import_clause",
        );
        for (const child of clause?.namedChildren ?? []) {
          if (
            child.type === "identifier" ||
            child.type === "namespace_import"
          ) {
            const name =
              child.type === "identifier"
                ? child
                : child.namedChildren.find(
                    (part) => part.type === "identifier",
                  );
            if (!name) continue;
            bound.add(name.text);
            if (native) nativeModules.add(name.text);
          } else if (child.type === "named_imports") {
            for (const specifier of child.namedChildren) {
              if (
                specifier.type !== "import_specifier" ||
                specifier.children.some((part) => part.type === "type")
              )
                continue;
              const imported = specifier.childForFieldName("name");
              const local = specifier.childForFieldName("alias") ?? imported;
              if (!local) continue;
              bound.add(local.text);
              if (native && imported?.text === "createRequire")
                factories.add(local.text);
            }
          }
        }
      }
    }

    const result = {
      require: !bound.has("require"),
      module: !bound.has("module"),
      exports: !bound.has("exports"),
    };
    // An immutable createRequire bridge from Node's module API is a real
    // require function even though it introduces a local binding.
    for (const node of declarations) {
      if (
        node.type !== "lexical_declaration" ||
        !node.children.some((child) => child.type === "const")
      )
        continue;
      for (const declaration of node.namedChildren) {
        const name = declaration.childForFieldName("name");
        const value = declaration.childForFieldName("value");
        if (
          name?.type !== "identifier" ||
          name.text !== "require" ||
          value?.type !== "call_expression"
        )
          continue;
        const callee = value.childForFieldName("function");
        const member = this.staticMember(callee);
        if (
          (callee?.type === "identifier" && factories.has(callee.text)) ||
          (member?.object.type === "identifier" &&
            nativeModules.has(member.object.text) &&
            member.name === "createRequire")
        ) {
          result.require = true;
        }
      }
    }
    return result;
  }

  private requireSource(node: TreeSitterNode | null): string | null {
    if (node?.type !== "call_expression") return null;
    const callee = node.childForFieldName("function");
    if (callee?.type !== "identifier" || callee.text !== "require") return null;
    const argument = node.childForFieldName("arguments")?.namedChildren[0];
    if (!argument || !["string", "template_string"].includes(argument.type)) {
      return null;
    }
    if (argument.namedChildren.some((child) => child.type === "template_substitution")) {
      return null;
    }
    return getStringValue(argument);
  }

  private bindingNames(node: TreeSitterNode | null): string[] {
    if (!node) return [];
    switch (node.type) {
      case "identifier":
      case "shorthand_property_identifier_pattern":
        return [node.text];
      case "pair_pattern":
        return this.bindingNames(node.childForFieldName("value"));
      case "assignment_pattern":
      case "object_assignment_pattern":
        return this.bindingNames(node.childForFieldName("left"));
      case "rest_pattern":
        return this.bindingNames(node.namedChildren[0] ?? null);
      case "object_pattern":
      case "array_pattern":
        return node.namedChildren.flatMap((child) => this.bindingNames(child));
      default:
        return [];
    }
  }

  private staticMember(
    node: TreeSitterNode | null,
  ): { object: TreeSitterNode; name: string } | null {
    if (!node) return null;
    const object = node.childForFieldName("object");
    if (!object) return null;
    if (node.type === "member_expression") {
      const property = node.childForFieldName("property");
      return property ? { object, name: property.text } : null;
    }
    if (node.type === "subscript_expression") {
      const index = node.childForFieldName("index");
      if (index?.type === "string") return { object, name: getStringValue(index) };
    }
    return null;
  }

  private isModuleExports(node: TreeSitterNode): boolean {
    const member = this.staticMember(node);
    return (
      member?.object.type === "identifier" &&
      member.object.text === "module" &&
      member.name === "exports"
    );
  }

  private extractCommonJsStatement(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    exportedNames: Set<string>,
    commonJs: CommonJsGlobals,
  ): void {
    const expression = node.namedChildren[0];
    if (!expression) return;
    const source = commonJs.require ? this.requireSource(expression) : null;
    if (source !== null) {
      imports.push({
        source,
        specifiers: [],
        lineNumber: node.startPosition.row + 1,
      });
      return;
    }
    if (expression.type !== "assignment_expression") return;
    const left = expression.childForFieldName("left");
    const right = expression.childForFieldName("right");
    const member = this.staticMember(left);
    if (!member || !right) return;
    const add = (name: string, isDefault = false) => {
      if (exportedNames.has(name)) return;
      exports.push({ name, isDefault, lineNumber: node.startPosition.row + 1 });
      exportedNames.add(name);
    };
    if (
      (commonJs.exports && member.object.type === "identifier" && member.object.text === "exports") ||
      (commonJs.module && this.isModuleExports(member.object))
    ) {
      add(member.name);
    } else if (commonJs.module && left && this.isModuleExports(left)) {
      if (right.type === "object") {
        for (const property of right.namedChildren) {
          if (property.type === "shorthand_property_identifier") add(property.text);
          else if (property.type === "pair" || property.type === "method_definition") {
            const key =
              property.childForFieldName("key") ??
              property.childForFieldName("name");
            if (!key) continue;
            if (key.type === "string") add(getStringValue(key));
            else if (["property_identifier", "identifier", "number"].includes(key.type)) {
              add(key.text);
            }
          }
        }
      } else {
        add(
          right.childForFieldName("name")?.text ??
            (right.type === "identifier" ? right.text : "default"),
          true,
        );
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

        case "abstract_class_declaration":
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
