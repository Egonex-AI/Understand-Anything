import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

const TYPE_DECLARATION_KINDS = new Set(["class", "struct", "enum", "actor", "extension"]);
const WRAPPER_NODES = new Set(["ERROR", "if_config_declaration"]);

function lineRange(node: TreeSitterNode): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function namedChildren(node: TreeSitterNode): TreeSitterNode[] {
  const children: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed) children.push(child);
  }
  return children;
}

function childrenForFieldName(node: TreeSitterNode, fieldName: string): TreeSitterNode[] {
  const children: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && node.fieldNameForChild(i) === fieldName) {
      children.push(child);
    }
  }
  return children;
}

function collectDescendants(
  node: TreeSitterNode,
  predicate: (node: TreeSitterNode) => boolean,
  options: { stopAt?: Set<string> } = {},
): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];

  const walk = (current: TreeSitterNode) => {
    if (current !== node && options.stopAt?.has(current.type)) return;
    if (predicate(current)) result.push(current);
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i);
      if (child) walk(child);
    }
  };

  walk(node);
  return result;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function declarationKind(node: TreeSitterNode): string | null {
  const field = node.childForFieldName("declaration_kind");
  if (field) return field.text;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && TYPE_DECLARATION_KINDS.has(child.text)) return child.text;
  }

  return null;
}

function isPrivateOrFileprivate(node: TreeSitterNode): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;

  for (const modifier of namedChildren(modifiers)) {
    if (modifier.type !== "visibility_modifier") continue;
    const normalized = normalizeWhitespace(modifier.text);
    if (normalized === "private" || normalized === "fileprivate") return true;
  }

  return false;
}

function isExported(node: TreeSitterNode, parentExported: boolean): boolean {
  return parentExported && !isPrivateOrFileprivate(node);
}

function findFirstIdentifier(node: TreeSitterNode): TreeSitterNode | null {
  if (
    node.type === "simple_identifier" ||
    node.type === "type_identifier" ||
    node.type === "identifier"
  ) {
    return node;
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = findFirstIdentifier(child);
    if (found) return found;
  }

  return null;
}

function findLastSimpleIdentifier(node: TreeSitterNode): TreeSitterNode | null {
  let found: TreeSitterNode | null = null;

  const walk = (current: TreeSitterNode) => {
    if (current.type === "simple_identifier" && current.text !== "_") {
      found = current;
    }
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i);
      if (child) walk(child);
    }
  };

  walk(node);
  return found;
}

function extractCallableName(node: TreeSitterNode): string | null {
  const nameNode = node.childForFieldName("name") ?? findFirstIdentifier(node);
  return nameNode?.text ?? null;
}

function extractTypeName(node: TreeSitterNode): string | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  return normalizeWhitespace(nameNode.text);
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.text !== "->") continue;

    for (let j = i + 1; j < node.childCount; j++) {
      const candidate = node.child(j);
      if (!candidate?.isNamed) continue;
      if (candidate.type === "function_body" || candidate.type === "computed_property") {
        return undefined;
      }
      return normalizeWhitespace(candidate.text);
    }
  }

  return undefined;
}

function extractParams(node: TreeSitterNode): string[] {
  const params: string[] = [];

  for (const param of namedChildren(node)) {
    if (param.type !== "parameter") continue;

    const nameField = param.childForFieldName("name");
    const nameNode = nameField ? findLastSimpleIdentifier(nameField) : findLastSimpleIdentifier(param);
    if (nameNode && nameNode.text !== "_") params.push(nameNode.text);
  }

  return params;
}

function extractPatternName(pattern: TreeSitterNode): string | null {
  const bound = collectDescendants(pattern, (node) => {
    if (node.type !== "simple_identifier") return false;
    const parent = node.parent;
    if (!parent) return true;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (child && child.startIndex === node.startIndex && child.endIndex === node.endIndex) {
        return parent.fieldNameForChild(i) === "bound_identifier";
      }
    }
    return false;
  });

  if (bound[0]) return bound[0].text;

  return findLastSimpleIdentifier(pattern)?.text ?? null;
}

function extractPropertyNames(node: TreeSitterNode): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const directNamePatterns = childrenForFieldName(node, "name")
    .flatMap((nameNode) => (
      nameNode.type === "pattern"
        ? [nameNode]
        : collectDescendants(nameNode, (child) => child.type === "pattern")
    ));
  const patterns = directNamePatterns.length > 0
    ? directNamePatterns
    : namedChildren(node).filter((child) => child.type === "pattern");

  for (const pattern of patterns) {
    const name = extractPatternName(pattern);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

function extractAssociatedTypeName(node: TreeSitterNode): string | null {
  const nameNode = node.childForFieldName("name") ?? findFirstIdentifier(node);
  return nameNode?.text ?? null;
}

function extractEnumCaseNames(node: TreeSitterNode): string[] {
  const names: string[] = [];

  const fieldNames = childrenForFieldName(node, "name");
  if (fieldNames.length > 0) {
    for (const field of fieldNames) {
      const identifier = findFirstIdentifier(field);
      if (identifier) names.push(identifier.text);
    }
    return names;
  }

  for (const child of namedChildren(node)) {
    if (child.type === "simple_identifier") {
      names.push(child.text);
    }
  }

  return names;
}

function containerBaseName(containerName: string): string {
  return containerName.startsWith("extension ")
    ? containerName.slice("extension ".length)
    : containerName;
}

function pushExport(
  exports: StructuralAnalysis["exports"],
  name: string,
  node: TreeSitterNode,
): void {
  exports.push({ name, lineNumber: node.startPosition.row + 1 });
}

function pushFunction(
  functions: StructuralAnalysis["functions"],
  node: TreeSitterNode,
  name: string,
): void {
  functions.push({
    name,
    lineRange: lineRange(node),
    params: extractParams(node),
    returnType: extractReturnType(node),
  });
}

/**
 * Swift extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Swift has more type-like containers than the shared StructuralAnalysis schema
 * can represent directly. Following the existing Dart/Kotlin/Rust conventions,
 * class, struct, enum, actor, protocol, and extension containers are folded into
 * `classes[]`, while callable members are also surfaced in `functions[]`.
 */
export class SwiftExtractor implements LanguageExtractor {
  readonly languageIds = ["swift"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    const processNode = (node: TreeSitterNode, parentExported: boolean) => {
      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          return;
        case "function_declaration":
          this.extractTopLevelFunction(node, functions, exports, parentExported);
          return;
        case "class_declaration":
          this.extractClassLike(node, classes, functions, exports, parentExported, processNode);
          return;
        case "protocol_declaration":
          this.extractProtocol(node, classes, functions, exports, parentExported, processNode);
          return;
        case "function_body":
        case "computed_property":
        case "class_body":
        case "protocol_body":
        case "enum_class_body":
          return;
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) processNode(child, parentExported);
      }
    };

    processNode(rootNode, true);

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const calls: CallGraphEntry[] = [];
    const callerStack: string[] = [];

    const walk = (node: TreeSitterNode, containerName?: string) => {
      switch (node.type) {
        case "class_declaration": {
          const name = this.classLikeName(node);
          const body = node.childForFieldName("body");
          if (body) walk(body, name ?? containerName);
          return;
        }
        case "protocol_declaration": {
          const name = extractTypeName(node);
          const body = node.childForFieldName("body");
          if (body) walk(body, name ?? containerName);
          return;
        }
        case "function_declaration": {
          const name = extractCallableName(node);
          const body = node.childForFieldName("body");
          if (name && body) {
            callerStack.push(name);
            walk(body, containerName);
            callerStack.pop();
          }
          return;
        }
        case "init_declaration": {
          const body = node.childForFieldName("body");
          if (containerName && body) {
            callerStack.push(`${containerBaseName(containerName)}.init`);
            walk(body, containerName);
            callerStack.pop();
          }
          return;
        }
        case "deinit_declaration": {
          const body = node.childForFieldName("body");
          if (containerName && body) {
            callerStack.push(`${containerBaseName(containerName)}.deinit`);
            walk(body, containerName);
            callerStack.pop();
          }
          return;
        }
        case "property_declaration": {
          const computedOrObserved =
            findChild(node, "computed_property") ??
            findChild(node, "willset_didset_block");
          if (computedOrObserved) {
            const propertyName = extractPropertyNames(node)[0];
            if (propertyName) {
              callerStack.push(propertyName);
              walk(computedOrObserved, containerName);
              callerStack.pop();
              return;
            }
          }
          break;
        }
        case "call_expression": {
          const caller = callerStack[callerStack.length - 1];
          const callee = this.extractCalleeName(node);
          if (caller && callee) {
            calls.push({
              caller,
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
          break;
        }
        case "constructor_expression": {
          const caller = callerStack[callerStack.length - 1];
          const callee = this.extractConstructedType(node);
          if (caller && callee) {
            calls.push({
              caller,
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
          break;
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child, containerName);
      }
    };

    walk(rootNode);
    return calls;
  }

  private extractTopLevelFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    const name = extractCallableName(node);
    if (!name) return;

    pushFunction(functions, node, name);
    if (isExported(node, parentExported)) pushExport(exports, name, node);
  }

  private extractClassLike(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
    processNode: (node: TreeSitterNode, parentExported: boolean) => void,
  ): void {
    const name = this.classLikeName(node);
    if (!name) return;

    const kind = declarationKind(node);
    const exported = isExported(node, parentExported);
    const methods: string[] = [];
    const properties: string[] = [];
    const nested: TreeSitterNode[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      this.collectBodyMembers(
        body,
        name,
        exported,
        methods,
        properties,
        functions,
        exports,
        nested,
      );
    }

    classes.push({
      name,
      lineRange: lineRange(node),
      methods,
      properties,
    });

    if (kind !== "extension" && exported) pushExport(exports, name, node);

    for (const nestedNode of nested) {
      processNode(nestedNode, exported);
    }
  }

  private extractProtocol(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
    processNode: (node: TreeSitterNode, parentExported: boolean) => void,
  ): void {
    const name = extractTypeName(node);
    if (!name) return;

    const exported = isExported(node, parentExported);
    const methods: string[] = [];
    const properties: string[] = [];
    const nested: TreeSitterNode[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      this.collectBodyMembers(
        body,
        name,
        exported,
        methods,
        properties,
        functions,
        exports,
        nested,
      );
    }

    classes.push({
      name,
      lineRange: lineRange(node),
      methods,
      properties,
    });

    if (exported) pushExport(exports, name, node);

    for (const nestedNode of nested) {
      processNode(nestedNode, exported);
    }
  }

  private collectBodyMembers(
    body: TreeSitterNode,
    containerName: string,
    parentExported: boolean,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    nested: TreeSitterNode[],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i);
      if (!member?.isNamed) continue;

      if (WRAPPER_NODES.has(member.type)) {
        this.collectBodyMembers(
          member,
          containerName,
          parentExported,
          methods,
          properties,
          functions,
          exports,
          nested,
        );
        continue;
      }

      switch (member.type) {
        case "function_declaration":
        case "protocol_function_declaration":
          this.collectFunctionMember(member, methods, functions, exports, parentExported);
          break;
        case "init_declaration":
          this.collectInitMember(member, containerName, methods, functions, exports, parentExported);
          break;
        case "deinit_declaration":
          this.collectDeinitMember(member, containerName, methods, functions);
          break;
        case "subscript_declaration":
          this.collectSubscriptMember(member, methods, functions, exports, parentExported);
          break;
        case "property_declaration":
        case "protocol_property_declaration":
          this.collectPropertyMember(member, properties, exports, parentExported);
          break;
        case "associatedtype_declaration":
          this.collectAssociatedType(member, properties, exports, parentExported);
          break;
        case "enum_entry":
          properties.push(...extractEnumCaseNames(member));
          break;
        case "class_declaration":
        case "protocol_declaration":
          nested.push(member);
          break;
      }
    }
  }

  private collectFunctionMember(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    const name = extractCallableName(node);
    if (!name) return;

    methods.push(name);
    pushFunction(functions, node, name);
    if (isExported(node, parentExported)) pushExport(exports, name, node);
  }

  private collectInitMember(
    node: TreeSitterNode,
    containerName: string,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    methods.push("init");
    const name = `${containerBaseName(containerName)}.init`;
    pushFunction(functions, node, name);
    if (isExported(node, parentExported)) pushExport(exports, name, node);
  }

  private collectDeinitMember(
    node: TreeSitterNode,
    containerName: string,
    methods: string[],
    functions: StructuralAnalysis["functions"],
  ): void {
    methods.push("deinit");
    pushFunction(functions, node, `${containerBaseName(containerName)}.deinit`);
  }

  private collectSubscriptMember(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    methods.push("subscript");
    pushFunction(functions, node, "subscript");
    if (isExported(node, parentExported)) pushExport(exports, "subscript", node);
  }

  private collectPropertyMember(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    const exported = isExported(node, parentExported);

    for (const property of extractPropertyNames(node)) {
      properties.push(property);
      if (exported) pushExport(exports, property, node);
    }
  }

  private collectAssociatedType(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    parentExported: boolean,
  ): void {
    const name = extractAssociatedTypeName(node);
    if (!name) return;

    properties.push(name);
    if (isExported(node, parentExported)) pushExport(exports, name, node);
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const importPath = namedChildren(node).find((child) => child.type === "identifier");
    if (!importPath) return;

    const parts = importPath.text.split(".").filter(Boolean);
    const source = parts[0] ?? importPath.text;
    const specifier = parts[parts.length - 1] ?? source;

    imports.push({
      source,
      specifiers: [specifier],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private classLikeName(node: TreeSitterNode): string | null {
    const kind = declarationKind(node);
    const name = extractTypeName(node);
    if (!name) return null;

    return kind === "extension" ? `extension ${name}` : name;
  }

  private extractCalleeName(node: TreeSitterNode): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child || child.type === "call_suffix") break;
      if (!child.isNamed) continue;

      if (child.type === "simple_identifier" || child.type === "type_identifier") {
        return child.text;
      }
      if (child.type === "navigation_expression") {
        return this.extractNavigationName(child);
      }
      if (child.type === "constructor_expression") {
        return this.extractConstructedType(child);
      }
      if (child.type === "user_type" || child.type === "member_type_identifier") {
        return normalizeWhitespace(child.text);
      }
    }

    return null;
  }

  private extractNavigationName(node: TreeSitterNode): string | null {
    const cleaned = normalizeWhitespace(node.text)
      .replace(/\?\./g, ".")
      .replace(/!\./g, ".")
      .replace(/\?/g, "")
      .replace(/!/g, "");
    const parts = cleaned.split(".").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const receiver = parts[0];
    const last = parts[parts.length - 1];
    if (!receiver || !last) return null;

    if (receiver === "super") return parts.join(".");
    if (receiver === "self") return last;
    if (/^[A-Z_]/.test(receiver)) return parts.join(".");
    return last;
  }

  private extractConstructedType(node: TreeSitterNode): string | null {
    const constructedType = findChild(node, "constructed_type") ?? node.childForFieldName("type");
    if (constructedType) return normalizeWhitespace(constructedType.text);

    const identifier = findFirstIdentifier(node);
    return identifier?.text ?? null;
  }
}
