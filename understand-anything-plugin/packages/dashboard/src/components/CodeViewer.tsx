import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import type { GraphNode } from "@understand-anything/core/types";
import MarkdownContent from "./MarkdownContent";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { useTheme } from "../themes/index.ts";
import { ensurePrismLanguage, isPrismLanguageLoaded, languageForPath } from "../utils/prismLanguages";
import {
  buildOutline,
  buildRangeLanes,
  getCodeNavIndex,
  isIdentifierToken,
  MOD_KEY_LABEL,
  resolveIdentifier,
} from "../utils/codeNav";
import { buildFileNodeIndex, fileNodeForPath, normalizeNodePath } from "../utils/fileNodes";
import { useAnnotationsStore } from "../annotationsStore";
import { useReadingProgress } from "../readingProgress";
import { LineNoteEditor, LineNoteView } from "./LineNote";
import { fmt } from "../locales";

interface CodeViewerProps {
  accessToken: string;
  presentation?: "sidebar" | "modal";
  onClose?: () => void;
  onExpand?: () => void;
}

interface SourceFile {
  path: string;
  language: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

type SourceState =
  | { status: "idle" | "loading"; source: null; error: null }
  | { status: "loaded"; source: SourceFile; error: null }
  | { status: "error"; source: null; error: string };

function fileContentUrl(filePath: string, token: string): string {
  const params = new URLSearchParams({ token, path: filePath });
  return `/file-content.json?${params.toString()}`;
}

/** Class set on the code scroller while Ctrl/⌘ is held, so identifier links look clickable. */
const MOD_HELD_CLASS = "ua-mod-held";
const IDENTIFIER_SPLIT_RE = /([A-Za-z_$][\w$]*)/;

const OUTLINE_OPEN_KEY = "ua-code-outline-open";
/** Width of one gutter range-bar lane, in px. */
const LANE_WIDTH = 5;

function readOutlineOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OUTLINE_OPEN_KEY);
    if (stored !== null) return stored === "1";
    return window.innerWidth >= 768;
  } catch {
    return true;
  }
}

function writeOutlineOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OUTLINE_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage blocked — the choice just won't stick.
  }
}

function nodeColor(type: string): string {
  return `var(--color-node-${type}, var(--color-text-muted))`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rendered markdown view for .md files. */
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="px-6 py-5 max-w-3xl text-sm text-text-secondary leading-relaxed">
      <MarkdownContent content={content} />
    </div>
  );
}

function CopyButton({ text, label, doneLabel }: { text: string; label: string; doneLabel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
      }}
      className={`shrink-0 transition-colors ${copied ? "text-accent" : "text-text-muted hover:text-text-primary"}`}
      title={copied ? doneLabel : label}
      aria-label={copied ? doneLabel : label}
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15V5a2 2 0 012-2h10" />
        </svg>
      )}
    </button>
  );
}

export default function CodeViewer({
  accessToken,
  presentation = "sidebar",
  onClose,
  onExpand,
}: CodeViewerProps) {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const codeViewerNodeId = useDashboardStore((s) => s.codeViewerNodeId);
  const closeCodeViewer = useDashboardStore((s) => s.closeCodeViewer);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const targetLine = useDashboardStore((s) => s.codeViewerLine);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  // Files tab always builds its tree from the structural graph, so a node ID opened from
  // there may not exist in the active (domain) graph — fall back to the structural graph.
  const node =
    activeGraph?.nodes.find((n) => n.id === codeViewerNodeId) ??
    graph?.nodes.find((n) => n.id === codeViewerNodeId) ??
    null;
  const [state, setState] = useState<SourceState>({
    status: "idle",
    source: null,
    error: null,
  });
  // Markdown files default to the rendered view (#555); toggle back to
  // source for line numbers / lineRange highlighting.
  const [mdView, setMdView] = useState<"rendered" | "source">("rendered");
  const { t } = useI18n();
  const { preset } = useTheme();

  // Prefer the client-side mapping (it knows which grammars exist); fall back
  // to the server's guess for extensions the client doesn't recognise.
  const pathLanguage = languageForPath(node?.filePath);
  const language =
    pathLanguage !== "text" ? pathLanguage : state.source?.language ?? "text";
  const [loadedLanguage, setLoadedLanguage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ensurePrismLanguage(language).then((ok) => {
      if (!cancelled && ok) setLoadedLanguage(language);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);
  const highlightLanguage =
    loadedLanguage === language || isPrismLanguageLoaded(language) ? language : "text";

  useEffect(() => {
    if (!node?.filePath) {
      setState({ status: "error", source: null, error: "This node does not have a file path." });
      return;
    }

    if (accessToken === "__demo__") {
      setState({
        status: "error",
        source: null,
        error: "Source preview is available only when the local dashboard server is running.",
      });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", source: null, error: null });

    fetch(fileContentUrl(node.filePath, accessToken), { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as SourceFile | { error?: string };
        if (!res.ok) {
          throw new Error("error" in data && data.error ? data.error : "Source unavailable");
        }
        setState({ status: "loaded", source: data as SourceFile, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          source: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => controller.abort();
  }, [accessToken, node?.filePath]);

  // Identifier → graph node, cached per file so each name resolves once.
  const navIndex = useMemo(() => (graph ? getCodeNavIndex(graph) : null), [graph]);
  const filePath = node?.filePath ?? null;
  const resolveName = useMemo(() => {
    const cache = new Map<string, GraphNode | null>();
    return (name: string): GraphNode | null => {
      if (!navIndex || !filePath) return null;
      let hit = cache.get(name);
      if (hit === undefined) {
        hit = resolveIdentifier(navIndex, name, filePath);
        cache.set(name, hit);
      }
      return hit;
    };
  }, [navIndex, filePath]);

  // Jump to another node from the source: select it in the graph and show its
  // code, staying in the expanded modal if that's where the click came from.
  const goToNode = useCallback((nodeId: string) => {
    const store = useDashboardStore.getState();
    const target = nodesById.get(nodeId);
    if (!target) return;
    const wasExpanded = store.codeViewerExpanded;
    store.navigateToNode(nodeId);
    store.openCodeViewer(nodeId, target.lineRange?.[0]);
    if (wasExpanded) store.expandCodeViewer();
  }, [nodesById]);

  // Outline + gutter range bars: the graph's ranged nodes inside this file.
  const outlineChildren = useMemo(
    () => (navIndex && filePath ? navIndex.childrenByFile.get(normalizeNodePath(filePath)) ?? [] : []),
    [navIndex, filePath],
  );
  const outline = useMemo(() => buildOutline(outlineChildren), [outlineChildren]);
  const sourceLineCount = state.source?.lineCount ?? 0;
  const rangeLanes = useMemo(
    () => buildRangeLanes(outlineChildren, sourceLineCount),
    [outlineChildren, sourceLineCount],
  );
  const [outlineOpen, setOutlineOpen] = useState(readOutlineOpen);
  const toggleOutline = () => {
    setOutlineOpen((open) => {
      writeOutlineOpen(!open);
      return !open;
    });
  };
  const [flashLine, setFlashLine] = useState<number | null>(null);
  useEffect(() => {
    if (flashLine === null) return;
    const timer = window.setTimeout(() => setFlashLine(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flashLine]);

  const scrollToLine = useCallback((line: number) => {
    const container = scrollRef.current;
    const lineEl = container?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!container || !lineEl) return;
    const offset =
      lineEl.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, offset - container.clientHeight / 3);
  }, []);

  const jumpToNodeLine = (target: GraphNode) => {
    if (!target.lineRange) return;
    scrollToLine(target.lineRange[0]);
    setFlashLine(target.lineRange[0]);
  };

  const rangeTitle = (target: GraphNode) =>
    target.lineRange
      ? fmt(t.codeNav.rangeTitle, { name: target.name, start: target.lineRange[0], end: target.lineRange[1] })
      : target.name;

  // Line notes belong to the file's node, whichever of its nodes is open.
  const fileIndex = useMemo(() => (graph ? buildFileNodeIndex(graph.nodes) : null), [graph]);
  const noteNodeId = filePath && fileIndex ? fileNodeForPath(fileIndex, filePath)?.id ?? node?.id : node?.id;
  const lineNotes = useAnnotationsStore((s) => (noteNodeId ? s.annotations[noteNodeId]?.lines : undefined));
  const setLineNote = useAnnotationsStore((s) => s.setLineNote);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  useEffect(() => setEditingLine(null), [filePath]);
  const saveLineNote = (line: number, note: string) => {
    if (noteNodeId) setLineNote(noteNodeId, line, note);
    setEditingLine(null);
  };

  const handleCodeClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const link = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-id]");
    if (!link?.dataset.navId) return;
    event.preventDefault();
    goToNode(link.dataset.navId);
  };

  // Ctrl/⌘ held → identifier links show as clickable (toggled on the DOM, not
  // in React state, so holding the key doesn't re-render the whole file).
  useEffect(() => {
    const update = (event: KeyboardEvent | MouseEvent) =>
      scrollRef.current?.classList.toggle(MOD_HELD_CLASS, event.metaKey || event.ctrlKey);
    const clear = () => scrollRef.current?.classList.remove(MOD_HELD_CLASS);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("mousemove", update, { passive: true });
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("mousemove", update);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Reading progress: a file counts as read once its source has been shown.
  useEffect(() => {
    if (state.status === "loaded" && filePath) useReadingProgress.getState().markRead(filePath);
  }, [state.status, filePath]);

  const highlightedRange = useMemo(() => {
    if (!node?.lineRange) return null;
    return { start: node.lineRange[0], end: node.lineRange[1] };
  }, [node?.lineRange]);

  // A specific target line (content-search hit) needs line numbers, so show
  // markdown as source.
  useEffect(() => {
    if (targetLine !== null) setMdView("source");
  }, [targetLine]);

  // Bring the target line — or the start of the node's line range — into view
  // once the source has rendered, instead of always opening at line 1.
  const focusLine = targetLine ?? highlightedRange?.start ?? null;
  const isSourceRendered =
    state.status === "loaded" && !(language === "markdown" && mdView === "rendered");
  useEffect(() => {
    if (focusLine === null || !isSourceRendered) return;
    scrollToLine(focusLine);
  }, [focusLine, isSourceRendered, state.source, scrollToLine]);

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">{t.codeViewer.noFile}</p>
      </div>
    );
  }

  const source = state.source;
  const isMarkdown = language === "markdown";
  const showRendered = isMarkdown && mdView === "rendered";
  const lineInfo = highlightedRange
    ? `${t.codeViewer.lines} ${highlightedRange.start}-${highlightedRange.end}`
    : t.codeViewer.fullFile;
  const isModal = presentation === "modal";
  const gutterWidth = 48 + (rangeLanes.laneCount > 0 ? rangeLanes.laneCount * LANE_WIDTH + 4 : 0);
  const handleClose = onClose ?? closeCodeViewer;

  return (
    <div className="h-full w-full flex flex-col bg-surface overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 bg-elevated border-b border-border-subtle shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border"
              style={{
                color: "var(--color-node-file)",
                borderColor: "color-mix(in srgb, var(--color-node-file) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--color-node-file) 10%, transparent)",
              }}
            >
              {language}
            </span>
            <span className="text-[10px] text-text-muted">{lineInfo}</span>
          </div>
          <div className="text-sm font-heading text-text-primary truncate" title={node.name}>
            {node.name}
          </div>
          {node.filePath && (
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <div className="text-[11px] font-mono text-text-muted truncate" title={node.filePath}>
                {node.filePath}
              </div>
              <CopyButton text={node.filePath} label={t.codeViewer.copyPath} doneLabel={t.codeViewer.copied} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="text-text-muted hover:text-text-primary transition-colors"
              title={t.codeViewer.openLarger}
              aria-label={t.codeViewer.openLarger}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            title={isModal ? t.codeViewer.closeExpanded : t.codeViewer.closeViewer}
            aria-label={isModal ? t.codeViewer.closeExpanded : t.codeViewer.closeViewer}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
      {outlineOpen && outline.length > 0 && isSourceRendered && (
        <nav
          className="w-44 shrink-0 overflow-auto border-r border-border-subtle bg-surface py-1"
          aria-label={t.codeNav.outline}
        >
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            {t.codeNav.outline}
          </div>
          {outline.map(({ node: child, depth }) => {
            const active = child.id === codeViewerNodeId;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => jumpToNodeLine(child)}
                className={`w-full flex items-center gap-1.5 py-1 pr-2 text-left text-[11px] transition-colors ${
                  active ? "bg-accent/10 text-accent" : "text-text-secondary hover:text-text-primary hover:bg-elevated"
                }`}
                style={{ paddingLeft: 10 + depth * 10 }}
                title={rangeTitle(child)}
                aria-current={active ? "location" : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: nodeColor(child.type) }} />
                <span className="flex-1 truncate font-mono">{child.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{child.lineRange![0]}</span>
              </button>
            );
          })}
        </nav>
      )}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-auto bg-root">
        {state.status === "loading" && (
          <div className="p-5 text-sm text-text-muted">{t.codeViewer.loading}</div>
        )}

        {state.status === "error" && (
          <div className="p-5">
            <div className="rounded-lg border border-border-subtle bg-elevated p-4">
              <div className="text-sm font-medium text-text-primary mb-2">{t.codeViewer.sourceUnavailable}</div>
              <p className="text-sm text-text-secondary leading-relaxed">{state.error}</p>
            </div>
          </div>
        )}

        {source && (
          <>
            <div className="px-4 py-2 border-b border-border-subtle bg-surface text-[11px] text-text-muted flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span>{source.lineCount} {t.codeViewer.linesLabel}</span>
                {outline.length > 0 && !showRendered && (
                  <button
                    type="button"
                    onClick={toggleOutline}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors ${
                      outlineOpen
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border-subtle text-text-muted hover:text-text-primary"
                    }`}
                    aria-pressed={outlineOpen}
                    title={outlineOpen ? t.codeNav.hideOutline : t.codeNav.showOutline}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M8 12h12M8 18h12" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider">
                      {t.codeNav.outline} · {outline.length}
                    </span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {isMarkdown && (
                  <div className="flex items-center rounded border border-border-subtle overflow-hidden" role="group">
                    {(["rendered", "source"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setMdView(view)}
                        className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                          mdView === view
                            ? "bg-accent/15 text-accent"
                            : "text-text-muted hover:text-text-primary"
                        }`}
                        aria-pressed={mdView === view}
                      >
                        {view === "rendered" ? t.codeViewer.rendered : t.codeViewer.source}
                      </button>
                    ))}
                  </div>
                )}
                <span>{formatBytes(source.sizeBytes)}</span>
              </div>
            </div>
            {showRendered && <MarkdownView content={source.content} />}
            {!showRendered && (
            <Highlight
              code={source.content}
              language={highlightLanguage}
              theme={preset.isDark ? themes.oneDark : themes.oneLight}
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={`${className} min-w-max p-0 m-0 ${
                    isModal ? "text-xs leading-5" : "text-[11px] leading-5"
                  } font-mono`}
                  style={{ ...style, backgroundColor: "transparent" }}
                  onClick={handleCodeClick}
                >
                  {tokens.map((line, index) => {
                    const lineNumber = index + 1;
                    const isTarget = lineNumber === targetLine;
                    const isHighlighted =
                      highlightedRange !== null &&
                      lineNumber >= highlightedRange.start &&
                      lineNumber <= highlightedRange.end;
                    const lineProps = getLineProps({ line });
                    const lineNote = lineNotes?.[String(lineNumber)];
                    return (
                      <Fragment key={lineNumber}>
                      <div
                        {...lineProps}
                        data-line={lineNumber}
                        className={`${lineProps.className} flex transition-colors ${
                          isTarget || lineNumber === flashLine
                            ? "bg-accent/30"
                            : isHighlighted
                            ? "bg-accent/15"
                            : "hover:bg-elevated/40"
                        }`}
                      >
                        <span className="w-12 shrink-0 select-none border-r border-border-subtle text-right text-text-muted bg-surface/60">
                          <button
                            type="button"
                            onClick={() => setEditingLine(lineNumber)}
                            className={`relative w-full pr-3 text-right hover:text-accent transition-colors ${
                              lineNote ? "text-accent" : ""
                            }`}
                            title={fmt(lineNote ? t.codeNav.editLineNote : t.codeNav.addLineNote, { line: lineNumber })}
                          >
                            {lineNote && (
                              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent" />
                            )}
                            {lineNumber}
                          </button>
                        </span>
                        {rangeLanes.laneCount > 0 && (
                          <span
                            className="relative shrink-0 select-none bg-surface/60"
                            style={{ width: rangeLanes.laneCount * LANE_WIDTH + 4 }}
                          >
                            {rangeLanes.lanes[index]?.map((owner, lane) => {
                              if (!owner) return null;
                              const [start, end] = owner.lineRange!;
                              const selected = owner.id === codeViewerNodeId;
                              return (
                                <span
                                  key={lane}
                                  className="absolute inset-y-0 cursor-pointer"
                                  style={{ left: 2 + lane * LANE_WIDTH, width: LANE_WIDTH }}
                                  title={rangeTitle(owner)}
                                  onClick={() => jumpToNodeLine(owner)}
                                >
                                  <span
                                    className={`absolute left-px right-px ${
                                      lineNumber === start ? "top-1 rounded-t-full" : "top-0"
                                    } ${lineNumber === end ? "bottom-1 rounded-b-full" : "bottom-0"}`}
                                    style={{
                                      backgroundColor: selected
                                        ? "var(--color-accent)"
                                        : `color-mix(in srgb, ${nodeColor(owner.type)} 55%, transparent)`,
                                    }}
                                  />
                                </span>
                              );
                            })}
                          </span>
                        )}
                        <span className="pl-3 pr-6 whitespace-pre">
                          {line.map((token, key) => {
                            const tokenProps = getTokenProps({ token });
                            if (!navIndex || !isIdentifierToken(token.types)) {
                              return <span key={key} {...tokenProps} />;
                            }
                            // Odd indices are identifiers; wrap the ones that name a graph node.
                            const parts = token.content.split(IDENTIFIER_SPLIT_RE);
                            if (!parts.some((part, i) => i % 2 === 1 && resolveName(part))) {
                              return <span key={key} {...tokenProps} />;
                            }
                            return (
                              <span key={key} {...tokenProps}>
                                {parts.map((part, i) => {
                                  const target = i % 2 === 1 ? resolveName(part) : null;
                                  if (!target) return part;
                                  return (
                                    <span
                                      key={i}
                                      data-nav-id={target.id}
                                      title={fmt(t.codeNav.goTo, { mod: MOD_KEY_LABEL, name: target.name })}
                                      className="underline decoration-dotted decoration-transparent underline-offset-2 hover:decoration-current [.ua-mod-held_&]:cursor-pointer [.ua-mod-held_&:hover]:decoration-solid [.ua-mod-held_&:hover]:text-accent"
                                    >
                                      {part}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                      {editingLine === lineNumber ? (
                        <LineNoteEditor
                          line={lineNumber}
                          initial={lineNote ?? ""}
                          gutterWidth={gutterWidth}
                          onSave={(note) => saveLineNote(lineNumber, note)}
                          onCancel={() => setEditingLine(null)}
                        />
                      ) : (
                        lineNote && (
                          <LineNoteView
                            line={lineNumber}
                            note={lineNote}
                            gutterWidth={gutterWidth}
                            onEdit={() => setEditingLine(lineNumber)}
                          />
                        )
                      )}
                      </Fragment>
                    );
                  })}
                </pre>
              )}
            </Highlight>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
