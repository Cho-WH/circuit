# Fixture 형식

각 파일은 다음 구조를 가진다.

```json
{
  "id": "FIX-01",
  "title": "단일 저항",
  "purpose": "검증 목적",
  "document": { "format": "edu-circuit", "version": 1 },
  "expected": {
    "status": "solved",
    "probeVoltagesV": {},
    "branchCurrentsA": {},
    "componentVoltagesV": {},
    "componentPowersW": {},
    "diagnostics": [],
    "invariants": []
  }
}
```

## 가변저항 학습 예제

예제 메뉴는 `src/fixtures/index.ts`에서 선택하며, 화면 배치는 `src/app/examples.ts`의 기존 직렬·병렬 배치를 공유한다. 가변저항의 표시 이름은 `VR_1`이며 연결 ID는 유지한다. 분석에서 부품을 선택하면 기존 조절기가 열린다.

| 예제 | 구성·초기값 | 조절하며 관찰할 내용 |
|---|---|---|
| FIX-11 가변저항 (직렬) | 6 V, 고정 1 Ω + 가변 1~5 Ω(초기 2 Ω) | 초기 전류 2 A, 양단 전압 2 V·4 V. 가변저항을 키우면 전류는 줄고 가변저항 양단 전압은 커진다. |
| FIX-12 가변저항 (병렬) | 6 V, 고정 3 Ω ∥ 가변 1~6 Ω(초기 3 Ω) | 초기 가지 전류 각각 2 A. 고정 가지의 2 A는 유지되고 가변 가지 전류와 전체 전류가 바뀐다. |
| FIX-09 휘트스톤 브릿지 | 12 V, R₁·R₅ 100 Ω, R₂·R₃ 200 Ω, VR₁ 100~1000 Ω(초기 400 Ω) | 100:200 = 200:400에서 균형. 양쪽 중간 전위 8 V, 중앙 전류 0 A. 400 Ω의 양쪽에서 중앙 전류 방향이 반대가 된다. |

FIX-11·12는 제안 당시 저항값과 범위를 1/10로 줄였다. FIX-09는 저항값이 달라도 두 가지의 저항 비가 같으면 균형을 이루도록 구성한다. 모두 기존 두 단자 선형 가변저항 모델을 사용한다.

## 전류 방향

`branchCurrentsA`의 양의 방향은 각 부품 `terminals` 배열의 첫 번째 단자에서 두 번째 단자로 향한다.

## 절점 전위

`probeVoltagesV`는 컴파일러가 생성하는 내부 `net` ID가 아니라 문서에 저장된 단자 또는 분기점 ID를 사용한다.

## 오류 fixture

`expected.status`가 `error`이고 `numericalResultsForbidden`이 `true`이면 해석기는 유한한 수치 해를 임의로 생성해서는 안 된다.
