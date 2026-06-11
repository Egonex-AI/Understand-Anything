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

/** Compute McCabe-style cyclomatic complexity for a syntax subtree. */
export function computeCyclomaticComplexity(
  node: TreeSitterNode,
  branchTypes: readonly string[],
  branchTexts: readonly string[] = [],
): number {
  const branchTypeSet = new Set(branchTypes);
  const branchTextSet = new Set(branchTexts);
  let count = 1;

  traverse(node, (current) => {
    if (branchTypeSet.has(current.type)) {
      count++;
      return;
    }

    if (branchTextSet.size > 0) {
      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i);
        if (child && branchTextSet.has(child.text)) {
          count++;
        }
      }
    }
  });

  return count;
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
