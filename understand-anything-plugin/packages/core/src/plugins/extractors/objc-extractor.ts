import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Build an Objective-C selector from a method_declaration or method_definition node.
 *
 * e.g. `- (void)insertObject:(id)obj atIndex:(NSUInteger)idx` → `insertObject:atIndex:`
 * e.g. `- (void)bark` → `bark`
 */
function extractSelector(node: TreeSitterNode): string {
  const parts: string[] = [];
  let seenMethodType = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "method_type") {
      seenMethodType = true;
      continue;
    }
    if (!seenMethodType) continue;

    if (child.type === "identifier") {
      parts.push(child.text);
    } else if (child.type === "method_parameter") {
      if (parts.length > 0) {
        parts[parts.length - 1] += ":";
      }
    } else if (child.type === ";" || child.type === "compound_statement") {
      break;
    }
  }

  return parts.join("");
}

/** Extract parameter names from method_parameter children. */
function extractMethodParams(node: TreeSitterNode): string[] {
  const params: string[] = [];
  for (const param of findChildren(node, "method_parameter")) {
    const nameNode = findChild(param, "identifier");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

/** Extract the return type from a method_type child. */
function extractMethodReturnType(node: TreeSitterNode): string | undefined {
  const methodType = findChild(node, "method_type");
  if (!methodType) return undefined;
  const typeName = findChild(methodType, "type_name");
  return typeName?.text;
}

/** Extract protocol names from a parameterized_arguments node on @interface. */
function extractProtocols(node: TreeSitterNode): string[] {
  const argsNode = findChild(node, "parameterized_arguments");
  if (!argsNode) return [];

  const protocols: string[] = [];
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (!child || child.type !== "type_name") continue;
    const typeId = findChild(child, "type_identifier");
    if (typeId) protocols.push(typeId.text);
  }
  return protocols;
}

/** Build the display name for a class_interface, including category if present. */
function extractInterfaceName(node: TreeSitterNode): string | null {
  const className = findChild(node, "identifier");
  if (!className) return null;

  const category = node.childForFieldName("category");
  if (category) {
    return `${className.text}(${category.text})`;
  }
  return className.text;
}

/** Extract @property attribute names as AnnotationInfo entries. */
function extractPropertyAttributes(node: TreeSitterNode): AnnotationInfo[] {
  const attrsNode = findChild(node, "property_attributes_declaration");
  if (!attrsNode) return [];

  const annotations: AnnotationInfo[] = [];
  for (const attr of findChildren(attrsNode, "property_attribute")) {
    const nameNode = findChild(attr, "identifier");
    if (nameNode) annotations.push({ name: nameNode.text });
  }
  return annotations;
}

/** Extract the property name from a property_declaration node. */
function extractPropertyName(node: TreeSitterNode): string | null {
  const structDecl = findChild(node, "struct_declaration");
  if (!structDecl) return null;

  const declarator = findChild(structDecl, "struct_declarator");
  if (!declarator) return null;

  const directName = findChild(declarator, "identifier");
  if (directName) return directName.text;

  const pointerDecl = findChild(declarator, "pointer_declarator");
  if (pointerDecl) {
    const nameNode = findChild(pointerDecl, "identifier");
    if (nameNode) return nameNode.text;
  }

  return null;
}

/** Extract the property type from a property_declaration node. */
function extractPropertyType(node: TreeSitterNode): string | undefined {
  const structDecl = findChild(node, "struct_declaration");
  if (!structDecl) return undefined;

  const typeId = findChild(structDecl, "type_identifier");
  if (!typeId) return undefined;

  const declarator = findChild(structDecl, "struct_declarator");
  const hasPointer =
    declarator !== null && findChild(declarator, "pointer_declarator") !== null;

  return hasPointer ? `${typeId.text} *` : typeId.text;
}

/** Build a selector string from a message_expression node. */
function extractMessageSelector(node: TreeSitterNode): string {
  const receiver = node.childForFieldName("receiver");
  const parts: string[] = [];
  let state: "receiver" | "selector" | "after_selector" | "argument" = "receiver";

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "[") continue;
    if (child.type === "]") break;

    if (child.type === "identifier") {
      if (state === "receiver") {
        if (receiver && child.text === receiver.text) {
          state = "selector";
        }
        continue;
      }
      if (state === "selector") {
        parts.push(child.text);
        state = "after_selector";
        continue;
      }
      if (state === "argument") {
        state = "selector";
      }
      continue;
    }

    if (child.type === ":" && parts.length > 0 && state === "after_selector") {
      parts[parts.length - 1] += ":";
      state = "argument";
    }
  }

  return parts.join("");
}

/**
 * Objective-C extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles @interface, @implementation, @protocol, @property, #import,
 * selector-based method naming, categories, and message-passing call graphs.
 */
export class ObjcExtractor implements LanguageExtractor {
  readonly languageIds = ["objc"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const classIndex = new Map<string, StructuralAnalysis["classes"][0]>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "preproc_include":
          this.extractImport(node, imports);
          break;

        case "class_interface":
          this.extractClassInterface(
            node,
            functions,
            classes,
            exports,
            classIndex,
          );
          break;

        case "class_implementation":
          this.extractClassImplementation(node, functions, classes, classIndex);
          break;

        case "protocol_declaration":
          this.extractProtocol(node, functions, classes, exports);
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

      if (node.type === "method_definition") {
        const selector = extractSelector(node);
        if (selector) {
          functionStack.push(selector);
          pushedName = true;
        }
      }

      if (node.type === "message_expression" && functionStack.length > 0) {
        const receiver = node.childForFieldName("receiver");
        const selector = extractMessageSelector(node);
        const callee = receiver ? `${receiver.text}.${selector}` : selector;

        entries.push({
          caller: functionStack[functionStack.length - 1],
          callee,
          lineNumber: node.startPosition.row + 1,
        });
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

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const pathNode = node.childForFieldName("path");
    if (!pathNode) return;

    let source: string;
    if (pathNode.type === "system_lib_string") {
      source = pathNode.text.replace(/^<|>$/g, "");
    } else if (pathNode.type === "string_literal") {
      const content = findChild(pathNode, "string_content");
      source = content ? content.text : pathNode.text.replace(/^"|"$/g, "");
    } else {
      source = pathNode.text;
    }

    imports.push({
      source,
      specifiers: [source],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractMethod(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports?: StructuralAnalysis["exports"],
  ): void {
    const selector = extractSelector(node);
    if (!selector) return;

    const params = extractMethodParams(node);
    const returnType = extractMethodReturnType(node);

    methods.push(selector);

    functions.push({
      name: selector,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });

    if (exports) {
      exports.push({
        name: selector,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractProperty(
    node: TreeSitterNode,
    properties: string[],
    typedProperties: PropertyInfo[],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractPropertyName(node);
    if (!name) return;

    properties.push(name);

    const prop: PropertyInfo = { name };
    const type = extractPropertyType(node);
    if (type) prop.type = type;

    const annotations = extractPropertyAttributes(node);
    if (annotations.length > 0) prop.annotations = annotations;

    typedProperties.push(prop);

    exports.push({
      name,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private getOrCreateClass(
    name: string,
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    classIndex: Map<string, StructuralAnalysis["classes"][0]>,
  ): StructuralAnalysis["classes"][0] {
    const existing = classIndex.get(name);
    if (existing) return existing;

    const classEntry: StructuralAnalysis["classes"][0] = {
      name,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods: [],
      properties: [],
    };
    classes.push(classEntry);
    classIndex.set(name, classEntry);
    return classEntry;
  }

  private extractClassInterface(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    classIndex: Map<string, StructuralAnalysis["classes"][0]>,
  ): void {
    const name = extractInterfaceName(node);
    if (!name) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "method_declaration") {
        this.extractMethod(child, methods, functions, exports);
      } else if (child.type === "property_declaration") {
        this.extractProperty(child, properties, typedProperties, exports);
      }
    }

    const superclass = node.childForFieldName("superclass")?.text;
    const interfaces = extractProtocols(node);

    const classEntry = this.getOrCreateClass(
      name,
      node,
      classes,
      classIndex,
    );
    classEntry.methods = methods;
    classEntry.properties = properties;
    classEntry.lineRange = [
      node.startPosition.row + 1,
      node.endPosition.row + 1,
    ];
    if (superclass) classEntry.superclass = superclass;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;

    exports.push({
      name,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClassImplementation(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    classIndex: Map<string, StructuralAnalysis["classes"][0]>,
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const classEntry = this.getOrCreateClass(
      nameNode.text,
      node,
      classes,
      classIndex,
    );
    classEntry.lineRange = [
      Math.min(classEntry.lineRange[0], node.startPosition.row + 1),
      node.endPosition.row + 1,
    ];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child || child.type !== "implementation_definition") continue;

      for (const methodDef of findChildren(child, "method_definition")) {
        const selector = extractSelector(methodDef);
        if (selector && !classEntry.methods.includes(selector)) {
          classEntry.methods.push(selector);
        }
        this.extractMethod(methodDef, [], functions);
      }
    }
  }

  private extractProtocol(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const methods: string[] = [];

    for (const methodDecl of findChildren(node, "method_declaration")) {
      this.extractMethod(methodDecl, methods, functions, exports);
    }

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties: [],
    };
    classes.push(classEntry);

    exports.push({
      name: nameNode.text,
      lineNumber: node.startPosition.row + 1,
    });
  }
}
