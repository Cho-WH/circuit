# 모듈 구성과 공개 계약

## 모듈 책임

| 모듈 | 책임 | 금지되는 결합 |
|---|---|---|
| `domain` | 회로 문서·계산 계약, ID, 스키마·참조 검증, 순차 마이그레이션 | React, SVG, Three.js, 저장 API |
| `component-library` | 단자 구성, 기본값, 표시 이름, 기호 | 행렬 계산 직접 수행 |
| `connectivity` | 명시적 연결을 따라 `net` 구성 | 화면 색, 선택 상태, 픽셀 좌표 판정 |
| `simulation` | `CompiledCircuit`에서 전위·전류·전력 계산 | React와 화면 좌표 |
| `diagnostics` | 컴파일·계산 모듈이 생성한 진단 집계와 중복 제거 | 자유 문장만 반환 |
| `editor` | 문서 편집 명령, 권한 검사, 실행 취소 | 포인터·React 상태, 물리 계산식 구현 |
| `wire-geometry` | Point 배열의 직각 경로·국소 변형·정리 | 문서·ID·UI·렌더러·명령·저장. domain 타입 외 모듈 의존 금지 |
| `measurement` | 측정 도구를 질의나 임시 회로 요소로 변환 | 원본 문서의 몰래 영구 변경 |
| `visualization` | `SimulationResult`를 2D 레이어로 변환 | 재계산 수행 |
| `potential-3d` | 2D 위치와 전위를 3D 장면으로 변환 | 회로 해석 직접 수행 |
| `export` | 공통 기호 자원에서 인쇄용 SVG·PNG 생성 | 화면 캡처에 의존 |
| `persistence` | 자동 저장, 파일 입출력, domain 검증·버전 변환 사용 | 계산 결과를 정답으로 저장 |
| `feedback` | 후기 타입, 입력 정책, 일반·관리자 게이트웨이 계약 | React, 브라우저, Firebase SDK, 회로 문서 결합 |
| `feedback-firebase` | 운영 후기의 익명 인증·Firestore 읽기/쓰기·관리자 접근 | 회로 문서·물리 계산 결합 |
| `feedback-local` | 이전 로컬 자료와 계약 검증용 어댑터 | 물리·편집 모듈 접근, 운영 백엔드로 사용 |

활동의 허용 명령은 현재 `domain.ActivityDefinition`과 `editor`의 실행 단계에서 검사한다. 독립 `activity` 모듈과 활동 제작·배포 UI는 단계 6의 후속 범위다. 후기 게시판의 운영 구조는 [게시판 구조](feedback.md)를 따른다.

## 핵심 공개 인터페이스

```ts
interface CircuitCompiler {
  compile(document: CircuitDocument): CompileResult;
}

interface SimulationEngine {
  solve(
    circuit: CompiledCircuit,
    options?: SolveOptions
  ): SimulationResult;
}

interface DiagnosticEngine {
  evaluate(input: DiagnosticInput): Diagnostic[];
}

interface Exporter<TOptions> {
  export(
    document: CircuitDocument,
    options: TOptions
  ): Promise<Blob>;
}

interface DocumentMigrator {
  canMigrate(version: number): boolean;
  migrate(input: unknown): CircuitDocument;
}
```

## 연결망 구성

1. 모든 부품 단자, 도선 끝, 분기점을 ID로 읽는다.
2. 명시적으로 연결된 항목을 같은 집합으로 묶는다.
3. 화면상 교차하지만 연결 참조가 없는 선은 묶지 않는다.
4. 각 집합을 하나의 `Net`으로 만든다.
5. 미연결 단자, 길이 0 도선, 고립 하위 회로를 진단 후보로 넘긴다.

구현은 Union-Find로 연결 집합을 병합한다.

## 명령과 실행 취소

문서 변경은 UI가 직접 수정하지 않고 `editor`의 공개 명령을 통해 수행한다. 명령 실행 전에 `document.activity.allowedCommands`를 검사하며, 허용되지 않은 명령은 UI 표시와 무관하게 거부한다.

| 실제 명령 | 변경 대상 |
|---|---|
| `AddComponent`, `MoveComponents`, `RotateComponents`, `DeleteElements`, `Paste` | 부품과 관련 요소의 구조·위치 |
| `ConnectWire`, `AddJunction`, `ConnectToWire` | ID 연결·분기·배선 경로 |
| `MoveWireSegment` | 끝점 ID를 유지하는 도선 한 선분의 수직 방향 이동 |
| `InsertComponentOnWire`, `ConnectCrossing`, `DisconnectCrossing` | 직렬 삽입·교차 연결/분리 |
| `SetProperties`, `SetLabel`, `SetReference` | 전기 속성·문제 표기·이름·기준점 |
| `AddAnnotation`, `UpdateAnnotation`, `SetOutputScale`, `ReplaceDocument` | 출력 주석·글자 배율·문서 교체 |

`History`는 과거·현재·미래 문서 스냅샷을 보존한다. `previewCommand`와 `executeCommand`는 같은 권한·변환·검증 경로를 사용한다. `executeCommands`는 복수 명령을 모두 검증한 뒤 한 번의 실행 취소 단위로 확정하며 실패 시 부분 변경을 남기지 않는다.

문맥 배선은 `app/wiring`의 순수 대상 판정·명령 구성, 임시 상태 관리, 표시 컴포넌트로 나눈다. `useTouchNavigation`은 이동·핀치·취소 후 클릭 억제를 담당한다. App이 문서·권한·이력을 소유하고 Canvas는 포인터·키보드 이벤트를 연결한다. 후보·호버·임시 분기점은 저장 문서에 넣지 않는다. [ADR-002](../../decisions/ADR-002-state-management.md)와 [ADR-013](../../decisions/ADR-013-wire-editing-ux.md)을 따른다.

도선 기하 계산은 `wire-geometry`의 순수 함수로, 문서 적용은 editor 명령으로, 조작 상태와 손잡이는 `app/wiring`으로 분리한다. 미리보기와 확정은 같은 공개 명령을 사용하며 기존 waypoints만 저장한다. 국소 보정·짧은 경로 공식·선분 이동·허용 명령은 [ADR-016](../../decisions/ADR-016-local-wire-routing.md)을 따른다.

DeleteElements의 연결 정책은 editor 내부 `delete-elements.ts`가 담당한다. 두 단자 부품 자리를 도선으로 잇고 다단자는 단자별 외부 연결만 보존한다. `wire-topology.ts`는 영향받은 연결점의 연결 수·앵커를 검사해 고립점을 제거하거나 두 도선 경로를 합친다. `wire-edits.ts`의 삽입 후보와 확정도 같은 경로 정리를 사용한다. UI는 선택·명령 전달과 일시적인 실패 표시만 소유한다. 문맥 배선과 대체 편집의 ID는 domain의 `createDocumentIdAllocator`로 충돌 없이 예약한다. 삭제 정책은 [ADR-017](../../decisions/ADR-017-delete-components-keep-wiring.md), 국소 정리와 삽입 규칙은 [ADR-018](../../decisions/ADR-018-junction-lifecycle.md)을 따른다.

## 측정과 출력의 공개 계약

관련 요구사항: SIM-004~006, MEA-001~004, TCH-001~003. 저장 문서는 v4이며 v1·v2·v3 호환 변환은 ADR-012를 따른다.

`measurement`는 `probeVoltage(compilation, result, red, black)`, `probeCurrent(document, compilation, result, target)`, `insertSeriesAmmeter(document, { componentId, ammeter, newWireId })`, `parameterSweep(document, request, compiler, engine)`, `createMeasurementRecord(document, fields)`, `measurementsToCsv(records)`를 공개한다. 결과는 성공 시 `{ ok: true, value, diagnostics }`, 실패 시 `{ ok: false, diagnostics }`로 반환한다. 전류계 ID와 위치, 기록 시각은 호출자가 제공하며 핵심 함수는 외부 시간에 의존하지 않는다.

측정 탭은 `probeCurrent`의 부호 있는 전류와 기준 방향을 읽는다. 도선은 해당 edge를 제거한 연결 그래프와 단자 전류 합으로 처리하며, 도선 고리에는 미정 진단을 반환한다. 화면의 배치·스냅은 `app/measurement-tools`에 격리한다. 기존 전류계 삽입 공개 함수는 학습·계약 호환용으로 유지하며 측정 탭에서는 호출하지 않는다. 이 함수는 선택 부품의 첫 전기 단자를 사용하되 전원은 positive 단자를 우선한다. 복제한 임시 문서·계기 ID·변경된 연결 정보를 반환하며 원본을 보존한다. 등가저항과 KCL·KVL 해석은 `simulation`의 공개 함수를 사용한다. 저항 측정 UI는 `equivalentResistance`의 `excludeSourceIds`에 모든 직류 전원 ID를 전달해 개방하며 원본 문서를 수정하지 않는다. 저수준 API의 나머지 독립원 비활성화 계약은 유지한다. `CircuitCanvas`의 측정 표시 옵션과 공통 `symbolMarkup(component, { disconnectedSource })`는 전원의 리드 단절·흐림만 표현하며 전기 계산에 관여하지 않는다. 물리 의미와 기록·실험 규칙은 [측정 규약](../physics/measurement-and-display.md)을 따른다.

`component-library`의 공통 표기와 `export`의 SVG·PNG·클립보드 함수 및 옵션은 [ADR-012](../../decisions/ADR-012-worksheet-presentation.md)에 모았다. `domain`의 `Exporter<TOptions>`는 확장용 인터페이스이며 앱은 현재 `exportSvg`, `exportPng`, `copyPng` 함수를 사용한다.

## 의존성 규칙

- `domain`은 다른 기능 모듈을 import하지 않는다.
- `connectivity`와 `simulation`은 UI 모듈을 import하지 않는다.
- `visualization`은 결과 타입을 읽되 `simulation` 내부 구현을 호출하지 않는다.
- `app`은 사용자 흐름에 맞춰 계산·저장·화면을 조합한다. 다른 모듈은 책임표와 전체 구조도의 의존 방향을 따른다.
- 모듈 내부 파일이 아니라 공개 `index`를 사용한다.
- 순환 의존성이 생기면 책임을 다시 나누고 공통 타입을 최소 범위로 이동한다.

### 화면 내부의 책임

- `app/useCircuitSession`: 확정 문서·이력·단일/묶음 명령의 화면 모드 제한·자동 저장을 소유한다. App은 공개 실행 함수와 undo/redo만 호출한다. 학생 활동 권한과 문서 무결성은 계속 editor가 검사한다.
- `app/useCanvasDragSession`: 부품/도선 이동의 시작 문서·좌표·포인터 캡처·미리보기와 화면 이동 세션을 소유한다. Canvas는 실제 이벤트를 연결하고 터치·배선·측정 등 여러 조작의 취소를 함께 지시한다. 확정에는 미리보기와 같은 명령 구성 함수를 사용한다.
- `app/InlineComponentEditor`: 이름·값 초안, 파싱 오류, 입력 초점과 입력창 배치를 소유한다. Canvas에는 편집 대상 ID만 남긴다. 화면 크기 변화는 초안을 초기화하지 않는다.
- `app/PotentialSettings`: 전위 범위·높이 설정 표시를 담당한다. 설정 값은 App의 문서 밖 상태이며 같은 PotentialModel로 2D/3D를 갱신한다.

이 파일들은 app 내부 구현이며 별도 패키지·상태 라이브러리·범용 조작 프레임워크를 만들지 않는다. simulation 내부에서는 solver를 measurements가 사용하고 index가 두 구현의 공개 API를 재노출한다.

## 분수 표기

`notation`은 브라우저에 의존하지 않는 입력 파싱·명시적 분수 복원·문구 토큰화를 제공한다. editor와 UI가 같은 parseQuantity를 사용하고 component-library는 componentValueInput·notationWidth·svgNotation을 공개한다. 수치 해석기는 원래 SI 숫자만 받는다. 입력 표기 저장 규칙은 ADR-012를 따른다.
