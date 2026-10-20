import type { StructuralAnalysis } from "../types.js";
import { COVERAGE_LANGUAGES, declarationGap } from "./symbol-coverage.js";
import type { TreeSitterNode as Node } from "./extractors/types.js";
import { classExpression, declarationKey, declarationName, identifier, literal, unescaped, unwrap } from "./symbol-ast.js";
import { buildSymbolScopes, CLASS_NODES, FUNCTION_NODES, FILE_SCOPE, UNKNOWN_SCOPE, namedScope,
  type SymbolScope } from "./symbol-scopes.js";

/** Runtime possibilities and declaration coverage use explicit scope kinds. */
export interface SymbolEvidenceEntry {
  kind: "callable" | "class" | null;
  scope: SymbolScope;
  name: string | null;
  nameSuffix?: string;
  lineRange: [number, number];
  reason: string;
}
export interface SymbolEvidence {
  version: 2;
  effects: SymbolEvidenceEntry[];
  functions: Array<{ name: string; scope: SymbolScope; lineRange: [number, number] }>;
  classes: Array<{ name: string; scope: SymbolScope; lineRange: [number, number] }>;
  coverage: { profile: "structural-declarations-v1"; gaps: SymbolEvidenceEntry[] };
}

const ACCESSORS = new Set(["attr", "attr_reader", "attr_writer", "attr_accessor"]);
const RUBY_INSTALLERS = new Set([...ACCESSORS, "define_method", "define_singleton_method", "alias_method"]);
const EVALUATORS = new Set(["eval", "exec", "Function", "class_eval", "module_eval", "instance_eval",
  "class_exec", "module_exec", "instance_exec", "send", "public_send", "__send__"]);
const JS_INSTALLERS = new Set(["defineProperty", "defineProperties", "__defineGetter__", "__defineSetter__"]);
const PY_INSTALLERS = new Set(["setattr", "__setattr__", "new_class"]);
const JS_EVALUATORS = new Set(["eval", "Function"]);
const PY_EVALUATORS = new Set(["eval", "exec"]);

function member(node: Node | null): { object: Node | null; name: string | null } | null {
  node = unwrap(node);
  if (!node) return null;
  if (["member_expression", "attribute"].includes(node.type)) {
    return { object: node.childForFieldName("object"), name: identifier(node.childForFieldName("property")
      ?? node.childForFieldName("attribute")) };
  }
  if (["subscript_expression", "subscript"].includes(node.type)) {
    return { object: node.childForFieldName("object") ?? node.childForFieldName("value"),
      name: literal(node.childForFieldName("index") ?? node.childForFieldName("subscript")) };
  }
  return null;
}

/** One AST walk emits scoped possibilities, never file-wide text matches. */
export function collectSymbolEvidence(root: Node, structure: StructuralAnalysis, language: string): SymbolEvidence {
  const effects: SymbolEvidenceEntry[] = [];
  const isJS = ["javascript", "typescript", "tsx"].includes(language);
  const isRuby = language === "ruby";
  const isPython = language === "python";
  const scopes = buildSymbolScopes(root, language);
  const coverage: SymbolEvidence["coverage"] = { profile: "structural-declarations-v1", gaps: [] };
  const classes: SymbolEvidence["classes"] = [];
  const functions: SymbolEvidence["functions"] = [];
  const matchedFunctions = new Set<number>();
  const classScopes = new Map<string, SymbolScope>();
  const handledReferences = new Set<number>();
  const add = (node: Node, scope: SymbolScope, name: string | null, reason: string,
    kind: SymbolEvidenceEntry["kind"] = "callable", nameSuffix?: string) => {
    effects.push({ kind, scope, name, ...(nameSuffix ? { nameSuffix } : {}),
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1], reason });
  };
  const cover = (node: Node, scope: SymbolScope, name: string | null, reason: string,
    kind: SymbolEvidenceEntry["kind"] = "callable") => {
    coverage.gaps.push({ kind, scope, name, lineRange: [node.startPosition.row + 1, node.endPosition.row + 1], reason });
  };
  const consume = (node: Node | null) => {
    if (!node) return;
    const pending = [node];
    while (pending.length) { const item = pending.pop()!; handledReferences.add(item.id); pending.push(...item.namedChildren); }
  };
  const targetOwner = (target: Node | null, context: Node): SymbolScope => {
    target = unwrap(target);
    const name = identifier(target);
    if (name) return scopes.reference(target!, name);
    if (target && ["self", "this"].includes(target.text)) {
      const receiver = scopes.receiver(context);
      return receiver.kind === "file" ? UNKNOWN_SCOPE : receiver;
    }
    const access = member(target);
    if (access?.name === "prototype" || access?.name === "__dict__") return targetOwner(access.object, context);
    return UNKNOWN_SCOPE;
  };
  const objectKeys = (object: Node | undefined, owner: SymbolScope, context: Node) => {
    if (!object || !["object", "dictionary"].includes(object.type)) {
      add(context, owner, null, "Unresolved property descriptor collection", null); return;
    }
    for (const field of object.namedChildren) {
      const key = field.childForFieldName("key") ?? field.childForFieldName("name")
        ?? (field.type === "shorthand_property_identifier" ? field : null);
      const computed = key?.type === "computed_property_name";
      add(field, owner, computed ? literal(key.namedChildren[0]) : declarationName(key), "Runtime property definition", null);
    }
  };
  const visit = (node: Node) => {
    const owner = scopes.declaration(node);
    const gap = declarationGap(node, owner, scopes.receiver(node));
    if (gap) coverage.gaps.push(gap);
    const declared = declarationKey(node);
    const declaredName = declared?.type === "computed_property_name" ? literal(declared.namedChildren[0]) : declarationName(declared);
    const objectMethod = isJS && node.type === "method_definition" && node.parent?.type === "object";
    const localDeclaration = owner.kind === "local";
    if (node !== root && CLASS_NODES.has(node.type)) {
      const target = scopes.classTarget(node);
      const classScope = target.kind === "class" ? FILE_SCOPE : target;
      const className = classExpression(node) ? target.kind === "class" ? target.name : null : declaredName;
      if (declaredName) {
        classScopes.set(JSON.stringify([declaredName, node.startPosition.row + 1, node.endPosition.row + 1]), target);
        classes.push({ name: declaredName, scope: classScope, lineRange: [node.startPosition.row + 1, node.endPosition.row + 1] });
      }
      if (!structure.classes.some(cls => cls.name === className && cls.lineRange[0] === node.startPosition.row + 1
        && cls.lineRange[1] === node.endPosition.row + 1)) {
        coverage.gaps.push({ kind: "class", scope: classScope, name: className,
          lineRange: [node.startPosition.row + 1, node.endPosition.row + 1], reason: "Class declaration is not covered by structural extraction" });
      }
    }
    if (FUNCTION_NODES.has(node.type) && !objectMethod) {
      const valueFunction = ["arrow_function", "function_expression", "generator_function", "lambda"].includes(node.type);
      const name = valueFunction ? identifier(node.parent?.childForFieldName("name")) : declaredName;
      const matches = structure.functions.map((fn, index) => ({ fn, index })).filter(({ fn }) => fn.owner === undefined
        && (fn.name === name || node.type === "singleton_method" && fn.name === `self.${name}`)
        && fn.lineRange[0] === node.startPosition.row + 1 && fn.lineRange[1] === node.endPosition.row + 1);
      if (matches.length) {
        let scope = owner;
        if (node.type === "singleton_method") {
          const receiver = node.childForFieldName("object") ?? node.childForFieldName("receiver");
          scope = receiver?.text === "self" ? owner : targetOwner(receiver, node);
        }
        functions.push({ name: matches[0].fn.name, scope,
          lineRange: [node.startPosition.row + 1, node.endPosition.row + 1] });
        for (const { index } of matches) matchedFunctions.add(index);
      }
      const detailed = structure.functions.some(fn => fn.owner !== undefined
        && fn.lineRange[0] === node.startPosition.row + 1 && fn.lineRange[1] === node.endPosition.row + 1);
      const inventoriedMethod = name !== null && owner.kind === "class"
        && structure.classes.some(cls => cls.name === owner.name && cls.methods.includes(name));
      if ((!valueFunction || name !== null) && !matches.length && !detailed && !inventoriedMethod) coverage.gaps.push({ kind: "callable", scope: owner, name,
        lineRange: [node.startPosition.row + 1, node.endPosition.row + 1], reason: "Callable declaration is not covered by structural extraction" });
    }
    // Escaped/opaque declaration spellings cannot establish absence. Ordinary
    // identifiers, references and string literals do not imply declarations.
    if (declared && !objectMethod && !localDeclaration && !classExpression(node)
      && (CLASS_NODES.has(node.type) || FUNCTION_NODES.has(node.type))
      && declaredName === null) {
      cover(declared, CLASS_NODES.has(node.type) ? FILE_SCOPE : owner, null, "Unresolved declaration name",
        CLASS_NODES.has(node.type) ? "class" : "callable");
    }
    if (owner.kind === "unknown" && !objectMethod && !localDeclaration && FUNCTION_NODES.has(node.type) && declaredName !== null) {
      cover(node, UNKNOWN_SCOPE, declaredName, "Unresolved declaring type");
    }
    if (isJS && !objectMethod && node.type === "method_definition" && declared?.type === "string") {
      cover(node, owner, literal(declared), "Quoted method declaration");
    }
    if (isJS && ["public_field_definition", "field_definition", "method_signature", "abstract_method_signature"].includes(node.type)) {
      const name = declarationKey(node);
      cover(node, owner, name?.type === "computed_property_name" ? literal(name.namedChildren[0]) : declarationName(name),
        "Class member not verified by structural extraction");
    }
    if (isJS && node.type === "computed_property_name" && node.parent?.type === "method_definition"
      && node.parent.parent?.type === "class_body") {
      cover(node, owner, literal(node.namedChildren[0]), "Computed method declaration");
    }
    if ((isJS || isPython) && ["assignment_expression", "augmented_assignment_expression", "assignment", "augmented_assignment",
      "variable_declarator"].includes(node.type)) {
      const target = node.childForFieldName("left") ?? node.childForFieldName("name");
      const inspect = (part: Node) => {
        const access = member(part);
        if (access) {
          if (isJS && access.name === "prototype") objectKeys(node.childForFieldName("right")
            ?? node.childForFieldName("value") ?? undefined, targetOwner(access.object, node), node);
          else add(part, targetOwner(access.object, node), access.name, "Property assignment", null);
        } else if (identifier(part) && !localDeclaration) {
          add(part, owner, identifier(part), "Binding assignment", null);
        } else if (["object_pattern", "array_pattern", "pair_pattern", "parenthesized_expression"].includes(part.type)) {
          const value = part.childForFieldName("value");
          for (const child of value ? [value] : part.namedChildren) inspect(child);
        }
      };
      if (target) inspect(target);
    }
    if (isRuby && node.type === "alias" && declared?.type !== "global_variable") {
      add(node, owner, declarationName(declared), "Ruby alias declaration");
    }
    if (isRuby && node.type === "call") {
      const methodNode = node.childForFieldName("method");
      const method = methodNode?.text;
      const args = [...(node.childForFieldName("arguments")?.namedChildren ?? [])];
      const receiver = node.childForFieldName("receiver");
      const boundOwner = !receiver || receiver.text === "self" ? scopes.receiver(node) : targetOwner(receiver, node);
      if (method && RUBY_INSTALLERS.has(method)) {
        consume(methodNode);
        if (ACCESSORS.has(method)) {
          let writer = ["attr_writer", "attr_accessor"].includes(method);
          if (method === "attr" && args.length === 2 && ["true", "false"].includes(args[1].type)) writer = args.pop()!.type === "true";
          for (const arg of args) {
            const name = literal(arg);
            if (method !== "attr_writer") add(arg, boundOwner, name, "Ruby accessor reader");
            if (writer) add(arg, boundOwner, name === null ? null : `${name}=`, "Ruby accessor writer", "callable", name === null ? "=" : undefined);
          }
        } else if (args.length) {
          const name = literal(args[0]);
          add(node, boundOwner, method === "define_singleton_method" && name !== null ? `self.${name}` : name, "Ruby method installer");
        }
      } else if (method && ["method", "public_method", "instance_method", "public_instance_method", "singleton_method"].includes(method) && args.length) {
        const name = literal(args[0]);
        if (name === null || RUBY_INSTALLERS.has(name)) add(node, method.includes("instance_method") ? UNKNOWN_SCOPE : boundOwner, null, "Indirect method installer");
      } else if (method && EVALUATORS.has(method)) {
        consume(methodNode); add(node, UNKNOWN_SCOPE, null, "Dynamic dispatch or code evaluation", null);
      }
    }
    if ((isJS && node.type === "call_expression") || (isPython && node.type === "call")) {
      const callee = unwrap(node.childForFieldName("function"));
      const access = member(callee);
      const method = access?.name ?? identifier(callee);
      const args = node.childForFieldName("arguments")?.namedChildren ?? [];
      const directInstaller = method && (isJS ? JS_INSTALLERS.has(method) || method === "set"
        && access?.object?.text === "Reflect" : PY_INSTALLERS.has(method));
      if (directInstaller) {
        consume(callee);
        const namespace = access?.object;
        const standard = isJS
          ? namespace && scopes.unbound(namespace, namespace.text)
            && (namespace.text === "Object" && ["defineProperty", "defineProperties"].includes(method)
              || namespace.text === "Reflect" && ["defineProperty", "set"].includes(method))
          : !access && method === "setattr" && scopes.unbound(callee!, method);
        if (!standard) add(node, UNKNOWN_SCOPE, null, "Runtime installer identity is unresolved", null);
        else if (method === "defineProperties") objectKeys(args[1], targetOwner(args[0] ?? null, node), node);
        else add(node, targetOwner(args[0] ?? null, node), literal(args[1]), "Runtime property definition", null);
      } else if (isJS && method === "assign" && access?.object?.text === "Object") {
        consume(callee);
        if (!scopes.unbound(access.object, "Object")) add(node, UNKNOWN_SCOPE, null, "Runtime installer identity is unresolved", null);
        else for (const arg of args.slice(1)) objectKeys(arg, targetOwner(args[0] ?? null, node), node);
      } else if (method && ((isJS ? JS_EVALUATORS : PY_EVALUATORS).has(method) || isPython && method === "type" && args.length >= 3)) {
        consume(callee); add(node, UNKNOWN_SCOPE, null, "Dynamic code or class evaluation", null);
      } else if (access && access.name === null) {
        consume(callee); add(node, UNKNOWN_SCOPE, null, "Computed callee may select a runtime installer", null);
      }
    }
    // References to installers may escape through aliases. Direct calls were
    // already consumed and retain their more precise target/name evidence.
    if (!handledReferences.has(node.id)) {
      const access = member(node);
      if (isJS && access?.object?.text === "Reflect" && scopes.unbound(access.object, "Reflect")
        && ["get", "has", "ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf", "isExtensible"].includes(access.name ?? "")) {
        consume(node);
      } else if (isJS && access && (access.name !== null && JS_INSTALLERS.has(access.name)
        || access.object?.text === "Object" && (access.name === "assign" || access.name === null))) {
        consume(node); add(node, UNKNOWN_SCOPE, null, "Aliased property installer", null);
      } else if (isPython && access?.name === "__dict__") {
        consume(node); add(node, targetOwner(access.object, node), null, "Indirect attribute dictionary", null);
      } else if (node.type === "identifier" && node.parent?.childForFieldName("name")?.id !== node.id
        && (isJS && (JS_INSTALLERS.has(node.text) || node.text === "Reflect" || JS_EVALUATORS.has(node.text))
        || isPython && (PY_INSTALLERS.has(node.text) || ["exec", "eval", "globals", "locals", "vars"].includes(node.text)))) {
        add(node, UNKNOWN_SCOPE, null, "Aliased runtime installer or evaluation", null);
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  if (!isJS && !isRuby && !isPython) {
    // A callable may become an unextracted function-valued field. Retain the
    // extractor's property inventory as scoped possibilities, without treating
    // arbitrary identifier/string uses as declarations.
    for (const cls of structure.classes) for (const name of cls.properties) {
      coverage.gaps.push({ kind: "callable", scope: classScopes.get(JSON.stringify([cls.name, ...cls.lineRange])) ?? UNKNOWN_SCOPE,
        name: unescaped(name) ? name : null, lineRange: cls.lineRange, reason: "Property callability is not structurally verified" });
    }
  }
  for (const [index, fn] of structure.functions.entries()) {
    if (fn.owner === undefined && !matchedFunctions.has(index)) functions.push({ name: fn.name, scope: UNKNOWN_SCOPE, lineRange: fn.lineRange });
  }
  for (const fn of [...structure.functions.filter(fn => fn.owner !== undefined).map(fn => ({ ...fn, scope: namedScope(fn.owner ?? null) })), ...functions]) {
    // The C++ extractor can leave nested qualification in the function name
    // (N::A::run -> owner N, name A::run). That decomposition cannot prove
    // an inline A.run disappeared when its definition moved out of class.
    if (language === "cpp" && fn.name.includes("::")) coverage.gaps.push({ kind: "callable", scope: UNKNOWN_SCOPE,
      name: fn.name.split("::").at(-1) ?? null, lineRange: fn.lineRange,
      reason: "Unverified compound C++ qualification" });
    if (fn.scope.kind === "unknown") coverage.gaps.push({ kind: "callable", scope: UNKNOWN_SCOPE, name: fn.name,
      lineRange: fn.lineRange, reason: "Unresolved source receiver ownership" });
  }
  if (!COVERAGE_LANGUAGES.has(language)) {
    coverage.gaps.push({ kind: null, scope: UNKNOWN_SCOPE, name: null, lineRange: [1, root.endPosition.row + 1],
      reason: "This language has no verified declaration-coverage adapter" });
  }
  return { version: 2, effects, functions, classes, coverage };
}
