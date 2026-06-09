import { useEffect, useMemo, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { useDashboardStore } from "../store";

interface WikiSourceResponse {
  file: string;
  displayPath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  lineCount: number;
  sizeBytes: number;
}

type PanelState =
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: WikiSourceResponse; error: null }
  | { status: "error"; data: null; error: string };

function wikiSourceUrl(
  file: string,
  lineRange: [number, number] | undefined,
  service?: string | null,
): string {
  const params = new URLSearchParams({ file, mode: "wiki" });
  if (service) params.set("service", service);
  if (lineRange) {
    params.set("start", String(lineRange[0]));
    params.set("end", String(lineRange[1]));
  }
  return `/api/source?${params.toString()}`;
}

export function WikiSourcePanel({
  path,
  lineRange,
  service,
  onClose,
}: {
  path: string;
  lineRange?: [number, number];
  service?: string | null;
  onClose: () => void;
}) {
  const storeService = useDashboardStore((s) => s.activeService);
  const activeService = service ?? storeService;
  const [state, setState] = useState<PanelState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });

    fetch(wikiSourceUrl(path, lineRange, activeService), { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as WikiSourceResponse | { error?: string };
        if (!res.ok) {
          throw new Error("error" in data && data.error ? data.error : "Source unavailable");
        }
        setState({ status: "loaded", data: data as WikiSourceResponse, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => controller.abort();
  }, [path, lineRange, activeService]);

  const highlightRange = useMemo(() => {
    if (state.status !== "loaded") return null;
    return { start: state.data.startLine, end: state.data.endLine };
  }, [state]);

  const headerLine =
    lineRange != null
      ? `${path}:${lineRange[0]}-${lineRange[1]}`
      : path;

  return (
    <div className="w-full h-full bg-surface flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 bg-elevated">
        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span className="text-xs text-text-primary truncate flex-1 font-mono" title={headerLine}>
          {headerLine}
        </span>
        {lineRange && (
          <span className="text-[10px] text-text-muted shrink-0 bg-surface px-2 py-0.5 rounded">
            Lines {lineRange[0]}–{lineRange[1]}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors shrink-0 p-1 rounded hover:bg-surface"
          aria-label="Close source panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-root">
        {state.status === "loading" && (
          <div className="p-3 text-xs text-text-muted">Loading source...</div>
        )}

        {state.status === "error" && (
          <div className="p-3 text-xs text-text-secondary">{state.error}</div>
        )}

        {state.status === "loaded" && (
          <Highlight
            code={state.data.content}
            language={state.data.language}
            theme={themes.vsDark}
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={`${className} min-w-max p-0 m-0 text-[11px] leading-5 font-mono`}
                style={{ ...style, background: "transparent" }}
              >
                {tokens.map((line, index) => {
                  const lineNumber = state.data.startLine + index;
                  const isHighlighted =
                    highlightRange !== null &&
                    lineNumber >= highlightRange.start &&
                    lineNumber <= highlightRange.end;
                  const lineProps = getLineProps({ line });
                  return (
                    <div
                      key={lineNumber}
                      {...lineProps}
                      className={`${lineProps.className} flex ${
                        isHighlighted ? "bg-accent/15" : "hover:bg-elevated/40"
                      }`}
                    >
                      <span className="w-10 shrink-0 select-none border-r border-border-subtle pr-2 text-right text-text-muted bg-surface/60">
                        {lineNumber}
                      </span>
                      <span className="pl-2 pr-4 whitespace-pre">
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
      </div>
    </div>
  );
}
