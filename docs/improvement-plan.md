# Understand Anything 改修計画

## 1. 現在の処理フロー

```
/understand --language ja
     │
     ▼
Phase 0: Pre-flight
  └─ PROJECT_ROOT解決、config.json読込（outputLanguage含む）
     │
     ▼
Phase 1: Project Scan
  └─ agents/project-scanner.md
     └─ scan-project.mjs → ファイル一覧・言語・カテゴリ
     └─ extract-import-map.mjs → importMap生成
     └─ 出力: intermediate/scan-result.json
     │
     ▼
Phase 2: File Analysis（バッチ並列）
  └─ agents/file-analyzer.md（複数インスタンス）
     └─ extract-structure.mjs → tree-sitter構造抽出
     └─ LLM: summary, tags, complexity, edges生成
     └─ $LANGUAGE_DIRECTIVE → 日本語出力指示
     └─ locales/ja.md → タグ・サマリーのスタイルガイド
     └─ 出力: intermediate/batch-N.json
     │
     ▼
Phase 3-5: Architecture / Domain / Tour Analysis
  └─ agents/architecture-analyzer.md → layers生成
  └─ agents/domain-analyzer.md → domain/flow/step生成
  └─ agents/tour-builder.md → tour生成
     │
     ▼
Phase 6: Assembly
  └─ merge-batch-graphs.py → assembled-graph.json統合
  └─ graph-reviewer（optional）
  └─ 出力: knowledge-graph.json
     │
     ▼
Phase 7: Dashboard起動
  └─ /understand-dashboard スキル自動起動
  └─ vite dev server → ブラウザ表示
  └─ I18nProvider(language) → ブラウザ言語 or config.json
```

### knowledge-graph.json スキーマ

```typescript
interface KnowledgeGraph {
  nodes: GraphNode[];   // id, type, name, filePath?, lineRange?, summary, tags, complexity, languageNotes?
  edges: GraphEdge[];   // source, target, type, direction, weight
  layers: Layer[];      // id, name, description, nodeIds
  tour: TourStep[];     // order, title, description, nodeIds, languageLesson?
  project: ProjectMeta; // name, languages, frameworks, analyzedAt, gitCommitHash
  version: string;
}
```

### EventCalendar_App 生成結果

- ノード数: 261、エッジ数: 352
- summaryは日本語で生成済み（`--language ja`動作確認済）
- layers: 日本語名（「プロジェクト概要とドキュメント」「設定・運用」等）
- tour: 日本語（「アプリの入口」「イベント一覧を表示する」等）
- データ場所: `.understand-anything/` （レガシーディレクトリ）

---

## 2. 変更対象ファイル

### Track 1: 日本語対応の改善

**目的:** ダッシュボードUI/分析出力の日本語品質向上。未翻訳箇所の補完。

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/locales/ja.ts` | 翻訳品質改善、不自然な訳の修正、未翻訳キーの追加 |
| `packages/dashboard/src/locales/index.ts` | デフォルト言語の自動検出ロジック改善（ブラウザ言語→config.json優先順位） |
| `packages/dashboard/src/contexts/I18nContext.tsx` | language prop のフォールバック改善 |
| `skills/understand/locales/ja.md` | タグ命名・サマリースタイルガイド拡充 |
| `agents/file-analyzer.md` | Language directiveの適用範囲確認（読み取り専用参照） |
| `agents/architecture-analyzer.md` | レイヤー名・description の日本語品質チェック（読み取り専用参照） |
| `agents/tour-builder.md` | ツアーtitle/descriptionの日本語品質チェック（読み取り専用参照） |

### Track 2: ファイル単位の詳細解説

**目的:** ノード選択時に「このファイルは何をしている？」をワンクリックで表示。

| ファイル | 変更内容 |
|---------|---------|
| `packages/core/src/types.ts` | GraphNode に `explanation?: string` フィールド追加 |
| `packages/core/src/schema.ts` | スキーマバリデーションに explanation を許可 |
| `agents/file-analyzer.md` | Phase 2 に explanation 生成ロジック追加 |
| `packages/dashboard/src/components/NodeInfo.tsx` | 「解説を見る」ボタン＋解説パネルUI追加 |
| `packages/dashboard/src/store.ts` | explanation表示状態の管理（展開/折りたたみ） |

### Track 3: グラフUI/UXの改善

**目的:** ノード表示の視認性、操作性、レイアウト品質の改善。

| ファイル | 変更内容 |
|---------|---------|
| `packages/dashboard/src/components/GraphView.tsx` | レイアウト改善、ズーム/パン操作性向上 |
| `packages/dashboard/src/components/CustomNode.tsx` | ノードデザイン改善（アイコン、ラベル視認性） |
| `packages/dashboard/src/components/ContainerNode.tsx` | グループノード表示改善 |
| `packages/dashboard/src/components/FlowNode.tsx` | フローノード表示改善 |
| `packages/dashboard/src/components/NodeTooltip.tsx` | ホバー時ツールチップ改善 |
| `packages/dashboard/src/components/ProjectOverview.tsx` | 概要画面のレイアウト改善 |
| `packages/dashboard/src/components/SearchBar.tsx` | 検索UX改善 |
| `packages/dashboard/src/utils/elk-layout.ts` | ELKレイアウトパラメータ調整 |
| `packages/dashboard/src/utils/force-layout.ts` | Force-directedレイアウト調整 |
| `packages/dashboard/src/themes/presets.ts` | テーマ微調整（コントラスト改善等） |

---

## 3. 担当境界

```
┌──────────────────────────────────────────────────────────┐
│                    packages/core/src/                     │
│                                                          │
│  types.ts ──────────────── Track 2 専有                  │
│  schema.ts ─────────────── Track 2 専有                  │
│  search.ts ─────────────── 共通（変更なし予定）           │
│  その他 ────────────────── 共通（変更なし予定）           │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│               packages/dashboard/src/                    │
│                                                          │
│  locales/ja.ts ─────────── Track 1 専有                  │
│  locales/index.ts ──────── Track 1 専有                  │
│  contexts/I18nContext.tsx ─ Track 1 専有                  │
│                                                          │
│  components/NodeInfo.tsx ── Track 2 専有 ⚠️              │
│  store.ts ──────────────── Track 2 + Track 3 共有 ⚠️     │
│                                                          │
│  components/GraphView.tsx ─ Track 3 専有                  │
│  components/CustomNode.tsx  Track 3 専有                  │
│  components/ContainerNode   Track 3 専有                  │
│  components/FlowNode.tsx ── Track 3 専有                  │
│  components/NodeTooltip.tsx Track 3 専有                  │
│  components/ProjectOverview Track 3 専有                  │
│  components/SearchBar.tsx ─ Track 3 専有                  │
│  utils/elk-layout.ts ───── Track 3 専有                  │
│  utils/force-layout.ts ─── Track 3 専有                  │
│  themes/presets.ts ──────── Track 3 専有                  │
│  App.tsx ───────────────── 共通 ⚠️                       │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│          skills/understand/ & agents/                     │
│                                                          │
│  locales/ja.md ─────────── Track 1 専有                  │
│  agents/file-analyzer.md ── Track 2 専有                  │
│  SKILL.md ──────────────── 共通参照（基本変更なし）       │
└──────────────────────────────────────────────────────────┘
```

### ⚠️ 競合リスクのあるファイル

#### `store.ts` — Track 2 + Track 3 共有

- **Track 2** が追加: `explanationExpanded` state、`toggleExplanation()` action
- **Track 3** が変更可能性: ナビゲーション関連 state、フィルター関連
- **対策:** Zustand の store は `create()` 内のフラットオブジェクト。各 Track は自分の state/action を store 末尾に追加し、既存の state/action を改変しない。マージ時にプロパティ名が衝突しないよう、Track 2 は `explanation` prefix、Track 3 は `layout`/`ui` prefix を使う。

#### `App.tsx` — 全 Track 潜在的共有

- **Track 1**: `I18nProvider` の language prop 変更の可能性（低い）
- **Track 2**: 新コンポーネント `FileExplanation` の追加 import（低い）
- **Track 3**: レイアウト構造変更の可能性
- **対策:** App.tsx への変更は最小限にとどめ、ロジックは各コンポーネント内に閉じ込める。import 追加は行末追加で衝突しにくい。

#### `NodeInfo.tsx` — Track 2 専有だが Track 3 の影響を受ける可能性

- **Track 2** が追加: 解説ボタン・パネル
- **Track 3** がサイドバー幅やスクロール挙動を変える場合に影響
- **対策:** Track 3 は NodeInfo の内部構造を変更しない。サイドバー外枠の変更のみ許可。

---

## 4. 共通データ仕様

### knowledge-graph.json 拡張（Track 2）

```typescript
// 既存 GraphNode への追加フィールド
interface GraphNode {
  // ... 既存フィールド
  explanation?: string;  // Track 2 追加: ファイルの詳細解説（日本語/英語）
}
```

- `explanation` は optional。既存グラフとの後方互換性を維持。
- 生成タイミング: file-analyzer Phase 2 で summary と同時に生成。
- 文字数目安: 200-500文字（summary の 1-2文より詳細、ただし冗長にならない程度）。
- 言語: `$LANGUAGE_DIRECTIVE` に従う（Track 1 の日本語設定と連動）。

### i18n キー追加規約（Track 1 + Track 2 共通）

- `en.ts` にキーを追加 → 同時に `ja.ts` にも追加すること
- キー名は `camelCase`、セクション区切りはネストオブジェクト
- Track 2 が追加するキー例: `nodeInfo.showExplanation`, `nodeInfo.explanation`, `nodeInfo.noExplanation`

### store.ts 拡張規約（Track 2 + Track 3 共通）

- 新しい state プロパティは TypeScript の `DashboardState` interface に追加
- Track 2 prefix: `explanation*` （例: `explanationExpanded`）
- Track 3 prefix: `layout*`, `ui*` （例: `layoutEngine`, `uiSidebarWidth`）
- 既存プロパティのリネーム・削除は禁止（他 Track に影響するため）

---

## 5. テスト方法

### ビルド・テスト・起動コマンド

```bash
# 依存関係インストール
pnpm install

# core パッケージビルド
pnpm --filter @understand-anything/core build

# skill パッケージビルド
pnpm --filter @understand-anything/skill build

# 全テスト実行
pnpm test

# core テストのみ
pnpm --filter @understand-anything/core test

# dashboard ビルド
pnpm --filter @understand-anything/dashboard build

# dashboard 開発サーバー起動
pnpm dev:dashboard

# lint
pnpm lint
```

### Track 別テスト手順

#### Track 1: 日本語対応

1. `pnpm --filter @understand-anything/dashboard build` — ビルドエラーなし確認
2. `pnpm dev:dashboard` — 開発サーバーでUI確認
3. ブラウザ言語を `ja` に設定してダッシュボード表示 → 全UIが日本語であること
4. EventCalendar_App の既存 knowledge-graph.json を読み込み → 日本語 summary/layer/tour が正しく表示されること
5. 翻訳キーの型一貫性: `en.ts` と `ja.ts` のキー構造が一致すること（TypeScript の型 `Locale = typeof en` が保証）

#### Track 2: ファイル詳細解説

1. `pnpm --filter @understand-anything/core build` → `pnpm --filter @understand-anything/core test`
2. `packages/core/src/__tests__/schema.test.ts` — explanation フィールドがバリデーション通過すること
3. `pnpm dev:dashboard` → ノードクリック → 「解説」ボタン表示 → クリックで解説パネル展開
4. explanation が未定義のノードで「解説」ボタンが非表示 or 適切なフォールバック表示
5. 既存 knowledge-graph.json（explanation なし）を読み込んでもエラーにならないこと

#### Track 3: グラフUI/UX

1. `pnpm dev:dashboard` → 開発サーバーでUI確認
2. EventCalendar_App の knowledge-graph.json (261ノード) でパフォーマンス確認
3. `node scripts/generate-large-graph.mjs 3000` でストレステスト
4. ノードのクリック、ドラッグ、ズーム、パンの操作性
5. モバイルレスポンシブ確認（`MobileLayout.tsx` 経由）
6. テーマ切替（ThemePicker）で表示崩れがないこと

### 検証用データ

- **小規模:** EventCalendar_App `.understand-anything/knowledge-graph.json`（261ノード）
- **大規模:** `node scripts/generate-large-graph.mjs 3000` で生成（3000ノード）

---

## 6. 既知の競合リスク

| リスク | 影響Track | 重大度 | 対策 |
|-------|----------|--------|------|
| `store.ts` に複数 Track が state 追加 | 2, 3 | 中 | prefix 規約で名前衝突回避。マージ順は Track 2 → Track 3 |
| `App.tsx` に複数 Track が import 追加 | 1, 2, 3 | 低 | import はファイル先頭に追加。コンポーネント配置は各自のエリア内 |
| NodeInfo 内部構造と sidebar レイアウト | 2, 3 | 中 | Track 3 は NodeInfo 内部を変更しない。外枠のみ |
| `en.ts`/`ja.ts` にキー追加が同時発生 | 1, 2 | 低 | 各自のセクション（nodeInfo.explanation* vs 既存キー修正）で分離 |
| core の types.ts 変更が dashboard に影響 | 2 | 低 | explanation は optional フィールド。既存コードは影響なし |
| schema.ts 変更がテストに影響 | 2 | 低 | schema.test.ts に explanation 用テストを追加 |

---

## 7. 開発の推奨順序

1. **Track 2（ファイル詳細解説）を最初にマージ** — core/types.ts のスキーマ変更は他の Track の前に確定させるべき
2. **Track 1（日本語対応）は独立して進行可能** — locales/ ファイルのみで完結し、他 Track との競合リスクが最も低い
3. **Track 3（グラフUI/UX）は最後にマージ** — UIレイアウト変更の影響範囲が広く、Track 2 の NodeInfo 追加後にデザイン調整が必要になる可能性あり

### ブランチ戦略

```
main
 ├── feat/i18n-japanese-improvement      (Track 1)
 ├── feat/file-explanation               (Track 2)
 └── feat/graph-ui-ux                    (Track 3)
```

各 Track は `main` から分岐し、独立して PR を作成。マージ順は Track 2 → Track 1 → Track 3 を推奨。
