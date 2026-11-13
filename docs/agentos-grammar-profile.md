# AgentOS grammar profile and Storage Routing evidence

The AgentOS profile adds source-backed relationship claims to an Understand Anything analysis. It helps answer questions such as which schema governs a registry's entries, which engine loads that registry, which outputs can trigger a route, and where the resulting audit records go. The report gives each answer a scope and a source location so a reviewer can trace it back to the code, configuration, or test that supports it.

Storage Routing supplies a working example. The runtime validates its registries before opening local state, uses them to store artifacts and route events, and records what happened. The profile inspects the same source and connects the resulting claims to reviewed acceptance tests.

## How the pieces fit together

```mermaid
flowchart LR
  files["Registries, schemas, and source"] --> startup["Validate registries at startup"]
  startup --> engines["Load engines and initialize local state"]
  engines --> audit["Store artifacts, route events, and persist audit records"]
  tests["Runtime acceptance tests"] -->|Exercise| startup
  tests -->|Exercise| audit
  files -->|Source evidence| refresh["AgentOS grammar refresh"]
  graph["Saved graph and fingerprints"] --> refresh
  rules["Profile rules and reviewed test pins"] --> refresh
  tests -->|Pinned test source| refresh
  refresh --> report["semantic-claims.json"]
```

The Understand Anything checkout owns the analysis code, profile rules, and regression fixtures. The AgentOS project supplies the files being analyzed and stores its report under `.ua/`. In the current project, the runtime files are in `agentOS-OCT-oc/Storage-Routing_Agent/`, the model validators are in `universal-model/tools/`, and the local service qualifier is in `shared-registry/local-app/tools/`.

| Component | Responsibility |
| --- | --- |
| [Understand skill](../understand-anything-plugin/skills/understand/SKILL.md) | Selects the profile, runs analysis, and refreshes claims after a successful save. |
| [File analyzer](../understand-anything-plugin/agents/file-analyzer.md) | Proposes graph edges for explicit schema and dependency bindings when dispatched with the AgentOS directive. |
| [Profile definition](../understand-anything-plugin/skills/understand/grammar/agentos.json) | Defines six predicates, their evidence rules, the ontology reference, and reviewed test pins. |
| [Grammar refresh](../understand-anything-plugin/skills/understand/grammar-profile.mjs) | Reads the graph and current source, resolves evidence, and publishes the report. |
| [JavaScript bindings](../understand-anything-plugin/skills/understand/grammar/agentos-js-bindings.mjs) and [Python bindings](../understand-anything-plugin/skills/understand/grammar/agentos-python-bindings.py) | Extract the specific syntax and source bindings that the profile can check. |
| [Grammar profile tests](../tests/skill/understand/test_grammar_profile.test.mjs) | Exercise the refresh against isolated projects and check claim and test-link behavior across edits. |

## Storage Routing runtime

`run_storage_routing.py` resolves the bundle relative to its own location. It reads both registries and their wrapper and item schemas, registers each local item schema by its `$id`, and applies the wrapper with `Draft202012Validator`. The wrapper's required `schema_id` constant identifies the registry, and the array's `items.$ref` applies the item schema.

| Registry | Wrapper | Item schema | Array scope |
| --- | --- | --- | --- |
| `storage_conventions.v1.json` | `storage_conventions_registry.schema.v1.json` | `storage_convention.schema.v1.json` | `/entries` |
| `routing_maps.v1.json` | `routing_maps_registry.schema.v1.json` | `routing_rule.schema.v1.json` | `/routes` |

Both validations run before the CLI constructs either adapter or engine. For a schema validation error, the CLI exits with the registry name, wrapper name, and location in the JSON. On success, it passes the validated file paths to `StorageEngine` and `RoutingEngine`, which load their respective collections. The local adapters use `agentos.sqlite3` under `--state-dir`, and the storage adapter uses `knowledge_base/` there for artifacts. The `engine/__init__.py` and `engine/adapters/__init__.py` package mappings let the flat export retain its package imports.

`StorageEngine.store_on_publish` writes the artifact through its adapter and emits a `StorageActionRecord`. `RoutingEngine.on_lifecycle_event` matches route declarations, applies suppressors and QA gates, evaluates conditions, and emits `RoutingEventRecord` audit records. The local adapters write audit records to SQLite. The web adapters implement Postgres audit writes, and the web routing adapter also reads routing events back. `postgres_audit.sql` defines the tables and indexes. Writes use the record ID as the key and update the row on conflict.

Two cases show how those pieces interact.

- For a published Completed Artifact (`O-4.1.1-001`), the registry declares a `threshold_crossed_on_publish` condition of `confidentiality_level == C3 OR risk_severity == RS-4`. Either branch can emit `threshold_crossed`. Rule `R-018` sends an escalation to `P-INTEGRITY`, records a `BLOCK_ROUTING` action with its reason, and creates a `stabilize` task for `T-SELF`. The runtime acceptance test checks both branches, the actions, and the match between emitted audit IDs and the SQLite rows.
- For `R-001`, the packaged acceptance test exercises the raw capture QA gate. A raw capture with invalid required fields can emit a `blocked_qa` record even when `qa_result` is `pass`. When `qa_result` is `fail`, global suppressor `SUP-2` takes precedence and the recorded result is `suppressed`. The `produces` evidence records those two reviewed paths at the applicable source hashes.

## How a refresh establishes claims

1. **Select the profile.** The project's `config.json` opts in with `"grammarProfile": "agentos"`. Full and incremental analyzer dispatches receive the AgentOS directive and can propose forward edges in the standard graph schema. The selected profile references the proposed ontology in `AgentOS_Operational_Grammar_Codex_v0.1.0.zip` and uses the bundled rules for admission. [Incremental hook](../understand-anything-plugin/hooks/auto-update-prompt.md)
2. **Read the saved graph and fingerprints.** The refresh validates the graph and checks that the graph and fingerprint baseline describe the same revision. Graph-bound source evidence must match the saved file hashes. Rules that explicitly allow companion files can read current wrappers, a startup script, or reviewed tests before those files have graph nodes. The report records the hashes used for that evidence.
3. **Resolve source evidence.** JavaScript syntax and Python AST checks trace supported imports, literal paths, validator calls, constructor arguments, and audit operations. The registry rules also compare JSON IDs, references, and output declarations. File and class endpoints bind to graph nodes. Route output and target units derive from the registries.
4. **Assign the claim's scope and admission.** A claim has a stable ID derived from its subject, predicate, object, frame, and applicable scope. Evidence supports a claim and marks it as an inference. A candidate with insufficient evidence can be withheld with a reason. A gap records an extraction problem such as an unavailable or stale fingerprint, unresolved endpoint, or parse failure.
5. **Attach reviewed tests and publish.** The refresh attaches tests to matching evidence sites on supported claims. It rechecks the graph, fingerprints, profile selection, and collected evidence anchors before writing the report through a temporary file and rename. The report's provenance includes graph, fingerprint, and profile hashes. On an interrupted or failed refresh, those hashes identify the inputs of any previously saved report. [Refresh implementation](../understand-anything-plugin/skills/understand/grammar-profile.mjs)

Full analysis refreshes the report after saving the graph and fingerprints. The incremental finalizer does the same for an enabled profile after a successful update. The scan excludes the generated report and its temporary files from source-change detection. A grammar-only refresh uses the saved graph and baseline directly. [Incremental finalizer](../understand-anything-plugin/skills/understand/finalize-incremental.mjs) · [Scan helper](../understand-anything-plugin/skills/understand/scan-project.mjs)

## What the six relations establish

| Predicate | What the evidence establishes |
| --- | --- |
| `depends_on` | A module imports a particular relative `.mjs` file, reads a JSON file through a resolved module-relative root, or passes a named Python script to the imported `boundedProcess` runner that forwards it to Python. A source wrapper can also bind a launcher dependency through a fixed `--app-root` and `--launcher-only` invocation. |
| `constrains` | A Python validator applies a schema to an identified JSON record, or a wrapper binds a matching registry to a particular item schema at an array pointer. An explicit validator call, a literal validator table, or a CLI default can identify the record. The Storage Routing startup matcher adds evidence for applying the wrapper before constructing the adapters and engines. |
| `routes_to` | A declared route binds a unique source output to a destination in the target legend or to a downstream output with a matching create or update action. Each claim records the route, event, condition, and source and destination locations. A named publish emitter can establish an output-scoped claim for a rule whose declared source is `ANY`. |
| `observes` | A SQLite or Postgres adapter binds an audit record's ID to a committed table write, or selects the ID and uses it to reconstruct the record type. The Postgres matcher can follow a local helper that receives the adapter's database URL and the same record. |
| `produces` | An engine method constructs an audit record or obtains it through the typed storage adapter contract, then passes that record to its audit adapter. The claim records the emitting method and its evidence sites. A reviewed reachability witness can add the inputs that reach a specific site. |
| `consumes` | An acceptance setup loads a registry and passes the decoded value to its engine, or a guarded startup passes the registry path to the engine's file-loading branch. The evidence follows the value through to the collection stored on the engine and records the package mapping for the flat bundle. |

The launcher example comes from the local AgentOS service. `qualify-source.sh` supplies the source app root to `qualify.mjs` and selects `--launcher-only`. Given the active service data directory, the qualifier reads the service status, connects to `plugin/scripts/launch.sh` over MCP stdio, and compares the launcher status's catalog digest and company revision to the service. The grammar report scopes its dependency claim to that invocation and pins the qualifier, source wrapper, and launcher.

## Follow a registry claim into its tests

The storage claim links `storage_convention.schema.v1.json` to `storage_conventions.v1.json` with `objectScope.pointer` set to `/entries`. Its `refines` field identifies the corresponding file-level candidate. It carries two kinds of source evidence.

| Evidence kind | What to inspect |
| --- | --- |
| `json_schema_items_ref` | The wrapper at `/properties/entries/items/$ref`, its resolved schema ID, and the record and item schema paths and hashes. The routing claim uses `/properties/routes/items/$ref`. |
| `python_startup_registry_validation` | The calls in `run_storage_routing.py`, including the wrapper, registry, and local item schema reads, resource registration, validator call, and the initialization line that follows it. The current validator call is at line 25. |

The startup evidence carries `testBindings` for valid registries initializing state, swapped registries failing before initialization, and invalid items failing before initialization. Those tests run the actual CLI in a temporary copy and check its exit status, diagnostics, and state directory. The swap test reaches both wrapper checks in separate scenarios. The item tests remove `output_id` and `route_id` from their respective records so the wrappers must exercise the referenced item schemas.

Each `reviewedTests` entry in the profile pins one test file and the relevant source files by SHA-256. A link identifies a claim ID, an evidence kind, an optional evidence line, and the test lines and behavior it covers. Refresh attaches it when all of its pins match and exactly one site on the supported claim matches. Acceptance tests execute in their own runner. A report link identifies reviewed coverage of the pinned source, and the test runner supplies the result for the current run. [Review definitions](../understand-anything-plugin/skills/understand/grammar/agentos.json)

The three startup tests account for six links across the two `constrains` claims. The Completed Artifact runtime test supplies eight links across `routes_to`, `observes`, `produces`, and `consumes`. The `R-001` acceptance test appears separately on its reachability annotation.

## What changes when the evidence changes

Claim support and test attachment are separate decisions. In the fixture, both wrappers are companion files and the shared startup review pins both. That setup lets a broken `$ref` exercise schema resolution directly and lets a byte edit exercise test freshness independently.

| Fixture state | Claim support | Test links |
| --- | --- | --- |
| Both wrappers and the pinned startup test match | `/entries` and `/routes` are supported. | One link from the shared fixture test on each claim. |
| Only the pinned test changes | Both claims are supported by their source evidence. | The changed test's links are absent. |
| A comment changes the pinned startup source | Both claims are supported. The startup evidence records the new file hash. | The shared review's links are absent. |
| Only one wrapper's `$ref` breaks | The other scoped claim is supported. The broken wrapper's claim falls back to a withheld file-level candidate. | The shared review's links are absent. |
| Both `$ref`s break | Both file-level candidates are withheld. | No links attach. |
| One of two independently pinned test files changes | Both claims are supported. | Only the untouched test's link remains on each claim. |
| Both independently pinned test files change | Both claims are supported. | Links are absent until the corresponding test's exact bytes are restored. |

Six named cases break both wrappers and edit the shared test, then restore storage, routing, and the test in every order. Each wrapper restores its own scoped claim. Both links return after all three files match. The independent-review cases link two tests from separate files to both claims, edit either one or both, and compare the exact links after each restore to catch duplicate attachments. [Regression fixtures](../tests/skill/understand/test_grammar_profile.test.mjs)

## Current AgentOS report

The saved report checked on November 10, 2026 uses profile `agentos` version `0.14.1` and report schema `ua.agentos-semantic-claims/0.1.0`. Its graph, fingerprint, and profile hashes match the saved inputs.

| Predicate | Supported | Withheld |
| --- | ---: | ---: |
| `depends_on` | 123 | 0 |
| `constrains` | 7 | 0 |
| `routes_to` | 37 | 2 |
| `observes` | 6 | 0 |
| `produces` | 2 | 0 |
| `consumes` | 4 | 0 |

The report has zero extraction gaps. The two withheld candidates are `R-018`'s wildcard-source routes to `P-INTEGRITY` and `T-SELF`. The named Completed Artifact emitter supports separate claims to those destinations with `sourceOutputId` set to `O-4.1.1-001` and `sourceEvent` set to `published`.

## Run and inspect

### Refresh the report

Use the AgentOS project directory as the `/understand` path. For a project with a saved graph and fingerprint baseline, enable the profile and refresh with the following command. On later runs, the saved selection makes `--grammar-only` sufficient. For a project without that baseline, run a regular analysis with `--grammar-profile agentos` first.

```text
/understand /path/to/agentOS-OCT --grammar-profile agentos --grammar-only
```

The equivalent shell commands run from the Understand Anything checkout with its dependencies installed, core built, and `node` and `python3` on the path. Set `PROJECT_ROOT` to the AgentOS project directory.

```bash
PROJECT_ROOT=/path/to/agentOS-OCT
SKILL_DIR=understand-anything-plugin/skills/understand
node "$SKILL_DIR/grammar-profile.mjs" "$PROJECT_ROOT" --configure agentos
node "$SKILL_DIR/grammar-profile.mjs" "$PROJECT_ROOT" --require
jq '{profile: .profile.version, counts, gaps}' "$PROJECT_ROOT/.ua/semantic-claims.json"
```

Read `semantic-claims.json` next to `knowledge-graph.json` and `fingerprints.json`. Projects with the legacy data directory use `.understand-anything/` in place of `.ua/`. `--grammar-profile off` clears the generated claims report and disables the profile. When a graph-bound source changes, refresh the graph and fingerprint baseline. When a review pin changes, rerun the affected test, check the evidence it covers, and update the reviewed pin and source locations together before refreshing.

Use the claim's `reason` to investigate a withheld candidate. If a supported claim loses its test links, check the review's pins and its claim ID, evidence kind, and line. This query shows the two scoped registry claims and the tests attached to each evidence site.

```bash
jq '.claims[] | select(.predicate == "constrains" and .objectScope.kind == "array_items")
  | {scope: .objectScope.pointer, admission, evidence: [.evidence[]
      | {kind, filePath, line, tests: (.testBindings // [] | map(.test))}]}' \
  "$PROJECT_ROOT/.ua/semantic-claims.json"
```

### Exercise startup and runtime behavior

With `PROJECT_ROOT` set as above, create a temporary virtual environment and state directory. Python 3.12 was used for the local verification. A successful startup prints that it loaded 29 storage conventions and 18 routing rules.

```bash
BUNDLE="$PROJECT_ROOT/agentOS-OCT-oc/Storage-Routing_Agent"
work_dir=$(mktemp -d)
python3 -m venv "$work_dir/venv"
"$work_dir/venv/bin/python" -m pip install -r "$BUNDLE/requirements.txt"
"$work_dir/venv/bin/python" -B "$BUNDLE/run_storage_routing.py" --state-dir "$work_dir/state"
(
  cd "$BUNDLE"
  "$work_dir/venv/bin/python" -B -m unittest -v test_runtime_registry_validation test_runtime_acceptance
)
```

Those four test methods cover the three startup scenarios and the Completed Artifact publish flow. The broader `test_acceptance.py` suite expects the packaged `tests/`, `engine/`, `registries/`, and `schemas/` layout shown in the bundle README. The Postgres audit tests use Psycopg and a test database selected by `AGENTOS_AUDIT_TEST_DSN`. From the bundle's parent directory, run `python -m unittest Storage-Routing_Agent.test_postgres_audit -v` with a test role allowed to create schemas. The tests use and clean up their own schema.

### Check the source launcher

Set `SERVICE_DATA_DIR` to the data directory of the running local service. The source wrapper selects the app root and prints the launcher qualification result. Add `--output` with a directory to save `launcher-qualification.json`.

```bash
"$PROJECT_ROOT/shared-registry/local-app/tools/qualify-source.sh" --data "$SERVICE_DATA_DIR"
```

### Check the grammar regressions

From the Understand Anything checkout, use the focused Vitest command to run the grammar profile fixtures. The verified suite contains 40 cases, including the six restore orders and the independent test pin checks. The repository CI uses `pnpm test` for its root test suite. [CI workflow](../.github/workflows/ci.yml)

```bash
pnpm exec vitest run tests/skill/understand/test_grammar_profile.test.mjs
```
