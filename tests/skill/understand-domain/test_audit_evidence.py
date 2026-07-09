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
    # domain:fabricated 不触发 matched_subdomains_empty_no_reason（matchedSubDomains 非空），改由 domain:unknown 触发
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
    assert "evidence_missing" in warning_types


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


# 意图：spec §8.1 — 术语库 md 有内容但无 ### 标题时，audit 跳过 matchedSubDomains 校验
# （空二级域清单不可靠，靠人审 reason）。不应把所有 matchedSubDomains 判为 invalid。
def test_audit_no_headings_skips_subdomain_validation():
    from audit_domain_discovery import audit_domain_discovery
    discovery = {
        "domains": [{
            "id": "domain:x", "name": "某域", "modules": [],
            "matchedSubDomains": ["任意二级域"], "matchedTerms": ["某术语"],
            "evidence": {"keyNodes": [], "modules": ["m"], "reason": "说明"}
        }]
    }
    summary = {"keyNodes": [], "modules": []}
    # md 有内容但无 ### 标题
    terms_md = "纯正文没有标题\n| 列1 | 列2 |\n|---|---|\n| a | b |\n"

    result = audit_domain_discovery(discovery, summary, terms_md)
    warning_types = {w["type"] for w in result["warnings"]}

    assert "matched_subdomains_invalid" not in warning_types  # 空清单时跳过，不误报
