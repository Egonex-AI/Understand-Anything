import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { containsParents, dependencyOf, selfAndAncestors } from "./dependencies";

export interface ReviewEntry {
  reviewed: boolean;
  comment: string;
}

/**
 * Order changed nodes for review: dependencies before their dependents, so
 * by the time a reviewer reaches a file they have already seen what it
 * builds on. Functions/classes map onto their nearest changed ancestor when
 * linking. Within a level (and for cycles) the order is by file path, then
 * name, so the walkthrough is stable.
 */
export function orderForReview(
  graph: Pick<KnowledgeGraph, "nodes" | "edges">,
  changedIds: Iterable<string>,
): string[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const changed = [...new Set(changedIds)].filter((id) => nodesById.has(id));
  const changedSet = new Set(changed);
  const parents = containsParents(graph);
  const owner = (id: string) => selfAndAncestors(id, parents).find((a) => changedSet.has(a));

  const cmp = (a: string, b: string) => {
    const na = nodesById.get(a) as GraphNode;
    const nb = nodesById.get(b) as GraphNode;
    return (
      (na.filePath ?? "￿").localeCompare(nb.filePath ?? "￿") ||
      (na.lineRange?.[0] ?? 0) - (nb.lineRange?.[0] ?? 0) ||
      na.name.localeCompare(nb.name)
    );
  };

  // dependency → dependents, and pending-dependency counts.
  const dependents = new Map<string, Set<string>>();
  const pending = new Map<string, number>(changed.map((id) => [id, 0]));
  for (const e of graph.edges) {
    const dep = dependencyOf(e);
    if (!dep) continue;
    const from = owner(dep.dependent);
    const to = owner(dep.dependency);
    if (!from || !to || from === to) continue;
    let set = dependents.get(to);
    if (!set) dependents.set(to, (set = new Set()));
    if (set.has(from)) continue;
    set.add(from);
    pending.set(from, (pending.get(from) ?? 0) + 1);
  }
  // Children (e.g. a changed function) come right after their changed parent file.
  for (const id of changed) {
    const parent = selfAndAncestors(id, parents).slice(1).find((a) => changedSet.has(a));
    if (!parent) continue;
    let set = dependents.get(parent);
    if (!set) dependents.set(parent, (set = new Set()));
    if (set.has(id)) continue;
    set.add(id);
    pending.set(id, (pending.get(id) ?? 0) + 1);
  }

  const order: string[] = [];
  const done = new Set<string>();
  let ready = changed.filter((id) => pending.get(id) === 0).sort(cmp);
  while (order.length < changed.length) {
    if (ready.length === 0) {
      // Cycle: release the first remaining node in stable order.
      ready = [changed.filter((id) => !done.has(id)).sort(cmp)[0]];
    }
    const id = ready.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    order.push(id);
    const released: string[] = [];
    for (const d of dependents.get(id) ?? []) {
      const left = (pending.get(d) ?? 0) - 1;
      pending.set(d, left);
      if (left === 0 && !done.has(d)) released.push(d);
    }
    ready = [...ready, ...released].sort(cmp);
  }
  return order;
}

/** Stable short hash (FNV-1a) of the changed set, so review progress is per diff. */
export function diffFingerprint(changedIds: Iterable<string>): string {
  let h = 0x811c9dc5;
  for (const id of [...new Set(changedIds)].sort()) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x0a;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface ReviewSummaryLabels {
  title: string;
  progress: string; // "{done}/{total} reviewed"
  comment: string;
}

/** Markdown checklist of the walkthrough, ready to paste into a PR. */
export function buildReviewMarkdown(
  projectName: string,
  steps: { node: Pick<GraphNode, "name" | "filePath" | "type">; entry: ReviewEntry | undefined }[],
  labels: ReviewSummaryLabels,
): string {
  const done = steps.filter((s) => s.entry?.reviewed).length;
  const lines = [
    `## ${labels.title} — ${projectName}`,
    "",
    labels.progress.replace("{done}", String(done)).replace("{total}", String(steps.length)),
    "",
  ];
  for (const { node, entry } of steps) {
    const where = node.filePath && node.filePath !== node.name ? ` (${node.filePath})` : "";
    lines.push(`- [${entry?.reviewed ? "x" : " "}] \`${node.name}\`${where} · ${node.type}`);
    const comment = entry?.comment.trim();
    if (comment) {
      for (const [i, line] of comment.split(/\r?\n/).entries()) {
        lines.push(i === 0 ? `  - ${labels.comment}: ${line}` : `    ${line}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
