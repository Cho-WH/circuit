# 도메인 모델

## 상태의 세 종류

| 종류 | 예 | 저장 여부 |
|---|---|---|
| 회로 문서 상태 | 부품, 위치, 회전, 단자, 도선, 라벨, 활동 설정 | 저장한다. 파일과 공유의 기준이다. |
| 계산 결과 상태 | 절점 전위, 가지 전류, 전력, 진단 | 저장하지 않고 문서에서 다시 계산한다. |
| 일시적 UI 상태 | 선택, 패널 열림, 드래그 미리보기, 카메라 각도 | 기본적으로 문서와 분리한다. |

## 핵심 개체

| 개체 | 역할 |
|---|---|
| `CircuitDocument` | 저장·공유되는 회로 전체 |
| `ComponentInstance` | 캔버스에 놓인 부품 한 개 |
| `Terminal` | 부품의 전기 연결점 |
| `Wire` | 두 단자 또는 분기점을 잇는 경로 |
| `Junction` | 여러 도선이 명시적으로 만나는 점 |
| `Net` | 연결망 컴파일 결과로 얻는 등전위 절점 |
| `Annotation` | 출력 전용 점·글자·화살표. position/end로 자유 배치하고 이전 anchor 주석도 지원 |
| `ActivityDefinition` | 학생 권한과 단계별 공개 조건 |
| `SimulationResult` | 절점 전위, 가지 전류, 전력, 진단 |

## 핵심 타입 예시

현재 v6 저장·공개 계산 계약은 [ADR-024](../../decisions/ADR-024-exact-dc-arithmetic.md)와 [정확 연산 명세](../physics/exact-dc-arithmetic.md)를 따른다. 물리값은 실행 중 BigInt 분자·분모, JSON에서 정수 문자열 쌍을 사용한다. 현재 형식만 지원한다.

```ts
interface Rational { readonly numerator: bigint; readonly denominator: bigint }
interface StoredScalar { numerator: string; denominator: string }

type EndpointRef =
  | { kind: 'terminal'; id: string }
  | { kind: 'junction'; id: string };

interface CircuitDocument {
  format: 'edu-circuit';
  version: 6;
  documentId: string;
  title: string;
  components: ComponentInstance[];
  wires: Wire[];
  junctions: Junction[];
  annotations: Annotation[];
  output?: { fontScale?: number };
  referenceNode: EndpointRef | null;
  activity: ActivityDefinition | null;
}

interface CompiledCircuit {
  nets: Net[];
  elements: CompiledElement[];
  referenceNetId?: string;
}

interface SimulationResult {
  nodeVoltages: Record<string, Rational>;
  branchCurrents: Record<string, Rational>;
  componentPowers: Record<string, Rational>;
  diagnostics: Diagnostic[];
}
```

정식 저장 형식은 [`schemas/circuit-document.schema.json`](../../schemas/circuit-document.schema.json)이다.

## 식별자 규칙

- 내부 ID와 화면 표시 이름을 분리한다.
- 표시 이름 `R1`을 바꿔도 연결은 유지되어야 한다.
- ID는 문서 안에서 유일하고 저장·복원 후에도 유지된다.
- 복사·붙여넣기는 새 ID를 생성한다.
- `createDocumentIdAllocator(document)`는 기존 모든 개체·단자 ID를 예약하고 호출할 때마다 충돌 없는 ID를 반환한다. 문맥 배선과 삭제 대체 명령은 같은 결정론적 할당 규칙을 사용한다.
- 도선 끝은 `EndpointRef`로 명시한다.

## 값과 좌표

- 문서의 voltageV·resistanceOhm·resistanceMinOhm·resistanceMaxOhm은 SI 기본 단위의 StoredScalar다. 계산 결과의 전위·전류·전력은 Rational이다.
- 화면 확대와 무관한 문서 좌표를 사용한다.
- 회전은 MVP에서 0°, 90°, 180°, 270°다.
- SIM-008에 따라 0·부호·동일 전위·제약 일치를 정확 비교하며 좌표·화면 기하의 근사 계산과 분리한다.

## 다이오드와 부품 프로필

다이오드의 두 단자는 `anode`와 `cathode`이며 전기 방향은 A→K다. 역할은 배열·화면 회전과 독립적이다. `operatingProfile?: { id, revision: 1 }`은 타입별 교육용 프로필을 참조한다. 생략된 참조는 v6에서 고정한 기본값으로 해석한다. 값과 범위는 [부품 경계](../physics/circuit-operating-boundaries.md)의 D0 표를 따른다.

선택적 `properties.sourceResistanceOhm`, `diodeThresholdV`, `diodeOnResistanceOhm`은 재현할 특성 차이만 정확값으로 저장한다. 기본 프로필·경계는 `domain.operatingProfileFor`를 통해 컴파일에 전달하며 계산 전용 요소를 문서에 추가하지 않는다. 모르는 프로필이나 잘못된 단자 역할·특성값은 문서 검증에서 거부한다.

위 특성을 명시한 부품에는 컴파일 시 `explicitCharacteristics`를 표시한다. 분석 모델 선택은 이를 사용해 안전 범위에서도 명시한 부품 특성을 관찰할 수 있게 한다. 이 표시는 계산 입력의 파생 정보이며 저장 문서에 별도 플래그로 넣지 않는다.

## 전환 스위치

전환 스위치는 [ADR-029](../../decisions/ADR-029-changeover-switch.md)에 따라 기존 switch의 switchKind=spdt·state=a|b와 common/throw-a/throw-b 세 단자를 사용한다. 기존 v6 JSON 구조를 유지하며 domain은 역할 중복/누락·미지원 종류·상태를 거부한다. 컴파일·측정은 공통→선택 접점만 사용하고 미선택 접점은 전류가 주입되지 않는 독립 단자로 남는다. 일반 스위치의 open/closed 계약은 유지한다.

## 저장하지 않는 값

다음 값은 파일에 정답처럼 저장하지 않는다.

- 절점 전위
- 가지 전류
- 부품 전력
- 진단 결과
- 현재 선택 상태
- 드래그 미리보기

문서가 열리면 현재 계산 엔진이 다시 구한다.

## 연결 불변식

- 좌표가 같아도 참조 연결이 없으면 같은 `net`이 아니다.
- 분기점이 없는 교차선은 연결되지 않는다.
- 모든 도선 시작점과 끝점은 존재하는 단자 또는 분기점을 참조한다.
- 삭제된 요소를 참조하는 도선은 유효하지 않다.
- 도선 삭제로 영향을 받은 분기점과 부품 대체로 만든 점만 연결 수에 따라 정리한다. 앵커 없는 고립점은 제거하고 두 도선 접점은 경로를 합친다. 열린 끝·분기·앵커·폐곡선의 필수 끝점은 유지한다. 삽입은 선택한 연속 경로에 같은 규칙을 적용한다(ADR-018).
- 연결된 부품 삭제는 단자 자리에 새 분기점을 만들고 도선·주석·기준점의 참조를 함께 옮긴다. 두 단자 사이 도선을 추가하며 기존 경로는 보존한다. 명시적으로 삭제한 도선은 복원하지 않는다. 노드 수동 삭제는 지원하지 않는다(ADR-017/018).
- 기준점은 존재하는 단자 또는 분기점을 참조하거나 `null`이다.

가변저항의 저장 타입은 `resistive-load`를 사용한다. 두 단자와 `resistanceOhm` 속성은 일반 저항과 같으며, UI 이름·기호만 구분한다. ID·이름과 물리값을 별도로 관리한다.

출력 화살표의 `Annotation.arrow`는 직선/직각 형태, 두 변 길이, 회전 각도, 방향 반전을 저장한다. 선택적 `Annotation.presentation`은 출력 전용 기호·값 표시 속성이다. 기호의 기본값은 content이며 이름·값 이동은 label/answerOffsetX/Y로 기록한다.

## 부품별 숫자 표시

ComponentInstance.properties.quantityMode는 auto/scientific/plain 선택 속성이며 미설정 기본은 auto다. 문서에 저장할 부품 표기 속성으로 위치·이름과 함께 저장·복사·실행 취소한다. 숫자값·Fraction 원문·연결·계산식은 바꾸지 않는다. v6 properties 계약을 사용하며 ADR-019를 따른다.

## 가변저항 범위

resistive-load의 resistanceOhm은 현재 저항값이다. 선택적 resistanceMinOhm/resistanceMaxOhm이 있으면 0 < min < max와 min ≤ value ≤ max를 domain에서 검증한다. 새 부품은 10 Ω·1~100 Ω 범위다. v6의 정확값 필드를 사용한다. 범위 없는 문서의 기본 범위와 조절 계약은 [ADR-023](../../decisions/ADR-023-live-parameters.md)을 따른다. 자동 왕복·입력 초안·축척 기준은 UI 상태다.

다이오드 종류는 별도 UI 상태가 아닌 operatingProfile의 edu-diode-signal@1 / edu-diode-power@1로 저장한다. 새 부품은 신호용이다. 기존 edu-diode@1과 참조 생략의 고정 의미는 유지한다. [ADR-028](../../decisions/ADR-028-diode-kinds.md).
