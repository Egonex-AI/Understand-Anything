# Homepage Feature Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the Astro homepage to reflect features from v1.2.0–v2.0.0 releases.

**Architecture:** Three file edits — expand Features.astro from 3→6 cards, update Install.astro platform note, update Footer.astro tagline. No new files or structural changes.

**Tech Stack:** Astro 6, CSS grid

---

### Task 1: Update Features.astro — Replace 3 Cards with 6

**Files:**
- Modify: `homepage/src/components/Features.astro`

**Step 1: Replace the features array (lines 2–18)**

Replace the entire frontmatter features array with:

```astro
---
const features = [
  {
    icon: '◈',
    title: 'Interactive Knowledge Graph',
    description: 'Visualize files, functions, and dependencies as an explorable graph with hierarchical drill-down and smart layout.',
  },
  {
    icon: '⬡',
    title: 'Beyond Code Analysis',
    description: 'Analyze your entire project — Dockerfiles, Terraform, SQL, Markdown, and 26+ file types mapped into one unified graph.',
  },
  {
    icon: '⊘',
    title: 'Smart Filtering & Search',
    description: 'Filter by node type, complexity, layer, or edge category. Fuzzy and semantic search to find anything instantly.',
  },
  {
    icon: '⎙',
    title: 'Export & Share',
    description: 'Export your knowledge graph as high-quality PNG, SVG, or filtered JSON — ready for docs, presentations, or further analysis.',
  },
  {
    icon: '⟿',
    title: 'Dependency Path Finder',
    description: 'Find the shortest path between any two components. Understand how parts of your system connect at a glance.',
  },
  {
    icon: '⟐',
    title: 'Guided Tours & Onboarding',
    description: 'AI-generated walkthroughs that teach the codebase step by step, plus onboarding guides for new team members.',
  },
];
---
```

**Step 2: Update the reveal delay logic (line 24)**

The current `reveal-delay-${i + 1}` only has CSS for delays 1–3. With 6 cards in 2 rows, use modulo so each row staggers 1/2/3:

```astro
<div class={`feature-card reveal reveal-delay-${(i % 3) + 1}`}>
```

**Step 3: Update the grid CSS to handle 2 rows properly**

No change needed — `grid-template-columns: repeat(3, 1fr)` already wraps to a second row. The mobile `1fr` breakpoint also works. No CSS changes required.

**Step 4: Verify build**

Run: `cd homepage && npx astro build`
Expected: Build completes with no errors.

**Step 5: Commit**

```bash
git add homepage/src/components/Features.astro
git commit -m "feat(homepage): expand features section to 6 cards for v2.0.0"
```

---

### Task 2: Update Install.astro — Multi-Platform Note

**Files:**
- Modify: `homepage/src/components/Install.astro`

**Step 1: Replace the platform note (line 13)**

Change:
```html
<p class="install-note">Works with <strong>Claude Code</strong> — Anthropic's official CLI for Claude.</p>
```

To:
```html
<p class="install-note">Works with <strong>Claude Code</strong>, <strong>Codex</strong>, <strong>OpenCode</strong>, <strong>Gemini CLI</strong>, and more.</p>
```

**Step 2: Commit**

```bash
git add homepage/src/components/Install.astro
git commit -m "feat(homepage): update install note for multi-platform support"
```

---

### Task 3: Update Footer.astro — Tagline

**Files:**
- Modify: `homepage/src/components/Footer.astro`

**Step 1: Replace the tagline (line 13)**

Change:
```html
<p class="footer-note">Built as a Claude Code plugin</p>
```

To:
```html
<p class="footer-note">Built for AI coding assistants</p>
```

**Step 2: Verify full build**

Run: `cd homepage && npx astro build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add homepage/src/components/Footer.astro
git commit -m "feat(homepage): update footer tagline for multi-platform"
```
