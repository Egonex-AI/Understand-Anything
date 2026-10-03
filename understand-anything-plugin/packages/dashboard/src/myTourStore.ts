import { create } from "zustand";
import { useDashboardStore } from "./store";
import { useAnnotationsStore } from "./annotationsStore";
import { orderAnnotatedNodes, type AnnotatedOrder, type AnnotationMap } from "./utils/annotatedNodes";
import { buildMyTourSteps, type MyTourLabels } from "./utils/myTour";
import type { Locale } from "./locales";

/** Open state of the "My tour" builder dialog (null = closed). */
interface MyTourState {
  builder: { tag: string | null } | null;
  openBuilder: (tag?: string | null) => void;
  closeBuilder: () => void;
}

export const useMyTourStore = create<MyTourState>()((set) => ({
  builder: null,
  openBuilder: (tag = null) => set({ builder: { tag } }),
  closeBuilder: () => set({ builder: null }),
}));

/** The user's annotations as the tour/export helpers read them (`lines` may be present). */
export function currentAnnotations(): AnnotationMap {
  return useAnnotationsStore.getState().annotations as AnnotationMap;
}

export function myTourLabels(t: Locale): MyTourLabels {
  const n = t.notesTools;
  return { lineNotes: n.lineNotes, line: n.line, noNote: n.noNote };
}

/** Play the given annotated node ids as a tour; returns false when nothing could be played. */
export function playMyTour(nodeIds: string[], labels: MyTourLabels): boolean {
  const { graph, startCustomTour } = useDashboardStore.getState();
  if (!graph) return false;
  const steps = buildMyTourSteps(graph, nodeIds, currentAnnotations(), labels);
  if (steps.length === 0) return false;
  startCustomTour(steps);
  return true;
}

/** Build and play a tour straight away (palette shortcut), optionally limited to one tag. */
export function playMyTourFor(tag: string | null, labels: MyTourLabels, order: AnnotatedOrder = "graph"): boolean {
  const { graph } = useDashboardStore.getState();
  if (!graph) return false;
  return playMyTour(orderAnnotatedNodes(graph, currentAnnotations(), { order, tag }), labels);
}
