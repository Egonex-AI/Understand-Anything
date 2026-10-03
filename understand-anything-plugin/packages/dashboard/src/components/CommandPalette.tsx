import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { fuzzyScore } from "../utils/fuzzyMatch";
import { MIN_CONTENT_QUERY_LENGTH } from "../hooks/useContentSearch";

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words that should match (e.g. English aliases for a translated label). */
  keywords?: string;
  /** Shortcut hint shown on the right, e.g. "D". */
  hint?: string;
  run: () => void;
}

type Item =
  | { kind: "command"; key: string; label: string; hint?: string; run: () => void }
  | { kind: "node"; key: string; label: string; detail: string; type: string; run: () => void }
  | { kind: "file"; key: string; label: string; detail: string; run: () => void }
  | { kind: "code"; key: string; label: string; run: () => void };

const MAX_PER_GROUP = 6;

/**
 * Ctrl/⌘+K palette: one box for commands, graph nodes, files and a jump
 * into full-text code search.
 */
export default function CommandPalette({
  onClose,
  commands,
}: {
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  const { t } = useI18n();
  const graph = useDashboardStore((s) => s.graph);
  const searchEngine = useDashboardStore((s) => s.searchEngine);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const fileNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => n.type === "file" && n.filePath),
    [graph],
  );

  const groups = useMemo(() => {
    const q = query.trim();
    const run = (fn: () => void) => () => {
      onClose();
      fn();
    };

    let commandLabelHit = false;
    const commandItems: Item[] = commands
      .map((c) => {
        if (!q) return { c, score: 0 };
        // The label wins; keywords only rescue commands the label misses.
        const byLabel = fuzzyScore(q, c.label);
        const byKeywords = c.keywords ? fuzzyScore(q, `${c.label} ${c.keywords}`) : -1;
        if (byLabel >= 0) commandLabelHit = true;
        return { c, score: byLabel >= 0 ? byLabel + 10 : byKeywords };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, q ? MAX_PER_GROUP : commands.length)
      .map(({ c }) => ({ kind: "command", key: `cmd:${c.id}`, label: c.label, hint: c.hint, run: run(c.run) }));

    if (!q) return [{ title: t.palette.commands, items: commandItems }];

    const s = useDashboardStore.getState();
    const nodeItems: Item[] = (searchEngine?.search(q, { limit: MAX_PER_GROUP }) ?? [])
      .map((r) => s.nodesById.get(r.nodeId))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({
        kind: "node",
        key: `node:${n.id}`,
        label: n.name,
        detail: n.filePath ?? n.summary,
        type: n.type,
        run: run(() => useDashboardStore.getState().navigateToNodeInLayer(n.id)),
      }));

    const fileItems: Item[] = fileNodes
      .map((n) => ({ n, score: fuzzyScore(q, n.filePath!) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_GROUP)
      .map(({ n }) => ({
        kind: "file",
        key: `file:${n.id}`,
        label: n.filePath!.split("/").pop() ?? n.filePath!,
        detail: n.filePath!,
        run: run(() => {
          const st = useDashboardStore.getState();
          st.navigateToNode(n.id);
          st.openCodeViewer(n.id);
        }),
      }));

    const codeItems: Item[] =
      q.length >= MIN_CONTENT_QUERY_LENGTH
        ? [
            {
              kind: "code",
              key: "code-search",
              label: fmt(t.palette.searchCode, { q }),
              run: run(() => {
                const st = useDashboardStore.getState();
                st.setSearchMode("content");
                st.setSearchQuery(q);
                document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
              }),
            },
          ]
        : [];

    const commandGroup = { title: t.palette.commands, items: commandItems };
    // A query that names a command ("theme light") should run it on Enter.
    return [
      ...(commandLabelHit ? [commandGroup] : []),
      { title: t.palette.files, items: fileItems },
      { title: t.palette.nodes, items: nodeItems },
      ...(commandLabelHit ? [] : [commandGroup]),
      { title: t.palette.code, items: codeItems },
    ].filter((g) => g.items.length > 0);
  }, [query, commands, searchEngine, fileNodes, onClose, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.run();
    }
  };

  let index = -1;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh] px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-xl border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t.palette.placeholder}
      >
        <div className="flex items-center gap-2 px-4 border-b border-border-subtle">
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.palette.placeholder}
            className="flex-1 bg-transparent py-3.5 text-sm text-text-primary placeholder-text-muted focus:outline-none"
            data-testid="palette-input"
          />
          <kbd className="text-[10px] text-text-muted border border-border-subtle rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-auto py-1">
          {flat.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-text-muted">{t.palette.noResults}</div>
          )}
          {groups.map((group) => (
            <div key={group.title} className="py-1">
              <div className="px-4 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {group.title}
              </div>
              {group.items.map((item) => {
                index++;
                const i = index;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-index={i}
                    onClick={item.run}
                    onMouseMove={() => setActive(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left ${
                      i === active ? "bg-accent/10" : ""
                    }`}
                  >
                    {item.kind === "node" && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-accent/80 w-14 shrink-0 truncate">
                        {item.type}
                      </span>
                    )}
                    {item.kind === "file" && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-node-file w-14 shrink-0">
                        file
                      </span>
                    )}
                    {item.kind === "command" && <span className="text-accent w-14 shrink-0 text-xs">›</span>}
                    {item.kind === "code" && <span className="text-accent w-14 shrink-0 text-xs font-mono">{"{ }"}</span>}
                    <span className="text-sm text-text-primary truncate">{item.label}</span>
                    {"detail" in item && (
                      <span className="text-[11px] font-mono text-text-muted truncate flex-1 min-w-0">{item.detail}</span>
                    )}
                    {item.kind === "command" && item.hint && (
                      <kbd className="ml-auto text-[10px] text-text-muted border border-border-subtle rounded px-1.5 py-0.5 shrink-0">
                        {item.hint}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border-subtle text-[10px] text-text-muted">{t.palette.hint}</div>
      </div>
    </div>
  );
}
