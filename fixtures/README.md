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

## 전류 방향

`branchCurrentsA`의 양의 방향은 각 부품 `terminals` 배열의 첫 번째 단자에서 두 번째 단자로 향한다.

## 절점 전위

`probeVoltagesV`는 컴파일러가 생성하는 내부 `net` ID가 아니라 문서에 저장된 단자 또는 분기점 ID를 사용한다.

## 오류 fixture

`expected.status`가 `error`이고 `numericalResultsForbidden`이 `true`이면 해석기는 유한한 수치 해를 임의로 생성해서는 안 된다.
