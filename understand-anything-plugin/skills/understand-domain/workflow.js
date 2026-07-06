export const meta = {
  name: 'understand-domain',
  description: 'Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing knowledge graph.',
  phases: [
    { title: 'Pre-flight',   detail: 'Resolve project root, plugin root, detect KG existence' },
    { title: 'Detect',       detail: 'Check knowledge graph status and determine execution path' },
    { title: 'Scan',         detail: 'Lightweight scan for standalone mode (Path 1)' },
    { title: 'Discovery',    detail: 'Discover business domains via domain-discoverer agent' },
    { title: 'Extraction',   detail: 'Extract domain flows via domain-flow-extractor agents (parallel)' },
    { title: 'Merge',        detail: 'Merge domain results into domain-graph.json' },
    { title: 'Validate',     detail: 'Validate domain graph structure' },
    { title: 'Save',         detail: 'Write final output and trigger dashboard' },
  ],
}

// args = { rawArgs: string, cwd: string }
// Note: args is provided by the Workflow harness and is readonly/frozen.
// Do NOT mutate args — read properties directly. Fallbacks for safety:
const _cwd = (args && args.cwd) || '.'
const _rawArgs = (args && args.rawArgs) || ''

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PREFLIGHT_SCHEMA = {
  type: 'object',
  required: ['projectRoot', 'pluginRoot', 'skillDir', 'outputLanguage', 'full', 'standalone'],
  properties: {
    error:          { type: 'string' },
    projectRoot:    { type: 'string' },
    pluginRoot:     { type: 'string' },
    skillDir:       { type: 'string' },
    outputLanguage: { type: 'string' },
    languageDirective: { type: 'string' },
    full:           { type: 'boolean' },
    standalone:     { type: 'boolean' },
  },
}

const DETECT_SCHEMA = {
  type: 'object',
  required: ['kgStatus', 'path'],
  properties: {
    kgStatus:   { type: 'string' },
    path:       { type: 'string' },
    reason:     { type: 'string' },
    platformType: { type: 'string' },
  },
}

const SCAN_SCHEMA = {
  type: 'object',
  required: ['success'],
  properties: {
    success:    { type: 'boolean' },
    fileCount:  { type: 'number' },
    entryPoints:{ type: 'array', items: { type: 'string' } },
    error:      { type: 'string' },
  },
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  required: ['domainsCount', 'domains'],
  properties: {
    domainsCount: { type: 'number' },
    domains:      { type: 'array', items: { type: 'object' } },
    refined:      { type: 'boolean' },
  },
}

const INCREMENTAL_CHECK_SCHEMA = {
  type: 'object',
  required: ['toExtract', 'skippedCount', 'docOnlyCount'],
  properties: {
    toExtract:    { type: 'array', items: { type: 'string' } },
    skippedCount: { type: 'number' },
    docOnlyCount: { type: 'number' },
    skippedDomains: { type: 'array', items: { type: 'string' } },
  },
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['extractedCount', 'skippedCount', 'failedCount'],
  properties: {
    extractedCount:   { type: 'number' },
    skippedCount:     { type: 'number' },
    failedCount:      { type: 'number' },
    extractedDomains: { type: 'array', items: { type: 'string' } },
    failedDomains:    { type: 'array', items: { type: 'string' } },
    errors:           { type: 'array', items: { type: 'string' } },
  },
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['success', 'nodesCount', 'edgesCount'],
  properties: {
    success:    { type: 'boolean' },
    nodesCount: { type: 'number' },
    edgesCount: { type: 'number' },
    error:      { type: 'string' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object',
  required: ['valid', 'issuesCount'],
  properties: {
    valid:       { type: 'boolean' },
    issuesCount: { type: 'number' },
    issues:      { type: 'array', items: { type: 'string' } },
    autoFixed:   { type: 'number' },
  },
}

const SAVE_SCHEMA = {
  type: 'object',
  required: ['success', 'outputPath'],
  properties: {
    success:    { type: 'boolean' },
    outputPath: { type: 'string' },
    nodesCount: { type: 'number' },
    edgesCount: { type: 'number' },
    domainsCount: { type: 'number' },
  },
}

// ─── Phase 0: Pre-flight ─────────────────────────────────────────────────────

phase('Pre-flight')

const preflight = await agent(
  `Resolve all configuration for understand-domain skill.

Working directory: ${_cwd}
Raw arguments: ${_rawArgs}

Complete ALL steps and return structured config.

**Step 1 — Resolve PROJECT_ROOT**
- Parse rawArgs for a non-flag token (any argument that does not start with --)
- If found, treat as target directory path
  - If relative, resolve against cwd
  - Verify path exists and is a directory (run: test -d <path>)
  - If invalid: return { error: "Invalid project directory" }
  - Set PROJECT_ROOT to resolved absolute path
- If no path argument: PROJECT_ROOT = cwd

**Step 2 — Worktree redirect**
Run:
\`COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)\`
\`GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)\`
If both succeed and COMMON_DIR != GIT_DIR:
  MAIN_ROOT = parent(COMMON_DIR)
  If MAIN_ROOT exists and UNDERSTAND_NO_WORKTREE_REDIRECT != 1:
    PROJECT_ROOT = MAIN_ROOT

**Step 3 — Resolve PLUGIN_ROOT**
Check candidates in order:
1. CLAUDE_PLUGIN_ROOT env var
2. $HOME/.understand-anything-plugin
3. Resolve from ~/.agents/skills/understand-domain symlink
4. Resolve from ~/.copilot/skills/understand-domain symlink
5. $HOME/.codex/understand-anything/understand-anything-plugin
6. $HOME/.opencode/understand-anything/understand-anything-plugin
7. $HOME/understand-anything/understand-anything-plugin

For each candidate: check if package.json AND pnpm-workspace.yaml exist
If found: PLUGIN_ROOT = candidate, SKILL_DIR = PLUGIN_ROOT/skills/understand-domain
If not found: return { error: "Cannot find plugin root" }

**Step 4 — Parse flags**
- full = rawArgs contains "--full"
- standalone = rawArgs contains "--standalone"

**Step 5 — Clean up cached intermediates if --full**
If full:
  Run: \`rm -f "$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery-checkpoint.json"\`
  Run: \`rm -f "$PROJECT_ROOT/.understand-anything/intermediate/flows-"*.json\`

**Step 6 — Create directories**
Run: \`mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate" "$PROJECT_ROOT/.understand-anything/tmp"\`

Return all fields in PREFLIGHT_SCHEMA.`,
  { schema: PREFLIGHT_SCHEMA, phase: 'Pre-flight', label: 'preflight' }
)

if (preflight.error) {
  log(`Pre-flight failed: ${preflight.error}`)
  return { success: false, error: preflight.error }
}

// ─── Phase 1: Detect ─────────────────────────────────────────────────────────

phase('Detect')

const detect = await agent(
  `Detect knowledge graph status and determine execution path.

Project root: ${preflight.projectRoot}
Plugin root: ${preflight.pluginRoot}
Skill dir: ${preflight.skillDir}
Full: ${preflight.full}
Standalone: ${preflight.standalone}

**Step 1 — Validate KG completeness**
Run: \`node "${preflight.pluginRoot}/skills/understand/validate-artifact.mjs" "${preflight.projectRoot}/.understand-anything/knowledge-graph.json" knowledge-graph:complete 2>/dev/null || echo '{"status":"missing"}'\`

**Step 2 — Determine path**
Based on KG status:
- If "complete" AND NOT full → path = "derive" (Path 2: derive from existing graph)
- If "complete" AND full → path = "derive-full" (Path 2: re-derive, bypassing checkpoints)
- If "degraded" or "stale" → path = "rebuild" (rebuild KG first, then derive)
- If "missing" AND (standalone OR full) → path = "scan" (Path 1: lightweight scan)
- If "missing" AND NOT standalone AND NOT full → return error: "Knowledge graph not found. Run /understand first, or use --standalone for lightweight scan."

**Step 3 — Platform type detection** (if KG exists)
Read project metadata from KG (project.frameworks, project.languages)
Classify into: backend, frontend, mobile-client, fullstack

Classification rules (in priority order):
| Signal | Classification |
|---|---|
| frameworks contains Android, Jetpack Compose, iOS, SwiftUI, UIKit, Flutter, React Native, HarmonyOS | mobile-client |
| frameworks contains Vue, React, Next.js, Nuxt, Svelte, uni-app AND no backend framework | frontend |
| frameworks contains Spring, Spring Boot, Express, Django, FastAPI, Gin, Rails, NestJS, Flask | backend |
| Both frontend/mobile AND backend frameworks | fullstack |
| Default | backend |

Return: kgStatus, path, reason, platformType`,
  { schema: DETECT_SCHEMA, phase: 'Detect', label: 'detect' }
)

log(`KG status: ${detect.kgStatus} → path: ${detect.path}`)

// Handle rebuild path — dispatch /understand skill first
if (detect.path === 'rebuild') {
  log('Knowledge graph is degraded — rebuilding via /understand skill')
  await agent(
    `Use the Skill tool to invoke the understand skill to rebuild the knowledge graph.
- Skill name: understand
- Arguments: ${preflight.projectRoot} --language ${preflight.outputLanguage}
Wait for completion.`,
    { phase: 'Detect', label: 'rebuild-kg' }
  )
}

// ─── Phase 2: Scan (Path 1 only) ─────────────────────────────────────────────

if (detect.path === 'scan') {
  phase('Scan')

  const scanResult = await agent(
    `Run lightweight scan for standalone domain analysis.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Run the preprocessing script:
\`python3 "${preflight.skillDir}/extract-domain-context.py" "${preflight.projectRoot}"\`

This produces ${preflight.projectRoot}/.understand-anything/intermediate/domain-context.json with:
- File tree (respecting .gitignore)
- Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs)
- File signatures (exports, imports per file)
- Code snippets for each entry point
- Project metadata (package.json, README, etc.)

After the script completes, read domain-context.json and report:
- fileCount: number of files discovered
- entryPoints: list of entry point paths

Return: success, fileCount, entryPoints`,
    { schema: SCAN_SCHEMA, phase: 'Scan', label: 'scan' }
  )

  if (!scanResult.success) {
    log(`Scan failed: ${scanResult.error}`)
    return { success: false, error: scanResult.error }
  }

  log(`Phase 2 complete. Found ${scanResult.fileCount} files, ${scanResult.entryPoints?.length || 0} entry points`)
}

// ─── Phase 3: Condense KG (Path 2 only) ──────────────────────────────────────

if (detect.path.startsWith('derive')) {
  phase('Scan')

  await agent(
    `Condense knowledge graph for domain analysis.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Run the KG condensation script:
\`python3 "${preflight.skillDir}/condense_kg_for_domain.py" "${preflight.projectRoot}"\`

This produces ${preflight.projectRoot}/.understand-anything/intermediate/kg-summary.json
— a module-level summary of the KG (~15k tokens vs 100k+ for the full KG).

Report when complete.`,
    { phase: 'Scan', label: 'condense-kg' }
  )
}

// ─── Phase 4: Discovery ──────────────────────────────────────────────────────

phase('Discovery')

let discoveryResult

const hasCheckpoint = detect.path !== 'scan' && !preflight.full
if (hasCheckpoint) {
  discoveryResult = await agent(
    `Check for domain discovery checkpoint.

Project root: ${preflight.projectRoot}

Check if ${preflight.projectRoot}/.understand-anything/intermediate/domain-discovery-checkpoint.json exists and contains valid JSON with _checkpoint.status == "complete".

If checkpoint exists:
  Read ${preflight.projectRoot}/.understand-anything/intermediate/domain-discovery.json
  Return: domainsCount, domains, refined=false

If no checkpoint: return null`,
    { phase: 'Discovery', label: 'checkpoint-check' }
  )
}

if (!discoveryResult || discoveryResult.domainsCount === undefined) {
  discoveryResult = await agent(
    `Discover business domains in the codebase.

Project root: ${preflight.projectRoot}
Plugin root: ${preflight.pluginRoot}
Skill dir: ${preflight.skillDir}
Path: ${detect.path}

Use the domain-discoverer agent definition at: ${preflight.pluginRoot}/agents/domain-discoverer.md

Context:
- If path is "scan" or "scan-standalone": read ${preflight.projectRoot}/.understand-anything/intermediate/domain-context.json
- If path starts with "derive": read ${preflight.projectRoot}/.understand-anything/intermediate/kg-summary.json

The agent should:
1. Analyze the codebase structure and identify business domains
2. Assign modules to domains
3. Write to: ${preflight.projectRoot}/.understand-anything/intermediate/domain-discovery.json

After discovery, run the audit script:
\`python3 "${preflight.skillDir}/audit_domain_discovery.py" "${preflight.projectRoot}"\`

Read ${preflight.projectRoot}/.understand-anything/intermediate/domain-audit.json
If shouldRefine is true:
  Re-dispatch domain-discoverer with audit warnings as additional context
  Backup current discovery before overwriting

Write checkpoint:
\`echo '{"_checkpoint":{"status":"complete","phase":"4a"}}' > "${preflight.projectRoot}/.understand-anything/intermediate/domain-discovery-checkpoint.json"\`

Return: domainsCount, domains, refined`,
    { schema: DISCOVERY_SCHEMA, phase: 'Discovery', label: 'discovery' }
  )
}

if (discoveryResult.domainsCount === 0) {
  log('ERROR: No domains found — cannot proceed')
  return { success: false, error: 'No business domains discovered' }
}

log(`Phase 4a complete. Discovered ${discoveryResult.domainsCount} domains${discoveryResult.refined ? ' (refined)' : ''}`)

// ─── Phase 4b: KG Splitting ──────────────────────────────────────────────────

if (detect.path.startsWith('derive')) {
  await agent(
    `Split knowledge graph by domain.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Run the splitting script:
\`python3 "${preflight.skillDir}/split_kg_by_domain.py" "${preflight.projectRoot}"\`

Verify one domain-<name>.json file exists in intermediate/ for each domain in the discovery.

Report: number of domain files created.`,
    { phase: 'Discovery', label: 'kg-split' }
  )
}

// ─── Phase 4c: Flow Extraction ───────────────────────────────────────────────

phase('Extraction')

const platformType = detect.platformType || 'backend'

// Step 1: Run deterministic fingerprint check to decide which domains need extraction
const incrementalCheck = await agent(
  `Run incremental fingerprint check to determine which domains need flow extraction.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}
Full: ${preflight.full}

Run the fingerprint check script:
\`python3 "${preflight.skillDir}/compute_domain_fingerprints.py" "${preflight.projectRoot}" --check${preflight.full ? ' --full' : ''}\`

The script outputs JSON to stdout with:
- to_extract: list of domain short names that need extraction
- skipped: list of domain short names that can be skipped (unchanged fingerprint + valid flows)
- doc_only_skipped: list of documentation-only domains skipped (for example domains whose files are only under docs/ or other documentation paths)

Read the JSON output and return:
- toExtract: the to_extract array
- skippedCount: length of skipped array
- docOnlyCount: length of doc_only_skipped array
- skippedDomains: the skipped array`,
  { schema: INCREMENTAL_CHECK_SCHEMA, phase: 'Extraction', label: 'incremental-check' }
)

log(`Incremental check: ${incrementalCheck.toExtract.length} to extract, ${incrementalCheck.skippedCount} skipped, ${incrementalCheck.docOnlyCount} doc-only skipped`)
if (incrementalCheck.skippedDomains?.length > 0) {
  log(`Skipped (unchanged): ${incrementalCheck.skippedDomains.join(', ')}`)
}

// Step 2: Extract flows only for domains that need it
let extractionResult = { extractedCount: 0, skippedCount: incrementalCheck.skippedCount, failedCount: 0 }

if (incrementalCheck.toExtract.length > 0) {
  const domainsToExtract = incrementalCheck.toExtract.join(', ')

  extractionResult = await agent(
    `Extract domain flows for the following domains ONLY: [${domainsToExtract}]

Project root: ${preflight.projectRoot}
Plugin root: ${preflight.pluginRoot}
Skill dir: ${preflight.skillDir}
Platform type: ${platformType}

Use the domain-flow-extractor agent definition at: ${preflight.pluginRoot}/agents/domain-flow-extractor.md

Load platform-specific strategy:
- backend → ${preflight.skillDir}/platforms/backend-flow.md
- frontend → ${preflight.skillDir}/platforms/frontend-flow.md
- mobile-client → ${preflight.skillDir}/platforms/mobile-flow.md
- fullstack → load both backend-flow.md and frontend-flow.md

IMPORTANT: Only extract these specific domains: [${domainsToExtract}]
All other domains have been determined to be unchanged and already have valid flows.

For each domain in [${domainsToExtract}]:
1. Read intermediate/domain-<name>.json as context
2. Dispatch domain-flow-extractor agent with domain KG subset + platform strategy
3. Agent writes to intermediate/flows-<name>.json

Run up to 10 subagents concurrently.
Retry once on failure. Skip domain if fails twice.

Return: extractedCount, skippedCount (should be ${incrementalCheck.skippedCount}), failedCount, extractedDomains (list of successfully extracted domain short names), failedDomains (list of failed domain short names), errors`,
    { schema: EXTRACTION_SCHEMA, phase: 'Extraction', label: 'extraction' }
  )
} else {
  log('All domains unchanged — skipping flow extraction entirely')
}

// Step 3: Save fingerprints only for successfully processed domains (extracted + skipped)
const successDomains = [
  ...(incrementalCheck.skippedDomains || []),
  ...(extractionResult.extractedDomains || incrementalCheck.toExtract),
]
const failedSet = new Set(extractionResult.failedDomains || [])
const domainsToSave = successDomains.filter(d => !failedSet.has(d)).join(',')

if (domainsToSave) {
  await agent(
    `Save updated domain fingerprints after extraction.

Skill dir: ${preflight.skillDir}
Project root: ${preflight.projectRoot}

Run: \`python3 "${preflight.skillDir}/compute_domain_fingerprints.py" "${preflight.projectRoot}" --save --domains "${domainsToSave}"\`

This saves fingerprints only for successfully processed domains, merging with existing fingerprints.
Failed domains are excluded so the next run will re-extract them.
Report when complete.`,
    { phase: 'Extraction', label: 'save-fingerprints' }
  )
}

log(`Phase 4c complete. Extracted: ${extractionResult.extractedCount}, Skipped: ${extractionResult.skippedCount}, Failed: ${extractionResult.failedCount}`)

if (extractionResult.failedCount > 0) {
  log(`WARNING: ${extractionResult.failedCount} domain(s) failed extraction`)
}

// ─── Phase 5: Merge ──────────────────────────────────────────────────────────

phase('Merge')

const mergeResult = await agent(
  `Merge domain analysis results.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

Run the merge script:
\`python3 "${preflight.skillDir}/merge_domain_results.py" "${preflight.projectRoot}"\`

Verify ${preflight.projectRoot}/.understand-anything/intermediate/domain-analysis.json exists.

Report: nodesCount, edgesCount

Return: success, nodesCount, edgesCount`,
  { schema: MERGE_SCHEMA, phase: 'Merge', label: 'merge' }
)

if (!mergeResult.success) {
  log(`Merge failed: ${mergeResult.error}`)
  return { success: false, error: mergeResult.error }
}

log(`Phase 5 complete. Merged: ${mergeResult.nodesCount} nodes, ${mergeResult.edgesCount} edges`)

// ─── Phase 6: Validate ───────────────────────────────────────────────────────

phase('Validate')

const validateResult = await agent(
  `Validate the domain graph.

Skill dir: ${preflight.skillDir}
Project root: ${preflight.projectRoot}

Run the validation script:
\`node "${preflight.pluginRoot}/skills/understand/validate-graph.mjs" "${preflight.projectRoot}/.understand-anything/intermediate/domain-analysis.json" "${preflight.projectRoot}/.understand-anything/intermediate/domain-validation-report.json"\`

Read the validation report and apply auto-fixes if needed.

Return: valid, issuesCount, issues, autoFixed`,
  { schema: VALIDATE_SCHEMA, phase: 'Validate', label: 'validate' }
)

if (!validateResult.valid && validateResult.issuesCount > 0) {
  log(`WARNING: ${validateResult.issuesCount} validation issues (${validateResult.autoFixed || 0} auto-fixed)`)
}

// ─── Phase 7: Save ───────────────────────────────────────────────────────────

phase('Save')

const saveResult = await agent(
  `Save the final domain graph.

Project root: ${preflight.projectRoot}
Skill dir: ${preflight.skillDir}

**Step 1 — Save domain-graph.json**
Copy the validated domain-analysis.json to: ${preflight.projectRoot}/.understand-anything/domain-graph.json
Use the auto-fixed data from the validation report if available.

**Step 2 — Cleanup**
Remove intermediate files:
- ${preflight.projectRoot}/.understand-anything/intermediate/domain-analysis.json
- ${preflight.projectRoot}/.understand-anything/intermediate/domain-context.json (if exists)

**Step 3 — Report summary**
Count nodes and edges from the saved domain-graph.json

Return: success, outputPath, nodesCount, edgesCount, domainsCount`,
  { schema: SAVE_SCHEMA, phase: 'Save', label: 'save' }
)

log(`Phase 7 complete. Domain graph saved to ${saveResult.outputPath}`)

// ─── Final Report ────────────────────────────────────────────────────────────

log(`
╔══════════════════════════════════════════════════╗
║         /understand-domain Complete               ║
╠══════════════════════════════════════════════════╣
║ Domains:    ${String(saveResult.domainsCount).padEnd(35)}║
║ Nodes:      ${String(saveResult.nodesCount).padEnd(35)}║
║ Edges:      ${String(saveResult.edgesCount).padEnd(35)}║
║ Path:       ${detect.path.padEnd(35)}║
║ Platform:   ${platformType.padEnd(35)}║
╚══════════════════════════════════════════════════╝
`)

return {
  success: true,
  domains: saveResult.domainsCount,
  nodes: saveResult.nodesCount,
  edges: saveResult.edgesCount,
  path: detect.path,
  platformType: platformType,
  outputPath: saveResult.outputPath,
}
