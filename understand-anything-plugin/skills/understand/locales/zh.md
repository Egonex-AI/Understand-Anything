# 中文输出指南 (Chinese Simplified)

本文件提供生成中文知识图谱内容的语言指导。

## 标签约定

推荐使用中文标签或英文通用技术术语：

| 模式 | 推荐标签 |
|------|---------|
| 入口文件 | `入口点`, `barrel`, `导出` 或 `entry-point` |
| 工具函数 | `工具函数`, `helpers`, `common` 或 `utility` |
| API处理器 | `api-handler`, `控制器`, `端点` |
| 数据模型 | `数据模型`, `entity`, `schema` 或 `data-model` |
| 测试文件 | `测试`, `单元测试`, `test` |
| 配置文件 | `配置`, `构建系统`, `settings` 或 `configuration` |
| 基础设施 | `基础设施`, `部署`, `容器化` 或 `infrastructure` |
| 文档 | `文档`, `指南`, `参考` 或 `documentation` |

**混合策略：** 通用技术术语保留英文（如 `middleware`, `api-handler`），描述性标签可使用中文。

## 摘要风格

用中文撰写1-2句摘要：
- 描述文件的**目的**和**作用**
- 使用主动语态（"提供...", "处理...", "管理..."）
- 避免重复文件名

**示例：**
- 好: "提供日期格式化和字符串清洗工具函数，被 API 层广泛使用。"
- 差: "utils 文件包含工具函数。"

## 技术术语

以下术语建议保留英文（暂无标准翻译）：
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## 层级名称

使用中文层级名称：
- `API 层`, `服务层`, `数据层`, `UI 层`
- `基础设施`, `配置`, `文档`
- `工具层`, `中间件层`, `测试层`

或保留英文（根据团队习惯）：
- `API Layer`, `Service Layer`, `Data Layer`