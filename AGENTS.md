# Repository Instructions

## 1. 제품과 현재 범위

이 저장소는 고등학교 수업을 중심으로 한 교육용 전기회로 웹앱을 개발한다. 현재 물리 범위는 이상적인 선형 직류 저항 회로다.

현재 구현과 단계는 `docs/implementation/current-phase.md`, 남은 작업은 `docs/implementation/follow-up.md`에서 확인한다. 후속 후보를 착수 승인으로 간주하지 않으며, 현재 단계의 종료 조건을 충족하기 전에는 후속 기능을 앞당겨 구현하지 않는다.

## 2. 규범 문서의 우선순위

문서가 충돌하면 다음 순서로 판단한다.

1. `requirements/*.yaml`, `requirements/*.schema.json`, `schemas/*.json`
2. 상태가 `accepted`인 `decisions/ADR-*.md`
3. `docs/physics/*.md`
4. `docs/architecture/*.md`
5. `docs/implementation/current-phase.md`
6. 제품·UX 설명 문서

충돌을 임의로 해소하지 않는다. 요구사항, 물리 규약, 공개 인터페이스가 바뀌면 관련 ADR과 테스트를 같은 변경 단위에서 갱신한다.

요구사항과 ADR의 상태를 확인한다. `proposed`·`deferred` 항목을 확정된 구현 계약으로 취급하지 않는다. 현재 ADR 목록은 `decisions/README.md`를 따른다.

## 3. 반드시 지킬 불변 규칙

아래 규칙을 구현의 기준으로 삼고, 변경이 영향을 주는 규칙을 중심으로 검증한다.

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
12. 저장은 현재 정확값 형식만 지원한다. 스키마 변경 시 지원 버전을 명시하고 현재 형식의 왕복과 지원 밖 입력의 거부를 확인한다.

## 4. 작업별 필수 참조

| 작업 | 먼저 읽을 문서 |
|---|---|
| 제품 범위 변경 | `docs/product/brief.md`, `docs/product/scope.md`, 관련 요구사항 |
| 회로 데이터 변경 | `docs/architecture/domain-model.md`, `schemas/circuit-document.schema.json`, `ADR-010`, `ADR-012` |
| 모듈 경계·공개 계약 | `docs/architecture/modules.md`, `ADR-008`, `ADR-010` |
| 연결 판정 | `docs/architecture/domain-model.md`, `docs/architecture/modules.md`, `SIM-001` |
| 직류 계산 | `docs/physics/ideal-dc-model.md`, `docs/physics/exact-dc-arithmetic.md`, `docs/architecture/modules.md`, `SIM-002~008`, `ADR-024`, `ADR-025`, 관련 fixture |
| 전위 시각화 | `docs/physics/potential-visualization.md`, `VIS-001~007`, `ADR-006` |
| 전류 시각화 | `docs/physics/current-visualization.md`, `VIS-006`, `CV-01~05`, `ADR-020` |
| 회로 편집기 | `docs/ux/interactions.md`, `EDT-001~007`, `ADR-001`, `ADR-002` |
| 배선·부품 삽입·삭제·분기점 | `docs/ux/interactions.md`, `ADR-013`, `ADR-016~018` |
| 측정 기능 | `docs/physics/measurement-and-display.md`, `MEA-001~005`, `ADR-011`, `ADR-015` |
| 수치 입력·분수·단위 표시 | `docs/physics/measurement-and-display.md`, `docs/architecture/modules.md`, `ADR-019` |
| 문제지 출력 | `docs/ux/workflows.md`, `TCH-001~003`, `docs/architecture/extension-points.md`, `ADR-012` |
| 저장·복구 | `docs/architecture/persistence-and-sharing.md`, `DAT-001~004`, `ADR-007`, `ADR-010`, `ADR-012` |
| 공유·학생 활동 | `docs/architecture/persistence-and-sharing.md`, `docs/implementation/phases.md`, `ADR-005`(proposed) |
| 후기 게시판 | `docs/architecture/feedback.md`, `docs/implementation/firebase-setup.md`, `ADR-014` |
| 단계 계획 | `docs/implementation/phases.md`, `docs/implementation/current-phase.md`, `docs/implementation/follow-up.md` |

## 5. 변경 절차

1. 관련 요구사항 ID를 식별한다.
2. 연결된 물리 규칙, 모듈, fixture, ADR을 확인한다.
3. 실패 조건과 수용 기준을 먼저 구체화한다.
4. 공개 타입 또는 스키마 변경 시 저장·불러오기와 지원 버전의 영향을 확인한다.
5. 변경으로 발생할 수 있는 실제 오류를 확인하는 검증을 선택한다. 기존 테스트를 우선 활용하고, 새로운 동작과 버그 재발 방지에 필요한 테스트를 추가한다.
6. 관련 문서와 fixture가 여전히 일치하는지 검증한다.

## 6. 코드 경계

- 내부 구현 파일을 다른 모듈에서 직접 import하지 않는다. 각 모듈의 공개 `index`만 사용한다.
- 순환 의존성을 만들지 않는다. 공통 타입은 필요한 최소 범위만 `domain`에 둔다.
- 핵심 계산 함수는 외부 시간, 네트워크, 브라우저 전역 상태에 의존하지 않는다.
- 오류를 예외 문자열 하나로 전달하지 않는다. 구조화된 결과나 `Diagnostic`을 사용한다.
- 새 추상화는 실제로 교체될 두 번째 구현이 있거나 명확한 장기 경계가 있을 때 추가한다.
- 사용자용 위치 이름은 회로에 보이는 부품명·단자 방향·연결 관계를 기준으로 작성한다. 저장용 ID는 내부 식별에 사용하고, 안내·기록·접근성 이름은 학생과 교사가 회로에서 찾을 수 있는 표현으로 제공한다.
- 새 부품은 기호, 편집 속성, 전기 모델, 출력 스타일을 분리해 등록한다.
- 부품 기호는 한국 교육과정의 대상 학년 교과서·수업 자료에서 주로 쓰이는 표기를 우선한다. 저항과 이상적인 저항성 부하는 지그재그로 표시한다. 새 요소를 추가할 때에는 대상 학년의 교과서 또는 공공 교육 자료에서 기호를 확인하고 선택 근거를 기록한다. 여러 표기가 있으면 학생에게 익숙한 것을 기본값으로 정하고 이름을 함께 표시한다. 라이브러리·편집 화면·SVG·PNG가 공통 기호 정의를 사용해야 한다.

## 7. 작업 완료 조건

요청한 동작을 구현하고, 변경의 영향과 위험에 맞는 검증으로 결과를 확인한다. 계산·연결·저장 변경은 관련 불변식과 호환성을, 화면 변경은 해당 동작과 표현을 중심으로 확인한다.

기존 검증과 사용자 확인 결과를 활용하며, 충분한 근거가 확보되면 작업을 마무리한다. 검증 범위는 사용자의 지시를 우선하고, 결과와 중요한 미확인 사항을 간결하게 기록한다.

세부 기준은 `docs/implementation/definition-of-done.md`, 실행 명령은 `package.json`을 참고한다. 주요 변경과 검증 근거는 `docs/implementation/mvp-tracker.md`에 기록한다.

## 8. Git 커밋·푸시 계정

- 원격 저장소: `https://github.com/Cho-WH/circuit.git` (`origin`).
- 이 프로젝트의 Git·GitHub 작업은 반드시 `Cho-WH` 계정으로 수행한다. 커밋과 푸시 모두 이 계정을 사용한다.
- 커밋 작성자: `Cho-WH <cwhd@naver.com>`.
- GitHub 인증 계정: `Cho-WH`. 작업 전에 커밋 작성자와 인증 계정이 모두 맞는지 확인한다.
