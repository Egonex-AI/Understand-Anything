import type { KeyboardShortcut } from "../hooks/useKeyboardShortcuts";
import { formatShortcutKey } from "../hooks/useKeyboardShortcuts";
import { useI18n } from "../contexts/I18nContext";

interface KeyboardShortcutsHelpProps {
  shortcuts: KeyboardShortcut[];
  onClose: () => void;
}

export default function KeyboardShortcutsHelp({
  shortcuts,
  onClose,
}: KeyboardShortcutsHelpProps) {
  const { t } = useI18n();

  // Group shortcuts by category
  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  // Translate category names
  const categoryTranslations: Record<string, string> = {
    "General": t.keyboardShortcuts.general,
    "Navigation": t.keyboardShortcuts.navigation,
    "Tour": t.keyboardShortcuts.tour,
    "View": t.keyboardShortcuts.view,
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="glass rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 glass-heavy border-b border-border-subtle px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-heading text-text-primary">
              {t.keyboardShortcuts.title}
            </h2>
            <p className="text-xs text-text-muted mt-1">
              {t.keyboardShortcuts.toggleHint}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="p-6 space-y-6">
          {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-accent uppercase tracking-wider mb-3">
                {categoryTranslations[category] ?? category}
              </h3>
              <div className="space-y-2">
                {categoryShortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 rounded hover:bg-elevated transition-colors"
                  >
                    <span className="text-sm text-text-secondary">
                      {shortcut.description}
                    </span>
                    <kbd className="kbd">{formatShortcutKey(shortcut)}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 glass-heavy border-t border-border-subtle px-6 py-3 text-center">
          <p className="text-xs text-text-muted">
            {t.keyboardShortcuts.closeHint}
          </p>
        </div>
      </div>
    </div>
  );
}
