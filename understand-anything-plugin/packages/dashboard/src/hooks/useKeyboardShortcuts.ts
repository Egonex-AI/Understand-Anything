import { useEffect } from "react";

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  description: string;
  action: () => void;
  category: string;
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent shortcuts from firing when typing in input fields
      const target = event.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
        if (event.key !== 'Escape') return;
      }

      for (const shortcut of shortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrlKey ? event.ctrlKey : !event.ctrlKey;
        const shiftMatches = shortcut.shiftKey ? event.shiftKey : !event.shiftKey;
        const altMatches = shortcut.altKey ? event.altKey : !event.altKey;
        const metaMatches = shortcut.metaKey ? event.metaKey : !event.metaKey;

        if (keyMatches && ctrlMatches && shiftMatches && altMatches && metaMatches) {
          // Prevent default for shortcuts that might conflict with browser
          if (event.ctrlKey || event.metaKey || event.altKey) {
            event.preventDefault();
          }
          shortcut.action();
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, enabled]);
}

export function formatShortcutKey(shortcut: KeyboardShortcut): string {
  const keys: string[] = [];

  // Use userAgentData with fallback to navigator.platform
  const isMac = (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform
    ? (navigator as Navigator & { userAgentData: { platform: string } }).userAgentData.platform === 'macOS'
    : navigator.platform.includes("Mac");

  if (shortcut.ctrlKey || shortcut.metaKey) {
    keys.push(isMac ? "⌘" : "Ctrl");
  }
  // Don't show ⇧ for keys that inherently require Shift (e.g. ?, !, @)
  const isShiftedPunctuation = shortcut.key.length === 1 && /[^a-zA-Z0-9]/.test(shortcut.key);
  if (shortcut.shiftKey && !isShiftedPunctuation) keys.push("⇧");
  if (shortcut.altKey) keys.push(isMac ? "⌥" : "Alt");

  keys.push(isShiftedPunctuation ? shortcut.key : shortcut.key.toUpperCase());

  return keys.join(" + ");
}
