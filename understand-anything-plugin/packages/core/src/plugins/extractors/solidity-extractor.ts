import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Solidity visibility keywords that count as exported across the
 * contract boundary. `internal` and `private` keep the symbol within
 * the contract / file and don't belong in the project-graph's exports
 * array.
 */
const EXPORTED_VISIBILITIES = new Set(["public", "external"]);

/** Get the first `identifier` child's text. */
function firstIdentifierText(node: TreeSitterNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "identifier") return child.text;
  }
  return null;
}

/**
 * Get the visibility keyword text from any node that carries a `visibility`
 * child (function_definition, state_variable_declaration, …). Returns null
 * when none is present — callers must apply Solidity's defaults themselves
 * (`internal` for state vars, `public` for free functions, etc.).
 */
function extractVisibility(node: TreeSitterNode): string | null {
  const vis = findChild(node, "visibility");
  if (!vis) return null;
  return vis.text.trim();
}

/**
 * Extract parameter names from a Solidity definition's parameter list.
 *
 * The grammar emits `parameter` (or `event_parameter`) children with an
 * `identifier` for the parameter name. Unnamed parameters are common
 * in return-type lists and external interfaces; we skip them since
 * `StructuralAnalysis.functions[].params` is a list of names.
 */
function extractParams(declNode: TreeSitterNode): string[] {
  const params: string[] = [];
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (!child) continue;
    if (child.type === "parameter" || child.type === "event_parameter") {
      const id = findChild(child, "identifier");
      if (id) params.push(id.text);
    }
    // Once we hit the body / return-type / state-mutability, stop scanning
    // so we don't accidentally pull in return-type parameter names.
    if (
      child.type === "function_body" ||
      child.type === "return_type_definition" ||
      child.type === "visibility"
    ) {
      break;
    }
  }
  return params;
}

/**
 * Extract the return type text from a Solidity function. The grammar wraps
 * returns in `return_type_definition` containing one or more `parameter`
 * children (Solidity supports multiple return values). For a single
 * return, we return its type's text; for multiple, we join them as a
 * tuple-like string so the dashboard can render something sensible.
 */
function extractReturnType(declNode: TreeSitterNode): string | undefined {
  const ret = findChild(declNode, "return_type_definition");
  if (!ret) return undefined;
  const types: string[] = [];
  for (const param of findChildren(ret, "parameter")) {
    const typeNode = findChild(param, "type_name");
    if (typeNode) types.push(typeNode.text.trim());
  }
  if (types.length === 0) return undefined;
  if (types.length === 1) return types[0];
  return `(${types.join(", ")})`;
}

/**
 * Solidity extractor for tree-sitter structural analysis and call graph
 * extraction.
 *
 * Solidity's three "container" declarations — `contract`, `interface`,
 * `library` — all share a `contract_body` and are mapped uniformly to
 * `StructuralAnalysis.classes`. State variables are surfaced as
 * `properties`, while functions, constructors, modifiers, and events
 * are surfaced as `methods` (events are listed there because they are
 * the closest analogue to "callable members" the graph knows about).
 */
export class SolidityExtractor implements LanguageExtractor {
  readonly languageIds = ["solidity"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "contract_declaration":
        case "interface_declaration":
        case "library_declaration":
          this.extractContractLike(node, classes, functions, exports);
          break;

        case "import_directive":
          this.extractImport(node, imports);
          break;

        // Solidity 0.7.1+ supports free functions (file-scope, outside
        // any contract). We treat them as top-level functions, matching
        // the convention used for Go / Rust / etc.
        case "function_definition":
          this.extractTopLevelFunction(node, functions, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      if (node.type === "function_definition") {
        const name = firstIdentifierText(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      } else if (node.type === "constructor_definition") {
        functionStack.push("constructor");
        pushed = true;
      } else if (node.type === "modifier_definition") {
        const name = firstIdentifierText(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }

      if (
        node.type === "call_expression" &&
        functionStack.length > 0
      ) {
        const callee = this.extractCalleeName(node);
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

  // ---- Private helpers ----

  private extractTopLevelFunction(
    declNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const fn = this.buildFunctionEntry(declNode);
    if (!fn) return;
    functions.push(fn);
    // Free functions default to `public` if no visibility specified, so
    // they are exported unless explicitly hidden.
    const vis = extractVisibility(declNode);
    if (vis === null || EXPORTED_VISIBILITIES.has(vis)) {
      exports.push({ name: fn.name, lineNumber: fn.lineRange[0] });
    }
  }

  private buildFunctionEntry(
    declNode: TreeSitterNode,
  ): StructuralAnalysis["functions"][number] | null {
    const name = firstIdentifierText(declNode);
    if (!name) return null;
    return {
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      params: extractParams(declNode),
      returnType: extractReturnType(declNode),
    };
  }

  private extractContractLike(
    declNode: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = firstIdentifierText(declNode);
    if (!name) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = findChild(declNode, "contract_body");
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (!member) continue;

        if (member.type === "function_definition") {
          const fn = this.buildFunctionEntry(member);
          if (!fn) continue;
          methods.push(fn.name);
          functions.push(fn);
          const vis = extractVisibility(member);
          if (vis !== null && EXPORTED_VISIBILITIES.has(vis)) {
            exports.push({ name: fn.name, lineNumber: fn.lineRange[0] });
          }
        } else if (member.type === "constructor_definition") {
          methods.push("constructor");
          functions.push({
            name: "constructor",
            lineRange: [
              member.startPosition.row + 1,
              member.endPosition.row + 1,
            ],
            params: extractParams(member),
            returnType: undefined,
          });
        } else if (member.type === "modifier_definition") {
          const mn = firstIdentifierText(member);
          if (mn) methods.push(mn);
        } else if (member.type === "event_definition") {
          const en = firstIdentifierText(member);
          if (en) methods.push(en);
        } else if (member.type === "state_variable_declaration") {
          const vn = firstIdentifierText(member);
          if (!vn) continue;
          properties.push(vn);
          // Public state variables auto-generate a getter and are
          // therefore exported across the contract boundary.
          const vis = extractVisibility(member);
          if (vis === "public") {
            exports.push({
              name: vn,
              lineNumber: member.startPosition.row + 1,
            });
          }
        }
      }
    }

    classes.push({
      name,
      lineRange: [
        declNode.startPosition.row + 1,
        declNode.endPosition.row + 1,
      ],
      methods,
      properties,
    });

    // Contracts / interfaces / libraries are visible to importers by
    // default. There is no "private contract" — the name is always
    // resolvable once another file imports this one.
    exports.push({ name, lineNumber: declNode.startPosition.row + 1 });
  }

  /**
   * Extract a Solidity `import_directive`.
   *
   * Three syntactic forms map to the project's `imports` shape:
   *
   * - `import "./X.sol";`              → source="./X.sol", specifier=last path segment
   * - `import {Sym} from "./X.sol";`   → source="./X.sol", specifier="Sym" (named import)
   * - `import * as Alias from "./X.sol";` → source="./X.sol", specifier="Alias"
   */
  private extractImport(
    declNode: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Find the source string. The grammar exposes the URI as a `string`
    // child whose text includes surrounding quotes.
    const stringChild = findChild(declNode, "string");
    if (!stringChild) return;
    const source = stringChild.text.replace(/^["']|["']$/g, "");

    // Walk children to detect import shape and collect specifiers.
    const specifiers: string[] = [];
    let sawBrace = false;
    let sawStarAs = false;
    for (let i = 0; i < declNode.childCount; i++) {
      const child = declNode.child(i);
      if (!child) continue;
      if (child.type === "{") sawBrace = true;
      else if (child.type === "}") sawBrace = false;
      else if (child.type === "*") sawStarAs = true;
      else if (child.type === "identifier") {
        // Named import inside `{...}` or alias after `* as`
        if (sawBrace || sawStarAs) {
          specifiers.push(child.text);
          sawStarAs = false;
        }
      }
    }

    // Default specifier when neither named nor alias forms apply:
    // take the filename portion of the URI (without .sol extension).
    if (specifiers.length === 0) {
      const lastSlash = source.lastIndexOf("/");
      const base = lastSlash >= 0 ? source.slice(lastSlash + 1) : source;
      const dot = base.lastIndexOf(".");
      specifiers.push(dot > 0 ? base.slice(0, dot) : base);
    }

    imports.push({
      source,
      specifiers,
      lineNumber: declNode.startPosition.row + 1,
    });
  }

  /**
   * Extract the callee name from a `call_expression`.
   *
   * The Solidity grammar wraps the callee in an `expression` node before
   * landing on the concrete shape. We resolve `foo()`, `obj.foo()`, and
   * `Type(expr)` style casts by unwrapping `expression` layers and then
   * inspecting whatever falls out: an `identifier` is returned directly;
   * a `member_expression` returns its trailing identifier (method name).
   */
  private extractCalleeName(callNode: TreeSitterNode): string | null {
    let cursor: TreeSitterNode | null = callNode.child(0);
    // Unwrap nested `expression` wrappers — Solidity's grammar layers
    // these around every callee, including identifiers and member access.
    while (cursor && cursor.type === "expression") {
      const inner = cursor.child(0);
      if (!inner) break;
      cursor = inner;
    }
    if (!cursor) return null;

    if (cursor.type === "identifier") return cursor.text;

    if (cursor.type === "member_expression") {
      // The method name is the trailing identifier of the member chain.
      let last: string | null = null;
      for (let i = 0; i < cursor.childCount; i++) {
        const c = cursor.child(i);
        if (c && c.type === "identifier") last = c.text;
      }
      return last;
    }
    return null;
  }
}
