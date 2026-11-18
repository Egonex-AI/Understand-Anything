import type { StructuralAnalysis } from "../types.js";
import type { TreeSitterNode as Node } from "./extractors/types.js";
import type { SymbolEvidenceEntry } from "./symbol-evidence.js";
import { declarationKey, declarationName } from "./symbol-ast.js";
import { CLASS_NODES, FUNCTION_NODES, UNKNOWN_SCOPE, type SymbolScope } from "./symbol-scopes.js";

/** Declaration surfaces handled by the inventory/effect adapters. Everything
 * else exposing a declaration name defaults to an explicit coverage gap. */
const HANDLED_NAMES = new Set([...CLASS_NODES, ...FUNCTION_NODES, "variable_declarator", "alias",
  "public_field_definition", "field_definition", "method_signature", "abstract_method_signature"]);
// Name fields used as references, type notation, parameters, or import/export
// metadata do not themselves declare a class or callable in the source file.
const NON_DECLARATION_NAMES = new Set(["export_specifier", "import_specifier", "import_statement", "import_from_statement",
  "future_import_statement", "aliased_import", "generic_type", "nested_type_identifier", "type_parameter",
  "type_predicate", "mapped_type_clause", "required_parameter", "optional_parameter", "default_parameter",
  "typed_default_parameter", "parameter_declaration", "keyword_argument", "keyword_parameter", "block_parameter",
  "hash_splat_parameter", "splat_parameter", "scope_resolution", "variable_reference_pattern", "as_pattern",
  "enum_assignment", "enum_body"]);
const OPAQUE_DECLARATIONS = new Set(["macro_invocation", "preproc_call", "preproc_function_def"]);
export const COVERAGE_LANGUAGES = new Set(["javascript", "typescript", "tsx", "ruby", "python", "go", "rust", "cpp"]);

export function declarationGap(node: Node, scope: SymbolScope, receiver: SymbolScope): SymbolEvidenceEntry | null {
  const range: [number, number] = [node.startPosition.row + 1, node.endPosition.row + 1];
  // TypeScript parameter properties have both parameter-binding and class-
  // member roles. Their declaration target is the indexed receiver scope.
  if (["required_parameter", "optional_parameter"].includes(node.type)
    && node.children.some(child => ["accessibility_modifier", "readonly", "override_modifier", "override"].includes(child.type))) {
    return { kind: "callable", scope: receiver,
      name: declarationName(node.childForFieldName("pattern") ?? declarationKey(node)), lineRange: range,
      reason: "Parameter-property callability is not covered by structural extraction" };
  }
  if (OPAQUE_DECLARATIONS.has(node.type)) return { kind: null, scope: UNKNOWN_SCOPE, name: null,
    lineRange: range, reason: `Declaration expansion is not verified: ${node.type}` };
  const name = declarationKey(node);
  if (!name || HANDLED_NAMES.has(node.type) || NON_DECLARATION_NAMES.has(node.type)) return null;
  return { kind: null, scope, name: declarationName(name), lineRange: range,
    reason: `Declaration surface is not covered: ${node.type}` };
}

/** Line-level structural coverage: how much of a file the structure accounts for. */
export interface StructuralLineCoverage {
  totalLines: number;
  /** Lines inside functions, classes, imports or exports. */
  symbolLines: number;
  /** Lines inside top-level segments that are not already symbol lines. */
  topLevelLines: number;
  /** Union of symbol and top-level lines. */
  coveredLines: number;
  /** coveredLines / totalLines (1 for an empty file). */
  ratio: number;
}

/**
 * Count the lines the structural analysis accounts for. Top-level segments
 * (module-scope code between symbols) count as covered, so entry-point and
 * wiring files are no longer reported as mostly uncovered.
 */
export function structuralLineCoverage(structure: StructuralAnalysis, totalLines: number): StructuralLineCoverage {
  const symbol = new Set<number>();
  const topLevel = new Set<number>();
  const add = (set: Set<number>, [start, end]: [number, number]) => {
    for (let line = Math.max(1, start); line <= Math.min(totalLines, end); line++) set.add(line);
  };
  for (const fn of structure.functions) add(symbol, fn.lineRange);
  for (const cls of structure.classes) add(symbol, cls.lineRange);
  for (const imp of structure.imports) add(symbol, [imp.lineNumber, imp.lineNumber]);
  for (const exp of structure.exports) add(symbol, [exp.lineNumber, exp.lineNumber]);
  for (const seg of structure.topLevel ?? []) add(topLevel, seg.lineRange);
  let topLevelOnly = 0;
  for (const line of topLevel) if (!symbol.has(line)) topLevelOnly++;
  const covered = symbol.size + topLevelOnly;
  return { totalLines, symbolLines: symbol.size, topLevelLines: topLevelOnly, coveredLines: covered,
    ratio: totalLines === 0 ? 1 : covered / totalLines };
}
