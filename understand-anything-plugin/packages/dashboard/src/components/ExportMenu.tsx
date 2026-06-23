import { useEffect, useRef } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { filterNodes, filterEdges } from "../utils/filters";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportMenu() {
  const graph = useDashboardStore((s) => s.graph);
  const nodeIdToLayerIds = useDashboardStore((s) => s.nodeIdToLayerIds);
  const filters = useDashboardStore((s) => s.filters);
  const exportMenuOpen = useDashboardStore((s) => s.exportMenuOpen);
  const toggleExportMenu = useDashboardStore((s) => s.toggleExportMenu);
  const reactFlowInstance = useDashboardStore((s) => s.reactFlowInstance);
  const persona = useDashboardStore((s) => s.persona);
  const { t } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (exportMenuOpen) {
          toggleExportMenu();
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [exportMenuOpen, toggleExportMenu]);

  const buildCleanSvg = () => {
    if (!reactFlowInstance) return null;

    const nodes = reactFlowInstance.getNodes();
    const edges = reactFlowInstance.getEdges();
    if (nodes.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((node) => {
      const x = node.position.x;
      const y = node.position.y;
      const width = (node.width ?? 200);
      const height = (node.height ?? 80);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    });

    const padding = 40;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svgContent += `<rect width="100%" height="100%" fill="#0a0a0a"/>`;

    edges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      const sx = sourceNode.position.x + (sourceNode.width ?? 200) / 2 + offsetX;
      const sy = sourceNode.position.y + (sourceNode.height ?? 80) / 2 + offsetY;
      const tx = targetNode.position.x + (targetNode.width ?? 200) / 2 + offsetX;
      const ty = targetNode.position.y + (targetNode.height ?? 80) / 2 + offsetY;

      svgContent += `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="rgba(212,165,116,0.3)" stroke-width="1.5"/>`;
    });

    nodes.forEach((node) => {
      if (node.type === "group") return;

      const x = node.position.x + offsetX;
      const y = node.position.y + offsetY;
      const w = node.width ?? 200;
      const h = node.height ?? 80;

      svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#1a1a1a" stroke="rgba(212,165,116,0.2)" stroke-width="1"/>`;
      svgContent += `<text x="${x + w / 2}" y="${y + h / 2}" fill="#d4a574" text-anchor="middle" dominant-baseline="middle" font-size="12">${escapeXml(String(node.data.label ?? node.id))}</text>`;
    });

    svgContent += `</svg>`;
    return { svgContent, width, height };
  };

  const exportPNG = async () => {
    if (!reactFlowInstance) {
      alert("Graph not ready for export");
      return;
    }

    try {
      const result = buildCleanSvg();
      if (!result) {
        alert("No nodes to export");
        return;
      }

      const { svgContent, width, height } = result;
      const svgBlob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onerror = () => {
        URL.revokeObjectURL(url);
        alert("Failed to export PNG: could not render graph as image.");
      };
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          alert("Failed to create canvas context");
          return;
        }
        ctx.drawImage(img, 0, 0, width * 2, height * 2);
        URL.revokeObjectURL(url);

        const filename = `${graph?.project.name ?? "knowledge-graph"}-export.png`;
        canvas.toBlob((blob) => {
          if (blob) {
            downloadBlob(blob, filename);
            toggleExportMenu();
          } else {
            alert("Failed to export PNG: image encoding failed.");
          }
        }, "image/png");
      };
      img.src = url;
    } catch (error) {
      console.error("PNG export failed:", error);
      alert(`Failed to export PNG: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportSVG = () => {
    if (!reactFlowInstance) {
      alert("Graph not ready for export");
      return;
    }

    try {
      const result = buildCleanSvg();
      if (!result) {
        alert("No nodes to export");
        return;
      }

      const blob = new Blob([result.svgContent], { type: "image/svg+xml;charset=utf-8" });
      const filename = `${graph?.project.name ?? "knowledge-graph"}-export.svg`;
      downloadBlob(blob, filename);
      toggleExportMenu();
    } catch (error) {
      console.error("SVG export failed:", error);
      alert(`Failed to export SVG: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportJSON = () => {
    if (!graph) {
      alert("No graph loaded");
      return;
    }

    try {
      // Apply persona and filters to create filtered graph
      // Non-technical persona: hide function/class sub-nodes, keep everything else
      const subFileTypes = new Set(["function", "class"]);
      let filteredGraphNodes = persona === "non-technical"
        ? graph.nodes.filter((n) => !subFileTypes.has(n.type))
        : graph.nodes;

      filteredGraphNodes = filterNodes(filteredGraphNodes, nodeIdToLayerIds, filters);
      const filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));

      let filteredGraphEdges = graph.edges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      );
      filteredGraphEdges = filterEdges(filteredGraphEdges, filteredNodeIds, filters);

      const filteredGraph: KnowledgeGraph = {
        ...graph,
        nodes: filteredGraphNodes,
        edges: filteredGraphEdges,
      };

      const json = JSON.stringify(filteredGraph, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const filename = `${graph.project.name ?? "knowledge-graph"}-export.json`;
      downloadBlob(blob, filename);
      toggleExportMenu();
    } catch (error) {
      console.error("JSON export failed:", error);
      alert(`Failed to export JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleExportMenu}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
        title={t.export.title}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        {t.export.label}
      </button>

      {exportMenuOpen && (
        <div className="absolute right-0 top-full mt-2 w-52 glass rounded-lg shadow-xl overflow-hidden animate-fade-slide-in z-50">
          <div className="p-2">
            <button
              onClick={exportPNG}
              disabled={!reactFlowInstance}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-elevated transition-colors rounded-lg text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{t.export.asPNG}</span>
            </button>
            <button
              onClick={exportSVG}
              disabled={!reactFlowInstance}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-elevated transition-colors rounded-lg text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
              <span>{t.export.asSVG}</span>
            </button>
            <button
              onClick={exportJSON}
              disabled={!graph}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-elevated transition-colors rounded-lg text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span>{t.export.asJSON}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
