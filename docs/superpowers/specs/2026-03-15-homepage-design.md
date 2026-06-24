# Understand Anything — Project Homepage Design

**Date**: 2026-03-15
**Goal**: Attract new users to the Understand Anything Claude Code plugin
**Approach**: "The Reveal" — cinematic scroll-driven single-page site

## Tech Stack

- **Astro** (static site generator, zero JS framework overhead)
- **Self-hosted fonts** (no Google Fonts CDN dependency — works in China)
- **CSS** with variables matching dashboard theme
- **Vanilla JS** for `IntersectionObserver` scroll animations
- **GitHub Actions** for CI/CD to `gh-pages` branch

## Source & Deployment

- Source: `homepage/` directory on `main` branch
- Build output: deployed to `gh-pages` branch via GitHub Actions
- URL: `understand-anything.com`

## Page Structure (scroll order)

### 1. Nav Bar
Minimal floating nav. Logo/wordmark left, GitHub star button + "Get Started" CTA right. Transparent, becomes solid on scroll.

### 2. Hero (full viewport)
- Headline: **"Understand Any Codebase"**
- Subheadline: "Turn 200,000 lines of code into an interactive knowledge graph you can explore, search, and learn from — powered by multi-agent AI analysis."
- CTA: "Get Started" (gold button, scrolls to install section)
- Secondary: "View on GitHub" (text link)
- Background: `hero.jpg` with dark gradient overlay

### 3. Dashboard Showcase
- Label: "See your codebase come alive"
- `overview.png` in a stylized browser frame with gold glow shadow
- Fade-in on scroll

### 4. Feature Cards (3 columns)
Staggered fade-in animation:
1. **Interactive Knowledge Graph** — "Visualize files, functions, and dependencies as an explorable graph with smart layout."
2. **Plain-English Summaries** — "Every node explained in language anyone can understand — from junior devs to product managers."
3. **Guided Tours** — "AI-generated walkthroughs that teach you the codebase step by step."

### 5. Install CTA
- Headline: "Get started in 30 seconds"
- Code block:
  ```
  /plugin marketplace add Egonex-AI/Understand-Anything
  /plugin install understand-anything
  /understand
  ```
- "Works with Claude Code" note

### 6. Footer
- "Understand Anything" wordmark
- GitHub link, license
- "Built as a Claude Code plugin"

## Visual Design System

### Colors (matching dashboard)
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0a0a0a` | Page background |
| `--surface` | `#141414` | Card backgrounds |
| `--border` | `#1a1a1a` | Borders, dividers |
| `--accent` | `#d4a574` | Gold/amber primary accent |
| `--text` | `#e8e2d8` | Primary text (warm white) |
| `--text-muted` | `#8a8578` | Secondary text |

### Typography (self-hosted, with fallbacks)
- **Headings**: DM Serif Display → Georgia, "Times New Roman", serif
- **Body**: Inter → -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- **Code**: JetBrains Mono → "SF Mono", "Cascadia Code", "Fira Code", monospace
- Hero headline: ~4rem serif with subtle text-shadow glow

### Effects
- Gold glow on dashboard screenshot frame (`box-shadow` with gold at low opacity)
- Subtle noise texture overlay (SVG, matching dashboard)
- Scroll-triggered fade+slide-up animations (CSS `@keyframes` + `IntersectionObserver`)
- CTA button: gold background with hover glow pulse
- Cards: glass-morphism with `backdrop-filter: blur`
- Responsive: 768px (tablet), 480px (mobile)
