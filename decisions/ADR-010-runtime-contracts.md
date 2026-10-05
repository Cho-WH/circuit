# ADR-010: 런타임 계약과 검증

- 상태: accepted
- 결정일: 2026-09-23

## 결정

2026-10-02 개정: [ADR-024](ADR-024-exact-dc-arithmetic.md)의 정확값 타입·직렬화를 구현했다. 현재 회로 v5와 측정 기록 v4만 지원하고 이전 형식의 변환·호환은 제공하지 않는다.

`src/domain/index.ts`에 현재 JSON Schema와 대응하는 저장 타입과 최소 공개 계산 계약을 둔다. JSON Schema를 Ajv 2020으로 검증한 뒤 ID 유일성과 참조 대상 종류를 검사한다. 현재 파일 형식은 version 5이며 계산값과 UI 상태를 문서에 추가하지 않는다. 물리 속성은 정규형 정수 문자열 쌍을 검사한다.

`CompiledCircuit`는 결정론적인 net 목록, 부품 요소, endpoint→net 대응 및 명시적 기준점을 가진다. 부품 방향은 첫 단자→두 번째 단자이며 전압원은 positive→negative 순서로 정규화한다. `SimulationResult`는 상태, net 전위, 가지 전류, 부품 전압·전력과 구조화된 진단을 제공한다. 정의되지 않은 수치는 결과 맵에 넣지 않는다.

## 검증

스키마 정상·실패 입력, 참조 무결성, ID 중복, JSON 왕복 테스트를 수행한다. 단계 1에서는 FIX-01~10과 기준점 불변식으로 계산 계약을 검증한다. 코드 의존성 검사로 핵심 모듈의 UI 의존과 모듈 내부 직접 import를 차단한다.

## 가변저항 범위 검사 (2026-10-01)

[ADR-023](ADR-023-live-parameters.md)의 선택적 저항 범위 속성은 v5 정확값 필드다. 범위가 명시되면 양수·순서·현재값 포함을 구조 검증 뒤 검사한다. 범위가 생략된 현재 문서에는 기본 범위를 사용한다.


## 검증 진입점 통합 (2026-10-02)

로컬·검증 CI·배포 CI는 package.json의 `npm run verify`를 공유한다. 명세 검증은 기존 TypeScript/Vitest 테스트와 공통 JSON Schema를 사용하고, 문서 ID·연결 참조는 앱의 공개 `domain.validateDocument`로 검사한다. Python의 중복 검증 및 전용 의존성은 제거하고 고유했던 저장소 Markdown 링크 검사만 TypeScript 테스트로 옮긴다. 링크 검사는 로컬 파일 존재와 저장소 경계만 확인하며 외부 URL·문서 내 앵커 검증은 범위 밖이다. 배포의 Firestore 에뮬레이터 검사는 기존 별도 명령을 유지한다.

## 다이오드 확장 계약 (2026-10-05)

[ADR-026](ADR-026-diode-boundary-analysis.md)이 이 절과 겹치는 이전 범위를 확장한다. 현재 지원 형식은 회로 v6·측정 기록 v5로 갱신한다. 이전 버전의 변환·호환은 제공하지 않는다. ComponentInstance.operatingProfile은 타입별 내장 ID와 revision 1을 보존하고, 생략 시 v6에 고정된 기본 프로필을 사용한다. 선택적 전기 특성 편차도 정규형 정확값이다. 다이오드 단자는 anode/cathode를 강제하며 CompiledElement는 A→K로 정규화한다. 내부 행렬·아핀 기저는 엔진 내부에 두고 결과에는 physicalModel·profileRevision·arithmeticQuality 출처를 구별한다.
