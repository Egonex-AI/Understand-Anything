# Source-evidence audit after PR #683 review round 19

Audited head: `acc7950`. This document records the implementation failure, not a claim that the source-evidence layer is finished.

## What failed

The original task needs two properties at the same time:

- Safety: a surviving old symbol omitted by the analyzer must not be published as a deletion.
- Progress: a verified deletion must not be blocked by an unrelated symbol.

The implementation treated these as individual review examples rather than invariants of one source model. Adding a broad uncertainty rule improved safety but blocked real deletions. Narrowing that rule without a scope model then opened another gap. Passing the growing fixture list did not establish either invariant under composition.

The first audit changed file-wide text into owner/name evidence, but kept three separate ancestry algorithms: `lexicalOwner`, `classReferences`, and `expressionOwner`. These disagree about expression names, lexical bindings, and scope boundaries. A string plus `null`, followed by an invented string sentinel, cannot state these distinctions reliably.

## Reproduced structural defects

These probes keep the old graph symbol `A.run` and remove its declaration from current source. A separate function/class keeps extraction nonempty.

| Current source shape | Current result | Required structural result |
| --- | --- | --- |
| `class B { run() {} }` | deleted | deleted |
| `const B = class { static Nested = class { run() {} } }` | unknown | deleted |
| `class B { static Nested = class { run() {} } }` | deleted | deleted |
| local `class B` inside a function, followed by `Object.defineProperty(B.prototype, 'run', ...)` | unknown | deleted |
| unrelated `const C = class B {}` before an installer on the existing outer B | unknown | deleted |
| change only that expression to anonymous `const C = class {}` | deleted | deleted |

The last two cases show that a named class expression incorrectly creates a binding in its enclosing scope. The local-class case shows that reference resolution depends on which classes the best-effort graph extractor happens to inventory. The nested-expression cases show that value exposure is being inferred by walking past a lexical scope boundary.

These are one architectural defect, not three missing `if` statements.

## Evidence is not completeness

`parse succeeded`, a nonempty `structure`, and a well-formed supplemental object do not establish a complete declaration inventory. The variable named `completeEvidence` currently checks the supplemental object's shape and version only. Its name and the final deletion message overstate what has been established.

A best-effort extractor is suitable for enriching a graph; its omissions cannot alone authorize removing an existing symbol. Declaration coverage and possible runtime writes are separate facts. Unsupported syntax must remain an explicit uncertainty within its possible scope, rather than disappearing because no recognizer emitted a record.

Arbitrary program execution is outside this feature. A call argument is not a file-level declaration merely because an arbitrary callee could retain it. Explicit unresolved assignment/installer targets remain uncertain. This boundary must be applied consistently, rather than changed by each reviewer example.

## What can be retained

The pre-prune immutable inventory, base/head binding, shared merge/finalize gate, one-attempt retry state, stale-shard replacement, fresh-edge reconciliation and failure-before-publication checks have separate regression coverage. Their contracts do not depend on how source ownership is represented. Preserve them while replacing the evidence producer/consumer boundary.

This is not a claim of general transactional filesystem safety. The required guarantee here is that an unresolved symbol report stops before graph/fingerprint/meta publication.

## Replacement boundary

1. Build one lexical scope tree from the same parsed AST. Every node is assigned to a scope during traversal. All declaration ownership, class references and value exposure use this tree; consumers cannot independently walk ancestors.
2. Represent targets explicitly: file scope, a named class binding, an independent local scope, or an unresolved external target. Local and unknown are distinct types. No sentinel symbol names are allowed.
3. A declaration creates bindings according to its grammar. A class-expression internal name exists inside its own class scope. A variable binding exists in its declared lexical scope. Fields and nested class/function bodies start fresh value regions.
4. Resolve direct value binding within the current value region. Wrappers may make an external binding unresolved; they cannot cause traversal to escape an enclosing class or function. Reference resolution uses the scope table, independent of the best-effort structural inventory.
5. Keep declaration identity, declaration coverage, and potential installer effects separate. Validate the evidence schema as schema validation, not as a completeness proof. Unknown coverage blocks a deletion for the affected identity/scope.
6. Keep public graph schema and node IDs unchanged. Convert graph name/ID hints at the graph-to-source boundary only. Internal literal names and scope identity must not use graph-ID normalization.
7. The comparator consumes source evidence and returns a decision plus a reason. It does not know AST grammar node types or installer API spelling. Prepare/retry/finalize do not know source matching rules.

## Verification before another review request

The regression corpus remains useful, but it is not the design specification. Add composition tests derived from the scope rules:

- Move an unrelated expression between a declaration, assigned expression, field initializer, local function, call argument and wrapper assignment.
- Rename only the internal class-expression name. Its outer binding and other bindings must be unchanged.
- Add/remove an unrelated local declaration or installer. It cannot change an old external symbol's decision.
- Replace a resolved target with a shadowed/unresolved target. Certainty may decrease, but it must not silently become a different known owner.
- Move declaration lines and change graph-ID spelling. Source identity must remain unchanged.
- Remove/malform coverage evidence or use unsupported declaration syntax. Absence must not become a confirmed deletion.
- Check the existing 20-to-1, equal-count, true-deletion, repaired-output and durable-byte publication cases against the new source model.

Commit the scope model, evidence adapter/comparator and contract tests by module. Request one overall review only after these invariants and the existing publication suites pass. Evaluate review findings against this contract; a finding must be reproduced, and its claimed semantics must not automatically redefine the feature.

## Implementation following this audit

The three ancestry algorithms and string sentinel have been removed. `symbol-scopes.ts` now assigns the shared scope tree and value regions; its binding queries work independently of graph extraction. Version 2 evidence uses tagged scopes, separate coverage gaps and effects, and fails closed on missing/unsupported coverage. The matcher excludes known local scopes and checks compatible gaps/effects before authorizing deletion. Public graph schema, IDs and publication/retry boundaries are unchanged.

Scope composition tests cover nested fields across declared/assigned/wrapped classes, internal-name alpha-renaming, local installers, shadowing and declaration-order changes. Integration tests retain the original deletion/omission distinctions and add coverage-profile failures. The historical defects above remain recorded as the reason for the replacement, not as descriptions of the new model.
