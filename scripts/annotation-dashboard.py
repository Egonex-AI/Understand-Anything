#!/usr/bin/env python3
"""
annotation-dashboard.py — TC-04 benchmark query server for annotation-index.json

Loads annotation-index.json and exposes 5 governance query endpoints (BQ-01..BQ-05)
plus a simple HTML dashboard at http://localhost:5000.

Usage:
  python3 scripts/annotation-dashboard.py --index <path-to-annotation-index.json>

TC-04 Queries:
  BQ-01  /api/q/bq01?rules=RULE-023,RULE-036   → files + skill IDs enforcing those rules
  BQ-02  /api/q/bq02?prd=PRD-2990              → files born from a PRD
  BQ-03  /api/q/bq03?bcp=BCP-REL-307           → files enforcing a BCP
  BQ-04  /api/q/bq04?skill=conductor            → files in a skill's layer
  BQ-05  /api/q/bq05?skill=sprint               → skill-to-skill cross-references
"""

import argparse
import json
import re
import sys
from flask import Flask, jsonify, request

app = Flask(__name__)
INDEX: dict[str, list[str]] = {}

# -- helpers -----------------------------------------------------------------

def files_with(annotation_id: str) -> list[str]:
    return [f for f, ids in INDEX.items() if annotation_id in ids]

def files_matching(pattern: str) -> dict[str, list[str]]:
    rx = re.compile(pattern)
    return {f: [a for a in ids if rx.search(a)] for f, ids in INDEX.items()
            if any(rx.search(a) for a in ids)}

# -- TC-04 query endpoints ---------------------------------------------------

@app.route('/api/q/bq01')
def bq01():
    """BQ-01: What skills implement RULE-023 or RULE-036?"""
    rule_param = request.args.get('rules', 'RULE-023,RULE-036')
    rules = [r.strip() for r in rule_param.split(',')]
    result: dict[str, list[str]] = {}
    for rule in rules:
        hits = files_with(rule)
        skill_hits = [f for f in hits if 'skill' in f.lower() or f.endswith('.md')]
        result[rule] = skill_hits
    all_files = sorted({f for hits in result.values() for f in hits})
    return jsonify({
        'query': 'BQ-01',
        'description': 'Files (skill refs) implementing given RULE-* IDs',
        'rules': rules,
        'hits_by_rule': result,
        'total_files': len(all_files),
        'sample': all_files[:10],
        'pass': len(all_files) > 0,
    })

@app.route('/api/q/bq02')
def bq02():
    """BQ-02: What code was born from PRD-2990?"""
    prd = request.args.get('prd', 'PRD-2990')
    hits = files_with(prd)
    return jsonify({
        'query': 'BQ-02',
        'description': f'Files referencing {prd} (born-from-prd edges)',
        'prd': prd,
        'files': sorted(hits),
        'total': len(hits),
        'pass': len(hits) > 0,
    })

@app.route('/api/q/bq03')
def bq03():
    """BQ-03: Which files enforce BCP-REL-307?"""
    bcp = request.args.get('bcp', 'BCP-REL-307')
    hits = files_with(bcp)
    return jsonify({
        'query': 'BQ-03',
        'description': f'Compliance mapping for {bcp}',
        'bcp': bcp,
        'files': sorted(hits),
        'total': len(hits),
        'pass': len(hits) > 0,
    })

@app.route('/api/q/bq04')
def bq04():
    """BQ-04: Architectural layer of conductor skill?"""
    skill = request.args.get('skill', 'conductor')
    hits = {f: ids for f, ids in INDEX.items() if skill.lower() in f.lower()}
    # Classify into layers based on path patterns
    layers = {'mops': [], 'skills': [], 'guardrails': [], 'agents': [], 'other': []}
    for f in hits:
        if 'mops' in f:
            layers['mops'].append(f)
        elif 'skills' in f:
            layers['skills'].append(f)
        elif 'guardrails' in f:
            layers['guardrails'].append(f)
        elif 'agents' in f:
            layers['agents'].append(f)
        else:
            layers['other'].append(f)
    return jsonify({
        'query': 'BQ-04',
        'description': f'Architectural layer classification for "{skill}" skill',
        'skill': skill,
        'layer_classification': {k: v for k, v in layers.items() if v},
        'total_files': len(hits),
        'annotations': {f: ids for f, ids in hits.items()},
        'pass': len(hits) > 0,
    })

@app.route('/api/q/bq05')
def bq05():
    """BQ-05: How does sprint orchestrator connect to other skills?"""
    skill = request.args.get('skill', 'sprint')
    sprint_files = {f: ids for f, ids in INDEX.items() if skill.lower() in f.lower()}
    # Find all governance IDs referenced in sprint files
    sprint_annotations = set()
    for ids in sprint_files.values():
        sprint_annotations.update(ids)
    # Find other skills that share those annotation IDs (cross-references)
    cross_refs: dict[str, list[str]] = {}
    for f, ids in INDEX.items():
        if skill.lower() in f.lower():
            continue
        shared = [a for a in ids if a in sprint_annotations]
        if shared and ('skill' in f.lower() or f.endswith('.md')):
            cross_refs[f] = shared
    return jsonify({
        'query': 'BQ-05',
        'description': f'Skill-to-skill graph connections for "{skill}" orchestrator',
        'skill': skill,
        'sprint_annotations': sorted(sprint_annotations)[:20],
        'cross_referenced_files': len(cross_refs),
        'sample_connections': dict(list(cross_refs.items())[:10]),
        'pass': len(cross_refs) > 0,
    })

@app.route('/api/stats')
def stats():
    total_annotations = sum(len(v) for v in INDEX.values())
    all_ids = set()
    for ids in INDEX.values():
        all_ids.update(ids)
    return jsonify({
        'total_files': len(INDEX),
        'total_annotations': total_annotations,
        'unique_ids': len(all_ids),
        'rules': len([x for x in all_ids if x.startswith('RULE-')]),
        'bcps': len([x for x in all_ids if x.startswith('BCP-')]),
        'prds': len([x for x in all_ids if x.startswith('PRD-')]),
    })

@app.route('/')
def dashboard():
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Annotation-Index Dashboard — PRD-2883 TC-04</title>
<style>
  body { background:#0a0a0a; color:#e0e0e0; font-family:monospace; margin:0; padding:20px; }
  h1 { color:#d4a574; font-size:1.4rem; border-bottom:1px solid #333; padding-bottom:8px; }
  h2 { color:#b8903c; font-size:1rem; margin-top:24px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
  .card { background:#111; border:1px solid #2a2a2a; border-radius:6px; padding:12px; }
  .card .val { font-size:2rem; color:#d4a574; font-weight:bold; }
  .card .lbl { font-size:0.75rem; color:#888; margin-top:4px; }
  .queries { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:16px 0; }
  .btn { background:#1a1a1a; border:1px solid #d4a574; color:#d4a574; padding:10px 14px;
         border-radius:4px; cursor:pointer; font-family:monospace; font-size:0.85rem;
         text-align:left; transition:background 0.2s; }
  .btn:hover { background:#2a1a00; }
  #result { background:#111; border:1px solid #333; border-radius:6px; padding:16px;
            margin-top:16px; white-space:pre-wrap; font-size:0.8rem; max-height:400px;
            overflow-y:auto; }
  .pass { color:#4ade80; } .fail { color:#f87171; }
  .label { color:#888; font-size:0.75rem; }
</style>
</head>
<body>
<h1>Annotation-Index Dashboard — PRD-2883 M1 / TC-04 Benchmark</h1>
<div class="label">Corpus: /tmp/riley-ai-only/ (RILEY .ai/ snapshot)</div>

<div id="stats-grid" class="grid">
  <div class="card"><div class="val" id="s-files">…</div><div class="lbl">Files Indexed</div></div>
  <div class="card"><div class="val" id="s-total">…</div><div class="lbl">Total Annotations</div></div>
  <div class="card"><div class="val" id="s-unique">…</div><div class="lbl">Unique IDs</div></div>
  <div class="card"><div class="val" id="s-rules">…</div><div class="lbl">RULE-* IDs</div></div>
  <div class="card"><div class="val" id="s-bcps">…</div><div class="lbl">BCP-* IDs</div></div>
  <div class="card"><div class="val" id="s-prds">…</div><div class="lbl">PRD-* IDs</div></div>
</div>

<h2>TC-04 Governance Queries</h2>
<div class="queries">
  <button class="btn" onclick="run('/api/q/bq01')">BQ-01: Skills implementing RULE-023 or RULE-036</button>
  <button class="btn" onclick="run('/api/q/bq02')">BQ-02: Code born from PRD-2990</button>
  <button class="btn" onclick="run('/api/q/bq03')">BQ-03: Files enforcing BCP-REL-307</button>
  <button class="btn" onclick="run('/api/q/bq04')">BQ-04: Conductor skill layer classification</button>
  <button class="btn" onclick="run('/api/q/bq05', true)">BQ-05: Sprint→skill cross-references</button>
  <button class="btn" onclick="runAll()">▶ Run All TC-04 Queries</button>
</div>

<div id="result">Click a query to execute...</div>

<script>
async function run(url, sprint) {
  document.getElementById('result').textContent = 'Running...';
  const r = await fetch(url);
  const data = await r.json();
  const pass = data.pass ? '<span class="pass">PASS ✓</span>' : '<span class="fail">FAIL ✗</span>';
  document.getElementById('result').innerHTML = pass + '\\n' + JSON.stringify(data, null, 2);
}

async function runAll() {
  const queries = ['/api/q/bq01','/api/q/bq02','/api/q/bq03','/api/q/bq04','/api/q/bq05'];
  const results = await Promise.all(queries.map(q => fetch(q).then(r => r.json())));
  const passed = results.filter(r => r.pass).length;
  const out = results.map(r => {
    const s = r.pass ? '✓ PASS' : '✗ FAIL';
    return s + ' ' + r.query + ': ' + r.description;
  }).join('\\n');
  document.getElementById('result').innerHTML =
    '<span class="' + (passed>=3?'pass':'fail') + '">' + passed + '/5 TC-04 PASS</span>\\n\\n' + out +
    '\\n\\n' + JSON.stringify(results, null, 2);
}

fetch('/api/stats').then(r => r.json()).then(d => {
  document.getElementById('s-files').textContent = d.total_files;
  document.getElementById('s-total').textContent = d.total_annotations;
  document.getElementById('s-unique').textContent = d.unique_ids;
  document.getElementById('s-rules').textContent = d.rules;
  document.getElementById('s-bcps').textContent = d.bcps;
  document.getElementById('s-prds').textContent = d.prds;
});
</script>
</body>
</html>"""

# -- entrypoint --------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Annotation-Index TC-04 Dashboard')
    parser.add_argument('--index', default='/tmp/riley-ai-only/.understand-anything/intermediate/annotation-index.json',
                        help='Path to annotation-index.json')
    parser.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()

    with open(args.index) as f:
        INDEX.update(json.load(f))
    print(f'[dashboard] Loaded {len(INDEX)} entries from {args.index}')
    print(f'[dashboard] → http://localhost:{args.port}/')
    app.run(host='0.0.0.0', port=args.port, debug=False)

if __name__ == '__main__':
    main()
