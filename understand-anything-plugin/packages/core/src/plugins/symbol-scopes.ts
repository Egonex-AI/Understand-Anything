import type { TreeSitterNode as Node } from "./extractors/types.js";
import { classExpression, identifier, unwrap } from "./symbol-ast.js";

/** Local scope is positive knowledge of separation, never a wildcard. */
export type SymbolScope =
  | { kind: "file" }
  | { kind: "class"; name: string }
  | { kind: "local"; id: number }
  | { kind: "unknown" };
export const FILE_SCOPE: SymbolScope = { kind: "file" };
export const UNKNOWN_SCOPE: SymbolScope = { kind: "unknown" };
export function namedScope(name: string | null): SymbolScope {
  return name === null ? UNKNOWN_SCOPE : name === "" ? FILE_SCOPE : { kind: "class", name };
}
export const CLASS_NODES = new Set(["class", "module", "class_declaration", "abstract_class_declaration", "class_definition", "class_specifier",
  "struct_specifier", "struct_declaration", "struct_item", "enum_item", "interface_declaration"]);
export const FUNCTION_NODES = new Set(["method", "singleton_method", "method_definition", "function_definition",
  "function_declaration", "generator_function_declaration", "generator_function", "function_item", "method_declaration", "constructor_declaration", "arrow_function", "function_expression", "lambda"]);
const METHODS = new Set(["method", "singleton_method", "method_definition", "method_declaration", "constructor_declaration"]);
type Target = () => SymbolScope;
const fixed = (value: SymbolScope): Target => () => value;
const fileTarget = fixed(FILE_SCOPE);
const unknownTarget = fixed(UNKNOWN_SCOPE);

interface Scope {
  id: number;
  parent: Scope | null;
  kind: "root" | "class" | "function" | "block" | "namespace";
  receiver: Target;
  localDeclarations: boolean;
  bindings: Map<string, Map<number, Target>>;
  unknownBindings: boolean;
}
interface ValueRegion { target: Target; directValue: number }
interface Facts { scope: Scope; declaration: Target; receiver: Target; classTarget?: Target }

/** A single traversal assigns lexical scopes and value regions. Queries below
 * use those facts; no consumer walks AST ancestors to invent ownership. */
export function buildSymbolScopes(root: Node, language: string) {
  const isJS = ["javascript", "typescript", "tsx"].includes(language);
  const facts = new Map<number, Facts>();
  const assignments: Array<{ node: Node; scope: Scope }> = [];
  const makeScope = (node: Node, parent: Scope | null, kind: Scope["kind"], receiver: Target,
    localDeclarations: boolean): Scope => ({ id: node.id, parent, kind, receiver, localDeclarations,
    bindings: new Map(), unknownBindings: false });
  const global = makeScope(root, null, "root", fileTarget, false);
  const local = (node: Node): Target => fixed({ kind: "local", id: node.id });
  const declarationScope = (scope: Scope): Target => scope.localDeclarations ? fixed({ kind: "local", id: scope.id }) : scope.receiver;
  const classBinding = (name: string | null, scope: Scope, node: Node): Target =>
    scope.kind === "root" ? fixed(namedScope(name)) : scope.kind === "namespace" ? unknownTarget : local(node);
  const targets = (node: Node | null): Array<string | null> => {
    if (!node) return [];
    const name = identifier(node);
    if (name) return [name];
    if (["identifier", "constant", "shorthand_property_identifier_pattern"].includes(node.type)) return [null];
    const pattern = node.childForFieldName("pattern") ?? node.childForFieldName("name")
      ?? node.childForFieldName("left") ?? node.childForFieldName("value");
    if (pattern) return targets(pattern);
    if (["formal_parameters", "parameters", "method_parameters", "object_pattern", "array_pattern", "pattern_list",
      "rest_pattern", "rest_parameter", "splat_parameter", "list_splat_pattern", "dictionary_splat_pattern"].includes(node.type)) return node.namedChildren.flatMap(targets);
    if (node.type === "typed_parameter") return targets(node.namedChildren[0] ?? null);
    return [];
  };
  const bind = (scope: Scope, name: string | null, node: Node, target: Target) => {
    if (name === null) { scope.unknownBindings = true; return; }
    if (!scope.bindings.has(name)) scope.bindings.set(name, new Map());
    scope.bindings.get(name)!.set(node.id, target);
  };
  const lookup = (start: Scope, name: string): { scope: Scope; values: Map<number, Target> } | null | undefined => {
    let scope: Scope | null = start;
    while (scope) {
      if (scope.unknownBindings) return null;
      const values = scope.bindings.get(name);
      if (values) return { scope, values };
      const leavingFunction = scope.kind === "function";
      scope = scope.parent;
      if (language === "python" && leavingFunction) while (scope?.kind === "class") scope = scope.parent;
    }
    return undefined;
  };
  const assignmentTarget = (node: Node | null, scope: Scope): Target => () => {
    const name = identifier(node);
    if (!name) return UNKNOWN_SCOPE;
    const found = lookup(scope, name);
    if (found === null) return UNKNOWN_SCOPE;
    return classBinding(name, found?.scope ?? global, node!)();
  };
  const scan = (node: Node, enclosing: Scope, region?: ValueRegion) => {
    let scope = enclosing;
    const declaration = declarationScope(enclosing);
    const isClass = node !== root && CLASS_NODES.has(node.type);
    const isFunction = FUNCTION_NODES.has(node.type);
    const expression = isJS && classExpression(node);
    const nameNode = node.childForFieldName("name");
    const name = identifier(nameNode);
    let classTarget: Target | undefined;
    if (isClass) {
      classTarget = expression ? !region ? local(node) : () => {
        const target = region.target();
        return region.directValue === node.id || target.kind === "local" ? target : UNKNOWN_SCOPE;
      } : classBinding(name, enclosing, node);
      // Expression names are internal; declaration names bind outside as well.
      if (!expression && nameNode) bind(enclosing, name, node, classTarget);
      scope = makeScope(node, enclosing, "class", classTarget, false);
      if (isJS && nameNode) bind(scope, name, node, classTarget);
    } else if (node.type === "singleton_class") {
      scope = makeScope(node, enclosing, "class", unknownTarget, false);
    } else if (isFunction) {
      const declaresBinding = !METHODS.has(node.type) && !["function_expression", "generator_function", "arrow_function", "lambda"].includes(node.type);
      if (declaresBinding && nameNode) bind(enclosing, name, node, unknownTarget);
      const receiver = isJS && !METHODS.has(node.type) && node.type !== "arrow_function" ? unknownTarget : enclosing.receiver;
      scope = makeScope(node, enclosing, "function", receiver, true);
      if (["function_expression", "generator_function"].includes(node.type) && nameNode) bind(scope, name, node, unknownTarget);
      for (const parameter of targets(node.childForFieldName("parameters"))) bind(scope, parameter, node, unknownTarget);
    } else if (isJS && ["statement_block", "class_static_block", "for_statement", "for_in_statement", "catch_clause", "switch_statement", "with_statement"].includes(node.type)) {
      scope = makeScope(node, enclosing, "block", enclosing.receiver, true);
    } else if (["namespace_definition", "namespace_declaration"].includes(node.type)) {
      scope = makeScope(node, enclosing, "namespace", unknownTarget, false);
    }
    facts.set(node.id, { scope, declaration, receiver: enclosing.receiver, classTarget });
    if (isJS && node.type === "with_statement") scope.unknownBindings = true;
    if (isJS && node.type === "catch_clause") {
      for (const parameter of targets(node.childForFieldName("parameter"))) bind(scope, parameter, node, unknownTarget);
    }
    if (node.type === "for_in_statement" || language === "python" && node.type === "for_statement") {
      for (const target of targets(node.childForFieldName("left"))) {
        const declared = node.childForFieldName("kind");
        const found = target && lookup(enclosing, target);
        const destination = !isJS ? scope : declared?.text === "var" ? enclosing
          : declared ? scope : found ? found.scope : global;
        bind(destination, target, node, unknownTarget);
      }
    }
    if (language === "python" && node.type === "as_pattern") {
      const alias = node.childForFieldName("alias");
      for (const part of alias?.namedChildren ?? []) if (part.type === "identifier") bind(scope, identifier(part), node, unknownTarget);
    }

    let value: Node | null = null;
    let valueRegion: ValueRegion | undefined;
    if (node.type === "variable_declarator") {
      let destination = scope;
      if (node.parent?.type === "variable_declaration") while (destination.kind === "block" && destination.parent) destination = destination.parent;
      value = node.childForFieldName("value");
      const direct = unwrap(value);
      const bindingName = identifier(node.childForFieldName("name"));
      const target = bindingName ? classBinding(bindingName, destination, node) : unknownTarget;
      for (const binding of targets(node.childForFieldName("name"))) bind(destination, binding, node,
        direct && classExpression(direct) && binding === bindingName ? target : unknownTarget);
      if (value) valueRegion = { target, directValue: direct!.id };
    } else if (isJS && ["assignment_expression", "augmented_assignment_expression"].includes(node.type)) {
      assignments.push({ node, scope });
      value = node.childForFieldName("right");
      if (value) valueRegion = { target: assignmentTarget(node.childForFieldName("left"), scope), directValue: unwrap(value)!.id };
    } else if (["assignment", "augmented_assignment"].includes(node.type) && !isJS) {
      for (const target of targets(node.childForFieldName("left"))) bind(scope, target, node, unknownTarget);
    }
    if (node.type === "global_statement") for (const part of node.namedChildren) {
      if (part.type === "identifier") bind(global, identifier(part), node, unknownTarget);
    }
    if (isJS && node.type === "import_specifier") {
      bind(scope, identifier(node.childForFieldName("alias") ?? node.childForFieldName("name")), node, unknownTarget);
    } else if (isJS && ["import_clause", "namespace_import", "import_require_clause"].includes(node.type)) {
      for (const part of node.namedChildren.filter(child => child.type === "identifier")) bind(scope, identifier(part), node, unknownTarget);
    } else if (language === "python" && ["import_statement", "import_from_statement"].includes(node.type)) {
      const module = node.childForFieldName("module_name");
      for (const part of node.namedChildren.filter(child => child.id !== module?.id)) {
        const imported = part.childForFieldName("name") ?? part;
        const name = part.childForFieldName("alias") ?? imported.namedChildren.find(child => child.type === "identifier") ?? imported;
        if (["identifier", "dotted_name", "aliased_import"].includes(part.type)) bind(scope, identifier(name), node, unknownTarget);
        else if (part.type === "wildcard_import") scope.unknownBindings = true;
      }
    }
    // Value propagation belongs to this region, never to an ancestor search.
    const fence = isClass || isFunction || ["public_field_definition", "field_definition", "pair", "object",
      "return_statement", "expression_statement", "class_static_block"].includes(node.type);
    for (const child of node.namedChildren) scan(child, scope, child.id === value?.id ? valueRegion : fence ? undefined : region);
  };
  scan(root, global);
  // Resolve writes after all declarations are indexed (including hoisted or
  // later lexical bindings), so traversal order cannot invent a known class.
  for (const { node, scope } of assignments) for (const name of targets(node.childForFieldName("left"))) {
    if (name === null) {
      for (let current: Scope | null = scope; current; current = current.parent) current.unknownBindings = true;
      continue;
    }
    const found = lookup(scope, name);
    if (found === null) continue;
    const right = unwrap(node.childForFieldName("right"));
    const target = right && classExpression(right) ? facts.get(right.id)?.classTarget ?? unknownTarget : unknownTarget;
    bind(found?.scope ?? global, name, node, target);
  }
  const get = (node: Node) => facts.get(node.id)!;
  return {
    declaration: (node: Node) => get(node).declaration(),
    receiver: (node: Node) => get(node).receiver(),
    classTarget: (node: Node) => get(node).classTarget?.() ?? UNKNOWN_SCOPE,
    reference(node: Node, name: string): SymbolScope {
      const found = lookup(get(node).scope, name);
      if (!found) return UNKNOWN_SCOPE;
      const distinct = new Map([...found.values.values()].map(resolve => { const value = resolve(); return [JSON.stringify(value), value]; }));
      return distinct.size === 1 ? [...distinct.values()][0] : UNKNOWN_SCOPE;
    },
    unbound: (node: Node, name: string) => lookup(get(node).scope, name) === undefined,
  };
}
