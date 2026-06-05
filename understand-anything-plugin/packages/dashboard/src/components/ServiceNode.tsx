import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

interface ServiceNodeData extends Record<string, unknown> {
  label: string;
  summary: string;
  languages: string[];
  frameworks: string[];
  stats: { nodes: number; edges: number; files: number };
  hasKg: boolean;
  hasWiki: boolean;
  hasDomain: boolean;
  isSelected: boolean;
  onNodeClick: (id: string) => void;
}

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

const LANG_COLORS: Record<string, string> = {
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Go: "#00ADD8",
  Python: "#3572A5",
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
};

function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const primaryLang = data.languages?.[0] ?? "";
  const langColor = LANG_COLORS[primaryLang] ?? "#6b7280";

  return (
    <div
      className={`
        relative w-[200px] rounded-xl border bg-elevated shadow-md transition-all duration-200
        ${data.isSelected
          ? "border-gold shadow-lg shadow-gold/20"
          : "border-border-subtle hover:border-gold/50 hover:shadow-lg"
        }
      `}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl"
        style={{ backgroundColor: langColor }}
      />
      <div className="p-3 pl-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm text-text-primary truncate">
            {data.label}
          </h3>
          <div className="flex gap-0.5 ml-1">
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasKg ? "bg-green-400" : "bg-gray-600"}`} title="KG" />
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasWiki ? "bg-green-400" : "bg-gray-600"}`} title="Wiki" />
            <span className={`w-1.5 h-1.5 rounded-full ${data.hasDomain ? "bg-green-400" : "bg-gray-600"}`} title="Domain" />
          </div>
        </div>
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {data.languages?.map((lang) => (
            <span
              key={lang}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${LANG_COLORS[lang] ?? "#6b7280"}20`,
                color: LANG_COLORS[lang] ?? "#6b7280",
              }}
            >
              {lang}
            </span>
          ))}
        </div>
        <div className="flex gap-3 text-[10px] text-text-muted font-mono">
          <span>{data.stats?.nodes ?? 0} nodes</span>
          <span>{data.stats?.files ?? 0} files</span>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-accent !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent !w-2 !h-2" />
    </div>
  );
}

export default memo(ServiceNode);
