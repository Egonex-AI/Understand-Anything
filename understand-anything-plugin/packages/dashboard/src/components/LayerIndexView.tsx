import { useDashboardStore } from "../store";
import { computePortals } from "../utils/edgeAggregation";
import { slug } from "../utils/containers";
import { getLayerColor } from "./LayerLegend";

/**
 * Index view for layers with many data-defined containers (layer.containers).
 * A graph canvas tells you nothing when a layer is 38 homogeneous features in
 * a star around one hub — the honest presentation is a scrollable feature
 * index. The graph remains one drill level below (feature mini-canvas).
 */
export default function LayerIndexView() {
  const graph = useDashboardStore((s) => s.graph);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const drillIntoContainer = useDashboardStore((s) => s.drillIntoContainer);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  if (!graph || !activeLayerId) return null;
  const layer = graph.layers.find((l) => l.id === activeLayerId);
  if (!layer?.containers?.length) return null;

  const claimed = new Set(layer.containers.flatMap((c) => c.nodeIds));
  const ungrouped = layer.nodeIds.filter((id) => !claimed.has(id));
  const portals = computePortals(graph, activeLayerId);
  const layerIndexMap = new Map(graph.layers.map((l, i) => [l.id, i]));
  // Sections: containers may declare a `group` (e.g. "services", "models").
  // Section order = first appearance in data; ungrouped go to "features".
  const sections: { title: string; items: typeof layer.containers }[] = [];
  const sectionIdx = new Map<string, number>();
  for (const c of layer.containers) {
    const title = c.group ?? "features";
    if (!sectionIdx.has(title)) {
      sectionIdx.set(title, sections.length);
      sections.push({ title, items: [] });
    }
    sections[sectionIdx.get(title)!].items.push(c);
  }
  for (const sec of sections) {
    sec.items = [...sec.items].sort((a, b) => a.name.localeCompare(b.name));
  }
  const showSectionTitles = sections.length > 1;

  const baseName = (id: string) =>
    nodesById.get(id)?.name ?? id.split("/").pop() ?? id;

  return (
    <div className="h-full w-full overflow-auto px-8 pt-16 pb-10 bg-root">
      {ungrouped.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2 mt-2">
            Layer level
          </div>
          <div className="flex flex-wrap gap-3 mb-7">
            {ungrouped.map((id) => {
              const n = nodesById.get(id);
              if (!n) return null;
              const sel = selectedNodeId === id;
              return (
                <div
                  key={id}
                  onClick={() => selectNode(id)}
                  className={`cursor-pointer rounded-lg bg-elevated border px-4 py-3 max-w-[440px] transition-colors ${
                    sel ? "border-gold" : "border-gold/40 hover:border-gold"
                  }`}
                >
                  <div className="text-sm font-heading text-text-primary">{n.name}</div>
                  <div className="text-[11px] text-text-secondary line-clamp-2 mt-1 leading-tight">
                    {n.summary}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {sections.map((sec) => (
        <div key={sec.title} className="mb-6">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
            {showSectionTitles ? sec.title : "Features"} · {sec.items.length}
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(235px, 1fr))" }}
          >
            {sec.items.map((c) => (
          <div
            key={c.name}
            onClick={() => drillIntoContainer(c.id ?? `container:${slug(c.name)}`, c.name)}
            className="cursor-pointer rounded-lg bg-elevated border border-border-subtle hover:border-gold/60 transition-colors px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-heading text-gold truncate" title={c.name}>
                {c.name}
              </span>
              <span className="text-[11px] text-text-muted ml-2 shrink-0">
                {c.nodeIds.length}
              </span>
            </div>
            <div className="mt-1.5">
              {c.nodeIds.slice(0, 3).map((id) => (
                <div
                  key={id}
                  className="text-[10px] text-text-secondary truncate leading-snug"
                  title={baseName(id)}
                >
                  · {baseName(id)}
                </div>
              ))}
              {c.nodeIds.length > 3 && (
                <div className="text-[10px] text-text-muted leading-snug">
                  +{c.nodeIds.length - 3} more
                </div>
              )}
            </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {portals.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2 mt-8">
            Connected layers
          </div>
          <div className="flex flex-wrap gap-2.5">
            {portals.map((p) => {
              const color = getLayerColor(layerIndexMap.get(p.layerId) ?? 0);
              return (
                <button
                  key={p.layerId}
                  onClick={() => drillIntoLayer(p.layerId)}
                  className="rounded-full bg-elevated/70 px-4 py-2 text-xs text-text-primary hover:bg-elevated transition-colors"
                  style={{ border: `1.5px dashed ${color.border}` }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: color.label }}
                  />
                  {p.layerName}
                  <span className="text-text-muted ml-1.5">{p.connectionCount}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
