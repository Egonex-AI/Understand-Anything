/**
 * Brace matching that skips string literals and line comments.
 *
 * Parsers in this directory locate a block's extent by counting `{` and `}`.
 * Counting raw characters lets a brace inside a string or comment decrement the
 * depth early, truncating the block: the reported `lineRange` stops short, and
 * body-derived data (protobuf fields, GraphQL fields) is sliced off with it.
 *
 * Does not handle block comments, heredocs, or backtick/dollar interpolation.
 */

/** String and comment forms for one language. */
export interface BraceSyntax {
  quotes: string[];
  lineComments: string[];
  backslashEscapes: boolean;
}

/** HCL: double and single quotes, `#` and `//` comments. */
export const TERRAFORM_SYNTAX: BraceSyntax = {
  quotes: ['"', "'"],
  lineComments: ["#", "//"],
  backslashEscapes: true,
};

/** Protobuf: double and single quotes, `//` comments. */
export const PROTOBUF_SYNTAX: BraceSyntax = {
  quotes: ['"', "'"],
  lineComments: ["//"],
  backslashEscapes: true,
};

/** GraphQL: double quotes, `#` comments. */
export const GRAPHQL_SYNTAX: BraceSyntax = {
  quotes: ['"'],
  lineComments: ["#"],
  backslashEscapes: true,
};

/** Shell: double and single quotes, `#` comments. */
export const SHELL_SYNTAX: BraceSyntax = {
  quotes: ['"', "'"],
  lineComments: ["#"],
  backslashEscapes: true,
};

/**
 * Finds the index of the `}` closing the first `{` in `content`, ignoring braces
 * inside string literals and line comments.
 *
 * Returns `content.length` when the braces are unbalanced, matching the behavior
 * of the per-parser implementations this replaces. When `parserName` is given, an
 * unbalanced run warns under that name, as those implementations did.
 */
export function findClosingBrace(content: string, syntax: BraceSyntax, parserName?: string): number {
  let depth = 0;
  let quote: string | null = null;
  let inLineComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (quote !== null) {
      if (syntax.backslashEscapes && ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (syntax.quotes.includes(ch)) {
      quote = ch;
      continue;
    }

    if (startsLineComment(content, i, syntax.lineComments)) {
      inLineComment = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  if (depth !== 0 && parserName) {
    console.warn(`[${parserName}] Unbalanced braces detected (depth=${depth}), results may be incomplete`);
  }
  return content.length;
}

/**
 * Counts `{` and `}` per line, ignoring those inside string literals and line
 * comments. Line-oriented parsers need per-line deltas rather than a single index.
 */
export function countBracesPerLine(
  content: string,
  syntax: BraceSyntax,
): Array<{ open: number; close: number }> {
  const perLine: Array<{ open: number; close: number }> = [{ open: 0, close: 0 }];
  let quote: string | null = null;
  let inLineComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === "\n") {
      inLineComment = false;
      perLine.push({ open: 0, close: 0 });
      continue;
    }

    if (inLineComment) continue;

    if (quote !== null) {
      if (syntax.backslashEscapes && ch === "\\") {
        // An escaped newline is consumed here, so account for the line it ends —
        // otherwise `perLine` desynchronizes from the caller's line array.
        if (content[i + 1] === "\n") perLine.push({ open: 0, close: 0 });
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (syntax.quotes.includes(ch)) {
      quote = ch;
      continue;
    }

    if (startsLineComment(content, i, syntax.lineComments)) {
      inLineComment = true;
      continue;
    }

    const current = perLine[perLine.length - 1];
    if (ch === "{") current.open++;
    else if (ch === "}") current.close++;
  }

  return perLine;
}

function startsLineComment(content: string, index: number, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (content.startsWith(prefix, index)) return true;
  }
  return false;
}
