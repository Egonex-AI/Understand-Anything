import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";

const TYPE_DECLARATIONS = new Set([
  "data_type",
  "newtype",
  "type_synomym", // Upstream grammar spelling.
  "class",
  "data_family",
  "type_family",
  "data_instance",
  "type_instance",
]);

function children(node: TreeSitterNode): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) result.push(child);
  }
  return result;
}

function firstDescendant(
  node: TreeSitterNode,
  wanted: ReadonlySet<string>,
): TreeSitterNode | null {
  if (wanted.has(node.type)) return node;
  for (const child of children(node)) {
    const found = firstDescendant(child, wanted);
    if (found) return found;
  }
  return null;
}

function descendants(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  const walk = (current: TreeSitterNode) => {
    if (current.type === type) result.push(current);
    for (const child of children(current)) walk(child);
  };
  walk(node);
  return result;
}

function declarationName(node: TreeSitterNode): string | null {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  return firstDescendant(node, new Set(["variable", "name", "constructor"]))?.text ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function lineRange(node: TreeSitterNode): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function signatureTypes(rootNode: TreeSitterNode): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const signature of descendants(rootNode, "signature")) {
    const name = declarationName(signature);
    const type = signature.childForFieldName("type");
    if (name && type && !signatures.has(name)) signatures.set(name, type.text);
  }
  return signatures;
}

function parameterTexts(node: TreeSitterNode): string[] {
  const patterns = node.childForFieldName("patterns");
  if (!patterns) return [];
  return children(patterns).filter((child) => child.isNamed).map((child) => child.text);
}

function importSpecifierName(node: TreeSitterNode): string | null {
  const symbol = firstDescendant(
    node,
    new Set(["variable", "name", "operator", "constructor", "module_id"]),
  );
  return symbol?.text ?? null;
}

function exportName(node: TreeSitterNode): string | null {
  const module = node.childForFieldName("module");
  if (module) return module.text;
  const symbol =
    node.childForFieldName("variable") ??
    node.childForFieldName("type") ??
    firstDescendant(node, new Set(["variable", "name", "operator"]));
  return symbol?.text ?? null;
}

/** Structural extractor for modules parsed by tree-sitter-haskell. */
export class HaskellExtractor implements LanguageExtractor {
  readonly languageIds = ["haskell"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const signatures = signatureTypes(rootNode);

    const header = children(rootNode).find((child) => child.type === "header");
    const exportList = header?.childForFieldName("exports") ?? null;
    const explicitExports = exportList !== null;
    if (exportList) {
      for (const entry of children(exportList).filter((child) => child.type === "export")) {
        const name = exportName(entry);
        if (name) exports.push({ name, lineNumber: entry.startPosition.row + 1 });
      }
    }

    const importsNode = children(rootNode).find((child) => child.type === "imports");
    if (importsNode) {
      for (const importNode of children(importsNode).filter((child) => child.type === "import")) {
        const module = importNode.childForFieldName("module");
        if (!module) continue;
        const importList = importNode.childForFieldName("names");
        const specifiers = importList
          ? unique(children(importList)
              .filter((child) => child.type === "import_name")
              .map(importSpecifierName)
              .filter((name): name is string => name !== null))
          : [];
        imports.push({
          source: module.text,
          specifiers,
          lineNumber: importNode.startPosition.row + 1,
        });
      }
    }

    const declarations = children(rootNode).find((child) => child.type === "declarations");
    if (!declarations) return { functions, classes, imports, exports };

    const functionsByName = new Map<string, StructuralAnalysis["functions"][number]>();
    for (const declaration of children(declarations)) {
      if (declaration.type === "function" || declaration.type === "bind") {
        const name = declarationName(declaration);
        if (!name) continue;
        const existing = functionsByName.get(name);
        if (existing) {
          existing.lineRange[1] = Math.max(existing.lineRange[1], declaration.endPosition.row + 1);
          existing.params = unique([...existing.params, ...parameterTexts(declaration)]);
        } else {
          functionsByName.set(name, {
            name,
            lineRange: lineRange(declaration),
            params: parameterTexts(declaration),
            ...(signatures.get(name) ? { returnType: signatures.get(name) } : {}),
          });
        }
        if (!explicitExports) {
          exports.push({ name, lineNumber: declaration.startPosition.row + 1 });
        }
        continue;
      }

      if (TYPE_DECLARATIONS.has(declaration.type)) {
        const cls = this.extractTypeDeclaration(declaration);
        if (!cls) continue;
        classes.push(cls);
        if (!explicitExports) {
          exports.push({ name: cls.name, lineNumber: declaration.startPosition.row + 1 });
        }
        continue;
      }

      if (declaration.type === "instance") {
        const typeClass = declarationName(declaration) ?? "instance";
        const patterns = declaration.childForFieldName("patterns")?.text ?? "";
        const methods = this.memberNames(declaration);
        classes.push({
          name: `instance ${typeClass}${patterns ? ` ${patterns}` : ""}`,
          lineRange: lineRange(declaration),
          methods,
          properties: [],
        });
      }
    }

    functions.push(...functionsByName.values());
    return {
      functions,
      classes,
      imports,
      exports: this.dedupeExports(exports),
    };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const seen = new Set<string>();

    const add = (caller: string, callee: string, lineNumber: number) => {
      if (!callee || caller === callee) return;
      const key = `${caller}\0${callee}\0${lineNumber}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ caller, callee, lineNumber });
    };

    const walk = (node: TreeSitterNode) => {
      const isDeclaration = node.type === "function" || node.type === "bind";
      const name = isDeclaration ? declarationName(node) : null;
      if (name) functionStack.push(name);

      const caller = functionStack[functionStack.length - 1];
      if (caller && node.type === "apply") {
        const callee = this.applicationCallee(node);
        if (callee) add(caller, callee, node.startPosition.row + 1);
      } else if (caller && node.type === "infix") {
        const operator = node.childForFieldName("operator");
        if (operator) add(caller, operator.text, node.startPosition.row + 1);
      }

      for (const child of children(node)) walk(child);
      if (name) functionStack.pop();
    };

    walk(rootNode);
    return entries;
  }

  private extractTypeDeclaration(
    node: TreeSitterNode,
  ): StructuralAnalysis["classes"][number] | null {
    const name = declarationName(node);
    if (!name) return null;

    const methods = node.type === "class" ? this.memberNames(node) : [];
    const constructorNames = descendants(node, "data_constructor")
      .map((constructor) => firstDescendant(constructor, new Set(["constructor"]))?.text ?? "");
    const fieldNames = descendants(node, "field_name").map((field) => field.text);

    return {
      name,
      lineRange: lineRange(node),
      methods: unique(methods),
      properties: unique([...constructorNames, ...fieldNames]),
    };
  }

  private memberNames(node: TreeSitterNode): string[] {
    const result: string[] = [];
    const walk = (current: TreeSitterNode) => {
      if (current !== node && (current.type === "signature" || current.type === "function" || current.type === "bind")) {
        const name = declarationName(current);
        if (name) result.push(name);
        return;
      }
      for (const child of children(current)) walk(child);
    };
    walk(node);
    return unique(result);
  }

  private applicationCallee(node: TreeSitterNode): string | null {
    let current = node.childForFieldName("function") ?? node.child(0);
    while (current?.type === "apply") {
      current = current.childForFieldName("function") ?? current.child(0);
    }
    if (!current) return null;
    if (["variable", "operator", "constructor", "qualified"].includes(current.type)) {
      return current.text;
    }
    return null;
  }

  private dedupeExports(
    exports: StructuralAnalysis["exports"],
  ): StructuralAnalysis["exports"] {
    const seen = new Set<string>();
    return exports.filter(({ name }) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }
}
