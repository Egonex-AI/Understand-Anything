import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

export class ObjectiveCExtractor implements LanguageExtractor {
  readonly name = "objectivec-extractor";
  readonly languageIds = ["objectivec"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Per-class accumulator so an @interface header and its later
    // @implementation can contribute methods to the same class entry.
    const classByName = new Map<string, StructuralAnalysis["classes"][number]>();
    const protocolNames = new Set<string>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "preproc_include":
          this.extractInclude(node, imports);
          break;
        case "module_import":
          this.extractModuleImport(node, imports);
          break;
        case "class_interface":
          this.extractInterface(node, classByName, exports);
          break;
        case "class_implementation":
          this.extractImplementation(node, classByName);
          break;
        case "protocol_declaration":
          this.extractProtocol(node, classByName, protocolNames, exports);
          break;
        case "function_definition":
          this.extractCFunction(node, functions, exports);
          break;
      }
    }

    classes.push(...classByName.values());
    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      // Track the enclosing function/method name so calls within its body
      // attribute correctly. Both C-style `function_definition` and Obj-C
      // `method_definition` introduce a new scope.
      if (node.type === "function_definition") {
        const name = this.cFunctionName(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      } else if (node.type === "method_definition") {
        const name = findChild(node, "identifier")?.text;
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }

      // C-style call: `printf(...)` — first child is an identifier.
      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = node.child(0);
        if (callee && callee.type === "identifier") {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee: callee.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // Obj-C message send: `[receiver selector:arg ...]`. Children are a
      // flat list of identifiers: [receiver, selector, arg, selector, arg, ...].
      // The first selector identifier (index 1 among named identifier children)
      // is the method name we attribute. Chained sends `[[a b] c]` have an
      // inner message_expression as the receiver — we still want `c`, which
      // is the first identifier child after the inner message_expression.
      if (node.type === "message_expression" && functionStack.length > 0) {
        const callee = this.messageCalleeName(node);
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
        if (child) walk(child);
      }

      if (pushed) functionStack.pop();
    };

    walk(rootNode);
    return entries;
  }

  // ───── Private helpers ─────

  private extractInclude(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // `#import <Foo/Foo.h>` or `#import "Foo.h"` or `#include ...`
    // Surface the raw header path as the import source so consumers can
    // map between code and headers later.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (child.type === "system_lib_string") {
        // <Foundation/Foundation.h>
        imports.push({
          source: child.text.replace(/^<|>$/g, ""),
          specifiers: [],
          lineNumber: node.startPosition.row + 1,
        });
        return;
      }
      if (child.type === "string_literal") {
        const content = findChild(child, "string_content");
        if (content) {
          imports.push({
            source: content.text,
            specifiers: [],
            lineNumber: node.startPosition.row + 1,
          });
          return;
        }
      }
    }
  }

  private extractModuleImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // `@import UIKit;` — the identifier IS the module name.
    const id = findChild(node, "identifier");
    if (id) {
      imports.push({
        source: id.text,
        specifiers: [],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractInterface(
    node: TreeSitterNode,
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
    exports: StructuralAnalysis["exports"],
  ): void {
    // The class name is the first `identifier` child. For categories
    // `@interface NSString (MyCategory)`, the first identifier is the
    // base class (`NSString`); we still attach the category's methods to
    // that base class entry so consumers see the full surface.
    const idents = findChildren(node, "identifier");
    if (idents.length === 0) return;
    const className = idents[0].text;
    const entry = this.ensureClass(classByName, className, node);

    // Properties: @property declarations
    for (const prop of findChildren(node, "property_declaration")) {
      const struct = findChild(prop, "struct_declaration");
      if (!struct) continue;
      const declarator = findChild(struct, "struct_declarator");
      if (!declarator) continue;
      // The declarator wraps `*name` — the bare identifier text strips the *.
      const name = declarator.text.replace(/^\*+/, "").trim();
      if (name) entry.properties.push(name);
    }

    // Method declarations (signatures only)
    for (const decl of findChildren(node, "method_declaration")) {
      const name = findChild(decl, "identifier")?.text;
      if (name) entry.methods.push(name);
    }

    exports.push({
      name: className,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractImplementation(
    node: TreeSitterNode,
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
  ): void {
    const className = findChild(node, "identifier")?.text;
    if (!className) return;
    const entry = this.ensureClass(classByName, className, node);

    for (const def of findChildren(node, "implementation_definition")) {
      const method = findChild(def, "method_definition");
      if (!method) continue;
      const name = findChild(method, "identifier")?.text;
      if (name && !entry.methods.includes(name)) {
        entry.methods.push(name);
      }
    }
  }

  private extractProtocol(
    node: TreeSitterNode,
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
    protocolNames: Set<string>,
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = findChild(node, "identifier")?.text;
    if (!name) return;
    protocolNames.add(name);

    const entry = this.ensureClass(classByName, name, node);
    for (const decl of findChildren(node, "method_declaration")) {
      const m = findChild(decl, "identifier")?.text;
      if (m) entry.methods.push(m);
    }
    exports.push({ name, lineNumber: node.startPosition.row + 1 });
  }

  private extractCFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = this.cFunctionName(node);
    if (!name) return;
    const declarator = findChild(node, "function_declarator");
    const params = declarator
      ? this.extractParams(findChild(declarator, "parameter_list"))
      : [];

    functions.push({
      name,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
    });
    // Treat all top-level C functions as exported. Obj-C / C have no
    // visibility keyword; the convention is `static` for file-private,
    // which would appear in `storage_class_specifier`. We skip that
    // detection for the first iteration and conservatively export all.
    exports.push({ name, lineNumber: node.startPosition.row + 1 });
  }

  private cFunctionName(node: TreeSitterNode): string | null {
    // function_definition → function_declarator → identifier
    const declarator = findChild(node, "function_declarator");
    if (!declarator) return null;
    return findChild(declarator, "identifier")?.text ?? null;
  }

  private extractParams(paramList: TreeSitterNode | null): string[] {
    if (!paramList) return [];
    const params: string[] = [];
    for (let i = 0; i < paramList.childCount; i++) {
      const child = paramList.child(i);
      if (!child) continue;
      if (child.type === "parameter_declaration") {
        // Last identifier in the parameter_declaration is the name
        let lastIdent: string | null = null;
        for (let j = 0; j < child.childCount; j++) {
          const inner = child.child(j);
          if (inner && inner.type === "identifier") lastIdent = inner.text;
        }
        if (lastIdent) params.push(lastIdent);
      }
    }
    return params;
  }

  private ensureClass(
    classByName: Map<string, StructuralAnalysis["classes"][number]>,
    name: string,
    node: TreeSitterNode,
  ): StructuralAnalysis["classes"][number] {
    let entry = classByName.get(name);
    if (!entry) {
      entry = {
        name,
        lineRange: [
          node.startPosition.row + 1,
          node.endPosition.row + 1,
        ],
        methods: [],
        properties: [],
      };
      classByName.set(name, entry);
    } else {
      // Widen the line range so it spans both header + implementation.
      entry.lineRange = [
        Math.min(entry.lineRange[0], node.startPosition.row + 1),
        Math.max(entry.lineRange[1], node.endPosition.row + 1),
      ];
    }
    return entry;
  }

  private messageCalleeName(messageExpr: TreeSitterNode): string | null {
    // Walk children in order. The receiver is the first thing (either an
    // identifier or another message_expression). The first identifier that
    // comes AFTER any receiver expression is the method name.
    let receiverPassed = false;
    for (let i = 0; i < messageExpr.childCount; i++) {
      const child = messageExpr.child(i);
      if (!child) continue;
      if (child.type === "[") continue;

      if (!receiverPassed) {
        // First non-bracket child is the receiver expression
        receiverPassed = true;
        continue;
      }
      if (child.type === "identifier") return child.text;
    }
    return null;
  }
}
