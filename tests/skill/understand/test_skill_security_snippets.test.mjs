import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

const POSIX_SHELL_FENCE_LANGUAGES = new Set([
  '',
  'bash',
  'sh',
  'shell',
  'zsh',
]);

function shellCommandLines(markdown) {
  const lines = [];
  const fencedBlock = /^[ \t]*```([^\r\n]*)\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

  for (const match of markdown.matchAll(fencedBlock)) {
    const language = match[1].trim().toLowerCase();
    if (!POSIX_SHELL_FENCE_LANGUAGES.has(language)) continue;

    const logicalLines = match[2]
      .replace(/\\\r?\n[ \t]*/g, ' ')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    lines.push(...logicalLines);
  }

  return lines;
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

  it('rejects bare python and pins audited helpers to portable commands', () => {
    const skillsDir = resolve(repoRoot, 'understand-anything-plugin/skills');
    const skillFiles = readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => `understand-anything-plugin/skills/${entry.name}/SKILL.md`)
      .filter(relPath => existsSync(resolve(repoRoot, relPath)));

    expect(skillFiles.length).toBeGreaterThan(0);

    // Inspect logical commands only: prose and fenced Python examples are not
    // executable shell snippets. The pattern covers quoted command tokens,
    // compact shell separators, subshells, and backslash-continued commands.
    const barePythonCommand =
      /(?:^|(?:&&|\|\||[;|]|\()[ \t]*)(?:["']python["']|python)(?=[ \t]+(?:["'./<$~-]|[^ \t\r\n]+\.py\b))/;

    const unsafeExamples = [
      'python ./tool.py',
      "'python' ./tool.py",
      '"python" ./tool.py',
      'true &&python tool.py',
      '(python tool.py)',
      'python \\\n  ./tool.py',
      'python \\\r\n  ./tool.py',
    ];
    for (const command of unsafeExamples) {
      const [logicalCommand] = shellCommandLines(`\`\`\`bash\n${command}\n\`\`\``);
      expect(logicalCommand, command).toMatch(barePythonCommand);
    }
    const [unlabelledCommand] = shellCommandLines('```\npython ./tool.py\n```');
    expect(unlabelledCommand).toMatch(barePythonCommand);

    const nonCommandMarkdown = [
      'Avoid bare python',
      '- use python3 instead',
      '```python',
      '"./tool.py"',
      '```',
    ].join('\n');
    expect(shellCommandLines(nonCommandMarkdown)).toEqual([]);

    for (const relPath of skillFiles) {
      for (const command of shellCommandLines(readRepoFile(relPath))) {
        expect(
          command,
          `${relPath} should not invoke a bundled helper with bare python`,
        ).not.toMatch(barePythonCommand);
      }
    }

    const runner = 'node "$PLUGIN_ROOT/scripts/run-python.mjs"';
    const domainCommands = shellCommandLines(
      readRepoFile('understand-anything-plugin/skills/understand-domain/SKILL.md'),
    );
    expect(domainCommands.filter(command => command.includes('extract-domain-context.py'))).toEqual([
      `${runner} "$PLUGIN_ROOT/skills/understand-domain/extract-domain-context.py" "$PROJECT_ROOT"`,
    ]);

    const understandCommands = shellCommandLines(
      readRepoFile('understand-anything-plugin/skills/understand/SKILL.md'),
    );
    expect(understandCommands.filter(command => command.includes('merge-subdomain-graphs.py')))
      .toEqual([
        `${runner} "$PLUGIN_ROOT/skills/understand/merge-subdomain-graphs.py" "$PROJECT_ROOT"`,
      ]);
    expect(understandCommands.filter(command => command.includes('merge-batch-graphs.py')))
      .toEqual([
        `${runner} "$PLUGIN_ROOT/skills/understand/merge-batch-graphs.py" "$PROJECT_ROOT"`,
        `${runner} "$PLUGIN_ROOT/skills/understand/merge-batch-graphs.py" "$PROJECT_ROOT"`,
      ]);
  });

  it('marks project-controlled context as untrusted data', () => {
    const understand = readRepoFile('understand-anything-plugin/skills/understand/SKILL.md');
    const knowledge = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(understand).not.toMatch(/README and manifest are authoritative/i);
    expect(understand).toMatch(/untrusted project data/i);
    expect(knowledge).toMatch(/untrusted article data/i);
  });
});
