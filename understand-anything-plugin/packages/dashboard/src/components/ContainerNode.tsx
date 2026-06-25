import { memo } from "react";
import type { NodeProps, Node } from "@xyflow/react";
import { getLayerColor } from "./LayerLegend";
import { useDashboardStore } from "../store";

export interface ContainerNodeData extends Record<string, unknown> {
  containerId: string;
  name: string;
  childCount: number;
  strategy: "folder" | "community";
  colorIndex: number;
  isExpanded: boolean;
  hasSearchHits: boolean;
  searchHitCount?: number;
  isDiffAffected: boolean;
  isFocusedViaChild: boolean;
  onToggle: (containerId: string) => void;
}

export type ContainerFlowNode = Node<ContainerNodeData, "container">;

function ContainerNodeComponent({ data, width, height }: NodeProps<ContainerFlowNode>) {
  const color = getLayerColor(data.colorIndex);

  const borderColor = data.isDiffAffected
    ? "var(--color-diff-changed)"
    : data.isExpanded || data.isFocusedViaChild
      ? "rgba(212,165,116,0.6)"
      : "rgba(212,165,116,0.25)";
  const borderWidth = data.isExpanded || data.isFocusedViaChild ? 1.5 : 1;

  const labelDimmed = data.name === "~";
  const labelText = labelDimmed ? "(root)" : data.name;

  // Flat drill-by-level: clicking a cluster box drills INTO it (re-roots the
  // canvas to its subtree and grows the breadcrumb). Read the action via
  // getState() so this presentational node doesn't subscribe (keeps memo()).
  const handleDrill = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    useDashboardStore.getState().focusContainer(data.containerId);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${labelText} cluster, ${data.childCount} item${data.childCount !== 1 ? "s" : ""}, click to drill in`}
      className="rounded-xl cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[rgba(212,165,116,0.6)] hover:border-gold/60"
      style={{
        width,
        height,
        background: "rgba(255,255,255,0.02)",
        border: `${borderWidth}px solid ${borderColor}`,
        position: "relative",
      }}
      onClick={handleDrill}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleDrill(e);
        }
      }}
    >
      <div
        className="flex items-center justify-between font-heading"
        style={{
          padding: "12px 16px",
          color: color.label,
          fontSize: 14,
          fontWeight: 400,
        }}
      >
        <span
          className={labelDimmed ? "opacity-50" : ""}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          {labelText}
          {data.searchHitCount != null && data.searchHitCount > 0 && (
            <span
              className="font-mono"
              style={{
                marginLeft: 6,
                fontSize: 10,
                background: "rgba(212,165,116,0.2)",
                color: "var(--color-gold, #d4a574)",
                padding: "1px 6px",
                borderRadius: 8,
              }}
            >
              {data.searchHitCount} hit{data.searchHitCount !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#a39787", fontSize: 11 }}>
          <span>{data.childCount}</span>
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1, color: color.label }}>›</span>
        </span>
      </div>
    </div>
  );
}

const ContainerNode = memo(ContainerNodeComponent);
ContainerNode.displayName = "ContainerNode";

export default ContainerNode;
