# 中文 Wiki 输出指南 (Chinese Simplified)

本文件提供生成中文 Wiki 文档内容的语言指导。

## 名称翻译约定

所有 `name` 字段必须使用中文（`id` 字段保持英文不变）：

| 字段 | 英文（来自 DG） | 中文（输出） |
|---|---|---|
| Domain `name` | `"Order Management"` | `"订单管理"` |
| Flow `name` | `"Create Order"` | `"创建订单"` |
| Step `name` | `"Validate Input"` | `"校验输入"` |
| Entity `name` | `"Order"` | `"Order"`（保留英文类名） |

- Domain name：翻译业务领域概念，4-6 字为佳
- Flow name：动词短语，如"创建订单"、"处理支付"、"同步库存"
- Step name：简洁动作描述，如"校验输入"、"计算价格"、"持久化数据"
- Entity name：保留代码中的类名（英文），不翻译

## Wiki Section 标题约定

Wiki 结构化字段在 Dashboard 中会翻译为中文标题。wiki-worker 生成的 `name`、`summary`、`description` 等文本内容也必须使用中文。

## 摘要风格

- Domain 摘要：3-5 句中文，描述领域的业务能力、核心实体、关键规则和外部依赖
- Flow 摘要：2-3 句中文，描述流程的业务目标、技术机制和跨服务交互
- Step 描述：说明代码**做了什么**，而非只描述**是什么**

**示例：**
- 好: "校验事件类型和用户身份，根据 familyId 定位所在家族，若用户不在有效家族中则忽略事件。"
- 差: "校验事件。"

## 统一语言（Ubiquitous Language）

- 每个领域的关键业务术语使用中文定义
- 术语名称(`term`)：使用代码中的类名或枚举名（保留英文），并在定义中给出中文解释
- 示例: `{ "term": "FamilySquareDto", "definition": "广场推荐服务内部结果，包含 familyList、hasMore 和下一页 search_after index。" }`
- 目标：每个领域 5-15 个术语

## 业务规则

- 规则描述使用中文
- `enforcement` 字段保留代码中的类名和方法名（英文）
- 示例: `{ "id": "BR-001", "rule": "推荐分页 limit 为空或非正数时使用 familySquarePageSize 配置。", "enforcement": "FamilyWebServiceImpl.querySquareRecommend" }`

## 实体描述

- `description` 使用中文描述实体的业务角色
- `keyFields` 保留代码中的字段名（英文）
- `lifecycleStates` 如果是枚举值则保留英文，如有标准中文翻译可附加说明
- `invariants` 使用中文描述约束

## 技术术语保留英文

以下术语建议保留英文（暂无标准翻译）：
- `DTO`, `VO`, `Entity`, `Repository`, `Service`
- `Kafka`, `Redis`, `MySQL`, `ES`
- `RPC`, `Dubbo`, `gRPC`, `REST API`
- `CRUD`, `ORM`, `MQ`

## 集成点

- `type` 使用英文标识（`HTTP`, `RPC`, `Kafka`, `Redis`）
- `endpoint` 保留代码中的接口名（英文）
- `description` 使用中文描述用途
