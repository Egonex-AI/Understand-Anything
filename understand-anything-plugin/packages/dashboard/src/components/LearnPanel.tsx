import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

export default function LearnPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const currentTourStep = useDashboardStore((s) => s.currentTourStep);
  const startTour = useDashboardStore((s) => s.startTour);
  const stopTour = useDashboardStore((s) => s.stopTour);
  const setTourStep = useDashboardStore((s) => s.setTourStep);
  const nextTourStep = useDashboardStore((s) => s.nextTourStep);
  const prevTourStep = useDashboardStore((s) => s.prevTourStep);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const { t } = useI18n();

  const tourSteps = useMemo(
    () => graph?.tour ? [...graph.tour].sort((a, b) => a.order - b.order) : [],
    [graph?.tour]
  );
  const hasTour = tourSteps.length > 0;

  // State 1: No tour available
  if (!hasTour) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center px-4">
          <div className="text-2xl mb-2 text-text-muted">&#x1f9ed;</div>
          <p className="text-text-muted text-sm">{t.learnPanel.noTour}</p>
          <p className="text-text-muted text-xs mt-1">
            {t.learnPanel.noTourHint}
          </p>
        </div>
      </div>
    );
  }

  // State 2: Tour available but not started
  if (!tourActive) {
    return (
      <div className="h-full w-full overflow-auto p-5">
        <div className="mb-4">
          <h2 className="text-lg font-heading text-text-primary mb-1">{t.learnPanel.projectTour}</h2>
          <p className="text-xs text-text-muted">
            {tourSteps.length} {t.learnPanel.steps} &middot; {t.learnPanel.guidedWalkthrough}
          </p>
        </div>

        <button
          onClick={startTour}
          className="w-full mb-4 bg-accent/10 border border-accent/30 text-accent text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-accent/20 transition-colors"
        >
          {t.learnPanel.startTour}
        </button>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            {t.learnPanel.steps}
          </h3>
          {tourSteps.map((step, i) => (
            <div
              key={step.order}
              className="flex items-start gap-2 text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle"
            >
              <span className="text-accent font-mono shrink-0 mt-0.5">
                {i + 1}.
              </span>
              <span className="text-text-secondary">{step.title}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // State 3: Tour active
  const step = tourSteps[currentTourStep];
  if (!step) return null;

  const totalSteps = tourSteps.length;
  const progressPct = ((currentTourStep + 1) / totalSteps) * 100;
  const isFirst = currentTourStep === 0;
  const isLast = currentTourStep === totalSteps - 1;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Header with progress counter and exit */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
            {t.learnPanel.tour}
          </h3>
          <span className="text-xs text-text-muted">
            {currentTourStep + 1} / {totalSteps}
          </span>
        </div>
        <button
          onClick={stopTour}
          className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {t.learnPanel.exitTour}
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-elevated shrink-0">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {/* Step title */}
        <h2 className="text-lg font-heading text-text-primary mb-3">{step.title}</h2>

        {/* Description via ReactMarkdown */}
        <div className="text-sm text-text-secondary leading-relaxed mb-4 tour-markdown">
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p className="mb-1.5 last:mb-0">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-text-primary">{children}</strong>
              ),
              code: ({ className, children }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code className="block bg-elevated rounded px-2 py-1.5 mb-1.5 overflow-x-auto text-[11px] leading-relaxed">
                    {children}
                  </code>
                ) : (
                  <code className="bg-elevated rounded px-1 py-0.5 text-[11px]">
                    {children}
                  </code>
                );
              },
              ul: ({ children }) => (
                <ul className="list-disc list-inside mb-1.5 space-y-0.5">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside mb-1.5 space-y-0.5">
                  {children}
                </ol>
              ),
            }}
          >
            {step.description}
          </ReactMarkdown>
        </div>

        {/* Language lesson */}
        {step.languageLesson && (
          <div className="bg-accent/5 border border-accent/20 rounded p-3 mb-4">
            <h4 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-1.5">
              Language Lesson
            </h4>
            <p className="text-sm text-text-secondary leading-relaxed">
              {step.languageLesson}
            </p>
          </div>
        )}

        {/* Referenced component pills */}
        {step.nodeIds.length > 0 && (
          <div className="mb-4">
            <h4 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
              Referenced Components
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {step.nodeIds.map((nodeId) => {
                const node = graph?.nodes.find((n) => n.id === nodeId);
                return (
                  <button
                    key={nodeId}
                    onClick={() => selectNode(nodeId)}
                    className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {node?.name ?? nodeId}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Navigation: dots + prev/next */}
      <div className="px-3 py-2 border-t border-border-subtle shrink-0">
        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mb-2">
          {tourSteps.map((_, i) => (
            <button
              key={i}
              onClick={() => setTourStep(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentTourStep
                  ? "bg-accent"
                  : "bg-elevated hover:bg-surface"
              }`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Prev / Next buttons */}
        <div className="flex gap-2">
          <button
            onClick={prevTourStep}
            disabled={isFirst}
            className="flex-1 text-xs bg-elevated text-text-secondary py-1.5 rounded-lg hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.learnPanel.prev}
          </button>
          <button
            onClick={isLast ? stopTour : nextTourStep}
            className="flex-1 text-xs bg-accent/10 border border-accent/30 text-accent py-1.5 rounded-lg hover:bg-accent/20 transition-colors"
          >
            {isLast ? t.learnPanel.finish : t.learnPanel.next}
          </button>
        </div>
      </div>
    </div>
  );
}
