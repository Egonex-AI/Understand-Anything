import type { WikiDomainPage, WikiFlow, WikiFlowStep, WikiServiceOverview, CrossServiceCall, WikiOverview, WikiArchitecture, WikiCrossDomain, WikiEntity, WikiGlossaryEntry, WikiBusinessRule, WikiIntegrationPoints, WikiErrorCatalogEntry } from "@understand-anything/core";
import type { Locale } from "../locales";
import { en } from "../locales/en";

type WikiLabels = Locale["wiki"];

const defaultLabels: WikiLabels = en.wiki;

export function serviceOverviewToMarkdown(overview: WikiServiceOverview, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${overview?.name ?? "Service"}`);
  lines.push("");
  lines.push(overview?.description ?? "");
  lines.push("");

  const techStack = Array.isArray(overview?.techStack) ? overview.techStack : [];
  if (techStack.length > 0) {
    lines.push(`## ${labels.techStack}`);
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  const modules = Array.isArray(overview?.modules) ? overview.modules : [];
  if (modules.length > 0) {
    lines.push(`## ${labels.modules}`);
    lines.push("");
    for (const mod of modules) {
      lines.push(`- ${mod}`);
    }
    lines.push("");
  }

  const entryPoints = Array.isArray(overview?.entryPoints) ? overview.entryPoints : [];
  if (entryPoints.length > 0) {
    lines.push(`## ${labels.entryPoints}`);
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

function sanitizeMermaidLabel(text: string): string {
  return text.replace(/["\[\](){}|<>#&]/g, " ").trim();
}

function sanitizeSequenceLabel(text: string): string {
  return text.replace(/[;\n\r]/g, " ").replace(/-->/g, "→").replace(/->>|->>/g, "→").trim();
}

function truncateText(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text || "";
  const delimiters = /[，。；,;！!？?]/;
  const firstBreak = text.search(delimiters);
  if (firstBreak > 0 && firstBreak <= maxLen) return text.slice(0, firstBreak);
  return text.slice(0, maxLen) + "…";
}

function flowToMermaidDiagram(flow: WikiFlow, labels: WikiLabels = defaultLabels): string {
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length === 0) return "";

  const lines: string[] = ["```mermaid", "flowchart TD"];
  lines.push(`    Start(["${sanitizeMermaidLabel(labels.diagramStart ?? "Start")}"])`);
  for (let i = 0; i < steps.length; i++) {
    const nodeId = `S${i}`;
    const name = sanitizeMermaidLabel(steps[i].name || `Step ${i + 1}`);
    const desc = truncateText(steps[i].description || "", 35);
    const descLine = desc ? `<br/><small>${sanitizeMermaidLabel(desc)}</small>` : "";
    if (steps[i].sourceRef) {
      lines.push(`    ${nodeId}(["${i + 1}. ${name}${descLine}"])`);
    } else {
      lines.push(`    ${nodeId}["${i + 1}. ${name}${descLine}"]`);
    }
  }
  lines.push(`    End_(["${sanitizeMermaidLabel(labels.diagramEnd ?? "End")}"])`);
  lines.push(`    Start --> S0`);
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`    S${i} --> S${i + 1}`);
  }
  lines.push(`    S${steps.length - 1} --> End_`);
  lines.push("```");
  return lines.join("\n");
}

function crossDomainToSequenceDiagram(services: string[], steps: Array<{ order: number; service: string; description: string; crossServiceCall?: { interface?: string; method: string; type: string } }>): string {
  if (steps.length === 0) return "";

  const allServices = services.length > 0 ? [...services] : [...new Set(steps.map(s => s.service))];
  if (allServices.length === 0) return "";

  const lines: string[] = ["```mermaid", "sequenceDiagram"];
  for (const svc of allServices) {
    const pid = svc.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`    participant ${pid} as ${sanitizeSequenceLabel(svc)}`);
  }
  lines.push("");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const fromSvc = step.service.replace(/[^a-zA-Z0-9_]/g, "_");
    const nextSvc = (i + 1 < steps.length) ? steps[i + 1].service.replace(/[^a-zA-Z0-9_]/g, "_") : fromSvc;
    const desc = sanitizeSequenceLabel(truncateText(step.description, 40));
    const label = `${step.order}. ${desc}`;

    if (step.crossServiceCall) {
      const typeTag = step.crossServiceCall.type || "rpc";
      lines.push(`    ${fromSvc}->>+${nextSvc}: ${label} [${typeTag}]`);
    } else if (fromSvc === nextSvc || i === steps.length - 1) {
      lines.push(`    ${fromSvc}->>+${fromSvc}: ${label}`);
    } else {
      lines.push(`    ${fromSvc}->>+${nextSvc}: ${label}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function architectureToMermaidDiagram(data: WikiArchitecture): string {
  const calls = Array.isArray(data?.crossServiceCalls) ? data.crossServiceCalls : [];
  const events = Array.isArray(data?.eventFlows) ? data.eventFlows : [];
  const resources = Array.isArray(data?.sharedResources) ? data.sharedResources : [];
  if (calls.length === 0 && events.length === 0 && resources.length === 0) return "";

  const serviceSet = new Set<string>();
  const edgeMap = new Map<string, Set<string>>();

  for (const c of calls) {
    const from = c.caller?.service;
    const to = c.callee?.service;
    if (!from || !to || from === to) continue;
    serviceSet.add(from);
    serviceSet.add(to);
    const key = `${from}|||${to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, new Set());
    edgeMap.get(key)!.add(c.type || "rpc");
  }

  const lines: string[] = ["```mermaid", "flowchart LR"];

  const svcId = (s: string) => `svc_${s.replace(/[^a-zA-Z0-9]/g, "_")}`;

  for (const svc of serviceSet) {
    lines.push(`    ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
  }

  for (const [key, types] of edgeMap) {
    const [from, to] = key.split("|||");
    const label = [...types].join("/");
    lines.push(`    ${svcId(from)} -->|"${sanitizeMermaidLabel(label)}"| ${svcId(to)}`);
  }

  const resTypeShape: Record<string, [string, string]> = {
    database: ["[(", ")]"],
    cache: ["{{", "}}"],
    queue: [">", "]"],
    storage: ["([", "])"],
  };

  for (const res of resources) {
    if (!res.name) continue;
    const rid = `res_${res.name.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const shape = resTypeShape[res.type || ""] || ["[", "]"];
    lines.push(`    ${rid}${shape[0]}"${sanitizeMermaidLabel(res.name)}"${shape[1]}`);
    for (const svc of (res.services || [])) {
      serviceSet.add(svc);
      if (!lines.some(l => l.includes(`${svcId(svc)}[`))) {
        lines.push(`    ${svcId(svc)}["${sanitizeMermaidLabel(svc)}"]`);
      }
      lines.push(`    ${svcId(svc)} -.- ${rid}`);
    }
  }

  for (const ev of events) {
    if (!ev.topic) continue;
    const tid = `topic_${ev.topic.replace(/[^a-zA-Z0-9]/g, "_")}`;
    lines.push(`    ${tid}{{"${sanitizeMermaidLabel(ev.topic)}"}}`);
    if (ev.publisher) {
      if (!serviceSet.has(ev.publisher)) {
        lines.push(`    ${svcId(ev.publisher)}["${sanitizeMermaidLabel(ev.publisher)}"]`);
      }
      lines.push(`    ${svcId(ev.publisher)} -->|"publish"| ${tid}`);
    }
    for (const sub of (ev.subscribers || [])) {
      if (!serviceSet.has(sub)) {
        lines.push(`    ${svcId(sub)}["${sanitizeMermaidLabel(sub)}"]`);
      }
      lines.push(`    ${tid} -->|"subscribe"| ${svcId(sub)}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function entityLifecycleDiagram(entity: WikiEntity): string {
  const states = Array.isArray(entity.lifecycleStates) ? entity.lifecycleStates : [];
  if (states.length < 2) return "";

  const stateId = (i: number) => `state_${i}`;
  const lines: string[] = ["```mermaid", "stateDiagram-v2"];
  for (let i = 0; i < states.length; i++) {
    lines.push(`    state "${sanitizeMermaidLabel(states[i])}" as ${stateId(i)}`);
  }
  lines.push(`    [*] --> ${stateId(0)}`);
  for (let i = 0; i < states.length - 1; i++) {
    lines.push(`    ${stateId(i)} --> ${stateId(i + 1)}`);
  }
  lines.push(`    ${stateId(states.length - 1)} --> [*]`);
  lines.push("```");
  return lines.join("\n");
}

function integrationPointsDiagram(domain: string, integration: WikiIntegrationPoints): string {
  const inbound = Array.isArray(integration?.inbound) ? integration.inbound : [];
  const outbound = Array.isArray(integration?.outbound) ? integration.outbound : [];
  if (inbound.length === 0 && outbound.length === 0) return "";

  const lines: string[] = ["```mermaid", "flowchart LR"];
  const domId = "ThisDomain";
  lines.push(`    ${domId}(["${sanitizeMermaidLabel(domain)}"])`);

  for (let i = 0; i < inbound.length; i++) {
    const p = inbound[i];
    const nid = `in_${i}`;
    lines.push(`    ${nid}["${sanitizeMermaidLabel(p?.source || "external")}"]`);
    const label = `${p?.type || "?"}: ${sanitizeMermaidLabel(truncateText(p?.endpoint || "", 25))}`;
    lines.push(`    ${nid} -->|"${label}"| ${domId}`);
  }

  for (let i = 0; i < outbound.length; i++) {
    const p = outbound[i];
    const nid = `out_${i}`;
    lines.push(`    ${nid}["${sanitizeMermaidLabel(p?.target || "external")}"]`);
    const label = `${p?.type || "?"}: ${sanitizeMermaidLabel(truncateText(p?.endpoint || "", 25))}`;
    lines.push(`    ${domId} -->|"${label}"| ${nid}`);
  }

  lines.push("```");
  return lines.join("\n");
}

function overviewToMermaidMap(data: WikiOverview): string {
  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length === 0) return "";

  const lines: string[] = ["```mermaid", "graph TD"];
  const sysId = "System";
  lines.push(`    ${sysId}(["${sanitizeMermaidLabel(data?.name || "System")}"])`);

  for (const svc of services) {
    const sid = `svc_${(svc.name || "unknown").replace(/[^a-zA-Z0-9]/g, "_")}`;
    lines.push(`    ${sid}["${sanitizeMermaidLabel(svc.name || "?")}"]`);
    lines.push(`    ${sysId} --> ${sid}`);
    const domains = Array.isArray(svc.domains) ? svc.domains : [];
    for (const d of domains) {
      const did = `dom_${d.replace(/[^a-zA-Z0-9]/g, "_")}`;
      lines.push(`    ${did}(("${sanitizeMermaidLabel(d)}"))`);
      lines.push(`    ${sid} --> ${did}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

function flowToMarkdown(flow: WikiFlow, labels: WikiLabels = defaultLabels): string {
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

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length > 0) {
    lines.push(flowToMermaidDiagram(flow, labels));
    lines.push("");
    lines.push(`#### ${labels.steps}`);
    lines.push("");
    for (const step of steps) {
      lines.push(flowStepToMarkdown(step));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function crossServiceCallsToTable(
  calls: CrossServiceCall[],
  labels: WikiLabels = defaultLabels,
  withLinks = false,
): string {
  const lines: string[] = [];
  lines.push(`## ${labels.crossServiceCalls}`);
  lines.push("");

  const link = (name: string) => (withLinks ? svcLink(name) : `\`${name}\``);

  lines.push(`| ${labels.callerHeader} | ${labels.calleeHeader} | ${labels.typeHeader} | ${labels.detailHeader} |`);
  lines.push("|---|---|---|---|");
  for (const call of calls) {
    const callerSvc = call.caller?.service ?? "?";
    const calleeSvc = call.callee?.service ?? "?";
    const callerMethod = call.caller?.method ? `.${call.caller.method}` : "";
    const caller = `${link(callerSvc)}${callerMethod}`;
    const calleeMethod = call.callee?.method ? `.${call.callee.method}` : "";
    const callee = call.callee?.interface
      ? `${link(calleeSvc)}#${call.callee.interface}${calleeMethod}`
      : `${link(calleeSvc)}${calleeMethod}`;
    const type = escapeTableCell(call.type ?? "");
    const detail = escapeTableCell(call.detail ?? "");
    lines.push(`| ${caller} | ${callee} | ${type} | ${detail} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function svcLink(name: string): string {
  return `[${name}](wiki://${name}/service.json)`;
}

export function overviewToMarkdown(data: WikiOverview, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "System Overview"}`);
  lines.push("");
  lines.push(data?.description ?? "");
  lines.push("");

  const overviewDiagram = overviewToMermaidMap(data);
  if (overviewDiagram) {
    lines.push(overviewDiagram);
    lines.push("");
  }

  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length > 0) {
    lines.push(`## ${labels.services}`);
    lines.push("");
    lines.push("| Service | Description | Domains |");
    lines.push("|---|---|---|");
    for (const svc of services) {
      const domains = Array.isArray(svc?.domains) ? svc.domains.join(", ") : "";
      const name = svc?.name ? svcLink(svc.name) : "";
      lines.push(`| ${name} | ${svc?.description ?? ""} | ${domains} |`);
    }
    lines.push("");
  }

  const techStack = Array.isArray(data?.techStack) ? data.techStack : [];
  if (techStack.length > 0) {
    lines.push(`## ${labels.techStack}`);
    lines.push("");
    for (const tech of techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function architectureToMarkdown(data: WikiArchitecture, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${labels.systemArchitecture}`);
  lines.push("");

  const archDiagram = architectureToMermaidDiagram(data);
  if (archDiagram) {
    lines.push(archDiagram);
    lines.push("");
  }

  const crossServiceCalls = Array.isArray(data?.crossServiceCalls) ? data.crossServiceCalls : [];
  if (crossServiceCalls.length > 0) {
    lines.push(crossServiceCallsToTable(crossServiceCalls, labels, true));
  }

  const eventFlows = Array.isArray(data?.eventFlows)
    ? data.eventFlows.filter((ev) => ev?.topic)
    : [];
  if (eventFlows.length > 0) {
    lines.push(`## ${labels.eventFlows}`);
    lines.push("");
    for (const ev of eventFlows) {
      const pub = ev.publisher ? svcLink(ev.publisher) : "?";
      const subs = Array.isArray(ev.subscribers) ? ev.subscribers.map(s => svcLink(s)).join(", ") : "";
      lines.push(`- **${ev.topic}**: ${pub} → ${subs}`);
    }
    lines.push("");
  }

  const sharedResources = Array.isArray(data?.sharedResources)
    ? data.sharedResources.filter((res) => res?.name)
    : [];
  if (sharedResources.length > 0) {
    lines.push(`## ${labels.sharedResources}`);
    lines.push("");
    for (const res of sharedResources) {
      const svcList = Array.isArray(res.services) ? res.services.map(s => svcLink(s)).join(", ") : "";
      lines.push(`- [${res.type ?? "unknown"}] **${res.name}** — used by: ${svcList}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function crossDomainToMarkdown(data: WikiCrossDomain, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];
  lines.push(`# ${data?.name ?? "Untitled"}`);
  lines.push("");
  lines.push(data?.summary ?? "");
  lines.push("");

  const services = Array.isArray(data?.services) ? data.services : [];
  if (services.length > 0) {
    lines.push(`**${labels.servicesInvolved}:** ${services.map(s => svcLink(s)).join(", ")}`);
    lines.push("");
  }

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  if (steps.length > 0) {
    const seqDiagram = crossDomainToSequenceDiagram(services, steps);
    if (seqDiagram) {
      lines.push(seqDiagram);
      lines.push("");
    }

    lines.push(`## ${labels.flowSteps}`);
    lines.push("");
    for (const step of steps) {
      let line = `${step.order}. **${svcLink(step.service)}** ${step.description}`;
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

export function domainPageToMarkdown(page: WikiDomainPage, labels: WikiLabels = defaultLabels): string {
  const lines: string[] = [];

  lines.push(`# ${page?.name ?? "Domain"}`);
  lines.push("");
  lines.push(page?.summary ?? "");
  lines.push("");

  const glossary = Array.isArray(page?.ubiquitousLanguage) ? page.ubiquitousLanguage : [];
  if (glossary.length > 0) {
    lines.push(`## ${labels.ubiquitousLanguage}`);
    lines.push("");
    lines.push(`| ${labels.termHeader} | ${labels.definitionHeader} |`);
    lines.push("|---|---|");
    for (const entry of glossary as WikiGlossaryEntry[]) {
      lines.push(`| **${entry?.term ?? "?"}** | ${entry?.definition ?? ""} |`);
    }
    lines.push("");
  }

  const rules = Array.isArray(page?.businessRules) ? page.businessRules : [];
  if (rules.length > 0) {
    lines.push(`## ${labels.businessRules}`);
    lines.push("");
    lines.push(`| ${labels.ruleIdHeader} | ${labels.ruleHeader} | ${labels.enforcedByHeader} |`);
    lines.push("|---|---|---|");
    for (const rule of rules as WikiBusinessRule[]) {
      lines.push(`| ${rule?.id ?? "?"} | ${rule?.rule ?? ""} | \`${rule?.enforcement ?? "—"}\` |`);
    }
    lines.push("");
  }

  const entities = Array.isArray(page?.entities) ? page.entities : [];
  if (entities.length > 0) {
    lines.push(`## ${labels.keyEntities}`);
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
          lines.push(`- ${labels.fieldsLabel}: \`${e.keyFields.join("`, `")}\``);
        }
        if (Array.isArray(e.lifecycleStates) && e.lifecycleStates.length > 0) {
          lines.push(`- ${labels.lifecycleLabel}: ${e.lifecycleStates.join(" → ")}`);
          const lcDiagram = entityLifecycleDiagram(e);
          if (lcDiagram) {
            lines.push("");
            lines.push(lcDiagram);
          }
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
    lines.push(`## ${labels.integrationPoints}`);
    lines.push("");
    const ipDiagram = integrationPointsDiagram(page?.name || "Domain", integration!);
    if (ipDiagram) {
      lines.push(ipDiagram);
      lines.push("");
    }
    if (inbound.length > 0) {
      lines.push(`**${labels.inbound}:**`);
      lines.push("");
      for (const p of inbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` from ${p?.source ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
    if (outbound.length > 0) {
      lines.push(`**${labels.outbound}:**`);
      lines.push("");
      for (const p of outbound) {
        lines.push(`- [${p?.type ?? "?"}] \`${p?.endpoint ?? "?"}\` to ${p?.target ?? "?"} — ${p?.description ?? ""}`);
      }
      lines.push("");
    }
  }

  const rawErrors = Array.isArray(page?.errorCatalog) ? page.errorCatalog : [];
  const errors = rawErrors.filter((e: Record<string, unknown>) =>
    e && (e.exception || e.code),
  );
  if (errors.length > 0) {
    lines.push(`## ${labels.errorScenarios}`);
    lines.push("");
    lines.push(`| ${labels.exceptionHeader} | ${labels.triggerHeader} | ${labels.handlingHeader} | ${labels.severityHeader} |`);
    lines.push("|---|---|---|---|");
    for (const raw of errors) {
      const e = raw as Record<string, unknown>;
      const exception = (e.exception ?? e.code ?? "") as string;
      const trigger = (e.trigger ?? "") as string;
      const handling = (e.handling ?? e.description ?? "") as string;
      const severity = (e.severity ?? "") as string;
      lines.push(`| \`${exception}\` | ${trigger} | ${handling} | ${severity} |`);
    }
    lines.push("");
  }

  const flows = Array.isArray(page?.flows) ? page.flows : [];
  if (flows.length > 0) {
    lines.push(`## ${labels.flows}`);
    lines.push("");
    for (const flow of flows) {
      lines.push(flowToMarkdown(flow, labels));
    }
  }

  if (Array.isArray(page?.crossServiceCalls) && page.crossServiceCalls.length > 0) {
    lines.push(crossServiceCallsToTable(page.crossServiceCalls, labels));
  }

  return lines.join("\n");
}
