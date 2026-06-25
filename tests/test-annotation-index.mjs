/**
 * test-annotation-index.mjs — unit tests for extract-annotation-index.mjs
 *
 * Run: node tests/test-annotation-index.mjs
 * Exit 0 = all pass, Exit 1 = failure
 *
 * Tests cover: basic extraction, deduplication, multi-file, RILEY governance IDs
 * (RULE-048, RULE-053, BCP-OPS-103, BCP-REL-307), nested dirs, mixed file types,
 * custom output path, and corpus-scale smoke test.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const SCRIPT = path.resolve('understand-anything-plugin/skills/understand/extract-annotation-index.mjs');
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ua-annot-test-'));
  fs.mkdirSync(path.join(dir, '.understand-anything', 'intermediate'), { recursive: true });
  return dir;
}

function writePatterns(projectDir, patterns) {
  const configDir = path.join(projectDir, '.understand-anything');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'annotation-patterns.json'), JSON.stringify({ patterns }));
}

function readIndex(projectDir, customPath) {
  const indexPath = customPath ?? path.join(projectDir, '.understand-anything', 'intermediate', 'annotation-index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function run(projectDir, extraArgs = '') {
  execSync(`node ${SCRIPT} --project-dir ${projectDir} ${extraArgs}`, { stdio: 'pipe' });
}

const RILEY_PATTERNS = [
  { name: 'rule-ref', regex: 'RULE-\\d+', edge_type: 'enforces-rule' },
  { name: 'bcp-ref', regex: 'BCP-[A-Z]+-\\d+', edge_type: 'implements-bcp' },
  { name: 'prd-ref', regex: 'PRD-\\d+', edge_type: 'born-from-prd' },
];

// --- Test 1: Basic extraction ---
console.log('\nTest 1: Basic extraction of RULE/BCP/PRD IDs');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'agent.py'), `
# enforces RULE-023
# implements BCP-REL-307
class Agent:
    """Born from PRD-2990."""
    pass
`);
  fs.writeFileSync(path.join(dir, 'util.py'), `
# No annotations here
def helper(): pass
`);
  writePatterns(dir, RILEY_PATTERNS);
  run(dir);
  const index = readIndex(dir);
  assert('agent.py' in index, 'agent.py appears in index');
  assert(!('util.py' in index), 'util.py (no annotations) absent from index');
  assert(index['agent.py'].includes('RULE-023'), 'RULE-023 extracted');
  assert(index['agent.py'].includes('BCP-REL-307'), 'BCP-REL-307 extracted');
  assert(index['agent.py'].includes('PRD-2990'), 'PRD-2990 extracted');
  assert(index['agent.py'].length === 3, 'exactly 3 annotations in agent.py');
}

// --- Test 2: No pattern file → empty index ---
console.log('\nTest 2: No pattern file produces empty index');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'foo.py'), '# RULE-001 referenced here');
  run(dir);
  const index = readIndex(dir);
  assert(Object.keys(index).length === 0, 'index is empty when no pattern file');
}

// --- Test 3: Deduplication ---
console.log('\nTest 3: Duplicate annotation IDs are deduplicated');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'dup.py'), `
# RULE-023 is mentioned here
# RULE-023 is mentioned again
# RULE-023 appears a third time
`);
  writePatterns(dir, [{ name: 'rule-ref', regex: 'RULE-\\d+', edge_type: 'enforces-rule' }]);
  run(dir);
  const index = readIndex(dir);
  assert(index['dup.py'].length === 1, 'RULE-023 appears exactly once (deduplicated)');
}

// --- Test 4: Multiple files ---
console.log('\nTest 4: Multiple files each get their own annotations');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'a.py'), '# RULE-001');
  fs.writeFileSync(path.join(dir, 'b.py'), '# RULE-002');
  fs.writeFileSync(path.join(dir, 'c.py'), '# no match');
  writePatterns(dir, [{ name: 'rule-ref', regex: 'RULE-\\d+', edge_type: 'enforces-rule' }]);
  run(dir);
  const index = readIndex(dir);
  assert(index['a.py']?.includes('RULE-001'), 'a.py has RULE-001');
  assert(index['b.py']?.includes('RULE-002'), 'b.py has RULE-002');
  assert(!('c.py' in index), 'c.py absent (no match)');
}

// --- Test 5: --help exits 0 ---
console.log('\nTest 5: --help exits cleanly');
{
  try {
    execSync(`node ${SCRIPT} --help`, { stdio: 'pipe' });
    assert(true, '--help exits 0');
  } catch {
    assert(false, '--help exits 0');
  }
}

// --- Test 6: RILEY-specific governance IDs ---
console.log('\nTest 6: RILEY high-numbered governance IDs (RULE-048, RULE-053, RULE-036)');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'skill.md'), `
# Sprint Skill
Enforces RULE-048 (information search priority).
Also enforces RULE-053 (test plan gate) and RULE-036 (worktree policy).
Implements BCP-OPS-103 and BCP-REL-307.
Born from PRD-2385 and PRD-2883.
`);
  writePatterns(dir, RILEY_PATTERNS);
  run(dir);
  const index = readIndex(dir);
  assert('skill.md' in index, 'skill.md indexed');
  assert(index['skill.md'].includes('RULE-048'), 'RULE-048 extracted');
  assert(index['skill.md'].includes('RULE-053'), 'RULE-053 extracted');
  assert(index['skill.md'].includes('RULE-036'), 'RULE-036 extracted');
  assert(index['skill.md'].includes('BCP-OPS-103'), 'BCP-OPS-103 extracted');
  assert(index['skill.md'].includes('BCP-REL-307'), 'BCP-REL-307 (from skill.md) extracted');
  assert(index['skill.md'].includes('PRD-2385'), 'PRD-2385 extracted');
  assert(index['skill.md'].includes('PRD-2883'), 'PRD-2883 extracted');
  assert(index['skill.md'].length === 7, 'exactly 7 unique annotations in skill.md');
}

// --- Test 7: Nested directory structure ---
console.log('\nTest 7: Nested directories — relative paths preserved');
{
  const dir = makeTempProject();
  const sub = path.join(dir, 'skills', '_core', 'sprint');
  const refs = path.join(sub, 'references');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(refs, { recursive: true });
  fs.writeFileSync(path.join(sub, 'SKILL.md'), '# Sprint\nenforces RULE-023, implements BCP-OPS-103');
  fs.writeFileSync(path.join(refs, 'execute.md'),
    '# Execute\nenforces RULE-036, born from PRD-2385');
  writePatterns(dir, RILEY_PATTERNS);
  run(dir);
  const index = readIndex(dir);
  const skillKey = Object.keys(index).find(k => k.endsWith('sprint/SKILL.md'));
  const execKey = Object.keys(index).find(k => k.endsWith('execute.md'));
  assert(!!skillKey, 'sprint/SKILL.md in index with relative path');
  assert(!!execKey, 'references/execute.md in index');
  assert(index[skillKey]?.includes('RULE-023'), 'RULE-023 in nested SKILL.md');
  assert(index[skillKey]?.includes('BCP-OPS-103'), 'BCP-OPS-103 in nested SKILL.md');
  assert(index[execKey]?.includes('RULE-036'), 'RULE-036 in nested execute.md');
  assert(index[execKey]?.includes('PRD-2385'), 'PRD-2385 in nested execute.md');
}

// --- Test 8: Mixed file types (.yaml, .json, .sh) ---
console.log('\nTest 8: Mixed file types — yaml, json, sh all scanned');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'rule.yaml'), 'id: RULE-023\ndescription: enforces BCP-GOV-401');
  fs.writeFileSync(path.join(dir, 'config.json'), '{"prd": "PRD-2990", "enforces": "RULE-053"}');
  fs.writeFileSync(path.join(dir, 'deploy.sh'), '# BCP-REL-307 compliance\necho done');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Docs\nSee PRD-2883 for context.');
  writePatterns(dir, RILEY_PATTERNS);
  run(dir);
  const index = readIndex(dir);
  assert('rule.yaml' in index, 'yaml file indexed');
  assert('config.json' in index, 'json file indexed');
  assert('deploy.sh' in index, 'shell script indexed');
  assert('README.md' in index, 'markdown file indexed');
  assert(index['rule.yaml'].includes('RULE-023'), 'RULE-023 from yaml');
  assert(index['config.json'].includes('PRD-2990'), 'PRD-2990 from json');
  assert(index['deploy.sh'].includes('BCP-REL-307'), 'BCP-REL-307 from sh');
  assert(index['README.md'].includes('PRD-2883'), 'PRD-2883 from md');
}

// --- Test 9: BCP pattern variants ---
console.log('\nTest 9: BCP multi-segment patterns (OPS/REL/GOV/STD)');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'bcps.py'), `
# BCP-OPS-103 task management
# BCP-REL-307 change management
# BCP-GOV-401 governance
# BCP-STD-001 writing style
`);
  writePatterns(dir, [{ name: 'bcp-ref', regex: 'BCP-[A-Z]+-\\d+', edge_type: 'implements-bcp' }]);
  run(dir);
  const index = readIndex(dir);
  assert(index['bcps.py'].includes('BCP-OPS-103'), 'BCP-OPS-103 extracted');
  assert(index['bcps.py'].includes('BCP-REL-307'), 'BCP-REL-307 extracted');
  assert(index['bcps.py'].includes('BCP-GOV-401'), 'BCP-GOV-401 extracted');
  assert(index['bcps.py'].includes('BCP-STD-001'), 'BCP-STD-001 extracted');
  assert(index['bcps.py'].length === 4, 'exactly 4 BCP variants');
}

// --- Test 10: Custom --output path ---
console.log('\nTest 10: Custom --output path respected');
{
  const dir = makeTempProject();
  const customOut = path.join(dir, 'custom-out', 'my-index.json');
  fs.writeFileSync(path.join(dir, 'x.py'), '# RULE-001');
  writePatterns(dir, [{ name: 'rule-ref', regex: 'RULE-\\d+', edge_type: 'enforces-rule' }]);
  run(dir, `--output ${customOut}`);
  assert(fs.existsSync(customOut), 'custom output file created');
  const index = readIndex(dir, customOut);
  assert(index['x.py']?.includes('RULE-001'), 'annotations present in custom output');
}

// --- Test 11: Empty pattern list → empty index ---
console.log('\nTest 11: Empty patterns array produces empty index');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'y.py'), '# RULE-001 BCP-OPS-103');
  writePatterns(dir, []);
  run(dir);
  const index = readIndex(dir);
  assert(Object.keys(index).length === 0, 'empty patterns → empty index');
}

// --- Test 12: Annotations sorted in output ---
console.log('\nTest 12: Annotation IDs sorted lexicographically per file');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'z.py'), '# RULE-053 and RULE-001 and RULE-023');
  writePatterns(dir, [{ name: 'rule-ref', regex: 'RULE-\\d+', edge_type: 'enforces-rule' }]);
  run(dir);
  const index = readIndex(dir);
  const ids = index['z.py'];
  assert(ids[0] === 'RULE-001', 'first annotation is RULE-001 (sorted)');
  assert(ids[1] === 'RULE-023', 'second annotation is RULE-023 (sorted)');
  assert(ids[2] === 'RULE-053', 'third annotation is RULE-053 (sorted)');
}

// --- Test 13: Output JSON structure ---
console.log('\nTest 13: Output JSON is valid — object of string→string-array entries');
{
  const dir = makeTempProject();
  fs.writeFileSync(path.join(dir, 'struct.py'), '# RULE-023 RULE-048 BCP-REL-307');
  writePatterns(dir, RILEY_PATTERNS);
  run(dir);
  const index = readIndex(dir);
  assert(typeof index === 'object' && !Array.isArray(index), 'output is a JSON object');
  assert(Object.values(index).every(v => Array.isArray(v)), 'all values are arrays');
  assert(Object.values(index).every(v => v.every(s => typeof s === 'string')), 'array elements are strings');
  const total = Object.values(index).reduce((n, v) => n + v.length, 0);
  assert(total >= 1, 'at least one annotation extracted');
}

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
