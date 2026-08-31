import type { TreeSitterNode } from "./types.js";

/** Recursively traverse an AST tree, calling the visitor for each node. */
export function traverse(
  node: TreeSitterNode,
  visitor: (node: TreeSitterNode) => void,
): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverse(child, visitor);
  }
}

/** Extract the unquoted string value from a string-like node. */
export function getStringValue(node: TreeSitterNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "string_fragment") {
      return child.text;
    }
  }
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

/** Find the first child matching a type. */
export function findChild(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

/** Find all children matching a type. */
export function findChildren(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

/** Check if a node has a child of the given type (used for export/visibility checks). */
export function hasChildOfType(node: TreeSitterNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return true;
  }
  return false;
}

/**
 * Compute McCabe-style cyclomatic complexity for a syntax subtree.
 *
 * Counts the number of linearly-independent paths through the code by
 * starting at 1 and adding 1 for every "branching" AST node — `if`, `for`,
 * `while`, `case`, `catch`, ternary, short-circuit boolean operator, etc.
 * The exact set of node types is language-specific, so the caller supplies
 * an `isBranch` predicate that knows its grammar's terminology.
 *
 * Per the original McCabe definition, short-circuit boolean operators
 * (`&&`, `||`, `and`, `or`) DO count, because each one introduces an
 * additional decision point at runtime. Languages where these are exposed
 * as a dedicated AST node (e.g. tree-sitter-python's `boolean_operator`)
 * can include the type by name. Languages where they share a `binary_expression`
 * node with arithmetic operators have to inspect the operator child — which
 * is why this helper takes a predicate, not just a Set of type names.
 *
 * Side-effect-free and O(N) over the subtree; passing the function body
 * (not the entire file) keeps it cheap even for large source files.
 */
export function computeCyclomaticComplexity(
  node: TreeSitterNode,
  isBranch: (node: TreeSitterNode) => boolean,
): number {
  let count = 1;
  traverse(node, (n) => {
    if (isBranch(n)) count++;
  });
  return count;
}

/**
 * Convenience wrapper: build an `isBranch` predicate from a plain Set of
 * node type names. The common case for languages whose grammar exposes
 * branches as distinct node types (Go, Python via `boolean_operator`, etc.).
 */
export function branchTypeMatcher(
  branchTypes: ReadonlySet<string>,
): (node: TreeSitterNode) => boolean {
  return (node) => branchTypes.has(node.type);
}
