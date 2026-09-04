import type { EdgeType, NodeType } from "@understand-anything/core/types";
import type { Complexity, EdgeCategory } from "../store";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import type { LocaleKey } from "./index";

type Localized<T extends string> = Record<LocaleKey, Record<T, string>>;

/** Complete display names for graph values, kept separate from category labels. */
export const nodeTypeLabels: Localized<NodeType> = {
  en: { file: "File", function: "Function", class: "Class", module: "Module", concept: "Concept", config: "Configuration", document: "Document", service: "Service", table: "Table", endpoint: "Endpoint", pipeline: "Pipeline", schema: "Schema", resource: "Resource", domain: "Domain", flow: "Flow", step: "Step", article: "Article", entity: "Entity", topic: "Topic", claim: "Claim", source: "Source", page: "Page", screen: "Screen", component: "Component", componentSet: "Component set", instance: "Instance", token: "Token" },
  ja: { file: "ファイル", function: "関数", class: "クラス", module: "モジュール", concept: "概念", config: "設定", document: "ドキュメント", service: "サービス", table: "テーブル", endpoint: "エンドポイント", pipeline: "パイプライン", schema: "スキーマ", resource: "リソース", domain: "ドメイン", flow: "フロー", step: "ステップ", article: "記事", entity: "エンティティ", topic: "トピック", claim: "主張", source: "ソース", page: "ページ", screen: "画面", component: "コンポーネント", componentSet: "コンポーネントセット", instance: "インスタンス", token: "トークン" },
  zh: { file: "文件", function: "函数", class: "类", module: "模块", concept: "概念", config: "配置", document: "文档", service: "服务", table: "数据表", endpoint: "端点", pipeline: "流水线", schema: "模式", resource: "资源", domain: "领域", flow: "流程", step: "步骤", article: "文章", entity: "实体", topic: "主题", claim: "主张", source: "来源", page: "页面", screen: "屏幕", component: "组件", componentSet: "组件集", instance: "实例", token: "令牌" },
  "zh-TW": { file: "檔案", function: "函式", class: "類別", module: "模組", concept: "概念", config: "設定", document: "文件", service: "服務", table: "資料表", endpoint: "端點", pipeline: "管線", schema: "結構描述", resource: "資源", domain: "領域", flow: "流程", step: "步驟", article: "文章", entity: "實體", topic: "主題", claim: "主張", source: "來源", page: "頁面", screen: "畫面", component: "元件", componentSet: "元件集", instance: "實例", token: "權杖" },
  ko: { file: "파일", function: "함수", class: "클래스", module: "모듈", concept: "개념", config: "설정", document: "문서", service: "서비스", table: "테이블", endpoint: "엔드포인트", pipeline: "파이프라인", schema: "스키마", resource: "리소스", domain: "도메인", flow: "흐름", step: "단계", article: "문서", entity: "엔티티", topic: "주제", claim: "주장", source: "출처", page: "페이지", screen: "화면", component: "컴포넌트", componentSet: "컴포넌트 세트", instance: "인스턴스", token: "토큰" },
  ru: { file: "Файл", function: "Функция", class: "Класс", module: "Модуль", concept: "Концепция", config: "Конфигурация", document: "Документ", service: "Сервис", table: "Таблица", endpoint: "Конечная точка", pipeline: "Конвейер", schema: "Схема", resource: "Ресурс", domain: "Домен", flow: "Поток", step: "Шаг", article: "Статья", entity: "Сущность", topic: "Тема", claim: "Утверждение", source: "Источник", page: "Страница", screen: "Экран", component: "Компонент", componentSet: "Набор компонентов", instance: "Экземпляр", token: "Токен" },
};

export const complexityLabels: Localized<Complexity> = {
  en: { simple: "Simple", moderate: "Moderate", complex: "Complex" },
  ja: { simple: "単純", moderate: "中程度", complex: "複雑" },
  zh: { simple: "简单", moderate: "中等", complex: "复杂" },
  "zh-TW": { simple: "簡單", moderate: "中等", complex: "複雜" },
  ko: { simple: "단순", moderate: "중간", complex: "복잡" },
  ru: { simple: "Простой", moderate: "Средний", complex: "Сложный" },
};

export const edgeCategoryLabels: Localized<EdgeCategory> = {
  en: { structural: "Structural", behavioral: "Behavioral", "data-flow": "Data flow", dependencies: "Dependencies", semantic: "Semantic", infrastructure: "Infrastructure", domain: "Domain", knowledge: "Knowledge", design: "Design" },
  ja: { structural: "構造", behavioral: "振る舞い", "data-flow": "データフロー", dependencies: "依存関係", semantic: "意味関係", infrastructure: "インフラ", domain: "ドメイン", knowledge: "ナレッジ", design: "デザイン" },
  zh: { structural: "结构", behavioral: "行为", "data-flow": "数据流", dependencies: "依赖", semantic: "语义", infrastructure: "基础设施", domain: "领域", knowledge: "知识", design: "设计" },
  "zh-TW": { structural: "結構", behavioral: "行為", "data-flow": "資料流", dependencies: "相依性", semantic: "語意", infrastructure: "基礎設施", domain: "領域", knowledge: "知識", design: "設計" },
  ko: { structural: "구조", behavioral: "동작", "data-flow": "데이터 흐름", dependencies: "종속성", semantic: "의미", infrastructure: "인프라", domain: "도메인", knowledge: "지식", design: "디자인" },
  ru: { structural: "Структура", behavioral: "Поведение", "data-flow": "Поток данных", dependencies: "Зависимости", semantic: "Семантика", infrastructure: "Инфраструктура", domain: "Домен", knowledge: "Знания", design: "Дизайн" },
};

export interface BeginnerGuideCopy {
  title: string;
  projectPurpose: string;
  majorScreens: string;
  dataStorage: string;
  noDescription: string;
  noScreens: string;
  noStorage: string;
  screensAnswer: (screens: string) => string;
  storageAnswer: (locations: string) => string;
}

export const beginnerGuideCopy: Record<LocaleKey, BeginnerGuideCopy> = {
  en: { title: "Start here", projectPurpose: "What does this project do?", majorScreens: "Which are the major screens?", dataStorage: "Where is the data stored?", noDescription: "This graph does not include a project description.", noScreens: "This graph does not provide evidence for major screens.", noStorage: "This graph does not provide evidence for data storage.", screensAnswer: (screens) => `The graph identifies these screens or UI entry points: ${screens}.`, storageAnswer: (locations) => `The graph identifies these data stores: ${locations}.` },
  ja: { title: "はじめに", projectPurpose: "このプロジェクトは何をするアプリですか？", majorScreens: "主要な画面はどれですか？", dataStorage: "データはどこに保存されていますか？", noDescription: "このグラフにはプロジェクトの説明がありません。", noScreens: "このグラフから主要な画面を確認できる根拠はありません。", noStorage: "このグラフからデータの保存先を確認できる根拠はありません。", screensAnswer: (screens) => `グラフから、次の画面またはUIの入口を確認できます: ${screens}。`, storageAnswer: (locations) => `グラフから、次のデータ保存先を確認できます: ${locations}。` },
  zh: { title: "从这里开始", projectPurpose: "这个项目是做什么的？", majorScreens: "主要界面有哪些？", dataStorage: "数据存储在哪里？", noDescription: "此图谱没有项目说明。", noScreens: "此图谱没有足够证据确认主要界面。", noStorage: "此图谱没有足够证据确认数据存储位置。", screensAnswer: (screens) => `图谱识别出这些界面或 UI 入口：${screens}。`, storageAnswer: (locations) => `图谱识别出这些数据存储：${locations}。` },
  "zh-TW": { title: "從這裡開始", projectPurpose: "這個專案是做什麼的？", majorScreens: "主要畫面有哪些？", dataStorage: "資料儲存在哪裡？", noDescription: "此圖譜沒有專案說明。", noScreens: "此圖譜沒有足夠證據確認主要畫面。", noStorage: "此圖譜沒有足夠證據確認資料儲存位置。", screensAnswer: (screens) => `圖譜辨識出這些畫面或 UI 入口：${screens}。`, storageAnswer: (locations) => `圖譜辨識出這些資料儲存位置：${locations}。` },
  ko: { title: "여기서 시작", projectPurpose: "이 프로젝트는 무엇을 하나요?", majorScreens: "주요 화면은 무엇인가요?", dataStorage: "데이터는 어디에 저장되나요?", noDescription: "이 그래프에는 프로젝트 설명이 없습니다.", noScreens: "이 그래프에는 주요 화면을 확인할 근거가 없습니다.", noStorage: "이 그래프에는 데이터 저장 위치를 확인할 근거가 없습니다.", screensAnswer: (screens) => `그래프에서 다음 화면 또는 UI 진입점을 확인할 수 있습니다: ${screens}.`, storageAnswer: (locations) => `그래프에서 다음 데이터 저장소를 확인할 수 있습니다: ${locations}.` },
  ru: { title: "Начните здесь", projectPurpose: "Что делает этот проект?", majorScreens: "Какие экраны являются основными?", dataStorage: "Где хранятся данные?", noDescription: "В этом графе нет описания проекта.", noScreens: "В этом графе нет подтверждений основных экранов.", noStorage: "В этом графе нет подтверждений места хранения данных.", screensAnswer: (screens) => `Граф показывает такие экраны или точки входа UI: ${screens}.`, storageAnswer: (locations) => `Граф показывает такие хранилища данных: ${locations}.` },
};

function uniqueNodeEvidence(nodes: KnowledgeGraph["nodes"], ids: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const id of ids) {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    const evidence = node.filePath ?? node.name;
    if (!evidence || seen.has(evidence)) continue;
    seen.add(evidence);
    names.push(evidence);
  }
  return names;
}

function uniqueEvidence(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isUiLayer(layer: KnowledgeGraph["layers"][number]): boolean {
  return /(?:^|[:\-_\s])ui(?:$|[:\-_\s]|層)|画面|表示|interface|frontend|front-end/i.test(`${layer.id} ${layer.name}`);
}

function isStorageLayer(layer: KnowledgeGraph["layers"][number]): boolean {
  return /data|storage|database|db|保存|データ|資料|данн|数据/i.test(`${layer.id} ${layer.name}`);
}

function isScreenEvidence(node: KnowledgeGraph["nodes"][number]): boolean {
  const path = node.filePath ?? "";
  return node.type === "page" || node.type === "screen" || /(^|\/)(pages?|screens?|views?)(\/|$)|\/app\/.*page\./i.test(path);
}

function isScreenText(value: string): boolean {
  return /screen|page|view|dashboard|frontend|front-end|interface|ui|画面|ページ|表示|화면|页面|畫面|экран/i.test(value);
}

function isStorageEvidence(node: KnowledgeGraph["nodes"][number]): boolean {
  const path = node.filePath ?? "";
  return node.type === "table" || node.type === "schema" || /migration|schema|database|storage|supabase/i.test(path);
}

function isStorageText(value: string): boolean {
  return /data|storage|database|db|schema|table|persist|migration|supabase|保存|データ|資料|табл|данн|数据|資料|테이블/i.test(value);
}

export function deriveBeginnerGuide(
  graph: KnowledgeGraph,
  locale: LocaleKey,
): { purpose: string; screens: string; storage: string } {
  const copy = beginnerGuideCopy[locale];
  const purpose = graph.project.description?.trim() || copy.noDescription;
  const uiLayers = graph.layers.filter(isUiLayer);
  const uiLayerIds = new Set(uiLayers.flatMap((layer) => layer.nodeIds));
  const screenIds = [
    ...graph.nodes.filter(isScreenEvidence).map((node) => node.id),
    ...graph.nodes.filter((node) => uiLayerIds.has(node.id) && isScreenEvidence(node)).map((node) => node.id),
    ...graph.tour.flatMap((step) => step.nodeIds).filter((id) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node ? isScreenEvidence(node) : false;
    }),
  ];
  const screenEvidence = uniqueEvidence([
    ...uniqueNodeEvidence(graph.nodes, screenIds),
    ...uiLayers.map((layer) => layer.name),
    ...graph.tour
      .filter((step) => isScreenText(`${step.title} ${step.description}`))
      .map((step) => step.title),
  ]).slice(0, 5);

  const storageLayers = graph.layers.filter(isStorageLayer);
  const storageLayerIds = new Set(storageLayers.flatMap((layer) => layer.nodeIds));
  const storageIds = [
    ...graph.nodes.filter(isStorageEvidence).map((node) => node.id),
    ...graph.nodes.filter((node) => storageLayerIds.has(node.id) && isStorageEvidence(node)).map((node) => node.id),
    ...graph.tour.flatMap((step) => step.nodeIds).filter((id) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node ? isStorageEvidence(node) : false;
    }),
  ];
  const storageEvidence = uniqueEvidence([
    ...uniqueNodeEvidence(graph.nodes, storageIds),
    ...storageLayers.map((layer) => layer.name),
    ...graph.tour
      .filter((step) => isStorageText(`${step.title} ${step.description}`))
      .map((step) => step.title),
  ]).slice(0, 5);

  return {
    purpose,
    screens: screenEvidence.length > 0 ? copy.screensAnswer(screenEvidence.join(", ")) : copy.noScreens,
    storage: storageEvidence.length > 0 ? copy.storageAnswer(storageEvidence.join(", ")) : copy.noStorage,
  };
}

export function nodeTypeLabel(locale: LocaleKey, type: string): string {
  return nodeTypeLabels[locale][type as NodeType] ?? type;
}

export function complexityLabel(locale: LocaleKey, complexity: string): string {
  return complexityLabels[locale][complexity as Complexity] ?? complexity;
}

export function edgeCategoryLabel(locale: LocaleKey, category: string): string {
  return edgeCategoryLabels[locale][category as EdgeCategory] ?? category;
}

export function edgeDirectionalLabel(
  labels: Record<EdgeType, { forward: string; backward: string }>,
  edgeType: string,
  isSource: boolean,
): string {
  const label = labels[edgeType as EdgeType];
  if (label) return isSource ? label.forward : label.backward;
  const formatted = edgeType.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return isSource ? formatted : `${formatted} (reverse)`;
}
