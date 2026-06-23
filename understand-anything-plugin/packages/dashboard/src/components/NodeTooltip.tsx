import { useEffect, useState } from "react";
import type { CustomNodeData } from "./CustomNode";

interface NodeTooltipProps {
  data: CustomNodeData;
  nodeId: string;
  incomingCount: number;
  outgoingCount: number;
  tags?: string[];
}

export default function NodeTooltip({
  data,
  nodeId,
  incomingCount,
  outgoingCount,
  tags = [],
}: NodeTooltipProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: Event) => {
      const me = e as globalThis.MouseEvent;
      setPosition({ x: me.clientX, y: me.clientY });
    };

    const showTooltip = () => setVisible(true);
    const hideTooltip = () => setVisible(false);

    // Find the node element via data-id (React Flow convention)
    const nodeElement = document.querySelector(`[data-id="${CSS.escape(nodeId)}"]`);
    if (nodeElement) {
      nodeElement.addEventListener("mouseenter", showTooltip);
      nodeElement.addEventListener("mouseleave", hideTooltip);
      nodeElement.addEventListener("mousemove", handleMouseMove);

      return () => {
        nodeElement.removeEventListener("mouseenter", showTooltip);
        nodeElement.removeEventListener("mouseleave", hideTooltip);
        nodeElement.removeEventListener("mousemove", handleMouseMove);
      };
    }
  }, [nodeId]);

  if (!visible) return null;

  const totalConnections = incomingCount + outgoingCount;

  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: position.x + 16,
        top: position.y + 16,
      }}
    >
      <div className="glass-heavy rounded-lg shadow-2xl p-3 max-w-xs animate-fade-slide-in">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border-subtle">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gold">
            {data.nodeType}
          </span>
          {data.complexity && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-elevated text-text-muted font-mono">
              {data.complexity}
            </span>
          )}
        </div>

        {/* Name */}
        <h4 className="text-sm font-heading text-text-primary mb-2 break-words">
          {data.label}
        </h4>

        {/* Connections */}
        <div className="flex items-center gap-4 mb-2 text-xs">
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
            </svg>
            <span className="text-text-secondary">{incomingCount} in</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" transform="rotate(180 10 10)" />
            </svg>
            <span className="text-text-secondary">{outgoingCount} out</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-gold font-medium">{totalConnections}</span>
          </div>
        </div>

        {/* Summary */}
        {data.summary && (
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            {data.summary.length > 120 ? data.summary.slice(0, 120) + "..." : data.summary}
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2 border-t border-border-subtle">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/30"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[9px] text-text-muted">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
