import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

function isPrivate(name: string): boolean {
  return name.startsWith("_");
}

function extractAnnotationName(annotationNode: TreeSitterNode): string | null {
  const nameNode = findChild(annotationNode, "identifier");
  return nameNode?.text ?? null;
}

function findDescendant(node: TreeSitterNode, type: string): TreeSitterNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

function extractAnnotationArguments(
  annotationNode: TreeSitterNode,
): Record<string, string> | undefined {
  const argsNode = findChild(annotationNode, "arguments");
  if (!argsNode) return undefined;

  const args: Record<string, string> = {};
  for (const arg of findChildren(argsNode, "named_argument")) {
    const label = findChild(arg, "label");
    const keyNode = label ? findChild(label, "identifier") : null;
    if (!keyNode) continue;

    let valueText = "";
    let pastLabel = false;
    for (let i = 0; i < arg.childCount; i++) {
      const child = arg.child(i);
      if (!child) continue;
      if (child.type === "label") {
        pastLabel = true;
        continue;
      }
      if (pastLabel) {
        valueText += child.text;
      }
    }

    args[keyNode.text] = valueText;
  }

  return Object.keys(args).length > 0 ? args : undefined;
}

function parseAnnotations(nodes: TreeSitterNode[]): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];
  for (const node of nodes) {
    if (node.type !== "annotation") continue;
    const name = extractAnnotationName(node);
    if (!name) continue;

    const info: AnnotationInfo = { name };
    const args = extractAnnotationArguments(node);
    if (args) info.arguments = args;
    annotations.push(info);
  }
  return annotations;
}

function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];

  const params: string[] = [];
  const collectFrom = (node: TreeSitterNode) => {
    for (const param of findChildren(node, "formal_parameter")) {
      const identifiers = findChildren(param, "identifier");
      const nameNode = identifiers[identifiers.length - 1];
      if (nameNode) params.push(nameNode.text);
    }
    for (const optional of findChildren(node, "optional_formal_parameters")) {
      collectFrom(optional);
    }
  };

  collectFrom(paramsNode);
  return params;
}

function extractReturnTypeFromFunctionSignature(sig: TreeSitterNode): string | undefined {
  const skipTypes = new Set([
    "identifier",
    "formal_parameter_list",
    "(",
    ")",
    ",",
    "required",
    "covariant",
    "external",
    "async",
    "sync",
    "generator",
  ]);

  for (let i = 0; i < sig.childCount; i++) {
    const child = sig.child(i);
    if (!child) continue;
    if (child.type === "identifier") break;
    if (skipTypes.has(child.type)) continue;
    if (child.type === "void_type" || child.type.endsWith("_type") || child.type === "type_identifier") {
      return child.text;
    }
    if (
      child.type === "nullable_type" ||
      child.type === "type_arguments" ||
      child.type === "function_type"
    ) {
      return child.text;
    }
  }

  return undefined;
}

function extractMethodName(methodSig: TreeSitterNode): string | null {
  const fnSig = findChild(methodSig, "function_signature");
  if (fnSig) {
    const nameNode = findChild(fnSig, "identifier");
    return nameNode?.text ?? null;
  }

  const getterSig = findChild(methodSig, "getter_signature");
  if (getterSig) {
    const nameNode = findChild(getterSig, "identifier");
    return nameNode?.text ?? null;
  }

  const setterSig = findChild(methodSig, "setter_signature");
  if (setterSig) {
    const nameNode = findChild(setterSig, "identifier");
    return nameNode?.text ?? null;
  }

  const factorySig = findChild(methodSig, "factory_constructor_signature");
  if (factorySig) {
    const identifiers = findChildren(factorySig, "identifier");
    if (identifiers.length >= 2) {
      return `${identifiers[0].text}.${identifiers[1].text}`;
    }
    if (identifiers.length === 1) {
      return identifiers[0].text;
    }
  }

  return null;
}

function extractFunctionSignatureName(sig: TreeSitterNode): string | null {
  const nameNode = findChild(sig, "identifier");
  return nameNode?.text ?? null;
}

function extractDeclarationFunctionName(decl: TreeSitterNode): string | null {
  const fnSig = findChild(decl, "function_signature");
  if (fnSig) return extractFunctionSignatureName(fnSig);

  const ctorSig = findChild(decl, "constructor_signature");
  if (ctorSig) {
    const identifiers = findChildren(ctorSig, "identifier");
    if (identifiers.length >= 2) {
      return `${identifiers[0].text}.${identifiers[1].text}`;
    }
    if (identifiers.length === 1) {
      return identifiers[0].text;
    }
  }

  return null;
}

function extractFieldInfo(decl: TreeSitterNode): { name: string; type?: string } | null {
  const idList = findChild(decl, "initialized_identifier_list");
  if (!idList) return null;

  const initialized = findChild(idList, "initialized_identifier");
  if (!initialized) return null;

  const nameNode = findChild(initialized, "identifier");
  if (!nameNode) return null;

  const stopTypes = new Set([
    "initialized_identifier_list",
    "initialized_identifier",
    "identifier",
    "=",
    "final_builtin",
    "const_builtin",
    "var_builtin",
    "late",
    "static",
    "external",
    ";",
  ]);

  let typeText = "";
  for (let i = 0; i < decl.childCount; i++) {
    const child = decl.child(i);
    if (!child || stopTypes.has(child.type)) {
      if (child?.type === "initialized_identifier_list") break;
      continue;
    }
    typeText += child.text;
  }

  return {
    name: nameNode.text,
    type: typeText || undefined,
  };
}

function extractInheritance(node: TreeSitterNode): {
  superclass?: string;
  interfaces: string[];
} {
  const interfaces: string[] = [];
  let superclass: string | undefined;

  const superclassNode = findChild(node, "superclass");
  if (superclassNode) {
    const mixinsNode = findChild(superclassNode, "mixins");
    for (const typeId of findChildren(superclassNode, "type_identifier")) {
      if (mixinsNode && isDescendantOf(typeId, mixinsNode)) continue;
      superclass = typeId.text;
      break;
    }

    if (mixinsNode) {
      for (const typeId of findChildren(mixinsNode, "type_identifier")) {
        interfaces.push(typeId.text);
      }
    }
  }

  const interfacesNode = findChild(node, "interfaces");
  if (interfacesNode) {
    for (const typeId of findChildren(interfacesNode, "type_identifier")) {
      interfaces.push(typeId.text);
    }
  }

  return { superclass, interfaces };
}

function isDescendantOf(node: TreeSitterNode, ancestor: TreeSitterNode): boolean {
  let current: TreeSitterNode | null = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function extractUriString(node: TreeSitterNode): string {
  return node.text.replace(/^['"]|['"]$/g, "");
}

function extractCombinatorSpecifiers(combinator: TreeSitterNode | null): string[] | null {
  if (!combinator) return null;

  const keyword = combinator.child(0)?.text;
  if (keyword === "show" || keyword === "hide") {
    return findChildren(combinator, "identifier").map((id) => id.text);
  }

  return null;
}

function hasCallInExpression(node: TreeSitterNode): boolean {
  if (node.type === "argument_part") return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasCallInExpression(child)) return true;
  }
  return false;
}

function extractCalleeFromExpressionStatement(node: TreeSitterNode): string | null {
  if (node.type !== "expression_statement") return null;
  if (!hasCallInExpression(node)) return null;

  const parts: string[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.type === ";") continue;

    if (child.type === "identifier" || child.type === "type_identifier") {
      parts.push(child.text);
    } else if (child.type === "this") {
      parts.push("this");
    } else if (child.type === "super") {
      parts.push("super");
    } else if (child.type === "unconditional_assignable_selector") {
      const id = findChild(child, "identifier");
      if (id) parts.push(id.text);
    } else if (child.type === "selector") {
      const assignable = findChild(child, "unconditional_assignable_selector");
      if (assignable) {
        const id = findChild(assignable, "identifier");
        if (id) parts.push(id.text);
      }
    }
  }

  return parts.length > 0 ? parts.join(".") : null;
}

function addExport(
  exports: StructuralAnalysis["exports"],
  name: string,
  lineNumber: number,
): void {
  if (!isPrivate(name)) {
    exports.push({ name, lineNumber });
  }
}

export class DartExtractor implements LanguageExtractor {
  readonly languageIds = ["dart"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "import_or_export":
          this.extractImportOrExport(node, imports, exports);
          break;
        case "class_definition":
          this.extractClassDefinition(node, functions, classes, exports);
          break;
        case "mixin_declaration":
          this.extractMixinDeclaration(node, functions, classes, exports);
          break;
        case "extension_declaration":
          this.extractExtensionDeclaration(node, functions, classes, exports);
          break;
        case "enum_declaration":
          this.extractEnumDeclaration(node, classes, exports);
          break;
        case "function_signature":
          this.extractTopLevelFunction(node, functions, exports);
          break;
        case "final_builtin":
        case "const_builtin":
        case "var_builtin":
        case "late": {
          for (let j = i + 1; j < Math.min(i + 4, rootNode.childCount); j++) {
            const sibling = rootNode.child(j);
            if (sibling?.type === "static_final_declaration_list") {
              this.extractTopLevelVariable(sibling, exports);
              break;
            }
          }
          break;
        }
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      if (node.type === "function_body") {
        const name = this.extractFunctionNameFromBody(node);
        if (name) {
          functionStack.push(name);
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walkForCalls(child);
          }
          functionStack.pop();
          return;
        }
      }

      if (node.type === "expression_statement" && functionStack.length > 0) {
        const callee = extractCalleeFromExpressionStatement(node);
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
        if (child) walkForCalls(child);
      }
    };

    walkForCalls(rootNode);
    return entries;
  }

  private extractFunctionNameFromBody(body: TreeSitterNode): string | null {
    const parent = body.parent;
    if (!parent) return null;

    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (!child || child.id !== body.id) continue;

      for (let j = i - 1; j >= 0; j--) {
        const sibling = parent.child(j);
        if (!sibling) continue;

        if (sibling.type === "method_signature") {
          return extractMethodName(sibling);
        }
        if (sibling.type === "function_signature") {
          return extractFunctionSignatureName(sibling);
        }
        if (sibling.type !== "annotation") {
          break;
        }
      }
      break;
    }

    return null;
  }

  private extractImportOrExport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const libraryImport = findChild(node, "library_import");
    if (libraryImport) {
      const spec = findChild(libraryImport, "import_specification");
      if (spec) this.extractImportSpecification(spec, imports);
      return;
    }

    const libraryExport = findChild(node, "library_export");
    if (!libraryExport) return;

    const uriNode = findDescendant(libraryExport, "string_literal");
    const combinator = findChild(libraryExport, "combinator");
    const specifiers = extractCombinatorSpecifiers(combinator);
    const lineNumber = node.startPosition.row + 1;

    if (specifiers) {
      for (const name of specifiers) {
        addExport(exports, name, lineNumber);
      }
    } else if (uriNode) {
      addExport(exports, extractUriString(uriNode), lineNumber);
    }
  }

  private extractImportSpecification(
    spec: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const uriNode = findDescendant(spec, "string_literal");
    if (!uriNode) return;

    const combinator = findChild(spec, "combinator");
    const specifiers = extractCombinatorSpecifiers(combinator);

    imports.push({
      source: extractUriString(uriNode),
      specifiers: specifiers ?? ["*"],
      lineNumber: spec.startPosition.row + 1,
    });
  }

  private extractTopLevelVariable(
    declList: TreeSitterNode,
    exports: StructuralAnalysis["exports"],
  ): void {
    for (const decl of findChildren(declList, "static_final_declaration")) {
      const nameNode = findChild(decl, "identifier");
      if (nameNode) {
        addExport(exports, nameNode.text, declList.startPosition.row + 1);
      }
    }
  }

  private extractTopLevelFunction(
    sig: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractFunctionSignatureName(sig);
    if (!name) return;

    const paramsNode = findChild(sig, "formal_parameter_list");
    const params = extractParams(paramsNode);
    const returnType = extractReturnTypeFromFunctionSignature(sig);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name,
      lineRange: [sig.startPosition.row + 1, sig.endPosition.row + 1],
      params,
      returnType,
    };
    functions.push(fnEntry);
    addExport(exports, name, sig.startPosition.row + 1);
  }

  private extractClassLike(
    name: string,
    node: TreeSitterNode,
    body: TreeSitterNode | null,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    annotations: AnnotationInfo[],
    inheritance?: { superclass?: string; interfaces: string[] },
  ): void {
    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    if (body) {
      this.extractBodyMembers(body, methods, properties, functions, exports, typedProperties);
    }

    const classEntry: StructuralAnalysis["classes"][0] = {
      name,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (inheritance?.superclass) classEntry.superclass = inheritance.superclass;
    if (inheritance && inheritance.interfaces.length > 0) {
      classEntry.interfaces = inheritance.interfaces;
    }
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

    addExport(exports, name, node.startPosition.row + 1);
  }

  private extractClassDefinition(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const annotations = parseAnnotations(findChildren(node, "annotation"));
    const inheritance = extractInheritance(node);
    const body = findChild(node, "class_body");

    this.extractClassLike(
      nameNode.text,
      node,
      body,
      functions,
      classes,
      exports,
      annotations,
      inheritance,
    );
  }

  private extractMixinDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const body = findChild(node, "class_body");
    this.extractClassLike(
      nameNode.text,
      node,
      body,
      functions,
      classes,
      exports,
      [],
    );
  }

  private extractExtensionDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const body = findChild(node, "extension_body");
    this.extractClassLike(
      nameNode.text,
      node,
      body,
      functions,
      classes,
      exports,
      [],
    );
  }

  private extractEnumDeclaration(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = findChild(node, "identifier");
    if (!nameNode) return;

    const properties = findChildren(findChild(node, "enum_body") ?? node, "enum_constant")
      .map((constant) => findChild(constant, "identifier")?.text)
      .filter((name): name is string => !!name);

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
    };
    classes.push(classEntry);
    addExport(exports, nameNode.text, node.startPosition.row + 1);
  }

  private extractBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    typedProperties: PropertyInfo[],
  ): void {
    const pendingAnnotations: TreeSitterNode[] = [];

    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      if (child.type === "annotation") {
        pendingAnnotations.push(child);
        continue;
      }

      if (child.type === "method_signature") {
        this.extractMethod(
          child,
          pendingAnnotations,
          methods,
          functions,
          exports,
        );
        pendingAnnotations.length = 0;
        continue;
      }

      if (child.type === "declaration") {
        this.extractDeclaration(
          child,
          pendingAnnotations,
          methods,
          properties,
          functions,
          exports,
          typedProperties,
        );
        pendingAnnotations.length = 0;
        continue;
      }

      if (child.type !== "{" && child.type !== "}" && child.type !== ";") {
        pendingAnnotations.length = 0;
      }
    }
  }

  private extractMethod(
    methodSig: TreeSitterNode,
    pendingAnnotations: TreeSitterNode[],
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = extractMethodName(methodSig);
    if (!name) return;

    const fnSig =
      findChild(methodSig, "function_signature") ??
      findChild(methodSig, "getter_signature") ??
      findChild(methodSig, "setter_signature") ??
      findChild(methodSig, "factory_constructor_signature");

    const paramsNode = fnSig ? findChild(fnSig, "formal_parameter_list") : null;
    const params = extractParams(paramsNode);
    let returnType: string | undefined;
    if (fnSig?.type === "function_signature") {
      returnType = extractReturnTypeFromFunctionSignature(fnSig);
    } else if (fnSig?.type === "getter_signature") {
      for (let j = 0; j < fnSig.childCount; j++) {
        const typeChild = fnSig.child(j);
        if (
          typeChild &&
          (typeChild.type === "type_identifier" ||
            typeChild.type === "void_type" ||
            typeChild.type.endsWith("_type"))
        ) {
          returnType = typeChild.text;
          break;
        }
      }
    }

    const annotations = parseAnnotations(pendingAnnotations);

    methods.push(name);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name,
      lineRange: [methodSig.startPosition.row + 1, methodSig.endPosition.row + 1],
      params,
      returnType,
    };
    if (annotations.length > 0) fnEntry.annotations = annotations;
    functions.push(fnEntry);
    addExport(exports, name, methodSig.startPosition.row + 1);
  }

  private extractDeclaration(
    decl: TreeSitterNode,
    pendingAnnotations: TreeSitterNode[],
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    typedProperties: PropertyInfo[],
  ): void {
    const fnSig = findChild(decl, "function_signature");
    if (fnSig) {
      const name = extractFunctionSignatureName(fnSig);
      if (!name) return;

      const paramsNode = findChild(fnSig, "formal_parameter_list");
      const params = extractParams(paramsNode);
      const returnType = extractReturnTypeFromFunctionSignature(fnSig);
      const annotations = parseAnnotations(pendingAnnotations);

      methods.push(name);

      const fnEntry: StructuralAnalysis["functions"][0] = {
        name,
        lineRange: [decl.startPosition.row + 1, decl.endPosition.row + 1],
        params,
        returnType,
      };
      if (annotations.length > 0) fnEntry.annotations = annotations;
      functions.push(fnEntry);
      addExport(exports, name, decl.startPosition.row + 1);
      return;
    }

    const ctorSig = findChild(decl, "constructor_signature");
    if (ctorSig) {
      const name = extractDeclarationFunctionName(decl);
      if (!name) return;

      const paramsNode = findChild(ctorSig, "formal_parameter_list");
      const params = extractParams(paramsNode);
      const annotations = parseAnnotations(pendingAnnotations);

      methods.push(name);

      const fnEntry: StructuralAnalysis["functions"][0] = {
        name,
        lineRange: [decl.startPosition.row + 1, decl.endPosition.row + 1],
        params,
      };
      if (annotations.length > 0) fnEntry.annotations = annotations;
      functions.push(fnEntry);
      addExport(exports, name, decl.startPosition.row + 1);
      return;
    }

    const field = extractFieldInfo(decl);
    if (!field) return;

    properties.push(field.name);

    const prop: PropertyInfo = { name: field.name };
    if (field.type) prop.type = field.type;
    const annotations = parseAnnotations(pendingAnnotations);
    if (annotations.length > 0) prop.annotations = annotations;
    typedProperties.push(prop);
    addExport(exports, field.name, decl.startPosition.row + 1);
  }
}
