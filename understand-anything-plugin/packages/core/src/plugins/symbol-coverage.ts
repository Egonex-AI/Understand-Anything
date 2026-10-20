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
