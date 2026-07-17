import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

describe('skill command hardening', () => {
  it('quotes PROJECT_ROOT in shell command snippets', () => {
    const files = [
      'understand-anything-plugin/skills/understand/SKILL.md',
      'understand-anything-plugin/hooks/auto-update-prompt.md',
    ];

    const unsafePatterns = [
      /\b(?:node|python|python3|mkdir|find|rm|cat)\s+(?:-[^\n]*\s+)*\$PROJECT_ROOT\b/,
      />\s*\$PROJECT_ROOT\b/,
      /--changed-files=\$PROJECT_ROOT\b/,
      /rm\s+-rf\s+\$PROJECT_ROOT\b/,
    ];

    for (const relPath of files) {
      const content = readRepoFile(relPath);
      for (const pattern of unsafePatterns) {
        expect(content, `${relPath} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('quotes skill and target directory placeholders in knowledge commands', () => {
    const content = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(content).not.toMatch(/python3\s+<SKILL_DIR>\/[^\n]+ <TARGET_DIR>/);
    expect(content).not.toMatch(/rm\s+-rf\s+<TARGET_DIR>/);
  });

  it('quotes dashboard cd targets and GRAPH_DIR assignment', () => {
    const content = readRepoFile('understand-anything-plugin/skills/understand-dashboard/SKILL.md');

    expect(content).not.toMatch(/<(?:dashboard-dir|plugin-root|project-dir)>/);
    expect(content).not.toMatch(/\bcd <(?:dashboard-dir|plugin-root)>/);
    expect(content).not.toMatch(/GRAPH_DIR=<project-dir>/);
    expect(content).toMatch(/PROJECT_DIR=\$\(pwd -P\)/);
    expect(content).toMatch(/UA_DIR="\$PROJECT_DIR\/\.understand-anything"/);
    expect(content).toMatch(/\[ ! -f "\$UA_DIR\/knowledge-graph\.json" \]/);
    expect(content).toMatch(/DASHBOARD_DIR="\$PLUGIN_ROOT\/packages\/dashboard"/);
    expect(content).toMatch(/: "\$\{PLUGIN_ROOT:\?Run step 3 first so PLUGIN_ROOT is set\}"/);
    expect(content).toMatch(/: "\$\{PROJECT_DIR:\?Run step 1 first so PROJECT_DIR is set\}"/);
    expect(content).toMatch(/: "\$\{DASHBOARD_DIR:\?Run step 5 first so DASHBOARD_DIR is set\}"/);
    expect(content).toMatch(/cd "\$PLUGIN_ROOT" && pnpm --filter @understand-anything\/core build/);
    expect(content).toMatch(/cd "\$DASHBOARD_DIR" && GRAPH_DIR="\$PROJECT_DIR" npx vite/);
    // Fast path: the viewer URL is version-pinned and both npx arguments are quoted.
    expect(content).toMatch(/VIEWER_URL="https:\/\/github\.com\/Egonex-AI\/Understand-Anything\/releases\/download\/v\$\{PLUGIN_VERSION\}\/understand-anything-viewer\.tgz"/);
    expect(content).toMatch(/npx --yes "\$VIEWER_URL" "\$PROJECT_DIR"/);
  });

  it('marks project-controlled context as untrusted data', () => {
    const understand = readRepoFile('understand-anything-plugin/skills/understand/SKILL.md');
    const knowledge = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(understand).not.toMatch(/README and manifest are authoritative/i);
    expect(understand).toMatch(/untrusted project data/i);
    expect(knowledge).toMatch(/untrusted article data/i);
  });

  it('collects project context only from the current validated scan inventory', () => {
    const understand = readRepoFile('understand-anything-plugin/skills/understand/SKILL.md');
    const contextStep = understand.indexOf('8. **Defer project context collection:**');
    const incrementalPhase = understand.indexOf('### Incremental update path');
    const deferInstruction = understand.indexOf('for both full and incremental analysis');
    const fullResumeInstruction = understand.indexOf('After Phase 1 returns a validated scan result');
    const computeInstruction = understand.indexOf('Run compute-batches with `--changed-files`');
    const incrementalResumeInstruction = understand.indexOf('Now perform the deferred Step 8 project-context collection');

    expect(contextStep).toBeGreaterThan(-1);
    expect(deferInstruction).toBeGreaterThan(contextStep);
    expect(deferInstruction).toBeLessThan(incrementalPhase);
    expect(fullResumeInstruction).toBeGreaterThan(contextStep);
    expect(fullResumeInstruction).toBeLessThan(incrementalPhase);
    expect(computeInstruction).toBeGreaterThan(incrementalPhase);
    expect(incrementalResumeInstruction).toBeGreaterThan(computeInstruction);
    expect(understand).toMatch(/projectContext.*sole source/is);
    expect(understand).toMatch(/full analysis.*ua-scan-files\.json/is);
    expect(understand).toMatch(/incremental analysis.*batches\.json/is);
    expect(understand).not.toContain('find "$PROJECT_ROOT" -maxdepth 2');
  });

  it('makes the project scanner validate membership before narrative reads', () => {
    const scanner = readRepoFile('understand-anything-plugin/agents/project-scanner.md');
    const bundledScan = scanner.indexOf('### Step B (bundled `scan-project.mjs`)');
    const narrativeRead = scanner.indexOf('### Step A (LLM)');

    expect(bundledScan).toBeGreaterThan(-1);
    expect(narrativeRead).toBeGreaterThan(bundledScan);
    expect(scanner).toContain('--include-context');
    expect(scanner).toMatch(/consume.*projectContext/is);
    expect(scanner).toMatch(/must not re-read.*PROJECT_ROOT/is);
  });
});
