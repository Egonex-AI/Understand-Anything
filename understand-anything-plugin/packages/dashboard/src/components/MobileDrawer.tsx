import { useEffect } from "react";
import { useDashboardStore } from "../store";
import PersonaSelector from "./PersonaSelector";
import DiffToggle from "./DiffToggle";
import LayerLegend from "./LayerLegend";
import FilterPanel from "./FilterPanel";
import ExportMenu from "./ExportMenu";
import { ThemePicker } from "./ThemePicker";

interface Props {
  open: boolean;
  onClose: () => void;
  onTogglePathFinder: () => void;
  onShowKeyboardHelp: () => void;
}

interface NodeTypeFilterDef {
  key: "code" | "config" | "docs" | "infra" | "data" | "domain" | "knowledge";
  label: string;
  color: string;
}

const STRUCTURAL_FILTERS: NodeTypeFilterDef[] = [
  { key: "code", label: "Code", color: "var(--color-node-file)" },
  { key: "config", label: "Config", color: "var(--color-node-config)" },
  { key: "docs", label: "Docs", color: "var(--color-node-document)" },
  { key: "infra", label: "Infra", color: "var(--color-node-service)" },
  { key: "data", label: "Data", color: "var(--color-node-table)" },
  { key: "domain", label: "Domain", color: "var(--color-node-concept)" },
  { key: "knowledge", label: "Knowledge", color: "var(--color-node-article)" },
];

const KNOWLEDGE_FILTERS: NodeTypeFilterDef[] = [
  { key: "knowledge", label: "All", color: "var(--color-node-article)" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
      {children}
    </h3>
  );
}

export default function MobileDrawer({
  open,
  onClose,
  onTogglePathFinder,
  onShowKeyboardHelp,
}: Props) {
  const graph = useDashboardStore((s) => s.graph);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const toggleNodeTypeFilter = useDashboardStore((s) => s.toggleNodeTypeFilter);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open so the page behind doesn't drift
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const filterDefs = isKnowledgeGraph ? KNOWLEDGE_FILTERS : STRUCTURAL_FILTERS;
  const showViewToggle = Boolean(graph && !isKnowledgeGraph && domainGraph);

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-black/65 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        className={`absolute left-0 top-0 bottom-0 w-[86%] max-w-[360px] bg-surface border-r border-border-subtle flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-label="Settings"
      >
        {/* Drawer header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Controls
            </span>
            <h2 className="font-heading text-lg text-text-primary mt-0.5 leading-none">
              {graph?.project.name ?? "Dashboard"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5 space-y-7">
          <section>
            <SectionLabel>Role</SectionLabel>
            <PersonaSelector />
          </section>

          {showViewToggle && (
            <section>
              <SectionLabel>View</SectionLabel>
              <div className="inline-flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("domain")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "domain"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Domain
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("structural")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "structural"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Structural
                </button>
              </div>
            </section>
          )}

          <section>
            <SectionLabel>Diff overlay</SectionLabel>
            <DiffToggle />
          </section>

          <section>
            <SectionLabel>Node types</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {filterDefs.map((cat) => {
                const active = nodeTypeFilters[cat.key] !== false;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => toggleNodeTypeFilter(cat.key)}
                    className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                      active
                        ? "border-border-medium bg-elevated text-text-secondary"
                        : "border-transparent bg-transparent text-text-muted/40 line-through"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: cat.color,
                        opacity: active ? 1 : 0.3,
                      }}
                    />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </section>

          {graph && (graph.layers?.length ?? 0) > 0 && (
            <section>
              <SectionLabel>Layers</SectionLabel>
              <div className="-mx-1">
                <LayerLegend />
              </div>
            </section>
          )}

          <section>
            <SectionLabel>Tools</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <FilterPanel />
              <ExportMenu />
              <button
                type="button"
                onClick={() => {
                  onTogglePathFinder();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
                Path
              </button>
              <ThemePicker />
              <button
                type="button"
                onClick={() => {
                  onShowKeyboardHelp();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
                aria-label="Keyboard shortcuts"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Help
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
