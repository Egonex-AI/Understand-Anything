# 한국어 출력 가이드라인 (Korean)

이 파일은 한국어로 지식 그래프 콘텐츠를 생성할 때의 언어별 가이드를 제공합니다.

## 태그 명명 규칙

한국어 태그 또는 영어 일반 기술 용어 사용:

| 패턴 | 추천 태그 |
|------|---------|
| 진입점 파일 | `진입점`, `barrel`, `exports` 또는 `entry-point` |
| 유틸리티 함수 | `유틸리티`, `helpers`, `utility` |
| API 핸들러 | `api-handler`, `controller`, `endpoint` |
| 데이터 모델 | `데이터모델`, `entity`, `schema` 또는 `data-model` |
| 테스트 파일 | `테스트`, `unit-test`, `test` |
| 설정 파일 | `설정`, `build-system`, `configuration` |
| 인프라 | `인프라`, `deployment`, `infrastructure` |
| 문서 | `문서`, `guide`, `documentation` |

**혼합 전략:** 일반 기술 용어는 영어 유지 (`middleware`, `api-handler` 등), 설명용 태그는 한국어 사용 가능.

## 요약 스타일

1-2문장 요약을 한국어로 작성:
- 파일의 **목적**과 **역할** 설명
- 능동태 사용 ("제공하는...", "처리하는...", "관리하는...")
- 파일명 반복 피하기

**예시:**
- 좋음: "API 레이어 전체에서 사용되는 날짜 포맷 및 문자열 정제 헬per 함수를 제공."
- 나쁨: "utils 파일에는 유틸리티 함수가 포함되어 있습니다."

## 기술 용어

다음 용어는 영어 유지 (표준 번역 없음):
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## 레이어 이름

한국어 레이어 이름 사용:
- `API 레이어`, `서비스 레이어`, `데이터 레이어`, `UI 레이어`
- `인프라`, `설정`, `문서`
- `유틸리티 레이어`, `미들웨어 레이어`, `테스트 레이어`

또는 영어 유지 (팀 관습에 따라):
- `API Layer`, `Service Layer`, `Data Layer`