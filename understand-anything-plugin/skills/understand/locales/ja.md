# 日本語出力ガイドライン (Japanese)

本ファイルは、日本語でナレッジグラフコンテンツを生成する際の言語固有のガイドラインを提供します。

## タグの命名規則

日本語タグまたは英語の一般的な技術用語を使用：

| パターン | 推奨タグ |
|---------|---------|
| エントリーポイント | `入口点`, `barrel`, `exports` または `entry-point` |
| ユーティリティ | `ユーティリティ`, `helpers`, `utility` |
| APIハンドラー | `api-handler`, `controller`, `endpoint` |
| データモデル | `データモデル`, `entity`, `schema` または `data-model` |
| テストファイル | `テスト`, `unit-test`, `test` |
| 設定ファイル | `設定`, `build-system`, `configuration` |
| インフラ | `インフラ`, `deployment`, `infrastructure` |
| ドキュメント | `ドキュメント`, `guide`, `documentation` |

**混合戦略：** 一般的な技術用語は英語を保持（`middleware`, `api-handler`など）、説明用タグは日本語を使用可能。

## サマリーのスタイル

1-2文のサマリーを日本語で記述：
- ファイルの**目的**と**役割**を説明
- 能動態を使用（「提供する...」「処理する...」「管理する...」）
- ファイル名の繰り返しを避ける

**例：**
- 良い: "API層全体で使用される日付フォーマットと文字列サニタイズのヘルパー関数を提供。"
- 悪い: "utilsファイルにはユーティリティ関数が含まれています。"

## 技術用語

以下の用語は英語を保持（標準翻訳がない場合）：
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## レイヤー名

日本語のレイヤー名を使用：
- `API層`, `サービス層`, `データ層`, `UI層`
- `インフラ`, `設定`, `ドキュメント`
- `ユーティリティ層`, `ミドルウェア層`, `テスト層`

または英語を保持（チームの慣習に従う）：
- `API Layer`, `Service Layer`, `Data Layer`