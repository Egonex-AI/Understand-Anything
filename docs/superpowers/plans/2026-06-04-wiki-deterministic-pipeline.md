# Wiki Deterministic Assembly Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wiki-worker's direct-to-final-directory output with a deterministic assembly pipeline that validates, indexes, and assembles wiki content — aligning `/understand-wiki` reliability with `/understand`.

**Architecture:** wiki-worker writes raw JSON to `intermediate/wiki/`. Three deterministic scripts run in sequence: Node.js schema validator (reuses `@understand-anything/core`), Python index builder (computes index from actual files), Python assembler (copies validated output to `wiki/` with fingerprints and quality metrics).

**Tech Stack:** Node.js (validate-wiki-schema.mjs, imports core validators), Python 3.10+ (build-wiki-index.py, assemble-wiki.py), existing `@understand-anything/core` TypeScript validators.

**Spec:** `docs/superpowers/specs/2026-06-04-wiki-deterministic-pipeline-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `skills/understand-wiki/validate-wiki-schema.mjs` | **CREATE** | Node.js script: reads intermediate wiki JSONs, validates via core validators, auto-fixes recoverable issues, writes validation report |
| `skills/understand-wiki/build-wiki-index.py` | **CREATE** | Python script: scans intermediate wiki directory, deterministically builds index.json from actual files |
| `skills/understand-wiki/assemble-wiki.py` | **CREATE** | Python script: copies validated intermediate to final wiki/, generates meta.json with hashes and quality metrics |
| `agents/wiki-worker.md` | **MODIFY** | Change output path to intermediate/wiki/, remove Phase 3 (index + meta generation) |
| `skills/understand-wiki/SKILL.md` | **MODIFY** | Add Phase 2 description |
| `skills/understand-wiki/docs/wiki-phase1-generation.md` | **MODIFY** | Update wiki-worker output path references |
| `skills/understand-wiki/docs/wiki-phase2-assembly.md` | **CREATE** | Phase 2 deterministic pipeline documentation |
| `skills/understand-wiki/docs/wiki-schema-reference.md` | **MODIFY** | Document new meta.json fields (domainHashes, qualityScore) |
| `packages/core/src/wiki-schema.ts` | **MODIFY** | Add auto-fix helper functions, export for mjs consumption |

---

## Task 1: Add auto-fix helpers to `wiki-schema.ts`

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/wiki-schema.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/wiki-schema.test.ts`

- [ ] **Step 1: Write failing test for `autoFixDomainPage`**

```typescript
// In packages/core/src/__tests__/wiki-schema.test.ts — add new describe block

describe("autoFixDomainPage", () => {
  it("should convert string entities to objects", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: ["Order", "Payment"],
      flows: [],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.entities[0]).toEqual({ name: "Order", description: "" });
    expect(data.entities[1]).toEqual({ name: "Payment", description: "" });
    expect(fixes).toHaveLength(2);
  });

  it("should add missing summary with default", () => {
    const page = { id: "domain:test", name: "Test", entities: [], flows: [] };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.summary).toBe("No summary available");
    expect(fixes).toHaveLength(1);
  });

  it("should auto-number steps missing order", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: [],
      flows: [
        {
          id: "flow:a",
          name: "Flow A",
          summary: "test",
          steps: [
            { name: "Step 1", description: "desc" },
            { name: "Step 2", description: "desc" },
          ],
        },
      ],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.flows[0].steps[0].order).toBe(1);
    expect(data.flows[0].steps[1].order).toBe(2);
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("should generate flow id from name when missing", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: [],
      flows: [{ name: "Create Order", summary: "test", steps: [] }],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.flows[0].id).toBe("flow:create-order");
    expect(fixes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd understand-anything-plugin/packages/core && npx vitest run src/__tests__/wiki-schema.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `autoFixDomainPage` is not defined.

- [ ] **Step 3: Implement `autoFixDomainPage` in wiki-schema.ts**

Add to the end of `packages/core/src/wiki-schema.ts`:

```typescript
export interface AutoFixResult<T> {
  data: T;
  fixes: string[];
}

function toKebabCase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function autoFixDomainPage(
  raw: Record<string, unknown>,
  filePath: string,
): AutoFixResult<WikiDomainPage> {
  const fixes: string[] = [];
  const data = { ...raw } as Record<string, unknown>;

  if (!data.summary || typeof data.summary !== "string") {
    data.summary = "No summary available";
    fixes.push(`${filePath}: added default summary`);
  }

  if (!Array.isArray(data.entities)) {
    data.entities = [];
    fixes.push(`${filePath}: added empty entities array`);
  } else {
    data.entities = (data.entities as unknown[]).map((e, i) => {
      if (typeof e === "string") {
        fixes.push(`${filePath}: entities[${i}] converted from string to object`);
        return { name: e, description: "" };
      }
      return e;
    });
  }

  if (!Array.isArray(data.flows)) {
    data.flows = [];
    fixes.push(`${filePath}: added empty flows array`);
  } else {
    data.flows = (data.flows as Record<string, unknown>[]).map((flow, fi) => {
      const f = { ...flow };
      if (!f.id || typeof f.id !== "string") {
        const name = typeof f.name === "string" ? f.name : `flow-${fi}`;
        f.id = `flow:${toKebabCase(name)}`;
        fixes.push(`${filePath}: flows[${fi}] generated id '${f.id}'`);
      }
      if (Array.isArray(f.steps)) {
        f.steps = (f.steps as Record<string, unknown>[]).map((step, si) => {
          const s = { ...step };
          if (typeof s.order !== "number") {
            s.order = si + 1;
            fixes.push(`${filePath}: flows[${fi}].steps[${si}] set order=${si + 1}`);
          }
          if (s.sourceRef !== undefined && s.sourceRef !== null && typeof s.sourceRef !== "object") {
            s.sourceRef = null;
            fixes.push(`${filePath}: flows[${fi}].steps[${si}] reset invalid sourceRef`);
          }
          return s;
        });
      }
      return f;
    });
  }

  return { data: data as unknown as WikiDomainPage, fixes };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd understand-anything-plugin/packages/core && npx vitest run src/__tests__/wiki-schema.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 5: Rebuild core package**

```bash
cd understand-anything-plugin/packages/core && npx tsc
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/wiki-schema.ts packages/core/src/__tests__/wiki-schema.test.ts
git commit -m "feat(core): add autoFixDomainPage helper for wiki deterministic pipeline"
```

---

## Task 2: Create `validate-wiki-schema.mjs`

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/validate-wiki-schema.mjs`

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
/**
 * validate-wiki-schema.mjs
 *
 * Validates wiki JSON files in an intermediate directory against
 * @understand-anything/core schemas. Auto-fixes recoverable issues.
 *
 * Usage:
 *   node validate-wiki-schema.mjs <intermediate_wiki_dir> [--parent] [--service-root=<path>]
 *
 * Output: <intermediate_wiki_dir>/../wiki-validation-report.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve plugin root to import core
const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const coreDist = join(pluginRoot, "packages/core/dist/index.js");

if (!existsSync(coreDist)) {
  console.error(`[validate-wiki-schema] Core package not built. Run: cd ${pluginRoot} && pnpm --filter @understand-anything/core build`);
  process.exit(1);
}

const core = await import(coreDist);

const args = process.argv.slice(2);
const isParent = args.includes("--parent");
const serviceRootArg = args.find((a) => a.startsWith("--service-root="));
const serviceRoot = serviceRootArg ? serviceRootArg.split("=")[1] : null;
const wikiDir = args.find((a) => !a.startsWith("--"));

if (!wikiDir) {
  console.error("Usage: node validate-wiki-schema.mjs <intermediate_wiki_dir> [--parent] [--service-root=<path>]");
  process.exit(1);
}

function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const report = { passed: true, autoFixed: 0, errors: [], warnings: [], filesProcessed: 0, filesSkipped: 0 };

function addIssue(severity, msg) {
  if (severity === "error") {
    report.errors.push(msg);
    report.passed = false;
  } else {
    report.warnings.push(msg);
  }
}

if (isParent) {
  // Parent mode: validate overview.json, architecture.json, domains/*.json as cross-domain
  for (const [file, validator] of [
    ["overview.json", core.validateParentWikiOverview],
    ["architecture.json", core.validateParentWikiArchitecture],
  ]) {
    const path = join(wikiDir, file);
    if (!existsSync(path)) {
      addIssue("warning", `${file}: not found`);
      continue;
    }
    const data = loadJSON(path);
    if (!data) { addIssue("error", `${file}: invalid JSON`); report.filesSkipped++; continue; }
    const issues = validator(data, file);
    for (const i of issues) addIssue(i.severity, `${i.file}: ${i.message}`);
    report.filesProcessed++;
  }

  const domainDir = join(wikiDir, "domains");
  if (existsSync(domainDir)) {
    for (const f of readdirSync(domainDir).filter((f) => f.endsWith(".json"))) {
      const data = loadJSON(join(domainDir, f));
      if (!data) { addIssue("error", `domains/${f}: invalid JSON`); report.filesSkipped++; continue; }
      const issues = core.validateParentWikiCrossDomain(data, `domains/${f}`);
      for (const i of issues) addIssue(i.severity, `${i.file}: ${i.message}`);
      report.filesProcessed++;
    }
  }
} else {
  // Service mode: validate service.json, domains/*.json
  const servicePath = join(wikiDir, "service.json");
  if (existsSync(servicePath)) {
    const data = loadJSON(servicePath);
    if (!data) { addIssue("error", "service.json: invalid JSON"); report.filesSkipped++; }
    else {
      const issues = core.validateWikiServiceOverview(data, "service.json");
      for (const i of issues) addIssue(i.severity, `${i.file}: ${i.message}`);
      report.filesProcessed++;
    }
  } else {
    addIssue("error", "service.json: not found");
  }

  const domainDir = join(wikiDir, "domains");
  if (existsSync(domainDir)) {
    const existingSourceFiles = new Set();
    if (serviceRoot) {
      // Build set of existing source files for sourceRef validation
      // (simple check: just verify file exists, not line ranges)
    }

    for (const f of readdirSync(domainDir).filter((f) => f.endsWith(".json"))) {
      const filePath = join(domainDir, f);
      const data = loadJSON(filePath);
      if (!data) { addIssue("error", `domains/${f}: invalid JSON`); report.filesSkipped++; continue; }

      // Auto-fix
      if (core.autoFixDomainPage) {
        const { data: fixed, fixes } = core.autoFixDomainPage(data, `domains/${f}`);
        if (fixes.length > 0) {
          writeFileSync(filePath, JSON.stringify(fixed, null, 2));
          report.autoFixed += fixes.length;
          for (const fix of fixes) report.warnings.push(`[auto-fix] ${fix}`);
        }
        // Validate the fixed version
        const issues = core.validateWikiDomainPage(fixed, `domains/${f}`);
        for (const i of issues) addIssue(i.severity, `${i.file}: ${i.message}`);
      } else {
        const issues = core.validateWikiDomainPage(data, `domains/${f}`);
        for (const i of issues) addIssue(i.severity, `${i.file}: ${i.message}`);
      }

      // Cross-check: domain ID should match filename
      const expectedId = `domain:${f.replace(/\.json$/, "")}`;
      if (data.id && data.id !== expectedId) {
        const fixed = loadJSON(filePath);
        if (fixed) {
          fixed.id = expectedId;
          writeFileSync(filePath, JSON.stringify(fixed, null, 2));
          report.autoFixed++;
          report.warnings.push(`[auto-fix] domains/${f}: id corrected from '${data.id}' to '${expectedId}'`);
        }
      }

      // sourceRef file existence check
      if (serviceRoot && data.flows) {
        for (const flow of data.flows) {
          if (!flow.steps) continue;
          for (const step of flow.steps) {
            if (step.sourceRef?.file) {
              const refPath = join(serviceRoot, step.sourceRef.file);
              if (!existsSync(refPath)) {
                addIssue("warning", `domains/${f}: sourceRef '${step.sourceRef.file}' does not exist on disk`);
              }
            }
          }
        }
      }

      report.filesProcessed++;
    }
  } else {
    addIssue("error", "domains/ directory not found");
  }
}

const reportPath = join(dirname(wikiDir), "wiki-validation-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (report.passed) {
  console.log(`[validate-wiki-schema] PASSED — ${report.filesProcessed} files, ${report.autoFixed} auto-fixes`);
} else {
  console.error(`[validate-wiki-schema] FAILED — ${report.errors.length} errors, ${report.autoFixed} auto-fixes`);
  for (const e of report.errors) console.error(`  ERROR: ${e}`);
}
for (const w of report.warnings) console.log(`  WARN: ${w}`);

process.exit(report.passed ? 0 : 1);
```

- [ ] **Step 2: Verify script syntax**

```bash
node --check understand-anything-plugin/skills/understand-wiki/validate-wiki-schema.mjs
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/validate-wiki-schema.mjs
git commit -m "feat(wiki): add validate-wiki-schema.mjs deterministic validator"
```

---

## Task 3: Create `build-wiki-index.py`

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/build-wiki-index.py`

- [ ] **Step 1: Create the script**

```python
"""Deterministic wiki index builder.

Scans intermediate wiki directory and computes index.json from actual files.
Replaces LLM-generated index with a deterministic, file-grounded index.

Usage:
    python build-wiki-index.py <intermediate_wiki_dir> [--parent] [--service-name=<name>]
"""

import json
import os
import re
import sys


def to_kebab_case(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def build_service_index(wiki_dir: str, service_name: str) -> dict:
    entries = []

    service_path = os.path.join(wiki_dir, "service.json")
    if os.path.exists(service_path):
        with open(service_path) as f:
            svc = json.load(f)
        entries.append({
            "id": "wiki:service-overview",
            "name": svc.get("name", service_name),
            "type": "service",
            "summary": _truncate(svc.get("description", ""), 100),
        })

    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return {"entries": entries}

    domain_files = sorted(
        f for f in os.listdir(domain_dir) if f.endswith(".json")
    )

    for df in domain_files:
        slug = df.removesuffix(".json")
        domain_id = f"wiki:domain:{slug}"
        with open(os.path.join(domain_dir, df)) as f:
            page = json.load(f)

        entries.append({
            "id": domain_id,
            "name": page.get("name", slug),
            "type": "domain",
            "service": service_name,
            "summary": _truncate(page.get("summary", ""), 100),
        })

        for flow in page.get("flows", []):
            flow_id = flow.get("id", f"flow:{to_kebab_case(flow.get('name', ''))}")
            entries.append({
                "id": f"wiki:{flow_id}" if not flow_id.startswith("wiki:") else flow_id,
                "name": flow.get("name", flow_id),
                "type": "flow",
                "service": service_name,
                "domain": domain_id,
                "summary": _truncate(flow.get("summary", ""), 100),
            })

    return {"entries": entries}


def build_parent_index(wiki_dir: str) -> dict:
    entries = []

    overview_path = os.path.join(wiki_dir, "overview.json")
    if os.path.exists(overview_path):
        with open(overview_path) as f:
            data = json.load(f)
        entries.append({
            "id": "wiki:overview",
            "name": data.get("name", "System Overview"),
            "type": "overview",
            "summary": _truncate(data.get("description", ""), 100),
        })

    arch_path = os.path.join(wiki_dir, "architecture.json")
    if os.path.exists(arch_path):
        entries.append({
            "id": "wiki:architecture",
            "name": "System Architecture",
            "type": "architecture",
            "summary": "Cross-service call topology and shared resources",
        })

    domain_dir = os.path.join(wiki_dir, "domains")
    if os.path.isdir(domain_dir):
        for df in sorted(os.listdir(domain_dir)):
            if not df.endswith(".json"):
                continue
            slug = df.removesuffix(".json")
            with open(os.path.join(domain_dir, df)) as f:
                page = json.load(f)
            entries.append({
                "id": f"wiki:cross-domain:{slug}",
                "name": page.get("name", slug),
                "type": "cross-domain",
                "summary": _truncate(page.get("summary", ""), 100),
            })

    return {"entries": entries}


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def main() -> None:
    args = sys.argv[1:]
    is_parent = "--parent" in args
    svc_arg = next((a for a in args if a.startswith("--service-name=")), None)
    service_name = svc_arg.split("=")[1] if svc_arg else "unknown-service"
    wiki_dir = next((a for a in args if not a.startswith("--")), None)

    if not wiki_dir:
        print("Usage: python build-wiki-index.py <wiki_dir> [--parent] [--service-name=<name>]")
        sys.exit(1)

    if is_parent:
        index = build_parent_index(wiki_dir)
    else:
        index = build_service_index(wiki_dir, service_name)

    output_path = os.path.join(wiki_dir, "index.json")
    with open(output_path, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(f"[build-wiki-index] Generated {len(index['entries'])} entries → {output_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script syntax**

```bash
python3 -c "import py_compile; py_compile.compile('understand-anything-plugin/skills/understand-wiki/build-wiki-index.py', doraise=True)"
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/build-wiki-index.py
git commit -m "feat(wiki): add build-wiki-index.py deterministic index builder"
```

---

## Task 4: Create `assemble-wiki.py`

**Files:**
- Create: `understand-anything-plugin/skills/understand-wiki/assemble-wiki.py`

- [ ] **Step 1: Create the script**

```python
"""Wiki assembly script.

Copies validated intermediate wiki files to the final wiki directory,
generates meta.json with content hashes and quality metrics.

Usage:
    python assemble-wiki.py <intermediate_wiki_dir> <final_wiki_dir> <git_commit_hash> \
        [--output-language=<lang>] [--service-root=<path>]
"""

import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()[:16]}"


def compute_source_ref_coverage(wiki_dir: str) -> dict:
    total_steps = 0
    with_ref = 0
    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return {"totalSteps": 0, "withSourceRef": 0, "coveragePercent": 100}

    for f in os.listdir(domain_dir):
        if not f.endswith(".json"):
            continue
        with open(os.path.join(domain_dir, f)) as fh:
            page = json.load(fh)
        for flow in page.get("flows", []):
            for step in flow.get("steps", []):
                total_steps += 1
                if step.get("sourceRef") and step["sourceRef"].get("file"):
                    with_ref += 1

    return {
        "totalSteps": total_steps,
        "withSourceRef": with_ref,
        "coveragePercent": round(with_ref / total_steps * 100, 1) if total_steps else 100,
    }


DEPTH_KEYWORDS = re.compile(
    r"(business rule|exception|error|side effect|event|callback|transaction|validation|"
    r"业务规则|异常|错误|副作用|事件|回调|事务|校验)",
    re.IGNORECASE,
)


def compute_content_depth(wiki_dir: str) -> float:
    scores = []
    domain_dir = os.path.join(wiki_dir, "domains")
    if not os.path.isdir(domain_dir):
        return 100.0

    for f in os.listdir(domain_dir):
        if not f.endswith(".json"):
            continue
        with open(os.path.join(domain_dir, f)) as fh:
            page = json.load(fh)
        text = json.dumps(page, ensure_ascii=False)
        summary_len = len(page.get("summary", ""))
        keyword_hits = len(DEPTH_KEYWORDS.findall(text))
        flow_count = len(page.get("flows", []))
        score = min(100, summary_len // 5 + keyword_hits * 5 + flow_count * 10)
        scores.append(score)

    return round(sum(scores) / len(scores), 1) if scores else 0


def grade(schema: float, source_ref: float, depth: float) -> str:
    avg = (schema + source_ref + depth) / 3
    if avg >= 90:
        return "A"
    if avg >= 80:
        return "B+"
    if avg >= 70:
        return "B"
    if avg >= 60:
        return "C+"
    if avg >= 50:
        return "C"
    return "D"


def main() -> None:
    args = sys.argv[1:]
    flags = {a.split("=")[0]: a.split("=")[1] for a in args if "=" in a}
    positional = [a for a in args if not a.startswith("--")]

    if len(positional) < 3:
        print("Usage: python assemble-wiki.py <intermediate_dir> <final_dir> <git_hash> [options]")
        sys.exit(1)

    intermediate_dir = positional[0]
    final_dir = positional[1]
    git_hash = positional[2]
    output_language = flags.get("--output-language", "en")

    report_path = os.path.join(os.path.dirname(intermediate_dir), "wiki-validation-report.json")
    validation_warnings = []
    if os.path.exists(report_path):
        with open(report_path) as f:
            report = json.load(f)
        validation_warnings = report.get("warnings", [])
        if report.get("errors"):
            print(f"[assemble-wiki] WARNING: {len(report['errors'])} validation errors — proceeding with partial results")
            for e in report["errors"]:
                print(f"  ERROR: {e}")

    os.makedirs(final_dir, exist_ok=True)
    os.makedirs(os.path.join(final_dir, "domains"), exist_ok=True)

    old_meta = {}
    old_meta_path = os.path.join(final_dir, "meta.json")
    if os.path.exists(old_meta_path):
        with open(old_meta_path) as f:
            old_meta = json.load(f)

    old_hashes = old_meta.get("domainHashes", {})

    for item in ["service.json", "index.json"]:
        src = os.path.join(intermediate_dir, item)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(final_dir, item))

    domain_hashes = {}
    copied = 0
    skipped = 0
    int_domains = os.path.join(intermediate_dir, "domains")
    if os.path.isdir(int_domains):
        for f in os.listdir(int_domains):
            if not f.endswith(".json"):
                continue
            src = os.path.join(int_domains, f)
            new_hash = sha256_file(src)
            slug = f.removesuffix(".json")
            domain_hashes[slug] = new_hash
            if old_hashes.get(slug) == new_hash:
                skipped += 1
            else:
                shutil.copy2(src, os.path.join(final_dir, "domains", f))
                copied += 1

    for item in ["overview.json", "architecture.json"]:
        src = os.path.join(intermediate_dir, item)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(final_dir, item))

    src_ref = compute_source_ref_coverage(final_dir)
    depth = compute_content_depth(final_dir)
    schema_score = 100 if not validation_warnings else max(0, 100 - len(validation_warnings) * 2)

    meta = {
        "gitCommitHash": git_hash,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": "1.0.0",
        "outputLanguage": output_language,
        "domainHashes": domain_hashes,
        "sourceRefCoverage": src_ref,
        "qualityScore": {
            "schemaCompliance": schema_score,
            "sourceRefCoverage": src_ref["coveragePercent"],
            "contentDepth": depth,
            "overallGrade": grade(schema_score, src_ref["coveragePercent"], depth),
        },
        "validationWarnings": validation_warnings[:20],
    }

    with open(os.path.join(final_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"[assemble-wiki] Done — copied {copied}, skipped {skipped} (unchanged), {len(domain_hashes)} domains")
    print(f"[assemble-wiki] Quality: {meta['qualityScore']['overallGrade']} (schema={schema_score}, srcRef={src_ref['coveragePercent']}%, depth={depth})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script syntax**

```bash
python3 -c "import py_compile; py_compile.compile('understand-anything-plugin/skills/understand-wiki/assemble-wiki.py', doraise=True)"
```

Expected: No output (success).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/assemble-wiki.py
git commit -m "feat(wiki): add assemble-wiki.py for validated assembly with fingerprints"
```

---

## Task 5: Update wiki-worker.md output path and remove Phase 3

**Files:**
- Modify: `understand-anything-plugin/agents/wiki-worker.md`

- [ ] **Step 1: Change output directory in Phase 1**

In wiki-worker.md, replace all occurrences of `$PROJECT_ROOT/.understand-anything/wiki/` with `$PROJECT_ROOT/.understand-anything/intermediate/wiki/` for write operations.

Update the directory creation command from:
```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/wiki/domains"
```
to:
```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate/wiki/domains"
```

Update the Output Directory Structure section to reflect `intermediate/wiki/`.

- [ ] **Step 2: Remove Phase 3 (Index and Metadata Generation)**

Delete the entire "Phase 3 — Index and Metadata Generation" section (Steps 8 and 9) and the associated "Index entry rules" block. Replace with:

```markdown
## Phase 3 — (Removed)

Index and metadata generation is now handled by the deterministic assembly pipeline
(`build-wiki-index.py` and `assemble-wiki.py`). wiki-worker only produces content files.
```

- [ ] **Step 3: Update Critical Constraints**

Change:
```
- NEVER write files outside `$PROJECT_ROOT/.understand-anything/wiki/`
```
to:
```
- NEVER write files outside `$PROJECT_ROOT/.understand-anything/intermediate/wiki/`
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/agents/wiki-worker.md
git commit -m "refactor(wiki-worker): output to intermediate/, remove index/meta generation"
```

---

## Task 6: Update SKILL.md and phase docs

**Files:**
- Modify: `understand-anything-plugin/skills/understand-wiki/SKILL.md`
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md`
- Create: `understand-anything-plugin/skills/understand-wiki/docs/wiki-phase2-assembly.md`
- Modify: `understand-anything-plugin/skills/understand-wiki/docs/wiki-schema-reference.md`

- [ ] **Step 1: Add Phase 2 to SKILL.md**

After the Phase 1 section, before Quality Gate, add:

```markdown
### Phase 2 — Deterministic Assembly

After wiki-worker writes content to `intermediate/wiki/`, run the deterministic pipeline to validate, index, and assemble the final wiki.

**Detailed implementation:** See [Phase 2 — Assembly Pipeline](docs/wiki-phase2-assembly.md)
```

Update the phase count from `[Phase N/4]` to `[Phase N/5]` in the Progress Reporting section.

- [ ] **Step 2: Create Phase 2 doc**

Create `docs/wiki-phase2-assembly.md` with the pipeline documentation:
- Script invocation order and arguments
- Auto-fix behavior description
- Error handling per script
- Incremental path specifics (copy unchanged domains before running pipeline)

- [ ] **Step 3: Update wiki-phase1-generation.md**

Change all references to `$PROJECT_ROOT/.understand-anything/wiki/` output path to `$PROJECT_ROOT/.understand-anything/intermediate/wiki/`.

- [ ] **Step 4: Update wiki-schema-reference.md**

Add documentation for new `meta.json` fields: `domainHashes`, `sourceRefCoverage`, `qualityScore`.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-wiki/SKILL.md \
  understand-anything-plugin/skills/understand-wiki/docs/wiki-phase1-generation.md \
  understand-anything-plugin/skills/understand-wiki/docs/wiki-phase2-assembly.md \
  understand-anything-plugin/skills/understand-wiki/docs/wiki-schema-reference.md
git commit -m "docs(wiki): add Phase 2 deterministic assembly pipeline documentation"
```

---

## Task 7: Integration verification

- [ ] **Step 1: Verify all TypeScript compiles**

```bash
cd understand-anything-plugin/packages/core && npx tsc --noEmit
cd ../dashboard && npx tsc --noEmit
```

Expected: Both pass with no errors.

- [ ] **Step 2: Run core tests**

```bash
cd understand-anything-plugin/packages/core && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: All tests pass, including new `autoFixDomainPage` tests.

- [ ] **Step 3: Verify Python scripts**

```bash
python3 -c "import py_compile; py_compile.compile('understand-anything-plugin/skills/understand-wiki/build-wiki-index.py', doraise=True)"
python3 -c "import py_compile; py_compile.compile('understand-anything-plugin/skills/understand-wiki/assemble-wiki.py', doraise=True)"
```

Expected: No output (both pass).

- [ ] **Step 4: Verify Node.js script**

```bash
node --check understand-anything-plugin/skills/understand-wiki/validate-wiki-schema.mjs
```

Expected: No output (pass).

- [ ] **Step 5: Final commit**

```bash
git push origin main
```
