import { lazy, Suspense, useEffect } from "react";
import { createPortal } from "react-dom";
import { useDashboardStore } from "../store";
import { useAnalysisStore } from "../analysisStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { HOTSPOT_WINDOWS } from "../utils/hotspots";

const RulesEditorModal = lazy(() => import("./RulesEditorModal"));

const pill =
  "px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap flex items-center gap-1.5";
const pillOff = "bg-elevated text-text-secondary hover:bg-surface hover:text-text-primary";

/**
 * Header controls for the analysis overlays: hotspots (with time window and
 * legend), architecture-rule violations and the PR review walkthrough.
 * Also loads the analysis data once the project is known.
 */
export default function AnalysisToolbar({ accessToken }: { accessToken: string }) {
  const { t } = useI18n();
  const projectName = useDashboardStore((s) => s.graph?.project.name);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const hasDiff = useDashboardStore((s) => s.changedNodeIds.size > 0);
  const overlay = useAnalysisStore((s) => s.overlay);
  const hotspotDays = useAnalysisStore((s) => s.hotspotDays);
  const hotspotsStatus = useAnalysisStore((s) => s.hotspotsStatus);
  const hotspotsAvailable = useAnalysisStore((s) => s.hotspots?.available !== false);
  const ruleCount = useAnalysisStore((s) => s.rules.filter((r) => r.enabled).length);
  const violationCount = useAnalysisStore((s) => s.evaluation?.violations.length ?? 0);
  const rulesEditorOpen = useAnalysisStore((s) => s.rulesEditorOpen);

  useEffect(() => {
    if (projectName === undefined) return;
    useAnalysisStore.getState().init(accessToken, projectName);
  }, [accessToken, projectName]);

  if (!projectName || isKnowledgeGraph) return null;
  const a = useAnalysisStore.getState();
  const hotspotsOn = overlay === "hotspots";

  return (
    <div className="flex items-center gap-2" data-testid="analysis-toolbar">
      <div className="w-px h-5 bg-border-subtle" />
      <button
        type="button"
        onClick={() => (hotspotsOn ? a.clearOverlay() : a.showHotspots())}
        title={t.analysis.hotspotsTitle}
        aria-pressed={hotspotsOn}
        data-testid="hotspots-toggle"
        className={`${pill} ${
          hotspotsOn
            ? "bg-[color-mix(in_srgb,var(--color-heat-4)_22%,transparent)] text-[var(--color-heat-4)]"
            : pillOff
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.5 2 3 0-3 0-5.5 1-8.5z" />
        </svg>
        {t.analysis.hotspots}
      </button>
      {hotspotsOn && (
        <>
          <div className="flex items-center bg-elevated rounded-lg p-0.5" role="group" aria-label={t.analysis.window}>
            {HOTSPOT_WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => a.showHotspots(days)}
                title={fmt(t.analysis.lastDays, { n: days })}
                className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                  hotspotDays === days ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {fmt(t.analysis.daysShort, { n: days })}
              </button>
            ))}
          </div>
          {hotspotsStatus === "loading" ? (
            <span className="text-[10px] text-text-muted">{t.analysis.hotspotsLoading}</span>
          ) : hotspotsStatus === "error" || !hotspotsAvailable ? (
            <span className="text-[10px] text-text-muted">{t.analysis.hotspotsUnavailable}</span>
          ) : null}
        </>
      )}

      <button
        type="button"
        onClick={() => (ruleCount === 0 ? a.openRulesEditor() : overlay === "rules" ? a.clearOverlay() : a.showViolations())}
        title={ruleCount === 0 ? t.analysis.rulesNone : t.analysis.violationsTitle}
        aria-pressed={overlay === "rules"}
        data-testid="rules-toggle"
        className={`${pill} ${
          overlay === "rules"
            ? "bg-[color-mix(in_srgb,var(--color-violation)_20%,transparent)] text-[var(--color-violation)]"
            : pillOff
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7l8-4z" />
        </svg>
        {t.analysis.rules}
        {ruleCount > 0 && (
          <span
            className={`min-w-[16px] px-1 rounded-full text-[9px] font-semibold leading-4 text-center ${
              violationCount > 0
                ? "bg-[var(--color-violation)] text-white"
                : "bg-node-function/25 text-node-function"
            }`}
            data-testid="violation-count"
          >
            {violationCount > 0 ? violationCount : "✓"}
          </span>
        )}
      </button>

      {hasDiff && (
        <button
          type="button"
          onClick={() => (overlay === "review" ? a.clearOverlay() : a.startReview())}
          title={t.analysis.reviewTitle}
          aria-pressed={overlay === "review"}
          data-testid="review-toggle"
          className={`${pill} ${overlay === "review" ? "bg-accent/20 text-accent" : pillOff}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5 2a8 8 0 11-16 0 8 8 0 0116 0z" />
          </svg>
          {t.analysis.review}
        </button>
      )}

      {rulesEditorOpen &&
        createPortal(
          <Suspense fallback={null}>
            <RulesEditorModal />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}
