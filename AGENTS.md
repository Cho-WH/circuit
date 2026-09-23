# Repository Instructions

## 1. 제품과 현재 범위

이 저장소는 고등학교 수업을 중심으로 한 교육용 전기회로 웹앱을 개발한다. 현재 물리 범위는 이상적인 선형 직류 저항 회로다.

현재 단계는 `docs/implementation/current-phase.md`에서 확인한다. 현재 단계의 종료 조건을 충족하기 전에는 후속 기능을 앞당겨 구현하지 않는다.

## 2. 규범 문서의 우선순위

문서가 충돌하면 다음 순서로 판단한다.

1. `requirements/*.yaml`과 `schemas/*.json`
2. 상태가 `accepted`인 `decisions/ADR-*.md`
3. `docs/physics/*.md`
4. `docs/architecture/*.md`
5. `docs/implementation/current-phase.md`
6. 제품·UX 설명 문서

충돌을 임의로 해소하지 않는다. 요구사항, 물리 규약, 공개 인터페이스가 바뀌면 관련 ADR과 테스트를 같은 변경 단위에서 갱신한다.

## 3. 반드시 지킬 불변 규칙

1. `CircuitDocument`가 저장·공유되는 회로 구조의 유일한 원본이다.
2. 계산 결과와 일시적인 UI 상태를 `CircuitDocument`에 저장하지 않는다.
3. 전기 연결은 화면 좌표가 아니라 단자·도선·분기점 ID로 기록한다.
4. 같은 입력 문서와 해석 옵션은 같은 계산 결과와 진단 코드를 반환한다.
5. `domain`, `connectivity`, `simulation`, `diagnostics`는 React, SVG, Three.js, 브라우저 저장 API를 알지 않는다.
6. UI는 계산 행렬을 직접 다루지 않고 `SimulationEngine`의 공개 계약만 사용한다.
7. 같은 `net`에 속한 모든 단자는 같은 절점 전위를 참조한다.
8. 이상적인 도선은 숫자·색상·3D 높이에서 같은 전위로 표현한다.
9. 진단은 안정적인 코드와 관련 요소 ID를 반환한다. 사용자 문구를 계산 함수 안에 넣지 않는다.
10. 학생 조작 제한은 버튼 숨김이 아니라 명령 실행 단계에서 검사한다.
11. 출력은 현재 화면 캡처가 아니라 `CircuitDocument`와 공통 기호 정의에서 다시 생성한다.
12. 저장 형식이 바뀌면 순차 마이그레이션과 이전 fixture 호환 테스트를 제공한다.

## 4. 작업별 필수 참조

| 작업 | 먼저 읽을 문서 |
|---|---|
| 제품 범위 변경 | `docs/product/brief.md`, `docs/product/scope.md`, 관련 요구사항 |
| 회로 데이터 변경 | `docs/architecture/domain-model.md`, `schemas/circuit-document.schema.json`, `ADR-008` |
| 연결 판정 | `docs/architecture/domain-model.md`, `docs/architecture/modules.md`, `SIM-001` |
| 직류 계산 | `docs/physics/ideal-dc-model.md`, `docs/architecture/modules.md`, `SIM-002~007`, 관련 fixture |
| 전위 시각화 | `docs/physics/potential-visualization.md`, `VIS-001~007`, `ADR-006` |
| 회로 편집기 | `docs/ux/interactions.md`, `EDT-001~007`, `ADR-001`, `ADR-002` |
| 측정 기능 | `docs/physics/measurement-and-display.md`, `MEA-001~005` |
| 문제지 출력 | `docs/ux/workflows.md`, `TCH-001~003`, `docs/architecture/extension-points.md` |
| 저장·공유 | `docs/architecture/persistence-and-sharing.md`, `DAT-001~004`, `ADR-005`, `ADR-007` |
| 단계 계획 | `docs/implementation/phases.md`, `docs/implementation/current-phase.md` |

## 5. 변경 절차

1. 관련 요구사항 ID를 식별한다.
2. 연결된 물리 규칙, 모듈, fixture, ADR을 확인한다.
3. 실패 조건과 수용 기준을 먼저 구체화한다.
4. 공개 타입 또는 스키마 변경 시 마이그레이션 영향을 확인한다.
5. 기능 코드와 단위·통합 테스트를 함께 변경한다.
6. 관련 문서와 fixture가 여전히 일치하는지 검증한다.

## 6. 코드 경계

- 내부 구현 파일을 다른 모듈에서 직접 import하지 않는다. 각 모듈의 공개 `index`만 사용한다.
- 순환 의존성을 만들지 않는다. 공통 타입은 필요한 최소 범위만 `domain`에 둔다.
- 핵심 계산 함수는 외부 시간, 네트워크, 브라우저 전역 상태에 의존하지 않는다.
- 오류를 예외 문자열 하나로 전달하지 않는다. 구조화된 결과나 `Diagnostic`을 사용한다.
- 새 추상화는 실제로 교체될 두 번째 구현이 있거나 명확한 장기 경계가 있을 때 추가한다.
- 새 부품은 기호, 편집 속성, 전기 모델, 출력 스타일을 분리해 등록한다.
- 부품 기호는 한국 교육과정의 대상 학년 교과서·수업 자료에서 주로 쓰이는 표기를 우선한다. 저항과 이상적인 저항성 부하는 지그재그로 표시한다. 새 요소를 추가할 때에는 대상 학년의 교과서 또는 공공 교육 자료에서 기호를 확인하고 선택 근거를 기록한다. 여러 표기가 있으면 학생에게 익숙한 것을 기본값으로 정하고 이름을 함께 표시한다. 라이브러리·편집 화면·SVG·PNG가 공통 기호 정의를 사용해야 한다.

## 7. 작업 완료 조건

기능은 `docs/implementation/definition-of-done.md`를 모두 충족해야 완료된다. 계산이나 시각화 변경은 관련 `fixtures/`와 물리 불변식 테스트를 반드시 통과해야 한다.

## 8. 현재 MVP 협업 방식

사용자가 요청한 단계 0~5 MVP 작업에서는 메인이 스켈레톤·공개 계약·물리 핵심·통합을 직접 맡는다. 서브 에이전트는 GPT-5.6 Sol 두 개를 구현 전담과 검증 전담으로 운영한다. 구현 전담은 별도 테스트·빌드·브라우저 검사를 실행하지 않는다. 검증 전담은 메인의 지시에 따라 테스트·타입·빌드 등 코드 검증만 병렬로 수행하고 실패 근거를 보고한다. 사용자의 최신 지시에 따라 최종 브라우저 시각 검증은 메인 Astra가 직접 수행한다. 메인은 그 결과를 반영해 수정하고 단계 완료를 판정한다. 진행과 실제 검증 근거는 `docs/implementation/mvp-tracker.md`에 기록한다.


MVP 완료 후 사용자는 서브 에이전트를 전부 중지하고, 이번 3D 개선은 메인이 직접 구현·코드 검증·브라우저 검증하도록 요청했다. 새 명시적 요청 전까지 서브 에이전트를 호출하지 않는다.
