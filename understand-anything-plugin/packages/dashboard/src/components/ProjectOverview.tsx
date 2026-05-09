import { useDashboardStore } from "../store";

export default function ProjectOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const startTour = useDashboardStore((s) => s.startTour);

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading project...</p>
      </div>
    );
  }

  const { project, nodes, edges, layers } = graph;
  const hasTour = graph.tour.length > 0;

  // Count node types
  const typeCounts: Record<string, number> = {};
  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
  }

  // Count complexity
  const complexityCounts: Record<string, number> = { simple: 0, moderate: 0, complex: 0 };
  for (const node of nodes) {
    if (node.complexity) {
      complexityCounts[node.complexity] = (complexityCounts[node.complexity] ?? 0) + 1;
    }
  }

  // Find top connected nodes
  const nodeConnections = new Map<string, number>();
  for (const edge of edges) {
    nodeConnections.set(edge.source, (nodeConnections.get(edge.source) ?? 0) + 1);
    nodeConnections.set(edge.target, (nodeConnections.get(edge.target) ?? 0) + 1);
  }
  const topNodes = Array.from(nodeConnections.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nodeId, count]) => {
      const node = nodes.find((n) => n.id === nodeId);
      return { id: nodeId, name: node?.name ?? nodeId, count };
    });

  const avgConnections = nodes.length > 0 ? (edges.length * 2 / nodes.length).toFixed(1) : "0";

  // Category breakdowns
  const categoryBreakdown = [
    { label: "Code", color: "var(--color-node-file)", count: (typeCounts["file"] ?? 0) + (typeCounts["function"] ?? 0) + (typeCounts["class"] ?? 0) + (typeCounts["module"] ?? 0) + (typeCounts["concept"] ?? 0) },
    { label: "Config", color: "var(--color-node-config)", count: typeCounts["config"] ?? 0 },
    { label: "Docs", color: "var(--color-node-document)", count: typeCounts["document"] ?? 0 },
    { label: "Infra", color: "var(--color-node-service)", count: (typeCounts["service"] ?? 0) + (typeCounts["resource"] ?? 0) + (typeCounts["pipeline"] ?? 0) },
    { label: "Data", color: "var(--color-node-table)", count: (typeCounts["table"] ?? 0) + (typeCounts["endpoint"] ?? 0) + (typeCounts["schema"] ?? 0) },
    { label: "Domain", color: "var(--color-node-concept)", count: (typeCounts["domain"] ?? 0) + (typeCounts["flow"] ?? 0) + (typeCounts["step"] ?? 0) },
  ];
  const hasNonCodeNodes = categoryBreakdown.some((c) => c.label !== "Code" && c.count > 0);

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Project name */}
      <h2 className="font-heading text-2xl text-text-primary mb-1">{project.name}</h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-6">{project.description}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{nodes.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Nodes</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{edges.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Edges</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{layers.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Layers</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{Object.keys(typeCounts).length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Types</div>
        </div>
      </div>

      {/* File Types breakdown */}
      {hasNonCodeNodes && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">File Types</h3>
          <div className="space-y-1.5">
            {categoryBreakdown.filter((c) => c.count > 0).map((cat) => (
              <div key={cat.label} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-xs text-text-secondary flex-1">{cat.label}</span>
                <span className="text-xs font-mono text-text-muted">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Languages */}
      {project.languages.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">Languages</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.languages.map((lang) => (
              <span key={lang} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Frameworks */}
      {project.frameworks.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">Frameworks</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.frameworks.map((fw) => (
              <span key={fw} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {fw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Node Type Breakdown */}
      <div className="mb-5">
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">Node Type Distribution</h3>
        <div className="space-y-2">
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const percentage = ((count / nodes.length) * 100).toFixed(0);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-text-secondary capitalize">{type}</span>
                    <span className="text-text-muted font-mono">{count} ({percentage}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/50 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Complexity Breakdown */}
      {Object.values(complexityCounts).some((c) => c > 0) && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">Complexity Distribution</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-green-400">{complexityCounts.simple}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">Simple</div>
            </div>
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-yellow-400">{complexityCounts.moderate}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">Moderate</div>
            </div>
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-red-400">{complexityCounts.complex}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">Complex</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Connected Nodes */}
      {topNodes.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">Most Connected Nodes</h3>
          <div className="space-y-2">
            {topNodes.map((node, idx) => (
              <div
                key={node.id}
                className="flex items-center gap-2 text-xs bg-elevated rounded-lg p-2 border border-border-subtle"
              >
                <div className="w-5 h-5 shrink-0 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                  {idx + 1}
                </div>
                <span className="flex-1 text-text-primary truncate">{node.name}</span>
                <span className="text-text-muted font-mono shrink-0">{node.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Average Connections */}
      <div className="mb-5 bg-elevated rounded-lg p-3 border border-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">Avg Connections per Node</span>
          <span className="text-lg font-mono font-medium text-accent">{avgConnections}</span>
        </div>
      </div>

      {/* Analyzed at */}
      <div className="text-[11px] text-text-muted mb-6">
        Analyzed: {new Date(project.analyzedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>

      {/* Start Tour button */}
      {hasTour && (
        <button
          onClick={startTour}
          className="w-full bg-accent/10 border border-accent/30 text-accent text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-accent/20 transition-all duration-200"
        >
          Start Guided Tour
        </button>
      )}
    </div>
  );
}
