import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import {
  annotatedLinks,
  collectTags,
  lineNotes,
  orderAnnotatedNodes,
  type AnnotatedLink,
  type AnnotationLike,
  type AnnotationMap,
} from "./annotatedNodes";
import type { ZipEntry } from "./zip";

/**
 * Builders for exporting the user's annotations as one Markdown file or as an
 * Obsidian vault (one note per annotated node + an index). Pure: the caller
 * zips and downloads.
 */

export interface NotesExportLabels {
  /** `{project}` is replaced. */
  title: string;
  /** `{date}` and `{count}` are replaced. */
  exported: string;
  contents: string;
  type: string;
  file: string;
  lines: string;
  layer: string;
  tags: string;
  updated: string;
  summary: string;
  note: string;
  lineNotes: string;
  related: string;
  index: string;
  byLayer: string;
  byTag: string;
  noLayer: string;
  backToIndex: string;
}

export const DEFAULT_NOTES_LABELS: NotesExportLabels = {
  title: "{project} — notes",
  exported: "Exported {date} · {count} annotated nodes",
  contents: "Contents",
  type: "Type",
  file: "File",
  lines: "lines",
  layer: "Layer",
  tags: "Tags",
  updated: "Updated",
  summary: "Summary",
  note: "Note",
  lineNotes: "Line notes",
  related: "Related",
  index: "Index",
  byLayer: "Notes by layer",
  byTag: "Tags",
  noLayer: "Other",
  backToIndex: "Back to",
};

export interface NotesExportOptions {
  labels?: NotesExportLabels;
  /** Defaults to now. */
  date?: Date;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Tag usable as `#tag` in Markdown/Obsidian: no spaces or punctuation besides `_-/`. */
export function tagSlug(tag: string): string {
  const slug = tag.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_\-/]/gu, "-").replace(/-+/g, "-");
  if (!slug) return "tag";
  return /^\p{N}+$/u.test(slug) ? `tag-${slug}` : slug;
}

/** File name safe for Obsidian notes and every OS (no extension). */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return cleaned || "untitled";
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Unique note names for the given ids. Duplicate node names get their file's
 * basename, then a counter; `reserved` names (e.g. the index) are avoided.
 */
export function uniqueNoteNames(nodes: GraphNode[], reserved: string[] = []): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const key = safeFileName(n.name).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const taken = new Set(reserved.map((r) => r.toLowerCase()));
  const names = new Map<string, string>();
  for (const n of nodes) {
    let base = safeFileName(n.name);
    if ((counts.get(base.toLowerCase()) ?? 0) > 1 && n.filePath && basename(n.filePath) !== n.name) {
      base = safeFileName(`${n.name} (${basename(n.filePath)})`);
    }
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    taken.add(name.toLowerCase());
    names.set(n.id, name);
  }
  return names;
}

function lineRangeText(node: GraphNode): string | null {
  if (!node.lineRange) return null;
  const [a, b] = node.lineRange;
  return a === b ? String(a) : `${a}-${b}`;
}

function layerNames(graph: KnowledgeGraph): Map<string, string> {
  const names = new Map<string, string>();
  for (const layer of graph.layers) for (const id of layer.nodeIds) if (!names.has(id)) names.set(id, layer.name);
  // Functions/classes inherit their file's layer.
  for (const e of graph.edges) {
    if (e.type === "contains" && !names.has(e.target) && names.has(e.source)) names.set(e.target, names.get(e.source)!);
  }
  return names;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function relatedLine(link: AnnotatedLink, target: string): string {
  return link.dir === "out" ? `${link.type} → ${target}` : `← ${link.type} ${target}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Prepared {
  ids: string[];
  nodes: Map<string, GraphNode>;
  links: Map<string, AnnotatedLink[]>;
  layers: Map<string, string>;
}

function prepare(graph: KnowledgeGraph, annotations: AnnotationMap): Prepared {
  const ids = orderAnnotatedNodes(graph, annotations, { order: "graph" });
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return { ids, nodes, links: annotatedLinks(graph, ids), layers: layerNames(graph) };
}

/** Body sections shared by both formats; `link` renders a reference to another annotated node. */
function bodySections(
  node: GraphNode,
  a: AnnotationLike,
  links: AnnotatedLink[],
  labels: NotesExportLabels,
  level: string,
  link: (id: string) => string,
): string[] {
  const out: string[] = [];
  if (node.summary?.trim()) out.push(`${level} ${labels.summary}\n\n${node.summary.trim()}`);
  if (a.note.trim()) out.push(`${level} ${labels.note}\n\n${a.note.trim()}`);
  const lines = lineNotes(a);
  if (lines.length > 0) {
    const where = (line: number) => (node.filePath ? `\`${node.filePath}:${line}\`` : `L${line}`);
    out.push(`${level} ${labels.lineNotes}\n\n${lines.map((l) => `- ${where(l.line)} — ${l.note.replace(/\s*\n\s*/g, " ")}`).join("\n")}`);
  }
  if (links.length > 0) {
    out.push(`${level} ${labels.related}\n\n${links.map((l) => `- ${relatedLine(l, link(l.id))}`).join("\n")}`);
  }
  return out;
}

/** One Markdown document with every annotated node, in graph order. */
export function buildNotesMarkdown(graph: KnowledgeGraph, annotations: AnnotationMap, opts: NotesExportOptions = {}): string {
  const labels = opts.labels ?? DEFAULT_NOTES_LABELS;
  const date = opts.date ?? new Date();
  const { ids, nodes, links, layers } = prepare(graph, annotations);
  const anchor = new Map(ids.map((id, i) => [id, `ua-note-${i + 1}`]));
  const parts: string[] = [];
  parts.push(`# ${fill(labels.title, { project: graph.project.name })}`);
  parts.push(`> ${fill(labels.exported, { date: isoDay(date), count: ids.length })}`);
  if (ids.length > 0) {
    parts.push(
      `## ${labels.contents}\n\n` +
        ids.map((id, i) => {
          const n = nodes.get(id)!;
          return `${i + 1}. [${n.name}](#${anchor.get(id)})${n.filePath ? ` — \`${n.filePath}\`` : ""}`;
        }).join("\n"),
    );
  }
  for (const id of ids) {
    const node = nodes.get(id)!;
    const a = annotations[id];
    const meta: string[] = [`- **${labels.type}:** ${node.type}`];
    if (node.filePath) {
      const range = lineRangeText(node);
      meta.push(`- **${labels.file}:** \`${node.filePath}\`${range ? ` (${labels.lines} ${range})` : ""}`);
    }
    const layer = layers.get(id);
    if (layer) meta.push(`- **${labels.layer}:** ${layer}`);
    if (a.tags.length > 0) meta.push(`- **${labels.tags}:** ${a.tags.map((t) => `#${tagSlug(t)}`).join(" ")}`);
    if (a.updatedAt) meta.push(`- **${labels.updated}:** ${a.updatedAt}`);
    const section = [
      `---\n\n<a id="${anchor.get(id)}"></a>\n\n## ${node.name}`,
      meta.join("\n"),
      ...bodySections(node, a, links.get(id) ?? [], labels, "###", (other) => `[${nodes.get(other)!.name}](#${anchor.get(other)})`),
    ];
    parts.push(section.join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

function wikilink(name: string, display?: string): string {
  return display && display !== name ? `[[${name}|${display.replace(/[[\]|]/g, "")}]]` : `[[${name}]]`;
}

/**
 * Obsidian vault files under `<root>/`: `Index.md` plus `notes/<Name>.md` per
 * annotated node, with YAML frontmatter, [[wikilinks]] between related
 * annotated nodes and tags usable by Obsidian's tag pane.
 */
export function buildObsidianVault(graph: KnowledgeGraph, annotations: AnnotationMap, opts: NotesExportOptions = {}): ZipEntry[] {
  const labels = opts.labels ?? DEFAULT_NOTES_LABELS;
  const date = opts.date ?? new Date();
  const { ids, nodes, links, layers } = prepare(graph, annotations);
  const indexName = safeFileName(labels.index);
  const names = uniqueNoteNames(ids.map((id) => nodes.get(id)!), [indexName]);
  const root = `${safeFileName(graph.project.name)} notes`;
  const link = (id: string) => wikilink(names.get(id)!, nodes.get(id)!.name);
  const files: ZipEntry[] = [];

  for (const id of ids) {
    const node = nodes.get(id)!;
    const a = annotations[id];
    const fm: string[] = ["---", `type: ${quoteYaml(node.type)}`];
    if (node.filePath) fm.push(`file: ${quoteYaml(node.filePath)}`);
    const range = lineRangeText(node);
    if (range) fm.push(`lines: ${quoteYaml(range)}`);
    const layer = layers.get(id);
    if (layer) fm.push(`layer: ${quoteYaml(layer)}`);
    fm.push(`node_id: ${quoteYaml(id)}`);
    if (a.tags.length > 0) fm.push("tags:", ...a.tags.map((t) => `  - ${quoteYaml(tagSlug(t))}`));
    else fm.push("tags: []");
    if (a.updatedAt) fm.push(`updated: ${quoteYaml(a.updatedAt)}`);
    if (names.get(id) !== node.name) fm.push("aliases:", `  - ${quoteYaml(node.name)}`);
    fm.push("---");
    const body = [
      fm.join("\n"),
      `# ${node.name}`,
      ...bodySections(node, a, links.get(id) ?? [], labels, "##", link),
      `${labels.backToIndex} ${wikilink(indexName)}`,
    ];
    files.push({ path: `${root}/notes/${names.get(id)}.md`, data: body.join("\n\n") + "\n" });
  }

  // Index: notes grouped by layer (graph order), then by tag.
  const index: string[] = [
    ["---", `type: "index"`, `project: ${quoteYaml(graph.project.name)}`, `exported: ${quoteYaml(date.toISOString())}`, "---"].join("\n"),
    `# ${fill(labels.title, { project: graph.project.name })}`,
  ];
  if (graph.project.description?.trim()) index.push(graph.project.description.trim());
  index.push(`> ${fill(labels.exported, { date: isoDay(date), count: ids.length })}`);
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const layer = layers.get(id) ?? labels.noLayer;
    let list = groups.get(layer);
    if (!list) groups.set(layer, (list = []));
    list.push(id);
  }
  if (groups.size > 0) {
    const sections = [...groups].map(([layer, list]) =>
      `### ${layer}\n\n${list.map((id) => {
        const summary = nodes.get(id)!.summary?.trim().split(/(?<=[.!?。！？])\s/)[0];
        return `- ${link(id)}${summary ? ` — ${summary}` : ""}`;
      }).join("\n")}`,
    );
    index.push(`## ${labels.byLayer}\n\n${sections.join("\n\n")}`);
  }
  const tags = collectTags(Object.fromEntries(ids.map((id) => [id, annotations[id]])));
  if (tags.length > 0) {
    const lines = tags.map((tag) => {
      const key = tag.toLowerCase();
      const tagged = ids.filter((id) => annotations[id].tags.some((t) => t.toLowerCase() === key));
      return `- #${tagSlug(tag)}: ${tagged.map(link).join(", ")}`;
    });
    index.push(`## ${labels.byTag}\n\n${lines.join("\n")}`);
  }
  files.unshift({ path: `${root}/${indexName}.md`, data: index.join("\n\n") + "\n" });
  return files;
}
