import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

const typeBadgeColors: Record<string, string> = {
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
};

export default function SearchBar() {
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const graph = useDashboardStore((s) => s.graph);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const searchMode = useDashboardStore((s) => s.searchMode);
  const setSearchMode = useDashboardStore((s) => s.setSearchMode);
  const { t } = useI18n();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nodeMap = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const topResults = searchResults.slice(0, 10);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [searchResults]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      setDropdownOpen(true);
    },
    [setSearchQuery],
  );

  const handleResultClick = useCallback(
    (nodeId: string) => {
      navigateToNodeInLayer(nodeId);
      setDropdownOpen(false);
    },
    [navigateToNodeInLayer],
  );

  const handleClear = useCallback(() => {
    setSearchQuery("");
    setDropdownOpen(false);
    inputRef.current?.focus();
  }, [setSearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!dropdownOpen || topResults.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < topResults.length - 1 ? prev + 1 : 0,
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : topResults.length - 1,
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < topResults.length) {
            handleResultClick(topResults[activeIndex].nodeId);
          } else if (topResults.length > 0) {
            handleResultClick(topResults[0].nodeId);
          }
          break;
        }
      }
    },
    [dropdownOpen, topResults, activeIndex, handleResultClick],
  );

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Close dropdown on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showDropdown = dropdownOpen && searchQuery.trim() && topResults.length > 0;

  return (
    <div ref={containerRef} className="relative z-30">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface border-b border-border-subtle">
        <svg
          className="w-4 h-4 text-text-muted shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t.search.placeholder}
          data-testid="search-input"
          className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
          role="combobox"
          aria-expanded={showDropdown || undefined}
          aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
        />
        {searchQuery.trim() && (
          <button
            onClick={handleClear}
            className="text-text-muted hover:text-text-primary transition-colors shrink-0 p-1"
            aria-label="Clear search"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setSearchMode("fuzzy")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "fuzzy"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.fuzzy}
          </button>
          <button
            onClick={() => setSearchMode("semantic")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "semantic"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.semantic}
          </button>
        </div>
        {searchQuery.trim() && (
          <span className="hidden sm:inline text-xs text-text-muted shrink-0">
            {searchResults.length} {t.search.result}{searchResults.length !== 1 ? "s" : ""}{" "}
            <span className="text-text-muted">({searchMode})</span>
          </span>
        )}
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div ref={listRef} className="absolute left-4 right-4 top-full mt-0.5 glass rounded-lg shadow-xl overflow-y-auto max-h-[400px]" role="listbox">
          {topResults.map((result, idx) => {
            const node = nodeMap.get(result.nodeId);
            if (!node) return null;

            const relevance = Math.round((1 - result.score) * 100);
            const badgeColor = typeBadgeColors[node.type] ?? typeBadgeColors.file;
            const isActive = idx === activeIndex;

            return (
              <button
                key={result.nodeId}
                id={`search-result-${idx}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleResultClick(result.nodeId)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                  isActive ? "bg-accent/10" : "hover:bg-elevated"
                }`}
              >
                {/* Type badge */}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0`}
                >
                  {node.type}
                </span>

                {/* Node name + file path */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {node.name}
                  </div>
                  {node.filePath && (
                    <div className="text-[10px] text-text-muted truncate font-mono">
                      {node.filePath}
                    </div>
                  )}
                </div>

                {/* Relevance bar */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${relevance}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted w-7 text-right">
                    {relevance}%
                  </span>
                </div>
              </button>
            );
          })}
          {searchResults.length > 10 && (
            <div className="px-3 py-1.5 text-[10px] text-text-muted text-center border-t border-border-subtle">
              {searchResults.length - 10} more results
            </div>
          )}
        </div>
      )}
    </div>
  );
}
