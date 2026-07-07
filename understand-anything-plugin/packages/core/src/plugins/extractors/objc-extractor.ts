import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineRange(node: TreeSitterNode): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

/**
 * Build a human-readable method selector name from a method_declaration or
 * method_definition node.
 *
 * The ObjC grammar lays out a method node like:
 *   (method_type) identifier("keyword1") (method_parameter) identifier("keyword2") (method_parameter) …
 *
 * Algorithm: collect identifier children in order. Between each consecutive
 * pair of identifiers there is a method_parameter, so every identifier except
 * the last (which follows a preceding method_parameter) gets a ":" appended.
 *
 * Single-part selectors (no parameters) have exactly one identifier → no ":".
 */
function extractMethodName(node: TreeSitterNode): string {
  // Collect named children in order, skipping method_type
  const identifiers: string[] = [];
  const hasParams: boolean[] = [];

  let seenMethodType = false;
  let prevWasParam = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "method_type") {
      seenMethodType = true;
      continue;
    }

    if (!seenMethodType) continue;

    if (child.type === "identifier") {
      identifiers.push(child.text);
      hasParams.push(false); // will be updated when we see the following method_parameter
      prevWasParam = false;
    } else if (child.type === "method_parameter") {
      // The identifier immediately preceding this param keyword takes a ":"
      if (identifiers.length > 0) {
        hasParams[identifiers.length - 1] = true;
      }
      prevWasParam = true;
    }
  }

  if (identifiers.length === 0) return "<unknown>";

  return identifiers
    .map((id, i) => (hasParams[i] ? id + ":" : id))
    .join("");
}

/** Find the first keyword identifier of a method node (the base name, for call graph). */
function extractMethodBaseName(node: TreeSitterNode): string {
  let seenMethodType = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "method_type") { seenMethodType = true; continue; }
    if (seenMethodType && child.type === "identifier") return child.text;
  }
  return "<unknown>";
}

/**
 * Extract parameter local names from a method_declaration or method_definition.
 * Each method_parameter contains a method_type and an identifier (the local name).
 */
function extractMethodParams(node: TreeSitterNode): string[] {
  const params: string[] = [];
  const paramNodes = findChildren(node, "method_parameter");
  for (const param of paramNodes) {
    const id = findChild(param, "identifier");
    if (id) params.push(id.text);
  }
  return params;
}

/** Extract the return type text from the method_type node. */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const methodType = findChild(node, "method_type");
  if (!methodType) return undefined;
  const typeName = findChild(methodType, "type_name");
  if (!typeName) return undefined;
  return typeName.text.trim() || undefined;
}

/**
 * Extract the class name from a class_interface or class_implementation node.
 * The first named child (type `identifier`) is the class name.
 */
function extractClassName(node: TreeSitterNode): string | null {
  const id = findChild(node, "identifier");
  return id ? id.text : null;
}

/**
 * Extract @property names from a property_declaration node.
 *
 * AST structure:
 *   property_declaration
 *     property_attributes_declaration (optional)
 *     struct_declaration
 *       type_identifier | typedefed_specifier
 *       struct_declarator
 *         identifier            (non-pointer: "BOOL isLoaded")
 *         pointer_declarator    (pointer:     "NSString *name")
 *           identifier
 */
function extractPropertyName(propNode: TreeSitterNode): string | null {
  const structDecl = findChild(propNode, "struct_declaration");
  if (!structDecl) return null;

  const structDeclNode = findChild(structDecl, "struct_declarator");
  if (structDeclNode) {
    // Unwrap pointer declarator if present
    const ptr = findChild(structDeclNode, "pointer_declarator");
    const id = ptr
      ? findChild(ptr, "identifier")
      : findChild(structDeclNode, "identifier");
    if (id) return id.text;
  }

  return findChild(structDecl, "identifier")?.text ?? null;
}

// ---------------------------------------------------------------------------
// Objective-C extractor
// ---------------------------------------------------------------------------

/**
 * Objective-C extractor for tree-sitter structural analysis and call graph
 * extraction.
 *
 * Handles:
 * - @interface declarations → classes with methods and properties
 * - @implementation definitions → methods / class methods
 * - @property → properties
 * - @protocol → surfaces as a class entry (same convention as Swift protocols)
 * - #import / #include → imports
 * - message expressions [receiver selector:arg] → call graph
 *
 * Both @interface and @implementation are merged into a single class entry
 * (keyed by class name) following the same convention as the Swift/Dart/Kotlin
 * extractors where extensions / protocol impls are folded into one entry.
 *
 * `functions[]` surfaces every method (instance and class) so the LLM agent
 * has complete function-level coverage even when only the implementation is
 * available (e.g., private categories with no header).
 */
export class ObjcExtractor implements LanguageExtractor {
  readonly languageIds = ["objective-c"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Track methods / properties by class name so @interface and
    // @implementation for the same class are merged into one class entry.
    const classByName = new Map<
      string,
      { methods: string[]; properties: string[]; node: TreeSitterNode }
    >();

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child) continue;

      switch (child.type) {
        // ----- #import / #include -----
        case "preproc_include": {
          this.extractImport(child, imports);
          break;
        }

        // ----- @interface SomeName : SuperClass ... @end -----
        case "class_interface": {
          const name = extractClassName(child);
          if (!name) break;

          if (!classByName.has(name)) {
            classByName.set(name, { methods: [], properties: [], node: child });
          }
          const entry = classByName.get(name)!;

          // Gather @property names
          for (const propDecl of findChildren(child, "property_declaration")) {
            const propName = extractPropertyName(propDecl);
            if (propName && !entry.properties.includes(propName)) {
              entry.properties.push(propName);
            }
          }

          // Gather method declarations
          for (const methodDecl of findChildren(child, "method_declaration")) {
            const methodName = extractMethodName(methodDecl);
            if (!entry.methods.includes(methodName)) {
              entry.methods.push(methodName);
            }
            functions.push({
              name: methodName,
              lineRange: lineRange(methodDecl),
              params: extractMethodParams(methodDecl),
              returnType: extractReturnType(methodDecl),
            });
          }
          break;
        }

        // ----- @implementation SomeName ... @end -----
        case "class_implementation": {
          const name = extractClassName(child);
          if (!name) break;

          if (!classByName.has(name)) {
            classByName.set(name, { methods: [], properties: [], node: child });
          }
          const entry = classByName.get(name)!;

          // Each implementation_definition wraps a method_definition
          for (const implDef of findChildren(
            child,
            "implementation_definition",
          )) {
            const methodDef = findChild(implDef, "method_definition");
            if (!methodDef) continue;

            const methodName = extractMethodName(methodDef);
            if (!entry.methods.includes(methodName)) {
              entry.methods.push(methodName);
            }

            functions.push({
              name: methodName,
              lineRange: lineRange(methodDef),
              params: extractMethodParams(methodDef),
              returnType: extractReturnType(methodDef),
            });
          }
          break;
        }

        // ----- @protocol ProtocolName ... @end -----
        // Protocols are surfaced as classes (same convention as Swift protocols)
        case "protocol_declaration": {
          const name = extractClassName(child);
          if (!name) break;

          const methods: string[] = [];
          for (const methodDecl of findChildren(child, "method_declaration")) {
            const methodName = extractMethodName(methodDecl);
            if (!methods.includes(methodName)) methods.push(methodName);
            functions.push({
              name: methodName,
              lineRange: lineRange(methodDecl),
              params: extractMethodParams(methodDecl),
              returnType: extractReturnType(methodDecl),
            });
          }
          classes.push({
            name,
            lineRange: lineRange(child),
            methods,
            properties: [],
          });
          break;
        }

        default:
          break;
      }
    }

    // Flush class map → classes array (in declaration order)
    for (const [name, entry] of classByName) {
      classes.push({
        name,
        lineRange: lineRange(entry.node),
        methods: entry.methods,
        properties: entry.properties,
      });
    }

    // ObjC has no formal export keyword — public top-level classes and their
    // methods are implicitly exported (header file convention).
    for (const cls of classes) {
      exports.push({ name: cls.name, lineNumber: cls.lineRange[0] });
    }

    return { functions, classes, imports, exports };
  }

  // ---------------------------------------------------------------------------
  // Call graph
  // ---------------------------------------------------------------------------

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const calls: CallGraphEntry[] = [];
    const callerStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      switch (node.type) {
        // Track current method scope
        case "method_definition": {
          const name = extractMethodBaseName(node);
          callerStack.push(name);
          // Walk body only (compound_statement)
          const body = findChild(node, "compound_statement");
          if (body) walk(body);
          callerStack.pop();
          return;
        }

        // ObjC message sends: [receiver selector:arg]
        case "message_expression": {
          const caller = callerStack[callerStack.length - 1];
          if (caller) {
            // The receiver is the first named child; the selector keyword
            // is the second named child (an identifier).
            let receiverSeen = false;
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i);
              if (!child) continue;
              if (!receiverSeen && child.isNamed) {
                receiverSeen = true;
                continue; // skip receiver
              }
              if (child.type === "identifier" && receiverSeen) {
                calls.push({
                  caller,
                  callee: child.text,
                  lineNumber: node.startPosition.row + 1,
                });
                break;
              }
            }
          }
          // Recurse into nested message expressions (block args, etc.)
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child);
          }
          return;
        }

        // C-style function calls (NSLog, dispatch_once, etc.)
        case "call_expression": {
          const caller = callerStack[callerStack.length - 1];
          if (caller) {
            const calleeId = findChild(node, "identifier");
            if (calleeId) {
              calls.push({
                caller,
                callee: calleeId.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
          break;
        }

        default:
          break;
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
    };

    walk(rootNode);
    return calls;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // preproc_include children:
    //   system_lib_string  → <Foundation/Foundation.h>
    //   string_literal     → "MyHeader.h"
    let source: string | null = null;

    const sysLib = findChild(node, "system_lib_string");
    if (sysLib) {
      source = sysLib.text; // includes < >
    } else {
      const strLit = findChild(node, "string_literal");
      if (strLit) {
        // Strip surrounding quotes
        source = strLit.text.replace(/^"|"$/g, "");
      }
    }

    if (source) {
      imports.push({
        source,
        specifiers: [],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }
}
