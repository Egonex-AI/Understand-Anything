export const meta = {
  name: 'understand-wiki',
  description: 'Generate Wiki + business-landscape for microservice projects',
  phases: [
    { title: 'Setup',          detail: 'Resolve mode, plugin root, service list' },
    { title: 'Detect',         detail: 'Git pull + change detection — skip unchanged services' },
    { title: 'Prepare',        detail: 'Ensure KG and DG exist per service (parallel pipeline)' },
    { title: 'Wiki Generation',detail: 'Generate wiki pages per domain (parallel pipeline)' },
    { title: 'Assembly',       detail: 'Validate, index, and assemble wiki output (parallel pipeline)' },
    { title: 'Cross-Service',  detail: 'Cross-service relationships and parent wiki' },
    { title: 'Business',       detail: 'Cross-facet domain matching and interaction documents' },
    { title: 'Finalize',       detail: 'Completeness verification, cleanup, and summary' },
  ],
}

// args = { rawArgs: string, cwd: string }

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SETUP_SCHEMA = {
  type: 'object',
  required: ['mode', 'projectRoot', 'pluginRoot', 'skillDir', 'businessSkillDir',
             'outputLanguage', 'repoType', 'dryRun', 'force', 'full', 'review', 'continueOnError',
             'businessRoot'],
  properties: {
    error:             { type: 'string' },
    mode:              { type: 'string' },
    dryRun:            { type: 'boolean' },
    dryRunOutput:      { type: 'string' },
    projectRoot:       { type: 'string' },
    serviceRoot:       { type: 'string' },
    serviceName:       { type: 'string' },
    servicesToGenerate:{ type: 'array', items: { type: 'string' } },
    pluginRoot:        { type: 'string' },
    skillDir:          { type: 'string' },
    businessSkillDir:  { type: 'string' },
    outputLanguage:    { type: 'string' },
    languageDirective: { type: 'string' },
    localeGuidance:    { type: 'string' },
    repoType:          { type: 'string' },
    force:             { type: 'boolean' },
    full:              { type: 'boolean' },
    review:            { type: 'boolean' },
    continueOnError:   { type: 'boolean' },
    rpcAnnotationsJson:{ type: 'string' },
    serverWikiAvailable:{ type: 'boolean' },
    serverFacetPath:   { type: 'string' },
    wikiSessionId:     { type: 'string' },
    businessRoot:      { type: 'string' },
  },
}

const KG_STAGE_SCHEMA = {
  type: 'object',
  required: ['serviceName', 'success'],
  properties: {
    serviceName: { type: 'string' },
    success:     { type: 'boolean' },
    error:       { type: 'string' },
  },
}

const DG_STAGE_SCHEMA = {
  type: 'object',
  required: ['serviceName', 'success', 'domainsAll', 'domainsToGenerate'],
  properties: {
    serviceName:         { type: 'string' },
    success:             { type: 'boolean' },
    error:               { type: 'string' },
    alreadyUpToDate:     { type: 'boolean' },
    incremental:         { type: 'boolean' },
    domainsAll:          { type: 'array', items: { type: 'string' } },
    domainsToGenerate:   { type: 'array', items: { type: 'string' } },
    domainsRemoved:      { type: 'array', items: { type: 'string' } },
    serviceOverviewDirty:{ type: 'boolean' },
  },
}

const WIKI_STAGE_SCHEMA = {
  type: 'object',
  required: ['serviceName', 'success'],
  properties: {
    serviceName:      { type: 'string' },
    success:          { type: 'boolean' },
    skipped:          { type: 'boolean' },
    domainsGenerated: { type: 'number' },
    error:            { type: 'string' },
  },
}

const ASSEMBLY_STAGE_SCHEMA = {
  type: 'object',
  required: ['serviceName', 'success'],
  properties: {
    serviceName: { type: 'string' },
    success:     { type: 'boolean' },
    skipped:     { type: 'boolean' },
    error:       { type: 'string' },
  },
}

const INTEGRATED_SCHEMA = {
  type: 'object',
  required: ['integratedServices'],
  properties: {
    integratedServices: { type: 'array', items: { type: 'string' } },
  },
}

const HASH_CHECK_SCHEMA = {
  type: 'object',
  required: ['skip'],
  properties: {
    skip:           { type: 'boolean' },
    allHashesJson:  { type: 'string' },
  },
}

const BUSINESS_SETUP_SCHEMA = {
  type: 'object',
  required: ['skip'],
  properties: {
    skip:            { type: 'boolean' },
    reason:          { type: 'string' },
    availableFacets: { type: 'array', items: { type: 'string' } },
    candidates:      {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'serverDomain', 'clientDomain'],
        properties: {
          id:              { type: 'string' },
          serverDomain:    { type: 'string' },
          clientDomain:    { type: 'string' },
          serverSummary:   { type: 'string' },
          clientSummary:   { type: 'string' },
          serverEndpoints: { type: 'array', items: { type: 'string' } },
          clientApiCalls:  { type: 'array', items: { type: 'string' } },
        },
      },
    },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'name'],
        properties: {
          slug:          { type: 'string' },
          name:          { type: 'string' },
          serverDomainRef: { type: 'string' },
          clientDomainRef: { type: 'string' },
        },
      },
    },
  },
}

const MATCH_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'match', 'confidence'],
  properties: {
    id:         { type: 'string' },
    match:      { type: 'boolean' },
    confidence: { type: 'number' },
    reason:     { type: 'string' },
    skipped:    { type: 'boolean' },
  },
}

const STRATEGY_B_SCHEMA = {
  type: 'object',
  required: ['associationsFound'],
  properties: {
    associationsFound: { type: 'number' },
  },
}

const BUSINESS_ASSEMBLE_SCHEMA = {
  type: 'object',
  required: ['assembledDomains'],
  properties: {
    assembledDomains: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'name'],
        properties: {
          slug:            { type: 'string' },
          name:            { type: 'string' },
          serverDomainRef: { type: 'string' },
          clientDomainRef: { type: 'string' },
        },
      },
    },
  },
}

const INTERACTION_DOC_SCHEMA = {
  type: 'object',
  required: ['slug', 'success'],
  properties: {
    slug:    { type: 'string' },
    success: { type: 'boolean' },
    status:  { type: 'string' },
    error:   { type: 'string' },
  },
}

const FINAL_REPORT_SCHEMA = {
  type: 'object',
  required: ['success'],
  properties: {
    success:                  { type: 'boolean' },
    mode:                     { type: 'string' },
    servicesGenerated:        { type: 'number' },
    servicesTotal:            { type: 'number' },
    domainsTotal:             { type: 'number' },
    flowsTotal:               { type: 'number' },
    crossServiceRelationships:{ type: 'number' },
    businessDomainsMatched:   { type: 'number' },
    businessStatus:           { type: 'string' },
    language:                 { type: 'string' },
    reviewVerdict:            { type: 'string' },
    errors:                   { type: 'array', items: { type: 'string' } },
    warnings:                 { type: 'array', items: { type: 'string' } },
  },
}

const GIT_DETECT_SCHEMA = {
  type: 'object',
  required: ['changedServices', 'unchangedServices'],
  properties: {
    changedServices:   { type: 'array', items: { type: 'string' } },
    unchangedServices: { type: 'array', items: { type: 'string' } },
    details: {
      type: 'array',
      items: {
        type: 'object',
        required: ['serviceName', 'changed'],
        properties: {
          serviceName:  { type: 'string' },
          changed:      { type: 'boolean' },
          reason:       { type: 'string' },
          kgCommit:     { type: 'string' },
          headCommit:   { type: 'string' },
          changedFiles: { type: 'number' },
        },
      },
    },
  },
}

// ─── Phase 0: Setup ───────────────────────────────────────────────────────────
phase('Setup')

const setup = await agent(
  `You are the understand-wiki setup agent. Resolve all configuration needed to run.

Working directory: ${args.cwd}
Raw arguments: ${args.rawArgs || ''}

Complete ALL steps and return structured config.

**Step 1 — Session ID**
Run: \`echo "$$-$(date +%s)"\` → wikiSessionId.

**Step 2 — Parse flags**
- dryRun       = rawArgs contains "--dry-run"
- force        = rawArgs contains "--force"
- full         = rawArgs contains "--full"
- review       = rawArgs contains "--review"
- continueOnError = rawArgs does NOT contain "--continue-on-error=false"
- mode: "--service=<name>" or "--batch" → batch; otherwise → single
- If "--service=<name>": extract serviceName, SERVICE_ROOT = cwd/serviceName

**Step 3 — Resolve paths (mode-dependent)**
Note: each microservice is its own independent git repo; PROJECT_ROOT itself may not be a git repo.
Always: PROJECT_ROOT = cwd (the directory where the skill is invoked)
Single: SERVICE_ROOT = cwd, SERVICE_NAME = basename(cwd)
        (unless --service=X: SERVICE_ROOT = PROJECT_ROOT/X, SERVICE_NAME = X)
Batch:  PROJECT_ROOT = cwd
Always: BUSINESS_ROOT = parent directory of PROJECT_ROOT = \`dirname "${args.cwd}"\`
        (This is where understand-business will run — the parent containing backend/, mobile/, etc.)

**Step 4 — Worktree redirect** (skip if PROJECT_ROOT is not a git repo)
\`COMMON=$(git -C "${args.cwd}" rev-parse --git-common-dir 2>/dev/null)\`
\`GITD=$(git -C "${args.cwd}" rev-parse --git-dir 2>/dev/null)\`
If both commands succeed and COMMON != GITD: PROJECT_ROOT = parent(COMMON).

**Step 5 — Resolve PLUGIN_ROOT** (first candidate where package.json AND pnpm-workspace.yaml exist):
1. $HOME/.understand-anything-plugin
2. dirname(dirname(realpath ~/.agents/skills/understand-wiki 2>/dev/null))
3. dirname(dirname(realpath ~/.copilot/skills/understand-wiki 2>/dev/null))
4. $HOME/.codex/understand-anything/understand-anything-plugin
5. $HOME/.opencode/understand-anything/understand-anything-plugin
6. $HOME/understand-anything/understand-anything-plugin

Set skillDir = PLUGIN_ROOT/skills/understand-wiki
Set businessSkillDir = PLUGIN_ROOT/skills/understand-business
If not found: return { error: "Cannot find plugin root" }.

**Step 6 — Dry-run early exit**
If dryRun=true: run \`python3 "$skillDir/wiki_dry_run.py" "$serviceRootOrProjectRoot"\`
Return { dryRun: true, dryRunOutput: "<output>", ...minimal fields }.

**Step 7 — Language**
Parse "--language <lang>" from rawArgs, normalize (chinese→zh etc.).
If specified: write to config.json "outputLanguage".
If not: read from config.json, default "en".
Build languageDirective string if non-English.
If non-English: read $skillDir/locales/<lang>.md → localeGuidance (empty if missing).

**Step 8 — Repo type + server wiki (for mobile)**
Parse "--repo-type <type>" (default "backend").
If mobile: check system.json for server facet → serverWikiAvailable, serverFacetPath.

**Step 9 — RPC annotations**
Read "rpcAnnotations" from config.json → rpcAnnotationsJson (JSON string, null if absent).

**Step 10 — Service list (batch only)**
\`\`\`bash
python3 -c "
import os, json

project_root = '${args.cwd}'
exclude = {'node_modules', 'dist', 'build', 'target', 'docs', 'scripts', 'tools'}
service_markers = {'.understand-anything', 'pom.xml', 'package.json', 'go.mod', 'Cargo.toml'}

try:
    cfg = json.load(open(os.path.join(project_root, '.understand-anything', 'config.json')))
    exclude.update(cfg.get('excludeServices', []))
except Exception:
    pass

services = []
for entry in sorted(os.listdir(project_root)):
    if entry.startswith('.') or entry in exclude:
        continue
    path = os.path.join(project_root, entry)
    if os.path.isdir(path) and any(os.path.exists(os.path.join(path, m)) for m in service_markers):
        services.append(entry)

print(json.dumps(services))
"
\`\`\`

Filter services to those needing generation: no wiki/meta.json at \`PROJECT_ROOT/<svc>/.understand-anything/wiki/meta.json\` OR --full OR stale commit hash.
Return servicesToGenerate (filtered list) and businessRoot = BUSINESS_ROOT computed in Step 3.`,
  { schema: SETUP_SCHEMA, phase: 'Setup', label: 'setup' }
)

if (setup.error) {
  log(`Setup failed: ${setup.error}`)
  return { success: false, error: setup.error }
}

if (setup.dryRun) {
  log('Dry-run complete — no wiki files written.')
  log(setup.dryRunOutput || '')
  return { success: true, dryRun: true }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build the KG-stage agent prompt for a given service
function kgPrompt(svc) {
  const svcRoot = setup.mode === 'batch'
    ? `${setup.projectRoot}/${svc}`
    : setup.serviceRoot
  return `Ensure the knowledge graph (KG) is complete and current for service "${svc}".
Do NOT generate wiki content — only ensure the KG is ready.

Service root: ${svcRoot}
Plugin root: ${setup.pluginRoot}
Skill dir: ${setup.skillDir}
Output language: ${setup.outputLanguage}
Force: ${setup.force}

**Step 1 — Validate KG completeness**
\`node "${setup.skillDir}/../understand/validate-artifact.mjs" "${svcRoot}/.understand-anything/knowledge-graph.json" knowledge-graph:complete 2>/dev/null || echo '{"status":"missing"}'\`

**Step 2 — Build KG if missing or degraded**
If status != "complete":
  Read ${setup.pluginRoot}/skills/understand/SKILL.md and follow its instructions.
  Working dir: ${svcRoot}
  Args: --language ${setup.outputLanguage}
  Wait for completion. Re-validate. Retry once on failure.
  On second failure: return { serviceName: "${svc}", success: false, error: "KG build failed after retry" }.

**Step 3 — Staleness check** (skip if --force=${setup.force})
${setup.force
    ? `force=true: skip staleness check.`
    : `Run: \`python3 "${setup.skillDir}/wiki_staleness_check.py" "${svcRoot}" 2>/dev/null\`
  If kg_stale=true: re-run /understand (incremental), re-validate. On failure after retry: return error.`}

Return { serviceName: "${svc}", success: true }.`
}

// Build the DG-stage agent prompt for a given service
function dgPrompt(svc) {
  const svcRoot = setup.mode === 'batch'
    ? `${setup.projectRoot}/${svc}`
    : setup.serviceRoot
  return `Ensure the domain graph (DG) is complete for service "${svc}".
Also determine the wiki generation state (full / incremental / up-to-date).

Service root: ${svcRoot}
Plugin root: ${setup.pluginRoot}
Skill dir: ${setup.skillDir}
Force: ${setup.force}  Full: ${setup.full}

**Step 1 — Validate DG completeness**
\`node "${setup.skillDir}/../understand/validate-artifact.mjs" "${svcRoot}/.understand-anything/domain-graph.json" domain-graph:complete 2>/dev/null || echo '{"status":"missing"}'\`

**Step 2 — Build DG if missing or degraded**
If status != "complete":
  Read ${setup.pluginRoot}/skills/understand-domain/SKILL.md and follow its instructions.
  Working dir: ${svcRoot}. Wait. Re-validate. Retry once.
  On failure: return { serviceName: "${svc}", success: false, error: "DG build failed" }.

**Step 3 — DG staleness check** (skip if force=${setup.force})
${setup.force
    ? `force=true: skip.`
    : `Check staleness (run wiki_staleness_check.py if not already available from KG stage context).
  If dg_stale=true: re-run /understand-domain. Re-validate. On failure: return error.`}

**Step 4 — Save DG snapshot** (for incremental diff on next run)
If wiki/meta.json exists:
  \`mkdir -p "${svcRoot}/.understand-anything/wiki" && cp "${svcRoot}/.understand-anything/domain-graph.json" "${svcRoot}/.understand-anything/wiki/domain-graph.snapshot.json"\`

**Step 5 — Wiki state check**
If wiki/meta.json exists AND NOT full=${setup.full}:
  WIKI_COMMIT = read from meta.json "gitCommitHash"
  HEAD = \`git -C "${svcRoot}" rev-parse HEAD 2>/dev/null\`
  If WIKI_COMMIT == HEAD: return { ..., alreadyUpToDate: true, domainsAll: [...], domainsToGenerate: [] }
  Else run: \`python3 "${setup.skillDir}/wiki_diff_domains.py" --old "${svcRoot}/.understand-anything/wiki/domain-graph.snapshot.json" --new "${svcRoot}/.understand-anything/domain-graph.json" --kg "${svcRoot}/.understand-anything/knowledge-graph.json" 2>&1\`
  Parse: added+modified → dirtyDomains, removed → domainsRemoved, serviceOverviewDirty, unchanged.
  If >80% modified → full mode (domainsToGenerate = all).
  If 0 dirty → domainsToGenerate = [] (assembly-only incremental).
  Else → domainsToGenerate = dirty domains only.
Else (no existing wiki OR --full): full mode.

**Step 6 — Extract full domain list from DG**
\`python3 -c "import json; dg=json.load(open('${svcRoot}/.understand-anything/domain-graph.json')); ids=[n['id'] for n in dg.get('nodes',[]) if n.get('type')=='domain']; print(json.dumps(ids))"\`
Set domainsAll to this list. If full mode: domainsToGenerate = domainsAll.

**Step 7 — Copy unchanged domain files** (incremental with dirty subset only)
If incremental AND domainsToGenerate is a proper subset of domainsAll:
  \`mkdir -p "${svcRoot}/.understand-anything/intermediate/wiki/domains"\`
  Copy each domain slug NOT in domainsToGenerate from wiki/domains/ to intermediate/wiki/domains/.

Return { serviceName, success, domainsAll, domainsToGenerate, domainsRemoved, incremental, alreadyUpToDate, serviceOverviewDirty }.`
}

// Build the wiki-content stage agent prompt
function wikiPrompt(svc, dgResult) {
  const svcRoot = setup.mode === 'batch'
    ? `${setup.projectRoot}/${svc}`
    : setup.serviceRoot
  const domains = JSON.stringify(dgResult.domainsToGenerate || [])
  const domainsRemoved = JSON.stringify(dgResult.domainsRemoved || [])
  return `Generate wiki content for service "${svc}".
You are a content-generation agent. Do NOT run assembly scripts — those run in the next stage.

Service root: ${svcRoot}
Service name: ${svc}
Skill dir: ${setup.skillDir}
Plugin root: ${setup.pluginRoot}
Output language: ${setup.outputLanguage}
${setup.languageDirective ? `Language directive: ${setup.languageDirective}` : ''}
${setup.localeGuidance ? `\n## Wiki Locale Guidance\n${setup.localeGuidance}` : ''}
Repo type: ${setup.repoType}
RPC annotations: ${setup.rpcAnnotationsJson || 'null'}
${setup.serverWikiAvailable ? `Server wiki available: true\nServer facet path: ${setup.serverFacetPath}` : ''}
Domains to generate: ${domains}
Domains to remove: ${domainsRemoved}
Service overview dirty: ${dgResult.serviceOverviewDirty || false}

**Step 1 — Create output directory**
\`mkdir -p "${svcRoot}/.understand-anything/intermediate/wiki/domains"\`

**Step 2 — Generate service overview** (run if full mode OR serviceOverviewDirty)
\`python3 "${setup.skillDir}/generate_service_overview.py" "${svcRoot}"\`
Produces intermediate/wiki/service.json with name, techStack, modules, entryPoints from KG.

**Step 3 — Dispatch wiki-workers per domain** (up to 5 concurrently)
For each domain ID in domainsToGenerate:
  a. Build domain-scoped KG:
     \`python3 "${setup.skillDir}/wiki_kg_filter.py" "${svcRoot}/.understand-anything/knowledge-graph.json" "${svcRoot}/.understand-anything/domain-graph.json" <domainId> --max-nodes=200\`
  b. Read full DG: \`cat "${svcRoot}/.understand-anything/domain-graph.json"\`
  c. Dispatch wiki-worker leaf agent (read ${setup.pluginRoot}/agents/wiki-worker.md):
     Pass: serviceRoot=${svcRoot}, serviceName=${svc}, target domainId, filtered KG, full DG,
           outputLanguage, languageDirective, repoType, rpcAnnotations.
     wiki-worker writes to: intermediate/wiki/domains/<slug>.json
  d. Retry once on failure. On second failure: log warning, skip domain.

**Step 4 — Remove obsolete domain files** (incremental cleanup)
For each domain ID in domainsRemoved:
  slug = domainId.replace("domain:", "")
  \`rm -f "${svcRoot}/.understand-anything/intermediate/wiki/domains/$slug.json"\`

**Step 5 — Enrich service.json description**
Read all generated domain pages (intermediate/wiki/domains/*.json), extract name+summary.
Rewrite "description" field in intermediate/wiki/service.json to a professional 2–3 sentence summary.
Language: ${setup.outputLanguage}.

Return { serviceName: "${svc}", success: true, domainsGenerated: <count> }.`
}

// Build the assembly stage agent prompt
function assemblyPrompt(svc) {
  const svcRoot = setup.mode === 'batch'
    ? `${setup.projectRoot}/${svc}`
    : setup.serviceRoot
  const svcBaseName = svc.includes('/') ? svc.split('/').pop() : svc
  return `Run the deterministic assembly pipeline for service "${svcBaseName}".
Do NOT generate wiki content — only assemble what is already in intermediate/wiki/.

Service root: ${svcRoot}
Service name: ${svcBaseName}
Skill dir: ${setup.skillDir}
Output language: ${setup.outputLanguage}
Wiki session ID: ${setup.wikiSessionId}

**Script 0 — Endpoint extraction** (on failure: log warning and continue)
\`mkdir -p "${svcRoot}/.understand-anything/intermediate/wiki/endpoints"\`
\`python3 "${setup.skillDir}/extract-endpoints.py" "${svcRoot}/.understand-anything/tmp" "${svcBaseName}" --output="${svcRoot}/.understand-anything/intermediate/wiki/endpoints/${svcBaseName}.json" --project-root="${svcRoot}" --knowledge-graph="${svcRoot}/.understand-anything/knowledge-graph.json"\`

**Script 0b — LLM description enrichment** (only if endpoint file exists; on failure: continue)
1. \`python3 "${setup.skillDir}/enrich-endpoint-descriptions.py" generate-prompt "${svcRoot}/.understand-anything/intermediate/wiki/endpoints/${svcBaseName}.json" --project-root="${svcRoot}" --output="${svcRoot}/.understand-anything/tmp/ua-ep-prompt-${svcBaseName}.json"\`
2. Read prompt file. Generate concise descriptions (≤30 chars) for each listed method. Write JSON array to ${svcRoot}/.understand-anything/tmp/ua-ep-response-${svcBaseName}.json.
3. \`python3 "${setup.skillDir}/enrich-endpoint-descriptions.py" merge-responses "${svcRoot}/.understand-anything/intermediate/wiki/endpoints/${svcBaseName}.json" "${svcRoot}/.understand-anything/tmp/ua-ep-response-${svcBaseName}.json"\`
4. \`python3 "${setup.skillDir}/enrich-endpoint-descriptions.py" validate "${svcRoot}/.understand-anything/intermediate/wiki/endpoints/${svcBaseName}.json" --prompt-json="${svcRoot}/.understand-anything/tmp/ua-ep-prompt-${svcBaseName}.json"\`

**Script 1 — Schema validation** (MANDATORY — halt on hard error)
\`node "${setup.skillDir}/validate-wiki-schema.mjs" "${svcRoot}/.understand-anything/intermediate/wiki" --service-root="${svcRoot}"\`
Re-validate with --verify-only. On hard failure: return { serviceName: "${svcBaseName}", success: false, error: "Schema validation failed" }.

**Script 2 — Index building** (MANDATORY)
\`python3 "${setup.skillDir}/build-wiki-index.py" "${svcRoot}/.understand-anything/intermediate/wiki" --service-name="${svcBaseName}"\`

**Script 3 — Assembly** (MANDATORY)
Pre-check: all expected domain slugs from DG must exist in intermediate/wiki/domains/.
Missing domains → return { serviceName: "${svcBaseName}", success: false, error: "Missing domain pages: ..." }.
\`COMMIT=$(git -C "${svcRoot}" rev-parse HEAD 2>/dev/null || echo "unknown")\`
\`python3 "${setup.skillDir}/assemble-wiki.py" "${svcRoot}/.understand-anything/intermediate/wiki" "${svcRoot}/.understand-anything/wiki" "$COMMIT" --output-language="${setup.outputLanguage}"\`

**Quality gate** (MANDATORY)
\`python3 "${setup.skillDir}/wiki_quality_gate.py" "${svcRoot}/.understand-anything/wiki" "${svcRoot}/.understand-anything/domain-graph.json" "${svcRoot}" "${svcRoot}/.understand-anything/tmp/ua-wiki-${setup.wikiSessionId}-qg-${svcBaseName}.json"\`
Read result. If passed=false: return { serviceName: "${svcBaseName}", success: false, error: "Quality gate: <issues>" }.

**Checkpoint**
\`mkdir -p "${svcRoot}/.understand-anything/tmp" && echo '{"_checkpoint":{"status":"complete","phase":2}}' > "${svcRoot}/.understand-anything/tmp/ua-wiki-${setup.wikiSessionId}-checkpoint-p2-${svcBaseName}.json"\`

Return { serviceName: "${svcBaseName}", success: true }.`
}

// ─── Git Change Detection ─────────────────────────────────────────────────────
// Detect which services have actual file changes since their last KG generation.
// Only changed services proceed to the pipeline (Prepare → Wiki → Assembly).

const allCandidates = setup.mode === 'batch'
  ? (setup.servicesToGenerate || [])
  : (setup.serviceName ? [setup.serviceName] : [])

let services = allCandidates  // default: process all candidates

if (!setup.full && allCandidates.length > 0) {
  phase('Detect')

  const gitDetect = await agent(
    `Pull latest code for each service, then detect which have file changes since their last KG.
Each service is an independent git repository under the project root.

Run this Python script exactly as written:

\`\`\`bash
python3 -c "
import json, subprocess, os

project_root = '${setup.projectRoot}'
services = ${JSON.stringify(allCandidates)}

results = []
for svc in services:
    svc_root = os.path.join(project_root, svc)

    # Pull latest code for this service's own git repo
    pull = subprocess.run(
        ['git', '-C', svc_root, 'pull', '--ff-only'],
        capture_output=True, text=True
    )
    pull_note = '' if pull.returncode == 0 else ', pull failed: ' + pull.stderr.strip()[:80]

    # HEAD of this service's repo (after pull)
    head_r = subprocess.run(
        ['git', '-C', svc_root, 'rev-parse', 'HEAD'],
        capture_output=True, text=True
    )
    head = head_r.stdout.strip()
    if not head:
        results.append({'serviceName': svc, 'changed': True,
                        'reason': 'not a git repo' + pull_note,
                        'kgCommit': '', 'headCommit': '', 'changedFiles': -1})
        continue

    kg_path = os.path.join(svc_root, '.understand-anything', 'knowledge-graph.json')
    try:
        d = json.load(open(kg_path))
        kg_commit = d.get('project', {}).get('gitCommitHash', '')
    except Exception:
        kg_commit = ''

    if not kg_commit:
        results.append({'serviceName': svc, 'changed': True,
                        'reason': 'no KG' + pull_note,
                        'kgCommit': '', 'headCommit': head, 'changedFiles': -1})
        continue

    if kg_commit == head:
        results.append({'serviceName': svc, 'changed': False,
                        'reason': 'up to date' + pull_note,
                        'kgCommit': kg_commit, 'headCommit': head, 'changedFiles': 0})
        continue

    # Diff within the service repo — no pathspec needed since we are in its own repo
    diff = subprocess.run(
        ['git', '-C', svc_root, 'diff', '--name-only', kg_commit, head],
        capture_output=True, text=True
    )
    n = len([l for l in diff.stdout.strip().splitlines() if l])
    if n > 0:
        results.append({'serviceName': svc, 'changed': True,
                        'reason': str(n) + ' file(s) changed since ' + kg_commit[:8] + pull_note,
                        'kgCommit': kg_commit, 'headCommit': head, 'changedFiles': n})
    else:
        results.append({'serviceName': svc, 'changed': False,
                        'reason': 'HEAD advanced but no files changed' + pull_note,
                        'kgCommit': kg_commit, 'headCommit': head, 'changedFiles': 0})

print(json.dumps(results))
"
\`\`\`

Parse the JSON output. Print a summary line per service:
  ✓ <svc>: <reason>
  ✗ <svc>: <reason>

Return:
  changedServices   = [svc where changed=true]
  unchangedServices = [svc where changed=false]
  details           = the full results array`,
    { schema: GIT_DETECT_SCHEMA, label: 'git-pull-detect', phase: 'Detect' }
  )

  services = (gitDetect && gitDetect.changedServices) || allCandidates

  const unchanged = (gitDetect && gitDetect.unchangedServices) || []
  if (unchanged.length > 0) {
    log(`Skipping ${unchanged.length} unchanged service(s): ${unchanged.join(', ')}`)
  }
}

// ─── Phase 1-4: Per-service pipeline (KG → DG → Wiki → Assembly) ─────────────
// This runs for both batch (multiple services) and single-service (1-item list).

if (services.length === 0) {
  log('No services with changes — all are current. Proceeding to cross-service phase.')
}

const pipelineResults = services.length > 0
  ? await pipeline(
      services,

      // Stage 1 — Ensure KG (may run /understand internally)
      (svc) => agent(kgPrompt(svc),
        { schema: KG_STAGE_SCHEMA, label: `kg:${svc}`, phase: 'Prepare' }),

      // Stage 2 — Ensure DG + determine wiki state
      (kgResult, svc) => {
        if (!kgResult || !kgResult.success) {
          return { serviceName: svc, success: false, error: kgResult ? kgResult.error : 'KG stage failed', domainsAll: [], domainsToGenerate: [] }
        }
        return agent(dgPrompt(svc),
          { schema: DG_STAGE_SCHEMA, label: `dg:${svc}`, phase: 'Prepare' })
      },

      // Stage 3 — Wiki content generation (dispatches wiki-workers internally)
      (dgResult, svc) => {
        if (!dgResult || !dgResult.success) {
          return { serviceName: svc, success: false, error: dgResult ? dgResult.error : 'DG stage failed' }
        }
        if (dgResult.alreadyUpToDate) {
          log(`${svc}: wiki is up to date — skipping content generation`)
          return { serviceName: svc, success: true, skipped: true }
        }
        if (!dgResult.domainsToGenerate || dgResult.domainsToGenerate.length === 0) {
          log(`${svc}: no domain changes — assembly will update commit hash`)
          return { serviceName: svc, success: true, skipped: false, domainsGenerated: 0 }
        }
        return agent(wikiPrompt(svc, dgResult),
          { schema: WIKI_STAGE_SCHEMA, label: `wiki:${svc}`, phase: 'Wiki Generation' })
      },

      // Stage 4 — Deterministic assembly + quality gate (always runs if Stage 3 succeeded,
      // including the "no domain changes" case where assembly updates the commit hash in meta.json)
      (wikiResult, svc) => {
        if (!wikiResult || !wikiResult.success) {
          return { serviceName: svc, success: false, error: wikiResult ? wikiResult.error : 'Wiki stage failed' }
        }
        return agent(assemblyPrompt(svc),
          { schema: ASSEMBLY_STAGE_SCHEMA, label: `assembly:${svc}`, phase: 'Assembly' })
      }
    )
  : []

// Collect outcomes
const succeeded = (pipelineResults || []).filter(Boolean).filter(r => r && r.success)
const failed    = (pipelineResults || []).filter(Boolean).filter(r => r && !r.success)

if (failed.length > 0) {
  failed.forEach(r => log(`✗ ${r.serviceName}: ${r.error || 'unknown error'}`))
  if (!setup.continueOnError && failed.length > 0) {
    // Pipeline ran to completion for all services (per-service short-circuit applies within stages).
    // --continue-on-error=false means we abort here: skip Cross-Service, Business, and Finalize.
    return {
      success: false,
      error: `Aborting after pipeline — ${failed.length} service(s) failed and --continue-on-error=false. First failure: ${failed[0].serviceName}. Cross-service and business phases skipped.`,
      errors: failed.map(r => `${r.serviceName}: ${r.error}`),
    }
  }
}

if (succeeded.length > 0 || failed.length > 0) {
  const skipped = allCandidates.length - services.length
  const skippedNote = skipped > 0 ? ` (${skipped} unchanged, skipped)` : ''
  log(`Pipeline complete: ${succeeded.length}/${services.length} services succeeded${skippedNote}`)
}

// ─── Cross-Service Phase ──────────────────────────────────────────────────────
phase('Cross-Service')

const integratedResult = await agent(
  `Collect all services that have a complete wiki (wiki/meta.json exists).
Scan both flat services directly under PROJECT_ROOT and two-level nested services (e.g. backend/<svc>/, mobile/<svc>/).
Return service paths relative to PROJECT_ROOT (e.g. "backend/ultron-activity" or "order-service").

Project root: ${setup.projectRoot}

\`\`\`python
import os, json

project_root = '${setup.projectRoot}'
integrated = []

for entry in sorted(os.listdir(project_root)):
    if entry.startswith('.') or entry in {'node_modules', 'dist', 'build', 'target'}:
        continue
    entry_path = os.path.join(project_root, entry)
    if not os.path.isdir(entry_path):
        continue
    # Flat service
    if os.path.isfile(os.path.join(entry_path, '.understand-anything', 'wiki', 'meta.json')):
        integrated.append(entry)
    else:
        # Possible facet directory — scan children
        try:
            for child in sorted(os.listdir(entry_path)):
                if child.startswith('.'):
                    continue
                child_path = os.path.join(entry_path, child)
                if os.path.isdir(child_path) and os.path.isfile(
                    os.path.join(child_path, '.understand-anything', 'wiki', 'meta.json')
                ):
                    integrated.append(entry + '/' + child)
        except Exception:
            pass

print(json.dumps(integrated))
\`\`\`

Return { integratedServices: ["svc1", "backend/svc2", ...] }`,
  { schema: INTEGRATED_SCHEMA, label: 'collect-integrated', phase: 'Cross-Service' }
)

const integratedServices = (integratedResult && integratedResult.integratedServices) || []

if (integratedServices.length >= 2) {
  log(`${integratedServices.length} integrated services — running cross-service analysis`)

  const hashCheck = await agent(
    `Check service content hashes for incremental cross-service analysis.

Project root: ${setup.projectRoot}
Integrated services: ${JSON.stringify(integratedServices)}
Previous hashes: ${setup.projectRoot}/.understand-anything/wiki/service-hashes.json

\`\`\`python
import json, hashlib
services = ${JSON.stringify(integratedServices)}
hashes = {}
for svc in services:
    p = '${setup.projectRoot}/' + svc + '/.understand-anything/wiki/meta.json'
    try:
        hashes[svc] = hashlib.sha256(open(p).read().encode()).hexdigest()
    except:
        hashes[svc] = None
print(json.dumps(hashes))
\`\`\`

Load previous hashes file (empty dict if missing).
skip=True only if ALL current hashes match previous AND none is null.

Return { skip, allHashesJson: "<JSON string>" }`,
    { schema: HASH_CHECK_SCHEMA, label: 'hash-check', phase: 'Cross-Service' }
  )

  if (hashCheck && hashCheck.skip) {
    log('Cross-service phase skipped — no service content changes (incremental)')
  } else {
    await agent(
      `Run the cross-service matcher (Layer 1 — deterministic RPC/event matching).

\`\`\`bash
mkdir -p "${setup.projectRoot}/.understand-anything/tmp"
python3 "${setup.skillDir}/cross-service-matcher.py" "${setup.projectRoot}" \\
  --services="${integratedServices.join(' ')}" \\
  --output="${setup.projectRoot}/.understand-anything/tmp/cross-service-candidates.json"
\`\`\`

Report: RPC relationship count and event flow count found.`,
      { label: 'cross-service-matcher', phase: 'Cross-Service' }
    )

    await agent(
      `Perform LLM cross-service analysis (Layer 2) and generate the parent wiki.

Project root: ${setup.projectRoot}
Skill dir: ${setup.skillDir}
Integrated services: ${JSON.stringify(integratedServices)}
Repo type: ${setup.repoType}
Output language: ${setup.outputLanguage}
${setup.languageDirective ? `Language directive: ${setup.languageDirective}` : ''}

**Read inputs**
- ${setup.projectRoot}/.understand-anything/tmp/cross-service-candidates.json (Layer 1 matches)
- Each service's wiki/service.json, wiki/index.json, KG (endpoint: nodes, provides_rpc/consumes_rpc edges)

**LLM tasks**
1. Verify Layer 1 matches — remove false positives
2. Discover missed relationships (non-standard RPC, dynamic dispatch, event-driven)
3. Organize into business flows — group related calls into end-to-end flows

**Generate parent wiki** at ${setup.projectRoot}/.understand-anything/wiki/:
\`mkdir -p "${setup.projectRoot}/.understand-anything/wiki/domains"\`
- overview.json: system name, description, services[] array, techStack
- architecture.json: crossServiceCalls, eventFlows, businessFlows
- domains/<slug>.json for each cross-domain flow identified

**Repo-type script**
${setup.repoType === 'mobile'
      ? `\`python3 "${setup.skillDir}/build-client-graph.py" "${setup.projectRoot}"\``
      : setup.repoType === 'frontend'
        ? `\`python3 "${setup.skillDir}/build-frontend-graph.py" "${setup.projectRoot}"\``
        : `\`python3 "${setup.skillDir}/build-system-graph.py" "${setup.projectRoot}"\``}
(On failure: log warning, continue.)

**Save hashes and checkpoint**
Write ${hashCheck ? hashCheck.allHashesJson : '{}'} → ${setup.projectRoot}/.understand-anything/wiki/service-hashes.json
\`echo '{"_checkpoint":{"status":"complete","phase":3}}' > "${setup.projectRoot}/.understand-anything/tmp/ua-wiki-${setup.wikiSessionId}-checkpoint-p3.json"\`

**Build parent index + meta**
- index.json: entries for overview, architecture, and each cross-domain page
- meta.json: latest commit hash across services, generatedAt (use \`date -u +%Y-%m-%dT%H:%M:%SZ\`), version "1.0.0", outputLanguage, serviceCount

**Build endpoint index**
\`mkdir -p "${setup.projectRoot}/.understand-anything/wiki/endpoints"\`
For each service: copy wiki/endpoints/*.json to parent wiki/endpoints/
\`python3 "${setup.skillDir}/build-endpoint-index.py" --wiki-dir "${setup.projectRoot}/.understand-anything/wiki"\``,
      { label: 'cross-service-llm', phase: 'Cross-Service' }
    )
  }
} else {
  log(`Cross-service phase skipped — ${integratedServices.length} integrated service(s), need at least 2`)
}

// ─── Business Phase ───────────────────────────────────────────────────────────
phase('Business')

// understand-business runs at BUSINESS_ROOT = parent(PROJECT_ROOT) = root/
// This is the directory containing backend/, mobile/ etc. as sibling facet dirs.
if (!setup.businessRoot) {
  log('WARNING: setup did not return businessRoot — skipping business phase to avoid operating on the wrong directory.')
}
const businessRoot = setup.businessRoot

if (!businessRoot) {
  log('Business phase skipped: businessRoot not available.')
} else {

await agent(
  `Create or update ${businessRoot}/.understand-anything/system.json with facet declarations.
understand-business requires this file before check_facets.py can run.

Project root (wiki): ${setup.projectRoot}  — e.g. /path/to/root/backend
Business root:       ${businessRoot}        — e.g. /path/to/root

**Step 1 — Detect facets with wiki data under businessRoot**
A facet is a subdirectory of businessRoot that contains at least one service with wiki/meta.json.
\`\`\`bash
python3 -c "
import os, json
business_root = '${businessRoot}'
exclude = {'.', '..', '.understand-anything', 'node_modules', 'dist', 'build'}
facets = []
for entry in sorted(os.listdir(business_root)):
    if entry in exclude or entry.startswith('.'):
        continue
    entry_path = os.path.join(business_root, entry)
    if not os.path.isdir(entry_path):
        continue
    for child in os.listdir(entry_path):
        child_path = os.path.join(entry_path, child)
        if os.path.isfile(os.path.join(child_path, '.understand-anything', 'wiki', 'meta.json')):
            facets.append(entry)
            break
print(json.dumps(facets))
"
\`\`\`

**Step 2 — Read existing system.json** at ${businessRoot}/.understand-anything/system.json (empty dict if missing).

**Step 3 — Merge facets array** — for each detected facet add/update:
  { "name": "<facet>", "subPaths": ["<facet>/*"] }
Preserve any other top-level fields already in system.json.

**Step 4 — Write result**
\`mkdir -p "${businessRoot}/.understand-anything"\`
Write merged JSON to ${businessRoot}/.understand-anything/system.json`,
  { label: 'write-system-json', phase: 'Business' }
)

const businessSetup = await agent(
  `Run Phase 0 and Phase 1 of understand-business: check facets and deterministic domain matching.

Business root: ${businessRoot}
Business skill dir: ${setup.businessSkillDir}
Output language: ${setup.outputLanguage}

**Step 1 — Check facets**
\`python3 "${setup.businessSkillDir}/check_facets.py" "${businessRoot}"\`
Read: ${businessRoot}/.understand-anything/intermediate/facet-status.json

If zero facets have wiki data:
  Return { skip: true, reason: "No facet wiki data available — run /understand-wiki first" }

If some facets missing:
  Log warnings: "WARNING: <facet> wiki not available — business-landscape will be degraded"
  Continue with available facets.

**Step 2 — Deterministic domain matching**
\`python3 "${setup.businessSkillDir}/domain_matcher.py" "${businessRoot}"\`
Read: ${businessRoot}/.understand-anything/intermediate/phase1-matches.json

Extract:
  - candidates[]: pairs needing LLM verification { id, serverDomain, clientDomain, serverSummary, clientSummary, serverEndpoints, clientApiCalls }
  - domains[]: already-matched or post-verification domains { slug, name, serverDomainRef, clientDomainRef }
  - availableFacets[]: facet names that have wiki data

Return { skip: false, availableFacets, candidates, domains }.`,
  { schema: BUSINESS_SETUP_SCHEMA, label: 'business-setup', phase: 'Business' }
)

if (businessSetup.skip) {
  log(`Business phase skipped: ${businessSetup.reason}`)
} else {
  // Phase 2 — LLM match verification (parallel over candidates)
  if (businessSetup.candidates && businessSetup.candidates.length > 0) {
    log(`Verifying ${businessSetup.candidates.length} domain match candidate(s)`)

    const matchResults = await pipeline(
      businessSetup.candidates,
      (candidate) => agent(
        `Verify whether these two domains from different facets represent the same business concept.

Candidate ID: ${candidate.id}
Check checkpoint: ${businessRoot}/.understand-anything/intermediate/match-${candidate.id}.json
If checkpoint exists and status == "complete": return { id: "${candidate.id}", match: <cached>, confidence: <cached>, skipped: true }.

Server domain: "${candidate.serverDomain}"
  Summary: ${candidate.serverSummary || '(none)'}
  Endpoints: ${JSON.stringify(candidate.serverEndpoints || [])}

Client domain: "${candidate.clientDomain}"
  Summary: ${candidate.clientSummary || '(none)'}
  API calls: ${JSON.stringify(candidate.clientApiCalls || [])}

Determine:
  - match: true if they represent the same business concept
  - confidence: 0.0–1.0
  - reason: one sentence explanation

Write checkpoint: ${businessRoot}/.understand-anything/intermediate/match-${candidate.id}.json
  { "match": <bool>, "confidence": <float>, "reason": "<string>", "_checkpoint": { "status": "complete" } }

Return { id: "${candidate.id}", match, confidence, reason }.`,
        { schema: MATCH_RESULT_SCHEMA, label: `match:${candidate.id}`, phase: 'Business' }
      )
    )

    const confirmed = (matchResults || []).filter(Boolean).filter(r => r && r.match && r.confidence >= 0.7)
    log(`Match verification: ${confirmed.length}/${businessSetup.candidates.length} confirmed (confidence ≥ 0.7)`)
  }

  // Phase 2b — Strategy B: cross-facet association discovery
  // Runs when deterministic matching found neither confirmed matches nor candidates to verify.
  // Common for backend↔mobile where domain names are completely different.
  const hasAnyPhase1Results = (businessSetup.domains  && businessSetup.domains.length  > 0)
                           || (businessSetup.candidates && businessSetup.candidates.length > 0)
  if (!hasAnyPhase1Results) {
    log('No deterministic domain matches found — running Strategy B: cross-facet association discovery')
    await agent(
      `Perform cross-facet association discovery (Strategy B) for understand-business.
Deterministic matching found 0 matches and 0 candidates. Use LLM to find associations.

Business root: ${businessRoot}
Available facets: ${JSON.stringify(businessSetup.availableFacets || [])}
Business skill dir: ${setup.businessSkillDir}
Output language: ${setup.outputLanguage}

**Step 1 — Load all domain data from each facet**
For each facet in availableFacets:
  - The facet directory is at <businessRoot>/<facetName>/
  - Scan sub-services: for each sub-service with .understand-anything/wiki/index.json, load the index
  - For each domain entry in the index, load its domain page to extract: name, summary, integrationPoints

Group results as:
  - serverDomains: from backend/server-type facets (name, summary, endpoints from integrationPoints.inbound/outbound)
  - clientDomains: from mobile/frontend-type facets (name, summary, api_calls from integrationPoints.outbound)

**Step 2 — LLM association discovery**
Given ALL server domains and ALL client domains, identify which client domains CALL or DEPEND ON
which server domains based on:
1. API endpoint overlap (client calls server endpoints)
2. Business capability overlap (client feature relies on server domain logic)
3. Data flow (client displays data produced by server domain)

**Step 3 — Write phase2-associations.json**
For associations with confidence >= 0.6:
\`mkdir -p "${businessRoot}/.understand-anything/intermediate"\`
Write: ${businessRoot}/.understand-anything/intermediate/phase2-associations.json
\`\`\`json
{
  "associations": [
    {
      "server_domain": "<name>",
      "client_domain": "<name>",
      "relationship": "calls|depends_on|displays",
      "confidence": 0.0,
      "shared_endpoints": [],
      "reason": "<explanation>"
    }
  ]
}
\`\`\`

Also write a checkpoint for each association (confidence >= 0.7) to:
  ${businessRoot}/.understand-anything/intermediate/match-<serverDomain>--<clientDomain>.json
  { "match": true, "confidence": <float>, "reason": "<string>", "_checkpoint": { "status": "complete" } }

Return { associationsFound: <count> }.`,
      { schema: STRATEGY_B_SCHEMA, label: 'strategy-b-discovery', phase: 'Business' }
    )
  }

  // Phase 3 — Assembly (reads phase1-matches + phase2-associations checkpoints)
  const assembleResult = await agent(
    `Run Phase 3 of understand-business: assemble the business-landscape domain index.

\`python3 "${setup.businessSkillDir}/assemble_landscape.py" "${businessRoot}"\`

After the script completes, read ${businessRoot}/.understand-anything/intermediate/domains.json.
Parse the "domains" array — each entry has: slug, name, and optionally serverDomainRef, clientDomainRef.

Read and report:
  - ${businessRoot}/.understand-anything/intermediate/domains.json (domain index with stats)
  - ${businessRoot}/.understand-anything/intermediate/cross-facet-links.json

Report: N domains mapped, coverage %, M unmapped.

Return { assembledDomains: [{ slug, name, serverDomainRef, clientDomainRef }, ...] }.
If domains.json is missing or has an empty domains array, return { assembledDomains: [] }.`,
    { schema: BUSINESS_ASSEMBLE_SCHEMA, label: 'business-assemble', phase: 'Business' }
  )

  // Phase 4 — Interaction documents (parallel per domain)
  // Use the post-assembly domain list which includes LLM-verified matches from Phase 2.
  const domains = (assembleResult && assembleResult.assembledDomains) || []
  if (domains.length > 0) {
    log(`Generating ${domains.length} cross-facet interaction document(s)`)

    await pipeline(
      domains,
      (domain) => agent(
        `Generate the cross-facet interaction document for business domain "${domain.name}" (slug: ${domain.slug}).

Business root: ${businessRoot}
Business skill dir: ${setup.businessSkillDir}
Output language: ${setup.outputLanguage}
${setup.languageDirective ? `Language directive: ${setup.languageDirective}` : ''}

**Check checkpoint**
${businessRoot}/.understand-anything/intermediate/domain-${domain.slug}.json
If checkpoint status == "complete": return { slug: "${domain.slug}", success: true, skipped: true }.

**Read wiki flow data**
Server flows: ${domain.serverDomainRef ? `read from ${domain.serverDomainRef}` : '(not available)'}
Client flows: ${domain.clientDomainRef ? `read from ${domain.clientDomainRef}` : '(not available)'}

**Generate interaction document** (DAG step structure):
{
  "id": "domain:${domain.slug}",
  "name": "${domain.name}",
  "summary": "<3–5 sentence cross-facet overview>",
  "interactions": [{ "id": "flow:<slug>", "name": "...", "steps": [{ "id": "step:<N>", "facet": "server|client", "description": "...", "after": ["step:<prev>"], "terminal": true/false }] }],
  "businessRules": [{ "id": "rule:<slug>", "rule": "...", "enforcedBy": [...], "observedBy": [...], "relatedFlows": [...] }],
  "facets": { "server": { "service": "...", "domainRef": "..." }, "client": { ... } }
}

**Validate**
\`python3 "${setup.businessSkillDir}/validate_domain.py" "${businessRoot}/.understand-anything/intermediate/domain-${domain.slug}.json"\`
Retry up to 2x on validation failure with error details. On persistent failure: write degraded checkpoint.

**Write checkpoint**
${businessRoot}/.understand-anything/intermediate/domain-${domain.slug}.json
{ ...<document>, "_checkpoint": { "status": "complete" } }

Return { slug: "${domain.slug}", success: true, status: "complete" } or { ..., status: "degraded", error: "..." }.`,
        { schema: INTERACTION_DOC_SCHEMA, label: `interact:${domain.slug}`, phase: 'Business' }
      )
    )
  }

  // Phase 5 — Validate + finalize business landscape
  await agent(
    `Run Phase 5 of understand-business: validate and generate all final output files.

Business root: ${businessRoot}
Business skill dir: ${setup.businessSkillDir}
Output language: ${setup.outputLanguage}

**Step 1 — Validate landscape**
\`python3 "${setup.businessSkillDir}/validate_landscape.py" "${businessRoot}"\`
If validation fails: report errors, set meta.json status="degraded", continue.

**Step 2 — Move intermediate files to final output**
\`mkdir -p "${businessRoot}/.understand-anything/business-landscape/domains"\`
Move: intermediate/domains.json → business-landscape/domains.json
Move: intermediate/cross-facet-links.json → business-landscape/cross-facet-links.json
Move: intermediate/domain-*.json → business-landscape/domains/*.json

**Step 3 — Write business-landscape/meta.json**
{ "contentHash": "<sha256 of all output files>", "sourceHashes": { ... }, "generatedAt": "<ISO from date -u +%Y-%m-%dT%H:%M:%SZ>", "version": "1.0", "status": "complete", "_checkpoint": { "status": "complete" } }

**Step 4 — Generate system-graph.json** (merge all facet topology graphs)
Read each facet's topology (system-graph.json for server, client-graph.json for mobile).
Merge all nodes and edges. Build serviceIndex with basePath for each service.
Write to: ${businessRoot}/.understand-anything/system-graph.json

**Step 5 — Generate root wiki/ files** (Dashboard navigation)
\`mkdir -p "${businessRoot}/.understand-anything/wiki/domains"\`
- wiki/meta.json: { "generatedAt": "...", "version": "1.0.0", "outputLanguage": "${setup.outputLanguage}", "serviceCount": <N> }
- wiki/overview.json: { "name": "...", "description": "...", "facets": [{ "name": ..., "services": [...], "description": ... }], "techStack": [...] }
- wiki/index.json: navigation entries for each service wiki + cross-domain entry:
  { "id": "wiki:business", "name": "跨端业务全景", "type": "cross-domain", "summary": "<N> matched cross-facet business domains" }
- wiki/domains/business.json: cross-platform business panorama (cross-facet interactions, NOT per-facet internal flows)
- wiki/architecture.json: { "facets": [...], "crossServiceCalls": [<cross-facet only>], "eventFlows": [], "sharedResources": [] }`,
    { label: 'business-finalize', phase: 'Business' }
  )
}

} // end if (businessRoot)

// ─── Finalize ─────────────────────────────────────────────────────────────────
phase('Finalize')

const finalReport = await agent(
  `Finalize the understand-wiki run and produce the completion report.

Mode: ${setup.mode}
Project root: ${setup.projectRoot}
Service root: ${setup.serviceRoot || '(batch)'}
Skill dir: ${setup.skillDir}
Repo type: ${setup.repoType}
Wiki session ID: ${setup.wikiSessionId}
Services succeeded: ${JSON.stringify(succeeded.map(r => r.serviceName))}
Services failed: ${JSON.stringify(failed.map(r => r.serviceName))}
Review flag: ${setup.review}
Output language: ${setup.outputLanguage}

**Step 1 — Completeness verification** (MANDATORY — run before cleanup)
\`\`\`bash
${setup.mode === 'single'
    ? `python3 "${setup.skillDir}/verify-wiki-completeness.py" "${setup.serviceRoot}" --mode=single --repo-type="${setup.repoType}"`
    : `python3 "${setup.skillDir}/verify-wiki-completeness.py" "${setup.projectRoot}" --mode=batch --repo-type="${setup.repoType}" --parent-root="${setup.projectRoot}"`}
\`\`\`
If ERROR: do NOT proceed to cleanup. Return { success: false, errors: ["verification failed: ..."] }.
WARN is acceptable — proceed.

${setup.review ? `
**Step 2 — wiki-reviewer** (--review was set)
Read ${setup.pluginRoot}/agents/wiki-reviewer.md and follow its instructions.
Service: ${setup.serviceName || succeeded[0]?.serviceName || '(first succeeded)'}
Wiki dir: ${setup.serviceRoot || setup.projectRoot}/.understand-anything/wiki
Pass DG JSON and truncated KG (first 200 nodes + their edges).
Write report to: ${setup.projectRoot}/.understand-anything/tmp/ua-wiki-${setup.wikiSessionId}-review.json
Include verdict in final report.
` : ''}

**Step 3 — Cleanup temp files**
\`rm -rf "${setup.projectRoot}/.understand-anything/tmp/ua-wiki-${setup.wikiSessionId}-"*\`

**Step 4 — Collect stats**
Count domains, flows, cross-service relationships, business domains matched from output files.

**Step 5 — Print summary box**
\`\`\`
╔══════════════════════════════════════════════════╗
║         /understand-wiki Complete                 ║
╠══════════════════════════════════════════════════╣
║ Mode:         <single|batch>                     ║
║ Services:     <N generated> / <M total>          ║
║ Domains:      <total domain pages>               ║
║ Flows:        <total flows>                      ║
║ Cross-svc:    <cross-service relationships>      ║
║ Business:     <matched domains> matched / <total>║
║ Language:     <lang>                             ║
╚══════════════════════════════════════════════════╝
\`\`\`

Return structured final report.`,
  { schema: FINAL_REPORT_SCHEMA, label: 'finalize', phase: 'Finalize' }
)

return finalReport || { success: true, mode: setup.mode, language: setup.outputLanguage }
