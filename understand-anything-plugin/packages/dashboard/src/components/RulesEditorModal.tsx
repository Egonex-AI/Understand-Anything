import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { useAnalysisStore } from "../analysisStore";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import { LAYER_PREFIX, evaluateRules, globToRegExp, parseRuleText, type ArchRule } from "../utils/archRules";

function selectorError(selector: string): string | null {
  const sel = selector.trim();
  if (!sel || sel.toLowerCase().startsWith(LAYER_PREFIX)) return null;
  try {
    globToRegExp(sel);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

let nextId = 0;
function newRuleId(existing: ArchRule[]): string {
  const ids = new Set(existing.map((r) => r.id));
  let id: string;
  do id = `rule-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
  while (ids.has(id));
  return id;
}

const input =
  "w-full bg-elevated text-text-primary text-xs font-mono rounded-md px-2 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50";

/** Modal editor for architecture rules ("from must not depend on to"). */
export default function RulesEditorModal() {
  const { t } = useI18n();
  const graph = useDashboardStore((s) => s.graph);
  const rules = useAnalysisStore((s) => s.rules);
  const storage = useAnalysisStore((s) => s.rulesStorage);
  const close = useAnalysisStore((s) => s.closeRulesEditor);
  const [draft, setDraft] = useState<ArchRule[]>(() => rules.map((r) => ({ ...r })));
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; error?: string }>({ kind: "idle" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // Live count per rule so users see the effect before saving.
  const counts = useMemo(() => {
    if (!graph) return new Map<string, number>();
    const valid = draft.filter((r) => r.from.trim() && r.to.trim() && !selectorError(r.from) && !selectorError(r.to));
    const result = evaluateRules(graph, valid);
    return new Map([...result.byRule].map(([id, v]) => [id, v.length]));
  }, [graph, draft]);

  const update = (id: string, patch: Partial<ArchRule>) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setStatus({ kind: "idle" });
  };

  const addRule = (from = "", to = "") => {
    setDraft((d) => [...d, { id: newRuleId(d), from, to, description: "", enabled: true }]);
    setStatus({ kind: "idle" });
  };

  const submitQuick = () => {
    const parsed = parseRuleText(quick);
    if (!parsed) {
      setQuickError(true);
      return;
    }
    addRule(parsed.from, parsed.to);
    setQuick("");
    setQuickError(false);
  };

  const hasErrors = draft.some((r) => selectorError(r.from) || selectorError(r.to));

  const save = async () => {
    setStatus({ kind: "saving" });
    const result = await useAnalysisStore.getState().saveRules(draft);
    setStatus(result.ok ? { kind: "saved" } : { kind: "error", error: result.error });
    if (result.ok) useAnalysisStore.getState().showViolations();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-root/80 backdrop-blur-sm p-4"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-editor-title"
        className="glass-heavy rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-fade-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="rules-editor"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <h2 id="rules-editor-title" className="font-heading text-xl text-text-primary">
            {t.analysis.rulesTitle}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t.analysis.close}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto min-h-0">
          <p className="text-xs text-text-secondary leading-relaxed">{t.analysis.rulesHelp}</p>
          {graph && graph.layers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="text-text-muted uppercase tracking-wider font-semibold">{t.analysis.layers}</span>
              {graph.layers.map((l) => (
                <code key={l.id} className="px-1.5 py-0.5 rounded bg-elevated border border-border-subtle text-text-secondary" title={l.name}>
                  {l.id.startsWith(LAYER_PREFIX) ? l.id : `${LAYER_PREFIX}${l.id}`}
                </code>
              ))}
            </div>
          )}

          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitQuick();
            }}
          >
            <div className="flex-1">
              <input
                value={quick}
                onChange={(e) => {
                  setQuick(e.target.value);
                  setQuickError(false);
                }}
                placeholder={t.analysis.quickAddPlaceholder}
                aria-label={t.analysis.quickAdd}
                className={input}
                data-testid="rule-quick-add"
              />
              {quickError && <p className="mt-1 text-[11px] text-[var(--color-violation)]">{t.analysis.quickAddInvalid}</p>}
            </div>
            <button
              type="submit"
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
            >
              {t.analysis.quickAdd}
            </button>
          </form>

          {draft.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">{t.analysis.noRules}</p>
          ) : (
            <ul className="space-y-2">
              {draft.map((rule) => {
                const fromErr = selectorError(rule.from);
                const toErr = selectorError(rule.to);
                const count = counts.get(rule.id) ?? 0;
                return (
                  <li key={rule.id} className="rounded-lg border border-border-subtle bg-surface/60 p-2.5 space-y-2" data-testid="rule-row">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                        aria-label={t.analysis.ruleEnabled}
                        title={t.analysis.ruleEnabled}
                        className="accent-[var(--color-accent)] shrink-0"
                      />
                      <input
                        value={rule.from}
                        onChange={(e) => update(rule.id, { from: e.target.value })}
                        placeholder="src/ui/**"
                        aria-label={t.analysis.ruleFrom}
                        className={`${input} ${fromErr ? "!border-[var(--color-violation)]" : ""}`}
                      />
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-violation)] whitespace-nowrap">
                        {t.analysis.mustNotDependOn}
                      </span>
                      <input
                        value={rule.to}
                        onChange={(e) => update(rule.id, { to: e.target.value })}
                        placeholder="src/db/**"
                        aria-label={t.analysis.ruleTo}
                        className={`${input} ${toErr ? "!border-[var(--color-violation)]" : ""}`}
                      />
                      <button
                        type="button"
                        onClick={() => setDraft((d) => d.filter((r) => r.id !== rule.id))}
                        aria-label={t.analysis.removeRule}
                        title={t.analysis.removeRule}
                        className="shrink-0 text-text-muted hover:text-[var(--color-violation)] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-2 pl-6">
                      <input
                        value={rule.description}
                        onChange={(e) => update(rule.id, { description: e.target.value })}
                        placeholder={t.analysis.ruleDescription}
                        aria-label={t.analysis.ruleDescription}
                        className={`${input} font-sans`}
                      />
                      <span
                        className={`shrink-0 text-[10px] font-mono ${
                          !rule.enabled ? "text-text-muted" : count > 0 ? "text-[var(--color-violation)]" : "text-node-function"
                        }`}
                      >
                        {rule.enabled ? fmt(t.analysis.violationCount, { n: count }) : t.analysis.ruleDisabled}
                      </span>
                    </div>
                    {(fromErr || toErr) && (
                      <p className="pl-6 text-[11px] text-[var(--color-violation)]">
                        {fmt(t.analysis.invalidSelector, { error: (fromErr ?? toErr) as string })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => addRule()}
            className="text-xs font-medium text-accent hover:text-accent-bright transition-colors"
          >
            + {t.analysis.addRule}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border-subtle shrink-0">
          <p className="text-[11px] text-text-muted min-w-0">
            {status.kind === "error"
              ? fmt(t.analysis.saveFailed, { error: status.error ?? "" })
              : storage === "local"
                ? t.analysis.rulesLocal
                : t.analysis.rulesFile}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {status.kind === "saved" && <span className="text-[11px] text-node-function">{t.analysis.saved}</span>}
            <button
              type="button"
              onClick={close}
              className="text-xs px-3 py-1.5 rounded-md border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
            >
              {t.analysis.close}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={hasErrors || status.kind === "saving"}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="rules-save"
            >
              {status.kind === "saving" ? t.analysis.saving : t.analysis.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
