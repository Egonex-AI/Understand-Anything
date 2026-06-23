import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  summary: string;
  entryPoint?: string;
  entryType?: string;
  stepCount: number;
  flowId: string;
}

export type FlowFlowNode = Node<FlowNodeData, "flow-node">;

function FlowNode({ data }: NodeProps<FlowFlowNode>) {
  const selectNode = useDashboardStore((s) => s.selectNode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const isSelected = selectedNodeId === data.flowId;

  return (
    <div
      className={`rounded-lg border px-4 py-3 min-w-[240px] max-w-[320px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-medium bg-surface hover:border-accent/50"
      }`}
      onClick={() => selectNode(data.flowId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      {data.entryPoint && (
        <div className="text-[9px] font-mono text-accent/70 mb-1 truncate">
          {data.entryPoint}
        </div>
      )}
      <div className="text-xs font-semibold text-text-primary mb-1 truncate">
        {data.label}
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      <div className="text-[9px] text-text-muted mt-1">
        {data.stepCount} step{data.stepCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default memo(FlowNode);
