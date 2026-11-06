# C2 제품 RC 계산 엔진 연결 검증

기준일: 2026-10-22, dev. 사용자 승인으로 C2 순수 계산 엔진을 제품 공개 계약에 연결했다. [ADR-043](../../decisions/ADR-043-rc-product-engine.md), [구현 설계](../architecture/rc-transient.md), [물리 규약](../physics/linear-rc-transient.md)을 따른다. C3 세션·C4 관찰 UI·배포는 이번 범위가 아니다.

## 구현 경로

`CircuitDocument v7 → connectivity.compileCircuit → rcEngine.prepare → sample → 전압/전류/도선 질의`를 구현했다. 공개 진입점은 [simulation index](../../src/simulation/index.ts)다. `rcCircuitRevision`과 `rcInitialState`는 정상 컴파일 결과에서 첫 요청을 구성하는 보조 함수다.

```ts
const { circuit, diagnostics } = compileCircuit(document);
// error 진단이 있으면 여기에서 중단한다.
const prepared = rcEngine.prepare({
  circuit,
  initialState: rcInitialState(circuit),
  circuitRevision: rcCircuitRevision(circuit),
  operationIndex: 0,
  transition: 'initial',
  policy: rcPolicy,
});
if (prepared.ok) {
  const atOneSecond = rcEngine.sample(prepared.value, { kind: 'finite', seconds: 1 });
  const equilibrium = rcEngine.sample(prepared.value, { kind: 'equilibrium' });
}
```

다음 조작은 새 컴파일 결과와 이전 `equilibrium.capacitorState`를 보내고 operationIndex를 증가시킨다. C2는 상태의 방향·전압 연속성과 충격 필요 여부를 검사한다. 조작 시점 잠금·한 번의 Undo·실패한 후보 문서 유지·취소는 C3가 추가해야 한다. 기존 앱의 DC 분석 경로를 RC 재생으로 자동 교체하지 않았다.

| 부분 | 구현·검증 경계 |
|---|---|
| 내부 계산 | C0의 정확 제약 축약·보존 전하·평형·대칭 모드 후보·잔차 에너지 상한·구간 지수 평가를 src/simulation/rc로 연결 |
| 상태 매핑 | 부품과 원래 단자 ID 사용. 반대 단자 순서의 시작 상태는 부호 반전. 화면 회전/배열 순서와 무관 |
| 출력 값 | 정확 초기·평형·상수/소거량은 exact. 유한 동적 값은 binary64 중심의 Rational과 rc-modal-1 절대 오차 |
| 기준 그룹 | 축전기의 동적 연결을 포함. 전압계는 전류 0, 서로 다른 기준 전압은 미정 |
| 도선 | 단자 KCL 합을 prepare에서 관측량으로 등록. 고리 전류는 미정, 자유도가 소거되는 합은 유일값 |
| 결정성 | 정규형 회로 리비전, 깊게 동결한 plan/frame, WeakMap 소유권, 질의별 독립 계산 예산 |
| 저장 연결 | 실제 sample의 context·오차를 기존 측정 기록/CSV로 전달. 회로 v7·기록 v6 유지 |

C0 도구는 기준 구현으로 고정했다. 제품 코드에서 도구를 import하지 않는다. 외부 소스·수치 라이브러리 도입은 없다.

## 수용 근거

[C2 전용 검사](../../tests/rc-engine.test.ts)는 실제 v7 문서를 생성·검증·컴파일한 뒤 공개 API만 사용한다.

- 단일 충·방전의 해석식, 약 6.91τ 종료, finite/equilibrium 구분, 축전기 전하·전류, 정확 KCL 소거.
- [독립 90자리 기준](../../tests/fixtures/rc-prototype-reference.json)의 5개 다중 RC 회로·35시각에서 절점/부품 전압·가지 전류·축전기 전하가 반환 오차 범위에 포함됨. 기준은 C0 때 만든 Python Decimal의 직접 행렬 지수이며 제품 풀이와 별도다.
- 부유 도체의 초기 전하, 고립 축전기, 저항을 통한 전하 재분배와 에너지 손실. 평형 승계 뒤 저항만 변경하면 T=0, 전원 변경/전환 스위치에서는 연속 전압을 유지한 새 응답.
- 개별 전원 전류가 미정인 병렬 이상적 전원에서도 합계·공통 도선 전류는 유일. 도선의 대체 경로가 있는 고리는 미정. 비선택 스위치 접점은 0 전류.
- 기준점 변경·180° 회전·배열 순서 변경·120회 중간 평가·반복 질의와 무관한 물리량 및 재현 가능한 결과. 원래 입력의 사후 수정과 복제한 plan/frame의 오용 차단.
- 초기 모순·충격 필요·전원 모순·분리된 다이오드 혼합·잘못된 정책/상태/시각·근사 초기 상태·수치 조건 불량·계산 예산에 구조화 실패 반환.
- 작은 양의 감쇠율과 기준보다 작은 비영 변화를 보존. 기존 DC 프로필에 따라 RC 모델이 자동 전환되지 않음.

## 규모와 한계

8단·16단 제품 사다리는 prepare와 0~T의 11시각 sample을 통과했다. 32단은 GCD 나머지 연산 예산, 33단은 축전기 수 제한으로 거부한다. 제품 경로는 도선 전류도 인증하므로 C0의 실행 시간 측정값을 그대로 제품 성능으로 인용하지 않는다. 브라우저 지연시간과 Worker 필요성은 C3에서 실제 세션 경로로 판단한다.

정확 초기 조건·평형의 다음 조작 승계를 지원한다. 유한 근사 프레임을 초기값으로 사용하는 경로는 인증하지 않으며 거부한다. 임의 질의 조합의 오차는 별도로 인증하지만 그 조합의 개별 안정화 시각은 준비된 T의 보장 대상이 아니다. 부품·도선 전류와 같은 동적 기준 net 쌍 전압차는 prepare의 안정화 대상이다.

RC_NO_FINITE_EQUILIBRIUM은 방어 진단을 유지했다. 허용 수동 RC·일정 전압원과 일관된 초기값에서 물리적 반례를 구성해 이 분기를 검증했다고 주장하지 않는다. 전력 출력·근사 초기 상태 전파·프레임의 전송/역직렬화·재생 UI는 이번 범위 밖이다.

## 실행 결과

관련 **13개 파일 358개 검사 통과**. 이 중 C2 전용 24개, C0 수치 회귀 25개, C1 계약·저장 15개를 포함한다. 기존 DC/다이오드·전환 스위치·측정·저장·세션과 요구사항/문서 링크 검사를 함께 실행했다. 전체 테스트는 실행하지 않았다.

```powershell
$env:TEMP = Join-Path (Get-Location) '.tools/rc-c0-tmp'
$env:TMP = $env:TEMP
npx vitest run tests/rc-engine.test.ts tests/rc-prototype.test.ts tests/rc-contracts-storage.test.ts tests/simulation.test.ts tests/bounded-dc.test.ts tests/diode-engine.test.ts tests/changeover-switch.test.ts tests/measurement.test.ts tests/measurement-notebook.test.ts tests/editor-persistence.test.ts tests/circuit-session.test.ts tests/specifications.test.ts tests/document-links.test.ts
npm run build
npm run check:boundaries
```

타입 검사 포함 프로덕션 빌드, 167개 소스의 모듈 경계 검사, 변경 파일의 공백 검사도 통과했다. Vite의 기존 500 kB 초과 청크 경고는 남아 있다. 실제 브라우저 재생·계기 갱신·Worker 성능·배포 검증은 C3 이후 범위다.
