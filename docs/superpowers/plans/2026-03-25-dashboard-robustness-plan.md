# Design: Dashboard Robustness — Permissive Graph Loading

## Problem

When the LLM agent produces a knowledge-graph.json that deviates from the strict Zod schema, the dashboard shows a blank screen with cryptic Zod error paths. Users don't know whether it's a system bug or an agent generation issue, and their only recourse is a full re-run of `/understand`.

## Goals

1. **Maximize what the user can see** — load valid nodes/edges even if some are broken
2. **Clearly communicate generation issues** — amber warnings (not red errors) with copy-paste-friendly messages
3. **Empower targeted fixes** — users can copy the issue report and ask their agent to fix specific problems instead of a full re-run

## Design

### Three-Layer Robustness Pipeline

```
Raw JSON → Sanitize (Tier 1) → Normalize + Auto-fix (Tier 2) → Validate per-item (Tier 3) → Fatal check (Tier 4) → Dashboard
```

### Tier 1: Sanitize Silently

Common LLM quirks that are pure noise — fix without reporting.

| Issue | Fix |
|-------|-----|
| `null` on optional fields (`filePath`, `lineRange`, `description`, `languageNotes`) | Convert to `undefined` |
| Mixed-case enum strings (`"Forward"`, `"SIMPLE"`) | Lowercase before matching |

### Tier 2: Auto-fix With Info Notice

Recoverable issues — apply sensible defaults, track as `auto-corrected` issues.

| Issue | Default | Notes |
|-------|---------|-------|
| Missing `complexity` | `"moderate"` | Most common LLM omission |
| Missing `tags` | `[]` | Empty is valid |
| Missing `weight` | `0.5` | Middle of 0–1 range |
| `weight` as string | Coerce to number | e.g., `"0.8"` → `0.8` |
| Missing `direction` | `"forward"` | Safe default |
| Missing `summary` | Use node `name` | Better than empty |
| `tour: null` / `layers: null` | `[]` | Null vs empty array |
| Complexity aliases | `low/easy→simple`, `medium/intermediate→moderate`, `high/hard→complex` | |
| Direction aliases | `to/outbound→forward`, `from/inbound→backward`, `both→bidirectional` | |
| Existing node/edge type aliases | Already handled by `normalizeGraph` | No change needed |
| Missing node `type` | `"file"` | Safe fallback |
| Missing edge `type` | `"depends_on"` | Generic fallback |

### Tier 3: Drop With Warning

Can't safely guess — remove the item, track as `dropped` issue.

| Issue | Action |
|-------|--------|
| Edge references non-existent node ID | Drop edge |
| Node missing `id` | Drop node |
| Node missing `name` | Drop node |
| Edge missing `source` or `target` | Drop edge |
| Unrecognizable `type` value (not in canonical or alias list) | Drop item |
| `weight` not coercible to number | Drop edge |

### Tier 4: Fatal

Graph is unsalvageable — show red error banner.

| Condition | Message |
|-----------|---------|
| 0 valid nodes after filtering | "No valid nodes found in knowledge graph" |
| Missing `project` metadata entirely | "Missing project metadata" |
| Input is not an object / not valid JSON | "Invalid input format" |

### Return Type

```typescript
interface GraphIssue {
  level: 'auto-corrected' | 'dropped' | 'fatal';
  category: string;      // e.g., "missing-field", "invalid-reference", "type-coercion"
  message: string;       // human-readable, copy-paste friendly
  path?: string;         // e.g., "nodes[3].complexity"
}

interface ValidationResult {
  success: boolean;
  data?: KnowledgeGraph;
  issues: GraphIssue[];
  fatal?: string;
}
```

### Dashboard UI: WarningBanner Component

**New component** in `packages/dashboard/src/components/WarningBanner.tsx`.

**Visual design:**
- **Amber/gold theme** — `bg-amber-900/20`, `border-amber-700`, `text-amber-200`
- Matches dashboard's gold accent aesthetic; signals "generation quality issue" not "system crash"
- **Collapsed by default** — summary line: "Knowledge graph loaded with 5 auto-corrections and 2 dropped items"
- **Expandable** — click to reveal categorized issue list
- **Copy button** — one-click copies the full issue report as a pre-formatted message
- **Actionable footer** — tells users to copy issues and ask their agent to fix them

**Copy-paste output format:**
```
The following issues were found in your knowledge-graph.json.
These are LLM generation errors — not a system bug.
You can ask your agent to fix these specific issues in the knowledge-graph.json file:

[Auto-corrected] nodes[3] ("AuthService"): missing "complexity" — defaulted to "moderate"
[Auto-corrected] nodes[7] ("utils.ts"): missing "tags" — defaulted to []
[Auto-corrected] edges[12]: weight was string "0.8" — coerced to number
[Dropped] edges[5]: target "file:src/nonexistent.ts" does not exist in nodes
[Dropped] nodes[14]: missing required "id" field — cannot recover
```

**Fatal errors** stay red (`bg-red-900/30`) with message: "Knowledge graph is unsalvageable: [reason]. Please re-run `/understand` to generate a new one."

**Existing red error banner** for network/JSON-parse errors stays as-is (those ARE system/infra issues).

### App.tsx Changes

- On `result.success === true` with `result.issues.length > 0`: show `WarningBanner` with issues, load graph normally
- On `result.fatal`: show existing red banner with fatal message
- `console.warn` for auto-corrected items, `console.error` for dropped items

### Test Coverage

All in `packages/core/src/__tests__/schema.test.ts`:

- **Tier 1:** `null` optional fields silently become `undefined`
- **Tier 2:** Missing `complexity`/`tags`/`weight`/`direction`/`summary` get defaults; issues tracked
- **Tier 2:** String `weight` coerced; complexity/direction aliases mapped
- **Tier 3:** Dangling edge references dropped; nodes missing `id` dropped; issues recorded
- **Tier 4:** Empty graph after filtering → fatal; missing `project` → fatal
- **Integration:** Graph with mixed good/bad nodes → loads with correct node count + correct issues list

### Files Changed

| File | Change |
|------|--------|
| `packages/core/src/schema.ts` | Sanitize, expanded normalize, permissive validate, new types |
| `packages/dashboard/src/components/WarningBanner.tsx` | New component |
| `packages/dashboard/src/App.tsx` | Wire issues to WarningBanner |
| `packages/core/src/__tests__/schema.test.ts` | Tests for all tiers |

### Files NOT Changed

- Agent prompts (can be tightened later as a separate effort)
- GraphView / store logic (they already handle valid `KnowledgeGraph` objects)
- Existing node/edge type alias maps (preserved, extended around)
