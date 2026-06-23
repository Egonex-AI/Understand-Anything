import type { AnalyzerPlugin, StructuralAnalysis, ServiceInfo, StepInfo } from "../../types.js";

/**
 * Parses Dockerfiles to extract multi-stage build stages, EXPOSE ports, and instruction steps.
 * Associates EXPOSE ports with the correct stage based on FROM directive ordering.
 * Does not parse ARG/ENV variable substitution or heredoc syntax.
 */
export class DockerfileParser implements AnalyzerPlugin {
  name = "dockerfile-parser";
  languages = ["dockerfile"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const services = this.extractStages(content);
    const steps = this.extractSteps(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      services,
      steps,
    };
  }

  private extractStages(content: string): ServiceInfo[] {
    const stages: ServiceInfo[] = [];
    const lines = content.split("\n");

    // First pass: find FROM line indices
    const fromLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^FROM\s+/i.test(lines[i])) {
        fromLines.push(i);
      }
    }

    // Second pass: for each stage, collect EXPOSE ports within its range and build ServiceInfo
    for (let s = 0; s < fromLines.length; s++) {
      const stageStartLine = fromLines[s];
      const stageEndLine = s + 1 < fromLines.length ? fromLines[s + 1] - 1 : lines.length - 1;

      const fromMatch = lines[stageStartLine].match(/^FROM\s+(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/i);
      if (!fromMatch) continue;

      const image = fromMatch[1];
      const name = fromMatch[2] ?? image.split(":")[0].split("/").pop() ?? image;

      // Collect EXPOSE ports that appear within this stage's range
      const ports: number[] = [];
      for (let i = stageStartLine; i <= stageEndLine; i++) {
        const exposeMatch = lines[i].match(/^EXPOSE\s+(.+)/i);
        if (exposeMatch) {
          const portValues = exposeMatch[1].split(/\s+/);
          for (const p of portValues) {
            const num = parseInt(p, 10);
            if (!isNaN(num)) ports.push(num);
          }
        }
      }

      stages.push({
        name,
        image,
        ports,
        lineRange: [stageStartLine + 1, stageEndLine + 1],
      });
    }

    return stages;
  }

  private extractSteps(content: string): StepInfo[] {
    const steps: StepInfo[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(FROM|RUN|COPY|ADD|WORKDIR|CMD|ENTRYPOINT|ENV|ARG|EXPOSE|VOLUME|USER|HEALTHCHECK)\s/i);
      if (match) {
        steps.push({
          name: `${match[1].toUpperCase()} ${lines[i].slice(match[1].length + 1).trim().slice(0, 60)}`,
          lineRange: [i + 1, i + 1],
        });
      }
    }
    return steps;
  }
}
