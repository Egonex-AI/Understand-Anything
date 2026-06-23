import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface DomainClusterData extends Record<string, unknown> {
  label: string;
  summary: string;
  entities?: string[];
  flowCount: number;
  businessRules?: string[];
  domainId: string;
}

export type DomainClusterFlowNode = Node<DomainClusterData, "domain-cluster">;

function DomainClusterNode({ data }: NodeProps<DomainClusterFlowNode>) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const isSelected = selectedNodeId === data.domainId;

  return (
    <div
      className={`rounded-xl border-2 px-5 py-4 min-w-[280px] max-w-[360px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10 shadow-lg shadow-accent/10"
          : "border-accent/40 bg-surface hover:border-accent/70"
      }`}
      onClick={() => selectNode(data.domainId)}
      onDoubleClick={() => navigateToDomain(data.domainId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      <div className="font-heading text-sm text-accent font-semibold mb-1 truncate">
        {data.label}
      </div>
      <div className="text-[11px] text-text-secondary line-clamp-2 mb-2">
        {data.summary}
      </div>

      {data.entities && data.entities.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Entities</div>
          <div className="flex flex-wrap gap-1">
            {data.entities.slice(0, 5).map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-text-secondary">
                {e}
              </span>
            ))}
            {data.entities.length > 5 && (
              <span className="text-[10px] text-text-muted">+{data.entities.length - 5}</span>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-text-muted">
        {data.flowCount} flow{data.flowCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default memo(DomainClusterNode);
