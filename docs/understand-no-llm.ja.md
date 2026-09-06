# Understand-Anything No-LLM Code Graph 拡張

## 1. この機能について

本機能は、Egonex-AI/Understand-Anything に追加する No-LLM Code Graph 生成機能です。

LLM や外部 AI API を使用せず、対象リポジトリを静的に解析して、次の情報だけを KnowledgeGraph 互換 JSON として生成します。

- ファイル
- 関数
- クラス
- ファイルとシンボルの包含関係
- リポジトリ内部の import 関係
- 静的に一意解決できた関数呼び出し関係

この機能は Understand-Anything から独立した製品ではありません。Tree-sitter、言語別 extractor、KnowledgeGraph schema など、既存 plugin の実装を再利用します。

## 2. オリジナル版との違い

No-LLM 版は、オリジナルの `/understand` と同じ KnowledgeGraph の外形を使用しますが、生成内容は同一ではありません。

| 項目 | オリジナル版 | No-LLM 版 |
|---|---|---|
| ソースコードの静的解析 | 使用 | 使用 |
| LLM による要約・解釈 | 使用 | 使用しない |
| File / Function / Class | 生成 | 生成 |
| Contains / Imports / Calls | 生成 | 生成 |
| Config / Document / Concept など | 生成可能 | 生成しない |
| アーキテクチャ Layer | 生成 | 空配列 |
| Tour | 生成 | 空配列 |
| Domain / Business Flow | 別機能として生成可能 | 生成しない |
| 自然言語による説明 | LLM が生成 | 定型文のみ |
| ソースコードの外部送信 | LLM 設定に依存 | 行わない |

したがって、本拡張の目的は「オリジナル版と同一の結果を再現すること」ではなく、「LLM を使用できない環境でも、コードの構造と依存関係を可視化できる最小の Code Graph を生成すること」です。

## 3. 技術構成

| 技術 | 用途 |
|---|---|
| Node.js / ES Modules | 実行基盤と処理のオーケストレーション |
| Tree-sitter | 言語別 AST 解析 |
| Understand-Anything Core | parser registry、型定義、schema validation |
| Zod | KnowledgeGraph JSON の検証 |
| Git | 対象 commit hash の取得、追跡ファイルの列挙 |
| pnpm workspace | Core、Dashboard、parser package の依存管理 |

対象リポジトリの build、test、アプリケーション、任意の shell script は実行しません。

## 4. 内部ファイル構成

```text
Understand-Anything/
├── docs/
│   └── understand-no-llm.ja.md
└── understand-anything-plugin/
    └── skills/
        ├── understand-no-llm/
        │   └── SKILL.md
        └── understand/
            └── no-llm-code-graph.mjs
```

本機能で追加するプログラムファイルは 2 つです。実行時には、既存 Understand-Anything plugin 内の deterministic parser 群と Core package を使用します。

### `skills/understand-no-llm/SKILL.md`

`/understand-no-llm` コマンドの定義です。

役割は次のとおりです。

- ユーザー引数から対象リポジトリを決定する
- インストール済み plugin の位置を解決する
- `no-llm-code-graph.mjs` を起動する
- 生成されたパスと件数をユーザーへ報告する

このファイル自体は静的解析を行いません。Codex、Claude Code などのホストに実行手順を伝える Skill 定義です。

### `skills/understand/no-llm-code-graph.mjs`

No-LLM Code Graph 生成処理のエントリーポイントです。

主な責務は次のとおりです。

1. CLI 引数と対象リポジトリを検証する
2. deterministic parser を順番に起動する
3. File / Function / Class node を作成する
4. Contains / Imports / Calls edge を作成する
5. KnowledgeGraph schema で検証する
6. Graph と実行レポートを書き出す
7. 指定がなければ中間ファイルを削除する

## 5. 実行時に再利用する既存ファイル

本機能は、既存 Understand-Anything plugin の次のファイルを再利用します。

| ファイルまたはディレクトリ | 入力 | 出力・役割 |
|---|---|---|
| `skills/understand/scan-project.mjs` | 対象リポジトリ | ファイル一覧、言語、カテゴリ、行数を生成 |
| `skills/understand/extract-import-map.mjs` | ファイル一覧 | リポジトリ内部ファイル間の import map を生成 |
| `skills/understand/extract-structure.mjs` | Code / Script ファイル | 関数、クラス、export、call graph を抽出 |
| `packages/core/src/plugins/tree-sitter-plugin.ts` | ファイル内容 | Tree-sitter parser を統一インターフェースで提供 |
| `packages/core/src/plugins/registry.ts` | parser 群 | 拡張子に合う parser を選択 |
| `packages/core/src/plugins/extractors/` | AST | 言語ごとの AST を共通構造へ変換 |
| `packages/core/src/languages/configs/` | ファイル名・拡張子 | 言語、grammar、解析設定を定義 |
| `packages/core/src/types.ts` | なし | KnowledgeGraph、Node、Edge の TypeScript 型を定義 |
| `packages/core/src/schema.ts` | 生成 Graph | Zod による形式検証と補正 |
| `packages/core/dist/` | Core source の build 結果 | 実行時に Node.js から読み込む module |
| `packages/dashboard/` | `knowledge-graph.json` | Graph の UI 表示。生成処理自体には不参加 |

## 6. 処理フロー

```text
対象リポジトリ
    |
    v
[1. Scan]
scan-project.mjs
    Input : project root
    Output: scan-result.json
    |
    v
[2. Import resolution]
extract-import-map.mjs
    Input : scan result の Code / Script files
    Output: import-map.json
    |
    v
[3. Structure extraction]
extract-structure.mjs + Tree-sitter
    Input : files + import map
    Output: function / class / export / call graph
    |
    v
[4. Graph assembly]
no-llm-code-graph.mjs
    Output: nodes[] + edges[]
    |
    v
[5. Validation]
Understand-Anything Core / Zod
    |
    v
code-graph.json + code-graph.report.json
```

### Scan

Git 管理対象ファイルを優先して列挙し、必要に応じて filesystem walk にフォールバックします。built-in ignore と `.understand-anything/.understandignore` を適用し、言語、ファイルカテゴリ、行数を判定します。

### Import resolution

コード中の import、require、use などを、実際のリポジトリ内部ファイルへ解決します。TypeScript path alias、Python module、Go module、Rust module、Java/Kotlin package、PHP Composer などのルールを扱います。外部 package は Code Graph の File node が存在しないため、edge の対象にしません。

### Structure extraction

Tree-sitter を使って AST を解析し、関数、クラス、export、呼び出し候補を抽出します。解析に失敗したファイルは全体を停止させず、report の skipped file として扱います。

### Graph assembly

次の node を生成します。

| Node type | ID 形式 | 内容 |
|---|---|---|
| File | `file:<path>` | ファイルパス、言語、行範囲、複雑度 |
| Function | `function:<path>:<name>` | 関数名、パラメータ、行範囲 |
| Class | `class:<path>:<name>` | クラス名、method 数、行範囲 |

次の edge を生成します。

| Edge type | Source | Target | 生成条件 |
|---|---|---|---|
| Contains | File | Function / Class | parser がシンボルを抽出できた場合 |
| Imports | File | File | import 先をリポジトリ内部ファイルへ解決できた場合 |
| Calls | Function / Class | Function / Class | caller と callee を一意に解決できた場合 |

Calls は安全側に倒して解決します。まず同一ファイル内の symbol を検索し、次にそのファイルが直接 import するファイルを検索します。候補がない場合、または複数候補がある場合は edge を生成せず、`unresolvedCalls` として report に計上します。

### Validation

生成した Graph をオリジナル版と同じ KnowledgeGraph schema で検証します。必須フィールド、node type、edge type、direction、complexity、参照先 node の存在などを確認します。

## 7. 必要条件

- Git
- Node.js 22 以上
- pnpm 10 以上
- build 可能な Understand-Anything checkout または install 済み plugin

既存 plugin root の例を次に示します。

```text
/path/to/Understand-Anything/understand-anything-plugin
```

## 8. セットアップ方法

### 8.1 Source checkout から使用する

リポジトリを取得し、plugin の依存関係と Core build を準備します。

```bash
cd /path/to/Understand-Anything/understand-anything-plugin
pnpm install --frozen-lockfile
pnpm --filter @understand-anything/core build
```

### 8.2 Slash command を使用する場合

使用中のホストが Skill を再検出できるよう、plugin の再インストールまたはホストの再起動が必要になる場合があります。

```text
/understand-no-llm /path/to/target-repository
```

ホストによる Skill 検出に依存したくない場合は、次節の Node.js 直接実行を使用します。

## 9. 使用方法

### 基本実行

```bash
node \
  /path/to/Understand-Anything/understand-anything-plugin/skills/understand/no-llm-code-graph.mjs \
  /path/to/target-repository
```

デフォルトでは次の 2 ファイルを生成します。

```text
<target-repository>/.understand-anything/code-graph.json
<target-repository>/.understand-anything/code-graph.report.json
```

### 利用可能なオプション

| オプション | 動作 |
|---|---|
| `--output=<path>` | Graph の出力先を変更する |
| `--write-knowledge-graph` | Graph を `knowledge-graph.json` にもコピーする |
| `--no-scripts` | Shell、Batch、PowerShell を除外し、Code category だけを解析する |
| `--keep-intermediate` | Scan、Import、Structure の中間 JSON を保持する |
| `--help` | Usage を表示する |

例：中間ファイルを残す場合

```bash
node /path/to/no-llm-code-graph.mjs \
  /path/to/target-repository \
  --keep-intermediate
```

例：Dashboard 用ファイルも生成する場合

```bash
node /path/to/no-llm-code-graph.mjs \
  /path/to/target-repository \
  --write-knowledge-graph
```

注意：`--write-knowledge-graph` は、既存の `.understand-anything/knowledge-graph.json` を上書きします。LLM 版の Graph を残す必要がある場合は、事前に別名で保存するか、このオプションを使用しないでください。

## 10. 生成ファイル

### `code-graph.json`

Dashboard と互換性を持つ Code Graph 本体です。

```json
{
  "version": "1.0.0",
  "kind": "codebase",
  "project": {
    "name": "example-project",
    "languages": ["typescript"],
    "frameworks": [],
    "description": "Deterministic no-LLM code graph...",
    "analyzedAt": "...",
    "gitCommitHash": "..."
  },
  "nodes": [],
  "edges": [],
  "layers": [],
  "tour": []
}
```

`frameworks`、`layers`、`tour` は、LLM による意味解釈を行わないため空です。

### `code-graph.report.json`

実行結果と解析カバレッジを確認するためのレポートです。

主な項目は次のとおりです。

- 読み取ったファイル数
- Code / Script ファイル数
- Node / Edge 数
- Imports / Contains / Calls の件数
- 解決できた call 数
- 解決できなかった call 数
- parser が処理できなかったファイル数
- schema validation warning

### 中間ファイル

`--keep-intermediate` を指定した場合だけ、次のファイルを保持します。

```text
.understand-anything/intermediate/no-llm-code-graph/
├── scan-result.json
├── import-input.json
├── import-map.json
├── structure-input.json
└── structure-output.json
```

通常実行では、最終 Graph を生成した後にこのディレクトリを削除します。

## 11. セキュリティと責任境界

### 実行する処理

- 対象リポジトリ内ファイルの読み取り
- Understand-Anything 自身の Node.js analyzer の実行
- Git commit hash の読み取り
- `.understand-anything/` 以下への JSON 書き込み

### 実行しない処理

- 対象リポジトリの application 起動
- `npm install`、`cargo build`、`pytest` など対象側の command 実行
- 対象リポジトリ内 shell script の実行
- LLM API の呼び出し
- ソースコードの外部送信
- network access を必要とする解析

### 利用者側の責任

- 対象リポジトリを読み取る権限があることを確認する
- 生成 JSON にファイル名、関数名、クラス名が含まれることを理解する
- Graph を外部公開する前に機密識別子が含まれていないか確認する
- `--write-knowledge-graph` による既存 Graph の上書きを管理する
- 静的解析結果をセキュリティ検査や完全な call graph と同一視しない

## 12. 制約事項

- 動的 dispatch、reflection、runtime dependency injection は正確に解決できません。
- 同名関数が複数存在して一意に決められない場合、Calls edge を生成しません。
- parser が対応していない言語や文法では、File node だけになる場合があります。
- Function / Class の件数がオリジナル LLM 版と一致する保証はありません。
- 生成する summary は定型文であり、処理の業務的意味を説明しません。
- architecture、domain、business flow、tour は生成しません。
- `unresolvedCalls` が多いことは異常終了を意味せず、静的に一意解決できなかった候補数を示します。

## 13. トラブルシューティング

### `@understand-anything/core` を読み込めない

Core package を build します。

```bash
cd /path/to/Understand-Anything/understand-anything-plugin
pnpm install --frozen-lockfile
pnpm --filter @understand-anything/core build
```

### Graph の Node が 0 件になる

- 対象パスが正しいか確認する
- `.understand-anything/.understandignore` の除外条件を確認する
- 対象言語に対応する parser が存在するか確認する
- `--no-scripts` によって対象ファイルが除外されていないか確認する

### Calls edge が少ない

`code-graph.report.json` の `unresolvedCalls` を確認します。現在の resolver は、同一ファイルまたは直接 import 先で callee を一意に決定できる場合だけ edge を生成します。

### Dashboard に表示されない

Dashboard は通常 `.understand-anything/knowledge-graph.json` を読み取ります。既存ファイルのバックアップ方針を決めた上で、`--write-knowledge-graph` を使用してください。

## 14. ライセンス

リポジトリルートの `LICENSE` を参照してください。

作成日: 2026-07-16
