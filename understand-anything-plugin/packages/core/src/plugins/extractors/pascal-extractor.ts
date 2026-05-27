import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

// grammar node: declProc — a procedure or function heading (forward or inside a class).
// Structure: (kProcedure|kFunction|kConstructor|kDestructor) identifier [declArgs] [typeref]
// grammar node: defProc — a full definition: (declProc) (block)
// grammar node: declClass — class/record/object body inside a declType
// grammar node: declIntf — interface body inside a declType
// grammar node: declType — type alias: (identifier) kEq (declClass|declIntf|type|...)
// grammar node: declUses — uses clause: kUses (moduleName)+
// grammar node: moduleName — dotted module name: identifier [kDot identifier]*
// grammar node: declArg — parameter group: [kVar|kConst|kOut] identifier+ (type)
// grammar node: declProp — property declaration inside a class
// grammar node: declField / declVar — field/variable declarations inside a class

function isProcKeyword(node: TreeSitterNode): boolean {
  return (
    node.type === "kProcedure" ||
    node.type === "kFunction" ||
    node.type === "kConstructor" ||
    node.type === "kDestructor" ||
    node.type === "kOperator"
  );
}

function isFunctionKeyword(node: TreeSitterNode): boolean {
  return node.type === "kFunction";
}

/**
 * Extract parameter names from a declArgs node.
 * Each declArg child has one or more identifier children followed by a type node.
 * Modifiers (kVar, kConst, kOut, kConstref) appear before the identifiers.
 */
function extractParams(argsNode: TreeSitterNode | null): string[] {
  if (!argsNode) return [];
  const params: string[] = [];
  const argNodes = findChildren(argsNode, "declArg");
  for (const arg of argNodes) {
    // Collect all identifier children (skip keywords and type nodes)
    for (let i = 0; i < arg.childCount; i++) {
      const child = arg.child(i);
      if (child && child.type === "identifier") {
        params.push(child.text);
      }
    }
  }
  return params;
}

/**
 * Extract the name identifier from a declProc node.
 * The heading is: (kProcedure|kFunction|...) [kClass] identifier ...
 */
function extractProcName(node: TreeSitterNode): string | null {
  let seenKeyword = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (isProcKeyword(child) || child.type === "kClass") {
      seenKeyword = true;
      continue;
    }
    if (seenKeyword && child.type === "identifier") {
      return child.text;
    }
    // Qualified names like TFoo.Bar — take the full text of the compound node
    if (
      seenKeyword &&
      (child.type === "operatorDot" || child.type === "genericDot")
    ) {
      return child.text;
    }
  }
  return null;
}

/**
 * Extract return type text from a declProc that uses kFunction.
 * The typeref is a direct child after the declArgs (or after the identifier if no args).
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  let seenArgs = false;
  let seenName = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "declArgs") {
      seenArgs = true;
      continue;
    }
    if (child.type === "identifier" && !seenName) {
      seenName = true;
      continue;
    }
    if ((seenArgs || seenName) && (child.type === "typeref" || child.type === "type")) {
      return child.text;
    }
  }
  return undefined;
}

/**
 * Extract a dotted module name from a moduleName node.
 * e.g. (moduleName (identifier "System") (kDot) (identifier "SysUtils")) → "System.SysUtils"
 */
function extractModuleName(node: TreeSitterNode): string {
  const parts: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "identifier") {
      parts.push(child.text);
    }
  }
  return parts.join(".");
}

/**
 * Extract all procedure/function definitions from a root node, recursing into
 * unit interface/implementation sections.
 */
function collectDefProcs(
  root: TreeSitterNode,
  out: { node: TreeSitterNode; declProc: TreeSitterNode }[],
): void {
  function walk(node: TreeSitterNode): void {
    if (node.type === "defProc") {
      const decl = findChild(node, "declProc");
      if (decl) {
        out.push({ node, declProc: decl });
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
}

/**
 * Extract all declType nodes from a root, recursing into interface/implementation sections.
 */
function collectDeclTypes(root: TreeSitterNode, out: TreeSitterNode[]): void {
  function walk(node: TreeSitterNode): void {
    if (node.type === "declType") {
      out.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
}

/**
 * Collect standalone declProc nodes that are direct children of the interface
 * section (forward declarations of procedures/functions exported from the unit).
 * These have no defProc wrapper — the body lives in the implementation section.
 */
function collectInterfaceDeclProcs(root: TreeSitterNode, out: TreeSitterNode[]): void {
  function walk(node: TreeSitterNode): void {
    if (node.type === "interface") {
      // Only look one level deep inside the interface section
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === "declProc") {
          out.push(child);
        }
      }
      return; // don't recurse further into interface — we only want direct children
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
}

/**
 * Extract all declUses nodes from a root.
 */
function collectDeclUses(root: TreeSitterNode, out: TreeSitterNode[]): void {
  function walk(node: TreeSitterNode): void {
    if (node.type === "declUses") {
      out.push(node);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
}

/**
 * Determine whether a declType or its contents lives inside an `interface` section.
 * Nodes in the interface section are publicly exported from a Pascal unit.
 */
function isInInterfaceSection(node: TreeSitterNode): boolean {
  let n: TreeSitterNode | null = node.parent;
  while (n) {
    if (n.type === "interface") return true;
    if (n.type === "implementation") return false;
    n = n.parent;
  }
  // top-level (program/library) — treat as public
  return true;
}

/**
 * Pascal extractor for tree-sitter structural analysis.
 *
 * Supports: Object Pascal (Delphi), Free Pascal, and related dialects.
 *
 * Mapping decisions:
 * - procedure/function/constructor/destructor definitions (defProc) → functions array.
 * - class, record, object, and interface type declarations → classes array.
 * - Class methods (declProc inside declClass/declIntf) → included in class.methods.
 * - uses clause (declUses) → imports array. Each moduleName becomes one import.
 * - Declarations in the `interface` section of a unit → exports array (publicly visible).
 * - Properties (declProp) and fields (declVar/declField) → class.properties.
 */
export class PascalExtractor implements LanguageExtractor {
  readonly languageIds = ["pascal"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // -- Functions: defProc nodes --
    const defProcs: { node: TreeSitterNode; declProc: TreeSitterNode }[] = [];
    collectDefProcs(rootNode, defProcs);

    for (const { node, declProc } of defProcs) {
      const name = extractProcName(declProc);
      if (!name) continue;

      const isFunc = isFunctionKeyword(findChild(declProc, "kFunction") ?? declProc);
      const argsNode = findChild(declProc, "declArgs");
      const params = extractParams(argsNode);
      const returnType = isFunc ? extractReturnType(declProc) : undefined;

      functions.push({
        name,
        lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
        params,
        ...(returnType !== undefined ? { returnType } : {}),
      });

      if (isInInterfaceSection(node)) {
        exports.push({ name, lineNumber: node.startPosition.row + 1 });
      }
    }

    // -- Classes: declType nodes containing declClass or declIntf --
    const declTypes: TreeSitterNode[] = [];
    collectDeclTypes(rootNode, declTypes);

    for (const declType of declTypes) {
      const nameNode = findChild(declType, "identifier");
      if (!nameNode) continue;
      const className = nameNode.text;

      const classBody = findChild(declType, "declClass") ?? findChild(declType, "declIntf");
      if (!classBody) continue;

      const methods: string[] = [];
      const properties: string[] = [];

      // Methods: declProc nodes inside the class body
      const methodDecls = findChildren(classBody, "declProc");
      for (const m of methodDecls) {
        const mName = extractProcName(m);
        if (mName) methods.push(mName);
      }

      // Properties: declProp nodes
      const propDecls = findChildren(classBody, "declProp");
      for (const p of propDecls) {
        const pName = findChild(p, "identifier");
        if (pName) properties.push(pName.text);
      }

      // Fields: declVar/declField/declVars children
      const varSections = [
        ...findChildren(classBody, "declVars"),
        ...findChildren(classBody, "declField"),
      ];
      for (const vs of varSections) {
        const varNodes = findChildren(vs, "declVar");
        for (const v of varNodes) {
          for (let i = 0; i < v.childCount; i++) {
            const c = v.child(i);
            if (c && c.type === "identifier") properties.push(c.text);
          }
        }
      }

      classes.push({
        name: className,
        lineRange: [declType.startPosition.row + 1, declType.endPosition.row + 1],
        methods,
        properties,
      });

      if (isInInterfaceSection(declType)) {
        exports.push({ name: className, lineNumber: declType.startPosition.row + 1 });
      }
    }

    // -- Exports: forward-declared procedures/functions in the interface section --
    // (defProc nodes inside the interface section are already handled above; this
    // catches standalone declProc forward declarations whose body is in implementation.)
    const ifaceDeclProcs: TreeSitterNode[] = [];
    collectInterfaceDeclProcs(rootNode, ifaceDeclProcs);
    for (const declProc of ifaceDeclProcs) {
      const name = extractProcName(declProc);
      if (!name) continue;
      // Avoid duplicating an entry that was already exported via defProc
      if (!exports.some((e) => e.name === name)) {
        exports.push({ name, lineNumber: declProc.startPosition.row + 1 });
      }
    }

    // -- Imports: declUses nodes --
    const usesNodes: TreeSitterNode[] = [];
    collectDeclUses(rootNode, usesNodes);

    for (const usesNode of usesNodes) {
      const moduleNames = findChildren(usesNode, "moduleName");
      for (const mod of moduleNames) {
        const fullName = extractModuleName(mod);
        if (!fullName) continue;
        const parts = fullName.split(".");
        imports.push({
          source: fullName,
          specifiers: [parts[parts.length - 1]],
          lineNumber: mod.startPosition.row + 1,
        });
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const callerStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      // Track entering a procedure/function definition
      if (node.type === "defProc") {
        const decl = findChild(node, "declProc");
        if (decl) {
          const name = extractProcName(decl);
          if (name) {
            callerStack.push(name);
            pushed = true;
          }
        }
      }

      // Capture call expressions with arguments: exprCall → (callee args)
      if (node.type === "exprCall" && callerStack.length > 0) {
        const callee = node.child(0);
        if (callee) {
          entries.push({
            caller: callerStack[callerStack.length - 1],
            callee: callee.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // Capture bare procedure calls: statement containing only an identifier (no args).
      // e.g. `Foo;` parses as statement > identifier (+ anonymous `;`), not as exprCall.
      if (node.type === "statement" && callerStack.length > 0) {
        if (node.namedChildCount === 1) {
          const child = node.child(0);
          if (child && child.type === "identifier") {
            entries.push({
              caller: callerStack[callerStack.length - 1],
              callee: child.text,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushed) callerStack.pop();
    };

    walk(rootNode);
    return entries;
  }
}
