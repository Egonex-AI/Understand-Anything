<h1 align="center">Understand Anything</h1>
<p align="center">
  <strong>모든 코드베이스, 지식 베이스 또는 문서를 탐색, 검색, 질문할 수 있는 인터랙티브 지식 그래프로 변환합니다.</strong>
  <br />
  <em>Claude Code, Codex, Cursor, Copilot, Gemini CLI 등 다양한 플랫폼을 지원합니다.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.fr-FR.md">Français</a>
</p>

<p align="center">
  <a href="#-빠른-시작"><img src="https://img.shields.io/badge/빠른_시작-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/라이선스-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/홈페이지-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/라이브_데모-00c853" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — 모든 코드베이스를 인터랙티브 지식 그래프로 변환" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**새 팀에 합류했습니다. 코드베이스가 20만 줄입니다. 어디서부터 시작하시겠습니까?**

Understand Anything은 [Claude Code Plugin](https://code.claude.com/docs/en/plugins-reference#plugins-reference)으로, 멀티 에이전트 파이프라인을 통해 프로젝트를 분석하고, 모든 파일, 함수, 클래스, 의존성에 대한 지식 그래프를 구축한 뒤, 이를 시각적으로 탐색할 수 있는 인터랙티브 대시보드를 제공합니다. 더 이상 코드를 맹목적으로 읽지 마세요. 전체 그림을 파악하세요.

> **목표는 코드베이스의 복잡함으로 감탄을 자아내는 그래프가 아니라, 각 조각이 어떻게 맞물리는지 조용히 가르쳐주는 그래프입니다.**

---

## ✨ 주요 기능

> [!NOTE]
> **바로 체험해보세요!** [홈페이지](https://understand-anything.com/)에서 [라이브 데모](https://understand-anything.com/demo/)를 사용해보세요 — 팬, 줌, 검색, 탐색이 가능한 완전한 인터랙티브 대시보드입니다.

### 구조 그래프 탐색

코드베이스를 인터랙티브 지식 그래프로 탐색하세요. 모든 파일, 함수, 클래스가 클릭, 검색, 탐색 가능한 노드입니다. 노드를 선택하면 이해하기 쉬운 요약, 관계, 가이드 투어를 확인할 수 있습니다.

### 비즈니스 로직 이해

도메인 뷰로 전환하면 코드가 실제 비즈니스 프로세스에 어떻게 매핑되는지 확인할 수 있습니다. 도메인, 흐름, 단계가 수평 그래프로 표시됩니다.

### 지식 베이스 분석

`/understand-knowledge`를 [Karpathy 패턴 LLM 위키](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)에 연결하면 커뮤니티 클러스터링이 적용된 힘 기반 지식 그래프를 생성합니다. 결정론적 파서가 `index.md`에서 위키링크와 카테고리를 추출한 후, LLM 에이전트가 암묵적 관계를 발견하고, 엔티티를 추출하며, 주장을 도출하여 위키를 탐색 가능한 상호 연결된 아이디어 그래프로 변환합니다.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 가이드 투어</h3>
      <p>의존성 순서에 따라 자동 생성되는 아키텍처 워크스루입니다. 올바른 순서로 코드베이스를 학습하세요.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 퍼지 및 시맨틱 검색</h3>
      <p>이름 또는 의미로 무엇이든 검색하세요. "인증을 처리하는 부분은?" 같은 질문으로 그래프 전체에서 관련 결과를 얻을 수 있습니다.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 변경 영향 분석</h3>
      <p>커밋 전에 변경 사항이 시스템의 어떤 부분에 영향을 미치는지 확인하세요. 코드베이스 전반의 파급 효과를 이해하세요.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 페르소나 적응형 UI</h3>
      <p>사용자 유형(주니어 개발자, PM, 파워 유저)에 따라 대시보드의 상세 수준이 자동으로 조정됩니다.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ 레이어 시각화</h3>
      <p>아키텍처 레이어별 자동 그룹화 — API, 서비스, 데이터, UI, 유틸리티 — 색상 코드 범례가 함께 제공됩니다.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 프로그래밍 개념</h3>
      <p>12가지 프로그래밍 패턴(제네릭, 클로저, 데코레이터 등)이 코드에 등장하는 맥락에서 설명됩니다.</p>
    </td>
  </tr>
</table>

---

## 🚀 빠른 시작

### 1. 플러그인 설치

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

> **로컬 모델을 사용하시나요?** 개인정보 보호나 엔터프라이즈 환경에서는 [Ollama](https://docs.ollama.com/integrations) 같은 로컬 모델 제공자를 사용하도록 플랫폼을 설정하세요 — 통합 가이드를 따라 모델 제공자를 변경할 수 있습니다.

### 2. 코드베이스 분석

```bash
/understand
```

멀티 에이전트 파이프라인이 프로젝트를 스캔하고, 모든 파일, 함수, 클래스, 의존성을 추출한 뒤, `.ua/knowledge-graph.json`에 지식 그래프를 저장합니다. (이미 `.understand-anything/` 디렉터리가 있는 프로젝트는 계속 그것을 사용합니다. 존재하는 경우 그것이 데이터 디렉터리로 유지되므로 마이그레이션이 필요 없습니다.)

> **토큰 사용량 안내:** 최초 `/understand`는 전체 코드베이스를 분석하므로 대규모 프로젝트에서는 상당한 토큰을 소비할 수 있습니다. 토큰 요금제 / 구독으로 실행하거나, 초기화에는 로컬 모델(위 참조)을 사용하는 것을 권장합니다. 이후 실행은 기본적으로 증분 방식이라 변경된 파일만 다시 분석하므로 훨씬 적은 토큰을 사용합니다.

**로컬라이즈된 출력:** `--language`를 사용하여 원하는 언어로 내용을 생성:

```bash
# 한국어로 내용 생성 (지식 그래프 노드 설명과 대시보드 UI)
/understand --language ko

# 지원 언어: en(기본값), zh, zh-TW, ja, ko, ru
```

`--language` 매개변수는 다음에 영향합니다:
- 지식 그래프의 노드 요약과 설명
- 대시보드 UI의 레이블, 버튼, 툴팁
- 가이드 투어의 설명

### 3. 대시보드 탐색

```bash
/understand-dashboard
```

코드베이스가 그래프로 시각화된 인터랙티브 웹 대시보드가 열립니다. 아키텍처 레이어별로 색상이 구분되어 있으며, 검색과 클릭이 가능합니다. 노드를 선택하면 코드, 관계, 이해하기 쉬운 설명을 확인할 수 있습니다.

### 4. 더 깊이 탐구하기

```bash
# 코드베이스에 대해 무엇이든 질문하기
/understand-chat How does the payment flow work?

# 현재 변경 사항의 영향 분석
/understand-diff

# 특정 파일이나 함수를 심층 분석
/understand-explain src/auth/login.ts

# 새 팀원을 위한 온보딩 가이드 생성
/understand-onboard

# 비즈니스 도메인 지식 추출 (도메인, 흐름, 단계)
/understand-domain

# Karpathy 패턴 LLM 위키 지식 베이스 분석
/understand-knowledge ~/path/to/wiki

# 언제든 다시 실행 — 기본값은 증분 업데이트(변경된 파일만 재분석)
/understand

# post-commit 훅을 설치해 매 커밋마다 자동 증분 업데이트
/understand --auto-update

# 거대한 모노레포라면 하위 디렉터리로 범위 제한
/understand src/frontend
```

---

## 🌐 멀티 플랫폼 설치

Understand-Anything은 다양한 AI 코딩 플랫폼에서 사용할 수 있습니다.

### Claude Code (네이티브)

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### 한 줄 설치 (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Nanobot / Kiro)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# 플랫폼 이름을 직접 전달하여 프롬프트를 건너뛸 수도 있습니다:
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

설치 스크립트는 저장소를 `~/.understand-anything/repo`에 클론하고 선택한 플랫폼에 맞는 심볼릭 링크를 생성합니다. 설치 후 CLI 또는 IDE를 재시작하세요.

> **스킬 호출 방식 안내:** 호출 접두사는 플랫폼마다 다릅니다. 대부분의 플랫폼은 슬래시 명령(`/understand`)을 사용하지만, **Codex는 `$`를 사용합니다** — `/understand`가 아니라 `$understand`를 입력하세요. 두 접두사 모두 인식되지 않으면 *"understand 스킬로 이 프로젝트를 분석해 줘"*처럼 자연어로 요청하면 됩니다.

- 지원되는 `<platform>` 값: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `nanobot`, `kiro`
- 이후 업데이트: `./install.sh --update`
- 제거: `./install.sh --uninstall <platform>`

### Cursor

이 저장소를 클론하면 Cursor가 `.cursor-plugin/plugin.json`을 통해 플러그인을 자동으로 인식합니다. 수동 설치가 필요 없습니다. 클론 후 Cursor에서 열기만 하면 됩니다.

자동 인식이 되지 않으면 수동으로 설치하세요: **Cursor Settings → Plugins**를 열고 검색란에 `https://github.com/Egonex-AI/Understand-Anything`를 붙여넣은 뒤 추가하세요.

### VS Code + GitHub Copilot

GitHub Copilot(v1.108+)이 설치된 VS Code는 `.copilot-plugin/plugin.json`을 통해 플러그인을 자동으로 인식합니다. 수동 설치가 필요 없습니다. 클론 후 VS Code에서 열기만 하면 됩니다.

모든 프로젝트에서 사용하는 개인 스킬로 설치하려면 위 `install.sh`를 `vscode` 플랫폼으로 실행하세요.

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

설치 후:
- **Kiro CLI**: `kiro-cli chat --agent understand "이 프로젝트를 분석해줘"`
- **Kiro IDE**: 스킬이 `~/.kiro/skills/`에 심볼릭 링크로 연결되고 `understand` 에이전트가 `~/.kiro/agents/understand.json`에 작성되므로, IDE를 재시작하면 둘 다 사용할 수 있습니다.

모든 프로젝트에서 사용하는 개인 스킬로 설치하려면 위 `install.sh`를 `kiro` 플랫폼으로 실행하세요.

### 플랫폼 호환성

| 플랫폼 | 상태 | 설치 방법 |
|----------|--------|----------------|
| Claude Code | ✅ 네이티브 | 플러그인 마켓플레이스 |
| Cursor | ✅ 지원 | 자동 인식 |
| VS Code + GitHub Copilot | ✅ 지원 | 자동 인식 |
| Copilot CLI | ✅ 지원 | 플러그인 설치 |
| Codex | ✅ 지원 | `install.sh codex` |
| OpenCode | ✅ 지원 | `install.sh opencode` |
| OpenClaw | ✅ 지원 | `install.sh openclaw` |
| Antigravity | ✅ 지원 | `install.sh antigravity` |
| Gemini CLI | ✅ 지원 | `install.sh gemini` |
| Pi Agent | ✅ 지원 | `install.sh pi` |
| Vibe CLI | ✅ 지원 | `install.sh vibe` |
| Hermes | ✅ 지원 | `install.sh hermes` |
| Cline | ✅ 지원 | `install.sh cline` |
| KIMI CLI | ✅ 지원 | `install.sh kimi` |
| Nanobot | ✅ 지원 | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ 지원 | `install.sh kiro` |

---

## 📦 팀과 그래프 공유하기

그래프는 단지 JSON 파일입니다 — **한 번만 커밋하면 팀원은 파이프라인을 건너뛸 수 있습니다**. 온보딩, PR 리뷰, docs-as-code 워크플로에 적합합니다.

> **예시:** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) — 커밋된 그래프를 포함한 Go / Java / Python / Node 레퍼런스 프로젝트.

**커밋할 대상:** `.ua/` 내부의 모든 파일. 단, `intermediate/` 와 `diff-overlay.json` 은 제외합니다 (이들은 로컬 임시 파일입니다). (레거시 프로젝트는 `.understand-anything/` 를 사용합니다. 해당 디렉터리가 있는 경우 아래의 디렉터리 이름을 그것으로 바꾸세요.)

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

**최신 상태 유지:** `/understand --auto-update` 를 활성화하면 post-commit 훅이 그래프를 증분 업데이트하여 각 커밋마다 일치하는 그래프가 유지됩니다. 또는 릴리스 전에 `/understand` 를 수동으로 다시 실행하세요.

**대용량 그래프 (10 MB 이상):** **git-lfs** 로 추적합니다.

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### Claude Code 없이 대시보드 보기

그래프를 한 번 생성해 커밋해두면, 팀의 누구나 명령어 하나로 열 수 있습니다. Claude Code 도, LLM 도, API 키도 필요 없으며, Node.js(>= 18)만 있으면 됩니다:

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /path/to/analyzed/project
```

터미널에 토큰이 포함된 URL(`http://127.0.0.1:5173/?token=…`)이 출력되고, 완전한 인터랙티브 대시보드가 브라우저에서 열립니다. 프로젝트 디렉터리(기본값: 현재 디렉터리)에는 커밋된 데이터 디렉터리(`.ua/`, 또는 레거시 `.understand-anything/`)가 있어야 합니다. 모든 것은 로컬 디스크에서 읽기 전용으로 제공되며, LLM 호출도 없고 데이터가 사용자의 컴퓨터를 벗어나지 않습니다.

저장소를 클론해서 작업 중이라면 `pnpm install && pnpm --filter @understand-anything/core build` 후 `GRAPH_DIR=/path/to/analyzed/project pnpm dev:dashboard` 를 실행하면 Vite 개발 서버를 통해 같은 결과를 얻을 수 있습니다.

---

## 🔧 작동 원리

### Tree-sitter + LLM 하이브리드

결정적으로 처리할 수 있는 일은 정적 분석이, 의미 이해가 필요한 일은 LLM 이 담당합니다:

- **Tree-sitter(결정적)** — 소스 코드를 구체 구문 트리로 파싱해 구조적 사실을 추출합니다: import, export, 함수/클래스 정의, 호출 위치, 상속. 스캔 단계에서 `importMap` 으로 사전 해석해 file-analyzer 에 전달하므로, 소스에서 다시 import 를 유도할 필요가 없습니다. 같은 입력은 항상 같은 출력을 내며, 증분 업데이트의 핑거프린트 기반이기도 합니다.
- **LLM(의미적)** — 파싱된 구조와 원본 소스를 함께 읽어 파서가 만들 수 없는 것들을 생성합니다: plain-English 요약, 태그, 아키텍처 레이어 할당, 비즈니스 도메인 매핑, 가이드 투어, 언어 개념 주석.

이 분담 덕분에 그래프는 구조 측면에서는 재현 가능하면서(같은 코드는 항상 같은 엣지를 만든다), 의미 측면에서는 의도를 포착할 수 있습니다(파일이 단지 무엇을 import 하는지가 아니라 *무엇을 위해* 존재하는지).

### 멀티 에이전트 파이프라인

`/understand` 명령은 5개의 전문 에이전트를 조율하며, `/understand-domain`은 6번째 에이전트를 추가합니다:

| 에이전트 | 역할 |
|-------|------|
| `project-scanner` | 파일 탐색, 언어 및 프레임워크 감지 |
| `file-analyzer` | 함수, 클래스, 임포트 추출; 그래프 노드 및 엣지 생성 |
| `architecture-analyzer` | 아키텍처 레이어 식별 |
| `tour-builder` | 가이드 학습 투어 생성 |
| `graph-reviewer` | 그래프 완전성 및 참조 무결성 검증 (기본적으로 인라인 실행; 전체 LLM 검토는 `--review` 사용) |
| `domain-analyzer` | 비즈니스 도메인, 흐름 및 프로세스 단계 추출 (`/understand-domain`에서 사용) |
| `article-analyzer` | 위키 문서에서 엔티티, 주장 및 암묵적 관계 추출 (`/understand-knowledge`에서 사용) |

파일 분석기는 병렬로 실행됩니다(최대 5개 동시, 배치당 20~30개 파일). 증분 업데이트를 지원하여 마지막 실행 이후 변경된 파일만 재분석합니다.

---

## 🎥 커뮤니티

**Better Stack**에서 만든 커뮤니티 워크스루 영상.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Better Stack에서 만든 커뮤니티 워크스루 영상 — 클릭하여 YouTube에서 시청" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">YouTube에서 보기 &rarr;</a></em>
</p>

영상, 블로그 글, 튜토리얼을 만드셨나요? 이슈나 PR을 열어주세요 — 여기서 소개해드릴게요.

---

## 🤝 기여하기

기여를 환영합니다! 시작하는 방법은 다음과 같습니다:

1. 저장소를 Fork합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/my-feature`)
3. 테스트를 실행합니다 (`pnpm --filter @understand-anything/core test`)
4. 변경 사항을 커밋하고 Pull Request를 생성합니다

주요 변경 사항의 경우, 먼저 Issue를 열어 접근 방식을 논의해 주세요.

---

<p align="center">
  <strong>더 이상 코드를 맹목적으로 읽지 마세요. 모든 것을 이해하세요.</strong>
</p>

## Star 히스토리

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>이 도구를 사용해 주시고 기여해 주신 모든 분들께 감사드립니다 — 누군가의 시간을 아껴드리고 있다는 사실이, 이걸 만들 가치가 있게 만든 이유였습니다.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
