import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

/**
 * Recursively unwrap nested declarators (pointer_declarator, reference_declarator,
 * array_declarator) to find the leaf identifier name.
 *
 * C/C++ parameter declarators can be deeply nested:
 *   `char** pp` => pointer_declarator -> pointer_declarator -> identifier("pp")
 *   `const std::string& ref` => reference_declarator -> identifier("ref")
 *   `int arr[]` => array_declarator -> identifier("arr")
 */
function unwrapDeclaratorName(node: TreeSitterNode): string | null {
  if (node.type === "identifier" || node.type === "field_identifier") {
    return node.text;
  }
  // Dig into the nested declarator field
  const inner = node.childForFieldName("declarator");
  if (inner) {
    return unwrapDeclaratorName(inner);
  }
  // Fallback: look for direct identifier/field_identifier child
  const id = findChild(node, "identifier") ?? findChild(node, "field_identifier");
  return id ? id.text : null;
}

/**
 * Strip template arguments from a qualified-name scope node to recover the
 * bare class name.
 *
 * For `void Box<int>::get()` the `scope` field of the qualified_identifier is a
 * `template_type` node whose `.text` is `"Box<int>"`. The class is registered in
 * `methodsByClass` under the bare name `"Box"`, so we read the `type_identifier`
 * child of the `template_type` ("Box") rather than the full templated text. For a
 * plain (non-templated) scope we return the node text unchanged.
 */
function scopeQualifierName(scope: TreeSitterNode): string {
  if (scope.type === "template_type") {
    const base = findChild(scope, "type_identifier");
    if (base) return base.text;
  }
  return scope.text;
}

/**
 * Extract the function/method name from a function_declarator node.
 *
 * The declarator field can be:
 * - `identifier` for free functions: `int baz(int y)`
 * - `field_identifier` for in-class declarations/definitions: `void start();`
 * - `qualified_identifier` for out-of-class definitions: `void Server::start()`
 *
 * For qualified_identifier, we extract just the final (leaf) name and return the
 * immediately-enclosing scope as the qualifier:
 * - `Server::start` => name "start", qualifier "Server".
 * - For deeply nested qualified_identifiers (`net::Server::start`) the grammar
 *   nests them, so we walk down the `name` field to the leaf identifier ("start")
 *   and keep the *immediate* enclosing scope as the qualifier ("Server", not
 *   "net"). This keeps the call-graph caller name aligned with the
 *   function-node name (both use this same leaf-name choice).
 * - Templated qualifiers (`Box<int>::get`) are stripped to the bare class name
 *   ("Box") so the method resolves against the class registered under "Box".
 */
function extractFuncDeclName(
  funcDecl: TreeSitterNode,
): { name: string; qualifier: string | null } | null {
  const declNode = funcDecl.childForFieldName("declarator");
  if (!declNode) return null;

  if (declNode.type === "identifier" || declNode.type === "field_identifier") {
    return { name: declNode.text, qualifier: null };
  }

  if (declNode.type === "qualified_identifier") {
    // qualified_identifiers nest for deeply scoped names like
    // `net::Server::start`. Walk down the `name` field to the leaf identifier,
    // tracking the immediately-enclosing scope as the qualifier (e.g. "Server"
    // for `net::Server::start`, not "net").
    let cur: TreeSitterNode = declNode;
    let qualifier: string | null = null;
    while (cur.type === "qualified_identifier") {
      const scope = cur.childForFieldName("scope");
      if (scope) qualifier = scopeQualifierName(scope);
      const next = cur.childForFieldName("name");
      if (!next) break;
      cur = next;
    }
    return { name: cur.text, qualifier };
  }

  return { name: declNode.text, qualifier: null };
}

/**
 * Extract parameter names from a parameter_list node.
 *
 * Each parameter_declaration has a `declarator` field which may be an identifier,
 * pointer_declarator, reference_declarator, or array_declarator. We recursively
 * unwrap to find the actual name.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  // Iterate over all params in source order. Different parameter shapes parse
  // to different node types:
  //   `int a`        => parameter_declaration
  //   `int b = 10`   => optional_parameter_declaration (default value)
  //   `Ts... xs`     => variadic_parameter_declaration (parameter pack); its
  //                     `declarator` field is a variadic_declarator whose
  //                     identifier child unwrapDeclaratorName recovers ("xs").
  for (let i = 0; i < paramsNode.childCount; i++) {
    const decl = paramsNode.child(i);
    if (!decl) continue;
    if (
      decl.type !== "parameter_declaration" &&
      decl.type !== "optional_parameter_declaration" &&
      decl.type !== "variadic_parameter_declaration"
    ) {
      continue;
    }
    const declNode = decl.childForFieldName("declarator");
    if (declNode) {
      const name = unwrapDeclaratorName(declNode);
      if (name) params.push(name);
    }
  }

  return params;
}

/**
 * Extract the return type text from a function_definition node.
 *
 * The return type is the `type` named field on function_definition.
 * Can be primitive_type, qualified_identifier, type_identifier, etc.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("type");
  if (typeNode) {
    return typeNode.text;
  }
  return undefined;
}

/**
 * Check if a function_definition has a `storage_class_specifier` child with "static".
 */
function isStatic(node: TreeSitterNode): boolean {
  const storage = findChild(node, "storage_class_specifier");
  return storage !== null && storage.text === "static";
}

/**
 * C/C++ extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles:
 * - Free functions (function_definition)
 * - Classes (class_specifier) with methods, properties, and access specifiers
 * - Structs (struct_specifier) with fields
 * - #include directives mapped to imports
 * - Namespaces (namespace_definition) with recursive traversal
 * - Out-of-class method definitions (e.g., void Server::start())
 * - Call graph extraction from call_expression nodes
 *
 * C/C++ has no formal export syntax. Non-static top-level functions and
 * public class/struct members are treated as exports.
 */
export class CppExtractor implements LanguageExtractor {
  readonly languageIds = ["cpp", "c"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    // Track methods associated with classes via out-of-class definitions
    const methodsByClass = new Map<string, string[]>();

    this.walkTopLevel(rootNode, functions, classes, imports, exports, methodsByClass);

    // Attach out-of-class methods to their corresponding classes
    for (const cls of classes) {
      const methods = methodsByClass.get(cls.name);
      if (methods) {
        for (const m of methods) {
          if (!cls.methods.includes(m)) {
            cls.methods.push(m);
          }
        }
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      // Track entering function_definition
      if (node.type === "function_definition") {
        const name = this.extractFunctionName(node);
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
      }

      // Extract call_expression nodes
      if (node.type === "call_expression") {
        if (functionStack.length > 0) {
          const callee = this.extractCalleeName(node);
          if (callee) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
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

  /**
   * Walk top-level declarations. Recurses into namespace_definition bodies
   * to find nested declarations.
   */
  private walkTopLevel(
    parentNode: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    methodsByClass: Map<string, string[]>,
  ): void {
    for (let i = 0; i < parentNode.childCount; i++) {
      const node = parentNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "preproc_include":
          this.extractInclude(node, imports);
          break;

        case "class_specifier":
          this.extractClassOrStruct(node, "class", classes, functions, exports);
          break;

        case "struct_specifier":
          this.extractClassOrStruct(node, "struct", classes, functions, exports);
          break;

        case "function_definition":
          this.extractFunctionDef(node, functions, exports, methodsByClass);
          break;

        case "namespace_definition": {
          // Recurse into namespace body (declaration_list)
          const body = findChild(node, "declaration_list");
          if (body) {
            this.walkTopLevel(body, functions, classes, imports, exports, methodsByClass);
          }
          break;
        }

        case "template_declaration": {
          // Templated functions/classes are wrapped in a template_declaration
          // whose body holds the inner function_definition / class_specifier /
          // struct_specifier. Out-of-class member templates nest a second
          // template_declaration (e.g. `template<class T> template<class U>
          // void Box<T>::set(U)`), so recurse into the inner one before
          // dispatching the leaf declaration through the existing handlers.
          this.extractTemplateDeclaration(
            node,
            functions,
            classes,
            exports,
            methodsByClass,
          );
          break;
        }

        case "declaration": {
          // A top-level ";" terminated statement — could be a class/struct with a trailing ;
          // e.g., `class Foo { ... };` parses the class_specifier as a child of a
          // declaration in some contexts. Check for nested class/struct specifiers.
          const innerClass = findChild(node, "class_specifier");
          if (innerClass) {
            this.extractClassOrStruct(innerClass, "class", classes, functions, exports);
          }
          const innerStruct = findChild(node, "struct_specifier");
          if (innerStruct) {
            this.extractClassOrStruct(innerStruct, "struct", classes, functions, exports);
          }
          break;
        }
      }
    }
  }

  /**
   * Dispatch the leaf declaration of a template_declaration.
   *
   * The direct (named) children of a template_declaration are the
   * template_parameter_list and a single inner declaration. The inner
   * declaration is one of:
   * - `function_definition` — templated free function or out-of-class method def
   * - `class_specifier` / `struct_specifier` — templated class/struct
   * - `template_declaration` — a nested template (out-of-class member template,
   *   e.g. `template<class T> template<class U> void Box<T>::set(U)`); recurse.
   *
   * In-class member templates are handled separately by extractClassOrStruct's
   * member loop.
   */
  private extractTemplateDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    methodsByClass: Map<string, string[]>,
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      switch (child.type) {
        case "template_declaration":
          this.extractTemplateDeclaration(
            child,
            functions,
            classes,
            exports,
            methodsByClass,
          );
          break;
        case "function_definition":
          this.extractFunctionDef(child, functions, exports, methodsByClass);
          break;
        case "class_specifier":
          this.extractClassOrStruct(child, "class", classes, functions, exports);
          break;
        case "struct_specifier":
          this.extractClassOrStruct(child, "struct", classes, functions, exports);
          break;
      }
    }
  }

  /**
   * Extract the simple function name from a function_definition.
   * For qualified names (e.g., Server::start), returns just the method name.
   */
  private extractFunctionName(node: TreeSitterNode): string | null {
    const declNode = node.childForFieldName("declarator");
    if (!declNode || declNode.type !== "function_declarator") return null;

    const info = extractFuncDeclName(declNode);
    return info ? info.name : null;
  }

  /**
   * Extract #include directives and map them to the imports array.
   *
   * `preproc_include` has a `path` field that is either:
   * - `system_lib_string` for angle-bracket includes: `<iostream>`
   * - `string_literal` for quoted includes: `"myfile.h"`
   */
  private extractInclude(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const pathNode = node.childForFieldName("path");
    if (!pathNode) return;

    let source: string;
    if (pathNode.type === "system_lib_string") {
      // Strip angle brackets: <iostream> -> iostream
      source = pathNode.text.replace(/^<|>$/g, "");
    } else if (pathNode.type === "string_literal") {
      // Extract content from string: "myfile.h" -> myfile.h
      const content = findChild(pathNode, "string_content");
      source = content ? content.text : pathNode.text.replace(/^"|"$/g, "");
    } else {
      source = pathNode.text;
    }

    imports.push({
      source,
      specifiers: [source],
      lineNumber: node.startPosition.row + 1,
    });
  }

  /**
   * Extract class_specifier or struct_specifier into the classes array.
   *
   * Processes:
   * - Properties (field_declaration without function_declarator)
   * - Method declarations (field_declaration with function_declarator)
   * - Method definitions (function_definition inside the class body)
   * - Access specifiers (public/private/protected)
   *
   * Public members of classes and all members of structs (default public)
   * are treated as exports.
   */
  private extractClassOrStruct(
    node: TreeSitterNode,
    kind: "class" | "struct",
    classes: StructuralAnalysis["classes"],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const className = nameNode.text;
    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body && body.type === "field_declaration_list") {
      // Default access: public for struct, private for class
      let currentAccess = kind === "struct" ? "public" : "private";

      for (let j = 0; j < body.childCount; j++) {
        const member = body.child(j);
        if (!member) continue;

        if (member.type === "access_specifier") {
          // Update current access level
          const specChild = member.child(0);
          if (specChild) {
            currentAccess = specChild.text;
          }
          continue;
        }

        if (member.type === "field_declaration") {
          const declNode = member.childForFieldName("declarator");
          if (declNode && declNode.type === "function_declarator") {
            // Method declaration (no body)
            const info = extractFuncDeclName(declNode);
            if (info) {
              methods.push(info.name);
              if (currentAccess === "public") {
                exports.push({
                  name: info.name,
                  lineNumber: member.startPosition.row + 1,
                });
              }
            }
          } else if (declNode) {
            // Property (field_identifier or other declarator)
            const name = unwrapDeclaratorName(declNode);
            if (name) {
              properties.push(name);
            }
          }
        }

        if (member.type === "function_definition") {
          // Inline method definition
          this.extractClassMethodDef(
            member,
            currentAccess,
            methods,
            functions,
            exports,
          );
        }

        if (member.type === "template_declaration") {
          // In-class member template, e.g.
          //   class Foo { template<class T> void bar(T); };
          // The inner declaration is either a `declaration` (declaration only,
          // no body) or a `function_definition` (inline body), each carrying a
          // function_declarator. Handle both so the templated method is not
          // silently dropped.
          const inner =
            findChild(member, "declaration") ??
            findChild(member, "function_definition");
          if (inner) {
            const funcDecl = findChild(inner, "function_declarator");
            if (funcDecl) {
              if (inner.type === "function_definition") {
                this.extractClassMethodDef(
                  inner,
                  currentAccess,
                  methods,
                  functions,
                  exports,
                );
              } else {
                // Declaration-only member template: record the method name and
                // (if public) export it, matching plain method declarations.
                const info = extractFuncDeclName(funcDecl);
                if (info) {
                  methods.push(info.name);
                  if (currentAccess === "public") {
                    exports.push({
                      name: info.name,
                      lineNumber: member.startPosition.row + 1,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    classes.push({
      name: className,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
    });

    // The class/struct name itself is an export (non-anonymous types are always exported in C/C++ headers)
    exports.push({
      name: className,
      lineNumber: node.startPosition.row + 1,
    });
  }

  /**
   * Record an inline in-class method definition (function_definition with a
   * body inside a class/struct body) into the class's methods, the functions
   * list (with params/return type), and exports when public.
   *
   * Shared by the plain `function_definition` member arm and the in-class
   * member-template arm.
   */
  private extractClassMethodDef(
    member: TreeSitterNode,
    currentAccess: string,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const funcDecl = member.childForFieldName("declarator");
    if (!funcDecl || funcDecl.type !== "function_declarator") return;

    const info = extractFuncDeclName(funcDecl);
    if (!info) return;

    methods.push(info.name);

    const paramsNode = funcDecl.childForFieldName("parameters");
    functions.push({
      name: info.name,
      lineRange: [member.startPosition.row + 1, member.endPosition.row + 1],
      params: extractParams(paramsNode),
      returnType: extractReturnType(member),
    });

    if (currentAccess === "public") {
      exports.push({
        name: info.name,
        lineNumber: member.startPosition.row + 1,
      });
    }
  }

  /**
   * Extract a free function or out-of-class method definition.
   *
   * For qualified names (e.g., `void Server::start()`), the method is:
   * - Added to the functions array
   * - Tracked in methodsByClass for later association with the class
   * - Exported if non-static
   *
   * Static functions are NOT exported.
   */
  private extractFunctionDef(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    methodsByClass: Map<string, string[]>,
  ): void {
    const funcDecl = node.childForFieldName("declarator");
    if (!funcDecl || funcDecl.type !== "function_declarator") return;

    const info = extractFuncDeclName(funcDecl);
    if (!info) return;

    const paramsNode = funcDecl.childForFieldName("parameters");
    const params = extractParams(paramsNode);
    const returnType = extractReturnType(node);

    functions.push({
      name: info.name,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });

    // Track out-of-class method definitions (e.g., void Server::start())
    if (info.qualifier) {
      if (!methodsByClass.has(info.qualifier)) {
        methodsByClass.set(info.qualifier, []);
      }
      methodsByClass.get(info.qualifier)!.push(info.name);
    }

    // Non-static top-level functions are exports
    if (!isStatic(node)) {
      exports.push({
        name: info.name,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  /**
   * Extract the callee name from a call_expression.
   *
   * Handles:
   * - Plain function call: `printf(...)` -> "printf"
   * - Member call via field_expression: `p->method()` -> "p->method"
   * - Scoped call: `std::cout << ...` -> qualified name text
   */
  private extractCalleeName(callNode: TreeSitterNode): string | null {
    const funcNode = callNode.child(0);
    if (!funcNode) return null;

    if (funcNode.type === "identifier") {
      return funcNode.text;
    }

    if (funcNode.type === "field_expression") {
      const field = funcNode.childForFieldName("field");
      return field ? field.text : funcNode.text;
    }

    if (funcNode.type === "qualified_identifier") {
      return funcNode.text;
    }

    return funcNode.text;
  }
}
