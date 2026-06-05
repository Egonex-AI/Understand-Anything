import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names and types from a Java `formal_parameters` node.
 *
 * Each `formal_parameter` child has a `name` field (identifier) and a `type` field.
 */
function extractParams(
  paramsNode: TreeSitterNode | null,
): Array<{ name: string; type: string }> {
  if (!paramsNode) return [];
  const params: Array<{ name: string; type: string }> = [];

  const declarations = findChildren(paramsNode, "formal_parameter");
  for (const decl of declarations) {
    const nameNode = decl.childForFieldName("name");
    const typeNode = decl.childForFieldName("type");
    if (nameNode) {
      params.push({
        name: nameNode.text,
        type: typeNode?.text ?? "unknown",
      });
    }
  }

  // Also handle spread_parameter (varargs): e.g. `String... args`
  const spreadParams = findChildren(paramsNode, "spread_parameter");
  for (const spread of spreadParams) {
    const nameNode = spread.childForFieldName("name");
    const typeNode = spread.childForFieldName("type");
    if (nameNode) {
      params.push({
        name: nameNode.text,
        type: typeNode?.text ?? "unknown",
      });
    }
  }

  return params;
}

/**
 * Extract the return type text from a method_declaration node.
 *
 * In tree-sitter-java, the return type is the `type` named field on method_declaration.
 * It can be a type_identifier, generic_type, void_type, integral_type, etc.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("type");
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Check if a node has a `modifiers` child containing a specific modifier keyword.
 */
function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (child && child.text === modifier) return true;
  }
  return false;
}

/**
 * Extract annotations from a `modifiers` node.
 *
 * In tree-sitter-java, modifiers can contain `marker_annotation` (no args)
 * and `annotation` (with args). Both have a `name` field.
 */
function extractAnnotations(node: TreeSitterNode): AnnotationInfo[] {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return [];
  const annotations: AnnotationInfo[] = [];
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child) continue;
    if (child.type === "marker_annotation") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) annotations.push({ name: nameNode.text });
    } else if (child.type === "annotation") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const info: AnnotationInfo = { name: nameNode.text };
      const argsNode = child.childForFieldName("arguments");
      if (argsNode) {
        const args: Record<string, string> = {};
        for (let j = 0; j < argsNode.childCount; j++) {
          const arg = argsNode.child(j);
          if (!arg) continue;
          if (arg.type === "element_value_pair") {
            const key = arg.childForFieldName("key");
            const value = arg.childForFieldName("value");
            if (key && value) {
              args[key.text] = value.text.replace(/^"|"$/g, "");
            }
          } else if (arg.type !== "(" && arg.type !== ")" && arg.type !== ",") {
            args["value"] = arg.text.replace(/^"|"$/g, "");
          }
        }
        if (Object.keys(args).length > 0) info.arguments = args;
      }
      annotations.push(info);
    }
  }
  return annotations;
}

/**
 * Extract the superclass name from a class_declaration's `superclass` field.
 */
function extractSuperclass(node: TreeSitterNode): string | undefined {
  const superNode = node.childForFieldName("superclass");
  if (!superNode) return undefined;
  const typeNode = findChild(superNode, "type_identifier") ?? findChild(superNode, "generic_type");
  return typeNode?.text;
}

/**
 * Extract implemented interface names from a class_declaration's `interfaces` field
 * (which maps to a `super_interfaces` node), or extended interfaces from an
 * interface_declaration's `extends_interfaces` child node.
 *
 * In tree-sitter-java:
 * - class: `childForFieldName("interfaces")` → `super_interfaces` node
 * - interface: `extends_interfaces` is a child node type, not a named field
 * Both contain a `type_list` with `type_identifier` children.
 */
function extractInterfaces(node: TreeSitterNode): string[] {
  const interfacesNode =
    node.childForFieldName("interfaces") ??
    findChild(node, "extends_interfaces");
  if (!interfacesNode) return [];
  const result: string[] = [];
  for (let i = 0; i < interfacesNode.childCount; i++) {
    const child = interfacesNode.child(i);
    if (!child) continue;
    if (child.type === "type_identifier" || child.type === "generic_type") {
      result.push(child.text);
    } else if (child.type === "type_list") {
      for (let j = 0; j < child.childCount; j++) {
        const typeChild = child.child(j);
        if (typeChild && (typeChild.type === "type_identifier" || typeChild.type === "generic_type")) {
          result.push(typeChild.text);
        }
      }
    }
  }
  return result;
}

/**
 * Extract the full dotted path from a scoped_identifier node.
 *
 * Java's scoped_identifier nests recursively:
 * `java.util.List` is scoped_identifier(scope: scoped_identifier(scope: identifier "java",
 * name: identifier "util"), name: identifier "List")
 *
 * This returns the full path as a dotted string.
 */
function extractScopedIdentifierPath(node: TreeSitterNode): string {
  return node.text;
}

/**
 * Get the last component of a dotted import path.
 * e.g. "java.util.List" -> "List"
 */
function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

/**
 * Java extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles classes, interfaces, methods, constructors, fields, imports,
 * visibility-based exports, and call graphs for Java source code.
 *
 * Java-specific mapping decisions:
 * - Classes and interfaces are mapped to the `classes` array.
 * - Constructors are mapped to the `functions` array (named after the class).
 * - Methods (including interface method signatures) are listed in the
 *   containing class/interface's `methods` array and also in the `functions` array.
 * - Exports are determined by the `public` modifier on classes, methods,
 *   constructors, and fields.
 * - Fields are extracted as `properties` from `field_declaration` nodes.
 */
export class JavaExtractor implements LanguageExtractor {
  readonly languageIds = ["java"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;

        case "class_declaration":
          this.extractClass(node, functions, classes, exports);
          break;

        case "interface_declaration":
          this.extractInterface(node, functions, classes, exports);
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

      // Extract method invocations: e.g. fetchFromDb(limit), System.out.println(msg)
      if (node.type === "method_invocation") {
        if (functionStack.length > 0) {
          const callee = this.extractMethodInvocationName(node);
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
          const typeNode = node.childForFieldName("type");
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
   * Extract the callee name from a method_invocation node.
   *
   * Handles:
   * - Plain method call: `fetchFromDb(limit)` -> "fetchFromDb"
   * - Qualified call: `System.out.println(msg)` -> "System.out.println"
   */
  private extractMethodInvocationName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return null;

    const objectNode = node.childForFieldName("object");
    if (objectNode) {
      return `${objectNode.text}.${nameNode.text}`;
    }

    return nameNode.text;
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Check for asterisk (wildcard) import: `import java.util.*;`
    const hasAsterisk = findChild(node, "asterisk") !== null;

    const scopedId = findChild(node, "scoped_identifier");
    if (!scopedId) return;

    const fullPath = extractScopedIdentifierPath(scopedId);

    if (hasAsterisk) {
      // Wildcard import: source is the full scope, specifier is "*"
      imports.push({
        source: fullPath,
        specifiers: ["*"],
        lineNumber: node.startPosition.row + 1,
      });
    } else {
      // Regular import: source is the full path, specifier is the last component
      imports.push({
        source: fullPath,
        specifiers: [lastComponent(fullPath)],
        lineNumber: node.startPosition.row + 1,
      });
    }
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
    const typedProperties: PropertyInfo[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      this.extractClassBodyMembers(
        body,
        methods,
        properties,
        functions,
        exports,
        typedProperties,
      );
    }

    const annotations = extractAnnotations(node);
    const superclass = extractSuperclass(node);
    const interfaces = extractInterfaces(node);

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (superclass) classEntry.superclass = superclass;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

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
      const methodNodes = findChildren(body, "method_declaration");
      for (const methodNode of methodNodes) {
        const methNameNode = methodNode.childForFieldName("name");
        if (methNameNode) {
          methods.push(methNameNode.text);
        }
      }

      const fields = findChildren(body, "constant_declaration");
      for (const field of fields) {
        const declarators = findChildren(field, "variable_declarator");
        for (const decl of declarators) {
          const declName = decl.childForFieldName("name");
          if (declName) {
            properties.push(declName.text);
          }
        }
      }
    }

    const annotations = extractAnnotations(node);
    const interfaces = extractInterfaces(node);

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    classes.push(classEntry);

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractClassBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    typedProperties?: PropertyInfo[],
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

        case "field_declaration":
          this.extractField(child, properties, exports, typedProperties);
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
    const annotations = extractAnnotations(node);

    methods.push(nameNode.text);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    };
    if (annotations.length > 0) fnEntry.annotations = annotations;
    functions.push(fnEntry);

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

  private extractField(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    typedProperties?: PropertyInfo[],
  ): void {
    const typeNode = node.childForFieldName("type");
    const fieldType = typeNode?.text;
    const fieldAnnotations = extractAnnotations(node);

    const declarators = findChildren(node, "variable_declarator");
    for (const decl of declarators) {
      const nameNode = decl.childForFieldName("name");
      if (nameNode) {
        properties.push(nameNode.text);

        if (typedProperties) {
          const prop: PropertyInfo = { name: nameNode.text };
          if (fieldType) prop.type = fieldType;
          if (fieldAnnotations.length > 0) prop.annotations = fieldAnnotations;
          typedProperties.push(prop);
        }

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
