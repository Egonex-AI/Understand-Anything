import { Fragment } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

export default function Breadcrumb() {
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const graph = useDashboardStore((s) => s.graph);
  const navigateToOverview = useDashboardStore((s) => s.navigateToOverview);
  // Subscribe to focusedContainerId so the trail re-renders as the user drills
  // in/out; focusBreadcrumb() derives the (cleaned) crumb path from it.
  const focusedContainerId = useDashboardStore((s) => s.focusedContainerId);
  const focusBreadcrumb = useDashboardStore((s) => s.focusBreadcrumb);
  const focusContainer = useDashboardStore((s) => s.focusContainer);
  const clearFocus = useDashboardStore((s) => s.clearFocus);
  const { t } = useI18n();

  const activeLayer = graph?.layers.find((l) => l.id === activeLayerId);
  const crumbs = focusedContainerId ? focusBreadcrumb() : [];
  const layerName = activeLayer?.name ?? t.layer.defaultName;

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-2 max-w-[calc(100%-2rem)]">
      {navigationLevel === "overview" && (
        <div className="px-4 py-2 rounded-full bg-elevated border border-border-subtle text-xs font-semibold tracking-wider uppercase text-text-secondary shadow-lg">
          {t.breadcrumb.projectOverview}
        </div>
      )}

      {navigationLevel === "layer-detail" && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-gold/30 text-xs font-semibold tracking-wider uppercase shadow-lg overflow-x-auto">
          <button
            onClick={navigateToOverview}
            className="text-gold hover:text-gold-bright transition-colors whitespace-nowrap"
          >
            {t.breadcrumb.project}
          </button>
          <span className="text-text-muted">›</span>

          {/* Layer crumb. When focused into a container it becomes a button that
              clears focus (back to the whole layer); otherwise it's plain text. */}
          {crumbs.length > 0 ? (
            <button
              onClick={clearFocus}
              className="text-gold hover:text-gold-bright transition-colors whitespace-nowrap"
            >
              {layerName}
            </button>
          ) : (
            <span className="text-text-primary whitespace-nowrap">{layerName}</span>
          )}

          {/* Focus trail — one crumb per nesting level. Every crumb except the
              last re-roots to that ancestor on click, so the user can step back
              up level by level. */}
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <Fragment key={c.id}>
                <span className="text-text-muted">›</span>
                {isLast ? (
                  <span className="text-text-primary whitespace-nowrap">{c.name}</span>
                ) : (
                  <button
                    onClick={() => focusContainer(c.id)}
                    className="text-gold hover:text-gold-bright transition-colors whitespace-nowrap"
                  >
                    {c.name}
                  </button>
                )}
              </Fragment>
            );
          })}

          {crumbs.length === 0 && (
            <span className="text-text-muted ml-1 text-[10px] normal-case tracking-normal whitespace-nowrap">
              ({t.breadcrumb.escBack})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
