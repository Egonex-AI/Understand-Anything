/**
 * Minimal glob matcher for layer file patterns (e.g. "src/api/**", "*.test.ts").
 * Supports `**` (any depth), `*` (any run within a segment), and `?` (one char).
 * Not a full glob implementation — sufficient for the coarse layer-detection
 * patterns an LLM produces, not for user-facing ignore rules (those go through
 * @understand-anything/core's createIgnoreFilter, which uses the real `ignore` package).
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAnyPattern(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}
