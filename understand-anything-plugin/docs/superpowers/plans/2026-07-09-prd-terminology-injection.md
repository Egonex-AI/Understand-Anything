# PRD 术语库注入 domain-discoverer 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/understand-domain` 注入外部 PRD 术语库 md，使产出域名对齐 PRD 标准术语、跨服务命名一致，并通过认领证据防误认领。

**Architecture:** 在 understand-domain 的 Phase 0 加载术语库 md（路径存于 config.json 的 `businessTermsPath`，相对 config.json 自身位置解析），Phase 4a dispatch 时把 md 全量注入 domain-discoverer agent；agent 产出带 `matchedSubDomains`/`matchedTerms`/`evidence` 的 domain；audit_domain_discovery.py 新增 6 类 evidence warning。术语库是增强项，缺失即降级走原逻辑。

**Tech Stack:** Python 3（audit 脚本 + pytest 测试）、Node.js mjs（config-reader）、Markdown（SKILL.md / agent prompt）。

## Global Constraints

- 术语库是 **PRD + testcase 双源、LLM wiki 风格的 md**，位于 kb-amar 外部位置，是需求侧正交外部源（非 understand-anything 产物）。
- `businessTermsPath` 是**可选增强项**：有则用，无则降级走原逻辑，**不阻断主流程**，降级必须**响亮报错**（打印明确原因）。
- **表格层不程序解析**：程序只扫 `### ` 标题提取二级域清单；表格整份 md 原样注入 agent，agent 自己读。
- **不固定对齐层**：agent 按代码域实际范围选最贴近的术语（可二级域可条目），domain.name 优先用术语库中的业务术语，不用动词/流程类术语当域名。
- **type 字段不需要**：术语条目不设 type 字段。
- **evidence.keyNodes 填 keyNode 的 `id`**（KG 节点唯一标识），audit 比对 id 是否在 kg-summary 的 `keyNodes[].id` 集合内。（spec 原文写"路径"，实现澄清为 id——因为 kg-summary 的 keyNode 结构只有 `id`/`name`/`module`，无节点级 path 字段。）
- **测试归属**：python 测试（audit 逻辑）用 pytest 跑（`pytest.ini` 已存在，`addopts = --import-mode=importlib`）；mjs 测试（config-reader）用 vitest 跑（根 `pnpm test`）。spec 第 7 节原说"tests/skill/ 被根 vitest.config.ts 拾取"——对 mjs 对，对 .py 不对，本计划按语言分置。
- **外科手术式修改**：只动 spec 第 1 节列出的文件，不重构相邻代码，匹配现有风格。

## Spec 偏差说明（实现时发现，已在此澄清）

1. **config-reader.mjs 的字段过滤**：`readConfig` 用 `if (key in CONFIG_DEFAULTS)` 只认默认值里定义的字段。`businessTermsPath` 必须加进 `CONFIG_DEFAULTS`，否则被静默丢弃。spec 第 3 节未提及此实现约束，Task 1 处理。
2. **evidence.keyNodes 的"路径"语义**：spec 4.4/6.4 写"代码节点路径"，但 kg-summary 的 keyNode 无 path 字段，只有 `id`。实现用 `id` 作 keyNodes 值，audit 比对 id 集合。Task 4/5 落实。
3. **测试运行器**：spec 第 7 节暗示全走 vitest，实际 python 测试走 pytest。Task 6/7 分置。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `skills/shared/config-reader.mjs` | 读 config.json，返回合并配置 | 改：CONFIG_DEFAULTS 加 `businessTermsPath` |
| `skills/understand-domain/SKILL.md` | /understand-domain 流程定义 | 改：Phase 0 加载术语库；Phase 4a dispatch 注入 |
| `agents/domain-discoverer.md` | domain-discoverer agent prompt | 改：加术语库输入说明 + 认领规则 + evidence 输出 schema |
| `skills/understand-domain/audit_domain_discovery.py` | 审计 domain-discovery.json | 改：加 6 类 evidence warning + 二级域清单提取 + keyNode id 集合校验 |
| `tests/skill/shared/test_config_reader_business_terms.mjs` | 测 config-reader 读 businessTermsPath | 新增 |
| `tests/skill/understand-domain/test_audit_evidence.py` | 测 audit evidence 校验逻辑 | 新增 |
| `tests/skill/understand-domain/fixtures/business-terms-sample.md` | 小型术语库夹具 | 新增 |
| `tests/skill/understand-domain/fixtures/domain-discovery-sample.json` | 含 evidence 异常的 domain 夹具 | 新增 |
| `tests/skill/understand-domain/fixtures/kg-summary-sample.json` | 小型 kg-summary 夹具 | 新增 |

---

## Task 1: config-reader 支持 businessTermsPath

**Files:**
- Modify: `understand-anything-plugin/skills/shared/config-reader.mjs:4-11`
- Test: `tests/skill/shared/test_config_reader_business_terms.mjs`

**Interfaces:**
- Produces: `readConfig()` 返回的对象新增 `businessTermsPath: string`（默认 `''`，空串表示未配置）

- [ ] **Step 1: Write the failing test**

```javascript
// tests/skill/shared/test_config_reader_business_terms.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../../../understand-anything-plugin/skills/shared/config-reader.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-bt-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConfig businessTermsPath', () => {
  // 意图：businessTermsPath 是可选增强项，未配置时返回空串（走降级），不阻断。
  it('defaults to empty string when not configured', () => {
    const config = readConfig({ projectRoot: tmpDir });
    expect(config.businessTermsPath).toBe('');
  });

  // 意图：config-reader 的字段过滤 (key in CONFIG_DEFAULTS) 不能丢弃 businessTermsPath。
  // 若有人忘了把它加进 CONFIG_DEFAULTS，此测试失败——因为字段会被静默吞。
  it('reads businessTermsPath from Level 1 config', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ businessTermsPath: '../../terms.md' })
    );
    const config = readConfig({ projectRoot: tmpDir });
    expect(config.businessTermsPath).toBe('../../terms.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/skill/shared/test_config_reader_business_terms.mjs`
Expected: FAIL — "reads businessTermsPath from Level 1 config" 失败，`config.businessTermsPath` 为 `''`（因字段被 CONFIG_DEFAULTS 过滤丢弃）。

- [ ] **Step 3: Write minimal implementation**

在 `CONFIG_DEFAULTS` 加 `businessTermsPath: ''`：

```javascript
export const CONFIG_DEFAULTS = {
  outputLanguage: 'zh-CN',
  autoUpdate: false,
  excludeServices: [],
  rpcAnnotations: [],
  apiBaseUrl: '',
  protocolType: 'rest',
  businessTermsPath: '',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/skill/shared/test_config_reader_business_terms.mjs`
Expected: PASS — 两个用例都过。

- [ ] **Step 5: Run full config-reader test suite to confirm no regression**

Run: `pnpm test tests/skill/shared/config-reader.test.mjs`
Expected: PASS — 现有用例仍全过（加字段不影响）。

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/shared/config-reader.mjs tests/skill/shared/test_config_reader_business_terms.mjs
git commit -m "feat(domain): config-reader supports businessTermsPath field"
```

---

## Task 2: 二级域清单提取函数

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py`（新增模块级函数，不动现有 `audit_domain_discovery`）
- Test: `tests/skill/understand-domain/test_audit_evidence.py`
- Fixture: `tests/skill/understand-domain/fixtures/business-terms-sample.md`

**Interfaces:**
- Produces: `extract_subdomains(terms_md: str) -> set[str]` — 扫 md 的 `### ` 标题行，返回二级域名集合

- [ ] **Step 1: Create the fixture**

```markdown
# tests/skill/understand-domain/fixtures/business-terms-sample.md

## 关系社交

### 亲密关系

| 术语 | 一级域 | 二级域 | 含义 | 常见使用场景 | 来源 |
|------|--------|--------|------|--------------|------|
| 亲密度 | 关系社交 | 亲密关系 | 关系双方亲密数值 | 关系升级 | raw/prd/关系/亲密度.md |
| 关系等级 | 关系社交 | 亲密关系 | 关系阶段标识 | 解锁互动 | raw/prd/关系/等级.md |
| 亲密关系召回 | 关系社交 | 亲密关系 | 触发流失用户召回 | 召回流程 | raw/testcase/召回.md |

### 挚友关系

| 术语 | 一级域 | 二级域 | 含义 | 常见使用场景 | 来源 |
|------|--------|--------|------|--------------|------|
| 挚友值 | 关系社交 | 挚友关系 | 挚友互动数值 | 挚友升级 | raw/prd/挚友.md |

## 权益激励

### VIP体系

| 术语 | 一级域 | 二级域 | 含义 | 常见使用场景 | 来源 |
|------|--------|--------|------|--------------|------|
| VIP等级 | 权益激励 | VIP体系 | 用户尊享等级 | 权益解锁 | raw/prd/权益/vip.md |
| VIP体系 | 权益激励 | VIP体系 | 权益激励完整域 | 体系运作 | raw/prd/权益/体系.md |
```

- [ ] **Step 2: Write the failing test**

```python
# tests/skill/understand-domain/test_audit_evidence.py
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(PLUGIN))

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _read_fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


# 意图：二级域清单是 audit 程序校验的唯一锚点，提取必须稳，且只碰标题层不碰表格。
# 若提取逻辑误入表格（把表格里的"二级域"列值当标题），此测试会抓到重复/错值。
def test_extract_subdomains_returns_only_heading_level():
    from audit_domain_discovery import extract_subdomains
    md = _read_fixture("business-terms-sample.md")
    result = extract_subdomains(md)
    assert result == {"亲密关系", "挚友关系", "VIP体系"}


# 意图：无标题的 md 不崩，返回空集（audit 据此跳过 matchedSubDomains 校验）。
def test_extract_subdomains_empty_when_no_headings():
    from audit_domain_discovery import extract_subdomains
    md = "纯正文没有标题\n| 列1 | 列2 |\n|-----|------|\n| a | b |\n"
    assert extract_subdomains(md) == set()


# 意图：## 一级域标题不被误当二级域提取（只提取 ### 层）。
def test_extract_subdomains_ignores_level1_headings():
    from audit_domain_discovery import extract_subdomains
    md = "## 关系社交\n### 亲密关系\n## 权益激励\n### VIP体系\n"
    assert extract_subdomains(md) == {"亲密关系", "VIP体系"}
    assert "关系社交" not in extract_subdomains(md)
    assert "权益激励" not in extract_subdomains(md)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -v`
Expected: FAIL — `ImportError: cannot import name 'extract_subdomains'`（函数未定义）。

- [ ] **Step 4: Write minimal implementation**

在 `audit_domain_discovery.py` 顶部（`_VERB_PREFIXES` 定义之后、`_extract_entity_nouns` 之前）加：

```python
def extract_subdomains(terms_md: str) -> set[str]:
    """Extract second-level domain names from a terms markdown by scanning `### ` headings.

    Only the heading layer is parsed — table contents are never touched (table
    parsing is brittle; see spec §2 '分工'). The subdomain set is the program
    validation anchor for matchedSubDomains (spec §6.2).
    """
    subdomains: set[str] = set()
    for line in terms_md.splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            name = stripped[4:].strip()
            if name:
                subdomains.add(name)
    return subdomains
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py::test_extract_subdomains_returns_only_heading_level test_audit_evidence.py::test_extract_subdomains_empty_when_no_headings test_audit_evidence.py::test_extract_subdomains_ignores_level1_headings -v`
Expected: PASS — 三个用例都过。

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py tests/skill/understand-domain/test_audit_evidence.py tests/skill/understand-domain/fixtures/business-terms-sample.md
git commit -m "feat(domain): add extract_subdomains for terms markdown heading scan"
```

---

## Task 3: keyNode id 集合提取 + 动词词根表

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py`
- Test: `tests/skill/understand-domain/test_audit_evidence.py`

**Interfaces:**
- Produces: `extract_keynode_ids(summary: dict) -> set[str]` — 从 kg-summary 的 keyNodes[].id 提取 id 集合
- Produces: `is_verb_like_name(name: str) -> bool` — domain.name 命中动作词根返回 True

- [ ] **Step 1: Write the failing test**

追加到 `tests/skill/understand-domain/test_audit_evidence.py`：

```python
# 意图：keyNode id 集合是 evidence.keyNodes 校验锚点。kg-summary 的 keyNode 只有 id/name/module，
# 无节点级 path（spec 偏差说明 #2），故用 id。
def test_extract_keynode_ids_returns_id_set():
    from audit_domain_discovery import extract_keynode_ids
    summary = {
        "keyNodes": [
            {"id": "function:src/order/calc.py::score", "name": "score", "module": "src/order"},
            {"id": "class:src/order/Repo.py", "name": "Repo", "module": "src/order"},
        ]
    }
    assert extract_keynode_ids(summary) == {"function:src/order/calc.py::score", "class:src/order/Repo.py"}


def test_extract_keynode_ids_empty_when_no_keynodes():
    from audit_domain_discovery import extract_keynode_ids
    assert extract_keynode_ids({}) == set()
    assert extract_keynode_ids({"keyNodes": []}) == set()


# 意图：domain.name 不该是动词/动作（动作不是域）。词根表不追求完备，只兜底明显误用。
def test_is_verb_like_name_catches_obvious_verbs():
    from audit_domain_discovery import is_verb_like_name
    assert is_verb_like_name("亲密关系召回") is True
    assert is_verb_like_name("关系升级") is True
    assert is_verb_like_name("触发奖励") is True


def test_is_verb_like_name_passes_noun_domains():
    from audit_domain_discovery import is_verb_like_name
    assert is_verb_like_name("亲密关系") is False
    assert is_verb_like_name("VIP体系") is False
    assert is_verb_like_name("亲密度") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -k "keynode_ids or verb_like" -v`
Expected: FAIL — `ImportError` for `extract_keynode_ids` and `is_verb_like_name`。

- [ ] **Step 3: Write minimal implementation**

在 `audit_domain_discovery.py` 的 `extract_subdomains` 之后加：

```python
# 动作词根表（spec §6.2）——不追求完备，只兜底明显误用。domain.name 命中即 warning。
_DOMAIN_VERB_ROOTS = frozenset({
    "召回", "升级", "触发", "计算", "提交", "查询", "下发", "推送",
    "创建", "更新", "删除", "发送", "接收", "处理", "校验", "刷新",
})


def extract_keynode_ids(summary: dict[str, Any]) -> set[str]:
    """Extract the set of keyNode ids from a kg-summary.

    evidence.keyNodes hold keyNode ids (not paths — kg-summary keyNodes have no
    node-level path field, only id/name/module; see spec 偏差说明 #2). This set
    is the validation anchor for keyNodes existence (spec §6.4).
    """
    return {kn["id"] for kn in summary.get("keyNodes", []) if "id" in kn}


def is_verb_like_name(name: str) -> bool:
    """Heuristic: does domain.name look like a verb/action rather than a domain?

    Catches obvious misuses (domain.name should not be an action). Not exhaustive
    (spec §6.2, §9 known limitation) — soft guard, human reviews reason field.
    """
    return any(root in name for root in _DOMAIN_VERB_ROOTS)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -k "keynode_ids or verb_like" -v`
Expected: PASS — 四个用例都过。

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py tests/skill/understand-domain/test_audit_evidence.py
git commit -m "feat(domain): add keynode id extraction + verb-like name heuristic"
```

---

## Task 4: evidence 校验逻辑（6 类 warning）

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py:46-128`（`audit_domain_discovery` 函数体）
- Test: `tests/skill/understand-domain/test_audit_evidence.py`
- Fixtures: `tests/skill/understand-domain/fixtures/domain-discovery-sample.json`, `tests/skill/understand-domain/fixtures/kg-summary-sample.json`

**Interfaces:**
- Consumes: `extract_subdomains`, `extract_keynode_ids`, `is_verb_like_name`（Task 2/3 产出）
- Modifies: `audit_domain_discovery(discovery, summary, terms_md=None)` — 新增可选第三参数 `terms_md`；返回的 warnings 追加 6 类 evidence warning；`shouldRefine` 判定纳入新 warning

- [ ] **Step 1: Create the fixtures**

```json
// tests/skill/understand-domain/fixtures/kg-summary-sample.json
{
  "project": {"name": "test-svc"},
  "stats": {"totalNodes": 2, "totalEdges": 0},
  "modules": [
    {"path": "src/intimacy", "nodeCount": 1, "typeBreakdown": {}, "tags": ["intimacy"], "summaries": [], "files": []}
  ],
  "keyNodes": [
    {"id": "function:src/intimacy/calc.py::score", "name": "score", "summary": "", "tags": [], "module": "src/intimacy"}
  ],
  "crossModuleEdges": [],
  "layers": []
}
```

```json
// tests/skill/understand-domain/fixtures/domain-discovery-sample.json
{
  "domains": [
    {
      "id": "domain:intimacy",
      "name": "亲密关系",
      "summary": "...",
      "tags": ["intimacy"],
      "modules": ["src/intimacy"],
      "matchedSubDomains": ["亲密关系"],
      "matchedTerms": ["亲密度", "关系等级"],
      "evidence": {
        "keyNodes": ["function:src/intimacy/calc.py::score"],
        "modules": ["intimacy-core"],
        "reason": "亲密度计算模块对应二级域亲密关系"
      }
    },
    {
      "id": "domain:fabricated",
      "name": "关系召回",
      "summary": "...",
      "tags": [],
      "modules": [],
      "matchedSubDomains": ["不存在的二级域"],
      "matchedTerms": [],
      "evidence": {
        "keyNodes": ["function:made/up.py::fake"],
        "modules": [],
        "reason": ""
      }
    },
    {
      "id": "domain:unknown",
      "name": "神秘域",
      "summary": "...",
      "tags": [],
      "modules": []
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

追加到 `tests/skill/understand-domain/test_audit_evidence.py`：

```python
import json


def _load_json_fixture(name):
    return json.loads(_read_fixture(name))


# 意图：6 类 evidence warning 各自被抓到（matched_subdomains_invalid /
# matched_subdomains_empty_no_reason / matched_terms_empty / key_nodes_not_in_kg /
# domain_name_verb_like / evidence_missing）。若任一类被移除，认领质量失去兜底。
def test_audit_evidence_warnings():
    from audit_domain_discovery import audit_domain_discovery
    discovery = _load_json_fixture("domain-discovery-sample.json")
    summary = _load_json_fixture("kg-summary-sample.json")
    terms_md = _read_fixture("business-terms-sample.md")

    result = audit_domain_discovery(discovery, summary, terms_md)
    warning_types = {w["type"] for w in result["warnings"]}

    # domain:fabricated 触发：matched_subdomains_invalid（"不存在的二级域"不在清单）
    assert "matched_subdomains_invalid" in warning_types
    # domain:fabricated 触发：matched_subdomains_empty_no_reason（reason 空）—— 但此 domain
    # matchedSubDomains 非空，故不触发此项；改由 domain:unknown 触发（见下）。
    # domain:unknown 触发：matched_subdomains_empty_no_reason（matchedSubDomains 缺失=空 + 无 evidence.reason）
    assert "matched_subdomains_empty_no_reason" in warning_types
    # domain:fabricated 触发：matched_terms_empty（matchedTerms 空 + matchedSubDomains 非空，不防双重惩戒）
    assert "matched_terms_empty" in warning_types
    # domain:fabricated 触发：key_nodes_not_in_kg（"function:made/up.py::fake" 不在 keyNode id 集合）
    assert "key_nodes_not_in_kg" in warning_types
    # domain:fabricated 触发：domain_name_verb_like（"关系召回" 命中"召回"词根）
    assert "domain_name_verb_like" in warning_types
    # domain:unknown 触发：evidence_missing（整个 evidence 对象缺失）
    assert "evidence_missing" in warning_types

    assert result["shouldRefine"] is True


# 意图：防双重惩戒——matchedSubDomains 留空（无 PRD 对应）时不再判 matched_terms_empty。
# domain:unknown 的 matchedSubDomains 缺失（空），matchedTerms 也缺失（空），但只应报
# matched_subdomains_empty_no_reason + evidence_missing，不报 matched_terms_empty。
def test_audit_no_double_penalty_for_empty_attribution():
    from audit_domain_discovery import audit_domain_discovery
    discovery = _load_json_fixture("domain-discovery-sample.json")
    summary = _load_json_fixture("kg-summary-sample.json")
    terms_md = _read_fixture("business-terms-sample.md")

    result = audit_domain_discovery(discovery, summary, terms_md)
    unknown_warnings = [w for w in result["warnings"] if w["domain"] == "domain:unknown"]
    types_for_unknown = {w["type"] for w in unknown_warnings}

    assert "matched_terms_empty" not in types_for_unknown
    assert "matched_subdomains_empty_no_reason" in types_for_unknown


# 意图：terms_md=None（降级场景）时跳过 matchedSubDomains 校验不崩（spec §6.2/T10）。
def test_audit_no_terms_md_skips_subdomain_validation():
    from audit_domain_discovery import audit_domain_discovery
    discovery = _load_json_fixture("domain-discovery-sample.json")
    summary = _load_json_fixture("kg-summary-sample.json")

    result = audit_domain_discovery(discovery, summary, terms_md=None)
    warning_types = {w["type"] for w in result["warnings"]}

    # 降级：不报 matched_subdomains_invalid（无清单可比）
    assert "matched_subdomains_invalid" not in warning_types
    # 但 key_nodes_not_in_kg / domain_name_verb_like / evidence_missing 仍报（不依赖术语库）
    assert "key_nodes_not_in_kg" in warning_types
    assert "domain_name_verb_like" in warning_types


# 意图：keyNodes 全 not_in_kg 时额外提示格式可能不匹配（spec §6.4/T11），
# 区分"agent 编造路径"与"格式不匹配"。
def test_audit_keynodes_format_mismatch_hint():
    from audit_domain_discovery import audit_domain_discovery
    discovery = _load_json_fixture("domain-discovery-sample.json")
    summary = _load_json_fixture("kg-summary-sample.json")
    terms_md = _read_fixture("business-terms-sample.md")

    result = audit_domain_discovery(discovery, summary, terms_md)
    fabricated_warnings = [w for w in result["warnings"]
                           if w["domain"] == "domain:fabricated" and w["type"] == "key_nodes_not_in_kg"]
    assert len(fabricated_warnings) == 1
    # domain:fabricated 的 keyNodes 全部不在 KG（1/1 都不在），应带格式提示
    assert fabricated_warnings[0].get("possibleFormatMismatch") is True
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -k "evidence_warnings or double_penalty or no_terms or format_mismatch" -v`
Expected: FAIL — `audit_domain_discovery` 只接受 2 参数，传 3 个报 `TypeError`，且无 evidence warning 产出。

- [ ] **Step 4: Write minimal implementation**

修改 `audit_domain_discovery` 函数签名和函数体。**保留现有 entity_diversity/tag_divergence 逻辑不动**，在它们之后、`should_refine` 计算之前插入 evidence 校验。

将 `audit_domain_discovery.py:46-128` 的函数改为：

```python
def audit_domain_discovery(
    discovery: dict[str, Any],
    summary: dict[str, Any],
    terms_md: str | None = None,
) -> dict[str, Any]:
    """Audit domain discovery for potential over-merging + evidence validity.

    Args:
        discovery: domain-discovery.json content
        summary: kg-summary.json content
        terms_md: optional terms markdown text. When None (degraded path),
            subdomain-validation warnings are skipped (spec §6.2).
    """
    warnings: list[dict] = []
    domains = discovery.get("domains", [])
    modules = summary.get("modules", [])
    key_nodes = summary.get("keyNodes", [])

    # ── existing entity_diversity + tag_divergence checks (unchanged) ──────
    # Build module -> keyNodes mapping
    mod_keynodes: dict[str, list[dict]] = defaultdict(list)
    for kn in key_nodes:
        mod_keynodes[kn["module"]].append(kn)

    for domain in domains:
        domain_id = domain["id"]
        domain_modules = domain.get("modules", [])

        all_nouns: set[str] = set()
        noun_to_modules: dict[str, set[str]] = defaultdict(set)

        for mod_path in domain_modules:
            for kn in mod_keynodes.get(mod_path, []):
                nouns = _extract_entity_nouns([kn["name"]])
                all_nouns.update(nouns)
                for noun in nouns:
                    noun_to_modules[noun].add(mod_path)

        if len(all_nouns) >= MIN_ENTITY_NOUNS_FOR_SPLIT:
            warnings.append({
                "type": "entity_diversity",
                "domain": domain_id,
                "message": (
                    f"Domain '{domain_id}' contains {len(all_nouns)} distinct "
                    f"entity nouns: {sorted(all_nouns)}. Consider splitting."
                ),
                "entityNouns": sorted(all_nouns),
                "modulesByEntity": {n: sorted(m) for n, m in noun_to_modules.items()},
            })

    for domain in domains:
        domain_id = domain["id"]
        domain_modules = domain.get("modules", [])
        mod_tags: dict[str, set[str]] = {}

        for mod_path in domain_modules:
            mod_data = next((m for m in modules if m["path"] == mod_path), None)
            if mod_data:
                mod_tags[mod_path] = set(mod_data.get("tags", []))

        paths = list(mod_tags.keys())
        for i in range(len(paths)):
            for j in range(i + 1, len(paths)):
                overlap = _tag_overlap(mod_tags[paths[i]], mod_tags[paths[j]])
                if 0 < overlap < TAG_OVERLAP_SPLIT_THRESHOLD:
                    warnings.append({
                        "type": "tag_divergence",
                        "domain": domain_id,
                        "message": (
                            f"Modules '{paths[i]}' and '{paths[j]}' in "
                            f"'{domain_id}' have low tag overlap ({overlap:.0%}). "
                            f"May be separate domains."
                        ),
                        "moduleA": paths[i],
                        "moduleB": paths[j],
                        "overlap": round(overlap, 3),
                    })

    # ── evidence checks (new, spec §6.1) ───────────────────────────────────
    # NOTE on validation-capability asymmetry (spec §6.3): matchedSubDomains
    # can be validated for existence (headings are stable); matchedTerms only
    # for non-emptiness (tables are brittle, not parsed). This is intentional.
    subdomain_set = extract_subdomains(terms_md) if terms_md else None
    keynode_id_set = extract_keynode_ids(summary)

    for domain in domains:
        domain_id = domain["id"]
        name = domain.get("name", "")
        matched_sub = domain.get("matchedSubDomains", [])
        matched_terms = domain.get("matchedTerms", [])
        evidence = domain.get("evidence")

        # evidence_missing: 整个 evidence 对象缺失
        if evidence is None:
            warnings.append({
                "type": "evidence_missing",
                "domain": domain_id,
                "message": f"Domain '{domain_id}' has no evidence object.",
            })
            # 无 evidence 时后续字段校验无意义，跳过本 domain 的剩余 evidence 检查
            continue

        reason = evidence.get("reason", "")
        key_nodes_claimed = evidence.get("keyNodes", [])

        # matched_subdomains_empty_no_reason: 留空但 reason 未说明
        if (not matched_sub) and not reason:
            warnings.append({
                "type": "matched_subdomains_empty_no_reason",
                "domain": domain_id,
                "message": (
                    f"Domain '{domain_id}' has empty matchedSubDomains but "
                    f"evidence.reason does not explain the absence."
                ),
            })

        # 防双重惩戒 (spec §6.5): matchedSubDomains 留空时不判 matched_terms_empty
        if matched_sub and not matched_terms:
            warnings.append({
                "type": "matched_terms_empty",
                "domain": domain_id,
                "message": (
                    f"Domain '{domain_id}' has matchedSubDomains but empty "
                    f"matchedTerms — possible missed recognition."
                ),
            })

        # matched_subdomains_invalid: 含清单外的名（仅 terms_md 存在时校验）
        if subdomain_set is not None:
            invalid = [s for s in matched_sub if s not in subdomain_set]
            if invalid:
                warnings.append({
                    "type": "matched_subdomains_invalid",
                    "domain": domain_id,
                    "message": (
                        f"Domain '{domain_id}' matchedSubDomains not in terms "
                        f"glossary: {invalid}."
                    ),
                    "invalid": invalid,
                })

        # key_nodes_not_in_kg: 路径在 KG 不存在
        if key_nodes_claimed:
            not_in_kg = [k for k in key_nodes_claimed if k not in keynode_id_set]
            if not_in_kg:
                all_mismatched = (len(not_in_kg) == len(key_nodes_claimed))
                warnings.append({
                    "type": "key_nodes_not_in_kg",
                    "domain": domain_id,
                    "message": (
                        f"Domain '{domain_id}' evidence.keyNodes not in KG: {not_in_kg}."
                        + (" All keyNodes missing — possible format mismatch, check agent prompt contract."
                           if all_mismatched else "")
                    ),
                    "notInKg": not_in_kg,
                    "possibleFormatMismatch": all_mismatched,
                })

        # domain_name_verb_like: domain.name 疑似动词
        if name and is_verb_like_name(name):
            warnings.append({
                "type": "domain_name_verb_like",
                "domain": domain_id,
                "message": (
                    f"Domain '{domain_id}' name '{name}' looks like a verb/action, "
                    f"not a domain. Review."
                ),
            })

    should_refine = any(
        w["type"] in ("entity_diversity", "tag_divergence",
                      "evidence_missing", "matched_subdomains_empty_no_reason",
                      "matched_terms_empty", "matched_subdomains_invalid",
                      "key_nodes_not_in_kg", "domain_name_verb_like")
        for w in warnings
    )

    return {
        "warnings": warnings,
        "shouldRefine": should_refine,
        "summary": (
            f"Found {len(warnings)} warning(s). "
            f"Refinement {'recommended' if should_refine else 'not needed'}."
        ),
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -k "evidence_warnings or double_penalty or no_terms or format_mismatch" -v`
Expected: PASS — 四个用例都过。

- [ ] **Step 6: Run full audit test file to confirm earlier tests still pass**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -v`
Expected: PASS — Task 2/3 的用例仍全过（签名向后兼容，第三参数有默认值）。

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py tests/skill/understand-domain/test_audit_evidence.py tests/skill/understand-domain/fixtures/domain-discovery-sample.json tests/skill/understand-domain/fixtures/kg-summary-sample.json
git commit -m "feat(domain): audit evidence validation (6 warning types)"
```

---

## Task 5: audit main 读术语库 md 并传入

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py:131-163`（`main` 函数）

**Interfaces:**
- Consumes: `audit_domain_discovery(discovery, summary, terms_md)` 第三参数（Task 4 产出）
- Produces: `main()` 从 config.json 读 `businessTermsPath`，相对 config.json 位置解析，读 md 传入；读不到则 `terms_md=None`（降级，响亮报错）

- [ ] **Step 1: Write the failing test**

这个任务是 `main()` 的 IO 编排（读 config + 读 md + 调函数 + 写输出），纯函数测不了，改测 main 的端到端行为：用临时目录构造 config.json + 术语库 md + domain-discovery.json + kg-summary.json，跑 main，检查 domain-audit.json 输出含 evidence warning。

追加到 `tests/skill/understand-domain/test_audit_evidence.py`：

```python
import tempfile
import unittest


def _write_tree(root, files: dict):
    """Write {relpath: content} into root dir."""
    from pathlib import Path
    for rel, content in files.items():
        p = Path(root) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")


# 意图：main() 必须从 config.json 读 businessTermsPath，相对 config.json 位置解析术语库 md，
# 传给 audit 函数。这是 Phase 0 加载流程在 audit 侧的等价（audit 独立跑时也要拿到术语库）。
# 若 main 不读 config 或路径解析基准错，evidence warning 不会产出（降级）。
class TestAuditMainTermsLoading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ua-audit-main-")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_main_loads_terms_md_from_config(self):
        import audit_domain_discovery as mod
        inter = "src/svc/.understand-anything/intermediate"
        _write_tree(self.tmp, {
            # config.json 在 .understand-anything/ 下
            "src/svc/.understand-anything/config.json": json.dumps({
                "businessTermsPath": "../../../terms.md"
            }, ensure_ascii=False),
            # 术语库在 config.json 上溯三级（.understand-anything → svc → src → tmp）
            "terms.md": "## 关系社交\n### 亲密关系\n| 术语 | 含义 |\n|---|---|\n| 亲密度 | 数值 |\n",
            f"{inter}/domain-discovery.json": json.dumps({
                "domains": [{
                    "id": "domain:intimacy", "name": "关系召回",
                    "modules": [], "matchedSubDomains": ["不存在的"],
                    "matchedTerms": [], "evidence": {"keyNodes": [], "modules": [], "reason": ""}
                }]
            }, ensure_ascii=False),
            f"{inter}/kg-summary.json": json.dumps({"keyNodes": [], "modules": []}),
        })
        project_root = f"{self.tmp}/src/svc"

        rc = mod.main(project_root)

        self.assertEqual(rc, 0)
        audit_out = json.loads(
            (Path(self.tmp) / "src/svc/.understand-anything/intermediate/domain-audit.json")
            .read_text(encoding="utf-8")
        )
        types = {w["type"] for w in audit_out["warnings"]}
        # 术语库加载成功 → matched_subdomains_invalid 触发（"不存在的"不在清单）
        self.assertIn("matched_subdomains_invalid", types)
        self.assertIn("domain_name_verb_like", types)  # "关系召回"

    # 意图：businessTermsPath 缺失时 main 不崩，terms_md=None 降级，不报 subdomain 类 warning。
    def test_main_degrades_when_no_business_terms_path(self):
        import audit_domain_discovery as mod
        inter = "src/svc2/.understand-anything/intermediate"
        _write_tree(self.tmp, {
            "src/svc2/.understand-anything/config.json": json.dumps({}),
            f"{inter}/domain-discovery.json": json.dumps({
                "domains": [{"id": "domain:x", "name": "关系召回", "modules": [],
                             "matchedSubDomains": ["不存在的"], "matchedTerms": [],
                             "evidence": {"keyNodes": [], "modules": [], "reason": ""}}]
            }, ensure_ascii=False),
            f"{inter}/kg-summary.json": json.dumps({"keyNodes": [], "modules": []}),
        })
        project_root = f"{self.tmp}/src/svc2"

        rc = mod.main(project_root)
        self.assertEqual(rc, 0)
        audit_out = json.loads(
            (Path(self.tmp) / "src/svc2/.understand-anything/intermediate/domain-audit.json")
            .read_text(encoding="utf-8")
        )
        types = {w["type"] for w in audit_out["warnings"]}
        # 降级：无 subdomain 校验
        self.assertNotIn("matched_subdomains_invalid", types)
        # 但 verb_like 仍报（不依赖术语库）
        self.assertIn("domain_name_verb_like", types)

    # 意图：businessTermsPath 配了但文件不存在 → 响亮报错（stderr）+ 降级。
    def test_main_degrades_loudly_when_terms_file_missing(self):
        import audit_domain_discovery as mod
        import io
        import contextlib
        inter = "src/svc3/.understand-anything/intermediate"
        _write_tree(self.tmp, {
            "src/svc3/.understand-anything/config.json": json.dumps({
                "businessTermsPath": "../../../no-such.md"
            }),
            f"{inter}/domain-discovery.json": json.dumps({
                "domains": [{"id": "domain:x", "name": "VIP体系", "modules": [],
                             "matchedSubDomains": [], "matchedTerms": [],
                             "evidence": {"keyNodes": [], "modules": [], "reason": "无对应"}}]
            }, ensure_ascii=False),
            f"{inter}/kg-summary.json": json.dumps({"keyNodes": [], "modules": []}),
        })
        project_root = f"{self.tmp}/src/svc3"

        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = mod.main(project_root)
        self.assertEqual(rc, 0)
        self.assertIn("businessTermsPath", err.getvalue())  # 响亮报错含路径信息
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py::TestAuditMainTermsLoading -v`
Expected: FAIL — `main()` 当前不读 config.json，`matched_subdomains_invalid` 不产出（terms_md=None 降级）。

- [ ] **Step 3: Write minimal implementation**

替换 `audit_domain_discovery.py` 的 `main` 函数（原 131-163 行）为：

```python
def _load_terms_md(project_root: Path) -> str | None:
    """Load terms glossary markdown for evidence validation.

    Path is read from config.json's businessTermsPath, resolved relative to
    config.json's own location (spec §3). Returns None (degraded) when:
    - field missing (silent, normal)
    - file not found (loud error)
    Never raises — degradation must not block the main flow (spec §3 降级语义).
    """
    config_path = project_root / ".understand-anything" / "config.json"
    if not config_path.exists():
        return None
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    rel = config.get("businessTermsPath", "")
    if not rel:
        return None  # field missing → silent degradation

    terms_path = (config_path.parent / rel).resolve()
    if not terms_path.exists():
        print(
            f"[audit-domain] businessTermsPath configured but file not found: "
            f"{terms_path}. Degraded — skipping subdomain validation.",
            file=sys.stderr,
        )
        return None  # loud degradation

    return terms_path.read_text(encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python audit_domain_discovery.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    inter_dir = project_root / ".understand-anything" / "intermediate"

    discovery_path = inter_dir / "domain-discovery.json"
    summary_path = inter_dir / "kg-summary.json"

    if not discovery_path.exists():
        print(f"[audit-domain] Discovery not found: {discovery_path}", file=sys.stderr)
        return 1
    if not summary_path.exists():
        print(f"[audit-domain] Summary not found: {summary_path}", file=sys.stderr)
        return 1

    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    terms_md = _load_terms_md(project_root)

    result = audit_domain_discovery(discovery, summary, terms_md)

    out_path = inter_dir / "domain-audit.json"
    out_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"[audit-domain] {result['summary']}", file=sys.stderr)
    for w in result["warnings"]:
        print(f"[audit-domain]   ⚠ {w['type']}: {w['message']}", file=sys.stderr)

    return 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py::TestAuditMainTermsLoading -v`
Expected: PASS — 三个用例都过。

- [ ] **Step 5: Run full audit test suite**

Run: `cd tests/skill/understand-domain && python -m pytest test_audit_evidence.py -v`
Expected: PASS — 全部用例过。

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py tests/skill/understand-domain/test_audit_evidence.py
git commit -m "feat(domain): audit main loads terms md from config (degrades gracefully)"
```

---

## Task 6: domain-discoverer.md 加术语库输入 + 认领规则 + evidence schema

**Files:**
- Modify: `understand-anything-plugin/agents/domain-discoverer.md:12-19`（Input 段）+ `:57-77`（Output Schema 段）+ 新增认领规则段

**Interfaces:**
- Consumes: 术语库 md 文本（由 SKILL.md Phase 4a dispatch 时注入，Task 7 落实）
- Produces: domain 对象新增 `matchedSubDomains[]`/`matchedTerms[]`/`evidence{keyNodes,modules,reason}` 字段（audit Task 4 校验）

- [ ] **Step 1: Read current agent file to confirm edit anchors**

Run: `cat understand-anything-plugin/agents/domain-discoverer.md`
确认 Input 段在 12-19 行，Output Schema 在 57-77 行，Constraints 在 88-94 行。

- [ ] **Step 2: Modify Input section**

将 `## Input` 段（12-19 行）替换为：

```markdown
## Input

You will receive a `kg-summary.json` containing:
- **modules**: Module-level aggregations with node counts, tags, summaries, and file lists
- **keyNodes**: Important nodes (endpoints, services, pipelines) with full details (id, name, module)
- **crossModuleEdges**: Relationships between modules with types and sample descriptions
- **layers**: Architectural layer assignments
- **project**: Project metadata

**Optional — Business Terms Glossary (PRD terminology).** If provided, you will also receive the raw markdown of an external PRD business terms glossary. Structure:
- `## 一级域` headings (top-level domain, navigation only — not the alignment unit)
- `### 二级域` headings (sub-domain — the attribution guardrail layer)
- a terms table under each sub-domain (term / definition / usage / source — you read this, no program parses it)

The glossary is the authoritative business view for naming alignment. Code (kg-summary) remains the source of truth for domain boundaries — the glossary does not force domain boundaries, only aligns names and records attribution.
```

- [ ] **Step 3: Add recognition rules section**

在 `## Rules` 段末尾（Rule 12 之后，`## Split/Merge Decision Process` 之前）加：

```markdown
13. **Terms glossary alignment (when glossary provided).** When a PRD terms glossary is injected, align domain naming to it:
    - **Code is authoritative for boundaries**: domain partitioning still comes from kg-summary code clustering. The glossary does NOT force you to invent domains that the code doesn't support.
    - **No fixed alignment layer**: choose the layer (sub-domain `###` heading or individual term) that best matches the actual scope of the code domain. A large code domain covering most terms under a sub-domain → align to the sub-domain name. A small code domain covering one or two terms → align to the term name.
    - **domain.name priority**: prefer business terminology from the glossary over generic names. Do NOT use verb/action terms (e.g. "亲密关系召回") as domain.name — those are actions, not domains.
    - **Sparse recognition**: the glossary may contain concepts the current service doesn't implement. Recognize only what the code actually implements; do not force-fit.
    - **No-claim also recorded**: if a code domain has no glossary correspondence, still name it by code semantics, leave `matchedSubDomains` empty, and explain in `evidence.reason` ("glossary has no correspondence, named by code semantics").
    - **Anti-PRD-pollution**: the glossary is for naming alignment and attribution annotation ONLY. Do NOT conjure a domain just to match a glossary concept when the code has only scattered, sub-domain-level implementation under it. Such scattered implementation may be noted in an adjacent domain's `evidence.reason` but does not form its own domain.
```

- [ ] **Step 4: Modify Output Schema**

将 `## Output Schema` 的 JSON（61-76 行）替换为（新增 matchedSubDomains/matchedTerms/evidence）：

```markdown
```json
{
  "domains": [
    {
      "id": "domain:<kebab-case-name>",
      "name": "<Human Readable Domain Name — prefer glossary business terminology>",
      "summary": "<2-3 sentences about what this domain handles>",
      "tags": ["<relevant-tags>"],
      "entities": ["<key domain objects>"],
      "businessRules": ["<important constraints/invariants>"],
      "crossDomainInteractions": ["<how this domain interacts with others>"],
      "modules": ["src/order", "src/cart"],
      "nodePatterns": ["Order", "Cart"],
      "matchedSubDomains": ["<glossary sub-domain names this domain belongs to>"],
      "matchedTerms": ["<glossary term names this domain claims>"],
      "evidence": {
        "keyNodes": ["<keyNode id from kg-summary, verbatim — supports the claim>"],
        "modules": ["<module names supporting the claim>"],
        "reason": "<natural-language reasoning: why this code domain maps to these glossary terms / sub-domains; or why glossary has no correspondence>"
      }
    }
  ]
}
```

### `matchedSubDomains` / `matchedTerms` / `evidence` fields (when glossary provided)

Every domain MUST carry these fields (uniform structure — including domains with no glossary match, where `matchedSubDomains` and `matchedTerms` are empty arrays and `evidence.reason` explains the absence). The audit script validates them:

- `matchedSubDomains[]` — sub-domain names (from `###` headings) this domain belongs to. Audit checks these are in the glossary's sub-domain set.
- `matchedTerms[]` — individual term names (from the terms table) this domain claims. Audit checks non-empty (when matchedSubDomains is non-empty).
- `evidence.keyNodes[]` — **keyNode `id` values from kg-summary, verbatim** (not paths — kg-summary keyNodes have `id`/`name`/`module`, no node-level path). Audit checks these ids exist in kg-summary's keyNodes.
- `evidence.modules[]` — module names supporting the claim. Audit checks non-empty.
- `evidence.reason` — natural-language recognition reasoning. Audit checks non-empty; correctness is human-reviewed.

When the glossary is NOT provided (degraded path), these fields are omitted — the audit skips evidence validation.
```

- [ ] **Step 5: Verify the file parses and field names match audit**

Run: `grep -n "matchedSubDomains\|matchedTerms\|evidence" understand-anything-plugin/agents/domain-discoverer.md`
Expected: 字段名出现在 Output Schema 段，与 audit_domain_discovery.py 的 `domain.get("matchedSubDomains"/"matchedTerms"/"evidence")` 一致。

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/agents/domain-discoverer.md
git commit -m "feat(domain): domain-discoverer agent accepts terms glossary + emits evidence"
```

---

## Task 7: SKILL.md Phase 0 加载 + Phase 4a 注入

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/SKILL.md`（Phase 0 加术语库加载段；Phase 4a dispatch 注入）

**Interfaces:**
- Consumes: config-reader `readConfig` 的 `businessTermsPath`（Task 1）+ domain-discoverer.md 的术语库输入约定（Task 6）
- Produces: Phase 0 产 `$TERMS_MD`（md 字符串或空）；Phase 4a dispatch 时把它拼进 agent prompt

- [ ] **Step 1: Read current SKILL.md to confirm Phase 0 and 4a anchors**

确认 Phase 0 在 50-118 行（PROJECT_ROOT + plugin root 解析），Phase 4a 在 207-218 行。

- [ ] **Step 2: Add terms loading to Phase 0**

在 Phase 0 的 plugin root 解析块之后（118 行 `Use $PLUGIN_ROOT...` 之后，`### Phase 1` 之前）插入新段：

```markdown
**Load business terms glossary (optional).** Read `businessTermsPath` from `$PROJECT_ROOT/.understand-anything/config.json` and load the terms markdown for injection into domain-discoverer (spec §3).

```bash
TERMS_MD=""
CONFIG_FILE="$PROJECT_ROOT/.understand-anything/config.json"
if [ -f "$CONFIG_FILE" ]; then
  REL_PATH=$(python3 -c "
import json, sys
try:
    c = json.load(open('$CONFIG_FILE', encoding='utf-8'))
    print(c.get('businessTermsPath', ''))
except Exception:
    print('')
")
  if [ -n "$REL_PATH" ]; then
    TERMS_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$REL_PATH"
    if [ -f "$TERMS_FILE" ]; then
      TERMS_MD=$(cat "$TERMS_FILE")
      echo "[understand-domain] Loaded business terms glossary: $TERMS_FILE"
    else
      echo "[understand-domain] businessTermsPath configured but file not found: $TERMS_FILE. Degraded — no glossary injection." >&2
    fi
  fi
fi
```

`$TERMS_MD` is empty when: field missing (silent), file not found (loud error to stderr), or config unreadable. Empty → domain-discoverer runs without glossary (original logic, spec §3 降级语义).
```

- [ ] **Step 3: Modify Phase 4a dispatch to inject terms**

在 Phase 4a 的 step 3（211 行 `Dispatch a subagent with the domain-discoverer prompt + kg-summary.json content as context`）改为注入术语库：

```markdown
3. Dispatch a subagent with the `domain-discoverer` prompt + `kg-summary.json` content as context. If `$TERMS_MD` is non-empty, append the glossary markdown to the agent context with this preamble:

   ```
   ## Business Terms Glossary (PRD authoritative business view)

   The following is the project's PRD business terms glossary. Use it to align domain naming and record attribution (see Rule 13 in your instructions). Code (kg-summary) remains authoritative for domain boundaries — the glossary aligns names and records attribution only.

   <terms-glossary>
   $TERMS_MD
   </terms-glossary>
   ```

   If `$TERMS_MD` is empty, do not mention the glossary — the agent runs its original logic and omits matchedSubDomains/matchedTerms/evidence fields.
```

- [ ] **Step 4: Modify Phase 4a-refine to also inject terms**

在 Phase 4a-refine 的 step 3（237 行 `Dispatch a subagent with the domain-discoverer prompt + refinement context`）追加：术语库同样注入 refine pass（与初次 dispatch 一致，统一结构）：

```markdown
   If `$TERMS_MD` is non-empty, also append the glossary markdown (same preamble as Phase 4a step 3) so refine produces the same evidence structure.
```

- [ ] **Step 5: Verify no other phases were touched**

Run: `git diff understand-anything-plugin/skills/understand-domain/SKILL.md`
Expected: 只改 Phase 0（新增加载段）+ Phase 4a step 3 + Phase 4a-refine step 3，其余不动。

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand-domain/SKILL.md
git commit -m "feat(domain): SKILL Phase 0 loads terms glossary, Phase 4a injects to agent"
```

---

## Task 8: 回归测试 + 文档同步

**Files:**
- 无新文件，跑全量测试 + 更新 CLAUDE.md 若需

- [ ] **Step 1: Run full python test suite for understand-domain**

Run: `cd tests/skill/understand-domain && python -m pytest -v`
Expected: PASS — 所有现有测试（test_condense_kg / test_domain_fingerprints / test_domain_recovery / test_merge_domain / test_split_kg）+ 新增 test_audit_evidence 全过。

- [ ] **Step 2: Run full vitest suite (config-reader + others)**

Run: `pnpm test`
Expected: PASS — 包括 Task 1 的 test_config_reader_business_terms.mjs + 现有 config-reader.test.mjs + 全部 dashboard/core/src 测试。

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS — 无新增 lint 错误（只改了 .mjs，python/.md 不受 eslint 管）。

- [ ] **Step 4: Verify audit script runs end-to-end on a synthetic project**

手动构造最小项目目录验证整个链路（config → 术语库 → audit 输出）：

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/svc/.understand-anything/intermediate"
echo '{"businessTermsPath": "../../../terms.md"}' > "$TMP/svc/.understand-anything/config.json"
printf '## 关系社交\n### 亲密关系\n| 术语 | 含义 |\n|---|---|\n| 亲密度 | 数值 |\n' > "$TMP/terms.md"
echo '{"domains":[{"id":"domain:x","name":"关系召回","modules":[],"matchedSubDomains":["不存在的"],"matchedTerms":[],"evidence":{"keyNodes":[],"modules":[],"reason":""}}]}' > "$TMP/svc/.understand-anything/intermediate/domain-discovery.json"
echo '{"keyNodes":[],"modules":[]}' > "$TMP/svc/.understand-anything/intermediate/kg-summary.json"
python3 understand-anything-plugin/skills/understand-domain/audit_domain_discovery.py "$TMP/svc"
cat "$TMP/svc/.understand-anything/intermediate/domain-audit.json"
rm -rf "$TMP"
```
Expected: domain-audit.json 含 `matched_subdomains_invalid` + `domain_name_verb_like` warning，`shouldRefine: true`。

- [ ] **Step 5: Commit any test fixups if needed**

若 Step 1-4 全过无改动，跳过此步。若有修正：
```bash
git add -A
git commit -m "test(domain): regression fixes for terms glossary injection"
```

---

## Self-Review

**1. Spec coverage** — 逐节核对：

| Spec 节 | 覆盖任务 |
|---|---|
| §1 目标/范围 | 全计划（Task 1-7 覆盖 spec 覆盖列表的全部文件） |
| §2 结构假设/分工/type 不需要 | Task 6（agent prompt 写结构说明 + 不加 type） |
| §3 config + 路径解析 + 加载流程 + 降级 | Task 1（config-reader）+ Task 5（main 加载+降级）+ Task 7（Phase 0 加载） |
| §3 worktree 已知限制 | 不需任务（已知限制，不强行解决；Task 7 路径解析用 dirname(config) 已是最佳努力） |
| §4.1 注入内容 | Task 7（Phase 4a 注入） |
| §4.2 认领语义（不固定对齐层） | Task 6（Rule 13） |
| §4.3 防 PRD 污染 | Task 6（Rule 13 anti-PRD-pollution） |
| §4.4 evidence 输出 | Task 6（Output Schema） |
| §4.5 跨服务双锚点 | Task 6（matchedSubDomains + matchedTerms 字段定义） |
| §4.6 动词处理 | Task 6（Rule 13 verb）+ Task 3/4（audit verb_like） |
| §4.7 evidence 统一结构 | Task 6（"every domain MUST carry these fields"） |
| §5 SKILL.md Phase 改动 | Task 7 |
| §6.1 六类 warning | Task 4 |
| §6.2 程序校验锚点 | Task 2（二级域清单）+ Task 3（keyNode id 集合 + 动词词根） |
| §6.3 校验能力不一致 | Task 4（代码注释） |
| §6.4 keyNodes 格式契约 | Task 6（agent prompt 写 id 契约）+ Task 4（possibleFormatMismatch） |
| §6.5 防双重惩戒 | Task 4（test_no_double_penalty） |
| §6.6 改动边界 | Task 4/5（只追加，不动 entity_diversity/tag_divergence） |
| §7 测试 T1-T11 | Task 1（T1 config 缺失）+ Task 5（T1/T2/T3 main 降级）+ Task 2（T4/T3）+ Task 4（T5-T8/T11）+ Task 3（T9 动词）+ Task 5（T10 无术语库） |
| §8 错误处理 | Task 5（降级+响亮）+ Task 7（Phase 0 降级） |
| §9 已知限制 | 不需任务（限制本身不实现，靠 audit 软告警 + 人审兜底，已在 Task 4/6 体现） |

**覆盖完整。** T1-T11 测试矩阵全部分布到任务，无遗漏。

**2. Placeholder scan** — 搜索 TBD/TODO/"implement later"/"add appropriate"/"similar to Task N"：无。所有代码块含完整实现。Task 8 Step 4 的端到端验证脚本是完整可跑命令，非占位。

**3. Type consistency** — 核对跨任务函数/字段名：
- `extract_subdomains(terms_md: str) -> set[str]` — Task 2 定义，Task 4 调用 ✓
- `extract_keynode_ids(summary: dict) -> set[str]` — Task 3 定义，Task 4 调用 ✓
- `is_verb_like_name(name: str) -> bool` — Task 3 定义，Task 4 调用 ✓
- `audit_domain_discovery(discovery, summary, terms_md=None)` — Task 4 定义，Task 5 调用 ✓
- `_load_terms_md(project_root: Path) -> str | None` — Task 5 定义 ✓
- domain 字段 `matchedSubDomains`/`matchedTerms`/`evidence`/`evidence.keyNodes`/`evidence.modules`/`evidence.reason` — Task 6（agent prompt）与 Task 4（audit 读取）一致 ✓
- warning type 字符串 `matched_subdomains_invalid`/`matched_subdomains_empty_no_reason`/`matched_terms_empty`/`key_nodes_not_in_kg`/`domain_name_verb_like`/`evidence_missing` — Task 4 定义，Task 4 测试断言一致 ✓
- `possibleFormatMismatch` 字段 — Task 4 产出，Task 4 测试断言 ✓
- config 字段 `businessTermsPath` — Task 1（CONFIG_DEFAULTS）与 Task 5（_load_terms_md 读取）与 Task 7（SKILL bash 读取）一致 ✓

**类型/命名一致，无 mismatch。**

**4. Spec 偏差已记录** — 计划开头的"Spec 偏差说明"3 条（config-reader 字段过滤、keyNodes 用 id、测试运行器分置）均在对应任务落实，实现时不会踩坑。
