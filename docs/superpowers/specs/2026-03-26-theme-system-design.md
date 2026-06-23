# Theme System Design

## Overview

Add a curated theme preset system with accent color customization to the dashboard. Users select from 5 hand-designed theme presets and optionally swap the accent color within each preset from a set of 8-10 tested swatches.

### Goals
- Support 5 theme presets: Dark Gold (current), Dark Ocean, Dark Forest, Dark Rose, Light Minimal
- Allow accent color customization within each preset (curated swatches only, no free picker)
- Persist theme preference in both `localStorage` (personal) and `meta.json` (project-level)
- Maintain visual coherence — no user-breakable color combinations
- Zero-reload theme switching via CSS variable injection at runtime

### Non-Goals
- Free color picker (risk of ugly/unreadable combos)
- Per-component color overrides
- Multiple simultaneous themes

---

## 1. Theme Presets & Color System

### 1.1 Preset Definitions

Each preset is a complete mapping of CSS variable names to values. The 5 presets:

| Token | Dark Gold | Dark Ocean | Dark Forest | Dark Rose | Light Minimal |
|-------|-----------|------------|-------------|-----------|---------------|
| `--color-root` | `#0a0a0a` | `#0a0e14` | `#0a100a` | `#100a0a` | `#f5f3f0` |
| `--color-surface` | `#111111` | `#111820` | `#111811` | `#181111` | `#eae7e3` |
| `--color-elevated` | `#1a1a1a` | `#1a222c` | `#1a241a` | `#221a1a` | `#ffffff` |
| `--color-panel` | `#141414` | `#141c24` | `#141c14` | `#1c1414` | `#f0ede9` |
| `--color-gold`* | `#d4a574` | `#5ba4cf` | `#5ea67a` | `#cf7a8a` | `#4a6fa5` |
| `--color-gold-dim`* | `#c9a96e` | `#4e93ba` | `#4e9468` | `#b96e7e` | `#3d5f8f` |
| `--color-gold-bright`* | `#e8c49a` | `#7abce0` | `#78c492` | `#e094a4` | `#6088bf` |
| `--color-text-primary` | `#f5f0eb` | `#e8edf2` | `#ebf0eb` | `#f2e8ea` | `#1a1a1a` |
| `--color-text-secondary` | `#a39787` | `#87939f` | `#87a38f` | `#9f8790` | `#6b6b6b` |
| `--color-text-muted` | `#6b5f53` | `#536b7a` | `#536b5a` | `#6b535a` | `#a0a0a0` |
| `--color-border-subtle` | `rgba(212,165,116,0.12)` | `rgba(91,164,207,0.12)` | `rgba(94,166,122,0.12)` | `rgba(207,122,138,0.12)` | `rgba(74,111,165,0.10)` |
| `--color-border-medium` | `rgba(212,165,116,0.25)` | `rgba(91,164,207,0.25)` | `rgba(94,166,122,0.25)` | `rgba(207,122,138,0.25)` | `rgba(74,111,165,0.18)` |

*\* The CSS variable names stay as `--color-gold`, `--color-gold-dim`, `--color-gold-bright` even for non-gold themes. They represent "the accent color" generically. Renaming them to `--color-accent` is a refactor we can do, but not required — the variable name is an implementation detail invisible to users.*

**Decision: Rename `--color-gold*` to `--color-accent*`** to avoid confusion. This is a find-and-replace across the codebase with no behavioral change.

### 1.2 Glass Effects

Glass effects derive from base colors and need per-preset values:

| Token | Dark themes | Light Minimal |
|-------|-------------|---------------|
| `--glass-bg` | `rgba(20,20,20,0.8)` | `rgba(255,255,255,0.8)` |
| `--glass-bg-heavy` | `rgba(20,20,20,0.95)` | `rgba(255,255,255,0.95)` |
| `--glass-border` | `rgba(accent,0.1)` | `rgba(accent,0.08)` |
| `--glass-border-heavy` | `rgba(accent,0.15)` | `rgba(accent,0.12)` |

The `.glass` and `.glass-heavy` CSS classes will reference these variables instead of hardcoded values.

### 1.3 Scrollbar & Glow Colors

These also derive from the accent color and need to become CSS variables:

| Token | Purpose |
|-------|---------|
| `--scrollbar-thumb` | `rgba(accent, 0.2)` |
| `--scrollbar-thumb-hover` | `rgba(accent, 0.35)` |
| `--glow-color` | `rgba(accent, 0.4)` for node selection glow |
| `--glow-pulse` | `rgba(accent, 0.6)` for tour highlight pulse |

### 1.4 Node-Type & Diff Colors

These are **semantic** and stay fixed across all dark themes:

| Variable | Value | Purpose |
|----------|-------|---------|
| `--color-node-file` | `#4a7c9b` | File nodes |
| `--color-node-function` | `#5a9e6f` | Function nodes |
| `--color-node-class` | `#8b6fb0` | Class nodes |
| `--color-node-module` | `#c9a06c` | Module nodes |
| `--color-node-concept` | `#b07a8a` | Concept nodes |
| `--color-diff-changed` | `#e05252` | Changed nodes |
| `--color-diff-affected` | `#d4a030` | Affected nodes |

For **Light Minimal only**, these are slightly desaturated/darkened to maintain readability on light backgrounds:

| Variable | Light Minimal Value |
|----------|-------------------|
| `--color-node-file` | `#3a6a87` |
| `--color-node-function` | `#488a5b` |
| `--color-node-class` | `#755d99` |
| `--color-node-module` | `#a88a56` |
| `--color-node-concept` | `#966674` |

### 1.5 Accent Swatches

Each preset offers 8 accent color options. The first is the "native" default for that preset. Each swatch provides 3 values (accent, accent-dim, accent-bright) plus auto-derived border and glass opacities.

**Dark theme accent swatches** (shared across all 4 dark presets):

| Name | Accent | Dim | Bright |
|------|--------|-----|--------|
| Gold | `#d4a574` | `#c9a96e` | `#e8c49a` |
| Ocean | `#5ba4cf` | `#4e93ba` | `#7abce0` |
| Emerald | `#5ea67a` | `#4e9468` | `#78c492` |
| Rose | `#cf7a8a` | `#b96e7e` | `#e094a4` |
| Purple | `#9b7abf` | `#876bb0` | `#b494d4` |
| Amber | `#c9963a` | `#b5862e` | `#ddb05c` |
| Teal | `#4aab9a` | `#3d9686` | `#68c4b4` |
| Silver | `#a0a8b0` | `#8e959c` | `#b8bfc6` |

**Light Minimal accent swatches:**

| Name | Accent | Dim | Bright |
|------|--------|-----|--------|
| Indigo | `#4a6fa5` | `#3d5f8f` | `#6088bf` |
| Ocean | `#3a8ab5` | `#2e7aa0` | `#55a0cc` |
| Emerald | `#3a8a5c` | `#2e7a4e` | `#55a878` |
| Rose | `#a5566a` | `#8f4a5c` | `#bf6e82` |
| Purple | `#6b5a9e` | `#5c4d8a` | `#8474b5` |
| Amber | `#9e7a30` | `#8a6a28` | `#b5923e` |
| Teal | `#2e8a7a` | `#267a6c` | `#45a595` |
| Slate | `#5a6570` | `#4e5860` | `#6e7a85` |

### 1.6 Border & Glass Derivation

When an accent swatch is selected, borders and glass effects are auto-derived:

```typescript
function deriveFromAccent(accentHex: string, isDark: boolean) {
  return {
    borderSubtle: `rgba(${hexToRgb(accentHex)}, ${isDark ? 0.12 : 0.10})`,
    borderMedium: `rgba(${hexToRgb(accentHex)}, ${isDark ? 0.25 : 0.18})`,
    glassBorder: `rgba(${hexToRgb(accentHex)}, ${isDark ? 0.1 : 0.08})`,
    glassBorderHeavy: `rgba(${hexToRgb(accentHex)}, ${isDark ? 0.15 : 0.12})`,
    scrollbarThumb: `rgba(${hexToRgb(accentHex)}, 0.2)`,
    scrollbarThumbHover: `rgba(${hexToRgb(accentHex)}, 0.35)`,
    glowColor: `rgba(${hexToRgb(accentHex)}, 0.4)`,
    glowPulse: `rgba(${hexToRgb(accentHex)}, 0.6)`,
  };
}
```

---

## 2. Architecture & Data Flow

### 2.1 File Structure

```
packages/dashboard/src/
  themes/
    types.ts          # ThemePreset, AccentSwatch, ThemeConfig types
    presets.ts         # 5 preset definitions + accent swatch arrays
    theme-engine.ts   # applyTheme(), deriveFromAccent(), hexToRgb()
    ThemeContext.tsx    # React context + provider + useTheme() hook
  components/
    ThemePicker.tsx    # Popover UI for preset + accent selection
```

### 2.2 Type Definitions

```typescript
// themes/types.ts

export type PresetId = 'dark-gold' | 'dark-ocean' | 'dark-forest' | 'dark-rose' | 'light-minimal';

export interface ThemePreset {
  id: PresetId;
  name: string;           // Display name: "Dark Gold"
  isDark: boolean;         // true for dark themes, false for light
  colors: Record<string, string>;  // CSS variable name -> value (without --)
  accentSwatches: AccentSwatch[];
  defaultAccentId: string; // Which swatch is the native default
}

export interface AccentSwatch {
  id: string;              // e.g. 'gold', 'ocean'
  name: string;            // Display name: "Gold"
  accent: string;          // Primary accent hex
  accentDim: string;       // Dimmed accent hex
  accentBright: string;    // Bright accent hex
}

export interface ThemeConfig {
  presetId: PresetId;
  accentId: string;        // Selected accent swatch ID
}
```

### 2.3 Theme Engine

The theme engine is a pure function layer (no React dependency):

```typescript
// themes/theme-engine.ts

export function applyTheme(config: ThemeConfig): void {
  const preset = getPreset(config.presetId);
  const accent = getAccent(preset, config.accentId);

  // 1. Apply base preset colors
  for (const [key, value] of Object.entries(preset.colors)) {
    document.documentElement.style.setProperty(`--color-${key}`, value);
  }

  // 2. Override accent colors from swatch
  document.documentElement.style.setProperty('--color-accent', accent.accent);
  document.documentElement.style.setProperty('--color-accent-dim', accent.accentDim);
  document.documentElement.style.setProperty('--color-accent-bright', accent.accentBright);

  // 3. Apply derived values (borders, glass, scrollbar, glow)
  const derived = deriveFromAccent(accent.accent, preset.isDark);
  for (const [key, value] of Object.entries(derived)) {
    document.documentElement.style.setProperty(`--${key}`, value);
  }

  // 4. Set data-theme attribute for any CSS-only selectors needed
  document.documentElement.setAttribute('data-theme', preset.isDark ? 'dark' : 'light');
}
```

### 2.4 React Context

```typescript
// themes/ThemeContext.tsx

interface ThemeContextValue {
  config: ThemeConfig;
  preset: ThemePreset;
  setPreset: (presetId: PresetId) => void;
  setAccent: (accentId: string) => void;
}
```

The provider:
1. On mount: resolves theme from `localStorage` > `meta.json` field in loaded graph > default (`dark-gold`)
2. Calls `applyTheme()` on every config change
3. Persists to `localStorage` on every change
4. Does NOT write to `meta.json` from the dashboard (the dashboard is read-only for meta.json; meta.json is written by the CLI/plugin side)

### 2.5 Integration with Zustand Store

The theme system is **separate from the Zustand store** — it uses its own React context. Rationale:
- Theme state is orthogonal to graph/UI state
- Theme needs to apply before the graph even loads (avoid flash of wrong theme)
- Keeps the store focused on graph interaction

The store does NOT gain any theme-related fields.

---

## 3. UI Components

### 3.1 Theme Picker Button (Header)

A small palette icon button in the top header bar, positioned after existing controls (PersonaSelector, DiffToggle, etc.).

- Click opens a popover/dropdown panel
- Popover has two sections:
  - **Presets**: 5 cards/buttons showing preset name + small color preview circles
  - **Accent Colors**: row of 8 color circles for the active preset
- Active preset and accent are highlighted with a ring/check
- Selecting a preset instantly applies it; selecting an accent instantly applies it
- Clicking outside or pressing Escape closes the popover

### 3.2 Preset Preview

Each preset card shows:
- Name (e.g., "Dark Gold")
- 3-4 small circles showing root, surface, and accent colors as a visual preview
- Check mark or ring on the active one

### 3.3 Accent Swatch Row

- 8 small filled circles in a horizontal row
- Tooltip or label on hover showing the accent name
- Active one has a ring/border indicator

### 3.4 Transitions

When switching themes:
- CSS variables update instantly (no transition needed for most properties)
- Optionally add a subtle `transition: background-color 0.2s, color 0.2s` on `html` for a smooth feel
- No page reload required

---

## 4. Persistence & Resolution

### 4.1 Storage Locations

| Location | Format | Written by | Read by |
|----------|--------|-----------|---------|
| `localStorage` key: `ua-theme` | `JSON.stringify(ThemeConfig)` | Dashboard (on every change) | Dashboard (on mount) |
| `.understand-anything/meta.json` | `{ ..., theme?: ThemeConfig }` | CLI/plugin (during analysis or explicit set) | Dashboard (on mount, as fallback) |

### 4.2 Resolution Order

```
1. localStorage('ua-theme')     → user's personal preference (wins)
2. meta.json.theme              → project-level default (fallback)
3. { presetId: 'dark-gold', accentId: 'gold' }  → hard default
```

### 4.3 meta.json Schema Extension

Extend `AnalysisMeta` in `packages/core/src/types.ts`:

```typescript
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
  theme?: ThemeConfig;      // NEW — optional, project-level theme preference
}
```

### 4.4 Dashboard Reads meta.json Theme

The dashboard currently loads `/knowledge-graph.json` on mount. It also needs to load `/meta.json` (or the theme field can be embedded in `knowledge-graph.json`).

**Decision:** Load `/meta.json` separately — it's a small file and keeps concerns separated. The dashboard fetches `/meta.json` on mount, extracts the `theme` field if present, and uses it as fallback when `localStorage` has no theme.

---

## 5. Hardcoded Color Consolidation

### 5.1 Problem

Many components use hardcoded RGBA values instead of CSS variables:
- `rgba(212,165,116,0.3)` scattered in GraphView, CustomNode, etc.
- `rgba(20,20,20,0.8)` in glass effects
- `rgba(224,82,82,0.25)` in diff overlays

These won't respond to theme changes.

### 5.2 Solution

Before implementing theme switching, consolidate all hardcoded color references:

1. **Audit**: grep for hardcoded hex/rgba values in component files
2. **Replace with CSS variables**: create new variables where needed (e.g., `--edge-color`, `--edge-color-dim`)
3. **Glass classes**: update `.glass` and `.glass-heavy` in `index.css` to use variables
4. **Scrollbar**: update scrollbar styles to use variables
5. **Glow effects**: update `.node-glow`, `.diff-changed-glow`, `.diff-affected-glow` to use variables

Key hardcoded patterns to consolidate:

| Hardcoded Value | Replace With |
|-----------------|-------------|
| `rgba(212,165,116,X)` | `var(--color-accent)` with opacity modifier or dedicated variable |
| `rgba(20,20,20,0.8)` | `var(--glass-bg)` |
| `rgba(20,20,20,0.95)` | `var(--glass-bg-heavy)` |
| `color="rgba(212,165,116,0.15)"` in React Flow | Variable reference |
| Amber colors in WarningBanner | Keep as-is (semantic warning color, theme-independent) |

### 5.3 CSS Variable Rename

Rename throughout codebase:
- `--color-gold` -> `--color-accent`
- `--color-gold-dim` -> `--color-accent-dim`
- `--color-gold-bright` -> `--color-accent-bright`
- All Tailwind class usages: `text-gold` -> `text-accent`, `bg-gold` -> `bg-accent`, etc.

---

## 6. Light Theme Considerations

The Light Minimal theme requires special attention:

### 6.1 Inverted Contrast

- Text is dark on light backgrounds (flipped from dark themes)
- Borders need lower opacity to avoid looking harsh
- Glass effects use white-based rgba instead of black-based

### 6.2 Node Colors

Slightly darker/desaturated variants for readability on light backgrounds (see Section 1.4).

### 6.3 data-theme Attribute

Set `data-theme="light"` on `<html>` for any styles that can't be handled purely through CSS variables (e.g., third-party component overrides, box-shadow directions).

### 6.4 React Flow

React Flow's background, minimap, and edge colors all need to respect the theme. The existing `!important` override on `.react-flow__background` already uses `var(--color-root)`, which is good. MiniMap colors in GraphView.tsx are currently hardcoded and need to be updated.

---

## 7. Summary of Changes by Package

### packages/core
- Extend `AnalysisMeta` type with optional `theme?: ThemeConfig`
- Export `ThemeConfig` and `PresetId` types from `./types` subpath

### packages/dashboard
- New `themes/` directory with types, presets, engine, and context
- New `ThemePicker` component in header
- Rename `--color-gold*` to `--color-accent*` across all files
- Consolidate hardcoded RGBA values into CSS variables
- Update `index.css`: glass classes, scrollbar, glow effects to use variables
- Update `App.tsx`: wrap with ThemeProvider, add ThemePicker to header, fetch meta.json
- Update components with hardcoded colors: GraphView, CustomNode, LayerLegend, etc.

---

## 8. Out of Scope

- Theme import/export
- Custom theme creation UI
- Per-node color customization
- Animated theme transitions beyond simple CSS transitions
- Syncing theme across browser tabs (nice-to-have for later)
