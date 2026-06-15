#!/usr/bin/env python3
"""Phase 4 adaptation: Build interaction skeletons for feature-centric flows.

For client×server scenarios, generates interaction documents organized by
business feature (client→sdk→server layers) rather than per-domain.

Usage:
    python3 build_feature_interactions.py <project-root>

Reads:
    business-landscape/business-features.json

Output:
    business-landscape/feature-interactions/feature-<slug>.json
"""
import json
import sys
from pathlib import Path


def build_interaction_skeleton(feature_doc: dict) -> dict:
    """Build a deterministic interaction skeleton from feature document.

    Layers follow the request flow: client → sdk/bridge → server
    """
    client_layer = feature_doc.get('clientLayer', {}) or {}
    server_layer = feature_doc.get('serverLayer', {}) or {}
    platforms = client_layer.get('platforms', {})
    if not isinstance(platforms, dict):
        platforms = {}

    layers = []
    involved_services = []

    # Layer 1: Client
    platform_names = list(platforms.keys())
    involved_services.extend(platform_names)
    layers.append({
        'name': 'client',
        'platforms': platform_names,
        'description': f'Client-side logic ({", ".join(platform_names)})',
    })

    # Layer 2: SDK/Bridge (if Flutter is involved)
    has_flutter = any('flutter' in p.lower() for p in platform_names)
    if has_flutter:
        layers.append({
            'name': 'sdk/bridge',
            'description': 'Cross-platform bridge layer (MethodChannel/FlutterBoost)',
        })

    # Layer 3: Server
    primary = server_layer.get('primaryDomain')
    supporting = server_layer.get('supportingDomains') or []

    if primary and isinstance(primary, dict):
        involved_services.append(primary.get('service', ''))
        for s in supporting:
            if isinstance(s, dict):
                svc = s.get('service', '')
                if svc and svc not in involved_services:
                    involved_services.append(svc)

        layers.append({
            'name': 'server',
            'primaryService': primary.get('service', ''),
            'primaryDomain': primary.get('name', ''),
            'supportingServices': [s.get('service', '') for s in supporting if isinstance(s, dict)],
            'description': f'Server-side processing ({primary.get("service", "")})',
        })

    return {
        'featureId': feature_doc.get('id', ''),
        'featureName': feature_doc.get('name', ''),
        'layers': layers,
        'involvedServices': [s for s in involved_services if s],
    }


def build_interaction_prompt(feature_doc: dict, skeleton: dict) -> str:
    """Build LLM prompt for generating interaction flow steps."""
    client = feature_doc.get('clientLayer', {})
    server = feature_doc.get('serverLayer', {})
    platforms = client.get('platforms', {})

    if not isinstance(platforms, dict):
        platforms = {}

    # Platform details
    platform_details = []
    for pname, pinfo in platforms.items():
        domain_name = pinfo.get('domainName', pname)
        summary = pinfo.get('summary', '')
        platform_details.append(f"  - {pname}: {domain_name} — {summary}")

    platform_block = '\n'.join(platform_details) if platform_details else '  (no details)'

    # Server details
    primary = server.get('primaryDomain')
    supporting = server.get('supportingDomains') or []
    server_block = ''
    if primary and isinstance(primary, dict):
        server_block = f"  主要后端: {primary.get('name', '?')} (service: {primary.get('service', '?')})\n"
        for s in supporting:
            if isinstance(s, dict):
                server_block += f"  辅助: {s.get('name', '?')} (service: {s.get('service', '?')}, relationship: {s.get('relationship', '?')})\n"

    layers_desc = '\n'.join(
        f"  {i+1}. {l['name']}: {l.get('description', '')}"
        for i, l in enumerate(skeleton['layers'])
    )

    return f"""为以下业务功能生成跨端交互流程文档:

功能名: {feature_doc.get('name', '')}
实现类型: {client.get('implType', 'unknown')}

客户端平台实现:
{platform_block}

服务端依赖:
{server_block}

交互层次:
{layers_desc}

请生成 JSON 格式的交互流程:
{{
  "id": "interaction:{feature_doc.get('name', '')}",
  "name": "{feature_doc.get('name', '')}",
  "flows": [
    {{
      "id": "flow:<slug>",
      "name": "<典型使用场景>",
      "trigger": "<用户触发动作>",
      "steps": [
        {{
          "id": "step:1",
          "layer": "client|sdk/bridge|server",
          "service": "<涉及的服务名>",
          "description": "<具体动作描述>",
          "after": [],
          "terminal": false,
          "platformNote": "<如有平台差异说明>"
        }}
      ]
    }}
  ]
}}

规则:
- steps 使用 DAG 结构，通过 after 字段引用前置步骤
- 最后一步必须标记 terminal: true
- 如果 iOS/Android 有不同实现路径，在 platformNote 中说明
- layer 对应交互层次中的层
- 至少包含 1 个核心流程，最多 3 个流程"""


def _to_slug(name: str) -> str:
    """Convert feature name to ASCII kebab-case slug."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\-]', '', re.sub(r'[\s_]+', '-', slug))
    slug = re.sub(r'-+', '-', slug).strip('-')
    if not slug:
        import hashlib
        slug = hashlib.md5(name.encode()).hexdigest()[:8]
    return slug


def run_build_interactions(project_root_str: str) -> dict:
    """Full pipeline: read features, build skeletons, write output."""
    project_root = Path(project_root_str)
    features_path = project_root / '.understand-anything' / 'business-landscape' / 'business-features.json'

    if not features_path.exists():
        return {'error': 'business-features.json not found. Run P2 first.'}

    try:
        data = json.loads(features_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse business-features.json: {e}'}

    output_dir = project_root / '.understand-anything' / 'business-landscape' / 'feature-interactions'
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for feature in data.get('features', []):
        skeleton = build_interaction_skeleton(feature)
        slug = _to_slug(feature.get('name', 'unknown'))
        output_file = output_dir / f'feature-{slug}.json'
        output_file.write_text(json.dumps({
            'skeleton': skeleton,
            'prompt': build_interaction_prompt(feature, skeleton),
            '_status': 'skeleton_ready',
        }, indent=2, ensure_ascii=False))
        results.append({'feature': skeleton['featureName'], 'file': str(output_file)})

    return {'generated': len(results), 'outputDir': str(output_dir), 'results': results}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 build_feature_interactions.py <project-root>', file=sys.stderr)
        sys.exit(1)

    result = run_build_interactions(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    print(f"Generated {result['generated']} interaction skeletons at {result['outputDir']}")
