import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo } from "../../types.js";

// One part of a possibly schema-qualified name: "quoted", `quoted`, [quoted] or bare.
const NAME_PART = '"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$]+';
const QUALIFIED_NAME = `((?:${NAME_PART})(?:\\s*\\.\\s*(?:${NAME_PART}))*)`;

const DELIMITER_DIRECTIVE = /DELIMITER[ \t]+(\S+)/iy;
const DOLLAR_QUOTE_TAG = /\$(?:[A-Za-z_]\w*)?\$/y;
const GO_LINE = /^[ \t]*GO(?:[ \t]+\d+)?[ \t\r]*$/gim;
// `\s+(\w+)` is a lookahead so that the next keyword in `BEGIN CASE` still gets its own match.
const BLOCK_KEYWORD = /\b(BEGIN|CASE|END)\b(?=(?:\s+(\w+))?)/gi;
// `BEGIN TRAN` opens a transaction, not a block.
const NOT_A_BLOCK = /^(?:TRAN|TRANSACTION|DISTRIBUTED)$/i;
// `END IF` and friends close statements whose opening keyword is not counted.
const NOT_A_BLOCK_END = /^(?:IF|LOOP|WHILE|REPEAT|FOR)$/i;
const NEXT_STATEMENT =
  /^\s*(?:(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|WITH|MERGE|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|START|SET|USE|CALL|EXEC|EXECUTE|COMMENT)\b|$)/i;

interface ScannedSql {
  /** The source with comments, string literals and DELIMITER lines blanked; offsets are preserved. */
  code: string;
  /** Sorted offsets just past each statement terminator (or at the start of a GO line). */
  terminators: number[];
  /** True when GO separates batches, so a `;` does not end a routine. */
  batched: boolean;
}

/** `"public"."users"` -> `public.users` */
function normalizeName(raw: string): string {
  return [...raw.matchAll(new RegExp(NAME_PART, "g"))]
    .map(([part]) => part.replace(/^["`[]|["`\]]$/g, ""))
    .join(".");
}

function indexAfter(content: string, closer: string, from: number): number {
  const idx = content.indexOf(closer, from);
  return idx === -1 ? content.length : idx + closer.length;
}

/** `''` and MySQL's `\'` both stay inside the literal starting at `start`. */
function stringLiteralEnd(content: string, start: number): number {
  for (let i = start + 1; i < content.length; i++) {
    if (content[i] === "\\") {
      i++;
    } else if (content[i] === "'") {
      if (content[i + 1] !== "'") return i + 1;
      i++;
    }
  }
  return content.length;
}

function scanSql(content: string): ScannedSql {
  const chars = content.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  };
  const semicolons: number[] = [];
  const customDelimiters: number[] = [];
  let delimiter = ";";
  let atLineStart = true;
  let i = 0;

  while (i < content.length) {
    const c = content[i];
    if (c === "\n") atLineStart = true;
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    const lineStart = atLineStart;
    atLineStart = false;

    if (lineStart) {
      DELIMITER_DIRECTIVE.lastIndex = i;
      const directive = DELIMITER_DIRECTIVE.exec(content);
      if (directive) {
        delimiter = directive[1];
        const end = indexAfter(content, "\n", i);
        blank(i, end);
        i = end;
        atLineStart = true;
        continue;
      }
    }

    let blankEnd = -1;
    if (content.startsWith("--", i) || (c === "#" && lineStart)) {
      blankEnd = indexAfter(content, "\n", i);
      atLineStart = true;
    } else if (content.startsWith("/*", i)) {
      blankEnd = indexAfter(content, "*/", i + 2);
    } else if (c === "'") {
      blankEnd = stringLiteralEnd(content, i);
    } else if (c === "$" && !delimiter.startsWith("$") && !/\w/.test(content[i - 1] ?? "")) {
      DOLLAR_QUOTE_TAG.lastIndex = i;
      const tag = DOLLAR_QUOTE_TAG.exec(content);
      if (tag) blankEnd = indexAfter(content, tag[0], i + tag[0].length);
    }
    if (blankEnd !== -1) {
      blank(i, blankEnd);
      i = blankEnd;
      continue;
    }

    if (c === '"' || c === "`") {
      i = indexAfter(content, c, i + 1);
    } else if (c === "[") {
      i = indexAfter(content, "]", i + 1);
    } else if (content.startsWith(delimiter, i)) {
      i += delimiter.length;
      (delimiter === ";" ? semicolons : customDelimiters).push(i);
    } else {
      i++;
    }
  }

  const code = chars.join("");
  const goLines = [...code.matchAll(GO_LINE)].map((m) => m.index);
  const batched = goLines.length > 0;
  const terminators = [...customDelimiters, ...(batched ? goLines : semicolons)].sort((a, b) => a - b);
  return { code, terminators, batched };
}

/**
 * Find where the routine starting at `start` ends: the first terminator outside any
 * BEGIN/CASE block. Before a block opens, a `;` not followed by a new statement belongs
 * to an Oracle-style declaration section, so the routine carries on.
 */
function routineEnd({ code, terminators, batched }: ScannedSql, start: number): number {
  const keyword = new RegExp(BLOCK_KEYWORD);
  keyword.lastIndex = start;
  let current = keyword.exec(code);
  let depth = 0;
  let sawBlock = false;
  let skipCase = false;

  for (const end of terminators) {
    if (end <= start) continue;

    while (current && current.index < end) {
      const word = current[1].toUpperCase();
      const next = current[2] ?? "";
      if (word === "BEGIN" && !NOT_A_BLOCK.test(next)) {
        depth++;
        sawBlock = true;
      } else if (word === "CASE") {
        if (!skipCase) depth++;
        skipCase = false;
      } else if (word === "END" && !NOT_A_BLOCK_END.test(next)) {
        depth--;
        skipCase = next.toUpperCase() === "CASE";
      }
      current = keyword.exec(code);
    }

    if (depth > 0) continue;
    if (!sawBlock && !batched && !NEXT_STATEMENT.test(code.slice(end, end + 200))) continue;
    return end;
  }

  return code.length;
}

/**
 * Parses SQL files to extract table, view, index, stored procedure, function, and trigger
 * definitions, including schema-qualified names (e.g., public.users).
 * Handles IF NOT EXISTS, OR REPLACE, OR ALTER, and MySQL DEFINER variants. Comments, string
 * literals and statements inside routine bodies are not reported as definitions. Routine
 * ends are found from BEGIN/END nesting, `;`, MySQL DELIMITER and T-SQL GO.
 */
export class SQLParser implements AnalyzerPlugin {
  name = "sql-parser";
  languages = ["sql"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const definitions = this.extractDefinitions(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      definitions,
    };
  }

  private extractDefinitions(content: string): DefinitionInfo[] {
    const definitions: DefinitionInfo[] = [];
    const scanned = scanSql(content);
    const { code } = scanned;
    const lineAt = (idx: number) => code.slice(0, idx).split("\n").length;

    // Match CREATE PROCEDURE / FUNCTION / TRIGGER first: their bodies hide other statements
    const routines: DefinitionInfo[] = [];
    const routineSpans: Array<[number, number]> = [];
    const routineRegex = new RegExp(
      "CREATE\\s+(?:OR\\s+(?:REPLACE|ALTER)\\s+)?(?:DEFINER\\s*=\\s*\\S+\\s+)?" +
        "(?:TEMP(?:ORARY)?\\s+)?(?:CONSTRAINT\\s+)?(PROCEDURE|PROC|FUNCTION|TRIGGER)\\s+" +
        `(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED_NAME}`,
      "gi",
    );
    let match;
    let lastRoutineEnd = 0;
    while ((match = routineRegex.exec(code)) !== null) {
      if (match.index < lastRoutineEnd) continue;
      lastRoutineEnd = routineEnd(scanned, match.index);
      routineSpans.push([match.index, lastRoutineEnd]);

      const keyword = match[1].toLowerCase();
      routines.push({
        name: normalizeName(match[2]),
        kind: keyword === "proc" ? "procedure" : keyword,
        lineRange: [lineAt(match.index), lineAt(code.slice(0, lastRoutineEnd).trimEnd().length)],
        fields: [],
      });
    }
    const inRoutineBody = (idx: number) => routineSpans.some(([start, end]) => idx >= start && idx < end);

    // Match CREATE TABLE statements
    const tableRegex = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED_NAME}`, "gi");
    while ((match = tableRegex.exec(code)) !== null) {
      if (inRoutineBody(match.index)) continue;
      const tableName = normalizeName(match[1]);
      const startLine = lineAt(match.index);

      // Extract columns (simplified: look for column names in parenthesized block)
      const fields = this.extractColumns(code, match.index);

      // Find the end of the CREATE TABLE statement
      const afterMatch = code.slice(match.index);
      const endParen = afterMatch.indexOf(");");
      const endLine = endParen !== -1
        ? lineAt(match.index + endParen + 2)
        : startLine + 5;

      definitions.push({
        name: tableName,
        kind: "table",
        lineRange: [startLine, endLine],
        fields,
      });
    }

    // Match CREATE VIEW
    const viewRegex = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+${QUALIFIED_NAME}`, "gi");
    while ((match = viewRegex.exec(code)) !== null) {
      if (inRoutineBody(match.index)) continue;
      const startLine = lineAt(match.index);
      definitions.push({
        name: normalizeName(match[1]),
        kind: "view",
        lineRange: [startLine, startLine],
        fields: [],
      });
    }

    // Match CREATE INDEX
    const indexRegex = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED_NAME}`, "gi");
    while ((match = indexRegex.exec(code)) !== null) {
      if (inRoutineBody(match.index)) continue;
      const startLine = lineAt(match.index);
      definitions.push({
        name: normalizeName(match[1]),
        kind: "index",
        lineRange: [startLine, startLine],
        fields: [],
      });
    }

    definitions.push(...routines);
    return definitions;
  }

  private extractColumns(content: string, startIdx: number): string[] {
    const fields: string[] = [];
    const afterCreate = content.slice(startIdx);
    const openParen = afterCreate.indexOf("(");
    if (openParen === -1) return fields;

    const closeParen = afterCreate.indexOf(");", openParen);
    if (closeParen === -1) return fields;

    const body = afterCreate.slice(openParen + 1, closeParen);
    const lines = body.split(",");

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip constraints
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)/i.test(trimmed)) continue;
      const colMatch = trimmed.match(/^(?:`|")?(\w+)(?:`|")?\s+/);
      if (colMatch) {
        fields.push(colMatch[1]);
      }
    }

    return fields;
  }
}
