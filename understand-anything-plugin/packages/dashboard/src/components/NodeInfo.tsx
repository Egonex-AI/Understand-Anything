import { useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { NodeType, EdgeType, KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

// Badge color classes keyed by NodeType — must be kept in sync with core NodeType union.
const typeBadgeColors: Record<NodeType, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  config: "text-node-config border border-node-config/30 bg-node-config/10",
  document: "text-node-document border border-node-document/30 bg-node-document/10",
  service: "text-node-service border border-node-service/30 bg-node-service/10",
  table: "text-node-table border border-node-table/30 bg-node-table/10",
  endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
  resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
  domain: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  flow: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  step: "text-node-function border border-node-function/30 bg-node-function/10",
  article: "text-node-article border border-node-article/30 bg-node-article/10",
  entity: "text-node-entity border border-node-entity/30 bg-node-entity/10",
  topic: "text-node-topic border border-node-topic/30 bg-node-topic/10",
  claim: "text-node-claim border border-node-claim/30 bg-node-claim/10",
  source: "text-node-source border border-node-source/30 bg-node-source/10",
};

const complexityBadgeColors: Record<string, string> = {
  simple: "text-node-function border border-node-function/30 bg-node-function/10",
  moderate: "text-accent-dim border border-accent-dim/30 bg-accent-dim/10",
  complex: "text-[#c97070] border border-[#c97070]/30 bg-[#c97070]/10",
};

function getDirectionalLabel(edgeType: string, isSource: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  const labels = t.edgeLabels[edgeType as EdgeType];
  if (!labels) {
    const formatted = edgeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return isSource ? formatted : `${formatted} (reverse)`;
  }
  return isSource ? labels.forward : labels.backward;
}

function KnowledgeNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const { t } = useI18n();
  const meta = node.knowledgeMeta;

  // Wikilinks (outgoing related edges)
  const wikilinks = graph.edges
    .filter((e) => e.type === "related" && e.source === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  // Backlinks (incoming related edges)
  const backlinks = graph.edges
    .filter((e) => e.type === "related" && e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => n !== undefined);

  // Category
  const categoryEdge = graph.edges.find(
    (e) => e.type === "categorized_under" && e.source === node.id
  );
  const categoryNode = categoryEdge
    ? graph.nodes.find((n) => n.id === categoryEdge.target)
    : null;

  return (
    <div className="space-y-3">
      {categoryNode && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.category}</h4>
          <button
            type="button"
            onClick={() => navigateToNode(categoryNode.id)}
            className="text-[11px] px-2 py-0.5 rounded bg-elevated text-accent hover:text-accent-bright transition-colors"
          >
            {categoryNode.name}
          </button>
        </div>
      )}
      {meta?.wikilinks && meta.wikilinks.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t.nodeInfo.wikilinks} ({wikilinks.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {wikilinks.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => navigateToNode(n.id)}
                className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate"
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {backlinks.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t.nodeInfo.backlinks} ({backlinks.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {backlinks.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => navigateToNode(n.id)}
                className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate"
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {meta?.content && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.common.preview}</h4>
          <div className="text-[11px] text-text-secondary leading-relaxed bg-elevated rounded-lg p-3 max-h-[300px] overflow-auto whitespace-pre-wrap font-mono">
            {meta.content.slice(0, 1500)}
            {meta.content.length > 1500 && (
              <span className="text-text-muted">... {t.common.truncated}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DomainNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const { t } = useI18n();
  const meta = node.domainMeta;

  if (node.type === "domain") {
    const flows = graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    return (
      <div className="space-y-3">
        {Array.isArray(meta?.entities) && meta.entities.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.entities}</h4>
            <div className="flex flex-wrap gap-1">
              {meta.entities.map((e) => (
                <span key={e} className="text-[11px] px-2 py-0.5 rounded bg-elevated text-text-secondary">{e}</span>
              ))}
            </div>
          </div>
        ) : null}
        {Array.isArray(meta?.businessRules) && meta.businessRules.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.businessRules}</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {meta.businessRules.map((r, i) => (
                <li key={i} className="flex gap-1.5"><span className="text-accent shrink-0">-</span>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {Array.isArray(meta?.crossDomainInteractions) && meta.crossDomainInteractions.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.crossDomain}</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {meta.crossDomainInteractions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {flows.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.flows}</h4>
            <div className="space-y-1">
              {flows.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { navigateToDomain(node.id); selectNode(f.id); }}
                  className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors"
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "flow") {
    const steps = graph.edges
      .filter((e) => e.type === "flow_step" && e.source === node.id)
      .sort((a, b) => a.weight - b.weight)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    return (
      <div className="space-y-3">
        {meta?.entryPoint ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.entryPoint}</h4>
            <div className="text-[11px] font-mono text-accent">{meta.entryPoint}</div>
          </div>
        ) : null}
        {steps.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.steps}</h4>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectNode(s.id)}
                    className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] transition-colors"
                  >
                    <span className="text-accent/60 mr-1.5">{i + 1}.</span>
                    <span className="text-text-secondary hover:text-accent">{s.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "step") {
    if (!node.filePath) return null;
    return (
      <div className="space-y-3">
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.implementation}</h4>
          <div className="text-[11px] font-mono text-text-secondary">
            {node.filePath}
            {node.lineRange && <span className="text-text-muted">:{node.lineRange[0]}-{node.lineRange[1]}</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function NodeInfo() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const nodeHistory = useDashboardStore((s) => s.nodeHistory);
  const goBackNode = useDashboardStore((s) => s.goBackNode);
  const [languageExpanded, setLanguageExpanded] = useState(true);
  const { t } = useI18n();

  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const navigateToHistoryIndex = useDashboardStore((s) => s.navigateToHistoryIndex);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);

  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  const node = activeGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Resolve history node names for the breadcrumb trail
  const historyNodes = nodeHistory.map((id) => {
    const n = activeGraph?.nodes.find((gn) => gn.id === id);
    return { id, name: n?.name ?? id };
  });

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">{t.common.selectNode}</p>
      </div>
    );
  }

  const allEdges = activeGraph?.edges ?? [];
  const connections = allEdges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );

  // Separate child nodes (contained IN this file) from other connections
  const childEdges = connections.filter(
    (e) => e.type === "contains" && e.source === node.id,
  );
  const otherConnections = connections.filter(
    (e) => !(e.type === "contains" && e.source === node.id),
  );

  // Resolve child nodes
  const childNodes = childEdges
    .map((e) => activeGraph?.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  const knownType = node.type as NodeType;
  const typeBadge = typeBadgeColors[knownType] ?? typeBadgeColors.file;
  const complexityBadge =
    complexityBadgeColors[node.complexity] ?? complexityBadgeColors.simple;

  if (import.meta.env.DEV && !(knownType in typeBadgeColors)) {
    console.warn(`[NodeInfo] Unknown node type "${node.type}" — using "file" badge colors`);
  }

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Navigation history trail */}
      {historyNodes.length > 0 && (
        <div className="mb-3 flex items-center gap-1 flex-wrap">
          <button
            onClick={goBackNode}
            className="text-[10px] font-semibold text-gold hover:text-gold-bright transition-colors flex items-center gap-1"
          >
            <span>←</span>
            <span>{t.common.back}</span>
          </button>
          <span className="text-text-muted text-[10px]">│</span>
          {historyNodes.slice(-3).map((h, i, arr) => (
            <span key={`${h.id}-${i}`} className="flex items-center gap-1">
              <button
                onClick={() => {
                  const fullIdx = historyNodes.length - arr.length + i;
                  navigateToHistoryIndex(fullIdx);
                }}
                className="text-[10px] text-text-muted hover:text-gold transition-colors truncate max-w-[80px]"
                title={h.name}
              >
                {h.name}
              </button>
              {i < arr.length - 1 && (
                <span className="text-text-muted text-[10px]">›</span>
              )}
            </span>
          ))}
          <span className="text-text-muted text-[10px]">›</span>
          <span className="text-[10px] text-text-primary font-medium truncate max-w-[80px]">
            {node.name}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${typeBadge}`}
        >
          {node.type}
        </span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded ${complexityBadge}`}
        >
          {node.complexity}
        </span>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-heading text-text-primary">{node.name}</h2>
        <button
          onClick={() => setFocusNode(focusNodeId === node.id ? null : node.id)}
          className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
            focusNodeId === node.id
              ? "bg-gold/20 text-gold border border-gold/40"
              : "text-text-muted border border-border-subtle hover:text-gold hover:border-gold/30"
          }`}
        >
          {focusNodeId === node.id ? t.common.unfocus : t.common.focus}
        </button>
      </div>

      <p className="text-sm text-text-secondary mb-4 leading-relaxed">
        {node.summary}
      </p>

      {node.filePath && (
        <div className="text-xs text-text-secondary mb-4 rounded-lg border border-border-subtle bg-elevated/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-text-muted mb-1">{t.common.file}</div>
              <div className="font-mono truncate" title={node.filePath}>
                {node.filePath}
                {node.lineRange && (
                  <span className="ml-2 text-text-muted">
                    L{node.lineRange[0]}-{node.lineRange[1]}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openCodeViewer(node.id)}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
            >
              {t.common.openCode}
            </button>
          </div>
        </div>
      )}

      {node.languageNotes && (
        <div className="mb-4">
          <button
            onClick={() => setLanguageExpanded(!languageExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider mb-2 hover:text-accent-bright transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${languageExpanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {t.nodeInfo.languageConcepts}
          </button>
          {languageExpanded && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
              <p className="text-sm text-text-secondary leading-relaxed">
                {node.languageNotes}
              </p>
            </div>
          )}
        </div>
      )}

      {node.tags.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            {t.common.tags}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge-specific details */}
      {activeGraph && node && (node.type === "article" || node.type === "entity" || node.type === "topic" || node.type === "claim" || node.type === "source") && (
        <KnowledgeNodeDetails node={node} graph={activeGraph} />
      )}

      {/* Domain-specific details */}
      {activeGraph && node && (node.type === "domain" || node.type === "flow" || node.type === "step") && (
        <DomainNodeDetails node={node} graph={activeGraph} />
      )}

      {/* Child classes/functions within this file */}
      {childNodes.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
            {t.nodeInfo.definedInThisFile} ({childNodes.length})
          </h3>
          <div className="space-y-1">
            {childNodes.map((child) => {
              if (!child) return null;
              const childTypeBadge = typeBadgeColors[child.type as NodeType] ?? typeBadgeColors.file;
              const childComplexity = complexityBadgeColors[child.complexity] ?? complexityBadgeColors.simple;
              return (
                <div
                  key={child.id}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                  onClick={() => navigateToNode(child.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${childTypeBadge}`}>
                      {child.type}
                    </span>
                    <span className="text-text-primary truncate">{child.name}</span>
                    <span className={`text-[9px] ml-auto ${childComplexity} px-1 py-0.5 rounded`}>
                      {child.complexity}
                    </span>
                  </div>
                  {child.summary && (
                    <p className="text-[11px] text-text-muted mt-1 line-clamp-1 pl-1">
                      {child.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other connections (excluding "contains" children) */}
      {otherConnections.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
            {t.common.connections} ({otherConnections.length})
          </h3>
          <div className="space-y-1.5">
            {otherConnections.map((edge, i) => {
              const isSource = edge.source === node.id;
              const otherId = isSource ? edge.target : edge.source;
              const otherNode = activeGraph?.nodes.find((n) => n.id === otherId);
              const dirLabel = getDirectionalLabel(edge.type, isSource, t);
              const arrow = isSource ? "\u2192" : "\u2190";

              return (
                <div
                  key={i}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle flex items-center gap-2 cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                  onClick={() => {
                    navigateToNode(otherId);
                  }}
                >
                  <span className="text-gold font-mono">{arrow}</span>
                  <span className="text-text-muted">{dirLabel}</span>
                  <span className="text-text-primary truncate">
                    {otherNode?.name ?? otherId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
