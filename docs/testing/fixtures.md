# 기준 회로

`fixtures/`의 회로는 계산, 진단, 기준점, 시각화의 회귀 테스트에 사용한다.

| ID | 회로 | 핵심 기대값 |
|---|---|---|
| FIX-01 | 단일 저항 9 V, 9 Ω | 전류 1 A, 저항 강하 9 V |
| FIX-02 | 직렬 9 V, 3 Ω + 6 Ω | 전류 1 A, 강하 3 V와 6 V |
| FIX-03 | 병렬 6 V, 6 Ω ∥ 3 Ω | 가지 1 A·2 A, 전체 3 A |
| FIX-04 | 12 V 직병렬 혼합 | 중간 절점 6 V, 가지 2 A·1 A |
| FIX-05 | 열린 스위치 | 전류 0 A, 스위치 양단 9 V |
| FIX-06 | 전원 단락 | `SOURCE_SHORT`, 수치 해 생성 금지 |
| FIX-07 | 부유 저항망 | `FLOATING_SUBCIRCUIT` |
| FIX-08 | 충돌 전원 | `CONFLICTING_SOURCES` |
| FIX-09 | 균형 브리지 | 중앙 저항 전류 0 A |
| FIX-10 | FIX-02의 기준점 변경 | 전위만 이동, 전위차·전류 동일 |

## 사용 규칙

- fixture의 `document`는 `schemas/circuit-document.schema.json`을 만족해야 한다.
- `expected.status`가 `error`면 금지된 수치 결과를 임의로 생성하지 않는다.
- 절점 전위 기대값은 컴파일러 내부 `net` ID가 아니라 안정적인 단자·분기점 ID를 기준으로 기록한다.
- 가지 전류 방향은 부품의 `terminals` 배열 첫 번째 단자에서 두 번째 단자로 향하는 방향이다.
- fixture를 수정할 때 기대값의 수기 계산 근거를 PR에 적는다.
- 요구사항이나 물리 규칙 변경으로 기대값이 바뀌면 관련 ADR을 연결한다.
