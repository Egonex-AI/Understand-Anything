import { useEffect, useRef, useState } from "react";
import { useAnnotationsStore } from "../annotationsStore";
import { useI18n } from "../contexts/I18nContext";

const EMPTY_TAGS: string[] = [];

/**
 * The node's Tags section: analyzer tags (read-only) followed by the user's
 * own tags (removable) and a small "+" pill to add more.
 */
export function NodeTagsSection({ nodeId, graphTags }: { nodeId: string; graphTags: string[] }) {
  const userTags = useAnnotationsStore((s) => s.annotations[nodeId]?.tags ?? EMPTY_TAGS);
  const setTags = useAnnotationsStore((s) => s.setTags);
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAdding(false);
    setDraft("");
  }, [nodeId]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = (keepOpen: boolean) => {
    const parts = draft.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) setTags(nodeId, [...userTags, ...parts]);
    setDraft("");
    if (!keepOpen) setAdding(false);
  };

  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
        {t.common.tags}
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {graphTags.map((tag) => (
          <span key={`g:${tag}`} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
            {tag}
          </span>
        ))}
        {userTags.map((tag) => (
          <span
            key={`u:${tag}`}
            className="group inline-flex items-center gap-1 text-[11px] text-accent bg-accent/10 border border-accent/30 pl-2.5 pr-1.5 py-1 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => setTags(nodeId, userTags.filter((x) => x !== tag))}
              className="opacity-40 group-hover:opacity-100 hover:text-accent-bright transition-opacity leading-none"
              title={t.annotations.removeTag}
              aria-label={`${t.annotations.removeTag}: ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(true);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => commit(false)}
            placeholder={t.annotations.tagPlaceholder}
            className="text-[11px] w-28 bg-elevated text-text-primary px-2.5 py-1 rounded-full border border-accent/40 focus:outline-none placeholder-text-muted"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] text-text-muted hover:text-accent px-2 py-1 rounded-full border border-dashed border-border-medium hover:border-accent/40 transition-colors leading-none"
            title={t.annotations.addTag}
            aria-label={t.annotations.addTag}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

/** The user's free-form note for a node: a one-line "add" link until there is one. */
export function NodeNotesSection({ nodeId }: { nodeId: string }) {
  const note = useAnnotationsStore((s) => s.annotations[nodeId]?.note ?? "");
  const storage = useAnnotationsStore((s) => s.storage);
  const setNote = useAnnotationsStore((s) => s.setNote);
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditing(false);
  }, [nodeId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // Grow with the content, up to a cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft, editing]);

  const startEditing = () => {
    setDraft(note);
    setEditing(true);
  };
  const save = () => {
    if (draft !== note) setNote(nodeId, draft);
    setEditing(false);
  };

  if (!editing && !note.trim()) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="mb-4 -mt-1 text-[11px] text-text-muted hover:text-accent transition-colors"
      >
        + {t.annotations.addNote}
      </button>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
          {t.annotations.notes}
        </h3>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="text-[10px] text-text-muted hover:text-accent transition-colors"
          >
            {t.annotations.edit}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            rows={3}
            placeholder={t.annotations.notePlaceholder}
            className="w-full resize-none text-sm leading-relaxed bg-elevated text-text-primary rounded-lg p-3 border border-accent/40 focus:outline-none placeholder-text-muted"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <span className="flex-1 text-[10px] text-text-muted truncate">
              {storage === "server" ? t.annotations.savedToProject : t.annotations.savedInBrowser}
            </span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded text-text-muted hover:text-text-primary transition-colors"
            >
              {t.annotations.cancel}
            </button>
            <button
              type="button"
              onClick={save}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
            >
              {t.annotations.save}
            </button>
          </div>
        </div>
      ) : (
        <div
          onDoubleClick={startEditing}
          className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-elevated/60 p-3"
        >
          {note}
        </div>
      )}
    </div>
  );
}
