import { useState } from "react";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { MOD_KEY_LABEL } from "../utils/codeNav";

/** A row under a source line, aligned past the gutter. */
function NoteRow({ gutterWidth, children }: { gutterWidth: number; children: React.ReactNode }) {
  return (
    <div className="flex font-sans">
      <span className="shrink-0 select-none border-r border-border-subtle bg-surface/60" style={{ width: gutterWidth }} />
      <div className="pl-3 pr-6 py-1 min-w-0">{children}</div>
    </div>
  );
}

/** A saved line note, shown inline under its line; click to edit. */
export function LineNoteView({
  line,
  note,
  gutterWidth,
  onEdit,
}: {
  line: number;
  note: string;
  gutterWidth: number;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  return (
    <NoteRow gutterWidth={gutterWidth}>
      <button
        type="button"
        onClick={onEdit}
        className="block max-w-xl text-left rounded-r border-l-2 border-accent bg-accent/10 hover:bg-accent/15 px-2.5 py-1 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words transition-colors"
        title={fmt(t.codeNav.editLineNote, { line })}
      >
        {note}
      </button>
    </NoteRow>
  );
}

/** Inline editor for one line's note. Saving an empty note deletes it. */
export function LineNoteEditor({
  line,
  initial,
  gutterWidth,
  onSave,
  onCancel,
}: {
  line: number;
  initial: string;
  gutterWidth: number;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  return (
    <NoteRow gutterWidth={gutterWidth}>
      <div className="w-[28rem] max-w-full rounded border border-accent/40 bg-elevated p-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Keep Esc from also closing the code viewer.
              e.stopPropagation();
              onCancel();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSave(draft);
            }
          }}
          rows={3}
          placeholder={fmt(t.codeNav.lineNotePlaceholder, { line })}
          aria-label={fmt(t.codeNav.lineNotePlaceholder, { line })}
          className="w-full resize-y rounded bg-surface border border-border-subtle px-2 py-1.5 text-[11px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60"
        />
        <div className="mt-1.5 flex items-center gap-2 text-[10px]">
          <span className="flex-1 text-text-muted">{fmt(t.codeNav.lineNoteHint, { mod: MOD_KEY_LABEL })}</span>
          {initial && (
            <button
              type="button"
              onClick={() => onSave("")}
              className="px-2 py-0.5 rounded text-text-muted hover:text-red-400 transition-colors"
            >
              {t.codeNav.deleteNote}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
          >
            {t.codeNav.cancel}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="px-2 py-0.5 rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
          >
            {t.codeNav.save}
          </button>
        </div>
      </div>
    </NoteRow>
  );
}
