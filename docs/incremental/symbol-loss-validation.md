# Incremental symbol-loss validation contract

This gate protects functions, classes and methods already present in the published graph. It does not reconstruct historical omissions, change significance filtering for new symbols, or evaluate arbitrary program execution.

## Audit

The publication boundary is already centralized: prepare snapshots the original graph before pruning; merge validates its candidate; finalize independently validates before writing graph/fingerprints/meta; repair replaces only affected current contributions and is limited to one attempt per base/head. These boundaries and current-edge ownership reconciliation remain required regression coverage.

The source-evidence layer mixed structural declarations, runtime-installed names and arbitrary AST text in a file-wide set/boolean. This caused both false absence (computed names have no matching literal token) and false preservation (another class's accessor or a quoted setter argument). Adding API tokens could only alternate between these failure modes.

## Decision rules

1. A preserved graph descriptor must keep its symbol kind/name and explicit class ownership. Unowned callables require source identity verification across commits.
2. Source identities are `(path, kind, owner, name)`. Ownership comes from extractor receiver metadata or AST scope; same-line containment is never used to guess a receiver. Locations disambiguate within a revision; they are not cross-revision identity. Duplicate source identities and competing graph mappings remain unknown.
3. A unique current declaration plus a unique current graph binding preserves the old symbol. A declaration without a matching graph node reports `still-present`.
4. Missing identities become `unknown` if parsing, baseline identity, evidence version, or current ID ownership cannot be verified. Empty extraction never proves deletion.
5. Version 2 evidence separates declaration coverage gaps from possible runtime effects. Entries carry `kind`, `scope`, `name`, optional name suffix, location and reason. Scope is a tagged value: `file`, `class` with a name, `local` with an AST scope ID, or `unknown`. Local scope is never wildcard uncertainty; local IDs are not compared across revisions or exposed as graph IDs. Only evidence compatible with the missing identity prevents deletion. Ordinary reads, strings and parameter names are not declarations. Literal symbol names are not normalized as graph-ID delimiters (for example, #run differs from .run).
6. Verified standard installers preserve exact names and owners (including Ruby readers versus writers). Dynamic keys have unknown names; unresolved, shadowed or reassigned receivers have unknown owners; arbitrary evaluation/installer aliases or shadowed installer APIs may require file-wide uncertainty. Unbound class expressions retain a distinct internal lexical scope; expressions exposed through unresolved assignments retain uncertainty. The gate does not execute code or restore old semantic data.
7. If the uniquely mapped old identity is absent under a recognized declaration-coverage profile and no compatible coverage gap or runtime effect remains, report `deleted`. Validating the evidence schema alone does not establish coverage. A different class's same-name declaration is not that identity. Reusing the old graph ID for a different owner remains an identity conflict until the analyzer supplies distinct descriptors.
8. Any unresolved entry blocks publication. One targeted repair may regenerate complete affected files. Failed repair leaves all three durable baseline files unchanged.

## Verification matrix

Each source transition is checked independently from publication mechanics.

| Axis | Required cases |
| --- | --- |
| Result | preserved, still-present but omitted, genuinely deleted, unknown |
| Identity | stable ID; alternate ID; reused ID; same name across owners; free function versus method; duplicate/overloaded source identities; moved lines |
| Supplemental names | exact same/different name; unknown name; reader/writer suffix; quoted/symbol spelling; escapes/interpolation |
| Scope | same class; another class; free scope; unresolved/shadowed/reassigned receiver; unrelated local/import aliases; bound installer alias; arbitrary evaluation |
| Syntax | JS/TS/JSX/TSX methods/properties/TypeScript parameter properties/class expressions/assignments/property APIs; Ruby accessors/alias declarations/method installers; Python attributes/installers; Go/Rust/C++ receiver extraction |
| Negative evidence | unrelated string, parameter, normal read/call; static installer for another symbol; another owner's accessor |
| Invalid evidence | unsupported parser/coverage adapter, parse recovery/error, empty extraction, missing evidence version/coverage profile, ambiguous old mapping |
| Publication | 20-to-1 omission; equal counts; merge/direct-finalize refusal; retry success/failure; stable prepare baseline; stale shards; deleted/excluded files; both data directories; current edge endpoint reuse |

Tests must assert positive and negative outcomes for each recognizer rather than only adding the latest reported failure. Existing publication tests continue to verify actual persisted bytes and fresh edge identities. Full Linux/Windows CI and one overall Codex review follow the integrated local matrix.

## Scope and coverage implementation

`symbol-scopes.ts` builds the shared lexical scope table and value regions. Bindings are indexed before references and assignment targets are resolved, so declaration order cannot invent an outer class identity. Class-expression internal names bind only inside that class. Class/function bodies and field initializers end the surrounding value region. Local class references do not depend on the best-effort extractor inventory.

`symbol-evidence.ts` connects that table to structural declarations and runtime effects. `symbol-coverage.ts` records unhandled named declaration surfaces and opaque expansion constructs. An unextracted callable/class is a coverage gap even after a successful parse; a reference or parameter name is not. Missing or malformed coverage is rejected. The comparator consumes this evidence without walking an AST.

The current declaration-coverage adapters cover JavaScript/JSX, TypeScript/TSX, Ruby, Python, Go, Rust and C++. Other grammars may parse and preserve known graph descriptors, but cannot automatically authorize an omitted symbol's deletion until a coverage adapter is supplied. Unsupported expansion/qualification remains uncertain; this is a conservative deletion gate, not a compiler or runtime equivalence checker.

## Interpretation limits

The comparison uses identities represented by the same parser/extractor in both revisions, rather than compiler-wide type equivalence or arbitrary execution. Unextractable old identities, opaque names/owners, and unsupported receiver qualification remain unknown. Supplemental fields describe potential callability when the extractor only provides a property inventory. A changed source identity can be a confirmed deletion even if another owner now has the same name; reusing the old graph ID for that different identity is separately rejected.

The scoped matrix lives in `tests/skill/understand/test_symbol_evidence_matrix.test.mjs`; publication checks remain in `test_prepare_incremental.test.mjs`. Test fixtures simulate analyzer output, and do not measure live LLM omission frequency.
