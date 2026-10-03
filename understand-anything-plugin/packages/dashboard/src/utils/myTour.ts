import type { KnowledgeGraph, TourStep } from "@understand-anything/core/types";
import { containingFile, lineNotes, type AnnotationMap } from "./annotatedNodes";

export interface MyTourLabels {
  /** Heading for the line-notes list. */
  lineNotes: string;
  /** "Line {line}" style label; `{line}` is replaced. */
  line: string;
  /** Shown when a step has tags but no note. */
  noNote: string;
}

const DEFAULT_LABELS: MyTourLabels = { lineNotes: "Line notes", line: "Line {line}", noNote: "No note yet." };

/**
 * Turn annotated node ids (already ordered) into tour steps the existing tour
 * machinery can play: the user's note is the step description, followed by
 * their line notes and tags. Nodes outside any layer (functions, classes) put
 * their file first so the tour navigates to the right layer.
 */
export function buildMyTourSteps(
  graph: KnowledgeGraph,
  nodeIds: string[],
  annotations: AnnotationMap,
  labels: MyTourLabels = DEFAULT_LABELS,
): TourStep[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inLayer = new Set(graph.layers.flatMap((l) => l.nodeIds));
  const steps: TourStep[] = [];
  for (const id of nodeIds) {
    const node = byId.get(id);
    const a = annotations[id];
    if (!node || !a) continue;
    const parts: string[] = [];
    if (a.note.trim()) parts.push(a.note.trim());
    const lines = lineNotes(a);
    if (lines.length > 0) {
      parts.push(
        `**${labels.lineNotes}**\n\n` +
          lines.map((l) => `- **${labels.line.replace("{line}", String(l.line))}:** ${l.note.replace(/\s*\n\s*/g, " ")}`).join("\n"),
      );
    }
    if (parts.length === 0) parts.push(`_${labels.noNote}_`);
    if (a.tags.length > 0) parts.push(a.tags.map((t) => `\`#${t}\``).join(" "));

    const file = inLayer.has(id) ? undefined : containingFile(graph, node);
    steps.push({
      order: steps.length + 1,
      title: node.name,
      description: parts.join("\n\n"),
      nodeIds: file ? [file.id, id] : [id],
    });
  }
  return steps;
}
