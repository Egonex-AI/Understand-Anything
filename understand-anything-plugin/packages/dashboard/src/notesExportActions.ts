import { useDashboardStore } from "./store";
import { currentAnnotations } from "./myTourStore";
import { orderAnnotatedNodes } from "./utils/annotatedNodes";
import { buildNotesMarkdown, buildObsidianVault, safeFileName, type NotesExportLabels } from "./utils/notesExport";
import { createZip } from "./utils/zip";
import type { Locale } from "./locales";

/** Download the user's annotations as Markdown or an Obsidian vault, built in the browser. */

export function notesExportLabels(t: Locale): NotesExportLabels {
  const n = t.notesTools;
  return {
    title: n.exTitle,
    exported: n.exExported,
    contents: n.exContents,
    type: n.exType,
    file: n.exFile,
    lines: n.exLines,
    layer: n.exLayer,
    tags: n.exTags,
    updated: n.exUpdated,
    summary: n.exSummary,
    note: n.exNote,
    lineNotes: n.lineNotes,
    related: n.exRelated,
    index: n.exIndex,
    byLayer: n.exByLayer,
    byTag: n.exByTag,
    noLayer: n.exNoLayer,
    backToIndex: n.exBackToIndex,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click has been handled; some browsers cancel an immediately revoked download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Graph + annotations when there is something to export; alerts and returns null otherwise. */
function exportInput(t: Locale) {
  const graph = useDashboardStore.getState().graph;
  const annotations = currentAnnotations();
  if (!graph || orderAnnotatedNodes(graph, annotations).length === 0) {
    alert(t.notesTools.noNotesToExport);
    return null;
  }
  return { graph, annotations, base: safeFileName(graph.project.name || "project") };
}

export function exportNotesMarkdown(t: Locale): boolean {
  const input = exportInput(t);
  if (!input) return false;
  const md = buildNotesMarkdown(input.graph, input.annotations, { labels: notesExportLabels(t) });
  downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${input.base}-notes.md`);
  return true;
}

export function exportNotesVault(t: Locale): boolean {
  const input = exportInput(t);
  if (!input) return false;
  const files = buildObsidianVault(input.graph, input.annotations, { labels: notesExportLabels(t) });
  const zip = createZip(files);
  downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), `${input.base}-obsidian-notes.zip`);
  return true;
}
