import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

// Pascal grammar node types we care about (from Isopod/tree-sitter-pascal corpus):
//   Module:       unit | program | library
//   Module name:  moduleName  (1+ identifier, optional kDot between)
//   Sections:     interface | implementation | initialization | finalization
//   Uses:         declUses → moduleName children (each = imported unit)
//   Types:        declTypes (kType) → declType
//                   declType → identifier (kEq) declClass | declIntf | type
//                   declClass (kClass) → typeref* (ancestors) declField* declProc* (kEnd)
//                   declIntf (kInterface) → typeref* declProc* (kEnd)
//   Routines:     declProc (decl) | defProc (defn = declProc + block)
//                   declProc → kProcedure|kFunction|kConstructor|kDestructor identifier
//                              [declArgs] [typeref]   (typeref = function return type)
//                   declArgs → declArg+
//                     declArg → [kVar|kConst|kOut] identifier+ [type]
//                   Method impls use genericDot for qualified names (ClassName.MethodName).
//   Fields:       declField → identifier+ type
//   Calls:        exprCall → entity args

const ROUTINE_KEYWORDS = new Set([
  "kProcedure",
  "kFunction",
  "kConstructor",
  "kDestructor",
]);

/** Extract a unit's bare name from a moduleName node (joins namespace parts with '.'). */
function moduleNameText(node: TreeSitterNode | null): string {
  if (!node) return "";
  const idents = findChildren(node, "identifier");
  return idents.map((n) => n.text).join(".");
}

/** Extract a name identifier from a declProc node, handling qualified method names. */
function declProcName(node: TreeSitterNode): {
  name: string;
  qualifier?: string;
} {
  // Plain `procedure Foo` — first identifier child
  const ident = findChild(node, "identifier");
  if (ident) return { name: ident.text };

  // Qualified: `procedure TFoo.Bar` — genericDot with identifier children
  const dotted = findChild(node, "genericDot");
  if (dotted) {
    const parts = findChildren(dotted, "identifier").map((n) => n.text);
    if (parts.length >= 2) {
      return {
        qualifier: parts.slice(0, -1).join("."),
        name: parts[parts.length - 1],
      };
    }
    if (parts.length === 1) return { name: parts[0] };
  }
  return { name: "" };
}

/** Routine keyword (kProcedure/kFunction/...). */
function routineKeyword(node: TreeSitterNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && ROUTINE_KEYWORDS.has(c.type)) return c.type;
  }
  return null;
}

/** Extract parameter names from a declProc's declArgs (each declArg may name multiple params). */
function extractParamNames(declProcNode: TreeSitterNode): string[] {
  const args = findChild(declProcNode, "declArgs");
  if (!args) return [];
  const names: string[] = [];
  for (const arg of findChildren(args, "declArg")) {
    // Skip leading modifier keywords (kVar/kConst/kOut), then take identifiers
    // until we hit a 'type' node.
    for (let i = 0; i < arg.childCount; i++) {
      const c = arg.child(i);
      if (!c) continue;
      if (c.type === "identifier") names.push(c.text);
      else if (c.type === "type") break;
    }
  }
  return names;
}

/** Function return type = a top-level 'typeref' directly under declProc (after declArgs). */
function extractReturnType(declProcNode: TreeSitterNode): string | undefined {
  for (let i = 0; i < declProcNode.childCount; i++) {
    const c = declProcNode.child(i);
    if (c && c.type === "typeref") {
      const ident = findChild(c, "identifier");
      return ident ? ident.text : c.text;
    }
  }
  return undefined;
}

/** lineRange helper. */
function lineRange(node: TreeSitterNode): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

export class PascalExtractor implements LanguageExtractor {
  readonly languageIds = ["pascal"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Root contains one module container: unit | program | library
    const moduleNode =
      findChild(rootNode, "unit") ??
      findChild(rootNode, "program") ??
      findChild(rootNode, "library");
    if (!moduleNode) return { functions, classes, imports, exports };

    // Walk module-level children. Sections wrap further declarations; we also
    // accept declarations at the module level for .dpr programs (where most
    // declarations live directly under `program` rather than inside an
    // interface section).
    const sectionTypes = new Set([
      "interface",
      "implementation",
      "initialization",
      "finalization",
    ]);

    const walkSection = (
      sectionNode: TreeSitterNode,
      isPublic: boolean,
      section: "interface" | "implementation" | undefined,
    ) => {
      for (let i = 0; i < sectionNode.childCount; i++) {
        const child = sectionNode.child(i);
        if (!child) continue;
        this.handleDeclaration(
          child,
          isPublic,
          section,
          functions,
          classes,
          imports,
          exports,
        );
      }
    };

    for (let i = 0; i < moduleNode.childCount; i++) {
      const child = moduleNode.child(i);
      if (!child) continue;

      if (sectionTypes.has(child.type)) {
        // Items in `interface` are public/exported; impl section items are private.
        // Tag imports with their section so file-analyzer can distinguish
        // public dependencies (interface uses) from private ones (implementation uses).
        const sectionTag =
          child.type === "interface"
            ? "interface"
            : child.type === "implementation"
              ? "implementation"
              : undefined;
        walkSection(child, child.type === "interface", sectionTag);
      } else {
        // Module-level (program/library) — treat as public for export purposes.
        // No section tag for .dpr-style declarations (they're not unit-scoped).
        this.handleDeclaration(
          child,
          true,
          undefined,
          functions,
          classes,
          imports,
          exports,
        );
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const stack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      // Track entering a defProc → its declProc gives us the caller name
      if (node.type === "defProc") {
        const declProc = findChild(node, "declProc");
        if (declProc) {
          const { qualifier, name } = declProcName(declProc);
          if (name) {
            stack.push(qualifier ? `${qualifier}.${name}` : name);
            pushed = true;
          }
        }
      }

      // Record calls. Pascal has TWO call shapes:
      //   (a) Parenthesized: `Foo(arg)` → tree-sitter `exprCall` with field `entity`.
      //   (b) Bare-identifier: `Foo;` (zero-arg procedure call) → tree-sitter
      //       emits a `statement` whose sole semantic child is an `identifier`
      //       or `exprDot` (for qualified `Self.Foo` / `Obj.Foo`). The grammar
      //       can't distinguish a zero-arg procedure call from a reference at
      //       parse time, so we treat any such statement as a candidate call.
      if (stack.length > 0) {
        if (node.type === "exprCall") {
          const entity = node.childForFieldName?.("entity") ?? null;
          const calleeText = entity
            ? entity.text
            : (findChild(node, "identifier")?.text ??
              findChild(node, "exprDot")?.text);
          if (calleeText) {
            entries.push({
              caller: stack[stack.length - 1],
              callee: calleeText,
              lineNumber: node.startPosition.row + 1,
            });
          }
        } else if (node.type === "statement") {
          // Bare procedure-call statement: a statement whose only meaningful
          // child is an identifier (or exprDot for qualified calls). Exclude
          // assignment/if/while/etc. by checking the child is a leaf
          // identifier or a dot-expression with no call sub-tree of its own.
          const ident = findChild(node, "identifier");
          const dotted = findChild(node, "exprDot");
          const calleeText = ident?.text ?? dotted?.text;
          if (
            calleeText &&
            !findChild(node, "exprCall") &&
            !findChild(node, "exprBinary") &&
            !findChild(node, "exprAssign")
          ) {
            entries.push({
              caller: stack[stack.length - 1],
              callee: calleeText,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushed) stack.pop();
    };

    walk(rootNode);
    return entries;
  }

  // ---- Private helpers ----

  private handleDeclaration(
    node: TreeSitterNode,
    isPublic: boolean,
    section: "interface" | "implementation" | undefined,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    switch (node.type) {
      case "declUses":
        this.extractUses(node, imports, section);
        return;

      case "declTypes":
        for (const declType of findChildren(node, "declType")) {
          this.extractType(declType, isPublic, classes, functions, exports);
        }
        return;

      case "declProc":
        // Forward declaration (interface section) or .dpr-style declaration
        this.extractRoutine(node, functions);
        if (isPublic) this.addRoutineExport(node, exports);
        return;

      case "defProc": {
        // Routine with body — extract from inner declProc
        const declProc = findChild(node, "declProc");
        if (declProc) {
          this.extractRoutine(declProc, functions, node);
          if (isPublic) this.addRoutineExport(declProc, exports);
        }
        return;
      }
    }
  }

  private extractUses(
    declUses: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
    section: "interface" | "implementation" | undefined,
  ): void {
    for (const mn of findChildren(declUses, "moduleName")) {
      const source = moduleNameText(mn);
      if (!source) continue;
      imports.push({
        source,
        specifiers: [source],
        lineNumber: mn.startPosition.row + 1,
        ...(section ? { section } : {}),
      });
    }
  }

  private extractType(
    declType: TreeSitterNode,
    isPublic: boolean,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameIdent = findChild(declType, "identifier");
    if (!nameIdent) return;
    const typeName = nameIdent.text;

    const declClass =
      findChild(declType, "declClass") ?? findChild(declType, "declIntf");
    if (!declClass) {
      // Non-class type alias / enum / record — not a "class" node for our purposes.
      // We could emit it as a simple definition, but skip for now to keep
      // graph clean (LLM-phase can still summarize it from the source).
      return;
    }

    const methods: string[] = [];
    const properties: string[] = [];
    // Pascal class headers carry ancestors as bare typeref children of declClass
    // BEFORE any member declarations, e.g.
    //   declClass (kClass) (typeref TParent) (typeref IFoo) (typeref IBar) declField... kEnd
    // Convention: first typeref is the parent class, remaining typerefs are
    // implemented interfaces. (Some declarations have only interfaces — when
    // declaring a pure interface via declIntf — in which case all typerefs are
    // parent interfaces; we still emit them as `parents` since they're direct
    // inheritance, not implementation.)
    const ancestorRefs: string[] = [];
    const isInterfaceDecl = declClass.type === "declIntf";

    for (let i = 0; i < declClass.childCount; i++) {
      const m = declClass.child(i);
      if (!m) continue;
      if (m.type === "typeref") {
        const id = findChild(m, "identifier");
        if (id) ancestorRefs.push(id.text);
      } else if (m.type === "declProc") {
        const { name } = declProcName(m);
        if (name) methods.push(name);
      } else if (m.type === "declField") {
        for (const id of findChildren(m, "identifier")) {
          properties.push(id.text);
        }
      }
    }

    const parents: string[] = [];
    const interfaces: string[] = [];
    if (isInterfaceDecl) {
      // declIntf — all typerefs are parent interfaces (interface inheritance).
      parents.push(...ancestorRefs);
    } else {
      // declClass — first typeref is the class parent, rest are implemented interfaces.
      if (ancestorRefs.length > 0) parents.push(ancestorRefs[0]);
      if (ancestorRefs.length > 1) interfaces.push(...ancestorRefs.slice(1));
    }

    classes.push({
      name: typeName,
      lineRange: lineRange(declType),
      methods,
      properties,
      ...(parents.length ? { parents } : {}),
      ...(interfaces.length ? { interfaces } : {}),
    });

    if (isPublic) {
      exports.push({
        name: typeName,
        lineNumber: declType.startPosition.row + 1,
      });
    }
  }

  private extractRoutine(
    declProcNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    outerDefNode?: TreeSitterNode,
  ): void {
    const { name, qualifier } = declProcName(declProcNode);
    if (!name) return;
    const kind = routineKeyword(declProcNode);

    const fullName = qualifier ? `${qualifier}.${name}` : name;
    const params = extractParamNames(declProcNode);
    const returnType =
      kind === "kFunction" ? extractReturnType(declProcNode) : undefined;

    const range = lineRange(outerDefNode ?? declProcNode);

    functions.push({
      name: fullName,
      lineRange: range,
      params,
      returnType,
    });
  }

  private addRoutineExport(
    declProcNode: TreeSitterNode,
    exports: StructuralAnalysis["exports"],
  ): void {
    const { name, qualifier } = declProcName(declProcNode);
    if (!name) return;
    exports.push({
      name: qualifier ? `${qualifier}.${name}` : name,
      lineNumber: declProcNode.startPosition.row + 1,
    });
  }
}
