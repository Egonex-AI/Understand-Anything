import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

/**
 * Set of method names that Ruby uses for imports.
 * These are handled separately from regular call graph entries.
 */
const IMPORT_METHODS = new Set(["require", "require_relative"]);

/**
 * Set of method names that define class properties (attr_* macros).
 * Their arguments are symbols that become accessor methods / properties.
 */
const ATTR_METHODS = new Set(["attr_accessor", "attr_reader", "attr_writer"]);

/**
 * ActiveSupport::Concern block calls whose `def`s belong to the enclosing
 * module: `class_methods do` defines class methods, `included do` instance methods.
 */
const CLASS_METHOD_BLOCK_CALLS = new Set(["class_methods"]);
const METHOD_BLOCK_CALLS = new Set(["included", ...CLASS_METHOD_BLOCK_CALLS]);

type RubyFunction = StructuralAnalysis["functions"][number];
type RubyClass = StructuralAnalysis["classes"][number];

interface ExtractionTarget {
  classes: RubyClass[];
  functions: RubyFunction[];
}

function lineRangeOf(node: TreeSitterNode): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

function isSelf(node: TreeSitterNode | null): boolean {
  return node?.type === "self";
}

/**
 * Whether a `def` defines a class method because it sits inside
 * `class << self` or a Concern `class_methods do` block.
 */
function isClassMethodContext(node: TreeSitterNode): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    switch (cur.type) {
      case "class":
      case "module":
        return false;
      case "singleton_class":
        return isSelf(cur.childForFieldName("value"));
      case "call":
        if (CLASS_METHOD_BLOCK_CALLS.has(cur.childForFieldName("method")?.text ?? "")) {
          return true;
        }
        break;
    }
  }
  return false;
}

/**
 * Extract parameter names from a Ruby `method_parameters` node.
 *
 * Handles: identifier (plain), optional_parameter (with default),
 * splat_parameter (*args), hash_splat_parameter (**kwargs),
 * block_parameter (&block).
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    switch (child.type) {
      case "identifier":
        params.push(child.text);
        break;

      case "optional_parameter": {
        const ident = child.childForFieldName("name");
        if (ident) params.push(ident.text);
        break;
      }

      case "splat_parameter": {
        const ident = child.childForFieldName("name");
        if (ident) params.push("*" + ident.text);
        break;
      }

      case "hash_splat_parameter": {
        const ident = child.childForFieldName("name");
        if (ident) params.push("**" + ident.text);
        break;
      }

      case "block_parameter": {
        const ident = child.childForFieldName("name");
        if (ident) params.push("&" + ident.text);
        break;
      }
    }
  }

  return params;
}

/**
 * Extract property names from attr_accessor/attr_reader/attr_writer calls.
 * These calls take symbol arguments like `:name, :email`.
 */
function extractAttrProperties(callNode: TreeSitterNode): string[] {
  const properties: string[] = [];
  const args = callNode.childForFieldName("arguments");
  if (!args) return properties;

  for (let i = 0; i < args.childCount; i++) {
    const child = args.child(i);
    if (child && child.type === "simple_symbol") {
      // Strip leading colon from `:name` -> `name`
      properties.push(child.text.slice(1));
    }
  }

  return properties;
}

/**
 * Extract the string value from a Ruby string node.
 * Ruby strings have a `string_content` child containing the unquoted value.
 */
function getStringContent(node: TreeSitterNode): string {
  const content = findChild(node, "string_content");
  if (content) return content.text;
  // Fallback: strip surrounding quotes
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

/**
 * Ruby extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles methods, classes, modules, require imports, and call graphs
 * for Ruby source code.
 *
 * Ruby-specific mapping decisions:
 * - Both `class` and `module` nodes are mapped to the `classes` array.
 * - Nested classes/modules are emitted with fully qualified names
 *   (`Outer::Inner`); the outer namespaces are emitted as well.
 * - Class methods are prefixed with "self.": `def self.foo`, defs inside
 *   `class << self`, and defs inside Concern `class_methods do` blocks.
 * - Defs inside Concern `included do` blocks are instance methods.
 * - `attr_accessor`/`attr_reader`/`attr_writer` define properties on classes.
 * - `require` and `require_relative` calls are mapped to imports.
 * - All top-level definitions (classes, modules, methods) are treated as exports,
 *   since Ruby has no formal export syntax.
 */
export class RubyExtractor implements LanguageExtractor {
  readonly languageIds = ["ruby"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "method":
        case "singleton_method": {
          const fn = this.toFunction(node);
          if (fn) functions.push(fn);
          exports.push({
            name: this.getMethodName(node),
            lineNumber: node.startPosition.row + 1,
          });
          break;
        }

        case "class":
        case "module":
          this.extractNamespace(node, "", { classes, functions });
          exports.push({
            name: this.getDefinitionName(node),
            lineNumber: node.startPosition.row + 1,
          });
          break;

        case "call":
          this.extractTopLevelCall(node, imports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering method definitions
      if (node.type === "method" || node.type === "singleton_method") {
        const name = this.getMethodName(node);
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
      }

      // Extract call expressions (but not imports or attr_* macros)
      if (node.type === "call") {
        const methodNode = node.childForFieldName("method");
        if (methodNode && functionStack.length > 0) {
          const methodName = methodNode.text;

          // Skip require/require_relative (imports) and attr_* macros
          if (!IMPORT_METHODS.has(methodName) && !ATTR_METHODS.has(methodName)) {
            const receiverNode = node.childForFieldName("receiver");
            const callee = receiverNode
              ? receiverNode.text + "." + methodName
              : methodName;

            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      // Ruby bare method calls without arguments (e.g., `setup`) are parsed as
      // `identifier` nodes inside `body_statement`, not as `call` nodes.
      // Treat them as calls when inside a function context.
      if (
        node.type === "identifier" &&
        node.parent?.type === "body_statement" &&
        functionStack.length > 0
      ) {
        entries.push({
          caller: functionStack[functionStack.length - 1],
          callee: node.text,
          lineNumber: node.startPosition.row + 1,
        });
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkForCalls(child);
      }

      if (pushedName) {
        functionStack.pop();
      }
    };

    walkForCalls(rootNode);

    return entries;
  }

  // ---- Private helpers ----

  private getDefinitionName(node: TreeSitterNode): string {
    const nameNode = node.childForFieldName("name");
    // Can be `constant` ("Foo") or `scope_resolution` ("Foo::Bar")
    return nameNode ? nameNode.text : "";
  }

  /** Method name as exposed in the graph: class methods get a "self." prefix. */
  private getMethodName(node: TreeSitterNode): string {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return "";
    const isClassMethod =
      node.type === "singleton_method" || isClassMethodContext(node);
    return isClassMethod ? "self." + nameNode.text : nameNode.text;
  }

  private toFunction(node: TreeSitterNode): RubyFunction | null {
    const name = this.getMethodName(node);
    if (!name) return null;

    const paramsNode = node.childForFieldName("parameters");
    return {
      name,
      lineRange: lineRangeOf(node),
      params: extractParams(paramsNode ?? null),
    };
  }

  /**
   * Record a class/module under its fully qualified name, then walk its body
   * so nested definitions are qualified with this name as their scope.
   */
  private extractNamespace(
    node: TreeSitterNode,
    scope: string,
    target: ExtractionTarget,
  ): void {
    const localName = this.getDefinitionName(node);
    if (!localName) return;

    const entry: RubyClass = {
      name: scope ? `${scope}::${localName}` : localName,
      lineRange: lineRangeOf(node),
      methods: [],
      properties: [],
    };
    target.classes.push(entry);

    const body = node.childForFieldName("body");
    if (body) this.extractBody(body, entry, target);
  }

  /**
   * Extract members of a class/module body into `owner`, recursing into
   * nested definitions, `class << self` and Concern method blocks.
   */
  private extractBody(
    body: TreeSitterNode,
    owner: RubyClass,
    target: ExtractionTarget,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i);
      if (!member) continue;

      switch (member.type) {
        case "method":
        case "singleton_method":
          this.addMethod(member, owner, target.functions);
          break;
        case "class":
        case "module":
          this.extractNamespace(member, owner.name, target);
          break;
        case "singleton_class":
          if (isSelf(member.childForFieldName("value"))) {
            this.extractNestedBody(member, owner, target);
          }
          break;
        case "call":
          this.extractBodyCall(member, owner, target);
          break;
      }
    }
  }

  private extractBodyCall(
    call: TreeSitterNode,
    owner: RubyClass,
    target: ExtractionTarget,
  ): void {
    const methodName = call.childForFieldName("method")?.text ?? "";
    if (ATTR_METHODS.has(methodName)) {
      owner.properties.push(...extractAttrProperties(call));
      return;
    }

    const block = call.childForFieldName("block");
    if (block && METHOD_BLOCK_CALLS.has(methodName)) {
      this.extractNestedBody(block, owner, target);
    }
  }

  /** Walk the body of a `class << self` or block as part of `owner`. */
  private extractNestedBody(
    node: TreeSitterNode,
    owner: RubyClass,
    target: ExtractionTarget,
  ): void {
    const body = node.childForFieldName("body");
    if (body) this.extractBody(body, owner, target);
  }

  private addMethod(
    node: TreeSitterNode,
    owner: RubyClass,
    functions: RubyFunction[],
  ): void {
    const fn = this.toFunction(node);
    if (!fn) return;
    owner.methods.push(fn.name);
    functions.push(fn);
  }

  /**
   * Handle top-level call nodes: extract require/require_relative as imports.
   */
  private extractTopLevelCall(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const methodNode = node.childForFieldName("method");
    if (!methodNode) return;

    if (IMPORT_METHODS.has(methodNode.text)) {
      const args = node.childForFieldName("arguments");
      if (!args) return;

      // The first argument is typically the string source
      const firstArg = findChild(args, "string");
      if (firstArg) {
        const source = getStringContent(firstArg);
        imports.push({
          source,
          specifiers: [source],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }
  }
}
