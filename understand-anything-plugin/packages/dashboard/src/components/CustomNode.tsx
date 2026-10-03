import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { NodeType } from "@understand-anything/core/types";
import { useI18n } from "../contexts/I18nContext";
import { useAnnotationsStore } from "../annotationsStore";
import { useAnalysisStore, type NodeMark } from "../analysisStore";

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
  page: "var(--color-node-concept)",
  screen: "var(--color-node-service)",
  component: "var(--color-node-class)",
  componentSet: "var(--color-node-module)",
  instance: "var(--color-node-function)",
  token: "var(--color-node-config)",
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
  page: "text-node-concept",
  screen: "text-node-service",
  component: "text-node-class",
  componentSet: "text-node-module",
  instance: "text-node-function",
  token: "text-node-config",
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

/** Classes for an analysis-overlay mark (hotspots, impact, rule violations, review). */
function markClass(mark: NodeMark): string {
  switch (mark.tone) {
    case "heat":
      return ` overlay-heat overlay-heat-${mark.level}`;
    case "impact-root":
      return " ring-2 ring-[var(--color-impact)] overlay-impact [--impact-mix:22%]";
    case "impact":
      return mark.level <= 1
        ? " ring-2 ring-[var(--color-impact)]/80 overlay-impact [--impact-mix:16%]"
        : mark.level === 2
          ? " ring-1 ring-[var(--color-impact)]/70 overlay-impact"
          : " ring-1 ring-[var(--color-impact)]/40 overlay-impact [--impact-mix:5%]";
    case "violation":
      return " ring-2 ring-[var(--color-violation)] overlay-violation";
    case "review-current":
      return " ring-2 ring-accent animate-accent-pulse";
    case "review-done":
      return " ring-1 ring-node-function/70";
  }
}

function CustomNodeComponent({
  id,
  data,
}: NodeProps<CustomFlowNode>) {
  const knownType = data.nodeType as NodeType;
  const barColor = typeColors[knownType] ?? typeColors.file;
  const textColor = typeTextColors[knownType] ?? typeTextColors.file;
  const complexityColor = complexityColors[data.complexity] ?? complexityColors.simple;
  const { t } = useI18n();
  const isAnnotated = useAnnotationsStore((s) => id in s.annotations);
  const mark = useAnalysisStore((s) => s.nodeMarks.get(id));
  const overlayDim = useAnalysisStore(
    (s) => s.overlay !== null && !s.nodeMarks.has(id) && (s.fadeUnmarked ? "dim" : s.overlay === "hotspots" ? "cold" : null),
  );

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
  } else if (data.isDiffFaded && !mark) {
    extraClass += " diff-faded";
  }

  // Analysis overlay: marked nodes stay visible even when selection would fade them.
  if (mark) extraClass += markClass(mark);
  else if (overlayDim === "dim") extraClass += " overlay-dim";
  else if (overlayDim === "cold") extraClass += " overlay-cold";

  // Selection-based dimming (when another node is selected, fade unrelated nodes)
  if (data.isSelectionFaded && !mark && !overlayDim) {
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
          <div className="flex items-center gap-1.5">
            {mark?.badge && (
              <span
                className={`text-[9px] font-mono font-semibold px-1 rounded leading-tight ${
                  mark.tone === "heat"
                    ? "text-[var(--heat)] bg-[color-mix(in_srgb,var(--heat)_18%,transparent)]"
                    : mark.tone === "impact"
                      ? "text-[var(--color-impact)] bg-[color-mix(in_srgb,var(--color-impact)_15%,transparent)]"
                      : mark.tone === "review-done"
                        ? "text-node-function bg-node-function/15"
                        : "text-accent bg-accent/15"
                }`}
                title={mark.tone === "heat" ? t.analysis.commitsTitle : mark.tone === "impact" ? t.analysis.depthTitle : undefined}
              >
                {mark.tone === "impact" ? `↑${mark.badge}` : mark.badge}
              </span>
            )}
            <span className={`text-[9px] font-mono ${complexityColor}`}>
              {data.complexity}
            </span>
            {data.tags?.includes("tested") && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-node-function shadow-[0_0_4px_rgba(90,158,111,0.6)]"
                role="img"
                aria-label={t.customNode.tested}
                title={t.customNode.hasTests}
              />
            )}
            {isAnnotated && (
              <svg
                className="w-2.5 h-2.5 text-accent"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                role="img"
                aria-label={t.annotations.annotated}
              >
                <title>{t.annotations.annotated}</title>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.2 5.2l3.6 3.6M4 20l4.2-1 10.6-10.6a2.5 2.5 0 00-3.6-3.6L4.6 15.4 4 20z" />
              </svg>
            )}
          </div>
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
