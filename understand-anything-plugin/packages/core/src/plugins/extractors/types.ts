import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";

/**
 * Synthetic caller used for calls made outside any named function
 * (module/file scope). Consumers map it to the file node itself.
 */
export const FILE_SCOPE_CALLER = "<file>";

// Re-export the tree-sitter Node type for use by extractors
export type TreeSitterNode = import("web-tree-sitter").Node;

/**
 * Language-specific extractor that maps a tree-sitter AST
 * to the common StructuralAnalysis / CallGraphEntry types.
 */
export interface LanguageExtractor {
  /** Language IDs this extractor handles (must match LanguageConfig.id) */
  languageIds: string[];

  /** Extract functions, classes, imports, exports from the root AST node */
  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis;

  /** Extract caller→callee relationships from the root AST node */
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[];
}
