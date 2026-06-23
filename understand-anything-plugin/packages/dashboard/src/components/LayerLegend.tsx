import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

// Shared layer color palette — used by LayerLegend, LayerClusterNode, PortalNode, and GraphView
export const LAYER_PALETTE = [
  { bg: "rgba(74, 124, 155, 0.12)", border: "rgba(74, 124, 155, 0.4)", label: "#4a7c9b" },   // blue (API)
  { bg: "rgba(90, 158, 111, 0.12)", border: "rgba(90, 158, 111, 0.4)", label: "#5a9e6f" },   // green (Data)
  { bg: "rgba(139, 111, 176, 0.12)", border: "rgba(139, 111, 176, 0.4)", label: "#8b6fb0" }, // purple (Service)
  { bg: "rgba(201, 160, 108, 0.12)", border: "rgba(201, 160, 108, 0.4)", label: "#c9a06c" }, // gold (Config)
  { bg: "rgba(176, 122, 138, 0.12)", border: "rgba(176, 122, 138, 0.4)", label: "#b07a8a" }, // pink (UI)
  { bg: "rgba(74, 155, 140, 0.12)", border: "rgba(74, 155, 140, 0.4)", label: "#4a9b8c" },   // teal (Middleware)
  { bg: "rgba(120, 130, 145, 0.12)", border: "rgba(120, 130, 145, 0.4)", label: "#788291" }, // slate (Test)
];

export function getLayerColor(index: number) {
  return LAYER_PALETTE[index % LAYER_PALETTE.length];
}

export default function LayerLegend() {
  const graph = useDashboardStore((s) => s.graph);
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const { t } = useI18n();

  const layers = graph?.layers ?? [];
  const hasLayers = layers.length > 0;

  if (!hasLayers) return null;

  const activeLayer = layers.find((l) => l.id === activeLayerId);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-text-secondary whitespace-nowrap">
        {navigationLevel === "overview"
          ? `${layers.length} ${t.layer.label}`
          : activeLayer?.name ?? t.layer.defaultName}
      </span>

      <div className="flex items-center gap-3">
        {layers.map((layer, i) => {
          const color = getLayerColor(i);
          const isActive = navigationLevel === "layer-detail" && layer.id === activeLayerId;
          return (
            <div key={layer.id} className="flex items-center gap-1 whitespace-nowrap">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: color.label,
                  opacity: navigationLevel === "layer-detail" && !isActive ? 0.3 : 1,
                }}
              />
              <span
                className={`text-[11px] ${
                  isActive ? "text-text-primary font-medium" : "text-text-secondary"
                }`}
                style={{
                  opacity: navigationLevel === "layer-detail" && !isActive ? 0.4 : 1,
                }}
              >
                {layer.name}
                <span className="text-text-muted ml-0.5">
                  ({layer.nodeIds.length})
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
