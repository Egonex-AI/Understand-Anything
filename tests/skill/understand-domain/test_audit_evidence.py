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
