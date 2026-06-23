# 繁體中文輸出指南 (Chinese Traditional)

本文件提供生成繁體中文知識圖譜內容的語言指導。

## 標籤約定

推薦使用繁體中文標籤或英文通用技術術語：

| 模式 | 推薦標籤 |
|------|---------|
| 入口檔案 | `入口點`, `barrel`, `匯出` 或 `entry-point` |
| 工具函數 | `工具函數`, `helpers`, `common` 或 `utility` |
| API處理器 | `api-handler`, `控制器`, `端點` |
| 資料模型 | `資料模型`, `entity`, `schema` 或 `data-model` |
| 測試檔案 | `測試`, `單元測試`, `test` |
| 設定檔 | `設定`, `建構系統`, `settings` 或 `configuration` |
| 基礎架構 | `基礎架構`, `部署`, `容器化` 或 `infrastructure` |
| 文件 | `文件`, `指南`, `參考` 或 `documentation` |

**混合策略：** 通用技術術語保留英文（如 `middleware`, `api-handler`），描述性標籤可使用繁體中文。

## 摘要風格

用繁體中文撰寫1-2句摘要：
- 描述檔案的**目的**和**作用**
- 使用主動語態（"提供...", "處理...", "管理..."）
- 避免重複檔名

**範例：**
- 好: "提供日期格式化和字串清洗工具函數，被 API 層廣泛使用。"
- 差: "utils 檔案包含工具函數。"

## 技術術語

以下術語建議保留英文（暫無標準翻譯）：
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## 層級名稱

使用繁體中文層級名稱：
- `API 層`, `服務層`, `資料層`, `UI 層`
- `基礎架構`, `設定`, `文件`
- `工具層`, `中介軟體層`, `測試層`

或保留英文（根據團隊習慣）：
- `API Layer`, `Service Layer`, `Data Layer`