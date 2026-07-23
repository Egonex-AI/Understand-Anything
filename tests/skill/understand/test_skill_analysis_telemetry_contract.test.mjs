import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const skill = readFileSync(
  join(repoRoot, 'understand-anything-plugin/skills/understand/SKILL.md'),
  'utf8',
);
const scanner = readFileSync(
  join(repoRoot, 'understand-anything-plugin/agents/project-scanner.md'),
  'utf8',
);

describe('/understand preflight and telemetry contract', () => {
  it('places the full preflight gate after batching and before file-analyzer dispatch', () => {
    const fullBatch = skill.indexOf('node "<SKILL_DIR>/compute-batches.mjs" "$PROJECT_ROOT"');
    const plan = skill.indexOf('node "<SKILL_DIR>/analysis-plan.mjs" "$PROJECT_ROOT"');
    const decision = skill.indexOf('decision "$PROJECT_ROOT" continue');
    const phase2 = skill.indexOf('## Phase 2 — ANALYZE');
    const dispatch = skill.indexOf('dispatch a subagent using the `file-analyzer`', phase2);

    expect(fullBatch).toBeGreaterThan(0);
    expect(plan).toBeGreaterThan(fullBatch);
    expect(decision).toBeGreaterThan(plan);
    expect(dispatch).toBeGreaterThan(decision);
    expect(skill).not.toContain('**Gate check:** If >100 files');
  });

  it('requires the incremental path to replan before any changed-file dispatch', () => {
    const start = skill.indexOf('### Incremental update path');
    const end = skill.indexOf('## Phase 3 — ASSEMBLE REVIEW');
    const incremental = skill.slice(start, end);

    expect(incremental).toContain('--mode=incremental');
    expect(incremental).toContain('analysis-plan.mjs');
    expect(incremental).toContain('attach-plan');
    expect(incremental).toContain('Continue / Adjust scope / Cancel');
    expect(incremental.indexOf('analysis-plan.mjs')).toBeLessThan(
      incremental.indexOf('dispatch file-analyzer'),
    );
  });

  it('keeps persistent artifacts outside intermediate cleanup and avoids fabricated usage', () => {
    expect(skill).toContain('$UA_DIR/analysis-plan.json');
    expect(skill).toContain('$UA_DIR/run-report.json');
    expect(skill).toContain('Leave actual token and USD fields `null`');
    expect(skill).toContain('A deterministic-only graph option is intentionally not offered');
    expect(skill).toContain('main orchestrator');
    expect(skill).toContain('batch-start');
    expect(skill).toContain('batch-finish');
  });

  it('starts review telemetry and copies the graph on the review-only path', () => {
    const reviewOnly = skill.slice(
      skill.indexOf('**Review-only path:**'),
      skill.indexOf('## Phase 1'),
    );

    expect(reviewOnly).toContain('stage-start "$PROJECT_ROOT" review');
    expect(reviewOnly).toContain(
      'cp "$UA_DIR/knowledge-graph.json" "$UA_DIR/intermediate/assembled-graph.json"',
    );
    expect(reviewOnly.indexOf('stage-start "$PROJECT_ROOT" review')).toBeLessThan(
      reviewOnly.indexOf('cp "$UA_DIR/knowledge-graph.json"'),
    );
  });

  it('always excludes persistent analysis artifacts from production scans', () => {
    const invocations = [...scanner.matchAll(/```(?:bash)?\r?\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .filter((block) => block.includes('node $PLUGIN_ROOT/skills/understand/scan-project.mjs'));

    expect(invocations).toHaveLength(2);
    for (const invocation of invocations) {
      expect(invocation).toContain('--exclude-analysis-data');
    }
  });
});
