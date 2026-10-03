import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore, type AiDialogView } from "../store";
import { useAnnotationsStore } from "../annotationsStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { fetchAiConfig, streamAiChat, type PublicAiConfig } from "../ai/aiClient";
import { toMessages, type Turn } from "../ai/conversation";
import { buildNodeContext, buildSystemPrompt } from "../ai/buildNodeContext";
import MarkdownContent from "./MarkdownContent";
import AiSettingsForm from "./AiSettingsForm";

function useFileSource(accessToken: string, filePath: string | undefined): string | null | undefined {
  const [source, setSource] = useState<{ path: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!filePath || accessToken === "__demo__") return;
    let cancelled = false;
    const params = new URLSearchParams({ token: accessToken, path: filePath });
    fetch(`/file-content.json?${params.toString()}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ content?: string }>) : null))
      .then((data) => !cancelled && setSource({ path: filePath, text: data?.content ?? null }))
      .catch(() => !cancelled && setSource({ path: filePath, text: null }));
    return () => {
      cancelled = true;
    };
  }, [accessToken, filePath]);
  if (!filePath || accessToken === "__demo__") return null;
  return source?.path === filePath ? source.text : undefined; // undefined = still loading
}

function SmallButton({ onClick, children, testId }: { onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-border-subtle text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
    >
      {children}
    </button>
  );
}

function FlashButton({ label, doneLabel, onClick, testId }: { label: string; doneLabel: string; onClick: () => void; testId?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(timer);
  }, [done]);
  return (
    <SmallButton
      testId={testId}
      onClick={() => {
        onClick();
        setDone(true);
      }}
    >
      {done ? doneLabel : label}
    </SmallButton>
  );
}

/**
 * Chat with any configured model about one graph node. The node's summary,
 * relationships and source excerpt go along with the first question.
 */
export default function AskAiDialog({ accessToken }: { accessToken: string }) {
  const { t, localeKey } = useI18n();
  const a = t.ai;
  const dialog = useDashboardStore((s) => s.aiDialog);
  const closeAiDialog = useDashboardStore((s) => s.closeAiDialog);
  const graph = useDashboardStore((s) => s.graph);
  const node = useDashboardStore((s) => (s.aiDialog?.nodeId ? s.nodesById.get(s.aiDialog.nodeId) : undefined));
  const annotation = useAnnotationsStore((s) => (node ? s.annotations[node.id] : undefined));

  // undefined = loading, null = no backend (demo / viewer)
  const [config, setConfig] = useState<PublicAiConfig | null | undefined>(undefined);
  const [view, setView] = useState<AiDialogView>(dialog?.view ?? "chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  // The context sent with the first question, reused for follow-ups so a
  // mid-chat note edit (e.g. "save to notes") doesn't rewrite history.
  const sentContextRef = useRef("");
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const source = useFileSource(accessToken, node?.filePath);

  useEffect(() => {
    let cancelled = false;
    void fetchAiConfig(accessToken).then((c) => !cancelled && setConfig(c));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // A different node (or the settings command) starts over.
  useEffect(() => {
    abortRef.current?.abort();
    setTurns([]);
    setDraft("");
    setView(dialog?.view ?? "chat");
  }, [dialog?.nodeId, dialog?.view]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const showSettings = config !== undefined && config !== null && (view !== "chat" || !config.configured || !node);

  useEffect(() => {
    if (config && !showSettings) inputRef.current?.focus();
  }, [config, showSettings]);

  const context = useMemo(() => {
    if (!graph || !node) return "";
    return buildNodeContext({
      graph,
      node,
      source: source ?? null,
      userNote: annotation?.note,
      userTags: annotation?.tags,
      localeKey,
    });
  }, [graph, node, source, annotation, localeKey]);
  const system = useMemo(() => buildSystemPrompt(localeKey), [localeKey]);

  const busy = turns.some((turn) => turn.status === "streaming");

  const ask = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || busy || !config?.configured || source === undefined) return;
      if (turns.length === 0) sentContextRef.current = context;
      const history = [...turns, { question: q, answer: "", status: "streaming" as const }];
      const index = history.length - 1;
      setTurns(history);
      setDraft("");
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (p: Partial<Turn> | ((turn: Turn) => Partial<Turn>)) =>
        setTurns((all) =>
          all.map((turn, i) => (i === index ? { ...turn, ...(typeof p === "function" ? p(turn) : p) } : turn)),
        );
      streamAiChat(
        accessToken,
        { system, messages: toMessages(sentContextRef.current, history) },
        (delta) => patch((turn) => ({ answer: turn.answer + delta })),
        controller.signal,
      )
        .then((done) => patch({ status: "done", stopReason: done.stopReason, servedBy: done.servedBy }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) patch({ status: "stopped" });
          else patch({ status: "error", error: err instanceof Error ? err.message : String(err) });
        });
    },
    [accessToken, busy, config, context, system, turns, source],
  );

  const saveToNotes = (answer: string) => {
    if (!node) return;
    const store = useAnnotationsStore.getState();
    const current = store.annotations[node.id]?.note ?? "";
    const heading = fmt(a.noteHeading, { date: new Date().toLocaleString() });
    store.setNote(node.id, `${current.trim() ? `${current.trimEnd()}\n\n` : ""}### ${heading}\n\n${answer.trim()}`);
  };

  const fullPrompt = (question: string) =>
    `${system}\n\n---\n\n${context}\n\n# Question\n${question.trim() || a.quickExplain}`;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(draft);
    }
  };

  if (!dialog) return null;
  const quickPrompts = [a.quickExplain, a.quickUsage, a.quickRisks, a.quickTests];
  const modelLabel = config?.model || "AI";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={closeAiDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={a.ask}
        data-testid="ask-ai-dialog"
        className="w-full max-w-[780px] h-[min(820px,calc(100vh-32px))] flex flex-col rounded-xl border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeAiDialog();
          }
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="text-accent text-sm">✦</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-heading text-text-primary truncate">
              {node ? `${a.ask} · ${node.name}` : a.settings}
            </div>
            {node?.filePath && <div className="text-[11px] font-mono text-text-muted truncate">{node.filePath}</div>}
          </div>
          {config?.configured && node && (
            <span className="hidden sm:inline text-[10px] font-mono text-text-muted border border-border-subtle rounded px-1.5 py-0.5 max-w-[180px] truncate">
              {modelLabel}
            </span>
          )}
          {turns.length > 0 && !showSettings && (
            <SmallButton onClick={() => setTurns([])}>{a.newChat}</SmallButton>
          )}
          {config && node && (
            <button
              type="button"
              onClick={() => setView(view === "chat" ? "settings" : "chat")}
              title={a.settings}
              aria-label={a.settings}
              data-testid="ai-settings-toggle"
              className={`p-1 rounded hover:bg-elevated ${showSettings ? "text-accent" : "text-text-muted hover:text-text-primary"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.3 4.3c.4-1.7 3-1.7 3.4 0a1.7 1.7 0 002.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 001 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 00-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 00-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 00-2.5-1c-1.6.9-3.3-.9-2.4-2.4a1.7 1.7 0 00-1.1-2.6c-1.7-.4-1.7-3 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4 1 .6 2.3.1 2.5-1.1z" />
                <circle cx="12" cy="12" r="3" strokeWidth={2} />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={closeAiDialog}
            title={a.close}
            aria-label={a.close}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-elevated"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {config === undefined && (
          <div className="flex-1 flex items-center justify-center text-sm text-text-muted">{a.loadingConfig}</div>
        )}

        {config === null && (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            <p className="text-sm text-text-secondary leading-relaxed">{a.noBackend}</p>
            {node && (
              <>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={a.quickExplain}
                  rows={3}
                  className="w-full bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50 resize-none"
                />
                <FlashButton
                  label={a.copyPrompt}
                  doneLabel={a.copied}
                  onClick={() => void navigator.clipboard?.writeText(fullPrompt(draft))}
                />
              </>
            )}
          </div>
        )}

        {showSettings && config && (
          <div className="flex-1 overflow-auto p-5">
            {!config.configured && <p className="text-sm text-text-secondary mb-4">{a.notConfigured}</p>}
            <AiSettingsForm
              accessToken={accessToken}
              config={config}
              expandEmbeddings={view === "embeddings"}
              onSaved={(saved) => {
                setConfig(saved);
                if (saved.configured && node) setView("chat");
              }}
              onCancel={config.configured && node ? () => setView("chat") : undefined}
            />
          </div>
        )}

        {config && !showSettings && node && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-4 space-y-5" data-testid="ai-transcript">
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] text-text-muted">{fmt(a.contextNote, { model: modelLabel })}</p>
                  <div className="flex flex-wrap gap-2">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => ask(prompt)}
                        disabled={source === undefined}
                        className="text-xs text-left px-3 py-1.5 rounded-lg border border-border-subtle bg-elevated/60 text-text-secondary hover:text-accent hover:border-accent/40 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((turn, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap">
                      {turn.question}
                    </div>
                  </div>
                  <div className="text-sm text-text-secondary leading-relaxed" data-testid="ai-answer">
                    {turn.answer ? (
                      <MarkdownContent content={turn.answer} />
                    ) : (
                      turn.status === "streaming" && <span className="text-text-muted animate-pulse">{a.thinking}</span>
                    )}
                  </div>
                  {turn.status === "error" && <p className="text-xs text-red-400">{turn.error}</p>}
                  {turn.status === "stopped" && <p className="text-xs text-text-muted">{a.stopped}</p>}
                  {turn.stopReason === "max_tokens" || turn.stopReason === "length" ? (
                    <p className="text-xs text-amber-400">{a.truncated}</p>
                  ) : null}
                  {turn.status !== "streaming" && turn.answer && (
                    <div className="flex items-center gap-2">
                      <FlashButton
                        label={a.copy}
                        doneLabel={a.copied}
                        onClick={() => void navigator.clipboard?.writeText(turn.answer)}
                      />
                      <FlashButton
                        label={a.saveToNotes}
                        doneLabel={a.savedToNotes}
                        onClick={() => saveToNotes(turn.answer)}
                        testId="ai-save-note"
                      />
                      {turn.servedBy && turn.servedBy !== config.model && (
                        <span className="text-[10px] font-mono text-text-muted">
                          {fmt(a.servedBy, { model: turn.servedBy })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-border-subtle p-3 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={a.placeholder}
                  rows={2}
                  data-testid="ai-input"
                  className="flex-1 bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50 resize-none"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="px-3 py-2 rounded-lg text-xs font-semibold border border-border-medium text-text-secondary hover:text-text-primary"
                  >
                    {a.stop}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => ask(draft)}
                    disabled={!draft.trim() || source === undefined}
                    data-testid="ai-send"
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-40"
                  >
                    {a.send}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
