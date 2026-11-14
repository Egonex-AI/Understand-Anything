/**
 * Build a knowledge-graph-shaped corpus from real TypeScript source, using the
 * TypeScript compiler API. Each exported/top-level function, class, method and
 * arrow-function constant becomes a node whose summary is its JSDoc comment
 * (empty when undocumented); each file becomes a node containing them; relative
 * imports become `imports` edges.
 *
 * Used by the semantic-search benchmark so it measures retrieval on code that
 * was not written for the benchmark.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import ts from "typescript";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "__tests__", "locales", "semantic"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function jsDoc(node, sf) {
  const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  if (docs.length === 0) return "";
  const text = docs[docs.length - 1].getText(sf);
  return text
    .replace(/^\/\*\*+|\*+\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l && !l.startsWith("@"))
    .join(" ")
    .slice(0, 400);
}

/** Project-relative path with forward slashes on every OS (node ids and path matching rely on it). */
const toPosix = (p) => p.split(sep).join("/");

export function buildTsCorpus(roots, projectRoot) {
  const nodes = [];
  const edges = [];
  const fileIds = new Map();
  const files = roots.flatMap((r) => walk(r));

  for (const abs of files) fileIds.set(abs.replace(/\.(tsx?)$/, ""), `file:${toPosix(relative(projectRoot, abs))}`);

  for (const abs of files) {
    const rel = toPosix(relative(projectRoot, abs));
    const src = readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true, abs.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const fileId = `file:${rel}`;
    const first = sf.statements[0];
    const fileSummary = first ? jsDoc(first, sf) : "";
    nodes.push({ id: fileId, type: "file", name: rel.split("/").pop(), filePath: rel, summary: fileSummary, tags: [], complexity: "simple" });

    const add = (type, name, node) => {
      const id = `${type}:${rel}:${name}`;
      if (nodes.some((n) => n.id === id)) return;
      nodes.push({ id, type, name, filePath: rel, summary: jsDoc(node, sf), tags: [], complexity: "simple" });
      edges.push({ source: fileId, target: id, type: "contains", direction: "forward", weight: 1 });
    };

    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) add("function", st.name.text, st);
      else if (ts.isClassDeclaration(st) && st.name) {
        add("class", st.name.text, st);
        for (const m of st.members) {
          if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name) && !m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)) {
            add("function", `${st.name.text}.${m.name.text}`, m);
          }
        }
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
            add("function", d.name.text, st);
          }
        }
      }
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith(".")) {
        const target = resolve(dirname(abs), st.moduleSpecifier.text.replace(/\.(js|ts|tsx)$/, ""));
        const targetId = fileIds.get(target) ?? fileIds.get(join(target, "index"));
        if (targetId) edges.push({ source: fileId, target: targetId, type: "imports", direction: "forward", weight: 0.7 });
      }
    }
  }
  return { nodes, edges };
}
