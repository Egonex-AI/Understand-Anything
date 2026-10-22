import { useEffect, useMemo, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodeLessonSection, CodeLessons } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";

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

// Module-level cache so the sidebar and modal CodeViewer instances (and
// repeat opens) share one /code-lessons.json fetch. Only successful loads are
// cached — a 404 (no lessons yet) is retried on the next file open so lessons
// generated after this page load still appear without a manual reload.
let lessonsCache: CodeLessons | null = null;
let lessonsPromise: Promise<CodeLessons | null> | null = null;

function fetchCodeLessons(token: string): Promise<CodeLessons | null> {
  if (lessonsCache) return Promise.resolve(lessonsCache);
  if (!lessonsPromise) {
    lessonsPromise = fetch(`/code-lessons.json?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as CodeLessons;
        if (data && typeof data === "object" && data.files && typeof data.files === "object") {
          lessonsCache = data;
          return data;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        lessonsPromise = null;
      });
  }
  return lessonsPromise;
}

function fileContentUrl(filePath: string, token: string): string {
  const params = new URLSearchParams({ token, path: filePath });
  return `/file-content.json?${params.toString()}`;
}

function fallbackLanguage(filePath: string | undefined): string {
  const ext = filePath?.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    css: "css",
    go: "go",
    html: "markup",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yaml: "yaml",
    yml: "yaml",
  };
  return ext ? byExt[ext] ?? "text" : "text";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rendered markdown view for .md files, styled for the dark theme. */
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="px-6 py-5 max-w-3xl text-sm text-text-secondary leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-xl font-heading text-text-primary mt-6 mb-3 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-heading text-text-primary mt-5 mb-2 first:mt-0 border-b border-border-subtle pb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-heading text-text-primary mt-4 mb-2 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-heading text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="text-sm font-heading text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h5>,
          h6: ({ children }) => <h6 className="text-xs font-heading text-text-primary mt-3 mb-1.5 first:mt-0 uppercase tracking-wider">{children}</h6>,
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/40 pl-3 text-text-muted italic mb-3">{children}</blockquote>
          ),
          hr: () => <hr className="border-border-subtle my-4" />,
          pre: ({ children }) => (
            <pre className="bg-elevated border border-border-subtle rounded-lg p-3 mb-3 overflow-x-auto text-xs font-mono">
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            const isInline = !className && !String(children).includes("\n");
            return isInline ? (
              <code className="bg-elevated px-1.5 py-0.5 rounded text-[0.85em] font-mono text-accent">{children}</code>
            ) : (
              <code className={className}>{children}</code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border-subtle bg-elevated px-2.5 py-1.5 text-left text-text-primary font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-border-subtle px-2.5 py-1.5">{children}</td>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} className="max-w-full rounded-lg border border-border-subtle my-2" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Compact markdown view for lesson explanations, styled for the dark theme. */
function LessonMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-text-primary">{children}</strong>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          return isBlock ? (
            <code className="block bg-elevated rounded px-2 py-1.5 mb-1.5 overflow-x-auto text-[11px] leading-relaxed">
              {children}
            </code>
          ) : (
            <code className="bg-elevated rounded px-1 py-0.5 text-[11px] text-accent">{children}</code>
          );
        },
        ul: ({ children }) => (
          <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
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
  // Per-file learning explanations from the project data directory
  // (.ua/code-lessons.json), aligned with the guided tour.
  const [lessons, setLessons] = useState<CodeLessons | null>(null);
  // Line range selected from a lesson section — takes precedence over the
  // node's own lineRange highlight until deselected or the file changes.
  const [lessonHighlight, setLessonHighlight] = useState<{ start: number; end: number } | null>(null);
  const codeScrollRef = useRef<HTMLDivElement | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (accessToken === "__demo__") return;
    let cancelled = false;
    fetchCodeLessons(accessToken).then((data) => {
      if (!cancelled) setLessons(data);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

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
    setLessonHighlight(null);

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

  const lesson = node?.filePath ? lessons?.files[node.filePath] ?? null : null;
  // A lesson-section selection overrides the node's own lineRange highlight.
  const highlightedRange = useMemo(() => {
    if (lessonHighlight) return lessonHighlight;
    if (!node?.lineRange) return null;
    return { start: node.lineRange[0], end: node.lineRange[1] };
  }, [lessonHighlight, node?.lineRange]);

  const scrollToLine = (line: number) => {
    codeScrollRef.current
      ?.querySelector(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">{t.codeViewer.noFile}</p>
      </div>
    );
  }

  const source = state.source;
  const language = source?.language ?? fallbackLanguage(node.filePath);
  const isMarkdown = language === "markdown";
  const showRendered = isMarkdown && mdView === "rendered";
  const lineInfo = highlightedRange
    ? `${t.codeViewer.lines} ${highlightedRange.start}-${highlightedRange.end}`
    : t.codeViewer.fullFile;
  const isModal = presentation === "modal";
  const handleClose = onClose ?? closeCodeViewer;

  const toggleSection = (section: CodeLessonSection) => {
    const [start, end] = section.lineRange;
    if (lessonHighlight && lessonHighlight.start === start && lessonHighlight.end === end) {
      setLessonHighlight(null);
      return;
    }
    setLessonHighlight({ start, end });
    if (!showRendered) scrollToLine(start);
  };

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
            <div className="text-[11px] font-mono text-text-muted truncate mt-0.5" title={node.filePath}>
              {node.filePath}
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

      <div className="flex-1 min-h-0 flex overflow-hidden bg-root">
        <div ref={codeScrollRef} className="flex-1 min-w-0 overflow-auto">
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
                <span>{source.lineCount} {t.codeViewer.linesLabel}</span>
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
              <Highlight code={source.content} language={language} theme={themes.vsDark}>
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                  <pre
                    className={`${className} min-w-max p-0 m-0 ${
                      isModal ? "text-xs leading-5" : "text-[11px] leading-5"
                    } font-mono`}
                    style={{ ...style, background: "transparent" }}
                  >
                    {tokens.map((line, index) => {
                      const lineNumber = index + 1;
                      const isHighlighted =
                        highlightedRange !== null &&
                        lineNumber >= highlightedRange.start &&
                        lineNumber <= highlightedRange.end;
                      const lineProps = getLineProps({ line });
                      return (
                        <div
                          key={lineNumber}
                          {...lineProps}
                          data-line={lineNumber}
                          className={`${lineProps.className} flex ${
                            isHighlighted ? "bg-accent/15" : "hover:bg-elevated/40"
                          }`}
                        >
                          <span className="w-12 shrink-0 select-none border-r border-border-subtle pr-3 text-right text-text-muted bg-surface/60">
                            {lineNumber}
                          </span>
                          <span className="pl-3 pr-6 whitespace-pre">
                            {line.map((token, key) => (
                              <span key={key} {...getTokenProps({ token })} />
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </pre>
                )}
              </Highlight>
              )}
            </>
          )}
        </div>

        {lesson && (
          <aside className="w-72 xl:w-80 shrink-0 border-l border-border-subtle bg-surface overflow-y-auto">
            <div className="sticky top-0 z-10 px-4 py-2.5 bg-surface border-b border-border-subtle">
              <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
                {t.codeViewer.lesson}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-text-secondary leading-relaxed">
                <LessonMarkdown content={lesson.overview} />
              </div>

              {lesson.sections.length > 0 && (
                <div className="space-y-2">
                  {lesson.sections.map((section, i) => {
                    const [start, end] = section.lineRange;
                    const active =
                      lessonHighlight !== null &&
                      lessonHighlight.start === start &&
                      lessonHighlight.end === end;
                    return (
                      <div
                        key={i}
                        className={`rounded-lg border transition-colors ${
                          active
                            ? "border-accent/40 bg-accent/5"
                            : "border-border-subtle bg-elevated hover:border-accent/20"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSection(section)}
                          aria-pressed={active}
                          className="w-full text-left px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-primary flex-1 min-w-0 truncate">
                              {section.title}
                            </span>
                            {section.tourOrder !== undefined && (
                              <span className="text-[9px] font-semibold uppercase tracking-wider text-accent border border-accent/30 rounded px-1 py-0.5 shrink-0">
                                {t.codeViewer.tourStep} {section.tourOrder}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-text-muted mt-0.5">
                            {t.codeViewer.lines} {start}–{end}
                          </div>
                        </button>
                        {active && (
                          <div className="px-3 pb-2.5 pt-2 border-t border-border-subtle/60 text-xs text-text-secondary leading-relaxed">
                            <LessonMarkdown content={section.explanation} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {lesson.sections.length === 0 && (
                <p className="text-[11px] text-text-muted">{t.codeViewer.overviewOnly}</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
