import { useAnnotationsStore } from "../annotationsStore";
import { useDashboardStore } from "../store";
import { useMyTourStore } from "../myTourStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";

/** Opens the "My tour" builder; renders nothing until some node of this graph is annotated. */
export default function MyTourButton({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const nodesById = useDashboardStore((s) => s.nodesById);
  const count = useAnnotationsStore((s) => Object.keys(s.annotations).filter((id) => nodesById.has(id)).length);
  const openBuilder = useMyTourStore((s) => s.openBuilder);
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openBuilder(null)}
      data-testid="my-tour-button"
      className={`w-full flex items-center justify-between gap-2 border border-border-subtle bg-elevated text-text-secondary text-sm py-2 px-4 rounded-lg hover:text-accent hover:border-accent/40 transition-colors ${className}`}
    >
      <span>{t.notesTools.myTourButton}</span>
      <span className="text-[11px] text-text-muted">{fmt(t.notesTools.myTourCount, { count })}</span>
    </button>
  );
}
