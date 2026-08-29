# Conversation-Language Auto-Detection for `/understand`

**Date:** 2026-06-03
**Status:** Approved — ready for implementation plan
**Scope:** `understand-anything-plugin/skills/understand/SKILL.md` (primary), `README.md` (docs)

## Problem

`/understand` generates all LLM-authored content (node summaries, tags, layer
names, guided tours, language notes) in **English by default**. The output
language is controlled solely by an explicit `--language <lang>` flag or a
previously stored `outputLanguage` value in `.understand-anything/config.json`.

The skill performs **no detection** of the language the user is actually working
in. `SKILL.md` step 3.6 (lines 142–144) hard-defaults to `en` whenever the flag
and config are both absent:

```
- If `--language` is NOT specified:
  - Check config.json for outputLanguage. If present, use that.
  - If no stored preference, default to `en` (English).
```

**Observed failure:** A user conversing entirely in Chinese ran the simplest
`/understand` command and received an English knowledge graph. They only
discovered the mismatch after paying the full cost of an analysis run (time +
tokens), then had to re-run with `--language zh`. The default is silent and
undiscoverable — nothing surfaces the language decision at the point it matters.

## Goal

On **first analysis of a project**, infer the user's working language from the
conversation and confirm it before spending the analysis budget — without
changing anything for English-speaking users (the project's core audience) and
without breaking non-interactive invocations.

## Non-Goals

- No side-by-side bilingual output. Output remains single-language per graph.
- No changes to other content-generating skills (`understand-domain`,
  `understand-knowledge`, `understand-explain`, etc.). They currently ignore
  `outputLanguage` entirely; that is a separate, known gap left for follow-up
  PRs.
- No changes to the autonomous auto-update hook path
  (`hooks/auto-update-prompt.md`). It reuses the existing graph and does not
  resolve a language, so detection never runs there. Noted as a known separate
  gap, out of scope here.
- No code, schema, or TypeScript changes. The `outputLanguage` field already
  exists in `ProjectConfig` (`packages/core/src/types.ts:119`).

## Approach (chosen)

Add conversation-language **detection as a fallback** in the resolution chain,
placed *before* the `en` default, gated behind a **first-run-only, non-English-only**
confirmation. This was selected over two alternatives discussed:

- **(A) Personal workaround** (always pass `--language zh` / hand-edit config):
  zero upstream value, rejected — the goal is a contributable fix.
- **(B, chosen) Detection-as-fallback in `SKILL.md`:** minimal diff, strictly
  better for non-English users, invisible to English users.
- **(C) Always-prompt menu on every run:** rejected — reintroduces friction and
  is the most likely to be rejected by upstream maintainers.

The confirmation gate (rather than silent application) was chosen at the user's
direction for explicitness, but constrained so it never affects English users.

## Detailed Design

### Resolution chain (rewrite of `SKILL.md` step 3.6)

Priority, highest first:

1. **`--language <lang>` flag present** → normalize via the existing
   friendly-name map (line 140), persist to `config.json`, use. *(unchanged)*
2. **`outputLanguage` present in `config.json`** → use it. *(unchanged)*
3. **First run (no flag AND no config) → NEW: detect conversation language.**
   - Infer the predominant language of the user's messages in the current
     conversation → `$DETECTED_LANG` (ISO 639-1 code, e.g. `zh`, `ja`).
   - **If `$DETECTED_LANG` is `en`, or cannot be confidently determined, or the
     conversation is mixed/ambiguous** → set `$OUTPUT_LANGUAGE = en`, persist,
     **proceed with no prompt.** (Preserves current behavior exactly for the
     core audience.)
   - **If `$DETECTED_LANG` ≠ `en`** → show the confirmation gate below, resolve
     `$OUTPUT_LANGUAGE`, persist to `config.json`.

In all branches the resolved value is written to `config.json`
(`{"outputLanguage": "<lang>"}` merged into existing config), so the gate fires
**at most once per project**.

### Confirmation gate (only when `$DETECTED_LANG` ≠ `en`)

Shown before any pipeline phase runs. `SKILL.md` describes the *intent* in one
instruction rather than hard-coding a literal prompt box — the skill is a prompt
the model interprets, so it renders the question itself at runtime. The
instruction tells the model to:

- State the detected language and ask whether to generate all content in it.
- Accept Enter / "yes" / the detected code as confirmation → `$OUTPUT_LANGUAGE = $DETECTED_LANG`.
- Accept any other language code or friendly name as an override → normalize via
  the existing friendly-name map (line ~140) and use it. This doubles as the
  "chatting in Chinese but want English docs for my team" escape hatch.

The instruction text in `SKILL.md` stays in **English** (skill prompts are
English); only the *generated content* becomes the target language.

### Edge cases

| Case | Behavior |
|---|---|
| Detection uncertain / mixed languages | Treat as `en`, proceed silently. Never block on a guess. |
| Non-interactive invocation (headless/CI, no user to answer) | Fall back to `$DETECTED_LANG` with a one-line notice instead of hanging on the gate; persist. Confirm is best-effort, never a hard block. |
| Autonomous auto-update hook | Unaffected — that path does not resolve language. |
| Detected language has a `locales/<lang>.md` file | Already wired at step 4 (line 424); no change. |
| Detected language has no locale file | `$LANGUAGE_DIRECTIVE` still applies (existing "skip silently" behavior). |

## Files Touched

- `understand-anything-plugin/skills/understand/SKILL.md` — rewrite the step 3.6
  `if --language NOT specified` branch into the 4-step resolution chain above.
  **Primary change.**
- `README.md` — add a sentence under the *Localized output* section (~line 121)
  noting first-run auto-detection.

No other files. No schema, code, or test-harness files change.

## Testing / Verification

Prompt-logic change → no unit-test hook. Verification is manual and documented
in the PR description:

1. Fresh project, no config, converse in Chinese, run `/understand` → gate
   appears → confirm → content generated in `zh`; `config.json` contains
   `outputLanguage: "zh"`.
2. Re-run in same project → no gate (config wins).
3. Fresh project, converse in English → no gate, English output (proves no
   regression for the core audience).
4. Fresh project, `--language ja` → no gate, flag wins, config stores `ja`.
5. Fresh project, override at the gate (detected `zh`, type `en`) → English
   output, config stores `en`.

## Risks & Upstream Framing

The main reviewer concern is *any* added interactivity. Mitigations are built in:
the gate is **first-run-only**, **non-English-only**, and **degrades gracefully**
when non-interactive. The PR description leads with: **"Zero behavior change for
English users; the gate only appears when the conversation is non-English and no
language has been chosen yet."**
