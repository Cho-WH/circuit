# C1 공개 계약과 저장 형식 검증

후속 상태: [C2 순수 엔진](rc-c2-results.md)도 구현했다. 아래 검증 결과와 미착수 표기는 C1 완료 당시의 범위다.

기준일: 2026-10-22, dev. 사용자 승인으로 C1을 구현했다. 결정은 [ADR-042](../../decisions/ADR-042-rc-contracts-storage.md), 전체 단계는 [RC 설계](../architecture/rc-transient.md)를 따른다. C2 계산 엔진 제품 연결·C3 재생 세션·C4 측정 UI는 이번 범위가 아니다.

## 구현과 공개 진입점

| 진입점 | 구현한 계약 |
|---|---|
| [domain](../../src/domain/index.ts) | CircuitDocument v7, capacitor의 정확 C/초기 전압·a/b 역할 검증, CompiledElement 판별 타입, RC 공개 타입·정책 |
| [RC 계약 정의](../../src/domain/rc.ts) | prepare 요청·불투명 plan·frame·finite/equilibrium·질의·구조화 진단. 외부에서는 domain/simulation index로 import |
| [connectivity](../../src/connectivity/index.ts) | 축전기를 소실시키지 않고 C·초기 전압·a/b 원래 단자 ID로 컴파일 |
| [simulation](../../src/simulation/index.ts) | RC 타입 재수출. 기존 DC solve는 축전기에서 RC_ENGINE_REQUIRED 반환 |
| [measurement](../../src/measurement/index.ts) | RcFrameContext 저장·검증, RC 근사 출처, 원시 CSV의 시간/정책 열 |
| [persistence](../../src/persistence/index.ts) | 회로 명시적 v5/v6 복원, 기록 v5 검증 변환·v6 저장, 원본 보존과 채널 분리 |
| [회로 스키마](../../schemas/circuit-document.schema.json)·[기록 스키마](../../schemas/measurement-notebook.schema.json) | v7/v6 구조 검증. 이전 회로 v5/v6와 기록 v5는 복원 전용 스키마로 고정 |

`RcPrepareRequest`는 CompiledCircuit·부품/단자 ID별 초기 전압·회로 리비전·조작 번호·initial/operation·정책을 받는다. `RcPlan.summary`에는 초기/평형 상태·안정화 시각·느린 시정수와 정책이 있고, 행렬·모드는 없다. `RcFrame`은 같은 context의 기준 그룹·절점 전위·부품 전압/전류·축전기 전하와 미정 목록을 제공한다. 값은 Rational의 정확/근사 메타데이터를 유지한다. 실제 prepare/sample/query 구현은 C2다.

기록 transient의 필드는 model=linear-rc, modelRevision=1, arithmeticPolicy=rc-modal-1, settlingPolicy=rc-envelope-1, circuitRevision, operationIndex, frameId, time이다. `time={kind:'finite',seconds}` 또는 `{kind:'equilibrium'}`만 허용한다. 원시 CSV는 rcModel·rcModelRevision·rcArithmeticPolicy·rcSettlingPolicy·circuitRevision·operationIndex·frameId·timeKind·physicalSeconds 열을 추가했다. 이전 DC 값과 출처는 유지하고 RC 열을 비운다.

## 검증 범위

[전용 검사](../../tests/rc-contracts-storage.test.ts)는 다음 실제 오류를 대상으로 한다.

- C/초기 전압·표시 설정의 v7 왕복, 0/음수 C·비정규 분수·근사 입력·역할 중복·실행 상태 저장 거부.
- 단자 배열을 뒤집어도 a/b 방향과 초기 전압 부호 유지, 두 DC 모델 모두 축전기 계산 거부.
- F/µF/C 단위와 RC approximation의 저장·복원. finite/equilibrium과 정확/근사 품질을 독립적으로 보존.
- 잘못된 시간·추가 seconds·정책·조작 번호·DC/RC 출처 혼합·불일치 스냅샷 거부.
- 회로 v5/v6는 정상 읽기에서 거부하고 명시적 복원만 허용. 원문 보존 후 v7 저장, 미래 버전·끊어진 참조·구버전으로 위장한 축전기 거부.
- 기록 v5의 값·오차·DC 출처·메모·탐침 위치 보존. 새 시간 출처를 만들지 않으며 이전 키와 백업을 그대로 유지.
- 현재 키가 있으면 구버전으로 되돌리지 않음. 손상/미래 입력·원문 보관 실패·변환 중 대상 키 변경·채널 격리 확인.
- 유효한 이전 기록을 읽은 뒤 새 키 쓰기가 용량 제한 등으로 실패해도 메모리의 기록과 원본을 유지. 오래된 백업이나 빈 기록으로 바꾸지 않음.

기존 저장·측정·DC/다이오드·스위치·정확 숫자·앱 세션의 관련 검사를 함께 실행한다. 최신 회로 예제와 실패 fixture는 v7로 갱신하되 전기값·기대 계산값은 바꾸지 않는다. 이전 버전 검사는 별도 고정 스키마와 기존 v5 원문을 사용한다.

## 실행 결과

2026-10-22 dev에서 관련 18개 테스트 파일의 **444개 검사 통과**. 이 중 새 C1 계약·저장 검사는 15개, C0 수치 검사는 25개다. 다음 명령으로 실행했으며 전체 테스트 실행은 아니다.

```powershell
$env:TEMP = Join-Path (Get-Location) '.tools/rc-c0-tmp'
$env:TMP = $env:TEMP
npx vitest run tests/rc-contracts-storage.test.ts tests/measurement-notebook.test.ts tests/editor-persistence.test.ts tests/release-storage.test.ts tests/diode-domain.test.ts tests/diode-engine.test.ts tests/changeover-switch.test.ts tests/measurement.test.ts tests/rational.test.ts tests/quantity.test.ts tests/circuit-session.test.ts tests/workspace-ui.test.ts tests/measurement-workspace.test.ts tests/bounded-dc.test.ts tests/simulation.test.ts tests/specifications.test.ts tests/document-links.test.ts tests/rc-prototype.test.ts
npm run build
npm run check:boundaries
```

타입 검사 포함 프로덕션 빌드와 161개 소스 파일의 모듈 경계 검사도 통과했다. Vite의 500 kB 초과 청크 경고는 남아 있다. 새 형식 복사 실패 시 메모리 기록을 보존하도록 마지막 보강한 뒤 관련 저장·측정 검사와 빌드를 재확인했다. UI의 RC 계산·재생 연결, 실제 브라우저에서의 이전 사용자 데이터 전환 및 배포는 이번 검증 범위 밖이다.

## 완료 경계와 남은 일

C1은 실제 저장·불러오기와 공개 계약까지다. API에서 축전기 문서를 만들 수 있지만 배치 팔레트는 숨긴 상태다. 불러온 축전기의 임시 C 표식은 정식 기호·출력 수용 완료를 의미하지 않는다. C2에서 제품 RcEngine과 도선 센서 질의를 연결하고, C3/C4에서 재생 잠금·시간 표시·실제 측정표 및 정식 기호를 구현한다.

C0의 32단 회로 연산 예산 한계는 그대로다. C1은 수치 범위를 확장하지 않는다. 커밋·푸시·배포와 브라우저에서 RC 관찰 흐름 수용은 이번 검증에 포함하지 않는다.
