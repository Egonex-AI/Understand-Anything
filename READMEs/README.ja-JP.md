<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>あらゆるコードベース、ナレッジベース、ドキュメントを、探索・検索・質問ができるインタラクティブなナレッジグラフに変換します。</strong>
  <br />
  <em>Claude Code、Codex、Cursor、Copilot、Gemini CLI など、マルチプラットフォーム対応。</em>
</p>

<p align="center">
  <strong>Understand Anything. <a href="https://egonex.ai">Understand Anyone.</a></strong>
  <br />
  <em>AI は人を置き換えるのではなく、人を支えるためにあるべきです。</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-クイックスタート"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="クイックスタート" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Homepage-d4a574" alt="ホームページ" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Live_Demo-00c853" alt="ライブデモ" /></a>
  <a href="https://egonex.ai"><img src="https://img.shields.io/badge/Understand_Anyone-egonex.ai-d4a574" alt="Understand Anyone" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — あらゆるコードベースをインタラクティブなナレッジグラフに変換" width="800" />
</p>

<p align="center">
  <strong><a href="https://github.com/Egonex-AI">Egonex</a> によるオープンソースプロジェクト</strong>
  <br />
  <em>原作者: <a href="https://github.com/Lum1104">Lum1104</a></em>
</p>

---

**新しいチームに参加したばかり。コードベースは20万行。どこから手をつければいいのか？**

Understand Anything は [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference) です。マルチエージェントパイプラインでプロジェクトを分析し、すべてのファイル・関数・クラス・依存関係のナレッジグラフを構築して、インタラクティブなダッシュボードで視覚的に探索できるようにします。コードを闇雲に読むのはやめて、全体像を把握しましょう。

> **目指すのは、コードベースの複雑さで圧倒するグラフではなく、すべてのパーツがどう噛み合っているかを静かに教えてくれるグラフ。**

---

## ✨ 機能

> [!NOTE]
> **すぐに試したいですか？** [ホームページ](https://understand-anything.com/)で[ライブデモ](https://understand-anything.com/demo/)をお試しください — パン、ズーム、検索、探索ができる完全インタラクティブなダッシュボードです。

### コード構造グラフを探索

コードベースをインタラクティブなナレッジグラフとして表示——すべてのファイル、関数、クラスがクリック・検索・探索可能なノードです。ノードを選択すると、わかりやすい要約、依存関係、ガイド付きツアーが表示されます。

### ビジネスロジックを理解

ドメインビューに切り替えると、コードが実際のビジネスプロセスにどう対応するかが一目でわかります——ドメイン、フロー、ステップが横方向のグラフとして表示されます。

### ナレッジベースを分析

`/understand-knowledge` を [Karpathy パターンの LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) に向けると、コミュニティクラスタリング付きのフォースディレクテッドナレッジグラフが生成されます。決定論的パーサーが `index.md` から wikilinks とカテゴリを抽出し、LLM エージェントが暗黙の関係を発見、エンティティを抽出、主張を浮き彫りにして、wiki をナビゲート可能な相互接続されたアイデアのグラフに変換します。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 ガイドツアー</h3>
      <p>依存関係順に並べられた、自動生成のアーキテクチャウォークスルー。正しい順序でコードベースを学べます。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 ファジー＆セマンティック検索</h3>
      <p>名前や意味で何でも検索できます。「認証を処理する部分は？」と検索すれば、グラフ全体から関連する結果が得られます。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 差分影響分析</h3>
      <p>コミット前に、変更がシステムのどの部分に影響するかを確認。コードベース全体への波及効果を把握できます。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 ペルソナ適応型UI</h3>
      <p>ダッシュボードは、ジュニア開発者・PM・パワーユーザーなど、ユーザーに応じて詳細レベルを調整します。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ レイヤー可視化</h3>
      <p>API・Service・Data・UI・Utilityなどのアーキテクチャ層ごとに自動グループ化。色分けされた凡例付き。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 言語コンセプト</h3>
      <p>ジェネリクス・クロージャ・デコレータなど12のプログラミングパターンが、出現箇所のコンテキストで説明されます。</p>
    </td>
  </tr>
</table>

---

## 🚀 クイックスタート

### 1. プラグインをインストール

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
/reload-plugins
```

> **ローカルモデルを使う場合:** プライバシーやエンタープライズ用途では、[Ollama](https://docs.ollama.com/integrations) などのローカルモデルプロバイダーにプラットフォームを向けてください。統合ガイドに従ってモデルプロバイダーを変更できます。

### 2. コードベースを分析

```bash
/understand
```

マルチエージェントパイプラインがプロジェクトをスキャンし、すべてのファイル・関数・クラス・依存関係を抽出して、`.ua/knowledge-graph.json` にナレッジグラフを保存します。（すでに `.understand-anything/` ディレクトリがあるプロジェクトはそれを引き続き使用します。存在する場合はそれがデータディレクトリのままなので、移行は不要です。）

> **トークン使用量にご注意:** 初回の `/understand` はコードベース全体を分析するため、大規模プロジェクトではかなりのトークンを消費することがあります。トークンプラン / サブスクリプションでの実行、または初期化にはローカルモデル（上記参照）の使用をおすすめします。以降の実行はデフォルトで増分処理され、変更されたファイルのみ再分析するため、消費トークンは大幅に少なくなります。

**ローカライズされた出力：** `--language` を使用して、希望の言語でコンテンツを生成：

```bash
# 日本語でコンテンツを生成（ナレッジグラフのノード説明とダッシュボードUI）
/understand --language ja

# サポート言語：en（デフォルト）、zh、zh-TW、ja、ko、ru
```

プロジェクトでの**初回実行時**に `--language` を指定せず、保存済みの言語設定もない場合、`/understand` は会話で使われている言語を検出します。英語以外が検出された場合は、生成前にその言語を使用するか、別の言語へ変更するかを確認します。英語での会話には影響しません。選択結果は `.ua/config.json` に保存され、以降の実行でも再利用されます。

`--language` パラメータは以下に影響します：
- ナレッジグラフのノードサマリーと説明
- ダッシュボードUIのラベル、ボタン、ツールチップ
- ガイド付きツアーの説明

### 3. ダッシュボードで探索

```bash
/understand-dashboard
```

インタラクティブなWebダッシュボードが開き、コードベースがグラフとして可視化されます。アーキテクチャ層ごとに色分けされ、検索やクリックが可能です。ノードを選択すると、コード・関連関係・平易な説明が表示されます。

### 4. さらに学ぶ

```bash
# コードベースについて何でも質問
/understand-chat 支払いフローはどう動いているの？

# 現在の変更の影響を分析
/understand-diff

# 特定のファイルや関数を詳しく調べる
/understand-explain src/auth/login.ts

# 新メンバー向けのオンボーディングガイドを生成
/understand-onboard

# ビジネスドメイン知識を抽出（ドメイン、フロー、ステップ）
/understand-domain

# Karpathy パターンの LLM Wiki ナレッジベースを分析
/understand-knowledge ~/path/to/wiki

# いつでも再実行 —— デフォルトでインクリメンタル（変更ファイルのみ再分析）
/understand

# post-commit フックをインストールしてコミットごとに自動更新
/understand --auto-update

# 巨大なモノレポでも安心 —— サブディレクトリにスコープを絞る
/understand src/frontend
```

---

## 🌐 マルチプラットフォームインストール

Understand-Anythingは複数のAIコーディングプラットフォームで動作します。

### Claude Code（ネイティブ）

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### ワンラインインストール（Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Trae / Nanobot / Kiro）

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# プラットフォームを直接指定して対話プロンプトをスキップすることもできます：
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows（PowerShell）：**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

インストーラーはリポジトリを `~/.understand-anything/repo` にクローンし、選択したプラットフォーム用のシンボリックリンクを作成します。完了後はCLI/IDEを再起動してください。

> **スキルの呼び出し方について：** 呼び出しのプレフィックスはプラットフォームごとに異なります。多くのプラットフォームはスラッシュコマンド（`/understand`）を使いますが、**Codexは`$`を使います** — `/understand`ではなく`$understand`と入力してください。どちらのプレフィックスも認識されない場合は、*「understandスキルを使ってこのプロジェクトを分析して」*のように自然言語で依頼できます。

- サポートされる `<platform>` 値：`gemini`、`codex`、`opencode`、`pi`、`openclaw`、`antigravity`、`vibe`、`vscode`、`hermes`、`cline`、`kimi`、`trae`、`nanobot`、`kiro`
- 後で更新：`./install.sh --update`
- アンインストール：`./install.sh --uninstall <platform>`

### Cursor

Cursorはこのリポジトリをクローンすると `.cursor-plugin/plugin.json` 経由でプラグインを自動検出します。手動インストールは不要です — クローンしてCursorで開くだけです。

自動検出されない場合は、手動でインストールしてください：**Cursor Settings → Plugins** を開き、検索欄に `https://github.com/Egonex-AI/Understand-Anything` を貼り付けて追加します。

### VS Code + GitHub Copilot

GitHub Copilot拡張機能（v1.108+）をインストールしたVS Codeは、`.copilot-plugin/plugin.json` 経由でプラグインを自動検出します。クローンしてVS Codeで開くだけで、手動インストールは不要です。

全プロジェクトで使用するパーソナルスキルとして導入したい場合は、上記の `install.sh` を `vscode` プラットフォームで実行してください。

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

インストール後：
- **Kiro CLI**：`kiro-cli chat --agent understand "このプロジェクトを解析して"`
- **Kiro IDE**：スキルは `~/.kiro/skills/` にシンボリックリンクされ、`understand` エージェントは `~/.kiro/agents/understand.json` に書き込まれます。そのため、IDEを再起動するとどちらも利用可能になります。

全プロジェクトで使用するパーソナルスキルとして導入したい場合は、上記の `install.sh` を `kiro` プラットフォームで実行してください。

### プラットフォーム互換性

| プラットフォーム | ステータス | インストール方法 |
|----------|--------|----------------|
| Claude Code | ✅ ネイティブ | プラグインマーケットプレイス |
| Cursor | ✅ サポート | 自動検出 |
| VS Code + GitHub Copilot | ✅ サポート | 自動検出 |
| Copilot CLI | ✅ サポート | プラグインインストール |
| Codex | ✅ サポート | `install.sh codex` |
| OpenCode | ✅ サポート | `install.sh opencode` |
| OpenClaw | ✅ サポート | `install.sh openclaw` |
| Antigravity | ✅ サポート | `install.sh antigravity` |
| Gemini CLI | ✅ サポート | `install.sh gemini` |
| Pi Agent | ✅ サポート | `install.sh pi` |
| Vibe CLI | ✅ サポート | `install.sh vibe` |
| Hermes | ✅ サポート | `install.sh hermes` |
| Cline | ✅ サポート | `install.sh cline` |
| KIMI CLI | ✅ サポート | `install.sh kimi` |
| Trae | ✅ サポート | `install.sh trae` |
| Nanobot | ✅ サポート | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ サポート | `install.sh kiro` |

---

## 📦 チームでグラフを共有する

グラフは単なる JSON ファイルです——**一度コミットすれば、チームメンバーはパイプラインを実行せずに済みます**。オンボーディング、PR レビュー、docs-as-code ワークフローに最適です。

> **例：** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) —— コミット済みのグラフを含む Go / Java / Python / Node のリファレンスプロジェクト。

**コミット対象：** `.ua/` 内のすべてのファイル。ただし `intermediate/` と `diff-overlay.json` は除きます（これらはローカルの一時ファイルです）。（レガシープロジェクトは `.understand-anything/` を使用します。そのディレクトリが存在する場合は、以下のディレクトリ名をそれに置き換えてください。）

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

**最新状態を保つ：** `/understand --auto-update` を有効にすると、post-commit フックがグラフを増分的に更新し、各コミットに対応するグラフが揃います。またはリリース前に `/understand` を手動で再実行します。

**大きなグラフ（10 MB 以上）：** **git-lfs** で管理します。

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### Claude Code なしでダッシュボードを表示する

グラフを生成してコミットしておけば、チームの誰でもコマンド一つで開けます。Claude Code も LLM も API キーも不要で、必要なのは Node.js（>= 18）だけです：

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /path/to/analyzed/project
```

ターミナルにトークン付き URL（`http://127.0.0.1:5173/?token=…`）が表示され、完全にインタラクティブなダッシュボードがブラウザで開きます。プロジェクトディレクトリ（デフォルト：カレントディレクトリ）には、コミットされたデータディレクトリ（`.ua/`、または旧来の `.understand-anything/`）が含まれている必要があります。すべてローカルディスクから読み取り専用で配信され、LLM 呼び出しは行われず、データがマシンの外に出ることはありません。

リポジトリのクローンから作業する場合は、`pnpm install && pnpm --filter @understand-anything/core build` の後に `GRAPH_DIR=/path/to/analyzed/project pnpm dev:dashboard` を実行すれば、Vite 開発サーバー経由で同じことができます。

---

## 🔧 内部の仕組み

### Tree-sitter + LLM ハイブリッド

決定論的にできることは静的解析、意味理解が必要なことは LLM、と役割を分けています：

- **Tree-sitter（決定論的）** —— ソースコードを具象構文木にパースし、構造的事実を抽出します：import、export、関数／クラス定義、呼び出し位置、継承関係。スキャンフェーズで `importMap` として事前解決し、file-analyzer に渡すことで、ソースから再度 import を導出する必要をなくしています。同じ入力からは常に同じ出力が得られ、インクリメンタル更新のフィンガープリントの基盤にもなります。
- **LLM（意味的）** —— パース済みの構造と原文ソースを併せて読み、パーサーには出せないものを生成します：plain-English の要約、タグ、アーキテクチャレイヤの割当、業務ドメインマッピング、ガイド付きツアー、言語コンセプトの注釈。

この分担により、構造面ではグラフが再現可能（同じコードからは常に同じエッジが出る）でありながら、意味面ではそのファイルが「何のために」あるのかという意図を捉えられます。

### マルチエージェントパイプライン

`/understand` コマンドは5つの専門エージェントをオーケストレーションし、`/understand-domain` は6つ目を追加します：

| エージェント | 役割 |
|-------|------|
| `project-scanner` | ファイルの検出、言語やフレームワークの検出 |
| `file-analyzer` | 関数・クラス・インポートの抽出、グラフノードとエッジの生成 |
| `architecture-analyzer` | アーキテクチャ層の特定 |
| `tour-builder` | ガイド学習ツアーの生成 |
| `graph-reviewer` | グラフの完全性と参照整合性を検証（デフォルトではインライン実行。LLMによる完全レビューは `--review` を使用） |
| `domain-analyzer` | ビジネスドメイン、フロー、処理ステップの抽出（`/understand-domain` で使用） |
| `article-analyzer` | wiki 記事からエンティティ、主張、暗黙の関係を抽出（`/understand-knowledge` で使用） |

ファイルアナライザーは並列実行されます（最大5つ同時、1バッチあたり20〜30ファイル）。インクリメンタル更新に対応しており、前回の実行から変更されたファイルのみを再分析します。

---

## 🎥 コミュニティ

**Better Stack** によるコミュニティ製ウォークスルー動画。

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Better Stack によるコミュニティ製ウォークスルー動画 — クリックして YouTube で視聴" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">YouTube で視聴 &rarr;</a></em>
</p>

動画、ブログ、チュートリアルを作成しましたか?Issue または PR を開いてください — ここで紹介させていただきます。

---

## 🤝 コントリビュート

コントリビュートを歓迎します！始め方は以下の通りです：

1. リポジトリをフォーク
2. フィーチャーブランチを作成（`git checkout -b feature/my-feature`）
3. テストを実行（`pnpm --filter @understand-anything/core test`）
4. 変更をコミットしてプルリクエストを作成

大きな変更については、まずIssueを作成してアプローチを議論してください。

---

<p align="center">
  <strong>コードを闇雲に読むのはやめよう。すべてを理解しよう。</strong>
</p>

## Star History

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>使ってくれた、貢献してくれたすべての方へ ── 少しでも時間を節約できていると知ること、それがこれを作って良かったと思える理由です。</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
