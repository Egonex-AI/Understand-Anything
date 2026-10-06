import { useEffect, useMemo, useRef, useState } from "react";
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

  // Undirected adjacency, memoized per graph. Matches the bidirectional
  // traversal used by findPath so reachability and path-finding agree.
  const adjacency = useMemo(() => {
    const adj = new Map<string, string[]>();
    if (!graph) return adj;
    for (const edge of graph.edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source)!.push(edge.target);
      if (!adj.has(edge.target)) adj.set(edge.target, []);
      adj.get(edge.target)!.push(edge.source);
    }
    return adj;
  }, [graph]);

  // Set of node ids reachable from the selected "From" node (excluding itself).
  // null when no source is selected — caller treats null as "no filtering yet".
  const reachableFromSource = useMemo(() => {
    if (!fromNodeId) return null;
    const reachable = new Set<string>();
    const queue: string[] = [fromNodeId];
    reachable.add(fromNodeId);
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const neighbors = adjacency.get(nodeId) ?? [];
      for (const n of neighbors) {
        if (!reachable.has(n)) {
          reachable.add(n);
          queue.push(n);
        }
      }
    }
    reachable.delete(fromNodeId);
    return reachable;
  }, [fromNodeId, adjacency]);

  // If "From" changes and the previously chosen "To" is no longer reachable,
  // clear "To" so the select doesn't display a stale, invalid value.
  useEffect(() => {
    if (toNodeId && reachableFromSource && !reachableFromSource.has(toNodeId)) {
      setToNodeId("");
      setPath(null);
    }
  }, [reachableFromSource, toNodeId]);

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

  // Nodes shown in the "To" dropdown. Before a source is picked, show all
  // nodes; once a source is picked, only show nodes reachable from it so
  // the user can't select a destination with no path.
  const toCandidates = reachableFromSource
    ? nodes.filter((n) => reachableFromSource.has(n.id))
    : nodes;

  // BFS to find shortest path
  const findPath = () => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      setPath(null);
      return;
    }

    setSearching(true);

    // BFS using the memoized undirected adjacency
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
            <div className="flex items-baseline justify-between mb-2">
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                To Node
              </label>
              {fromNodeId && (
                <span className="text-[10px] text-text-muted">
                  {toCandidates.length} reachable
                </span>
              )}
            </div>
            <select
              value={toNodeId}
              onChange={(e) => {
                setToNodeId(e.target.value);
                setPath(null);
              }}
              disabled={!fromNodeId || toCandidates.length === 0}
              className="w-full bg-elevated text-text-primary text-sm rounded-lg px-3 py-2 border border-border-subtle focus:outline-none focus:border-gold/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {!fromNodeId
                  ? "Pick a From node first..."
                  : toCandidates.length === 0
                    ? "No reachable nodes from source"
                    : "Select a node..."}
              </option>
              {toCandidates.map((node) => (
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
