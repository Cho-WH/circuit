# 확장 경계

## 부품 확장

현재는 `componentDefinitions`의 표시 정보, `createComponent`의 기본값·단자, `symbolMarkup`의 공통 기호, connectivity·simulation의 전기 모델 분기를 사용한다. 여섯 부품에 대한 명시적 구현이며 범용 등록 프레임워크는 없다.

아래는 새 전기 모델과 두 번째 구현이 필요해질 때의 분리 방향이다. 현재 존재하는 타입·등록 API로 해석하지 않는다. 새 부품은 다음 책임을 구분한다.

| 정의 | 역할 |
|---|---|
| `ComponentDefinition` | 이름, 기본값, 단자 수, 편집 가능한 속성 |
| `SymbolDefinition` | SVG 경로, 라벨 위치, 선택 영역, 회전 규칙 |
| `ElectricalModel` | 해석기에 전달할 전기 요소 |
| `InspectorSchema` | 속성 패널의 입력 필드 |
| `ExportStyle` | 인쇄용 선 굵기, 글자, 흑백 규칙 |

예시:

```ts
interface ComponentDefinition<TProps> {
  type: string;
  createDefault(): TProps;
  terminals: TerminalTemplate[];
  symbol: SymbolDefinition<TProps>;
  electrical: ElectricalModelFactory<TProps>;
  inspector: InspectorSchema<TProps>;
  exportStyle: ExportStyle<TProps>;
}
```

새 요소의 기호를 등록할 때에는 대상 학년의 한국 교과서·공공 교육 자료를 확인하고 주로 사용하는 표기와 선택 근거를 기록한다. 저항의 기본 표기는 지그재그다. `symbolMarkup`의 공통 기호를 라이브러리·편집기·출력기에 적용한다. 자세한 정책은 [UX 개요](../ux/overview.md)를 따른다.

현재 가변저항은 공통 부품 정의에서 이름·기호를 제공하고 저항의 두 단자 전기 모델을 공유한다. 파일 호환용 타입 `resistive-load`와 `resistanceOhm` 속성은 유지한다. 이후 새 전기 모델을 도입할 때도 편집기·해석기·출력기의 경계를 지킨다.

## 계산 엔진 확장

UI는 `SimulationEngine`만 사용한다.

```ts
interface SimulationEngine {
  solve(
    circuit: CompiledCircuit,
    options: SolveOptions
  ): SimulationResult;
}
```

후속 엔진은 같은 결과 구조를 반환해야 한다. 엔진별 추가 결과는 공통 결과를 깨지 않는 선택적 확장으로 둔다.

## 출력 확장

`Exporter<TOptions>`는 같은 `CircuitDocument`와 기호 정의를 사용한다.

- SVG는 벡터 기호와 텍스트를 유지한다.
- PNG는 SVG를 지정 배율 또는 DPI로 래스터화한다.
- 클립보드 출력은 PNG를 기본으로 하고 실패 시 파일 저장으로 대체한다.
- PDF는 후속 `Exporter`로 추가할 수 있다.

## 저장 형식 확장

스키마 변경은 다음 조건을 갖는다.

1. 문서 `version`을 올린다.
2. 이전 버전에서 새 버전으로 가는 순차 변환을 작성한다.
3. 원본 입력을 직접 수정하지 않는다.
4. 이전 fixture를 열고 저장하는 회귀 테스트를 추가한다.
5. 공개 인터페이스 변경 시 ADR을 작성한다.

## 활동 확장

현재는 editor가 `document.activity.allowedCommands`를 검사한다. 아래 `ActivityPolicy`는 단계 6의 확장 예시이며 아직 구현한 인터페이스가 아니다. 활동 기능을 추가해도 편집 명령 자체에 역할별 분기문을 흩뿌리지 않는다.

```ts
interface ActivityPolicy {
  canExecute(
    command: Command,
    context: ActivityContext
  ): PolicyDecision;
}
```

## 과도하게 일반화하지 않는 항목

MVP에서는 다음을 만들지 않는다.

- 외부 플러그인 설치 시스템
- 모든 수학 연산을 감싸는 별도 프레임워크
- 존재하지 않는 서버 API 계층
- 복잡한 사용자·조직·권한 체계
- 화면마다 다른 출력 상태 구조
