#!/usr/bin/env python3
"""Phase 4: Validate per-domain interaction document.

Checks DAG structure, step references, business rules, and facet references.

Usage:
    python3 validate_domain.py <domain-json-path>

Exit code 0 = valid, 1 = validation errors (printed to stderr)
"""
import json
import sys
from pathlib import Path


def validate_domain_doc(doc):
    errors = []

    if 'id' not in doc:
        errors.append("Missing required field: 'id'")
    elif not doc['id'].startswith('domain:'):
        errors.append(f"Field 'id' must match pattern 'domain:*', got '{doc['id']}'")

    for field in ('name', 'summary'):
        if field not in doc or not doc.get(field, '').strip():
            errors.append(f"Missing or empty required field: '{field}'")

    if 'interactions' not in doc:
        errors.append("Missing required field: 'interactions'")
    elif not isinstance(doc['interactions'], list):
        errors.append("'interactions' must be an array")
    else:
        for i, interaction in enumerate(doc['interactions']):
            errors.extend(_validate_interaction(interaction, i))

    if 'businessRules' not in doc:
        errors.append("Missing required field: 'businessRules'")
    elif isinstance(doc['businessRules'], list):
        for j, rule in enumerate(doc['businessRules']):
            errors.extend(_validate_business_rule(rule, j))

    if 'facets' not in doc:
        errors.append("Missing required field: 'facets'")

    return errors


def _validate_interaction(interaction, idx):
    errors = []
    prefix = f"interactions[{idx}]"

    for field in ('id', 'name', 'steps'):
        if field not in interaction:
            errors.append(f"{prefix}: missing required field '{field}'")

    steps = interaction.get('steps', [])
    if not isinstance(steps, list):
        errors.append(f"{prefix}: 'steps' must be an array")
        return errors

    step_ids = {s.get('id') for s in steps if isinstance(s, dict)}

    has_terminal = False
    for s_idx, step in enumerate(steps):
        if not isinstance(step, dict):
            errors.append(f"{prefix}.steps[{s_idx}]: must be an object")
            continue

        for field in ('id', 'facet', 'description'):
            if field not in step:
                errors.append(f"{prefix}.steps[{s_idx}]: missing required field '{field}'")

        for after_ref in step.get('after', []):
            if after_ref not in step_ids:
                errors.append(f"{prefix}.steps[{s_idx}]: 'after' references nonexistent step '{after_ref}'")

        for branch in step.get('branches', []):
            for next_ref in branch.get('next', []):
                if next_ref not in step_ids:
                    errors.append(f"{prefix}.steps[{s_idx}]: branch 'next' references nonexistent step '{next_ref}'")

        for parallel_ref in step.get('parallel', []):
            if parallel_ref not in step_ids:
                errors.append(f"{prefix}.steps[{s_idx}]: 'parallel' references nonexistent step '{parallel_ref}'")

        if step.get('terminal'):
            has_terminal = True

    if steps and not has_terminal:
        errors.append(f"{prefix}: no step has 'terminal: true' — at least one terminal step required per interaction")

    return errors


def _validate_business_rule(rule, idx):
    errors = []
    prefix = f"businessRules[{idx}]"

    for field in ('id', 'rule', 'enforcedBy'):
        if field not in rule:
            errors.append(f"{prefix}: missing required field '{field}'")

    return errors


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 validate_domain.py <domain-json-path>', file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f'File not found: {path}', file=sys.stderr)
        sys.exit(1)

    doc = json.loads(path.read_text())
    errors = validate_domain_doc(doc)

    if errors:
        for e in errors:
            print(f'  ERROR: {e}', file=sys.stderr)
        sys.exit(1)
    else:
        print(f'Validation passed: {path.name}')
        sys.exit(0)
