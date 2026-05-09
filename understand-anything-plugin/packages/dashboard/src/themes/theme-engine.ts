import type { ThemeConfig } from "./types.ts";
import { getAccent, getPreset } from "./presets.ts";

export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function deriveFromAccent(accentHex: string, isDark: boolean): Record<string, string> {
  const rgb = hexToRgb(accentHex);
  return {
    "color-border-subtle": `rgba(${rgb}, ${isDark ? 0.12 : 0.1})`,
    "color-border-medium": `rgba(${rgb}, ${isDark ? 0.25 : 0.18})`,
    "glass-bg": isDark ? "rgba(20, 20, 20, 0.8)" : "rgba(255, 255, 255, 0.8)",
    "glass-bg-heavy": isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)",
    "glass-border": `rgba(${rgb}, ${isDark ? 0.1 : 0.08})`,
    "glass-border-heavy": `rgba(${rgb}, ${isDark ? 0.15 : 0.12})`,
    "scrollbar-thumb": `rgba(${rgb}, 0.2)`,
    "scrollbar-thumb-hover": `rgba(${rgb}, 0.35)`,
    "glow-accent": `rgba(${rgb}, 0.15)`,
    "glow-accent-strong": `rgba(${rgb}, 0.4)`,
    "glow-accent-pulse": `rgba(${rgb}, 0.6)`,
    "color-edge": `rgba(${rgb}, 0.3)`,
    "color-edge-dim": `rgba(${rgb}, 0.08)`,
    "color-edge-dot": `rgba(${rgb}, 0.15)`,
    "color-accent-overlay-bg": `rgba(${rgb}, 0.05)`,
    "color-accent-overlay-border": `rgba(${rgb}, 0.25)`,
    "kbd-bg": `rgba(${rgb}, 0.1)`,
  };
}

export function applyTheme(config: ThemeConfig): void {
  const preset = getPreset(config.presetId);
  const accent = getAccent(preset, config.accentId);
  const style = document.documentElement.style;

  // 1. Apply base preset colors
  for (const [key, value] of Object.entries(preset.colors)) {
    style.setProperty(`--color-${key}`, value);
  }

  // 2. Apply accent colors from swatch
  style.setProperty("--color-accent", accent.accent);
  style.setProperty("--color-accent-dim", accent.accentDim);
  style.setProperty("--color-accent-bright", accent.accentBright);

  // 3. Apply derived values
  const derived = deriveFromAccent(accent.accent, preset.isDark);
  for (const [key, value] of Object.entries(derived)) {
    style.setProperty(`--${key}`, value);
  }

  // 4. Set data-theme for CSS-only selectors
  document.documentElement.setAttribute("data-theme", preset.isDark ? "dark" : "light");

  // 5. Apply heading font preference
  const fontMap: Record<string, string> = {
    serif: "var(--font-serif)",
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
  };
  const headingFont = config.headingFont ?? "serif";
  style.setProperty("--font-heading", fontMap[headingFont] ?? fontMap.serif);
}
