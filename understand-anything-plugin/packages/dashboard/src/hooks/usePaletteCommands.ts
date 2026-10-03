import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { useAnalysisStore } from "../analysisStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { useTheme, PRESETS } from "../themes/index.ts";
import type { PaletteCommand } from "../components/CommandPalette";

/** Commands offered by the Ctrl/⌘+K palette. Features register more here. */
export function usePaletteCommands({ openShortcutsHelp }: { openShortcutsHelp: () => void }): PaletteCommand[] {
  const { t } = useI18n();
  const { setPreset } = useTheme();
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const hasDomainGraph = useDashboardStore((s) => s.domainGraph !== null);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const hasDiff = useDashboardStore((s) => s.changedNodeIds.size > 0);
  const overlayActive = useAnalysisStore((s) => s.overlay !== null);

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
      const an = () => useAnalysisStore.getState();
      const a = t.analysis;
      cmds.push(
        { id: "hotspots", label: a.hotspotsCmd, keywords: "git churn heat hotspots commits", run: () => an().showHotspots() },
        ...[30, 90, 365].map((days) => ({
          id: `hotspots-${days}`,
          label: `${a.hotspotsCmd}: ${fmt(a.lastDays, { n: days })}`,
          keywords: "git churn heat hotspots",
          run: () => an().showHotspots(days),
        })),
        { id: "arch-rules", label: a.rulesCmd, keywords: "architecture rules layers dependency lint", run: () => an().openRulesEditor() },
        { id: "arch-violations", label: a.violationsCmd, keywords: "architecture rules violations", run: () => an().showViolations() },
      );
      if (hasDiff) {
        cmds.push({ id: "review", label: a.reviewCmd, keywords: "pr pull request review diff walkthrough", run: () => an().startReview() });
      }
      if (overlayActive) {
        cmds.push({ id: "clear-overlay", label: a.clearOverlayCmd, keywords: "overlay hotspots impact rules review", run: () => an().clearOverlay() });
      }
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
      if (!isKnowledgeGraph) {
        cmds.push({
          id: "impact",
          label: t.analysis.impactCmd,
          keywords: "impact blast radius dependents affected",
          run: () => useAnalysisStore.getState().showImpact(selectedNodeId),
        });
      }
      cmds.push({
        id: "ask-ai",
        label: t.ai.askSelectedCmd,
        keywords: "ai llm chat claude gpt explain",
        run: () => st().openAiDialog(selectedNodeId),
      });
    }
    if (codeViewerOpen) cmds.push({ id: "close-code", label: p.closeCode, run: () => st().closeCodeViewer() });
    return cmds;
  }, [t, setPreset, selectedNodeId, hasDomainGraph, isKnowledgeGraph, codeViewerOpen, openShortcutsHelp, hasDiff, overlayActive]);
}
