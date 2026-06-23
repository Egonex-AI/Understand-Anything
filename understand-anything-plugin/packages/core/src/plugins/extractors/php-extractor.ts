import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a PHP `formal_parameters` node.
 *
 * Each child is a `simple_parameter` containing an optional type hint
 * and a `variable_name` node (which itself has `$` + `name` children).
 * We extract the variable name prefixed with `$`.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  const simpleParams = findChildren(paramsNode, "simple_parameter");
  for (const param of simpleParams) {
    const varName = findChild(param, "variable_name");
    if (varName) {
      params.push(varName.text);
    }
  }

  return params;
}

/**
 * Extract a return type string from the siblings following the `formal_parameters`
 * in a function_definition or method_declaration node.
 *
 * In tree-sitter-php, the return type appears as a sibling after `:` and can be:
 * - `primitive_type` (string, int, void, bool, etc.)
 * - `named_type` (User, Repository, etc.)
 * - `optional_type` (?string, ?User)
 * - `union_type` (string|int)
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  // Walk children looking for the colon separator that precedes the return type.
  // The return type node follows the `:` and precedes the `compound_statement` (body).
  let foundColon = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === ":" && child.text === ":") {
      foundColon = true;
      continue;
    }

    if (foundColon) {
      // The next non-punctuation node after `:` is the return type
      if (
        child.type === "primitive_type" ||
        child.type === "named_type" ||
        child.type === "optional_type" ||
        child.type === "union_type"
      ) {
        return child.text;
      }
    }
  }

  return undefined;
}

/**
 * Reconstruct a fully-qualified name from a `namespace_use_clause`.
 *
 * For a simple clause like `use App\Models\User;`, the clause contains
 * a `qualified_name` with `namespace_name` segments and a trailing `name`.
 * For a grouped clause like `use App\Models\{User, Post};`, the clause
 * is a direct child of `namespace_use_group` and may be a bare `name`.
 */
function extractUseName(clause: TreeSitterNode, prefix: string): string {
  const qualifiedName = findChild(clause, "qualified_name");
  if (qualifiedName) {
    return qualifiedName.text;
  }
  // Inside a grouped use, the clause may just be a `name` node
  const nameNode = findChild(clause, "name");
  if (nameNode && prefix) {
    return prefix + "\\" + nameNode.text;
  }
  if (nameNode) {
    return nameNode.text;
  }
  return clause.text;
}

/**
 * Extract the last segment (class/interface name) from a fully-qualified name.
 * e.g., "App\Models\User" -> "User"
 */
function lastSegment(fqn: string): string {
  const parts = fqn.split("\\");
  return parts[parts.length - 1];
}

/**
 * PHP extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles functions, classes, interfaces, use imports, and call graphs
 * for PHP source code parsed by tree-sitter-php.
 *
 * PHP-specific mapping decisions:
 * - `function_definition` nodes map to the `functions` array.
 * - `class_declaration` and `interface_declaration` map to the `classes` array.
 * - `property_declaration` nodes within classes map to class properties.
 * - `namespace_use_declaration` nodes (PHP `use` statements) map to imports.
 * - PHP has no formal export syntax, so public classes, interfaces, and
 *   top-level functions are treated as exports.
 * - Call graph covers `function_call_expression`, `member_call_expression`,
 *   and `scoped_call_expression`.
 */
export class PhpExtractor implements LanguageExtractor {
  readonly languageIds = ["php"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // tree-sitter-php wraps everything under `program`. The children of
    // `program` include `php_tag`, `namespace_definition`, `namespace_use_declaration`,
    // `class_declaration`, `function_definition`, etc.
    this.walkStatements(rootNode, functions, classes, imports, exports);

    return { functions, classes, imports, exports };
  }

  /**
   * Walk top-level statements, extracting functions, classes, interfaces, and imports.
   * Handles both direct children and declarations nested inside block-scoped
   * `namespace_definition` nodes (`namespace Foo { class Bar {} }`).
   */
  private walkStatements(
    parent: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
  ): void {
    for (let i = 0; i < parent.childCount; i++) {
      const node = parent.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_definition":
          this.extractFunction(node, functions);
          exports.push({
            name: this.getFunctionName(node),
            lineNumber: node.startPosition.row + 1,
          });
          break;

        case "class_declaration":
          this.extractClass(node, classes, functions);
          exports.push({
            name: this.getClassName(node),
            lineNumber: node.startPosition.row + 1,
          });
          break;

        case "interface_declaration":
          this.extractInterface(node, classes);
          exports.push({
            name: this.getInterfaceName(node),
            lineNumber: node.startPosition.row + 1,
          });
          break;

        case "namespace_use_declaration":
          this.extractUseDeclaration(node, imports);
          break;

        case "namespace_definition": {
          // Block-scoped namespaces (`namespace Foo { ... }`) nest declarations
          // inside a compound_statement body. Declarative namespaces (`namespace Foo;`)
          // have no body — their declarations are already siblings at the root.
          const body = findChild(node, "compound_statement");
          if (body) {
            this.walkStatements(body, functions, classes, imports, exports);
          }
          break;
        }
      }
    }
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering function/method definitions
      if (node.type === "function_definition" || node.type === "method_declaration") {
        const nameNode = findChild(node, "name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      // Extract call expressions
      if (functionStack.length > 0) {
        const caller = functionStack[functionStack.length - 1];

        if (node.type === "function_call_expression") {
          // Standalone function call: baz($x), strtoupper($x), error_log($msg)
          const nameNode = findChild(node, "name");
          if (nameNode) {
            entries.push({
              caller,
              callee: nameNode.text,
              lineNumber: node.startPosition.row + 1,
            });
          }
        } else if (node.type === "member_call_expression") {
          // Instance method call: $this->fetchFromDb($id)
          const nameNode = findChild(node, "name");
          if (nameNode) {
            // Determine the receiver for more descriptive callee
            const firstChild = node.child(0);
            const receiver = firstChild ? firstChild.text : "";
            const callee = receiver
              ? receiver + "->" + nameNode.text
              : nameNode.text;
            entries.push({
              caller,
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        } else if (node.type === "scoped_call_expression") {
          // Static method call: Bar::staticMethod()
          // Children: [name("Bar"), ::, name("staticMethod"), arguments]
          // Both scope and method are `name` nodes, so we pick child[0] for scope
          // and child[2] (after `::`) for the method name.
          const scopeNode = node.child(0);
          const methodNode = node.child(2);
          if (scopeNode && methodNode && methodNode.type === "name") {
            entries.push({
              caller,
              callee: scopeNode.text + "::" + methodNode.text,
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

  private getFunctionName(node: TreeSitterNode): string {
    const nameNode = findChild(node, "name");
    return nameNode ? nameNode.text : "";
  }

  private getClassName(node: TreeSitterNode): string {
    const nameNode = findChild(node, "name");
    return nameNode ? nameNode.text : "";
  }

  private getInterfaceName(node: TreeSitterNode): string {
    const nameNode = findChild(node, "name");
    return nameNode ? nameNode.text : "";
  }

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    const nameNode = findChild(node, "name");
    if (!nameNode) return;

    const paramsNode = findChild(node, "formal_parameters");
    const params = extractParams(paramsNode);
    const returnType = extractReturnType(node);

    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
      returnType,
    });
  }

  private extractClass(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
  ): void {
    const name = this.getClassName(node);
    if (!name) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const declList = findChild(node, "declaration_list");
    if (declList) {
      this.extractDeclarationList(declList, methods, properties, functions);
    }

    classes.push({
      name,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
  }

  private extractInterface(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const name = this.getInterfaceName(node);
    if (!name) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const declList = findChild(node, "declaration_list");
    if (declList) {
      // Interface methods are method_declaration nodes (no bodies, just signatures)
      const methodDecls = findChildren(declList, "method_declaration");
      for (const methodDecl of methodDecls) {
        const methodName = findChild(methodDecl, "name");
        if (methodName) {
          methods.push(methodName.text);
        }
      }
    }

    classes.push({
      name,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });
  }

  /**
   * Extract methods and properties from a class `declaration_list`.
   * Also pushes each method into the top-level functions array.
   */
  private extractDeclarationList(
    declList: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
  ): void {
    for (let i = 0; i < declList.childCount; i++) {
      const member = declList.child(i);
      if (!member) continue;

      if (member.type === "method_declaration") {
        const nameNode = findChild(member, "name");
        if (nameNode) {
          methods.push(nameNode.text);

          // Also add to functions array
          const paramsNode = findChild(member, "formal_parameters");
          const params = extractParams(paramsNode);
          const returnType = extractReturnType(member);

          functions.push({
            name: nameNode.text,
            lineRange: [member.startPosition.row + 1, member.endPosition.row + 1],
            params,
            returnType,
          });
        }
      } else if (member.type === "property_declaration") {
        // Extract property name from property_element -> variable_name
        const propElement = findChild(member, "property_element");
        if (propElement) {
          const varName = findChild(propElement, "variable_name");
          if (varName) {
            // Get just the name part without $
            const dollarChild = findChild(varName, "name");
            if (dollarChild) {
              properties.push(dollarChild.text);
            } else {
              // Fallback: use the full text and strip $
              properties.push(varName.text.replace(/^\$/, ""));
            }
          }
        }
      }
    }
  }

  /**
   * Extract imports from a `namespace_use_declaration` node.
   *
   * Handles:
   * - Simple: `use App\Models\User;`
   * - Aliased: `use App\Contracts\Repository as Repo;`
   * - Grouped: `use App\Models\{User, Post};`
   */
  private extractUseDeclaration(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Check for grouped use: `use Namespace\{A, B};`
    const useGroup = findChild(node, "namespace_use_group");
    if (useGroup) {
      // Reconstruct the prefix from the namespace_name preceding the group
      const nsName = findChild(node, "namespace_name");
      const prefix = nsName ? nsName.text : "";

      const clauses = findChildren(useGroup, "namespace_use_clause");
      const specifiers: string[] = [];
      for (const clause of clauses) {
        const name = extractUseName(clause, prefix);
        specifiers.push(lastSegment(name));
      }

      const source = prefix
        ? prefix + "\\{" + specifiers.join(", ") + "}"
        : specifiers.join(", ");

      imports.push({
        source,
        specifiers,
        lineNumber: node.startPosition.row + 1,
      });
      return;
    }

    // Simple or aliased use declaration
    const clauses = findChildren(node, "namespace_use_clause");
    for (const clause of clauses) {
      const fqn = extractUseName(clause, "");
      const specifier = lastSegment(fqn);

      imports.push({
        source: fqn,
        specifiers: [specifier],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }
}
