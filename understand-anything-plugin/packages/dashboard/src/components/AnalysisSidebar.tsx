import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GraphNode } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";
import { useAnalysisStore } from "../analysisStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { HEAT_LEVELS, heatLevel, topHotspots } from "../utils/hotspots";
import { buildReviewMarkdown } from "../utils/review";
import { formatRule } from "../utils/archRules";

/** Heat-scale legend: rare → frequent. */
function HeatLegend() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 text-[10px] text-text-muted" aria-hidden="true">
      <span>{t.analysis.churnLow}</span>
      {Array.from({ length: HEAT_LEVELS }, (_, i) => (
        <span
          key={i}
          className="inline-block w-3 h-2 rounded-sm"
          style={{ backgroundColor: `var(--color-heat-${i + 1})` }}
        />
      ))}
      <span>{t.analysis.churnHigh}</span>
    </div>
  );
}

function PanelShell({
  title,
  subtitle,
  onClose,
  actions,
  children,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <section className="mx-3 mt-3 rounded-lg border border-border-medium bg-elevated/60 overflow-hidden animate-fade-slide-in" data-testid={testId}>
      <header className="flex items-start justify-between gap-2 px-3 py-2 border-b border-border-subtle">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider truncate">{title}</h3>
          {subtitle && <div className="text-[11px] text-text-secondary mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
          >
            {t.analysis.clearOverlay}
          </button>
        </div>
      </header>
      <div className="max-h-[42vh] overflow-y-auto">{children}</div>
    </section>
  );
}

function NodeRow({
  node,
  id,
  onClick,
  left,
  right,
  active,
}: {
  node: GraphNode | undefined;
  id: string;
  onClick: () => void;
  left?: ReactNode;
  right?: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        active ? "bg-accent/10" : "hover:bg-surface"
      }`}
      title={node?.filePath ?? id}
    >
      {left}
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-text-primary truncate">{node?.name ?? id}</span>
        {node?.filePath && node.filePath !== node.name && (
          <span className="block text-[10px] font-mono text-text-muted truncate">{node.filePath}</span>
        )}
      </span>
      {right}
    </button>
  );
}

function HotspotsPanel() {
  const { t } = useI18n();
  const report = useAnalysisStore((s) => s.hotspots);
  const status = useAnalysisStore((s) => s.hotspotsStatus);
  const days = useAnalysisStore((s) => s.hotspotDays);
  const graph = useDashboardStore((s) => s.graph);
  const fileNodeByPath = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of graph?.nodes ?? []) if (n.type === "file" && n.filePath) m.set(n.filePath, n);
    return m;
  }, [graph]);
  const top = useMemo(() => (report ? topHotspots(report, 12) : []), [report]);

  let body: ReactNode;
  if (status === "loading") body = <p className="px-3 py-3 text-xs text-text-muted">{t.analysis.hotspotsLoading}</p>;
  else if (status === "error" || !report) body = <p className="px-3 py-3 text-xs text-text-muted">{t.analysis.hotspotsError}</p>;
  else if (!report.available)
    body = (
      <p className="px-3 py-3 text-xs text-text-muted">
        {report.reason === "not-a-git-repo"
          ? t.analysis.hotspotsNotRepo
          : report.reason === "git-missing"
            ? t.analysis.hotspotsNoGit
            : t.analysis.hotspotsError}
      </p>
    );
  else if (top.length === 0) body = <p className="px-3 py-3 text-xs text-text-muted">{t.analysis.hotspotsEmpty}</p>;
  else
    body = (
      <div className="py-1">
        {top.map(({ path, churn }) => {
          const node = fileNodeByPath.get(path);
          const level = heatLevel(churn.commits, report.maxCommits);
          return (
            <NodeRow
              key={path}
              id={path}
              node={node ?? ({ name: path.split("/").pop() ?? path, filePath: path } as GraphNode)}
              onClick={() => node && useDashboardStore.getState().navigateToNode(node.id)}
              left={<span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `var(--color-heat-${level})` }} />}
              right={
                <span className="text-[10px] font-mono text-text-secondary shrink-0">
                  {fmt(t.analysis.commits, { n: churn.commits })}
                </span>
              }
            />
          );
        })}
        {report.truncated && <p className="px-3 py-1.5 text-[10px] text-text-muted">{t.analysis.hotspotsTruncated}</p>}
      </div>
    );

  return (
    <PanelShell
      testId="hotspots-panel"
      title={fmt(t.analysis.hotspotsTop, { n: days })}
      subtitle={status === "ready" && report?.available ? <HeatLegend /> : undefined}
      onClose={() => useAnalysisStore.getState().clearOverlay()}
    >
      {body}
    </PanelShell>
  );
}

function ImpactPanel() {
  const { t } = useI18n();
  const impact = useAnalysisStore((s) => s.impact);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  if (!impact) return null;
  const root = nodesById.get(impact.rootId);
  const total = impact.depths.size;
  const navigate = (id: string) => useDashboardStore.getState().navigateToNode(id);
  return (
    <PanelShell
      testId="impact-panel"
      title={fmt(t.analysis.impactOf, { name: root?.name ?? impact.rootId })}
      subtitle={
        total === 0 ? t.analysis.impactNone : fmt(t.analysis.impactSummary, { count: total, depth: impact.byDepth.length })
      }
      onClose={() => useAnalysisStore.getState().clearOverlay()}
      actions={
        selectedNodeId !== impact.rootId ? (
          <button
            type="button"
            onClick={() => navigate(impact.rootId)}
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
          >
            {t.analysis.impactRoot}
          </button>
        ) : undefined
      }
    >
      {impact.byDepth.map((ids, i) => (
        <div key={i} className="py-1">
          <div className="px-3 pt-1 pb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-impact)]">
            {fmt(t.analysis.impactDepth, { n: i + 1 })}
            {i === 0 && <span className="text-text-muted normal-case font-normal">· {t.analysis.impactDirect}</span>}
            <span className="text-text-muted font-normal">({ids.length})</span>
          </div>
          {ids.map((id) => (
            <NodeRow
              key={id}
              id={id}
              node={nodesById.get(id)}
              active={id === selectedNodeId}
              onClick={() => navigate(id)}
              right={<span className="text-[9px] uppercase tracking-wider text-text-muted shrink-0">{nodesById.get(id)?.type}</span>}
            />
          ))}
        </div>
      ))}
      {impact.truncated && (
        <p className="px-3 py-1.5 text-[10px] text-text-muted">{fmt(t.analysis.impactTruncated, { n: total })}</p>
      )}
    </PanelShell>
  );
}

function ViolationsPanel() {
  const { t } = useI18n();
  const rules = useAnalysisStore((s) => s.rules);
  const evaluation = useAnalysisStore((s) => s.evaluation);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const total = evaluation?.violations.length ?? 0;
  const a = useAnalysisStore.getState();
  return (
    <PanelShell
      testId="violations-panel"
      title={t.analysis.violationsTitle}
      subtitle={total === 0 ? t.analysis.noViolations : fmt(t.analysis.violationCount, { n: total })}
      onClose={() => a.clearOverlay()}
      actions={
        <button
          type="button"
          onClick={() => a.openRulesEditor()}
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-accent/30 text-accent hover:border-accent/60 transition-colors"
          data-testid="edit-rules"
        >
          {t.analysis.editRules}
        </button>
      }
    >
      {rules.filter((r) => r.enabled).map((rule) => {
        const list = evaluation?.byRule.get(rule.id) ?? [];
        const invalid = evaluation?.invalid.get(rule.id);
        return (
          <div key={rule.id} className="py-1 border-b border-border-subtle last:border-b-0">
            <div className="px-3 pt-1 pb-0.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <code className="block text-[10px] font-mono text-text-secondary break-all">{formatRule(rule)}</code>
                {rule.description && <span className="block text-[10px] text-text-muted">{rule.description}</span>}
              </div>
              <span
                className={`shrink-0 text-[10px] font-mono ${
                  invalid ? "text-text-muted" : list.length > 0 ? "text-[var(--color-violation)]" : "text-node-function"
                }`}
              >
                {invalid ? "!" : list.length > 0 ? list.length : "✓"}
              </span>
            </div>
            {invalid && (
              <p className="px-3 text-[10px] text-[var(--color-violation)]">{fmt(t.analysis.invalidSelector, { error: invalid })}</p>
            )}
            {list.map((v, i) => {
              const from = nodesById.get(v.dependent);
              const to = nodesById.get(v.dependency);
              return (
                <button
                  key={`${v.edge.source}-${v.edge.target}-${v.edge.type}-${i}`}
                  type="button"
                  onClick={() => useDashboardStore.getState().navigateToNode(v.edge.source)}
                  className="w-full px-3 py-1 text-left hover:bg-surface transition-colors"
                  title={`${from?.filePath ?? v.dependent} → ${to?.filePath ?? v.dependency}`}
                >
                  <span className="block text-xs text-text-primary truncate">
                    {from?.name ?? v.dependent}
                    <span className="mx-1 text-[var(--color-violation)]">→</span>
                    {to?.name ?? v.dependency}
                  </span>
                  <span className="block text-[10px] text-text-muted">{v.edge.type}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </PanelShell>
  );
}

function ReviewPanel() {
  const { t } = useI18n();
  const steps = useAnalysisStore((s) => s.reviewSteps);
  const index = useAnalysisStore((s) => s.reviewIndex);
  const entries = useAnalysisStore((s) => s.reviewEntries);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const projectName = useDashboardStore((s) => s.graph?.project.name ?? "");
  const [copied, setCopied] = useState(false);
  const a = useAnalysisStore.getState();

  // ← / → step through the review unless a tour owns the arrows or the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (useDashboardStore.getState().tourActive) return;
      const s = useAnalysisStore.getState();
      e.preventDefault();
      s.goToReviewStep(s.reviewIndex + (e.key === "ArrowRight" ? 1 : -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const done = steps.filter((id) => entries[id]?.reviewed).length;
  const currentId = steps[index];
  const current = currentId ? nodesById.get(currentId) : undefined;
  const entry = currentId ? entries[currentId] : undefined;

  const copySummary = () => {
    const md = buildReviewMarkdown(
      projectName,
      steps.map((id) => ({
        node: nodesById.get(id) ?? { name: id, type: "file" as const },
        entry: entries[id],
      })),
      { title: t.analysis.reviewSummaryTitle, progress: t.analysis.reviewProgress, comment: t.analysis.reviewSummaryComment },
    );
    void navigator.clipboard
      ?.writeText(md)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const btn =
    "text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <PanelShell
      testId="review-panel"
      title={t.analysis.reviewTitle}
      subtitle={
        <span className="flex items-center gap-2">
          <span data-testid="review-progress">{fmt(t.analysis.reviewProgress, { done, total: steps.length })}</span>
          <span className="flex-1 h-1 rounded-full bg-surface overflow-hidden min-w-[60px]">
            <span
              className="block h-full bg-node-function transition-[width]"
              style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }}
            />
          </span>
        </span>
      }
      onClose={() => a.clearOverlay()}
      actions={
        <button type="button" onClick={copySummary} className={btn} data-testid="review-copy" title={t.analysis.copySummary}>
          {copied ? t.analysis.copied : t.analysis.copyMd}
        </button>
      }
    >
      {current && currentId && (
        <div className="px-3 py-2 border-b border-border-subtle space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              {fmt(t.analysis.reviewStep, { n: index + 1, total: steps.length })}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" className={btn} disabled={index === 0} onClick={() => a.goToReviewStep(index - 1)}>
                ← {t.analysis.reviewPrev}
              </button>
              <button
                type="button"
                className={btn}
                disabled={index >= steps.length - 1}
                onClick={() => a.goToReviewStep(index + 1)}
                data-testid="review-next"
              >
                {t.analysis.reviewNext} →
              </button>
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-heading text-text-primary truncate">{current.name}</div>
            {current.filePath && <div className="text-[10px] font-mono text-text-muted truncate">{current.filePath}</div>}
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!entry?.reviewed}
              onChange={(e) => a.setReviewEntry(currentId, { reviewed: e.target.checked })}
              className="accent-[var(--color-accent)]"
              data-testid="review-checkbox"
            />
            {t.analysis.reviewed}
          </label>
          <textarea
            value={entry?.comment ?? ""}
            onChange={(e) => a.setReviewEntry(currentId, { comment: e.target.value })}
            placeholder={t.analysis.reviewCommentPlaceholder}
            aria-label={t.analysis.reviewComment}
            rows={2}
            className="w-full bg-surface text-text-primary text-xs rounded-md px-2 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 resize-y"
            data-testid="review-comment"
          />
          <p className="text-[10px] text-text-muted">{t.analysis.reviewKeys}</p>
        </div>
      )}
      <ol className="py-1">
        {steps.map((id, i) => (
          <li key={id}>
            <NodeRow
              id={id}
              node={nodesById.get(id)}
              active={i === index}
              onClick={() => a.goToReviewStep(i)}
              left={
                <span
                  className={`w-4 h-4 shrink-0 rounded-full text-[9px] font-semibold flex items-center justify-center ${
                    entries[id]?.reviewed ? "bg-node-function/25 text-node-function" : "bg-surface text-text-muted"
                  }`}
                >
                  {entries[id]?.reviewed ? "✓" : i + 1}
                </span>
              }
              right={
                entries[id]?.comment.trim() ? (
                  <span className="text-[10px] text-text-muted shrink-0" title={entries[id]?.comment}>
                    ✎
                  </span>
                ) : undefined
              }
            />
          </li>
        ))}
      </ol>
    </PanelShell>
  );
}

/** Sidebar panel for whichever analysis overlay is active (rendered above node details). */
export default function AnalysisSidebar() {
  const overlay = useAnalysisStore((s) => s.overlay);
  if (overlay === "hotspots") return <HotspotsPanel />;
  if (overlay === "impact") return <ImpactPanel />;
  if (overlay === "rules") return <ViolationsPanel />;
  if (overlay === "review") return <ReviewPanel />;
  return null;
}
