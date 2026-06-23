import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

export default function Breadcrumb() {
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const graph = useDashboardStore((s) => s.graph);
  const navigateToOverview = useDashboardStore((s) => s.navigateToOverview);
  const { t } = useI18n();

  const activeLayer = graph?.layers.find((l) => l.id === activeLayerId);

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
      {navigationLevel === "overview" && (
        <div className="px-4 py-2 rounded-full bg-elevated border border-border-subtle text-xs font-semibold tracking-wider uppercase text-text-secondary shadow-lg">
          {t.breadcrumb.projectOverview}
        </div>
      )}

      {navigationLevel === "layer-detail" && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-gold/30 text-xs font-semibold tracking-wider uppercase shadow-lg">
          <button
            onClick={navigateToOverview}
            className="text-gold hover:text-gold-bright transition-colors"
          >
            {t.breadcrumb.project}
          </button>
          <span className="text-text-muted">›</span>
          <span className="text-text-primary">
            {activeLayer?.name ?? t.layer.defaultName}
          </span>
          <span className="text-text-muted ml-1 text-[10px] normal-case tracking-normal">
            ({t.breadcrumb.escBack})
          </span>
        </div>
      )}
    </div>
  );
}
