import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme, PRESETS } from "../themes/index.ts";
import type { HeadingFont } from "../themes/index.ts";

export function ThemePicker() {
  const { config, preset, setPreset, setAccent, setHeadingFont } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handlePreset = useCallback(
    (id: string) => {
      setPreset(id as Parameters<typeof setPreset>[0]);
    },
    [setPreset],
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary transition-colors"
        title="Change theme"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a7 7 0 0 0 0 14 4 4 0 0 1 0 8 10 10 0 0 0 0-20z" />
          <circle cx="8" cy="10" r="1.5" fill="currentColor" />
          <circle cx="12" cy="7" r="1.5" fill="currentColor" />
          <circle cx="16" cy="10" r="1.5" fill="currentColor" />
        </svg>
        <span className="hidden sm:inline">Theme</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-lg glass-heavy shadow-xl z-50 p-3 space-y-3">
          {/* Presets */}
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Theme
            </div>
            <div className="space-y-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePreset(p.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                    p.id === config.presetId
                      ? "bg-accent/15 text-accent"
                      : "text-text-secondary hover:text-text-primary hover:bg-elevated"
                  }`}
                >
                  {/* Color preview dots */}
                  <div className="flex gap-1">
                    <span
                      className="w-3 h-3 rounded-full border border-border-subtle"
                      style={{ backgroundColor: p.colors.root }}
                    />
                    <span
                      className="w-3 h-3 rounded-full border border-border-subtle"
                      style={{ backgroundColor: p.colors.surface }}
                    />
                    <span
                      className="w-3 h-3 rounded-full border border-border-subtle"
                      style={{
                        backgroundColor:
                          p.accentSwatches.find((s) => s.id === p.defaultAccentId)?.accent ??
                          p.accentSwatches[0].accent,
                      }}
                    />
                  </div>
                  <span>{p.name}</span>
                  {p.id === config.presetId && (
                    <svg
                      className="ml-auto w-3.5 h-3.5 text-accent"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Accent swatches */}
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Accent Color
            </div>
            <div className="flex gap-2 flex-wrap">
              {preset.accentSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  onClick={() => setAccent(swatch.id)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                    swatch.id === config.accentId
                      ? "ring-2 ring-text-primary ring-offset-1 ring-offset-root"
                      : ""
                  }`}
                  style={{ backgroundColor: swatch.accent }}
                  title={swatch.name}
                />
              ))}
            </div>
          </div>

          {/* Heading font */}
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Heading Font
            </div>
            <div className="flex gap-1">
              {([
                { id: "serif" as HeadingFont, label: "Serif", sample: "Aa" },
                { id: "sans" as HeadingFont, label: "Sans", sample: "Aa" },
                { id: "mono" as HeadingFont, label: "Mono", sample: "Aa" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setHeadingFont(opt.id)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs transition-colors ${
                    (config.headingFont ?? "serif") === opt.id
                      ? "bg-accent/15 text-accent"
                      : "text-text-secondary hover:text-text-primary hover:bg-elevated"
                  }`}
                  style={{
                    fontFamily:
                      opt.id === "serif"
                        ? "var(--font-serif)"
                        : opt.id === "mono"
                          ? "var(--font-mono)"
                          : "var(--font-sans)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
