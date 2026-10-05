import type { TreeSitterNode as Node } from "./extractors/types.js";

export function unescaped(text: string): boolean {
  return !text.includes("\\") && !text.includes("`") && !text.startsWith("@")
    && !text.startsWith("r#") && text.normalize("NFKC") === text;
}
export function literal(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "simple_symbol") return unescaped(node.text) ? node.text.slice(1) : null;
  if (["string", "delimited_symbol"].includes(node.type)) {
    if (!unescaped(node.text) || node.namedChildren.some(child =>
      !["string_fragment", "string_content", "string_start", "string_end"].includes(child.type)
      || child.namedChildren.length > 0)) return null;
    return node.namedChildren.filter(child => ["string_fragment", "string_content"].includes(child.type))
      .map(child => child.text).join("");
  }
  return null;
}
export function identifier(node: Node | null | undefined): string | null {
  return node && ["identifier", "property_identifier", "private_property_identifier", "field_identifier", "type_identifier", "constant",
    "simple_identifier", "scope_resolution", "scoped_type_identifier", "qualified_identifier",
    "shorthand_property_identifier", "shorthand_property_identifier_pattern"].includes(node.type)
    && unescaped(node.text) ? node.text : null;
}
export function declarationName(node: Node | null | undefined): string | null {
  return identifier(node) ?? literal(node);
}
export function declarationKey(node: Node): Node | null {
  return node.childForFieldName("name")
    ?? (node.type === "field_definition" ? node.childForFieldName("property") : null);
}
export function unwrap(node: Node | null): Node | null {
  while (node && ["parenthesized_expression", "parenthesized_statements"].includes(node.type)
    && node.namedChildren.length === 1) node = node.namedChildren[0];
  return node;
}
export function classExpression(node: Node): boolean {
  return node.type === "class" && node.childForFieldName("body")?.type === "class_body";
}
