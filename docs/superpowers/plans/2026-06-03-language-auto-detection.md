# Conversation-Language Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the first `/understand` run in a project, detect the user's conversation language and confirm it before generating — without changing anything for English users.

**Architecture:** A pure prompt-logic change. The entire language decision lives in one place — `SKILL.md` step 3.6. We expand the `if --language NOT specified` branch into a resolution chain that adds conversation-language detection + a non-English-only, first-run-only confirmation gate before the existing `en` default. The resolved value is persisted to `config.json` so the gate fires at most once per project. A README sentence documents it.

**Tech Stack:** Markdown skill prompt (`SKILL.md`), Markdown docs (`README.md`). No code, no schema, no TypeScript. There is no automated-test hook for skill-prompt behavior, so verification is the manual scenario walkthrough in Task 3 (this matches how the existing `--language` flag is verified).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `understand-anything-plugin/skills/understand/SKILL.md` | The `/understand` skill prompt; step 3.6 resolves `$OUTPUT_LANGUAGE`. | Rewrite the `If --language is NOT specified` sub-block (currently lines 142–144). |
| `README.md` | User-facing docs; *Localized output* section (~line 121). | Add one paragraph describing first-run auto-detection. |

No other files. The `outputLanguage` field already exists in `packages/core/src/types.ts:119`; the `locales/<lang>.md` injection at `SKILL.md` step 4 (line ~424) and the `$LANGUAGE_DIRECTIVE` template (lines ~148–151) are unchanged and require no edits.

---

## Task 1: Expand the language-resolution branch in SKILL.md

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (step 3.6, the `If --language is NOT specified` sub-block)

- [ ] **Step 1: Confirm the current text is unchanged**

Run: `sed -n '142,144p' understand-anything-plugin/skills/understand/SKILL.md`

Expected output (exactly these three lines):
```
    - If `--language` is NOT specified:
      - Check `$PROJECT_ROOT/.understand-anything/config.json` for an existing `outputLanguage` field. If present, use that.
      - If no stored preference, default to `en` (English).
```

If the text differs, STOP and re-read step 3.6 to find the equivalent block before editing — line numbers may have drifted.

- [ ] **Step 2: Replace the block**

Use the Edit tool on `understand-anything-plugin/skills/understand/SKILL.md`.

`old_string` (match exactly, including leading spaces):
```
    - If `--language` is NOT specified:
      - Check `$PROJECT_ROOT/.understand-anything/config.json` for an existing `outputLanguage` field. If present, use that.
      - If no stored preference, default to `en` (English).
```

`new_string` (describes the confirmation *intent* in one instruction rather than
hard-coding a literal prompt box — the skill is a prompt the model interprets):
```
    - If `--language` is NOT specified:
      - **Stored preference wins.** If `$PROJECT_ROOT/.understand-anything/config.json` has an `outputLanguage` field, set `$OUTPUT_LANGUAGE` to it and skip the rest.
      - **Otherwise detect (first run only).** Infer the predominant language of the user's conversation as an ISO 639-1 code (`$DETECTED_LANG`). If it is `en` or cannot be confidently determined, set `$OUTPUT_LANGUAGE=en` and proceed silently — no prompt (English users see no change).
      - **If `$DETECTED_LANG` ≠ `en`, confirm once before analyzing:** tell the user you detected `<language>` and ask whether to generate all content in it; they press Enter/"yes" to accept, or type another language code/name to override (normalize via the friendly-name map above). If running non-interactively (no reply possible), skip the wait, use `$DETECTED_LANG`, and print a one-line notice instead of blocking.
      - **Persist** the resolved `$OUTPUT_LANGUAGE` (including `en`) into `config.json` so it never re-prompts for this project.
```

- [ ] **Step 3: Verify the edit landed and is well-formed**

Run: `sed -n '142,170p' understand-anything-plugin/skills/understand/SKILL.md`

Expected: the new multi-level block is present; the very next content after it is the unchanged `- If `--language` IS specified:` line. Confirm no duplicate `default to en` line remains.

Run: `grep -c 'default to \`en\`' understand-anything-plugin/skills/understand/SKILL.md`
Expected: `0` (the old standalone default line is gone; the new wording says "set `$OUTPUT_LANGUAGE` to `en`").

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(understand): detect conversation language on first run

Expand SKILL.md step 3.6 with conversation-language detection as a
fallback before the en default, gated behind a first-run-only,
non-English-only confirmation. Resolved value is persisted to
config.json so the gate fires at most once. English users see no change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Document first-run auto-detection in README

**Files:**
- Modify: `README.md` (*Localized output* section, before the "The `--language` parameter affects:" line, ~line 130)

- [ ] **Step 1: Confirm the anchor line exists**

Run: `grep -n 'The `--language` parameter affects:' README.md`
Expected: one match around line 130.

- [ ] **Step 2: Insert the auto-detection paragraph**

Use the Edit tool on `README.md`.

`old_string`:
```
The `--language` parameter affects:
```

`new_string`:
```
On the **first run** in a project — when you don't pass `--language` and no language is stored yet — `/understand` detects the language you're conversing in. If it isn't English, it asks you to confirm (or override) before generating; English conversations are unaffected. Your choice is saved to `.understand-anything/config.json` and reused on every later run.

The `--language` parameter affects:
```

- [ ] **Step 3: Verify**

Run: `grep -n 'first run' README.md`
Expected: one match with the new sentence, located just above "The `--language` parameter affects:".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note first-run conversation-language auto-detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Manual verification (no automated test hook exists)

There is no unit-test harness for skill-prompt behavior. Verify by reasoning through each scenario against the edited step 3.6 text and confirming the prompt logic produces the right `$OUTPUT_LANGUAGE` and `config.json` write. Record the result of each in the PR description.

- [ ] **Step 1: Walk the five scenarios**

For each, trace the edited step 3.6 and confirm the expected outcome:

| # | Situation (fresh project, no `config.json`) | Expected |
|---|---|---|
| 1 | Conversation in Chinese, run `/understand` | Gate appears → confirm → `$OUTPUT_LANGUAGE=zh`; `config.json` gets `"outputLanguage":"zh"` |
| 2 | Re-run in the same project (config now has `zh`) | No gate (stored preference wins); generates `zh` |
| 3 | Conversation in English, run `/understand` | No gate; `$OUTPUT_LANGUAGE=en`; English output (no regression) |
| 4 | `--language ja` on a fresh project | No gate (flag wins); `config.json` gets `"outputLanguage":"ja"` |
| 5 | Detected `zh`, user types `en` at the gate | `$OUTPUT_LANGUAGE=en`; `config.json` gets `"outputLanguage":"en"` |

- [ ] **Step 2: Confirm no-regression invariant**

Re-read the edited block and confirm: there is NO code path where an English-only conversation with no flag/config produces a prompt. (Scenario 3 must be silent.) This is the single most important property for upstream acceptance.

- [ ] **Step 3: Optional live smoke test**

If you want a real run: in a throwaway repo with no `.understand-anything/config.json`, converse briefly in Chinese, run `/understand`, and confirm the gate appears and `config.json` is written with `outputLanguage: "zh"` after confirming. (Skip if a full analysis run is too costly; the trace in Step 1 is sufficient for the PR.)

---

## Task 4: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/understand-language-auto-detection
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --title "feat(understand): detect conversation language on first run" --body "$(cat <<'EOF'
## What

On the first `/understand` run in a project (no `--language` flag, no stored `outputLanguage`), the skill now detects the language of the conversation and — **only when it is not English** — asks the user to confirm or override before generating. The choice is persisted to `.understand-anything/config.json` and the gate never fires again.

## Why

The output language defaulted silently to English. A user conversing in Chinese would run the simplest command and only discover the English output after paying the full cost of an analysis run, then had to re-run with `--language zh`.

## Zero change for English users

The confirmation gate fires **only** when the detected language is non-English and no language has been chosen yet. English conversations follow the exact same silent `en` path as before. `--language` flag and stored config both take priority over detection.

## Scope

- Only `understand-anything-plugin/skills/understand/SKILL.md` step 3.6 + a README sentence.
- No code/schema changes. Other skills and the auto-update hook are unchanged (separate known gaps).
- Non-interactive invocations fall back to the detected language with a notice instead of blocking.

Design + plan: `docs/superpowers/specs/2026-06-03-language-auto-detection-design.md`, `docs/superpowers/plans/2026-06-03-language-auto-detection.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Resolution chain (param > config > detect > en) → Task 1 Step 2. ✓
- Non-English-only, first-run-only gate → Task 1 Step 2 (gate "shown ONLY when `$DETECTED_LANG` ≠ `en`"). ✓
- Persist resolved value incl. `en` → Task 1 Step 2 ("Persist the resolved value"). ✓
- Edge: uncertain/mixed → `en` silent → Task 1 Step 2 first bullet. ✓
- Edge: non-interactive fallback → Task 1 Step 2 ("Non-interactive fallback"). ✓
- Edge: auto-update hook unaffected → no task needed (no code path touched); noted here. ✓
- `locales/<lang>.md` already wired → unchanged, noted in File Structure. ✓
- README sentence → Task 2. ✓
- Manual verification scenarios (5) → Task 3. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" left vague — every edge case has explicit resolved behavior. The `<language name>`/`<code>` tokens inside the gate are intentional template placeholders the skill fills at runtime, not plan gaps. ✓

**Type/name consistency:** Variable names used consistently — `$OUTPUT_LANGUAGE`, `$DETECTED_LANG`, `outputLanguage` (config key), `--language` (flag). These match the existing names in SKILL.md step 3.6. ✓
