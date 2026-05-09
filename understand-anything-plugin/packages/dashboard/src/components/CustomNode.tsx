import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { NodeType } from "@understand-anything/core/types";

// Color maps keyed by NodeType — must be kept in sync with core NodeType union.
const typeColors: Record<NodeType, string> = {
  file: "var(--color-node-file)",
  function: "var(--color-node-function)",
  class: "var(--color-node-class)",
  module: "var(--color-node-module)",
  concept: "var(--color-node-concept)",
  config: "var(--color-node-config)",
  document: "var(--color-node-document)",
  service: "var(--color-node-service)",
  table: "var(--color-node-table)",
  endpoint: "var(--color-node-endpoint)",
  pipeline: "var(--color-node-pipeline)",
  schema: "var(--color-node-schema)",
  resource: "var(--color-node-resource)",
  domain: "var(--color-node-concept)",
  flow: "var(--color-node-pipeline)",
  step: "var(--color-node-function)",
  article: "var(--color-node-article)",
  entity: "var(--color-node-entity)",
  topic: "var(--color-node-topic)",
  claim: "var(--color-node-claim)",
  source: "var(--color-node-source)",
};

const typeTextColors: Record<NodeType, string> = {
  file: "text-node-file",
  function: "text-node-function",
  class: "text-node-class",
  module: "text-node-module",
  concept: "text-node-concept",
  config: "text-node-config",
  document: "text-node-document",
  service: "text-node-service",
  table: "text-node-table",
  endpoint: "text-node-endpoint",
  pipeline: "text-node-pipeline",
  schema: "text-node-schema",
  resource: "text-node-resource",
  domain: "text-node-concept",
  flow: "text-node-pipeline",
  step: "text-node-function",
  article: "text-node-article",
  entity: "text-node-entity",
  topic: "text-node-topic",
  claim: "text-node-claim",
  source: "text-node-source",
};

const complexityColors: Record<string, string> = {
  simple: "text-node-function",
  moderate: "text-accent-dim",
  complex: "text-[#c97070]",
};

export interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  summary: string;
  complexity: string;
  isHighlighted: boolean;
  searchScore?: number;
  isSelected: boolean;
  isTourHighlighted: boolean;
  isDiffChanged: boolean;
  isDiffAffected: boolean;
  isDiffFaded: boolean;
  isNeighbor: boolean;
  isSelectionFaded: boolean;
  onNodeClick?: (nodeId: string) => void;
  incomingCount?: number;
  outgoingCount?: number;
  tags?: string[];
}

export type CustomFlowNode = Node<CustomNodeData, "custom">;

function CustomNodeComponent({
  id,
  data,
}: NodeProps<CustomFlowNode>) {
  const knownType = data.nodeType as NodeType;
  const barColor = typeColors[knownType] ?? typeColors.file;
  const textColor = typeTextColors[knownType] ?? typeTextColors.file;
  const complexityColor = complexityColors[data.complexity] ?? complexityColors.simple;

  if (import.meta.env.DEV && !(knownType in typeColors)) {
    console.warn(`[CustomNode] Unknown node type "${data.nodeType}" — using "file" colors`);
  }

  let extraClass = "";
  if (data.isSelected) {
    extraClass = "ring-2 ring-accent node-glow";
  } else if (data.isTourHighlighted) {
    extraClass = "ring-2 ring-accent-dim animate-accent-pulse";
  } else if (data.isHighlighted) {
    const score = data.searchScore ?? 1;
    if (score <= 0.1) {
      extraClass = "ring-2 ring-accent-bright";
    } else if (score <= 0.3) {
      extraClass = "ring-2 ring-accent";
    } else {
      extraClass = "ring-1 ring-accent-dim/60";
    }
  }

  // Diff overlay styling (composes with above)
  if (data.isDiffChanged) {
    extraClass += " ring-2 ring-[var(--color-diff-changed)] diff-changed-glow";
  } else if (data.isDiffAffected) {
    extraClass += " ring-1 ring-[var(--color-diff-affected)] diff-affected-glow";
  } else if (data.isDiffFaded) {
    extraClass += " diff-faded";
  }

  // Selection-based dimming (when another node is selected, fade unrelated nodes)
  if (data.isSelectionFaded) {
    extraClass += " opacity-20 pointer-events-auto";
  } else if (data.isNeighbor) {
    extraClass += " ring-1 ring-gold-dim/50";
  }

  const name = data.label ?? "unnamed";
  const truncatedName =
    name.length > 24 ? name.slice(0, 22) + "..." : name;

  return (
    <div
      className={`relative rounded-lg bg-elevated border border-border-subtle ${extraClass} min-w-[180px] max-w-[220px] overflow-hidden transition-[box-shadow,outline,opacity,filter] duration-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.3)]`}
      onClick={() => data.onNodeClick?.(id)}
    >
      {/* Left color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: barColor }}
      />

      <Handle
        type="target"
        position={Position.Top}
        className="!bg-text-muted !w-2 !h-2"
      />

      <div className="pl-4 pr-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${textColor}`}>
            {data.nodeType}
          </span>
          <span className={`text-[9px] font-mono ${complexityColor}`}>
            {data.complexity}
          </span>
        </div>

        <div className="text-sm font-heading text-text-primary truncate" title={data.label}>
          {truncatedName}
        </div>

        <div className="text-[11px] text-text-secondary mt-1 line-clamp-2 leading-tight">
          {data.summary}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-text-muted !w-2 !h-2"
      />
    </div>
  );
}

const CustomNode = memo(CustomNodeComponent);
export default CustomNode;
