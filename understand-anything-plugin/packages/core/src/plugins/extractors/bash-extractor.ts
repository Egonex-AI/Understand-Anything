import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

/**
 * Commands that source another file. POSIX defines `.` (dot); bash adds
 * `source` as an alias. Either one followed by a file argument means
 * "import the symbols defined in that script."
 */
const SOURCE_COMMAND_NAMES = new Set([".", "source"]);

/**
 * Built-in commands and shell-level primitives that aren't useful as
 * call-graph edges. Recording every `echo`, `printf`, `cd`, `[`, `local`
 * etc. would drown out the actually-interesting calls to project-defined
 * functions and other scripts.
 */
const SHELL_BUILTIN_NAMES = new Set([
  "echo", "printf", "read", "exit", "return", "true", "false",
  "cd", "pwd", "pushd", "popd", "dirs",
  "export", "unset", "declare", "local", "readonly", "typeset",
  "test", "[", "[[",
  "set", "shift", "trap", "shopt", "exec",
  ":", "eval",
]);

export class BashExtractor implements LanguageExtractor {
  readonly name = "bash-extractor";
  readonly languageIds = ["shell", "bash"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "function_definition":
          this.extractFunction(node, functions, exports);
          break;
        case "command":
          this.extractSourceImport(node, imports);
          break;
      }
    }

    // Bash has no class concept. We still return an empty array to
    // match the StructuralAnalysis shape that downstream consumers expect.
    return { functions, classes: [], imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushed = false;

      if (node.type === "function_definition") {
        const name = this.functionName(node);
        if (name) {
          functionStack.push(name);
          pushed = true;
        }
      }

      if (node.type === "command" && functionStack.length > 0) {
        const callee = this.commandName(node);
        if (callee && !this.isUninterestingCall(callee)) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }

      if (pushed) functionStack.pop();
    };

    walk(rootNode);
    return entries;
  }

  // ───── Helpers ─────

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const name = this.functionName(node);
    if (!name) return;

    functions.push({
      name,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      // Bash functions take positional args (`$1`, `$2`, ...), not named
      // parameters — there's nothing to extract.
      params: [],
    });

    // Shell has no formal export keyword for functions (`declare -fx` aside).
    // Match Python's convention: every top-level definition is an export.
    exports.push({
      name,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractSourceImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const cmdName = this.commandName(node);
    if (!cmdName || !SOURCE_COMMAND_NAMES.has(cmdName)) return;

    // The first `word` or `string` after the command_name is the path.
    // Walk children in order, skip the command_name, take the first
    // path-shaped child.
    let seenCmdName = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (!seenCmdName && child.type === "command_name") {
        seenCmdName = true;
        continue;
      }
      if (!seenCmdName) continue;

      if (child.type === "word") {
        imports.push({
          source: child.text,
          specifiers: [],
          lineNumber: node.startPosition.row + 1,
        });
        return;
      }
      if (child.type === "string") {
        // Strings may contain `simple_expansion` ($VAR) or `expansion`
        // (${VAR}) interleaved with `string_content`. We surface the raw
        // text (minus surrounding quotes) so consumers can see the
        // unresolved path; resolving variables would require a runtime
        // environment we don't have at static-analysis time.
        const raw = child.text.replace(/^["']|["']$/g, "");
        imports.push({
          source: raw,
          specifiers: [],
          lineNumber: node.startPosition.row + 1,
        });
        return;
      }
    }
  }

  private functionName(funcNode: TreeSitterNode): string | null {
    // `foo() { ... }` — first `word` child IS the name
    // `function foo { ... }` — `function` keyword first, then `word`
    // `function foo() { ... }` — both forms combined
    // Either way, the first `word` is the name.
    const word = findChild(funcNode, "word");
    return word?.text ?? null;
  }

  private commandName(commandNode: TreeSitterNode): string | null {
    const cmdName = findChild(commandNode, "command_name");
    if (!cmdName) return null;
    const word = findChild(cmdName, "word");
    return word?.text ?? null;
  }

  private isUninterestingCall(name: string): boolean {
    if (SHELL_BUILTIN_NAMES.has(name)) return true;
    // Strip leading variable assignments like `FOO=bar cmd` — the command
    // name parsing already handles these, but be defensive.
    if (name.includes("=")) return true;
    return false;
  }
}

