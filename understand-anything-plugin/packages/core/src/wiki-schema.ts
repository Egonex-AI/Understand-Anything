import type {
  WikiMeta,
  WikiIndex,
  WikiIndexEntry,
  WikiDomainPage,
  WikiServiceOverview,
  WikiFlow,
  WikiFlowStep,
  WikiOverview,
  WikiArchitecture,
  WikiCrossDomain,
} from "./types.js";

export interface ValidationIssue {
  file: string;
  severity: "error" | "warning";
  message: string;
}

export interface WikiValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  stats: {
    pagesValidated: number;
    domainsFound: number;
    flowsFound: number;
    coveragePercent: number;
  };
}

export function validateWikiMeta(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "meta.json is not a valid object" });
    return issues;
  }
  const meta = data as Record<string, unknown>;
  if (!meta.gitCommitHash || typeof meta.gitCommitHash !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing or invalid gitCommitHash" });
  }
  if (!meta.generatedAt || typeof meta.generatedAt !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing or invalid generatedAt" });
  }
  if (!meta.version || typeof meta.version !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing or invalid version" });
  }
  if (!meta.outputLanguage || typeof meta.outputLanguage !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing or invalid outputLanguage" });
  }
  if (meta.domainStates !== undefined) {
    if (typeof meta.domainStates !== "object" || meta.domainStates === null || Array.isArray(meta.domainStates)) {
      issues.push({ file: filePath, severity: "error", message: "domainStates must be an object" });
    } else {
      for (const [domainId, state] of Object.entries(meta.domainStates as Record<string, unknown>)) {
        const s = state as Record<string, unknown>;
        if (typeof s.lastGeneratedAt !== "string") {
          issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].lastGeneratedAt must be a string` });
        }
        if (typeof s.nodeCount !== "number") {
          issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].nodeCount must be a number` });
        }
        if (typeof s.flowCount !== "number") {
          issues.push({ file: filePath, severity: "error", message: `domainStates['${domainId}'].flowCount must be a number` });
        }
      }
    }
  }
  return issues;
}

export function validateWikiIndex(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "index.json is not a valid object" });
    return issues;
  }
  const index = data as Record<string, unknown>;
  if (!Array.isArray(index.entries)) {
    issues.push({ file: filePath, severity: "error", message: "index.entries is not an array" });
    return issues;
  }
  if (index.entries.length === 0) {
    issues.push({ file: filePath, severity: "error", message: "index.entries is empty" });
    return issues;
  }
  const validTypes = new Set(["overview", "architecture", "domain", "flow", "step", "service"]);
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i] as Record<string, unknown>;
    if (!entry.id || typeof entry.id !== "string") {
      issues.push({ file: filePath, severity: "error", message: `entries[${i}] missing id` });
    }
    if (!entry.name || typeof entry.name !== "string") {
      issues.push({ file: filePath, severity: "error", message: `entries[${i}] missing name` });
    }
    if (!entry.type || !validTypes.has(entry.type as string)) {
      issues.push({ file: filePath, severity: "error", message: `entries[${i}] invalid type: ${entry.type}` });
    }
    if (!entry.summary || typeof entry.summary !== "string") {
      issues.push({ file: filePath, severity: "warning", message: `entries[${i}] missing summary` });
    }
  }
  return issues;
}

export function validateWikiDomainPage(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "Domain page is not a valid object" });
    return issues;
  }
  const page = data as Record<string, unknown>;
  if (!page.id || typeof page.id !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing id" });
  }
  if (!page.name || typeof page.name !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing name" });
  }
  if (!page.summary || typeof page.summary !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing summary" });
  }
  if (!Array.isArray(page.flows)) {
    issues.push({ file: filePath, severity: "error", message: "Missing flows array" });
  } else {
    for (let i = 0; i < page.flows.length; i++) {
      const flow = page.flows[i] as Record<string, unknown>;
      if (!flow.id || typeof flow.id !== "string") {
        issues.push({ file: filePath, severity: "error", message: `flows[${i}] missing id` });
      }
      if (!flow.name || typeof flow.name !== "string") {
        issues.push({ file: filePath, severity: "error", message: `flows[${i}] missing name` });
      }
      if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
        issues.push({ file: filePath, severity: "warning", message: `flows[${i}] has no steps` });
      } else {
        for (let j = 0; j < (flow.steps as unknown[]).length; j++) {
          const step = (flow.steps as Record<string, unknown>[])[j];
          if (typeof step.order !== "number") {
            issues.push({ file: filePath, severity: "error", message: `flows[${i}].steps[${j}] missing order` });
          }
          if (!step.description || typeof step.description !== "string") {
            issues.push({ file: filePath, severity: "warning", message: `flows[${i}].steps[${j}] missing description` });
          }
        }
      }
    }
  }
  // Content non-empty check
  if (page.summary && typeof page.summary === "string" && (page.summary as string).length < 10) {
    issues.push({ file: filePath, severity: "warning", message: "Summary is too short (< 10 chars)" });
  }
  return issues;
}

export function validateWikiServiceOverview(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "service.json is not a valid object" });
    return issues;
  }
  const svc = data as Record<string, unknown>;
  if (!svc.name || typeof svc.name !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing service name" });
  }
  if (!svc.description || typeof svc.description !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing service description" });
  }
  if (!Array.isArray(svc.techStack)) {
    issues.push({ file: filePath, severity: "warning", message: "Missing techStack array" });
  }
  return issues;
}

/**
 * Validate coverage: every domain node in domain-graph should have a corresponding wiki page.
 */
export function validateCoverage(
  domainNodeIds: string[],
  wikiDomainFiles: string[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const wikiDomains = new Set(wikiDomainFiles.map((f) => f.replace(/\.json$/, "")));
  for (const nodeId of domainNodeIds) {
    const domainSlug = nodeId.replace(/^domain:/, "");
    if (!wikiDomains.has(domainSlug)) {
      issues.push({
        file: "coverage",
        severity: "error",
        message: `Domain '${nodeId}' has no corresponding wiki page (expected domains/${domainSlug}.json)`,
      });
    }
  }
  return issues;
}

/**
 * Validate source references: ensure files referenced in wiki actually exist.
 */
export function validateSourceRefs(
  refs: Array<{ file: string; lineRange?: [number, number] }>,
  existingFiles: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const ref of refs) {
    if (!existingFiles.has(ref.file)) {
      issues.push({
        file: "source-refs",
        severity: "warning",
        message: `Referenced source file does not exist: ${ref.file}`,
      });
    }
  }
  return issues;
}

export function validateParentWikiOverview(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "overview.json is not a valid object" });
    return issues;
  }
  const overview = data as Record<string, unknown>;
  if (!overview.name || typeof overview.name !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing system name" });
  }
  if (!overview.description || typeof overview.description !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing system description" });
  }
  if (!Array.isArray(overview.services)) {
    issues.push({ file: filePath, severity: "error", message: "Missing services array" });
  } else {
    if (overview.services.length === 0) {
      issues.push({ file: filePath, severity: "error", message: "services array is empty" });
    }
    for (let i = 0; i < overview.services.length; i++) {
      const svc = overview.services[i] as Record<string, unknown>;
      if (!svc.name || typeof svc.name !== "string") {
        issues.push({ file: filePath, severity: "error", message: `services[${i}] missing name` });
      }
      if (!svc.description || typeof svc.description !== "string") {
        issues.push({ file: filePath, severity: "warning", message: `services[${i}] missing description` });
      }
      if (!Array.isArray(svc.domains)) {
        issues.push({ file: filePath, severity: "warning", message: `services[${i}] missing domains array` });
      }
    }
  }
  if (!Array.isArray(overview.techStack)) {
    issues.push({ file: filePath, severity: "warning", message: "Missing techStack array" });
  }
  return issues;
}

export function validateParentWikiArchitecture(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "architecture.json is not a valid object" });
    return issues;
  }
  const arch = data as Record<string, unknown>;
  if (!Array.isArray(arch.crossServiceCalls)) {
    issues.push({ file: filePath, severity: "error", message: "Missing crossServiceCalls array" });
  } else {
    for (let i = 0; i < arch.crossServiceCalls.length; i++) {
      const call = arch.crossServiceCalls[i] as Record<string, unknown>;
      if (!call.caller || typeof call.caller !== "object") {
        issues.push({ file: filePath, severity: "error", message: `crossServiceCalls[${i}] missing caller` });
      }
      if (!call.callee || typeof call.callee !== "object") {
        issues.push({ file: filePath, severity: "error", message: `crossServiceCalls[${i}] missing callee` });
      }
      if (!call.type || typeof call.type !== "string") {
        issues.push({ file: filePath, severity: "error", message: `crossServiceCalls[${i}] missing type` });
      }
    }
  }
  if (!Array.isArray(arch.sharedResources)) {
    issues.push({ file: filePath, severity: "warning", message: "Missing sharedResources array" });
  }
  if (!Array.isArray(arch.eventFlows)) {
    issues.push({ file: filePath, severity: "warning", message: "Missing eventFlows array" });
  } else {
    for (let i = 0; i < arch.eventFlows.length; i++) {
      const ev = arch.eventFlows[i] as Record<string, unknown>;
      if (!ev || typeof ev !== "object") {
        issues.push({ file: filePath, severity: "error", message: `eventFlows[${i}] is not an object` });
        continue;
      }
      if (ev.caller || ev.callee) {
        issues.push({ file: filePath, severity: "error", message: `eventFlows[${i}] must use topic/publisher/subscribers, not caller/callee` });
      }
      if (!ev.topic || typeof ev.topic !== "string") {
        issues.push({ file: filePath, severity: "error", message: `eventFlows[${i}] missing topic` });
      }
      if (!ev.publisher || typeof ev.publisher !== "string") {
        issues.push({ file: filePath, severity: "error", message: `eventFlows[${i}] missing publisher` });
      }
      if (!Array.isArray(ev.subscribers) || (ev.subscribers as unknown[]).length === 0) {
        issues.push({ file: filePath, severity: "error", message: `eventFlows[${i}] missing non-empty subscribers array` });
      }
    }
  }
  return issues;
}

export function validateParentWikiCrossDomain(data: unknown, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!data || typeof data !== "object") {
    issues.push({ file: filePath, severity: "error", message: "Cross-domain page is not a valid object" });
    return issues;
  }
  const page = data as Record<string, unknown>;
  if (!page.id || typeof page.id !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing id" });
  }
  if (!page.name || typeof page.name !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing name" });
  }
  if (!page.summary || typeof page.summary !== "string") {
    issues.push({ file: filePath, severity: "error", message: "Missing summary" });
  }
  if (!Array.isArray(page.services) || (page.services as unknown[]).length === 0) {
    issues.push({ file: filePath, severity: "error", message: "Missing or empty services array" });
  }
  if (!Array.isArray(page.steps)) {
    issues.push({ file: filePath, severity: "error", message: "Missing steps array" });
  } else {
    for (let i = 0; i < page.steps.length; i++) {
      const step = page.steps[i] as Record<string, unknown>;
      if (typeof step.order !== "number") {
        issues.push({ file: filePath, severity: "error", message: `steps[${i}] missing order` });
      }
      if (!step.service || typeof step.service !== "string") {
        issues.push({ file: filePath, severity: "error", message: `steps[${i}] missing service` });
      }
      if (!step.description || typeof step.description !== "string") {
        issues.push({ file: filePath, severity: "warning", message: `steps[${i}] missing description` });
      }
    }
  }
  return issues;
}

/**
 * Run all Quality Gate Layer 1 validations on a service wiki directory.
 */
export function runQualityGateLayer1(opts: {
  meta: unknown;
  index: unknown;
  serviceOverview: unknown;
  domainPages: Array<{ filename: string; data: unknown }>;
  domainNodeIds: string[];
  sourceFiles: Set<string>;
}): WikiValidationResult {
  const allIssues: ValidationIssue[] = [];

  allIssues.push(...validateWikiMeta(opts.meta, "meta.json"));
  allIssues.push(...validateWikiIndex(opts.index, "index.json"));
  allIssues.push(...validateWikiServiceOverview(opts.serviceOverview, "service.json"));

  let flowsFound = 0;
  for (const { filename, data } of opts.domainPages) {
    const pageIssues = validateWikiDomainPage(data, `domains/${filename}`);
    allIssues.push(...pageIssues);
    if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).flows)) {
      flowsFound += ((data as Record<string, unknown>).flows as unknown[]).length;
    }
  }

  const wikiDomainFiles = opts.domainPages.map((p) => p.filename);
  allIssues.push(...validateCoverage(opts.domainNodeIds, wikiDomainFiles));

  // Collect source refs from domain pages for reference validation
  const sourceRefs: Array<{ file: string; lineRange?: [number, number] }> = [];
  for (const { data } of opts.domainPages) {
    if (data && typeof data === "object") {
      const page = data as Record<string, unknown>;
      if (Array.isArray(page.flows)) {
        for (const flow of page.flows as Record<string, unknown>[]) {
          if (Array.isArray(flow.steps)) {
            for (const step of flow.steps as Record<string, unknown>[]) {
              if (step.sourceRef && typeof step.sourceRef === "object") {
                const ref = step.sourceRef as Record<string, unknown>;
                if (ref.file && typeof ref.file === "string") {
                  sourceRefs.push({ file: ref.file as string, lineRange: ref.lineRange as [number, number] | undefined });
                }
              }
            }
          }
        }
      }
    }
  }
  allIssues.push(...validateSourceRefs(sourceRefs, opts.sourceFiles));

  const errors = allIssues.filter((i) => i.severity === "error");
  const coverageIssues = allIssues.filter((i) => i.file === "coverage" && i.severity === "error");
  const totalDomains = opts.domainNodeIds.length;
  const coveredDomains = totalDomains - coverageIssues.length;
  const coveragePercent = totalDomains > 0 ? Math.round((coveredDomains / totalDomains) * 100) : 100;

  return {
    passed: errors.length === 0,
    issues: allIssues,
    stats: {
      pagesValidated: opts.domainPages.length + 2, // +meta +index
      domainsFound: opts.domainPages.length,
      flowsFound,
      coveragePercent,
    },
  };
}

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
