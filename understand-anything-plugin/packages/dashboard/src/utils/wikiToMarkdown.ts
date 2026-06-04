import type { WikiDomainPage, WikiFlow, WikiFlowStep, WikiServiceOverview, CrossServiceCall, WikiOverview, WikiArchitecture, WikiCrossDomain, WikiEntity, WikiGlossaryEntry, WikiBusinessRule, WikiIntegrationPoints, WikiErrorCatalogEntry } from "@understand-anything/core";

export function serviceOverviewToMarkdown(overview: WikiServiceOverview): string {
  const lines: string[] = [];

  lines.push(`# ${overview?.name ?? "Service"}`);
  lines.push("");
  lines.push(overview?.description ?? "");
  lines.push("");

  const techStack = Array.isArray(overview?.techStack) ? overview.techStack : [];
  if (techStack.length > 0) {
    lines.push("## Tech Stack");
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  const modules = Array.isArray(overview?.modules) ? overview.modules : [];
  if (modules.length > 0) {
    lines.push("## Modules");
    lines.push("");
    for (const mod of modules) {
      lines.push(`- ${mod}`);
    }
    lines.push("");
  }

  const entryPoints = Array.isArray(overview?.entryPoints) ? overview.entryPoints : [];
  if (entryPoints.length > 0) {
    lines.push("## Entry Points");
    lines.push("");
    for (const ep of entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function flowStepToMarkdown(step: WikiFlowStep): string {
  let line = `${step.order}. **${step.name}** — ${step.description}`;
  if (step.sourceRef) {
    const hash = step.sourceRef.lineRange
      ? `#L${step.sourceRef.lineRange[0]}-L${step.sourceRef.lineRange[1]}`
      : "";
    const label = step.sourceRef.lineRange
      ? `${step.sourceRef.file}:${step.sourceRef.lineRange[0]}-${step.sourceRef.lineRange[1]}`
      : step.sourceRef.file;
    line += `\n   📎 [${label}](source://${step.sourceRef.file}${hash})`;
  }
  return line;
}

function flowToMarkdown(flow: WikiFlow): string {
  const lines: string[] = [];
  const anchorId = flow.id ?? flow.name?.toLowerCase().replace(/\s+/g, "-") ?? "";
  if (anchorId) {
    lines.push(`<a id="${anchorId}"></a>`);
    lines.push("");
  }
  lines.push(`### ${flow.name}`);
  lines.push("");
  lines.push(flow.summary);
  lines.push("");

  if (flow.steps.length > 0) {
    for (const step of flow.steps) {
      lines.push(flowStepToMarkdown(step));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function crossServiceCallsToMarkdown(calls: CrossServiceCall[]): string {
  const lines: string[] = [];
  lines.push("## Cross-Service Calls");
  lines.push("");

  for (const call of calls) {
    const callerInfo = `${call.caller.service}.${call.caller.method}`;
    const calleeInfo = call.callee.interface
      ? `${call.callee.service}#${call.callee.interface}`
      : call.callee.service;
    lines.push(`- \`${callerInfo}\` → \`${calleeInfo}\``);
  }
  lines.push("");

  return lines.join("\n");
}

export function overviewToMarkdown(data: WikiOverview): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "System Overview"}`);
  lines.push("");
  lines.push(data?.description ?? "");
  lines.push("");

  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length > 0) {
    lines.push("## Services");
    lines.push("");
    lines.push("| Service | Description | Domains |");
    lines.push("|---|---|---|");
    for (const svc of services) {
      const domains = Array.isArray(svc?.domains) ? svc.domains.join(", ") : "";
      lines.push(`| ${svc?.name ?? ""} | ${svc?.description ?? ""} | ${domains} |`);
    }
    lines.push("");
  }

  const techStack = Array.isArray(data?.techStack) ? data.techStack : [];
  if (techStack.length > 0) {
    lines.push("## Tech Stack");
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function architectureToMarkdown(data: WikiArchitecture): string {
  const lines: string[] = [];
  lines.push("# System Architecture");
  lines.push("");

  const crossServiceCalls = Array.isArray(data?.crossServiceCalls) ? data.crossServiceCalls : [];
  if (crossServiceCalls.length > 0) {
    lines.push("## Cross-Service Calls");
    lines.push("");
    for (const call of crossServiceCalls) {
      const caller = `${call.caller?.service ?? "?"}.${call.caller?.method ?? "?"}`;
      const callee = call.callee?.interface
        ? `${call.callee.service}#${call.callee.interface}.${call.callee.method}`
        : `${call.callee?.service ?? "?"}.${call.callee?.method ?? "?"}`;
      lines.push(`- \`${caller}\` → \`${callee}\` (${call.type})`);
      if (call.detail) lines.push(`  > ${call.detail}`);
    }
    lines.push("");
  }

  const eventFlows = Array.isArray(data?.eventFlows) ? data.eventFlows : [];
  if (eventFlows.length > 0) {
    lines.push("## Event Flows");
    lines.push("");
    for (const ev of eventFlows) {
      const subscribers = Array.isArray(ev?.subscribers) ? ev.subscribers.join(", ") : "";
      lines.push(`- **${ev?.topic ?? "?"}**: ${ev?.publisher ?? "?"} → ${subscribers}`);
    }
    lines.push("");
  }

  const sharedResources = Array.isArray(data?.sharedResources) ? data.sharedResources : [];
  if (sharedResources.length > 0) {
    lines.push("## Shared Resources");
    lines.push("");
    for (const res of sharedResources) {
      const svcList = Array.isArray(res?.services) ? res.services.join(", ") : "";
      lines.push(`- [${res?.type ?? "?"}] **${res?.name ?? "?"}** — used by: ${svcList}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function crossDomainToMarkdown(data: WikiCrossDomain): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "Untitled"}`);
  lines.push("");
  lines.push(data?.summary ?? "");
  lines.push("");

  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length > 0) {
    lines.push(`**Services involved:** ${services.join(", ")}`);
    lines.push("");
  }

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  if (steps.length > 0) {
    lines.push("## Flow Steps");
    lines.push("");
    for (const step of steps) {
      let line = `${step.order}. **[${step.service}]** ${step.description}`;
      if (step.wikiRef) {
        line += `\n   → [View details](wiki://${step.wikiRef})`;
      }
      if (step.crossServiceCall) {
        line += `\n   🔗 ${step.crossServiceCall.interface}.${step.crossServiceCall.method} (${step.crossServiceCall.type})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function domainPageToMarkdown(page: WikiDomainPage): string {
  const lines: string[] = [];

  lines.push(`# ${page?.name ?? "Domain"}`);
  lines.push("");
  lines.push(page?.summary ?? "");
  lines.push("");

  const glossary = Array.isArray(page?.ubiquitousLanguage) ? page.ubiquitousLanguage : [];
  if (glossary.length > 0) {
    lines.push("## Ubiquitous Language");
    lines.push("");
    lines.push("| Term | Definition |");
    lines.push("|---|---|");
    for (const entry of glossary as WikiGlossaryEntry[]) {
      lines.push(`| **${entry?.term ?? "?"}** | ${entry?.definition ?? ""} |`);
    }
    lines.push("");
  }

  const rules = Array.isArray(page?.businessRules) ? page.businessRules : [];
  if (rules.length > 0) {
    lines.push("## Business Rules");
    lines.push("");
    lines.push("| ID | Rule | Enforced By |");
    lines.push("|---|---|---|");
    for (const rule of rules as WikiBusinessRule[]) {
      lines.push(`| ${rule?.id ?? "?"} | ${rule?.rule ?? ""} | \`${rule?.enforcement ?? "—"}\` |`);
    }
    lines.push("");
  }

  const entities = Array.isArray(page?.entities) ? page.entities : [];
  if (entities.length > 0) {
    lines.push("## Key Entities");
    lines.push("");
    for (const entity of entities) {
      if (typeof entity === "string") {
        lines.push(`- ${entity}`);
      } else {
        const e = entity as WikiEntity;
        lines.push(`**${e.name}**`);
        lines.push("");
        if (e.description) lines.push(e.description);
        if (Array.isArray(e.keyFields) && e.keyFields.length > 0) {
          lines.push(`- Fields: \`${e.keyFields.join("`, `")}\``);
        }
        if (Array.isArray(e.lifecycleStates) && e.lifecycleStates.length > 0) {
          lines.push(`- Lifecycle: ${e.lifecycleStates.join(" → ")}`);
        }
        if (Array.isArray(e.invariants) && e.invariants.length > 0) {
          for (const inv of e.invariants) {
            lines.push(`- ⚠️ ${inv}`);
          }
        }
        lines.push("");
      }
    }
    lines.push("");
  }

  const integration = page?.integrationPoints as WikiIntegrationPoints | undefined;
  const inbound = Array.isArray(integration?.inbound) ? integration!.inbound : [];
  const outbound = Array.isArray(integration?.outbound) ? integration!.outbound : [];
  if (inbound.length > 0 || outbound.length > 0) {
    lines.push("## Integration Points");
    lines.push("");
    if (inbound.length > 0) {
      lines.push("**Inbound:**");
      lines.push("");
      for (const p of inbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` from ${p?.source ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
    if (outbound.length > 0) {
      lines.push("**Outbound:**");
      lines.push("");
      for (const p of outbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` to ${p?.target ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
  }

  const errors = Array.isArray(page?.errorCatalog) ? page.errorCatalog : [];
  if (errors.length > 0) {
    lines.push("## Error Scenarios");
    lines.push("");
    lines.push("| Exception | Trigger | Handling | Severity |");
    lines.push("|---|---|---|---|");
    for (const err of errors as WikiErrorCatalogEntry[]) {
      lines.push(`| \`${err?.exception ?? "?"}\` | ${err?.trigger ?? ""} | ${err?.handling ?? ""} | ${err?.severity ?? "?"} |`);
    }
    lines.push("");
  }

  const flows = Array.isArray(page?.flows) ? page.flows : [];
  if (flows.length > 0) {
    lines.push("## Flows");
    lines.push("");
    for (const flow of flows) {
      lines.push(flowToMarkdown(flow));
    }
  }

  if (Array.isArray(page?.crossServiceCalls) && page.crossServiceCalls.length > 0) {
    lines.push(crossServiceCallsToMarkdown(page.crossServiceCalls));
  }

  return lines.join("\n");
}
