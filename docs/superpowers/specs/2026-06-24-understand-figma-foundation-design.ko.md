# /understand-figma — Figma 수집 & 구조 분석 (기반) 설계

**날짜**: 2026-06-24
**상태**: 승인됨
**접근**: 기반 우선 — 본 문서는 **5개 하위 프로젝트 중 1번**입니다. Figma 수집 + 구조 분석 + 가벼운 디자인 시스템 모델을 제공합니다. 사용자 플로우(B), 디자인↔코드 매핑(C), 디자인 시스템 감사(D), 기획문서 분석(E)은 여기서 **로드맵**으로만 정의하며, 각각 별도의 스펙 → 플랜 → 구현 사이클을 가집니다.

> 이 문서는 영문 원본 `2026-06-24-understand-figma-foundation-design.md`의 한국어 번역본입니다. 내용이 충돌할 경우 영문 원본이 기준입니다.

## 개요

기존 Understand Anything 플러그인 안에 추가되는 새 `/understand-figma` 스킬로, Figma 파일을 받아 인터랙티브 지식 그래프 — 페이지, 화면, 컴포넌트, 컴포넌트셋, 인스턴스, 디자인 토큰 — 를 만들어 `kind: "design"` 레이아웃으로 기존 대시보드에 시각화합니다.

이는 `/understand-knowledge`(위키)와 `/understand-domain`(비즈니스 도메인)이 비(非)코드 입력으로 도구를 확장한 방식 그대로입니다: 결정적 파싱이 구조 골격을 만들고, LLM 에이전트가 의미를 더하고, 머지 단계가 동일한 `knowledge-graph.json`으로 조립하며, 동일한 대시보드가 렌더링합니다.

### 목표 (Goals)

- **Figma REST API**(`GET /v1/files/:key`)를 통해 Figma 파일을 수집하되, 교체 가능한 소스 어댑터 경계 뒤에 두어 추후 오프라인 로컬-JSON 소스를 재작업 없이 추가할 수 있게 한다.
- **얕은(shallow)** 구조 그래프를 생성한다: `page → screen → component / componentSet / instance`, 그리고 가벼운 **디자인 시스템 모델**(색/타이포/간격/이펙트 스타일을 위한 `token` 노드와 `uses_token` 관계).
- 새 `design-analyzer` LLM 에이전트로 의미 보강(요약, 태그, 레이어 힌트, 화면 목적)을 더한다.
- 기존 스키마·영속화·검증·대시보드를 재사용하고, `kind: "design"` 뷰와 사이드바 썸네일만 추가한다.
- **하이브리드** 전략으로 렌더링한다: 그래프는 가벼운 텍스트 노드, 선택된 노드의 썸네일은 사이드바에 (온디맨드로) 표시.
- v1 파싱 중 미래 지향 메타데이터(`prototypeTargets`, `componentKey`)를 기록해, 로드맵 B·C를 재파싱 없이 켤 수 있게 한다.

### 비목표 (Non-Goals)

- 디자인 시스템 산출물(코드 컴포넌트 라이브러리, 토큰 파일, Storybook)의 **생성**. 본 작업은 분석/모델링 전용 — 사용자와 확정(해석 "i", "ii" 아님).
- 그래프 캔버스 내 인노드(in-node) 썸네일 렌더링(성능/저장 비용) — v1은 사이드바 미리보기만.
- 모든 Figma 레이어를 노드로 만들기(한 화면에 수백 개 레이어 가능). 더 깊은 레이어는 **읽되**(`instance_of` 링크, 토큰 사용, 추후 기획텍스트 추출용) 노드로 만들지 않는다. "화면 깊이 펼치기"는 향후 개선 항목.
- 사용자 플로우(B), 디자인↔코드(C), 디자인 시스템 감사(D), 기획문서 분석(E) — 이들은 로드맵이며 v1 아님.
- 오프라인 `.fig` 파싱(독점 바이너리). 오프라인 지원은 추후 로컬-JSON 소스 어댑터로.

---

## 범위 분해 (왜 기반 우선인가)

사용자는 다섯 가지 기능을 모두 원합니다. 이들은 공통 기반 위에 얹히므로, 기반을 먼저 만듭니다:

```
                       ③ C  디자인 ↔ 코드
                       (Figma 그래프 + 코드 그래프 + 매칭 필요)
                          ▲
   ② B 플로우  ② D 감사   ② E 기획텍스트       ← 파싱된 구조 위에 구축
          ▲          ▲            ▲
          └──────────┴────────────┘
                     │
   ① 기반: Figma 수집 + 구조 (+ 가벼운 디자인 시스템 모델)   ← 본 스펙
```

- **A(본 스펙)** 는 수집, `kind: "design"` 스키마, 파싱 모듈, 스킬 골격, 대시보드 뷰를 확립 — 나머지 전부의 전제.
- **B / D / E** 는 동일한 파싱 데이터 위의 추가 추출.
- **C** 는 캡스톤: Figma 그래프(A) + 코드 그래프(`/understand`) + 매칭 전략이 모두 필요.

각 로드맵 항목은 별도의 스펙 → 플랜 → 구현 사이클을 가집니다.

---

## 스키마 확장

`domain`·`knowledge` 확장과 동일한 메커니즘입니다: `NodeType`/`EdgeType` zod enum은 **닫혀(closed)** 있어(`validateGraph`가 알 수 없는 타입을 드롭) 새 타입은 enum에 **추가**하고, alias 맵 항목이 LLM 어휘를 정규화합니다. `GraphNode`는 `.passthrough()`라 타입드 `figmaMeta` 필드가 `domainMeta`/`knowledgeMeta`와 나란히 실립니다.

### 그래프 수준 Kind 플래그

```typescript
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge" | "design"; // "design" 추가
  // ...
}
```

`kind`가 없는 그래프는 `"codebase"`로 기본 처리(변경 없음). 대시보드는 `kind`에 따라 레이아웃/스타일을 전환합니다.

### 신규 노드 타입 (6) — 21 → 27

| 타입 | 의미 | 예 | ID 규칙 |
|------|------|----|---------|
| `page` | Figma 페이지(캔버스) | "Onboarding" | `page:<figmaNodeId>` |
| `screen` | 최상위 프레임/아트보드(UI 화면) | "Login" | `screen:<figmaNodeId>` |
| `component` | 메인 컴포넌트 | "Button/Primary" | `component:<figmaNodeId>` |
| `componentSet` | 변형 묶음 | "Button" | `componentSet:<figmaNodeId>` |
| `instance` | 컴포넌트 사용처 | "Login › SignInBtn" | `instance:<figmaNodeId>` |
| `token` | 디자인 토큰/퍼블리시된 스타일(색·타이포·간격·이펙트·그리드) | "color/brand-500" | `token:<tokenKind>:<name>` |

Figma "styles"는 `token`으로 통합하며 `figmaMeta.tokenKind`로 구분 — 타입 수를 줄입니다.

### 신규 엣지 타입 (3) — 35 → 38 (+ `contains` 재사용)

| 타입 | 방향 | 의미 |
|------|------|------|
| `contains` *(재사용)* | page → screen, screen → instance, componentSet → component | 구조적 포함 |
| `instance_of` *(신규)* | instance → component | 컴포넌트의 인스턴스 |
| `variant_of` *(신규)* | component → componentSet | 세트 내 변형 |
| `uses_token` *(신규)* | component / screen / instance → token | 토큰/퍼블리시된 스타일 적용 |

**⚠️ `instance_of` alias 충돌.** `instance_of`는 현재 `EDGE_TYPE_ALIASES`에서 `exemplifies`로 매핑돼 있습니다(knowledge 모드용). design에서는 1급 엣지여야 합니다. 해결: **`instance_of`를 정식 `EdgeType`으로 승격하고 alias 항목을 제거**합니다. knowledge 모드 에이전트는 `exemplifies`를 직접 내보내므로(alias는 안전망일 뿐) 영향은 미미합니다. 본 변경은 여기 명시하며 스키마 테스트로 커버해야 합니다.

`navigates_to`(프로토타입 링크, screen → screen)는 v1에 **추가하지 않습니다** — 로드맵 B 소관. 프로토타입 링크 데이터는 `figmaMeta.prototypeTargets`에 보존돼, B가 재파싱 없이 해당 엣지를 나중에 만들 수 있습니다.

### 신규 메타데이터 인터페이스

```typescript
export interface FigmaMeta {
  fileKey?: string;
  nodeId?: string;            // Figma 노드 id, 예: "1:23"
  figmaType?: string;         // 원본 Figma 타입: FRAME | COMPONENT | COMPONENT_SET | INSTANCE | TEXT ...
  thumbnailUrl?: string;      // GET /v1/images로 지연 채움
  dimensions?: { width: number; height: number };
  tokenKind?: "color" | "type" | "spacing" | "effect" | "grid";
  tokenValue?: string;        // 예: "#0A84FF", "16px"
  prototypeTargets?: string[]; // 로드맵 B(플로우)용 — v1에 기록, 엣지는 나중
  componentKey?: string;       // 로드맵 C(디자인↔코드)용 — v1에 기록
}
```

`GraphNode`에 옵션 필드로 추가:

```typescript
export interface GraphNode {
  // ...기존 필드
  figmaMeta?: FigmaMeta;
}
```

### Alias 맵 추가

머지 단계에서 LLM/어휘 견고성을 위해:

- `NODE_TYPE_ALIASES`: `frame → screen`, `artboard → screen`, `canvas → page`, `main_component → component`, `variant_set → componentSet`, `component_set → componentSet`, `design_token → token`, `style → token`.
- `EDGE_TYPE_ALIASES`: `instantiates → instance_of`, `variant → variant_of`, `styled_by → uses_token`, `applies_token → uses_token`. (위 노트대로 기존 `instance_of → exemplifies` 항목은 제거.)

---

## 수집: 소스 어댑터

"Figma 문서가 어디서 오는가"를 "어떻게 파싱하는가"로부터 분리하는 교체 가능한 경계입니다.

```typescript
// packages/core/src/figma/source/types.ts
export interface FigmaSource {
  /** Figma 문서 트리 반환 (GET /v1/files/:key 형태). */
  fetchDocument(): Promise<FigmaDocument>;
  /** 퍼블리시된 스타일 메타 반환 (GET /v1/files/:key/styles 형태). */
  fetchStyles(): Promise<FigmaStyles>;
  /** 주어진 노드 id들의 썸네일 렌더 (GET /v1/images). */
  renderImages(nodeIds: string[]): Promise<Record<string, string>>;
}
```

**v1 구현 — `FigmaApiSource`** (`source/api-source.ts`, Node 전용):
- 토큰을 `process.env.FIGMA_TOKEN`에서 읽음. 없으면 스킬은 친절한 메시지와 함께 중단("figma.com/settings에서 토큰 발급 후 `export FIGMA_TOKEN=…`").
- 문서 트리는 `GET https://api.figma.com/v1/files/:key`, 스타일은 `GET /v1/files/:key/styles`, 썸네일은 `GET /v1/images/:key?ids=…`(온디맨드).
- Figma URL 또는 순수 파일 키를 모두 수용(URL에서 키 파싱).

**향후 — `LocalJsonSource`**: 미리 내보낸 JSON 문서를 읽음. 동일한 `FigmaSource` 인터페이스, 토큰·네트워크 불필요. 기반이 API 전용(A)에서 "둘 다"(앞선 입력 소스 논의의 C)로 진화하는 방식입니다.

API 클라이언트와 모든 `fetch` 사용은 `core`의 Node 전용 영역에 있으며, 브라우저-세이프 서브패스(`./search`, `./types`, `./schema`)에서 **절대 export하지 않습니다**. 대시보드는 스키마 타입만 공유합니다.

---

## 파싱 & 깊이(Granularity)

결정적 파서(`packages/core/src/figma/parse/`)가 문서 트리를 순회해 구조 골격을 생성합니다. 깊이는 **얕음**:

- **노드:** `page`, `screen`(최상위 프레임), `component`, `componentSet`, `instance`, `token`.
- **노드 아님:** Figma "섹션"은 v1에서 평탄화(자식 프레임이 상위 `page`에 붙음); 중첩 그룹과 텍스트/벡터/도형 리프 레이어도 노드 아님.
- **읽되 노드 아님:** 더 깊은 레이어는 `instance_of` 대상 해석, `uses_token` 사용 수집, `prototypeTargets`/`componentKey`의 `figmaMeta` 기록, (추후 E용) 기획 텍스트 읽기를 위해 순회.

노드 깊이 ≠ 파싱 깊이: 파서는 전체 트리를 읽되 얕은 집합만 노드로 승격합니다.

**토큰(의도적으로 제한):** v1은 **퍼블리시된 스타일과 변수**(색/텍스트/이펙트/그리드 스타일, 디자인 변수)만 `token` 노드로 승격 — 토큰 집합을 의미 있고 폭발하지 않게 유지. 원시 인라인 값(예: 일회성 hex)은 소비 노드의 `figmaMeta`에 기록하되, 퍼블리시된 스타일/변수로 해석되지 않는 한 `token` 노드로 **승격하지 않음**. 각 `token` 노드는 `figmaMeta.tokenKind` + `tokenValue`를 가지며, `uses_token` 엣지가 소비자를 연결.

출력: `scan-manifest.json`(결정적, LLM 없음) — 구조 베이스 그래프.

---

## 에이전트 파이프라인

`/understand-knowledge`(결정적 파싱 → LLM 보강 → 머지 → 저장)를 본뜬 4단계입니다.

| Phase | 단계 | 위치 | 출력 |
|-------|------|------|------|
| 1 | FETCH & PARSE | `core/figma` (결정적) | `scan-manifest.json` |
| 2 | ANALYZE | `design-analyzer` LLM 서브에이전트(배치) | `analysis-batch-*.json` |
| 3 | MERGE | `core/figma/merge` + `validateGraph` 재사용 | `assembled-graph.json` |
| 4 | SAVE & LAUNCH | 스킬 + `/understand-dashboard` | `knowledge-graph.json` |

### 신규 에이전트

| 에이전트 | 입력 | 출력 |
|----------|------|------|
| `design-analyzer` *(신규, `article-analyzer` 본뜸)* | 매니페스트 노드 배치(id·이름·타입·`figmaMeta`·자식 요약·토큰 사용) + 기존 노드 ID | 노드별 보강(요약·태그·레이어 힌트·화면 목적) + 보수적 `related` 엣지. **구조 노드/엣지는 재생성하지 않음**. |

스캐너 에이전트는 불필요 — 스캔은 Phase 1 결정적 파서가 담당(위키 파스 스크립트와 동일).

### 중간 파일

`.understand-anything/intermediate/`(조립 후 정리): `figma-doc.json`(원본 트리 캐시), `scan-manifest.json`, `analysis-batch-*.json`, `assembled-graph.json`.

### 레이어 & 투어

- **레이어:** Figma 페이지마다 하나 + 별도 "Design System" 레이어(컴포넌트·컴포넌트셋·토큰).
- **투어:** "디자인 시스템 먼저 → 핵심 화면", 기존 투어 구조 재사용.

### 증분 모드

재실행 시 `meta.json`에 저장된 Figma 파일 `version`/`lastModified`(API 제공)를 비교. 변화 없음 → skip. 변경됨 → v1은 전체 재분석(Figma `nodeId` 단위 증분은 향후 최적화). `/understand`의 커밋 해시 증분의 Figma 버전 버전입니다.

---

## 대시보드 변경

모든 변경은 `kind: "design"`에 한정됩니다. 순수 신규 작업은 네 군데이고, 나머지는 재사용입니다.

1. **`kind: "design"` 분기** (`App.tsx`) — design 뷰 추가(`KnowledgeGraphView`가 추가됐던 것처럼). 구조가 계층적이므로 기존 dagre/ELK 계층 레이아웃 재사용(`DomainGraphView`의 LR과 유사).
2. **타입별 노드 스타일** — `CustomNode`에 타입→색 매핑 추가:

| 노드 | 강조색 | 비고 |
|------|--------|------|
| `page` | 컨테이너/중립 | 화면들을 묶음(레이어도 형성) |
| `screen` | 블루(accent) | |
| `instance` | 그린 | |
| `component` | 바이올렛 | |
| `componentSet` | 앰버 | |
| `token` | 중립 + **색상 스와치** | 색 토큰은 실제 색 표시 |

3. **사이드바(`NodeInfo`) 썸네일 — 유일한 순수 신규 UI.** figma 노드 선택 시 썸네일 블록(이름·타입·치수·태그·관계)을 표시, 기존 슬라이드업/NodeInfo 패턴 재사용.
4. **썸네일 공급** — 코드뷰어의 `/file-content.json`이 쓰는 기존 토큰 게이트 + 경로 allowlist 개발 서버 엔드포인트 패턴을 본떠 `/figma-image` 엔드포인트로 온디맨드 제공; 또는 그래프에 썸네일 URL 저장.

범례·필터에 신규 노드 타입 항목 추가. 레이아웃·검색·필터·테마·내보내기는 변경 없이 재사용.

---

## 스킬 인터페이스

### 사용법

```bash
/understand-figma https://www.figma.com/file/<KEY>/<name>   # URL
/understand-figma <FILE_KEY>                                 # 순수 키
/understand-figma <KEY> --page "Onboarding"                  # 특정 페이지만(선택)
/understand-figma <KEY> --language ko                        # 기존 --language 재사용
```

### 동작

1. URL/키 파싱; `FIGMA_TOKEN` 확인(없으면 친절한 에러).
2. Phase 1 fetch & parse → 발견 요약 announce("N pages, N screens, N components, N tokens 발견").
3. Phase 2 `design-analyzer` 배치(최대 5개 동시, `/understand`와 동일; 배치 실패 허용 — 매니페스트가 견고한 베이스).
4. Phase 3 머지 → 정규화 → `validateGraph` → `kind: "design"`.
5. Phase 4 `knowledge-graph.json` + `meta.json`(Figma 파일 버전 포함) 저장 → `/understand-dashboard` 자동 실행.

### 파일 구조

```
understand-anything-plugin/
  skills/understand-figma/
    SKILL.md                  — 얇은 오케스트레이션
  agents/
    design-analyzer.md        — 신규 LLM 에이전트
  packages/core/src/figma/
    source/
      types.ts                — FigmaSource 인터페이스(어댑터 경계)
      api-source.ts           — FigmaApiSource (REST, Node 전용)
    parse/
      parse-document.ts       — 트리 → 노드/엣지 (결정적, 테스트)
      tokens.ts               — 토큰/스타일 추출
    merge.ts                  — 매니페스트 + 분석 조립
    index.ts                  — Node 전용 엔트리(대시보드 서브패스에 미노출)
    __tests__/                — vitest 단위 테스트
```

---

## 로드맵 (B · C · D · E)

각각 본 기반 위에 구축되는 별도 스펙 → 플랜 → 구현 사이클입니다.

| 항목 | 기능 | v1 위에 더하는 것 | 주된 신규 작업 |
|------|------|-------------------|----------------|
| **B** | 사용자 플로우 | `figmaMeta.prototypeTargets` → `navigates_to` 엣지 + 플로우 뷰 | `navigates_to` 엣지 타입; 플로우 레이아웃(flow/step + `DomainGraphView` 재사용) |
| **C** | 디자인 ↔ 코드 | `figmaMeta.componentKey` ↔ 코드 그래프 컴포넌트 | 두 그래프 결합; 매칭 전략(이름/구조/LLM); cross-graph 엣지 |
| **D** | 디자인 시스템 감사 | 인스턴스/토큰 사용 분석 → 재사용률, detached 인스턴스, 불일치 | 결정적 감사 규칙; 대시보드 배지 |
| **E** | 기획문서 분석 | LLM이 Figma 기획 텍스트를 읽어 `claim`/`entity` 노드로(knowledge 모드 재사용) | 깊은 텍스트 레이어 읽기; 분석기 확장 또는 신규 |

v1이 `prototypeTargets`, `componentKey`를 기록하고 깊은 레이어를 읽어두므로, B/C/E는 재파싱 없이 붙습니다.

---

## 하위호환 · 공존 · 보안

### 하위호환

- 모든 신규 노드/엣지 타입은 추가형(enum 추가). 기존 codebase/knowledge/domain 그래프는 그대로 유효.
- `kind`가 없는 그래프는 `"codebase"`로 기본 처리.
- `figmaMeta`는 옵션 passthrough 필드 — 기존 노드 불영향.
- `instance_of → exemplifies` alias 제거는 영향 미미(knowledge 에이전트는 `exemplifies` 직접 사용); 스키마 테스트로 커버.

### 공존

- 다른 모드와 동일하게 `/understand-figma`는 공유 `.understand-anything/knowledge-graph.json`에 기록. 한 모드 실행 시 이전 그래프를 대체(기존 정책).
- 혼합 레포에서는 `figma-knowledge-graph.json` 서브도메인 그래프를 만들어 기존 `merge-subdomain-graphs.py` 패턴으로 병합 가능.

### 보안

- **`FIGMA_TOKEN`은 환경변수에서만 읽음.** 그래프·config·`meta.json`·로그·중간파일에 절대 기록하지 않음. 토큰을 담은 요청 헤더는 에러/로그에 출력하지 않음.
- 파이프라인은 `api.figma.com`로 **외부 네트워크 호출**을 수행 — `/understand`의 완전 오프라인 성격에서 벗어남. 이는 스킬 출력에서 사용자에게 고지하고 문서화함.
- `figma-doc.json`(원본 트리 캐시)와 썸네일은 디자인 데이터(시크릿 아님)지만, `.understand-anything/`는 기본적으로 git-ignore 유지 권장.
- 썸네일 엔드포인트는 코드뷰어가 쓰는 기존 토큰 게이트 + 경로 allowlist 패턴을 따름.

---

## 향후 과제 / 개선 항목

- **화면 깊이 펼치기:** 특정 화면의 더 깊은 레이어를 온디맨드로 노드 승격.
- **인노드 썸네일:** 사이드바 썸네일 파이프라인이 검증된 후 더 풍부한 렌더링(옵트인).
- **로컬-JSON 소스:** `FigmaSource` 경계의 오프라인 구현(A → "둘 다" 진화).
- **노드 단위 증분:** 파일 변경 시 전체 재분석 대신 Figma `nodeId` 단위 diff.
