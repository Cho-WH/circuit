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

```ts
type EndpointRef =
  | { kind: 'terminal'; id: string }
  | { kind: 'junction'; id: string };

interface CircuitDocument {
  format: 'edu-circuit';
  version: number;
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
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  componentPowers: Record<string, number>;
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

- 저항, 전압, 전류는 Ω, V, A 기준 숫자로 저장한다.
- 화면 확대와 무관한 문서 좌표를 사용한다.
- 회전은 MVP에서 0°, 90°, 180°, 270°다.
- 부동소수점 비교는 절대·상대 허용 오차를 사용한다.

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

가변저항의 저장 타입은 호환성을 위해 `resistive-load`를 사용한다. 두 단자와 `resistanceOhm` 속성은 일반 저항과 같으며, UI 이름·기호만 구분한다. 기존 파일의 ID·이름·값은 변경하지 않는다.

출력 화살표의 v3 `Annotation.arrow`는 직선/직각 형태, 두 변 길이, 회전 각도, 방향 반전을 저장한다. 기존 v2 `end`는 호환용이며 공통 표기 모듈이 원래 선분을 복원한다. v1~v3 파일의 순차 변환은 ADR-012를 따른다.

저장 v4의 선택적 `Annotation.presentation`은 출력 전용 기호·값 표시 속성이다. 기호의 기본값은 기존 content이며 이름·값 이동은 label/answerOffsetX/Y로 기록한다. v3→v4 복제 변환에서 기존 주석을 보존한다.
