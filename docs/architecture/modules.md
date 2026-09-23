# 모듈 구성과 공개 계약

## 모듈 책임

| 모듈 | 책임 | 금지되는 결합 |
|---|---|---|
| `domain` | 회로 문서, 공통 타입, 단위, ID, 최소 검증 | React, SVG, Three.js, 저장 API |
| `component-library` | 단자 구성, 기본값, 표시 이름, 기호 | 행렬 계산 직접 수행 |
| `connectivity` | 명시적 연결을 따라 `net` 구성 | 화면 색, 선택 상태, 픽셀 좌표 판정 |
| `simulation` | `CompiledCircuit`에서 전위·전류·전력 계산 | React와 화면 좌표 |
| `diagnostics` | 컴파일·계산 결과에서 교육적 진단 생성 | 자유 문장만 반환 |
| `editor` | 직접 조작, 명령, 실행 취소 | 물리 계산식 구현 |
| `measurement` | 측정 도구를 질의나 임시 회로 요소로 변환 | 원본 문서의 몰래 영구 변경 |
| `visualization` | `SimulationResult`를 2D 레이어로 변환 | 재계산 수행 |
| `potential-3d` | 2D 위치와 전위를 3D 장면으로 변환 | 회로 해석 직접 수행 |
| `export` | 공통 기호 자원에서 인쇄용 SVG·PNG 생성 | 화면 캡처에 의존 |
| `persistence` | 자동 저장, 파일 입출력, 버전 변환 | 계산 결과를 정답으로 저장 |
| `feedback` | 후기 타입, 입력 정책, 일반·관리자 게이트웨이 계약 | React, 브라우저, Firebase SDK, 회로 문서 결합 |
| `feedback-local` | 후기 로컬 미리보기, 익명 ID 소유권 확인, 작성 제한·수정·소프트 삭제 | 물리·편집 모듈 접근, 운영 백엔드로 사용 |

활동의 허용 명령은 현재 `domain.ActivityDefinition`과 `editor`의 실행 단계에서 검사한다. 독립 `activity` 모듈과 활동 제작·배포 UI는 단계 6의 후속 범위다. 후기 게시판의 운영 전환 조건은 [게시판 구조](feedback.md)를 따른다.

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
| `InsertComponentOnWire`, `ConnectCrossing`, `DisconnectCrossing` | 직렬 삽입·교차 연결/분리 |
| `SetProperties`, `SetLabel`, `SetReference` | 전기 속성·문제 표기·이름·기준점 |
| `AddAnnotation`, `UpdateAnnotation`, `SetOutputScale`, `ReplaceDocument` | 출력 주석·글자 배율·문서 교체 |

`History`는 과거·현재·미래 문서 스냅샷을 보존한다. `previewCommand`와 `executeCommand`는 같은 권한·변환·검증 경로를 사용한다. `executeCommands`는 복수 명령을 모두 검증한 뒤 한 번의 실행 취소 단위로 확정하며 실패 시 부분 변경을 남기지 않는다.

문맥 배선은 `app/wiring`의 순수 대상 판정·명령 구성, 임시 상태 관리, 표시 컴포넌트로 나눈다. `useTouchNavigation`은 이동·핀치·취소 후 클릭 억제를 담당한다. App이 문서·권한·이력을 소유하고 Canvas는 포인터·키보드 이벤트를 연결한다. 후보·호버·임시 분기점은 저장 문서에 넣지 않는다. [ADR-002](../../decisions/ADR-002-state-management.md)와 [ADR-013](../../decisions/ADR-013-wire-editing-ux.md)을 따른다.

## 측정과 출력의 공개 계약

관련 요구사항: SIM-004~006, MEA-001~004, TCH-001~003. 저장 문서는 v2이며 v1 호환 변환은 ADR-012를 따른다.

`measurement`는 `probeVoltage(compilation, result, red, black)`, `insertSeriesAmmeter(document, { componentId, ammeter, newWireId })`, `parameterSweep(document, request, compiler, engine)`, `createMeasurementRecord(document, fields)`, `measurementsToCsv(records)`를 공개한다. 결과는 성공 시 `{ ok: true, value, diagnostics }`, 실패 시 `{ ok: false, diagnostics }`로 반환한다. 전류계 ID와 위치, 기록 시각은 호출자가 제공하며 핵심 함수는 외부 시간에 의존하지 않는다.

전류계 삽입은 선택 부품의 첫 전기 단자를 사용하되 전원은 positive 단자를 우선한다. 복제한 임시 문서·계기 ID·변경된 연결 정보를 반환하며 원본을 보존한다. 등가저항과 KCL·KVL 해석은 `simulation`의 공개 함수를 사용한다. 물리 의미와 기록·실험 규칙은 [측정 규약](../physics/measurement-and-display.md)을 따른다.

`component-library`의 공통 표기와 `export`의 SVG·PNG·클립보드 함수 및 옵션은 [ADR-012](../../decisions/ADR-012-worksheet-presentation.md)에 모았다. `domain`의 `Exporter<TOptions>`는 확장용 인터페이스이며 앱은 현재 `exportSvg`, `exportPng`, `copyPng` 함수를 사용한다.

## 의존성 규칙

- `domain`은 다른 기능 모듈을 import하지 않는다.
- `connectivity`와 `simulation`은 UI 모듈을 import하지 않는다.
- `visualization`은 결과 타입을 읽되 `simulation` 내부 구현을 호출하지 않는다.
- `app`만 여러 모듈을 조합한다.
- 모듈 내부 파일이 아니라 공개 `index`를 사용한다.
- 순환 의존성이 생기면 책임을 다시 나누고 공통 타입을 최소 범위로 이동한다.

## 분수 표기

`notation`은 브라우저에 의존하지 않는 입력 파싱·명시적 분수 복원·문구 토큰화를 제공한다. editor와 UI가 같은 parseQuantity를 사용하고 component-library는 componentValueInput·notationWidth·svgNotation을 공개한다. 수치 해석기는 원래 SI 숫자만 받는다. 입력 표기 저장 규칙은 ADR-012를 따른다.
