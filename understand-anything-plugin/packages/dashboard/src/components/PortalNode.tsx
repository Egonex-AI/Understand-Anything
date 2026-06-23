import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { getLayerColor } from "./LayerLegend";

export interface PortalNodeData extends Record<string, unknown> {
  targetLayerId: string;
  targetLayerName: string;
  connectionCount: number;
  layerColorIndex: number;
  onNavigate: (layerId: string) => void;
}

export type PortalFlowNode = Node<PortalNodeData, "portal">;

function PortalNode({
  data,
}: NodeProps<PortalFlowNode>) {
  const color = getLayerColor(data.layerColorIndex);

  return (
    <div
      className="relative rounded-lg bg-elevated/60 overflow-hidden cursor-pointer transition-all duration-200 hover:bg-elevated/80"
      style={{
        width: 220,
        border: `2px dashed ${color.border}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
      onClick={() => data.onNavigate(data.targetLayerId)}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-text-muted !w-2 !h-2"
      />

      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color.label }}
            />
            <span className="text-sm text-text-primary truncate">
              {data.targetLayerName}
            </span>
          </div>
          <span className="text-text-muted ml-2 shrink-0">→</span>
        </div>
        <div className="text-[10px] text-text-muted mt-1 pl-4">
          {data.connectionCount} connection{data.connectionCount !== 1 ? "s" : ""}
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

export default memo(PortalNode);
