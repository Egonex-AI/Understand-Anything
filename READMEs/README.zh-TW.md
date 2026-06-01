<h1 align="center">Understand Anything</h1>
<p align="center">
  <strong>將任意程式碼庫、知識庫或文件轉化為可探索、可搜尋、可對話的互動式知識圖譜</strong>
  <br />
  <em>支援 Claude Code、Codex、Cursor、Copilot、Gemini CLI 等多平台。</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Lum1104%2FUnderstand-Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.vi-VN.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="#-快速開始"><img src="https://img.shields.io/badge/快速開始-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Lum1104/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/授權條款-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/專案首頁-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/線上展示-00c853" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — 將任何程式碼庫轉換為互動式知識圖譜" width="800" />
</p>

<p align="center">
  <strong>💬 <a href="https://discord.gg/pydat66RY">加入 Discord 社群 &rarr;</a></strong>
  <br />
  <em>來提問、分享你的專案、和社群一起討論。</em>
</p>

---

**當你剛加入一個新團隊，面對 20 萬行程式碼，你從哪裡開始？**

Understand Anything 是一個 [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference)，透過多智能體（multi-agent）架構分析你的專案，建構包含檔案、函式、類別以及相依關係的知識圖譜，並提供一個視覺化互動介面，幫助你理解整個系統。不再「盲讀程式碼」，而是從全局視角理解系統結構。

> **目標不是用程式碼庫的複雜程度驚豔你 —— 而是默默告訴你每一塊是怎麼拼在一起的。**

---

## ✨ 核心功能

> [!NOTE]
> **想直接體驗？** 在我們的[首頁](https://understand-anything.com/)試試[線上演示](https://understand-anything.com/demo/) — 一個可以平移、縮放、搜尋和探索的全互動式儀表盤。

### 探索程式碼結構圖

將你的程式碼庫以互動式知識圖譜呈現——每個檔案、函式和類別都是可點擊、可搜尋、可探索的節點。選取任意節點即可檢視淺顯易懂的摘要、依賴關係和引導式學習路徑。

### 理解業務邏輯

切換到領域視圖，查看程式碼如何對應到真實的業務流程——以水平圖的形式展示領域、流程和步驟。

### 分析知識庫

將 `/understand-knowledge` 指向一個 [Karpathy 模式的 LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，即可獲得帶有社群聚類的力導向知識圖譜。確定性解析器從 `index.md` 中提取 wikilinks 和分類，然後 LLM 代理發現隱式關係、提取實體並挖掘論斷——將你的 wiki 轉化為可導航的互聯思想圖譜。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 引導式學習</h3>
      <p>自動產生架構學習路徑，按相依順序學習。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 語意搜尋</h3>
      <p>支援模糊搜尋 + 語意搜尋，例如搜尋「哪些部分處理身分驗證？」即可在整個圖中獲取相關結果。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 變更影響分析</h3>
      <p>提交變更前，查看變更會影響系統的哪些部分。了解變更對整個程式碼庫的連鎖反應。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 使用者角色自適應 UI</h3>
      <p>根據使用者類型（初級開發 / 專案經理 / 進階使用者）調整其詳細程度。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ 層級視覺化</h3>
      <p>按架構層級自動分組 — API、服務、資料、UI、系統工具 — 並附有顏色編碼圖例。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 語言概念</h3>
      <p>12 種程式設計模式（泛型、閉包、裝飾器等）將在上下文中逐一解釋。</p>
    </td>
  </tr>
</table>

---

## 🚀 快速開始

### 1. 安裝外掛程式

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2. 分析你的程式碼庫

```bash
/understand
```

多智能體（multi-agent）架構會：掃描你的專案，提取函式 / 類別 / 相依關係，建構知識圖譜並儲存至 `.understand-anything/knowledge-graph.json`。

**在地化輸出：** 使用 `--language` 參數產生中文內容：

```bash
# 產生繁體中文內容（知識圖節點描述和 Dashboard UI）
/understand --language zh-TW

# 支援的語言：en（預設）、zh、zh-TW、ja、ko、ru
```

`--language` 參數會影響：
- 知識圖譜中的節點摘要和描述
- Dashboard UI 的標籤、按鈕和提示
-導覽路線的解釋說明

### 3. 開啟資料看板

```bash
/understand-dashboard
```

開啟互動式網頁資料看板，你的程式碼庫將以圖表形式呈現 — 按架構層級進行顏色編碼，支援搜尋和點擊。選擇任意節點即可查看其程式碼、關係以及簡明易懂的解釋。

### 4. 深度使用

```bash
# 詢問任意程式碼庫的問題
/understand-chat 付款流程是怎麼運作的？

# 分析目前修改的影響
/understand-diff

# 深入理解某個檔案
/understand-explain src/auth/login.ts

# 為新團隊成員產生指南
/understand-onboard

# 提取業務領域知識（領域、流程、步驟）
/understand-domain

# 分析 Karpathy 模式的 LLM Wiki 知識庫
/understand-knowledge ~/path/to/wiki

# 直接重跑即可 —— 預設增量更新，只分析變更的檔案
/understand

# 安裝 post-commit 掛鉤，每次提交自動增量更新
/understand --auto-update

# 大型 monorepo？把分析範圍限定到某個子目錄
/understand src/frontend
```

---

## 🌐 多平台支援

Understand-Anything 可在多個 AI 編碼平台上執行。

### Claude Code（原生）

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 一行指令安裝（Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI）

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
# 也可以直接傳入平台名稱跳過互動提示：
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s codex
```

**Windows（PowerShell）：**
```powershell
iwr -useb https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.ps1 | iex
```

安裝指令稿會將儲存庫複製到 `~/.understand-anything/repo`，並為所選平台建立相應的符號連結。安裝完成後請重新啟動 CLI 或 IDE。

- 支援的 `<platform>` 取值：`gemini`、`codex`、`opencode`、`pi`、`openclaw`、`antigravity`、`vibe`、`vscode`、`hermes`、`cline`、`kimi`
- 後續更新：`./install.sh --update`
- 解除安裝：`./install.sh --uninstall <platform>`

### Cursor

複製此儲存庫後，Cursor 會自動透過 `.cursor-plugin/plugin.json` 檔案發現外掛程式。無需手動安裝 — 只需複製並在 Cursor 中開啟即可。

若自動發現未生效，可手動安裝：開啟 **Cursor Settings → Plugins**，在搜尋框中貼上 `https://github.com/Lum1104/Understand-Anything` 並新增。

### VS Code + GitHub Copilot

安裝 GitHub Copilot 擴充功能（v1.108+）後，VS Code 會透過 `.copilot-plugin/plugin.json` 自動發現外掛程式，複製後直接在 VS Code 中開啟即可，無需手動安裝。

若需要在所有專案中使用（個人技能），執行上面的 `install.sh` 並選擇 `vscode` 平台即可。

### Copilot CLI

```bash
copilot plugin install Lum1104/Understand-Anything:understand-anything-plugin
```

### 多平台相容性

| 平台 | 狀態 | 安裝方式 |
|----------|--------|----------------|
| Claude Code | ✅ 原生 | 外掛程式市集 |
| Cursor | ✅ 支援 | 自動發現 |
| VS Code + GitHub Copilot | ✅ 支援 | 自動發現 |
| Copilot CLI | ✅ 支援 | 外掛程式安裝 |
| Codex | ✅ 支援 | `install.sh codex` |
| OpenCode | ✅ 支援 | `install.sh opencode` |
| OpenClaw | ✅ 支援 | `install.sh openclaw` |
| Antigravity | ✅ 支援 | `install.sh antigravity` |
| Gemini CLI | ✅ 支援 | `install.sh gemini` |
| Pi Agent | ✅ 支援 | `install.sh pi` |
| Vibe CLI | ✅ 支援 | `install.sh vibe` |
| Hermes | ✅ 支援 | `install.sh hermes` |
| Cline | ✅ 支援 | `install.sh cline` |
| KIMI CLI | ✅ 支援 | `install.sh kimi` |

---

## 📦 與團隊共享知識圖譜

圖譜就是一份 JSON 檔案——**提交一次，團隊成員就可以跳過整條流水線**。適合新人上手、PR 審查和 docs-as-code 工作流程。

> **範例：** [GoogleCloudPlatform/microservices-demo（fork）](https://github.com/Lum1104/microservices-demo) —— 包含已提交圖譜的 Go / Java / Python / Node 多語言參考專案。

**需要提交的內容：** `.understand-anything/` 底下的全部檔案，*除了* `intermediate/` 與 `diff-overlay.json`（這些是本機暫存檔）。

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

**保持最新：** 啟用 `/understand --auto-update` —— 一個 post-commit 掛鉤會增量更新圖譜，讓每次提交都有對應的圖譜版本。也可以在發布前手動重跑 `/understand`。

**大型圖譜（10 MB 以上）：** 使用 **git-lfs** 追蹤。

```bash
git lfs install
git lfs track ".understand-anything/*.json"
git add .gitattributes .understand-anything/
```

---

## 🔧 技術原理

### Tree-sitter + LLM 混合分析

把確定性的事情交給靜態分析，把需要語意理解的事情交給 LLM：

- **Tree-sitter（確定性）** —— 將原始碼解析為具體語法樹，提取結構性事實：import、export、函式 / 類別定義、呼叫點、繼承關係。在 scan 階段預先解析為 `importMap` 並傳給 file-analyzer，避免它們再從原始碼推導一次 import。相同的輸入永遠得到相同的輸出，並作為增量更新的指紋基礎。
- **LLM（語意）** —— 讀取解析後的結構以及原始碼，產生解析器做不到的事：plain-English 摘要、標籤、架構層歸屬、業務領域映射、導覽路徑、語言概念標註。

正是這個分工讓圖譜在結構層面具備可重現性（同樣的程式碼總是產生同樣的邊），同時在語意層面也能捕捉意圖（一個檔案是「為了什麼」而存在，不只是它 import 了什麼）。

### 多智能體架構

`/understand` 指令呼叫 5 個 agent，`/understand-domain` 額外增加第 6 個：

| Agent | 職責 |
|-------|------|
| `project-scanner` | 掃描專案檔案，偵測語言和框架 |
| `file-analyzer` | 提取程式碼結構（函式、類別和匯入），產生圖節點和邊 |
| `architecture-analyzer` | 識別架構層 |
| `tour-builder` | 產生引導式學習路徑 |
| `graph-reviewer` | 驗證圖的完整性和參考完整性 |
| `domain-analyzer` | 提取業務領域、流程和處理步驟（由 `/understand-domain` 使用） |
| `article-analyzer` | 從 wiki 文章中提取實體、論斷和隱式關係（由 `/understand-knowledge` 使用） |

檔案分析器並行執行（最多 3 個並發）。支援增量更新 — 僅重新分析自上次執行以來發生變更的檔案。

---

## 🎥 社群

由 **Better Stack** 製作的社群影片導覽。

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Better Stack 製作的社群影片導覽 —— 點擊在 YouTube 觀看" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">在 YouTube 上觀看 &rarr;</a></em>
</p>

寫過影片、部落格或教學?開一個 issue 或 PR —— 我們很樂意將它放在這裡。

---

## 🤝 貢獻

歡迎貢獻！以下是貢獻指南：

1. Fork 專案
2. 新建分支（`git checkout -b feature/my-feature`）
3. 執行測試（`pnpm --filter @understand-anything/core test`）
4. 提交變更並建立 PR

對於重大變更，請先提交 issue，以便我們討論解決方案。

---

<p align="center">
  <strong>不再盲讀程式碼，而是理解整個系統</strong>
</p>

## Star 歷史記錄

<a href="https://www.star-history.com/?repos=Lum1104%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>感謝每一位使用過、貢獻過的朋友 —— 知道它替你們省下了一些時間，就是當初做它最值得的理由。</em>
</p>

<p align="center">
  MIT 授權條款 &copy; <a href="https://github.com/Lum1104">Lum1104</a>
</p>
