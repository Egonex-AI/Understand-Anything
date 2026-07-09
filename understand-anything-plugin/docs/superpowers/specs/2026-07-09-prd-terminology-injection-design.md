# PRD 术语库注入 domain-discoverer 设计

> Brainstorming Spec — 2026-07-09
> Status: DRAFT — Awaiting approval

---

## 1. 目标与范围

### 目标

让 `/understand-domain` 注入一份外部 PRD 术语库（md 原文）作为权威业务视图，使产出的域名对齐 PRD 标准业务术语、跨服务命名一致，并通过认领证据防误认领。

### spec 覆盖（understand-anything 侧，H1）

- 改 `understand-domain/SKILL.md`：Phase 0 读 config 加载术语库 md；Phase 4a dispatch 注入
- 改 `agents/domain-discoverer.md`：术语库输入说明 + 认领规则 + evidence 输出
- 改 `understand-domain/audit_domain_discovery.py`：evidence 校验 warning
- 新增测试 + 夹具

### spec 不覆盖

kb-amar 侧术语库产出改造（LLM 输出 JSON、渲染 md 脚本等）——那是独立项目，本 spec 只消费已产出的 md。术语库当前是 PRD + testcase 双源、LLM wiki 风格的 md，位于 `kb-amar/amar-prd/wiki/concepts/` 下，是需求侧正交外部源（非 understand-anything 产物），注入方向无循环引用风险。

### 成功标准

1. 多服务产出域名在术语库标准术语层面对齐
2. 每个 domain 带 `matchedSubDomains` + `matchedTerms` + `evidence`，audit 可校验
3. 术语库缺失/格式异常时优雅降级，走原逻辑，不阻断主流程

---

## 2. 术语文档结构假设（软约束，非 schema 契约）

术语库是 md，非 JSON。本 spec 不定义硬 schema 契约，只给 agent 结构说明（软约束，agent 自适应）。

### 结构

```
## 一级域            ← 导航用，不作对齐基准
### 二级域           ← 归属护栏层（audit 程序校验锚点）
| 术语 | 一级域 | 二级域 | 含义 | 常见使用场景 | 来源 |   ← 表格层（agent 读，程序不解析）
```

### 字段含义（见 md 表头）

- 术语 — 业务术语名
- 含义 — 概念定义（agent 认领判断依据）
- 常见使用场景 — 自由文本
- 来源 — PRD 或 testcase 路径，追溯用（示例：`raw/prd/关系/2025-10-v2.10.0-亲密度迭代.md` 或 `raw/testcase/亲密关系召回.md`）

### 分工（关键取舍）

- **标题层**（`##`/`###`）：程序解析——audit 扫 `### ` 提取二级域清单，校验 matchedSubDomains。标题语法无歧义，解析稳定。
- **表格层**（术语/含义/场景/来源）：**不程序解析**——整份 md 原样注入 agent，agent 自己读表格。表格列数/格式可能漂移，程序解析脆弱，故交给 agent。

> 不解析表格是设计取舍，非遗漏。matchedTerms 只校验非空而非存在性，正是因为条目在表格层、程序不解析。

### type 字段：不需要

术语条目不设 `type`（domain/entity/flow/other）字段。理由：

- PRD 视角的 type 与代码视角的 domain 维度错配——PRD 标 `type=entity` 的概念（亲密度）在代码里可能构成完整域
- agent 判断概念能否当 domain.name 靠 definition 文本，不靠 type 标签
- 让 LLM 产 type 增加产出侧负担且标注不稳定
- 唯一窄用途（过滤动词当 name）由 agent 读 definition 判断 + audit 软告警兜底，不需 type

---

## 3. 配置与加载

### config.json 新增字段

```json
{
  "outputLanguage": "zh-CN",
  "autoUpdate": true,
  "businessTermsPath": "../../../amar-prd/wiki/concepts/business-terms.md"
}
```

`businessTermsPath` 遵循 config.json 现有模式：**可选增强项**，有则用，无则降级。不加入 workflow.js required 字段。

### 路径解析

相对 **config.json 自身位置**（`$PROJECT_ROOT/.understand-anything/config.json`）解析。理由：

- config.json 是 per-service 的（每个子服务自己的 `.understand-anything/` 下各一份），每份配置写自己的相对路径指向同一术语库，可移植且每份自洽
- 术语库在 kb-amar（被分析子服务之外的共享位置），从 config.json 位置 `../` 上溯到 kb-amar 再下钻，自然表达拓扑

> worktree 场景 caveat：redirect 改 PROJECT_ROOT 时 config.json 路径同步变到主 checkout 的 `.understand-anything/`，相对它解析的基准也变——若术语库在主 checkout 外，上溯可能到不了（见下方"已知限制"）。正常（非 worktree）场景无此问题。

### Phase 0 加载流程

```
1. 解析 PROJECT_ROOT（已有，含 worktree redirect）
2. 定位 config.json 路径 = $PROJECT_ROOT/.understand-anything/config.json（已有）
3. 读 config.json（已有：outputLanguage/autoUpdate）
4. 读 businessTermsPath：
   a. 字段缺失 → termsPayload = null，走原逻辑（静默，正常情况）
   b. 字段存在 → 绝对路径 = resolve(dirname(config.json 路径), businessTermsPath)
   c. 文件不存在 → 打印明确错误 + 降级
   d. 文件存在 → 读 md 文本，termsPayload = md 字符串
5. termsPayload 待注入，进入 Phase 4a
```

无 JSON 校验、无渲染脚本、无中间制品。读 md 是 Phase 0 内联的一步读文件。

### 降级语义

降级 = 不注入术语库，domain-discoverer 按现状从 kg-summary.json 聚类，产出不带 matchedSubDomains/matchedTerms/evidence。

降级**不阻断主流程**——术语库是增强项不是依赖项。但必须**响亮报错**（打印明确原因），不静默吞。

### 已知限制（worktree 场景）

worktree redirect 把 PROJECT_ROOT 换成主 checkout 根，config.json 路径同步变到主 checkout 的 `.understand-anything/config.json`。术语库若在主 checkout 之外的 kb-amar 位置，相对 config.json 上溯可能到不了 → 加载失败 → 响亮报错 + 降级走原逻辑，主流程不阻断。不在 spec 里强行解决（不为 worktree 引入复杂路径探测）；用户若需在 worktree 下用术语库，可临时改 config 用绝对路径。

---

## 4. domain-discoverer 注入 + 认领 + evidence

### 4.1 注入内容

domain-discoverer 现有输入：`kg-summary.json`（代码侧浓缩摘要，~15k tokens，权威）。

新增输入：**术语库 md 原文**（全量注入，不按服务切分）。

- `termsPayload = null` → 不提术语库，agent 按现状跑（原逻辑完全不变）
- `termsPayload` 有值 → md 原样拼进 agent prompt，附结构说明（第 2 节软约束）+ 认领规则（4.2）

**不按服务过滤**（前面否决 B 方案，全量注入 + 认领语义）。每个服务的 agent 各自认领自己实现的部分。

### 4.2 认领语义

domain-discoverer 任务不变：从 kg-summary.json 聚类业务域。新增约束：聚类时对齐术语库。

规则：

1. **代码为准**：域的划分仍以 kg-summary.json 的代码聚类为准，术语库不强制改划域边界。
2. **不固定对齐层**（核心）：对齐到哪层是判断调用，agent 看代码域实际范围，在术语库多层（一级/二级/条目）里找语义最贴近的那层作 domain.name。
   - 覆盖某二级域下多数条目的大域 → 对齐二级域名
   - 只覆盖一两个条目的小域 → 对齐条目名
   - agent prompt 一句指引（不写复杂算法）："domain.name 优先用术语库中的业务术语。按代码域实际范围选最贴近的层。不用动词/流程类术语当域名。"
3. **稀疏认领**：术语库可能含当前服务未实现的概念。agent 只认领当前服务实际实现的，不强凑。
4. **不认领也记录**：代码聚类出的域在术语库找不到对应，仍按代码语义命名，matchedSubDomains 留空 + evidence.reason 说明"术语库无对应，按代码语义命名"。

> 不固定对齐层的理由：代码域粒度异构（有的对应二级域，有的对应条目），任何固定一层对齐都必然失败——固定二级域会在粗二级域多代码域时 name 撞车；固定条目会在"亲密关系"这种完整域下误把域内成员当域名。交 agent 判断是唯一能处理粒度异构的解。

### 4.3 防 PRD 污染约束（写进 agent prompt）

注入 PRD 视图后，agent 可能被带偏：为对齐术语库，在代码只有零星实现处硬造一个 domain。

约束：**术语库只用于命名对齐和认领标注，不用于凭空造域；代码在某 PRD 域下只有零星实现不足以成域时，不留该 domain**（可在相邻域 evidence.reason 里提一句）。

### 4.4 evidence 输出

每个产出 domain 的 schema 增量字段：

```json
{
  "id": "...",
  "name": "亲密关系",
  "summary": "...",
  "matchedSubDomains": ["亲密关系"],
  "matchedTerms": ["亲密度", "关系等级", "关系召回"],
  "evidence": {
    "keyNodes": ["ultron-relationship/service/intimacy_calculator.py"],
    "modules": ["intimacy-core", "relationship-level"],
    "reason": "kg-summary 显示亲密度计算+关系等级模块协作,归属二级域'亲密关系',认领条目'亲密度''关系等级''关系召回'"
  }
}
```

字段：

- `matchedSubDomains[]` — 归属的二级域名数组（归属护栏，audit 程序校验存在性）
- `matchedTerms[]` — 认领的术语条目名数组（精确认领 + 跨服务关联锚点，audit 校验非空）
- `evidence.keyNodes[]` — 支撑认领的代码节点路径数组（audit 程序校验 KG 存在）
- `evidence.modules[]` — 支撑认领的模块名（audit 校验非空）
- `evidence.reason` — agent 的认领推理（自然语言，audit 校验非空，合理性靠人审）

### 4.5 跨服务一致性机制

靠**双锚点关联**（matchedSubDomains + matchedTerms），**非 name 字面一致**。

同一域在服务 A 是大实现（对齐二级域）、服务 B 是小实现（对齐条目），name 字面可能不同，但 matchedSubDomains 交集 + matchedTerms 交集清晰可关联。这是合理的区分能力——下游 merge 需按锚点聚合，非 name 字面匹配。

### 4.6 动词处理

术语库少量条目是动词/流程（如"亲密关系召回"）。处理：

- agent 读 definition 判断"这是动作不是域"，不用它当 domain.name
- audit 软告警：domain.name 疑似动词（命中动作词根表）→ warning 供人审
- 不加 type 字段

### 4.7 evidence 统一结构

每个 domain 都带 evidence（包括没匹配术语的——`matchedSubDomains: []` + `matchedTerms: []` + `evidence.reason` 说明"术语库无对应"）。统一结构，audit 校验逻辑不分支。

---

## 5. SKILL.md Phase 改动

### 5.1 Phase 0：加载术语库

增量（见第 3 节加载流程）：读 businessTermsPath，产 termsPayload（md 字符串或 null）。

### 5.2 Phase 4a：dispatch 注入

dispatch domain-discoverer 时把 termsPayload 一并传给 agent：

- `termsPayload = null` → 不提术语库，原逻辑
- `termsPayload` 有值 → md 原样拼进 agent prompt，附结构说明 + 认领规则

dispatch 逻辑（并发数、逐服务循环）不变。术语库全量注入每个服务。

### 5.3 改动边界（外科手术式）

只动：
- Phase 0：加术语库加载步骤
- Phase 4a：dispatch 时注入 termsPayload

不动：
- Phase 1-3、Phase 4a-audit（audit 脚本改动单列第 6 节）、Phase 5
- workflow.js required 字段（不加 businessTermsPath）
- 不新增渲染/解析脚本

### 5.4 与 config.json 模式一致

`businessTermsPath` 与 outputLanguage/autoUpdate 同模式：可选增强项，有则用无则降级。

---

## 6. audit_domain_discovery.py 证据校验

### 6.1 校验项

| 校验项 | 级别 | 抓什么 |
|---|---|---|
| `matched_subdomains_invalid` | warning | matchedSubDomains 含二级域清单外的名 |
| `matched_subdomains_empty_no_reason` | warning | matchedSubDomains 留空但 reason 未说明 |
| `matched_terms_empty` | warning | matchedTerms 完全空 |
| `key_nodes_not_in_kg` | warning | evidence.keyNodes 路径在 KG 不存在 |
| `domain_name_verb_like` | warning | domain.name 疑似动词 |
| `evidence_missing` | warning | 整个 evidence 对象缺失 |

全部 warning（不 error）——证据是增强项，缺失走 refine 重跑不阻断。refine 后仍有 warning 则保留产出 + audit 报告标注，人审。

### 6.2 程序校验锚点来源

- **二级域清单**：audit 启动时扫术语库 md `### ` 标题提取（标题稳，~10 行扫描，不碰表格）。termsPayload 为 null 则跳过 matchedSubDomains 相关校验。
- **KG 路径集合**：从 intermediate 的 kg-summary.json/KG 提取 node path 集合，比对 keyNodes。
- **动词词根表**：内置动作词根（召回/升级/触发/计算/提交/查询/下发/推送...），domain.name 命中即 warning。不追求完备，只兜底明显误用。

### 6.3 校验能力不一致（显式说明）

`matchedSubDomains` 可程序校验存在性（标题稳），`matchedTerms` 只校验非空（表格脆，程序不解析）。这层不一致是 md 结构稳定性差异决定的，非设计疏漏——写进 audit 脚本注释。

### 6.4 keyNodes 路径格式契约

agent 产出的 keyNodes 必须用 **KG node 的 path 字段原样格式**（写进 domain-discoverer.md prompt）。

audit 比对时：若 keyNodes 全部 not_in_kg，额外提示"路径格式可能不匹配，请检查 agent prompt 契约"——区分"agent 编造路径"与"格式不匹配"。

### 6.5 防双重惩戒

matchedSubDomains 留空（无 PRD 对应）时，audit 不再判 matchedTerms_empty（无归属时条目认领本也可能空）。避免合理降级 domain 被叠两个 warning。

### 6.6 改动边界

audit_domain_discovery.py 现有 `audit_domain_discovery()`（第 46-118 行）加 evidence 校验分支：

- 新增读术语库 md 提取二级域清单（termsPayload 为 null 则跳过）
- 新增读 KG path 集合
- 现有 warning 收集逻辑后追加 evidence warning
- shouldRefine 判定纳入新 warning

不动：现有 entity_diversity/tag_divergence 逻辑、refine 机制、audit 输出格式（只增 warning 类型）。

---

## 7. 测试策略

测试落 `tests/skill/`（根 vitest.config.ts 拾取）。只测程序逻辑，不测 agent 判断调用。

### 7.1 测试矩阵

| 测试 | 意图 | 类型 |
|---|---|---|
| T1 加载-字段缺失 | 增强项缺失必须优雅降级不阻断 | 单元 |
| T2 加载-文件不存在 | 路径配了但文件不在→响亮报错+降级 | 单元 |
| T3 加载-无标题 | md 无 `##`/`###`→不降级，termsPayload 有值，audit 跳过 matchedSubDomains 校验 | 单元 |
| T4 提取二级域清单 | 锚点提取稳，忽略表格/正文 | 单元 |
| T5 audit-matchedSubDomains非法 | 含清单外名→warning | 单元 |
| T6 audit-keyNodes不在KG | 编造路径→warning | 单元 |
| T7 audit-空归属无reason | 空归属且 reason 空→warning | 单元 |
| T8 audit-防双重惩戒 | 空归属时不叠判 matchedTerms_empty | 单元 |
| T9 audit-动词名 | domain.name="关系召回"→warning | 单元 |
| T10 audit-无术语库降级 | termsPayload=null→跳过 matchedSubDomains 校验不崩 | 单元 |
| T11 path格式契约 | keyNodes 格式不匹配→全 not_in_kg 时提示格式问题 | 单元 |

### 7.2 不测什么

- agent 判断对齐层对不对（判断调用，LLM 输出不稳定）
- 跨服务 name 一致性（name 字面本就不保证一致）
- 动词启发式完备性（只测明显动词被抓）
- domain-discoverer.md prompt 改动（文本，靠 spec 评审）

### 7.3 夹具

- `tests/skill/fixtures/business-terms-sample.md` — 小型术语库（2 一级域/4 二级域/若干条目混名词动词）
- `tests/skill/fixtures/domain-discovery-sample.json` — 含各种 evidence 异常的 domain 数组
- `tests/skill/fixtures/kg-summary-sample.json` — 小型 KG path 集合

小型化，不搬真实 770 行术语库。

---

## 8. 错误处理汇总

### 8.1 降级触发与行为

| 触发 | 行为 | 阻断? |
|---|---|---|
| businessTermsPath 字段缺失 | termsPayload=null，走原逻辑 | 否（静默） |
| 文件不存在 | 打印明确错误+降级 | 否 |
| md 无 `##`/`###` 标题 | 不降级（md 已加载，termsPayload 有值）；audit 跳过 matchedSubDomains 校验，二级域清单空时无 invalid 可判 | 否 |
| audit evidence warning | shouldRefine→Phase 4a-refine 重跑 | 否（refine 后仍有则保留+标注） |

### 8.2 响亮原则

所有降级（除"字段缺失"正常情况）必须打印明确原因（触发点、路径/原因、降级行为），不静默吞。

### 8.3 不写错误处理的场景

- config.json 本身损坏（现有 Phase 0 已处理）
- KG 文件损坏（现有 validate-graph.mjs/audit 已处理）
- md 既合法又无标题的极端组合——无标题不降级（见 8.1），audit 自动跳过相关校验

---

## 9. 已知限制

- **agent 判断对齐层有错概率**：可能把大域误对齐到条目或反之。靠 audit 软告警 + 人审 reason 兜底。
- **跨服务 name 字面不完全一致**：同一域大小不同实现 name 不同，靠双锚点关联。下游 merge 需按锚点聚合。
- **audit 盲区——漏认领**：漏认领（PRD 有但 agent 没认）与 PRD 真无覆盖，程序都表现为 matchedSubDomains=[]，区分靠人审 reason。
- **token**：完整 md（770 行/几十 k token）全量注入每服务，偏大但非阻断。不为此引入 md 解析压缩（保持简单）。
- **表格不程序解析**：matchedTerms 无法程序校验存在性，只校验非空。
- **worktree 场景相对路径可能失效**：术语库在主 checkout 外时，相对 config.json 解析到不了 → 降级走原逻辑（见第 3 节已知限制）。

---

## 10. 决策链（最终锁定）

| # | 决策 |
|---|---|
| 1 | 术语文档到达：读原始 md（A1'） |
| 2 | 位置：config.json + businessTermsPath，相对 config.json 自身位置解析 |
| 3 | type 字段：不需要 |
| 4 | 注入形态：全量 md 原文注入 |
| 5 | 核心语义：agent 探索代码判断实现哪些域，稀疏认领 |
| 6 | 对齐层：不固定，agent 按代码域实际范围选最贴近的术语（可二级域可条目） |
| 7 | 误认领防护：matchedSubDomains + matchedTerms + evidence{keyNodes,modules,reason} + audit |
| 8 | 跨服务一致：双锚点关联（matchedSubDomains + matchedTerms），非 name 字面一致 |
| 9 | 动词处理：agent 读 definition 判断 + audit 软告警，不加 type |
| 10 | 表格处理：程序不解析，agent 读 |
| 11 | 设计范围：G1 仅 understand-domain |
| 12 | spec 边界：H1 仅消费侧，无 schema 契约 |
