import { useEffect, useMemo, useRef, useState } from "react";
import { useAnnotationsStore } from "../annotationsStore";
import { useDashboardStore } from "../store";
import { myTourLabels, playMyTour, useMyTourStore } from "../myTourStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { collectTags, orderAnnotatedNodes, type AnnotatedOrder, type AnnotationMap } from "../utils/annotatedNodes";

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

/** Builds a personal tour from annotated nodes: filter by tag, pick an order, reorder, play. */
export default function MyTourDialog() {
  const { t } = useI18n();
  const n = t.notesTools;
  const graph = useDashboardStore((s) => s.graph);
  const annotations = useAnnotationsStore((s) => s.annotations) as AnnotationMap;
  const initialTag = useMyTourStore((s) => s.builder?.tag ?? null);
  const closeBuilder = useMyTourStore((s) => s.closeBuilder);

  const [tag, setTag] = useState<string | null>(initialTag);
  const [order, setOrder] = useState<AnnotatedOrder>("graph");
  // Manual edits (reorder/remove); null = the computed order.
  const [manualIds, setManualIds] = useState<string[] | null>(null);

  const tags = useMemo(() => collectTags(annotations), [annotations]);
  const computedIds = useMemo(
    () => (graph ? orderAnnotatedNodes(graph, annotations, { order, tag }) : []),
    [graph, annotations, order, tag],
  );
  const ids = manualIds ?? computedIds;
  const nodesById = useDashboardStore((s) => s.nodesById);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => dialogRef.current?.focus(), []);

  const move = (index: number, delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setManualIds(next);
  };

  const start = () => {
    if (playMyTour(ids, myTourLabels(t))) closeBuilder();
  };

  const selectClass = "w-full bg-elevated border border-border-subtle rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={closeBuilder}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={n.myTour}
        data-testid="my-tour-dialog"
        className="w-full max-w-[560px] max-h-[min(720px,calc(100vh-32px))] flex flex-col rounded-xl border border-border-medium bg-surface shadow-2xl overflow-hidden focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeBuilder();
          }
        }}
      >
        <div className="px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="text-sm font-heading text-text-primary">{n.myTour}</div>
          <p className="text-[11px] text-text-muted mt-0.5">{n.dialogSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent mb-1">{n.tagFilter}</span>
            <select
              className={selectClass}
              value={tag ?? ""}
              data-testid="my-tour-tag"
              onChange={(e) => {
                setTag(e.target.value || null);
                setManualIds(null);
              }}
            >
              <option value="">{n.allAnnotated}</option>
              {tags.map((tg) => (
                <option key={tg} value={tg}>#{tg}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent mb-1">{n.order}</span>
            <select
              className={selectClass}
              value={order}
              data-testid="my-tour-order"
              onChange={(e) => {
                setOrder(e.target.value as AnnotatedOrder);
                setManualIds(null);
              }}
            >
              <option value="graph">{n.orderGraph}</option>
              <option value="recent">{n.orderRecent}</option>
              <option value="oldest">{n.orderOldest}</option>
            </select>
          </label>
        </div>

        <ol className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1.5" data-testid="my-tour-steps">
          {ids.length === 0 && <li className="text-xs text-text-muted text-center py-6">{n.empty}</li>}
          {ids.map((id, i) => {
            const node = nodesById.get(id);
            const a = annotations[id];
            const preview = a?.note.trim().split("\n")[0] ?? "";
            return (
              <li key={id} className="flex items-start gap-2 bg-elevated rounded-lg px-3 py-2 border border-border-subtle">
                <span className="text-accent font-mono text-xs shrink-0 mt-0.5 w-5 text-right">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-text-primary truncate">{node?.name ?? id}</span>
                    {node && <span className="text-[10px] text-text-muted shrink-0">{node.type}</span>}
                  </div>
                  {preview && <div className="text-[11px] text-text-secondary truncate mt-0.5">{preview}</div>}
                  {a && a.tags.length > 0 && (
                    <div className="text-[10px] text-text-muted truncate mt-0.5">{a.tags.map((tg) => `#${tg}`).join(" ")}</div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <IconButton label={n.moveUp} onClick={() => move(i, -1)} disabled={i === 0}>↑</IconButton>
                  <IconButton label={n.moveDown} onClick={() => move(i, 1)} disabled={i === ids.length - 1}>↓</IconButton>
                  <IconButton label={n.remove} onClick={() => setManualIds(ids.filter((x) => x !== id))}>✕</IconButton>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          {manualIds && (
            <button
              type="button"
              onClick={() => setManualIds(null)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {n.reset}
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={closeBuilder}
            className="text-xs bg-elevated text-text-secondary px-3 py-1.5 rounded-lg hover:bg-surface transition-colors"
          >
            {n.cancel}
          </button>
          <button
            type="button"
            onClick={start}
            disabled={ids.length === 0}
            data-testid="my-tour-start"
            className="text-xs bg-accent/10 border border-accent/30 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {fmt(n.startMyTour, { count: ids.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
