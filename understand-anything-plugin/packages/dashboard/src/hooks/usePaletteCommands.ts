import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { useTheme, PRESETS } from "../themes/index.ts";
import type { PaletteCommand } from "../components/CommandPalette";
import { useAnnotationsStore } from "../annotationsStore";
import { myTourLabels, playMyTourFor, useMyTourStore } from "../myTourStore";
import { collectTags } from "../utils/annotatedNodes";
import { fmt } from "../locales";

/** Commands offered by the Ctrl/⌘+K palette. Features register more here. */
export function usePaletteCommands({ openShortcutsHelp }: { openShortcutsHelp: () => void }): PaletteCommand[] {
  const { t } = useI18n();
  const { setPreset } = useTheme();
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const hasDomainGraph = useDashboardStore((s) => s.domainGraph !== null);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const hasAnnotations = useAnnotationsStore((s) => Object.keys(s.annotations).length > 0);
  // Joined so the selector result compares by value and commands only rebuild when tags change.
  const annotationTags = useAnnotationsStore((s) => collectTags(s.annotations).join("\n"));

  return useMemo(() => {
    const st = () => useDashboardStore.getState();
    const p = t.palette;
    const cmds: PaletteCommand[] = [
      { id: "overview", label: p.goOverview, keywords: "home layers", run: () => st().navigateToOverview() },
      {
        id: "copy-link",
        label: p.copyLink,
        keywords: "url share permalink",
        run: () => void navigator.clipboard?.writeText(window.location.href),
      },
      { id: "diff", label: t.keyboardShortcuts.toggleDiff, hint: "D", run: () => st().toggleDiffMode() },
      { id: "filter", label: t.keyboardShortcuts.toggleFilter, hint: "F", run: () => st().toggleFilterPanel() },
      { id: "export", label: t.keyboardShortcuts.toggleExport, hint: "E", run: () => st().toggleExportMenu() },
      { id: "path", label: t.keyboardShortcuts.openPathFinder, hint: "P", run: () => st().togglePathFinder() },
      { id: "help", label: t.keyboardShortcuts.showHelp, hint: "?", run: openShortcutsHelp },
      {
        id: "ai-settings",
        label: t.ai.settings,
        keywords: "ai llm model provider api key base url openai anthropic deepseek glm",
        run: () => st().openAiDialog(st().selectedNodeId, "settings"),
      },
      { id: "persona-overview", label: `${p.mode}: ${t.personaSelector.overview}`, run: () => st().setPersona("non-technical") },
      { id: "persona-learn", label: `${p.mode}: ${t.personaSelector.learn}`, run: () => st().setPersona("junior") },
      { id: "persona-deep", label: `${p.mode}: ${t.personaSelector.deepDive}`, run: () => st().setPersona("experienced") },
      ...PRESETS.map((preset) => ({
        id: `theme-${preset.id}`,
        label: `${p.theme}: ${preset.name}`,
        keywords: "theme color dark light",
        run: () => setPreset(preset.id),
      })),
    ];
    if (!isKnowledgeGraph) {
      cmds.push(
        { id: "detail-files", label: `${p.detail}: ${t.detailLevel.files}`, run: () => st().setDetailLevel("file") },
        { id: "detail-classes", label: `${p.detail}: ${t.detailLevel.classes}`, run: () => st().setDetailLevel("class") },
      );
      if (hasDomainGraph) {
        cmds.push(
          { id: "view-structural", label: `${p.view}: ${t.drawer.structural}`, run: () => st().setViewMode("structural") },
          { id: "view-domain", label: `${p.view}: ${t.drawer.domain}`, run: () => st().setViewMode("domain") },
        );
      }
    }
    if (selectedNodeId) {
      const node = st().nodesById.get(selectedNodeId);
      if (node?.filePath) {
        cmds.push({ id: "open-code", label: p.openSelectedCode, run: () => st().openCodeViewer(selectedNodeId) });
      }
      cmds.push({ id: "focus", label: p.focusSelected, run: () => st().setFocusNode(selectedNodeId) });
      cmds.push({
        id: "ask-ai",
        label: t.ai.askSelectedCmd,
        keywords: "ai llm chat claude gpt explain",
        run: () => st().openAiDialog(selectedNodeId),
      });
    }
    if (codeViewerOpen) cmds.push({ id: "close-code", label: p.closeCode, run: () => st().closeCodeViewer() });
    const nt = t.notesTools;
    if (hasAnnotations) {
      cmds.push({
        id: "my-tour",
        label: nt.buildMyTour,
        keywords: "tour notes annotations tags personal walkthrough",
        run: () => useMyTourStore.getState().openBuilder(null),
      });
      for (const tag of annotationTags ? annotationTags.split("\n") : []) {
        cmds.push({
          id: `my-tour-tag-${tag}`,
          label: fmt(nt.playMyTourTag, { tag }),
          keywords: "tour notes annotations tag",
          run: () => void playMyTourFor(tag, myTourLabels(t)),
        });
      }
    }
    if (tourActive) cmds.push({ id: "exit-tour", label: nt.exitTour, keywords: "stop tour", run: () => st().stopTour() });
    return cmds;
  }, [t, setPreset, selectedNodeId, hasDomainGraph, isKnowledgeGraph, codeViewerOpen, openShortcutsHelp, tourActive, hasAnnotations, annotationTags]);
}
