# Wiki 快速开始

## 功能概述

`/understand-wiki` 为微服务项目生成可导航的团队知识库 Wiki：按业务域、流程、步骤组织说明，并附带源码引用。单服务生成服务级 Wiki；多服务集成后还会生成父级编排 Wiki，展示跨服务调用与端到端业务流程。生成结果保存在 `.understand-anything/wiki/`，可在 Dashboard 的 **Wiki** 视图中浏览。

## 前置条件

每个目标服务需先完成图谱分析（技能会自动触发缺失步骤，也可手动执行）：

| 步骤 | 命令 | 产出 |
|------|------|------|
| 知识图谱 | `/understand` | `.understand-anything/knowledge-graph.json` |
| 领域图谱 | `/understand-domain` | `.understand-anything/domain-graph.json` |

若图谱与当前 `git HEAD` 不一致，Wiki 生成会提示先重跑上游命令；可用 `--force` 跳过该检查。

## 快速开始（单服务）

```bash
cd my-service
/understand-wiki
```

完成后查看：

```
my-service/.understand-anything/wiki/
├── meta.json
├── index.json
├── service.json
└── domains/<domain-id>.json
```

单服务模式下，若父目录已有其他已集成 Wiki 的服务，会自动尝试增量更新父级 Wiki。

## 多服务批量生成

在包含多个子服务的父目录显式启用批量模式：

```bash
cd parent-dir
/understand-wiki --batch
```

仅更新某一个子服务：

```bash
cd parent-dir
/understand-wiki --service=order-service
```

批量模式默认 `--continue-on-error`：单个服务失败不阻断其余服务；父级 Wiki（Phase 2）在至少 2 个服务成功集成后运行。

## 配置

在 `my-service/.understand-anything/config.json` 中配置：

```json
{
  "outputLanguage": "zh",
  "rpcAnnotations": [
    {
      "provider": "@DubboService",
      "consumer": "@DubboReference",
      "type": "dubbo"
    },
    {
      "provider": "@MoaProvider",
      "consumer": "@MoaConsumer",
      "type": "moa",
      "interfaceField": "service"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `outputLanguage` | Wiki 正文语言（ISO 639-1，如 `zh`、`en`） |
| `rpcAnnotations` | 自定义 RPC 注解，供 `/understand` 与跨服务匹配使用 |

命令行 `--language zh` 可覆盖单次生成的语言；未指定时读取 `config.json`，默认 `en`。

生成前可选校验配置：

```bash
python3 <plugin-root>/skills/understand-wiki/wiki_config_validator.py \
  my-service/.understand-anything/config.json
```

## 查看结果（Dashboard）

1. 在项目根目录运行 `/understand-dashboard`（或打开已部署的 Dashboard）。
2. 若存在 `.understand-anything/wiki/meta.json`，顶部会出现 **Wiki** 标签页。
3. 左侧导航树：系统概览 → 各服务 → 域页面；多服务时还有跨服务流程。
4. 点击流程步骤中的源码链接，可在侧栏预览对应文件行范围。

## 常用选项

| 选项 | 说明 |
|------|------|
| `--batch` | 当前目录为父目录，扫描并处理所有子服务 |
| `--service=<name>` | 从父目录指定单个服务（隐含批量上下文） |
| `--review` | 生成后运行 `wiki-reviewer` 质量审查 |
| `--full` | 强制全量重建，忽略已有 Wiki 与增量逻辑 |
| `--force` | 跳过 KG/DG 与当前 commit 的过期检查 |
| `--dry-run` | 预览将处理的服务与预估成本，不写文件、不调用 LLM |
| `--continue-on-error` | 批量模式遇错是否继续（默认 `true`）；设为 `false` 则在首个失败时停止并跳过 Phase 2 |
| `--language <lang>` | 指定输出语言（如 `zh`、`chinese`） |

默认行为：**未加 `--batch` 时始终为单服务模式**（当前目录 = 一个服务），避免 monorepo 误识别。

## 故障排查

| 现象 | 处理 |
|------|------|
| 提示缺少 knowledge graph | 在该服务目录执行 `/understand` |
| 提示缺少 domain graph | 执行 `/understand-domain` |
| 提示上游数据过期 | 按提示重跑 `/understand` 或 `/understand-domain`，或加 `--force` |
| Wiki 已是最新 | 代码未变则跳过；需要重建时加 `--full` |
| 批量中部分服务失败 | 查看汇总中的 `✗` 行，对失败服务执行 `/understand-wiki --service=<name> --full` |
| Dashboard 无 Wiki 标签 | 确认项目根或子服务下存在 `wiki/meta.json`，并刷新 Dashboard |
| 跨服务 Wiki 未生成 | Phase 2 需要至少 2 个服务已有完整 Wiki（存在 `wiki/meta.json`） |
| 自定义 RPC 未匹配 | 检查 `config.json` 的 `rpcAnnotations`，并重新 `/understand` 以更新 KG |

预览计划（不执行生成）：

```bash
/understand-wiki --dry-run
```
