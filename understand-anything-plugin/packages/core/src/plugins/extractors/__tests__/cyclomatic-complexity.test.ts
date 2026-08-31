import { describe, it, expect } from "vitest";
import type { TreeSitterNode } from "../types.js";
import {
  computeCyclomaticComplexity,
  branchTypeMatcher,
} from "../base-extractor.js";

/**
 * Minimal in-memory TreeSitterNode-shaped fixture so we can unit-test the
 * cyclomatic-complexity helper without standing up an actual tree-sitter
 * grammar. We only need `.type`, `.child(i)`, and `.childCount` —
 * `computeCyclomaticComplexity` doesn't touch position/text/parent fields.
 */
function node(type: string, ...children: TreeSitterNode[]): TreeSitterNode {
  return {
    type,
    childCount: children.length,
    child(i: number) {
      return children[i] ?? null;
    },
  } as unknown as TreeSitterNode;
}

describe("computeCyclomaticComplexity", () => {
  const isBranch = branchTypeMatcher(
    new Set(["if_statement", "for_statement", "boolean_operator"]),
  );

  it("returns 1 for a function with no branches (single linear path)", () => {
    // McCabe baseline: a function with no decision points has complexity 1.
    const root = node("function_body", node("return_statement"));
    expect(computeCyclomaticComplexity(root, isBranch)).toBe(1);
  });

  it("adds 1 for each branch node found in the subtree", () => {
    const root = node(
      "function_body",
      node("if_statement"),
      node("for_statement"),
    );
    expect(computeCyclomaticComplexity(root, isBranch)).toBe(3);
  });

  it("counts branches at any depth, not just direct children", () => {
    // if { if { ... } } — two decisions even though they're nested.
    const root = node(
      "function_body",
      node("if_statement", node("block", node("if_statement"))),
    );
    expect(computeCyclomaticComplexity(root, isBranch)).toBe(3);
  });

  it("counts boolean operators (`and`/`or`) — McCabe-strict", () => {
    // if (a and b) → if_statement contains a boolean_operator: complexity = 3.
    const root = node(
      "function_body",
      node("if_statement", node("boolean_operator")),
    );
    expect(computeCyclomaticComplexity(root, isBranch)).toBe(3);
  });

  it("does not count nodes outside the configured branch type set", () => {
    const root = node(
      "function_body",
      node("call_expression"),
      node("variable_declaration"),
      node("return_statement"),
    );
    expect(computeCyclomaticComplexity(root, isBranch)).toBe(1);
  });

  it("supports a predicate that inspects child nodes (for binary_expression operators)", () => {
    // Mirror the TypeScript case: `binary_expression` only counts when one of
    // its children is `&&` / `||` / `??`. Arithmetic `+` should not count.
    const shortCircuit = new Set(["&&", "||"]);
    const isTypescriptBranchLike = (n: TreeSitterNode): boolean => {
      if (n.type === "if_statement") return true;
      if (n.type === "binary_expression") {
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i);
          if (child && shortCircuit.has(child.type)) return true;
        }
      }
      return false;
    };

    // (a && b) under an if — should count: if=1, && via binary_expression=1, base=1 → 3
    const root = node(
      "function_body",
      node(
        "if_statement",
        node(
          "binary_expression",
          node("identifier"),
          node("&&"),
          node("identifier"),
        ),
      ),
    );
    expect(computeCyclomaticComplexity(root, isTypescriptBranchLike)).toBe(3);

    // (a + b) — should NOT count the binary_expression. base=1.
    const arithmeticOnly = node(
      "function_body",
      node(
        "binary_expression",
        node("identifier"),
        node("+"),
        node("identifier"),
      ),
    );
    expect(computeCyclomaticComplexity(arithmeticOnly, isTypescriptBranchLike)).toBe(1);
  });
});
