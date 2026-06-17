#!/usr/bin/env python3
"""Phase 4b.1: Bounded LLM capability review (Spec 2 Component 4).

A candidate→verify pass over the deterministic serverIndex. Runs the LLM only
for domains with >=2 touchpoints across >=2 facets (single-touchpoint or
single-facet domains get a mechanical label, no LLM cost). It judges WITHIN the
given grouping; it never invents groupings. Degrades to mechanical labels when
no LLM is configured or a response is malformed.

Usage:
    python3 capability_review.py <project-root>

Reads / writes (in place):
    <project-root>/.understand-anything/business-landscape/business-features.json
"""
import hashlib
import json
import sys
from pathlib import Path

from association_discovery import _extract_json

_VALID_RELATIONSHIPS = ('replication', 'complementary-split', 'shared-infrastructure')


def build_review_prompt(domain_name: str, domain_service: str, touchpoints: list) -> str:
    """Build an LLM prompt asking how the touchpoints on a backend domain relate."""
    tp_lines = []
    for t in touchpoints:
        tp_lines.append(
            f"  - 功能: {t.get('feature', '')} (端: {t.get('facet', '')}, 角色: {t.get('role', '')})"
        )
    tp_block = '\n'.join(tp_lines)
    return f"""以下是多个客户端功能,它们都关联到同一个后端业务域:
后端域: {domain_name} (服务: {domain_service})

关联的客户端触点:
{tp_block}

请判断这些触点之间的关系,并给这个后端域对应的业务能力起一个规范名称。
返回严格 JSON 格式:
{{
  "label": "<这个业务能力的规范中文名>",
  "relationship": "replication | complementary-split | shared-infrastructure",
  "summary": "<一句话说明各端如何分工>",
  "flagged": [{{"feature": "<关联看起来不合理的功能名>", "reason": "<原因>"}}]
}}

规则:
- replication=各端实现同一能力; complementary-split=各端负责能力的不同部分; shared-infrastructure=这是被很多无关功能共用的基础设施(此时不要断言它们是同一个能力)
- 只在给定的触点范围内判断,不要发明新的分组
- flagged 仅作建议标注,不会删除任何关联"""


def parse_review_response(response: str, domain_name: str) -> dict:
    """Parse an LLM review response into {label, relationship, summary, flagged}.

    Falls back to a mechanical label on malformed input.
    """
    cleaned = _extract_json(response)
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return {'label': domain_name, 'relationship': 'unknown', 'summary': '', 'flagged': []}
    if not isinstance(data, dict):
        return {'label': domain_name, 'relationship': 'unknown', 'summary': '', 'flagged': []}

    relationship = data.get('relationship', 'unknown')
    if relationship not in _VALID_RELATIONSHIPS:
        relationship = 'unknown'

    # For shared infrastructure, do NOT assert the touchpoints are one capability:
    # keep the domain's own name as the label.
    if relationship == 'shared-infrastructure':
        label = domain_name
    else:
        label = data.get('label') or domain_name

    summary = data.get('summary', '') or ''
    flagged = data.get('flagged', []) or []
    if not isinstance(flagged, list):
        flagged = []
    return {'label': label, 'relationship': relationship, 'summary': summary, 'flagged': flagged}


def _call_llm(prompt: str) -> str:
    """Placeholder for LLM call. Overridden in tests, replaced by the agent in production."""
    raise NotImplementedError(
        "LLM call not configured. In production, this is replaced by the agent's LLM."
    )


def _mechanical_capability(domain_name: str) -> dict:
    return {'label': domain_name, 'relationship': 'unknown', 'summary': ''}


def _capability_hash(domain_name: str, touchpoints: list) -> str:
    ids = sorted(
        f"{t.get('feature', '')}|{t.get('facet', '')}|{t.get('role', '')}"
        for t in touchpoints
    )
    raw = domain_name + '\n' + '\n'.join(ids)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def run_capability_review(project_root_str: str) -> dict:
    """Enrich serverIndex[domain].capability in business-features.json (in place)."""
    project_root = Path(project_root_str)
    bf_path = (
        project_root / '.understand-anything' / 'business-landscape' / 'business-features.json'
    )
    if not bf_path.is_file():
        return {'error': 'business-features.json not found. Run Phase 4b first.'}
    try:
        data = json.loads(bf_path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as e:
        return {'error': f'Failed to parse business-features.json: {e}'}

    server_index = data.get('serverIndex', {})
    reviewed = 0
    mechanical = 0
    reused = 0

    for domain_name, entry in server_index.items():
        touchpoints = entry.get('touchpoints', [])
        facets = {t.get('facet') for t in touchpoints}
        new_hash = _capability_hash(domain_name, touchpoints)

        # Cache: reuse the prior capability if the grouping is unchanged.
        if entry.get('_capabilityHash') == new_hash and entry.get('capability'):
            reused += 1
            continue

        if len(touchpoints) >= 2 and len(facets) >= 2:
            prompt = build_review_prompt(domain_name, entry.get('service', ''), touchpoints)
            try:
                response = _call_llm(prompt)
            except (NotImplementedError, RuntimeError, OSError):
                entry['capability'] = _mechanical_capability(domain_name)
                mechanical += 1
            else:
                parsed = parse_review_response(response, domain_name)
                entry['capability'] = {
                    'label': parsed['label'],
                    'relationship': parsed['relationship'],
                    'summary': parsed['summary'],
                }
                for fl in parsed.get('flagged', []):
                    if not isinstance(fl, dict):
                        continue
                    for tp in touchpoints:
                        if tp.get('feature') == fl.get('feature'):
                            tp['flagged'] = {'reason': fl.get('reason', '')}
                reviewed += 1
        else:
            entry['capability'] = _mechanical_capability(domain_name)
            mechanical += 1

        entry['_capabilityHash'] = new_hash

    bf_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    return {
        'reviewed': reviewed,
        'mechanical': mechanical,
        'reused': reused,
        'domains': len(server_index),
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 capability_review.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = run_capability_review(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    print(
        f"Capability review: {result['reviewed']} reviewed, "
        f"{result['mechanical']} mechanical, {result['reused']} reused "
        f"({result['domains']} domains)"
    )
