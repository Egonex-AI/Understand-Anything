import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import type { SearchMode } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import {
  MIN_CONTENT_QUERY_LENGTH,
  useContentSearch,
  type ContentSearchMatch,
  type ContentSearchOptions,
} from "../hooks/useContentSearch";
import { buildFileNodeIndex, fileNodeForPath, nodeForFileLine } from "../utils/fileNodes";

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

const MAX_NODE_RESULTS = 10;
/** Cap on rendered content-search rows; the server caps the total too. */
const MAX_CONTENT_ROWS = 200;

/** One match line with the matched text marked. */
function MatchPreview({ match }: { match: ContentSearchMatch }) {
  const { preview, previewColumn, length } = match;
  const before = preview.slice(0, previewColumn).replace(/^\s+/, "");
  return (
    <span className="font-mono text-[11px] text-text-secondary whitespace-pre truncate">
      {before}
      <mark className="bg-accent/30 text-text-primary rounded-sm">
        {preview.slice(previewColumn, previewColumn + length)}
      </mark>
      {preview.slice(previewColumn + length)}
    </span>
  );
}

function OptionToggle({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`text-[10px] font-mono w-6 py-0.5 rounded transition-colors ${
        active ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

export default function SearchBar({ accessToken }: { accessToken: string }) {
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const graph = useDashboardStore((s) => s.graph);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const setSearchResults = useDashboardStore((s) => s.setSearchResults);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const searchMode = useDashboardStore((s) => s.searchMode);
  const setSearchMode = useDashboardStore((s) => s.setSearchMode);
  const { t } = useI18n();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contentOptions, setContentOptions] = useState<ContentSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isContent = searchMode === "content";
  const contentSearch = useContentSearch(searchQuery, contentOptions, accessToken, isContent);

  // Build a lookup map for node details
  const nodeMap = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );
  const fileIndex = useMemo(() => buildFileNodeIndex(graph?.nodes ?? []), [graph]);

  // Light up files with content matches in the graph, like fuzzy hits.
  const contentResult = isContent ? contentSearch.result : null;
  useEffect(() => {
    if (!isContent) return;
    if (!contentResult) {
      if (contentSearch.status !== "loading") setSearchResults([]);
      return;
    }
    const hits = contentResult.files
      .map((f) => fileNodeForPath(fileIndex, f.path))
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .map((n) => ({ nodeId: n.id, score: 0.05 }));
    setSearchResults(hits);
  }, [isContent, contentResult, contentSearch.status, fileIndex, setSearchResults]);

  const topResults = isContent ? [] : searchResults.slice(0, MAX_NODE_RESULTS);

  // Flat list of content matches (in render order) for keyboard navigation.
  const contentRows = useMemo(() => {
    const rows: { path: string; match: ContentSearchMatch }[] = [];
    for (const file of contentResult?.files ?? []) {
      for (const match of file.matches) {
        if (rows.length >= MAX_CONTENT_ROWS) return rows;
        rows.push({ path: file.path, match });
      }
    }
    return rows;
  }, [contentResult]);

  const itemCount = isContent ? contentRows.length : topResults.length;
  useEffect(() => setActiveIndex(0), [searchResults, contentRows]);

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

  // Open a content hit: drill to the file in the graph, select the most
  // specific node covering the line, and show the source at that line.
  const openContentMatch = useCallback(
    (path: string, line: number) => {
      const fileNode = fileNodeForPath(fileIndex, path);
      if (!fileNode) return;
      const target = nodeForFileLine(fileIndex, path, line) ?? fileNode;
      navigateToNodeInLayer(fileNode.id);
      if (target.id !== fileNode.id) useDashboardStore.setState({ selectedNodeId: target.id });
      openCodeViewer(target.id, line);
      setDropdownOpen(false);
    },
    [fileIndex, navigateToNodeInLayer, openCodeViewer],
  );

  const activateIndex = useCallback(
    (index: number) => {
      if (isContent) {
        const row = contentRows[index];
        if (row) openContentMatch(row.path, row.match.line);
      } else {
        const result = topResults[index];
        if (result) handleResultClick(result.nodeId);
      }
    },
    [isContent, contentRows, topResults, openContentMatch, handleResultClick],
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (itemCount === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((i) => (i + (e.key === "ArrowDown" ? 1 : itemCount - 1)) % itemCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activateIndex(activeIndex);
    }
  };

  // Keep the keyboard-selected row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Close dropdown on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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

  const hasQuery = searchQuery.trim().length > 0;
  const contentTooShort = isContent && searchQuery.trim().length < MIN_CONTENT_QUERY_LENGTH;
  const showDropdown =
    dropdownOpen && hasQuery && (isContent ? true : topResults.length > 0);

  const modes: { mode: SearchMode; label: string; title?: string }[] = [
    { mode: "fuzzy", label: t.search.fuzzy },
    { mode: "semantic", label: t.search.semantic },
    { mode: "content", label: t.search.code, title: t.search.codePlaceholder },
  ];

  let statusText: string | null = null;
  if (hasQuery) {
    if (!isContent) {
      statusText = `${searchResults.length} ${searchResults.length === 1 ? t.search.result : t.search.results} (${searchMode})`;
    } else if (contentSearch.status === "loading" && !contentSearch.result) {
      statusText = t.search.searching;
    } else if (contentSearch.result) {
      const r = contentSearch.result;
      statusText = fmt(t.search.matchesInFiles, { matches: r.totalMatches, files: r.files.length });
      if (r.truncated) statusText += ` · ${fmt(t.search.truncated, { n: r.totalMatches })}`;
    }
  }

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
        <div className="flex-1 min-w-0 relative">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder={isContent ? t.search.codePlaceholder : t.search.placeholder}
            data-testid="search-input"
            role="combobox"
            aria-expanded={Boolean(showDropdown)}
            className={`w-full bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted ${
              isContent ? "pr-24" : ""
            }`}
          />
          {isContent && (
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <OptionToggle
                active={contentOptions.caseSensitive}
                label="Aa"
                title={t.search.caseSensitive}
                onClick={() => setContentOptions((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
              />
              <OptionToggle
                active={contentOptions.wholeWord}
                label="ab"
                title={t.search.wholeWord}
                onClick={() => setContentOptions((o) => ({ ...o, wholeWord: !o.wholeWord }))}
              />
              <OptionToggle
                active={contentOptions.regex}
                label=".*"
                title={t.search.regex}
                onClick={() => setContentOptions((o) => ({ ...o, regex: !o.regex }))}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5 shrink-0">
          {modes.map(({ mode, label, title }) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() => {
                setSearchMode(mode);
                inputRef.current?.focus();
              }}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                searchMode === mode
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {statusText && (
          <span className="hidden sm:inline text-xs text-text-muted shrink-0">{statusText}</span>
        )}
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div
          ref={listRef}
          className="absolute left-4 right-4 top-full mt-0.5 glass rounded-lg shadow-xl overflow-auto max-h-[60vh]"
        >
          {!isContent &&
            topResults.map((result, index) => {
              const node = nodeMap.get(result.nodeId);
              if (!node) return null;

              const relevance = Math.round((1 - result.score) * 100);
              const badgeColor = typeBadgeColors[node.type] ?? typeBadgeColors.file;

              return (
                <button
                  key={result.nodeId}
                  type="button"
                  data-index={index}
                  onClick={() => handleResultClick(result.nodeId)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                    index === activeIndex ? "bg-elevated" : ""
                  }`}
                >
                  {/* Type badge */}
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0`}
                  >
                    {node.type}
                  </span>

                  {/* Node name */}
                  <span className="text-sm text-text-primary truncate flex-1">
                    {node.name}
                  </span>

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

          {isContent && (
            <ContentResults
              tooShort={contentTooShort}
              state={contentSearch}
              rows={contentRows}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onOpen={openContentMatch}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ContentResults({
  tooShort,
  state,
  rows,
  activeIndex,
  onHover,
  onOpen,
}: {
  tooShort: boolean;
  state: ReturnType<typeof useContentSearch>;
  rows: { path: string; match: ContentSearchMatch }[];
  activeIndex: number;
  onHover: (index: number) => void;
  onOpen: (path: string, line: number) => void;
}) {
  const { t } = useI18n();
  const message = (text: string) => (
    <div className="px-3 py-2.5 text-xs text-text-muted">{text}</div>
  );

  if (tooShort) return message(fmt(t.search.minChars, { n: MIN_CONTENT_QUERY_LENGTH }));
  if (state.status === "error") {
    return message(state.error === "unavailable" ? t.search.codeUnavailable : state.error);
  }
  if (!state.result) return message(t.search.searching);
  if (state.result.files.length === 0) return message(t.search.noMatches);

  const matchCountByPath = new Map(state.result.files.map((f) => [f.path, f.matchCount]));
  const shownByPath = new Map<string, number>();
  for (const row of rows) shownByPath.set(row.path, (shownByPath.get(row.path) ?? 0) + 1);
  const out: React.ReactNode[] = [];
  rows.forEach((row, index) => {
    const isFirstInFile = index === 0 || rows[index - 1].path !== row.path;
    const isLastInFile = index === rows.length - 1 || rows[index + 1].path !== row.path;
    if (isFirstInFile) {
      out.push(
        <button
          key={`file:${row.path}`}
          type="button"
          onClick={() => onOpen(row.path, row.match.line)}
          className="w-full flex items-center gap-2 px-3 pt-2 pb-1 text-left sticky top-0 bg-surface/95 backdrop-blur-sm"
        >
          <span className="text-[11px] font-mono text-text-primary truncate flex-1" title={row.path}>
            {row.path}
          </span>
          <span className="text-[10px] text-text-muted shrink-0">{matchCountByPath.get(row.path)}</span>
        </button>,
      );
    }
    out.push(
      <button
        key={`${row.path}:${row.match.line}:${row.match.column}`}
        type="button"
        data-index={index}
        onClick={() => onOpen(row.path, row.match.line)}
        onMouseEnter={() => onHover(index)}
        className={`w-full flex items-center gap-3 pl-3 pr-3 py-1 text-left transition-colors ${
          index === activeIndex ? "bg-elevated" : ""
        }`}
      >
        <span className="w-10 shrink-0 text-right text-[10px] font-mono text-text-muted">{row.match.line}</span>
        <MatchPreview match={row.match} />
      </button>,
    );
    const shown = shownByPath.get(row.path) ?? 0;
    const total = matchCountByPath.get(row.path) ?? shown;
    if (isLastInFile && total > shown) {
      out.push(
        <div key={`more:${row.path}`} className="pl-16 pr-3 pb-1 text-[10px] text-text-muted">
          {fmt(t.search.moreInFile, { n: total - shown })}
        </div>,
      );
    }
  });
  return <div className="py-1">{out}</div>;
}
