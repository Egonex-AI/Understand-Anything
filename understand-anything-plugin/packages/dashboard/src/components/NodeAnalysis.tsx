import type { GraphNode } from "@understand-anything/core/types";
import { useAnalysisStore } from "../analysisStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { churnForPath, heatLevel } from "../utils/hotspots";

/** NodeInfo header button: toggle the impact overlay for this node. */
export function ImpactButton({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const active = useAnalysisStore((s) => s.overlay === "impact" && s.impact?.rootId === nodeId);
  return (
    <button
      type="button"
      onClick={() => {
        const a = useAnalysisStore.getState();
        if (active) a.clearOverlay();
        else a.showImpact(nodeId);
      }}
      title={t.analysis.impactTitle}
      aria-pressed={active}
      data-testid="impact-button"
      className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--color-impact)_20%,transparent)] text-[var(--color-impact)] border border-[var(--color-impact)]/50"
          : "text-text-muted border border-border-subtle hover:text-[var(--color-impact)] hover:border-[var(--color-impact)]/40"
      }`}
    >
      {t.analysis.impact}
    </button>
  );
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { year: "2-digit", month: "short" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Git churn for the node's file (commits, last change, authors) in the current window. */
export function NodeChurnStats({ node }: { node: GraphNode }) {
  const { t, localeKey } = useI18n();
  const report = useAnalysisStore((s) => s.hotspots);
  const status = useAnalysisStore((s) => s.hotspotsStatus);
  const days = useAnalysisStore((s) => s.hotspotDays);
  if (!node.filePath) return null;

  if (status === "idle") {
    return (
      <button
        type="button"
        onClick={() => useAnalysisStore.getState().ensureHotspots()}
        className="mb-4 -mt-2 text-[10px] text-text-muted hover:text-accent transition-colors"
        data-testid="load-churn"
      >
        {t.analysis.showChurn}
      </button>
    );
  }
  if (status !== "ready" || !report?.available) return null;

  const churn = churnForPath(report, node.filePath);
  const level = churn ? heatLevel(churn.commits, report.maxCommits) : 0;
  return (
    <div className="mb-4" data-testid="node-churn">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
        {level > 0 && (
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `var(--color-heat-${level})` }} aria-hidden="true" />
        )}
        {fmt(t.analysis.churnHeading, { n: days })}
      </h3>
      {churn ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: t.analysis.churnCommits, value: String(churn.commits), title: undefined as string | undefined },
            { label: t.analysis.churnLastChanged, value: formatDate(churn.lastChanged, localeKey), title: churn.lastChanged },
            { label: t.analysis.churnAuthors, value: String(churn.authors) },
          ].map((s) => (
            <div key={s.label} className="bg-elevated rounded-lg px-2 py-1.5 border border-border-subtle min-w-0">
              <div className="text-sm font-mono text-text-primary truncate" title={s.title ?? s.value}>{s.value}</div>
              <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">{fmt(t.analysis.churnNone, { n: days })}</p>
      )}
    </div>
  );
}
