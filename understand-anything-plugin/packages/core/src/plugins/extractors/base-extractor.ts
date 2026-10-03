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

/**
 * Extract the raw inner text of a string-like node, with quotes stripped.
 *
 * This concatenates the text of all `string_fragment` / `escape_sequence`
 * children so the full value is preserved across escape sequences (e.g.
 * `'./a\tb'` yields `./a\tb`, not the truncated `./a`). Escape sequences are
 * returned verbatim (the literal `\` + `t`), NOT decoded into control
 * characters — callers must not assume a fully-decoded value.
 *
 * The recognized child node types (`string_fragment`, `escape_sequence`) are
 * those produced by the JS/TS-family grammars. Other grammars name their
 * content nodes differently (e.g. Python `string_content`, Go/Rust string
 * literal children), so for those a string node has no matching children and
 * the function falls back to stripping a single pair of surrounding
 * `'`, `"`, or `` ` `` quotes from `node.text`. Extending the recognized set
 * is left to the extractor PRs that actually need it.
 */
export function getStringValue(node: TreeSitterNode): string {
  let value = "";
  let found = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && (child.type === "string_fragment" || child.type === "escape_sequence")) {
      value += child.text;
      found = true;
    }
  }
  if (found) return value;
  // Fallback for grammars without JS-family content nodes: strip surrounding quotes.
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
