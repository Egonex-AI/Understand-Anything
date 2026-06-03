import type { WikiDomainPage, WikiFlow, WikiFlowStep, WikiServiceOverview, CrossServiceCall, WikiOverview, WikiArchitecture, WikiCrossDomain } from "@understand-anything/core";

export function serviceOverviewToMarkdown(overview: WikiServiceOverview): string {
  const lines: string[] = [];

  lines.push(`# ${overview.name}`);
  lines.push("");
  lines.push(overview.description);
  lines.push("");

  if (overview.techStack.length > 0) {
    lines.push("## Tech Stack");
    lines.push("");
    for (const tech of overview.techStack) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
  }

  if (overview.modules.length > 0) {
    lines.push("## Modules");
    lines.push("");
    for (const mod of overview.modules) {
      lines.push(`- ${mod}`);
    }
    lines.push("");
  }

  if (overview.entryPoints.length > 0) {
    lines.push("## Entry Points");
    lines.push("");
    for (const ep of overview.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function flowStepToMarkdown(step: WikiFlowStep): string {
  let line = `${step.order}. **${step.name}** — ${step.description}`;
  if (step.sourceRef) {
    const range = step.sourceRef.lineRange
      ? `:${step.sourceRef.lineRange[0]}-${step.sourceRef.lineRange[1]}`
      : "";
    line += `\n   📎 \`${step.sourceRef.file}${range}\``;
  }
  return line;
}

function flowToMarkdown(flow: WikiFlow): string {
  const lines: string[] = [];
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
  lines.push(`# ${data.name}`);
  lines.push("");
  lines.push(data.description);
  lines.push("");

  if (data.services.length > 0) {
    lines.push("## Services");
    lines.push("");
    lines.push("| Service | Description | Domains |");
    lines.push("|---|---|---|");
    for (const svc of data.services) {
      lines.push(`| ${svc.name} | ${svc.description} | ${svc.domains.join(", ")} |`);
    }
    lines.push("");
  }

  if (data.techStack.length > 0) {
    lines.push("## Tech Stack");
    lines.push("");
    for (const tech of data.techStack) {
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

  if (data.crossServiceCalls.length > 0) {
    lines.push("## Cross-Service Calls");
    lines.push("");
    for (const call of data.crossServiceCalls) {
      const caller = `${call.caller.service}.${call.caller.method}`;
      const callee = call.callee.interface
        ? `${call.callee.service}#${call.callee.interface}.${call.callee.method}`
        : `${call.callee.service}.${call.callee.method}`;
      lines.push(`- \`${caller}\` → \`${callee}\` (${call.type})`);
      if (call.detail) lines.push(`  > ${call.detail}`);
    }
    lines.push("");
  }

  if (data.eventFlows.length > 0) {
    lines.push("## Event Flows");
    lines.push("");
    for (const ev of data.eventFlows) {
      lines.push(`- **${ev.topic}**: ${ev.publisher} → ${ev.subscribers.join(", ")}`);
    }
    lines.push("");
  }

  if (data.sharedResources.length > 0) {
    lines.push("## Shared Resources");
    lines.push("");
    for (const res of data.sharedResources) {
      lines.push(`- [${res.type}] **${res.name}** — used by: ${res.services.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function crossDomainToMarkdown(data: WikiCrossDomain): string {
  const lines: string[] = [];
  lines.push(`# ${data.name}`);
  lines.push("");
  lines.push(data.summary);
  lines.push("");
  lines.push(`**Services involved:** ${data.services.join(", ")}`);
  lines.push("");

  if (data.steps.length > 0) {
    lines.push("## Flow Steps");
    lines.push("");
    for (const step of data.steps) {
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

  lines.push(`# ${page.name}`);
  lines.push("");
  lines.push(page.summary);
  lines.push("");

  if (page.entities.length > 0) {
    lines.push("## Key Entities");
    lines.push("");
    for (const entity of page.entities) {
      lines.push(`- ${entity}`);
    }
    lines.push("");
  }

  if (page.flows.length > 0) {
    lines.push("## Flows");
    lines.push("");
    for (const flow of page.flows) {
      lines.push(flowToMarkdown(flow));
    }
  }

  if (page.crossServiceCalls && page.crossServiceCalls.length > 0) {
    lines.push(crossServiceCallsToMarkdown(page.crossServiceCalls));
  }

  return lines.join("\n");
}
