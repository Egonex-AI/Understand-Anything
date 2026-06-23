# Theme System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add curated theme presets with accent customization to the dashboard.

**Architecture:** CSS variable injection at runtime via a pure theme engine, React context for state, localStorage + meta.json for persistence. Five presets (4 dark + 1 light) with 8 accent swatches each.

**Tech Stack:** React, TypeScript, TailwindCSS v4, Zustand (untouched), CSS custom properties.

**Design Doc:** `docs/plans/2026-03-26-theme-system-design.md`

---

### Task 1: Rename `gold` to `accent` in CSS variables and Tailwind classes

This is a mechanical find-and-replace with no behavioral change. Must be done first so all subsequent tasks use the new naming.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/index.css`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/LearnPanel.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/SearchBar.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/LayerLegend.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/PersonaSelector.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

**Step 1: Rename CSS variables in index.css**

In the `@theme` block, rename:
- `--color-gold` -> `--color-accent`
- `--color-gold-dim` -> `--color-accent-dim`
- `--color-gold-bright` -> `--color-accent-bright`

Also rename the `@keyframes goldPulse` to `accentPulse` and `.animate-gold-pulse` to `.animate-accent-pulse`.

**Step 2: Rename all Tailwind class references across components**

Find and replace in all component files:
- `text-gold-bright` -> `text-accent-bright`
- `text-gold-dim` -> `text-accent-dim`
- `text-gold` -> `text-accent`
- `bg-gold` -> `bg-accent`
- `border-gold` -> `border-accent`
- `ring-gold-dim` -> `ring-accent-dim`
- `ring-gold-bright` -> `ring-accent-bright`
- `ring-gold` -> `ring-accent`
- `animate-gold-pulse` -> `animate-accent-pulse`

Order matters — replace the longer `-bright` and `-dim` variants first to avoid partial matches.

Also replace any `var(--color-gold` with `var(--color-accent` in inline styles.

**Step 3: Verify the build compiles**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds with no errors.

**Step 4: Visually verify (optional)**

Run: `cd understand-anything-plugin && pnpm dev:dashboard`
Expected: Dashboard looks identical — same gold accent, no visual changes.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(dashboard): rename gold CSS variables to accent"
```

---

### Task 2: Consolidate hardcoded RGBA values into CSS variables

Replace scattered hardcoded color values in components with CSS variables so they respond to theme changes.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/index.css`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CodeViewer.tsx`

**Step 1: Add new CSS variables to index.css @theme block**

Add these new variables after the existing border variables:

```css
/* Glass */
--glass-bg: rgba(20, 20, 20, 0.8);
--glass-bg-heavy: rgba(20, 20, 20, 0.95);
--glass-border: rgba(212, 165, 116, 0.1);
--glass-border-heavy: rgba(212, 165, 116, 0.15);

/* Scrollbar */
--scrollbar-thumb: rgba(212, 165, 116, 0.2);
--scrollbar-thumb-hover: rgba(212, 165, 116, 0.35);

/* Glow */
--glow-accent: rgba(212, 165, 116, 0.15);
--glow-accent-strong: rgba(212, 165, 116, 0.4);
--glow-accent-pulse: rgba(212, 165, 116, 0.6);

/* Edges */
--color-edge: rgba(212, 165, 116, 0.3);
--color-edge-dim: rgba(212, 165, 116, 0.08);
--color-edge-dot: rgba(212, 165, 116, 0.15);

/* Layer group (accent-based overlays) */
--color-accent-overlay-bg: rgba(212, 165, 116, 0.05);
--color-accent-overlay-border: rgba(212, 165, 116, 0.25);

/* kbd */
--kbd-bg: rgba(212, 165, 116, 0.1);
```

**Step 2: Update .glass, .glass-heavy classes in index.css**

Replace hardcoded values with the new variables:

```css
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.glass-heavy {
  background: var(--glass-bg-heavy);
  border: 1px solid var(--glass-border-heavy);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
```

**Step 3: Update scrollbar styles in index.css**

```css
::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
```

**Step 4: Update glow classes in index.css**

```css
.node-glow {
  box-shadow: 0 0 20px var(--glow-accent);
}
```

Update `@keyframes accentPulse` (renamed in Task 1):
```css
@keyframes accentPulse {
  0%, 100% {
    box-shadow: 0 0 8px var(--glow-accent-strong);
  }
  50% {
    box-shadow: 0 0 20px var(--glow-accent-pulse);
  }
}
```

**Step 5: Update .kbd class in index.css**

```css
.kbd {
  /* ... keep existing sizing/layout ... */
  color: var(--color-accent);
  background: var(--kbd-bg);
}
```

**Step 6: Update GraphView.tsx hardcoded colors**

Replace these inline style values:

| Location | Old Value | New Value |
|----------|-----------|-----------|
| Edge default style stroke | `"rgba(212,165,116,0.3)"` | `"var(--color-edge)"` |
| Edge diff-faded stroke | `"rgba(212,165,116,0.08)"` | `"var(--color-edge-dim)"` |
| Background dots color prop | `"rgba(212,165,116,0.15)"` | `"var(--color-edge-dot)"` |
| MiniMap nodeColor | `"#1a1a1a"` | `"var(--color-elevated)"` |
| MiniMap maskColor | `"rgba(10,10,10,0.7)"` | `"var(--glass-bg)"` |
| Group node backgroundColor | `"rgba(212,165,116,0.05)"` | `"var(--color-accent-overlay-bg)"` |
| Group node border | `"2px dashed rgba(212,165,116,0.25)"` | `"2px dashed var(--color-accent-overlay-border)"` |
| Group node label color | `"#d4a574"` | `"var(--color-accent)"` |
| Edge label fill (normal) | `"#a39787"` | `"var(--color-text-secondary)"` |
| Edge label fill (diff faded) | `"rgba(163,151,135,0.3)"` | `"var(--color-text-muted)"` |
| Spinner border class | `border-gold` already renamed to `border-accent` | Already done in Task 1 |

**Step 7: Update CodeViewer.tsx hardcoded colors**

Replace inline styles for the file type badge:
- `color: "var(--color-node-file)"` — already uses CSS var, keep
- `borderColor: "rgba(74,124,155,0.3)"` -> `"color-mix(in srgb, var(--color-node-file) 30%, transparent)"`
- `backgroundColor: "rgba(74,124,155,0.1)"` -> `"color-mix(in srgb, var(--color-node-file) 10%, transparent)"`

**Step 8: Update CustomNode.tsx hardcoded shadow**

Replace `shadow-[0_2px_8px_rgba(0,0,0,0.3)]` — this black shadow is fine for dark themes but keep it. Leave as-is since it works on both dark and light.

**Step 9: Verify build**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds.

**Step 10: Commit**

```bash
git add -A
git commit -m "refactor(dashboard): consolidate hardcoded colors into CSS variables"
```

---

### Task 3: Create theme type definitions

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/themes/types.ts`

**Step 1: Write the types file**

```typescript
export type PresetId =
  | "dark-gold"
  | "dark-ocean"
  | "dark-forest"
  | "dark-rose"
  | "light-minimal";

export interface AccentSwatch {
  id: string;
  name: string;
  accent: string;
  accentDim: string;
  accentBright: string;
}

export interface ThemePreset {
  id: PresetId;
  name: string;
  isDark: boolean;
  colors: Record<string, string>;
  accentSwatches: AccentSwatch[];
  defaultAccentId: string;
}

export interface ThemeConfig {
  presetId: PresetId;
  accentId: string;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  presetId: "dark-gold",
  accentId: "gold",
};
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add theme type definitions"
```

---

### Task 4: Create theme presets

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/themes/presets.ts`

**Step 1: Write the presets file**

```typescript
import type { AccentSwatch, ThemePreset } from "./types.ts";

const DARK_ACCENT_SWATCHES: AccentSwatch[] = [
  { id: "gold", name: "Gold", accent: "#d4a574", accentDim: "#c9a96e", accentBright: "#e8c49a" },
  { id: "ocean", name: "Ocean", accent: "#5ba4cf", accentDim: "#4e93ba", accentBright: "#7abce0" },
  { id: "emerald", name: "Emerald", accent: "#5ea67a", accentDim: "#4e9468", accentBright: "#78c492" },
  { id: "rose", name: "Rose", accent: "#cf7a8a", accentDim: "#b96e7e", accentBright: "#e094a4" },
  { id: "purple", name: "Purple", accent: "#9b7abf", accentDim: "#876bb0", accentBright: "#b494d4" },
  { id: "amber", name: "Amber", accent: "#c9963a", accentDim: "#b5862e", accentBright: "#ddb05c" },
  { id: "teal", name: "Teal", accent: "#4aab9a", accentDim: "#3d9686", accentBright: "#68c4b4" },
  { id: "silver", name: "Silver", accent: "#a0a8b0", accentDim: "#8e959c", accentBright: "#b8bfc6" },
];

const LIGHT_ACCENT_SWATCHES: AccentSwatch[] = [
  { id: "indigo", name: "Indigo", accent: "#4a6fa5", accentDim: "#3d5f8f", accentBright: "#6088bf" },
  { id: "ocean", name: "Ocean", accent: "#3a8ab5", accentDim: "#2e7aa0", accentBright: "#55a0cc" },
  { id: "emerald", name: "Emerald", accent: "#3a8a5c", accentDim: "#2e7a4e", accentBright: "#55a878" },
  { id: "rose", name: "Rose", accent: "#a5566a", accentDim: "#8f4a5c", accentBright: "#bf6e82" },
  { id: "purple", name: "Purple", accent: "#6b5a9e", accentDim: "#5c4d8a", accentBright: "#8474b5" },
  { id: "amber", name: "Amber", accent: "#9e7a30", accentDim: "#8a6a28", accentBright: "#b5923e" },
  { id: "teal", name: "Teal", accent: "#2e8a7a", accentDim: "#267a6c", accentBright: "#45a595" },
  { id: "slate", name: "Slate", accent: "#5a6570", accentDim: "#4e5860", accentBright: "#6e7a85" },
];

export const PRESETS: ThemePreset[] = [
  {
    id: "dark-gold",
    name: "Dark Gold",
    isDark: true,
    defaultAccentId: "gold",
    accentSwatches: DARK_ACCENT_SWATCHES,
    colors: {
      root: "#0a0a0a",
      surface: "#111111",
      elevated: "#1a1a1a",
      panel: "#141414",
      "text-primary": "#f5f0eb",
      "text-secondary": "#a39787",
      "text-muted": "#6b5f53",
      "node-file": "#4a7c9b",
      "node-function": "#5a9e6f",
      "node-class": "#8b6fb0",
      "node-module": "#c9a06c",
      "node-concept": "#b07a8a",
    },
  },
  {
    id: "dark-ocean",
    name: "Dark Ocean",
    isDark: true,
    defaultAccentId: "ocean",
    accentSwatches: DARK_ACCENT_SWATCHES,
    colors: {
      root: "#0a0e14",
      surface: "#111820",
      elevated: "#1a222c",
      panel: "#141c24",
      "text-primary": "#e8edf2",
      "text-secondary": "#87939f",
      "text-muted": "#536b7a",
      "node-file": "#4a7c9b",
      "node-function": "#5a9e6f",
      "node-class": "#8b6fb0",
      "node-module": "#c9a06c",
      "node-concept": "#b07a8a",
    },
  },
  {
    id: "dark-forest",
    name: "Dark Forest",
    isDark: true,
    defaultAccentId: "emerald",
    accentSwatches: DARK_ACCENT_SWATCHES,
    colors: {
      root: "#0a100a",
      surface: "#111811",
      elevated: "#1a241a",
      panel: "#141c14",
      "text-primary": "#ebf0eb",
      "text-secondary": "#87a38f",
      "text-muted": "#536b5a",
      "node-file": "#4a7c9b",
      "node-function": "#5a9e6f",
      "node-class": "#8b6fb0",
      "node-module": "#c9a06c",
      "node-concept": "#b07a8a",
    },
  },
  {
    id: "dark-rose",
    name: "Dark Rose",
    isDark: true,
    defaultAccentId: "rose",
    accentSwatches: DARK_ACCENT_SWATCHES,
    colors: {
      root: "#100a0a",
      surface: "#181111",
      elevated: "#221a1a",
      panel: "#1c1414",
      "text-primary": "#f2e8ea",
      "text-secondary": "#9f8790",
      "text-muted": "#6b535a",
      "node-file": "#4a7c9b",
      "node-function": "#5a9e6f",
      "node-class": "#8b6fb0",
      "node-module": "#c9a06c",
      "node-concept": "#b07a8a",
    },
  },
  {
    id: "light-minimal",
    name: "Light Minimal",
    isDark: false,
    defaultAccentId: "indigo",
    accentSwatches: LIGHT_ACCENT_SWATCHES,
    colors: {
      root: "#f5f3f0",
      surface: "#eae7e3",
      elevated: "#ffffff",
      panel: "#f0ede9",
      "text-primary": "#1a1a1a",
      "text-secondary": "#6b6b6b",
      "text-muted": "#a0a0a0",
      "node-file": "#3a6a87",
      "node-function": "#488a5b",
      "node-class": "#755d99",
      "node-module": "#a88a56",
      "node-concept": "#966674",
    },
  },
];

export function getPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function getAccent(preset: ThemePreset, accentId: string): AccentSwatch {
  return (
    preset.accentSwatches.find((s) => s.id === accentId) ??
    preset.accentSwatches.find((s) => s.id === preset.defaultAccentId) ??
    preset.accentSwatches[0]
  );
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add theme preset definitions"
```

---

### Task 5: Create theme engine

Pure functions with no React dependency. Handles CSS variable injection and accent derivation.

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/themes/theme-engine.ts`

**Step 1: Write the theme engine**

```typescript
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
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add theme engine with CSS variable injection"
```

---

### Task 6: Create ThemeContext

React context + provider that manages theme state, persistence, and resolution.

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/themes/ThemeContext.tsx`

**Step 1: Write the context**

```typescript
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PresetId, ThemeConfig, ThemePreset } from "./types.ts";
import { DEFAULT_THEME_CONFIG } from "./types.ts";
import { getPreset } from "./presets.ts";
import { applyTheme } from "./theme-engine.ts";

const STORAGE_KEY = "ua-theme";

interface ThemeContextValue {
  config: ThemeConfig;
  preset: ThemePreset;
  setPreset: (presetId: PresetId) => void;
  setAccent: (accentId: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadFromLocalStorage(): ThemeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.presetId === "string" && typeof parsed.accentId === "string") {
      return parsed as ThemeConfig;
    }
    return null;
  } catch {
    return null;
  }
}

function saveToLocalStorage(config: ThemeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage full or unavailable — ignore
  }
}

function resolveInitialTheme(metaTheme?: ThemeConfig | null): ThemeConfig {
  return loadFromLocalStorage() ?? metaTheme ?? DEFAULT_THEME_CONFIG;
}

interface ThemeProviderProps {
  metaTheme?: ThemeConfig | null;
  children: ReactNode;
}

export function ThemeProvider({ metaTheme, children }: ThemeProviderProps) {
  const [config, setConfig] = useState<ThemeConfig>(() => resolveInitialTheme(metaTheme));
  const initialized = useRef(false);

  // Apply theme on mount and config changes
  useEffect(() => {
    applyTheme(config);
    if (initialized.current) {
      saveToLocalStorage(config);
    }
    initialized.current = true;
  }, [config]);

  // Update if metaTheme arrives later (async fetch) and no localStorage preference exists
  useEffect(() => {
    if (metaTheme && !loadFromLocalStorage()) {
      setConfig(metaTheme);
    }
  }, [metaTheme]);

  const setPreset = useCallback((presetId: PresetId) => {
    setConfig((prev) => {
      const newPreset = getPreset(presetId);
      return { presetId, accentId: newPreset.defaultAccentId };
    });
  }, []);

  const setAccent = useCallback((accentId: string) => {
    setConfig((prev) => ({ ...prev, accentId }));
  }, []);

  const preset = getPreset(config.presetId);

  return (
    <ThemeContext.Provider value={{ config, preset, setPreset, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

**Step 2: Create barrel export**

Create: `understand-anything-plugin/packages/dashboard/src/themes/index.ts`

```typescript
export { ThemeProvider, useTheme } from "./ThemeContext.tsx";
export { PRESETS, getPreset, getAccent } from "./presets.ts";
export { applyTheme } from "./theme-engine.ts";
export type { PresetId, ThemeConfig, ThemePreset, AccentSwatch } from "./types.ts";
export { DEFAULT_THEME_CONFIG } from "./types.ts";
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add ThemeContext with localStorage persistence"
```

---

### Task 7: Extend AnalysisMeta with theme field

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts`

**Step 1: Add ThemeConfig type and extend AnalysisMeta**

Add near the top of the file (after existing imports/types):

```typescript
export interface ThemeConfig {
  presetId: string;
  accentId: string;
}
```

Add `theme` field to `AnalysisMeta`:

```typescript
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
  theme?: ThemeConfig;
}
```

**Step 2: Verify core builds**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`
Expected: Build succeeds.

**Step 3: Verify core tests pass**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(core): add optional theme field to AnalysisMeta"
```

---

### Task 8: Create ThemePicker component

The popover UI with preset selection and accent swatch row.

**Files:**
- Create: `understand-anything-plugin/packages/dashboard/src/components/ThemePicker.tsx`

**Step 1: Write the component**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme, PRESETS } from "../themes/index.ts";

export function ThemePicker() {
  const { config, preset, setPreset, setAccent } = useTheme();
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
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add ThemePicker popover component"
```

---

### Task 9: Integrate ThemeProvider and ThemePicker into App

Wire everything together in the root component.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

**Step 1: Add imports**

Add to imports at top of App.tsx:

```typescript
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";
```

**Step 2: Add meta.json theme loading**

Inside the App component, add state and effect for meta.json theme:

```typescript
const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);

useEffect(() => {
  fetch("/meta.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((meta) => {
      if (meta?.theme) setMetaTheme(meta.theme);
    })
    .catch(() => {});
}, []);
```

**Step 3: Wrap return JSX with ThemeProvider**

Wrap the entire return value of App with `<ThemeProvider metaTheme={metaTheme}>...</ThemeProvider>`.

**Step 4: Add ThemePicker to header**

In the header bar (the `<header>` or top flex row), add `<ThemePicker />` after the existing controls (PersonaSelector, DiffToggle, LayerLegend) and before the help button.

**Step 5: Verify build**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): integrate ThemeProvider and ThemePicker into App"
```

---

### Task 10: Light theme CSS adjustments

Handle edge cases where CSS variables alone aren't sufficient for the light theme.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/index.css`

**Step 1: Add data-theme selectors for light theme overrides**

Add at the end of index.css:

```css
/* Light theme overrides */
[data-theme="light"] {
  color-scheme: light;
}

[data-theme="light"] .diff-faded {
  opacity: 0.35;
}

[data-theme="light"] ::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
}

[data-theme="dark"] {
  color-scheme: dark;
}
```

**Step 2: Add transition for smooth theme switching**

Add to the `html` base styles:

```css
html {
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

**Step 3: Update the WarningBanner consideration**

WarningBanner uses Tailwind amber/orange colors directly (e.g., `bg-amber-900/20`). These are semantic warning colors and should NOT change with theme. However, for the light theme, the amber colors on a light background need adjustment.

Add to light theme overrides if needed:

```css
[data-theme="light"] .warning-banner {
  background: rgba(180, 130, 30, 0.1);
  border-color: rgba(180, 130, 30, 0.3);
  color: #92600a;
}
```

Note: Only add this if the WarningBanner looks broken on the light theme during visual testing. It may work fine as-is with Tailwind's amber colors.

**Step 4: Verify build**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): add light theme CSS overrides"
```

---

### Task 11: Remove @theme defaults from index.css

Now that the theme engine sets all CSS variables at runtime, the `@theme` block in index.css serves as the initial/fallback values before React mounts. Keep it but update it to use the accent naming.

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/index.css`

**Step 1: Update @theme block**

The `@theme` block should already have `--color-accent` (from Task 1 rename). Ensure the new variables added in Task 2 are also present in the `@theme` block as defaults:

```css
@theme {
  /* Base */
  --color-root: #0a0a0a;
  --color-surface: #111111;
  --color-elevated: #1a1a1a;
  --color-panel: #141414;

  /* Accent */
  --color-accent: #d4a574;
  --color-accent-dim: #c9a96e;
  --color-accent-bright: #e8c49a;

  /* Text */
  --color-text-primary: #f5f0eb;
  --color-text-secondary: #a39787;
  --color-text-muted: #6b5f53;

  /* Borders */
  --color-border-subtle: rgba(212, 165, 116, 0.12);
  --color-border-medium: rgba(212, 165, 116, 0.25);

  /* Node types */
  --color-node-file: #4a7c9b;
  --color-node-function: #5a9e6f;
  --color-node-class: #8b6fb0;
  --color-node-module: #c9a06c;
  --color-node-concept: #b07a8a;

  /* Diff */
  --color-diff-changed: #e05252;
  --color-diff-affected: #d4a030;
  --color-diff-changed-dim: rgba(224, 82, 82, 0.25);
  --color-diff-affected-dim: rgba(212, 160, 48, 0.25);

  /* Glass */
  --glass-bg: rgba(20, 20, 20, 0.8);
  --glass-bg-heavy: rgba(20, 20, 20, 0.95);
  --glass-border: rgba(212, 165, 116, 0.1);
  --glass-border-heavy: rgba(212, 165, 116, 0.15);

  /* Scrollbar */
  --scrollbar-thumb: rgba(212, 165, 116, 0.2);
  --scrollbar-thumb-hover: rgba(212, 165, 116, 0.35);

  /* Glow */
  --glow-accent: rgba(212, 165, 116, 0.15);
  --glow-accent-strong: rgba(212, 165, 116, 0.4);
  --glow-accent-pulse: rgba(212, 165, 116, 0.6);

  /* Edges */
  --color-edge: rgba(212, 165, 116, 0.3);
  --color-edge-dim: rgba(212, 165, 116, 0.08);
  --color-edge-dot: rgba(212, 165, 116, 0.15);

  /* Accent overlays */
  --color-accent-overlay-bg: rgba(212, 165, 116, 0.05);
  --color-accent-overlay-border: rgba(212, 165, 116, 0.25);

  /* Kbd */
  --kbd-bg: rgba(212, 165, 116, 0.1);

  /* Typography */
  --font-serif: 'DM Serif Display', Georgia, serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

This ensures:
- Tailwind v4 generates all the correct utility classes from the `@theme` block
- Before React mounts, the page shows the Dark Gold default (no flash of unstyled content)
- The theme engine overrides these values at runtime

**Step 2: Verify build**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(dashboard): align @theme defaults with theme engine variables"
```

---

### Task 12: Full build + visual verification

**Files:** None (verification only)

**Step 1: Build core**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`
Expected: Build succeeds.

**Step 2: Build dashboard**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: Build succeeds.

**Step 3: Run core tests**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: All tests pass.

**Step 4: Run lint**

Run: `cd understand-anything-plugin && pnpm lint`
Expected: No lint errors.

**Step 5: Start dev server and visually verify**

Run: `cd understand-anything-plugin && pnpm dev:dashboard`

Verify:
1. Dashboard loads with Dark Gold theme (default) — looks identical to current
2. Theme picker button visible in header
3. Click theme picker — popover opens with 5 presets and 8 accent swatches
4. Select Dark Ocean — backgrounds turn navy-blue, accent turns cyan
5. Select Dark Forest — backgrounds turn dark green, accent turns emerald
6. Select Dark Rose — backgrounds turn dark warm, accent turns rose
7. Select Light Minimal — backgrounds turn light, text turns dark, accent turns indigo
8. Select different accent swatches within each preset — accent color, borders, glass, glow all update
9. Refresh page — theme persists from localStorage
10. Click outside popover — it closes
11. Press Escape — popover closes

**Step 6: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(dashboard): theme system visual adjustments"
```

---

## Dependency Graph

```
Task 1 (rename gold→accent) ─┐
                              ├─> Task 3 (types) ──┐
Task 2 (consolidate colors) ──┤                     │
                              │   Task 4 (presets) ─┤
                              │                     ├─> Task 6 (context) ─┐
                              │   Task 5 (engine) ──┘                     │
                              │                                           ├─> Task 8 (picker) ─┐
                              │   Task 7 (core types) ────────────────────┘                    │
                              │                                                                │
                              └───────────────────────────────────────────> Task 9 (integrate) ─┤
                                                                                               │
                                                                           Task 10 (light CSS) ┤
                                                                                               │
                                                                           Task 11 (defaults) ─┤
                                                                                               │
                                                                           Task 12 (verify) ───┘
```

**Parallelizable groups:**
- Tasks 1 + 2 can be done sequentially (both touch index.css)
- Tasks 3, 4, 5 can be done in parallel (independent new files)
- Task 6 depends on 3, 4, 5
- Task 7 is independent (core package)
- Task 8 depends on 6
- Task 9 depends on 1, 2, 7, 8
- Tasks 10, 11 can be done after 9
- Task 12 is final verification
