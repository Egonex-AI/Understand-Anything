import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store";

interface PathFinderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PathFinderModal({ isOpen, onClose }: PathFinderModalProps) {
  const graph = useDashboardStore((s) => s.graph);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const [fromNodeId, setFromNodeId] = useState("");
  const [toNodeId, setToNodeId] = useState("");
  const [path, setPath] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !graph) return null;

  const nodes = graph.nodes;
  const edges = graph.edges;

  // BFS to find shortest path
  const findPath = () => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      setPath(null);
      return;
    }

    setSearching(true);

    // Build adjacency list (bidirectional traversal for path finding)
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, []);
      }
      adjacency.get(edge.source)!.push(edge.target);
      // Also traverse in reverse so we can find paths through backward edges
      if (!adjacency.has(edge.target)) {
        adjacency.set(edge.target, []);
      }
      adjacency.get(edge.target)!.push(edge.source);
    }

    // BFS
    const queue: Array<{ nodeId: string; path: string[] }> = [
      { nodeId: fromNodeId, path: [fromNodeId] },
    ];
    const visited = new Set<string>([fromNodeId]);

    while (queue.length > 0) {
      const { nodeId, path: currentPath } = queue.shift()!;

      if (nodeId === toNodeId) {
        setPath(currentPath);
        setSearching(false);
        return;
      }

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ nodeId: neighbor, path: [...currentPath, neighbor] });
        }
      }
    }

    // No path found
    setPath([]);
    setSearching(false);
  };

  const handleNodeClick = (nodeId: string) => {
    selectNode(nodeId);
    onClose();
  };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-root/80 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="glass-heavy rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden animate-fade-slide-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <h2 className="font-heading text-xl text-text-primary">Dependency Path Finder</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(80vh-180px)]">
          <p className="text-sm text-text-secondary">
            Find the shortest path between two nodes in the dependency graph.
          </p>

          {/* From Node */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              From Node
            </label>
            <select
              value={fromNodeId}
              onChange={(e) => {
                setFromNodeId(e.target.value);
                setPath(null);
              }}
              className="w-full bg-elevated text-text-primary text-sm rounded-lg px-3 py-2 border border-border-subtle focus:outline-none focus:border-gold/50"
            >
              <option value="">Select a node...</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.type})
                </option>
              ))}
            </select>
          </div>

          {/* To Node */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              To Node
            </label>
            <select
              value={toNodeId}
              onChange={(e) => {
                setToNodeId(e.target.value);
                setPath(null);
              }}
              className="w-full bg-elevated text-text-primary text-sm rounded-lg px-3 py-2 border border-border-subtle focus:outline-none focus:border-gold/50"
            >
              <option value="">Select a node...</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.type})
                </option>
              ))}
            </select>
          </div>

          {/* Find Path Button */}
          <button
            onClick={findPath}
            disabled={!fromNodeId || !toNodeId || fromNodeId === toNodeId || searching}
            className="w-full bg-gold/10 border border-gold/30 text-gold text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-gold/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? "Searching..." : "Find Path"}
          </button>

          {/* Path Result */}
          {path !== null && (
            <div className="mt-4">
              {path.length === 0 ? (
                <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-center">
                  <svg
                    className="w-8 h-8 text-red-400 mx-auto mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm text-red-200">No path found between these nodes.</p>
                </div>
              ) : (
                <div className="bg-elevated border border-border-subtle rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg
                      className="w-4 h-4 text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Path Found ({path.length} nodes)
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {path.map((nodeId, idx) => {
                      const node = nodeMap.get(nodeId);
                      if (!node) return null;

                      const isLast = idx === path.length - 1;

                      return (
                        <div key={nodeId}>
                          <button
                            onClick={() => handleNodeClick(nodeId)}
                            className="w-full flex items-center gap-3 p-2 bg-surface rounded-lg hover:bg-elevated transition-colors text-left"
                          >
                            <div className="w-6 h-6 shrink-0 rounded-full bg-gold/20 flex items-center justify-center text-xs font-bold text-gold">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-text-primary truncate">{node.name}</div>
                              <div className="text-xs text-text-muted capitalize">{node.type}</div>
                            </div>
                            <svg
                              className="w-4 h-4 text-text-muted"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </button>
                          {!isLast && (
                            <div className="flex items-center justify-center my-1">
                              <svg
                                className="w-4 h-4 text-gold"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
