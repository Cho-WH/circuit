# 모듈 구성과 공개 계약

## 정확 연산 계약

[ADR-024](../../decisions/ADR-024-exact-dc-arithmetic.md)의 [정확 연산 명세](../physics/exact-dc-arithmetic.md)를 구현했다. domain은 최소 타입·정규형 직렬화·현재 문서 검증을, rational은 순수 사칙연산·비교·표시 변환을, quantity는 단위 입력·표시 반올림을 담당한다. domain은 rational에 역으로 의존하지 않는다. 행렬은 simulation 내부에 남고 measurement의 도선 KCL·기록까지 정확값을 유지한다. 현재 저장은 회로 v6·측정 기록 v5만 지원한다.

## 구현된 근사 경로의 경계

[ADR-025](../../decisions/ADR-025-bounded-approximate-dc.md)에 따라 simulation이 요청별 정확 계산 예산과 공통 MNA 구성, 정확/근사 풀이, 수용 검사·진단을 소유한다. domain의 공개 결과에는 정확/근사 품질과 측정에 필요한 오차 정보를 명시한다. measurement는 그 품질을 전압차·도선 KCL·등가저항·기록까지 전파하고 quantity/visualization이 ≈와 방향 불확실을 공통으로 표현한다. 렌더러·UI는 행렬·근사 전환·자체 허용오차를 다루지 않는다.

rational은 순수하게 유지하고 연산 계수는 요청별로 전달한다. 전역 카운터와 시계에 의존하지 않는다. 두 풀이에 실제로 필요한 회로식/결과 경계만 공유하며 범용 수치 프레임워크를 추가하지 않는다. SimulationResult.quality와 스칼라 approximation을 공개하며 측정 기록 v5가 이를 보존한다. rational.createArithmetic은 요청별 계측기를 주입받고 기본 순수 연산에도 동일한 메타데이터 전파를 적용한다.

## 선택과 복사 배치

[ADR-034](../../decisions/ADR-034-component-names.md): `component-library.createComponentLabelAllocator(existingLabels)`는 `{ short }` 부품 정의를 받아 중복되지 않는 `접두어_번호`를 생성·예약하는 함수를 반환한다. 한 배치/복사 묶음마다 새로 만들고 `componentDefinitions`/`componentDefinition`의 접두어만 사용한다. App은 새 배치 이름을 `createComponent(kind, id, position, label)`에 전달하며 `editor.copySelection`은 원본 이름을 포함해 묶음 전체의 새 이름을 배정한다. ID 발급과 저장 스키마는 독립이며 기존·수동 이름은 변경하지 않는다.

[ADR-032](../../decisions/ADR-032-selection-copy.md)에 따라 `editor.copySelection`은 새 ID와 독립 연결을 만들며 명시적으로 선택한 도선의 외부 끝을 독립 연결점으로 복사한다. `MoveComponents.positions`는 선택한 부품·연결점 ID를 받으며 같은 변위의 양 끝을 가진 도선은 경로 전체를 평행 이동한다. 연결점 직접 삭제 금지는 유지한다.

`app/copy-placement`는 선택 영역·위치 변환·기존 부품과의 겹침을 판정하고 `useMarqueeSelection`은 포인터 캡처와 프레임 단위 선택 상자만 관리한다. `CopyPreview`는 공통 기호를 그리며 UI 초안을 문서에 넣지 않는다. 확정은 기존 `Paste` 또는 `InsertComponentOnWire`와 주석 명령을 `useCircuitSession`에서 한 번에 실행해 권한·검증·Undo를 공유한다. 단일 부품의 삽입 후보와 실패 표시는 기존 배치와 같다.

## 독립 기준의 공개 계약

[ADR-033](../../decisions/ADR-033-independent-references.md)에 따라 `SolveOptions.referencePolicy`는 `explicit`(기본) 또는 `independent`이며 `analyzeOperatingCircuit`도 같은 옵션을 두 모델에 전달한다. 앱의 공통 해석은 `independent`를 사용한다. `SimulationResult.referenceGroups`는 `{ id, referenceNetId, netIds }[]`이며 각 `nodeVoltages`의 기준을 규정한다. 기준만 다른 영역을 묶지 않고 기존 piecewise 분할·평형·공통 계산 예산을 재사용한다.

`simulation.independentReferences`와 `queryVoltage`가 기준 간 비교를 막고 `measurement.probeVoltage`는 전용 진단을 반환한다. `visualization`은 이 메타데이터를 `PotentialModel.references`와 `PotentialValue.referenceId`로 전달하고 공통 `referenceGroupLabel`로 A/B 표기를 만든다. Canvas·탐침 패널·3D는 같은 결과를 표시하며 3D 차이 눈금과 경로 그래프도 기준을 검사한다. 자동 기준은 문서·스키마에 추가하지 않는다. 출처 지문 `references:independent-1`은 기존 기록과 현재 해석을 구분한다.

## 모듈 책임

| 모듈 | 책임 | 금지되는 결합 |
|---|---|---|
| `domain` | 회로 문서·계산 계약, ID, 현재 스키마·참조 검증 | React, SVG, Three.js, 저장 API |
| `rational` | 정규화된 BigInt 유리수 연산·비교·표시 변환 | 회로·단위·UI·저장 API |
| `quantity` | 소수·분수·SI 입력, 자동 단위·4자리 지수·원시 숫자 표시, 공통 축 단위 | React, 브라우저, 문서 변경 |
| `notation` | 수식 토큰·분수·아래첨자·기울임 변환 | React, 브라우저, 계산 결과 수정 |
| `component-library` | 단자 구성, 기본값, 표시 이름, 기호 | 행렬 계산 직접 수행 |
| `connectivity` | 명시적 연결을 따라 `net` 구성 | 화면 색, 선택 상태, 픽셀 좌표 판정 |
| `simulation` | `CompiledCircuit`에서 전위·전류·전력 계산 | React와 화면 좌표 |
| `diagnostics` | 컴파일·계산 모듈이 생성한 진단 집계와 중복 제거 | 자유 문장만 반환 |
| `editor` | 문서 편집 명령, 권한 검사, 실행 취소 | 포인터·React 상태, 물리 계산식 구현 |
| `wire-geometry` | Point 배열의 직각 경로·국소 변형·정리 | 문서·ID·UI·렌더러·명령·저장. domain 타입 외 모듈 의존 금지 |
| `measurement` | 측정 도구를 질의나 임시 회로 요소로 변환 | 원본 문서의 몰래 영구 변경 |
| `visualization` | `SimulationResult`를 2D 레이어로 변환 | 재계산 수행 |
| `potential-3d` | 2D 위치와 전위를 3D 장면으로 변환 | 회로 해석 직접 수행 |
| `current-view` | 2D·3D가 투영한 화면 경로에 비례 띠·방향 무늬를 표시하고 표시용 프레임 수명을 관리 | 회로 해석·전하 적분·React·Three.js 의존 |
| `export` | 공통 기호 자원에서 인쇄용 SVG·PNG 생성 | 화면 캡처에 의존 |
| `release` | 빌드 채널, 브라우저 저장 키와 기존 공용 키의 검증 후 복사 | 물리·회로 모델·UI 의존, 경로로 채널 추측 |
| `persistence` | 회로 자동 저장·파일 입출력, 별도 측정 기록 저장, domain의 현재 형식 검증 사용 | 과거 측정 기록을 현재 해석 결과로 사용 |
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

function validateDocument(input: unknown): DocumentValidation;
// 검증된 현재 형식의 독립 사본이 필요할 때 사용하며, 실패는 DocumentError로 전달한다.
function requireDocument(input: unknown): CircuitDocument;
```

[ADR-026](../../decisions/ADR-026-diode-boundary-analysis.md)의 다이오드 확장은 `SolveOptions.physicalModel`(`textbook` 또는 `component`)을 사용한다. `SimulationResult.provenance`는 선택된 물리 모델·고정 프로필과 특성의 식별자·수치 품질을 구별한다. 아핀 해 공간과 부등식은 simulation 내부에만 남는다. `queryVoltage(result, aNet, bNet)`과 `queryCurrent(result, terms)`는 전압차와 전류 선형결합 자체의 유일성을 질의하므로 개별 전위·전류가 미정이어도 확정 가능한 측정을 보존한다.

`analyzeOperatingCircuit(circuit, { physicalModel?, referencePolicy? })`는 현재 회로의 두 모델을 해석하고 표시 결과와 `OperatingAssessment`를 함께 반환한다. 조절 범위나 이전 모델은 입력으로 받지 않는다. `assessOperatingPoint`는 검증된 값과 해당 프로필의 경계를 비교하고 부품 ID·원인·근거 값을 보존한다. 과부하·파손 후 잠금·연출은 app의 세션 책임이며 모델 선택은 simulation에서 매 입력마다 결정한다. 측정 기록의 `provenance`와 CSV에도 모델·프로필·수치 출처가 남는다. 원래 풀이가 근사여도 같은 net의 차처럼 정확히 아는 측정은 기록값의 품질과 풀이의 출처가 다를 수 있다.

## 연결망 구성

전환 스위치의 역할·선택 쌍·다음 상태는 domain의 switch helpers가 소유한다. component-library는 목록용 ComponentKind와 기호·상태 문구·선택 접점 기하를 제공한다. connectivity는 선택된 한 쌍을 기존 닫힌 스위치 하나로 컴파일하며 measurement/visualization/potential-3d도 같은 쌍을 사용한다. 자세한 계약은 [ADR-029](../../decisions/ADR-029-changeover-switch.md)를 따른다.

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

관련 요구사항: SIM-004~006, MEA-001~004, TCH-001~003. 저장 문서는 v6이며 이전 형식의 변환·호환은 제공하지 않는다(ADR-024).

`measurement`는 `probeVoltage(compilation, result, red, black)`, `probeCurrent(document, compilation, result, target)`, `insertSeriesAmmeter(document, { componentId, ammeter, newWireId })`, `parameterSweep(document, request, compiler, engine)`, `createMeasurementRecord(document, fields)`, `measurementsToCsv(records)`를 공개한다. 결과는 성공 시 `{ ok: true, value, diagnostics }`, 실패 시 `{ ok: false, diagnostics }`로 반환한다. 전류계 ID와 위치, 기록 시각은 호출자가 제공하며 핵심 함수는 외부 시간에 의존하지 않는다.

분석 화면의 측정 도구은 `probeCurrent`의 부호 있는 전류와 기준 방향을 읽는다. 도선은 해당 edge를 제거한 연결 그래프와 단자 전류 합으로 처리하며, 도선 고리에는 미정 진단을 반환한다. 화면의 배치·스냅은 `app/measurement-tools`에 격리한다. 기존 전류계 삽입 공개 함수는 학습·계약 호환용으로 유지하며 분석 화면의 측정 도구에서는 호출하지 않는다. 이 함수는 선택 부품의 첫 전기 단자를 사용하되 전원은 positive 단자를 우선한다. 복제한 임시 문서·계기 ID·변경된 연결 정보를 반환하며 원본을 보존한다. 등가저항과 KCL·KVL 해석은 `simulation`의 공개 함수를 사용한다. 저항 측정 UI는 `equivalentResistance`의 `excludeSourceIds`에 모든 직류 전원 ID를 전달해 개방하며 원본 문서를 수정하지 않는다. 저수준 API의 나머지 독립원 비활성화 계약은 유지한다. `CircuitCanvas`의 측정 표시 옵션과 공통 `symbolMarkup(component, { disconnectedSource })`는 전원의 리드 단절·흐림만 표현하며 전기 계산에 관여하지 않는다. 물리 의미와 기록·실험 규칙은 [측정 규약](../physics/measurement-and-display.md)을 따른다.

`component-library`의 공통 표기와 `export`의 SVG·PNG·클립보드 함수 및 옵션은 [ADR-012](../../decisions/ADR-012-worksheet-presentation.md)에 모았다. `domain`의 `Exporter<TOptions>`는 확장용 인터페이스이며 앱은 현재 `exportSvg`, `exportPng`, `copyPng` 함수를 사용한다.

## 의존성 규칙

전류 표시는 [ADR-020](../../decisions/ADR-020-current-visualization.md)을 따른다. `visualization.buildCurrentModel(document, compilation, result)`은 measurement의 공개 `probeCurrent` 결과를 `CurrentModel`로 정리한다. `buildCurrentPaths(document, model, potential?, colors?)`는 별도 기하 변환이다. `current-view.createCurrentOverlay(host)`는 `update(projectedPaths, viewport, display, active?)`와 `dispose()`를 제공한다. `buildCurrentTracks`는 단자 ID를 기준으로 직렬 구간을 이어 무늬 위상을 공유한다. `CurrentDisplay`의 축척은 최대 전류에서 자동 계산하고 두께 배율·일시 정지는 문서 밖 UI 상태다. 2D는 SVG CTM, 3D는 `projectCurrentPaths`로 CSS 픽셀 경로를 만들어 같은 표시기에 전달한다. SVG 요소는 ID로 재사용하고, 시점 이동 중 점의 선분 내 위치를 재투영한다. 이동 종료 후 한 번의 교차 전환으로 화면 간격을 맞춘다. 그림의 길이나 무늬 시계가 물리 결과를 바꾸지 않는다.

`CurrentTrack.startJunction`과 `endJunction`은 실제 분기·합류 끝점 ID를 선택적으로 전달한다. `flowJunctionOpacity`는 투영된 경로의 끝점까지 거리에 따른 투명도만 반환하며 점의 위치·위상을 바꾸지 않는다. 공통 표시기는 접점 DOM도 ID로 재사용하고 전위색을 적용한다. 바닥 회로도 텍스처는 전류 표시 상태와 독립적이다.

- `domain`은 다른 기능 모듈을 import하지 않는다.
- `connectivity`와 `simulation`은 UI 모듈을 import하지 않는다.
- `visualization`은 결과 타입을 읽되 `simulation` 내부 구현을 호출하지 않는다.
- `app`은 사용자 흐름에 맞춰 계산·저장·화면을 조합한다. 다른 모듈은 책임표와 전체 구조도의 의존 방향을 따른다.
- 모듈 내부 파일이 아니라 공개 `index`를 사용한다.
- 순환 의존성이 생기면 책임을 다시 나누고 공통 타입을 최소 범위로 이동한다.

### 화면 내부의 책임

- `app/MeasurementDisplay`는 기존 측정 도구와 회로 위 계기창의 LCD 타이포그래피를 공유한다. `app/MeterReadouts`는 공개 측정 질의로 값을 읽고 기존 2D/3D `ComponentLabelLayout` 콜백의 선택적 `symbolAnchors`(계기 기호 우측 상단 화면 좌표)를 따라 배치한다. App이 열림 상태와 전원 분리·측정 중단 조건을 소유하며 값·UI 상태를 회로 문서에 저장하지 않는다. [ADR-035](../../decisions/ADR-035-inline-meter-readouts.md).
- `app/useCircuitSession`: 확정 문서·이력·단일/묶음 명령의 화면 모드 제한·자동 저장을 소유한다. App은 공개 실행 함수와 undo/redo만 호출한다. 학생 활동 권한과 문서 무결성은 계속 editor가 검사한다.
- `app/useCanvasDragSession`: 부품/도선 이동의 시작 문서·좌표·포인터 캡처·미리보기와 화면 이동 세션을 소유한다. Canvas는 실제 이벤트를 연결하고 터치·배선·측정 등 여러 조작의 취소를 함께 지시한다. 확정에는 미리보기와 같은 명령 구성 함수를 사용한다.
- `app/InlineComponentEditor`: 이름·값 초안, 파싱 오류, 입력 초점과 입력창 배치를 소유한다. Canvas에는 편집 대상 ID만 남긴다. 화면 크기 변화는 초안을 초기화하지 않는다.
- `app/AnalysisTools`: 부품 팔레트와 같은 스타일로 선택·측정 도구와 전지 분리 시작 안내를 표시한다. App은 도구·보기·열린 패널 상태를 연결하고 MeasurementPanel은 기존 측정·기록 계산을 재사용한다. 분석의 구조 명령 제한은 useCircuitSession에 둔다. [ADR-021](../../decisions/ADR-021-analysis-workspace.md)을 따른다.
- `app/PotentialSettings`: 전위 범위·높이 설정 표시를 담당한다. 설정 값은 App의 문서 밖 상태이며 같은 PotentialModel로 2D/3D를 갱신한다.

이 파일들은 app 내부 구현이며 별도 패키지·상태 라이브러리·범용 조작 프레임워크를 만들지 않는다. simulation 내부에서는 solver를 measurements가 사용하고 index가 두 구현의 공개 API를 재노출한다.

## 분수 표기

`quantity`는 입력 파싱·명시적 분수 복원·숫자 표시와 공통 축 단위를 제공하고, `notation`은 문구 토큰화·기울임을 담당한다. editor와 UI는 quantity의 parseQuantity를 사용하고 component-library는 componentValueInput·notationWidth·svgNotation을 공개한다. 수치 해석기는 정확한 SI 유리수만 받는다. ADR-012와 ADR-019를 따른다.

측정표의 `MeasurementEntry`, `loadMeasurementNotebook`, `saveMeasurementNotebook`은 persistence의 공개 계약이다. 측정 원시 기록을 감싸 메모·전류 방향·전원 분리 조건·탐침 위치를 별도로 저장한다. MeasurementAnchor·MeasurementAnchors 타입을 app/measurement-tools와 공유하며 위치 계산은 기존 anchorPose를 재사용한다. app의 `useMeasurementRecords`, `measurement-records`, `MeasurementTable`이 상태 연결·조건별 표시·복사·당시 회로 보기를 나눈다. [ADR-022](../../decisions/ADR-022-measurement-notebook.md).

`component-library.endpointName`과 `wireName`은 사용자용 위치 이름의 공통 경계다. 단자 방향·연결된 부품으로 설명하고 저장 ID는 사용자 이름의 대체값으로 사용하지 않는다. 연결 관계는 명시된 도선에서만 읽으며 좌표는 화면의 단자 방향 표현에만 사용한다.

전압 측정의 3D 입력은 `Potential3DProps.voltageMeasurement?: VoltageMeasurement`이다. App이 기존 측정 API와 탐침 위치 모델로 만든 빨강/검정 point·endpointId 및 포맷된 측정값을 넘긴다. 3D는 공통 PotentialModel의 높이와 카메라로 투영하며 계산·측정 기록을 소유하지 않는다. [ADR-006](../../decisions/ADR-006-threejs-integration.md)

## 연속 값 조절

`app/ComponentControlPanel`은 선택한 가변저항·스위치 조절창의 공통 틀이다. 스위치는 기존 `SwitchStateButton`·SetProperties를 사용하며 가변저항 자동 실행 수명과 비교 축척에 섞지 않는다. `component-library.componentValueDisplay`는 다이오드 종류·스위치 상태의 글자 크기, 표시 이름, 출력 기본 숨김을 한 곳에서 정의해 공통 배치·출력·설정 UI에 제공한다.

component-library.adjustableParameter는 부품의 조절 속성·범위·단위를 제공한다. app/parameters는 재사용 가능한 값 조절 UI·프레임 갱신·자동 왕복과 기존 analyze를 통한 비교 축척 계산을 맡는다. useCircuitSession.execute의 선택적 조작 토큰으로 연속 명령을 한 실행 취소 단위로 묶는다. 새 전원장치의 속성 정의가 추가되면 같은 조절 경로를 사용할 수 있다. potential-3d/primitives는 선·튜브·점 자원을 유지해 계산값 변경 시 좌표와 표시 속성을 갱신한다. 자세한 계약은 [ADR-023](../../decisions/ADR-023-live-parameters.md)을 따른다.


### 만들기·2D 분석·3D 분석의 공통 처리

- App의 `setSelection`은 요소 선택·net 강조·이전 hover 정리를 함께 처리한다. 캔버스의 측정/경로 도구 해석은 `selectElement`에 두고, 상세 설정·부품 배치·진단 위치 선택은 같은 상태 갱신 함수를 사용한다. 화면 모드 전환 시 유효한 선택을 보존하는 필터는 별도다.
- `app/component-value.parseComponentValue`는 회로 위 편집·상세 설정·실시간 조절기의 단위 해석, 음의 저항 및 범위 검사, 분수 보존을 공유한다. 입력 초안과 적용 동작은 각 UI가 소유한다. 범위만 편집했을 때의 현재값 보정도 같은 함수에서 처리한다.
- App은 유효한 탐침 위치로 전압 측정 결과·표시 문자열을 한 번 준비해 MeasurementPanel과 3D 높이 차 표지에 전달한다. 기록도 이 결과를 사용한다. 3D는 위치 투영만 수행한다.
- SVG와 Three.js의 히트 판정·좌표 투영·시야 조작은 각각의 어댑터에 둔다. 공통화 대상은 사용자 동작의 의미와 상태/명령 처리이며 렌더러 자체를 합치지 않는다.

단자·전위 표지의 일반 선택은 공통 `selectNet`을 사용한다. 2D는 단자 ID로 net을 찾고, 3D는 렌더링에 사용한 net ID를 `onSelectNet`으로 전달한다. 대표 부품·도선으로 대상을 바꾸지 않는다.

### 구현 내부 경계

전체 화면 갱신의 예상 밖 예외는 app에서 `calculation`(연결 구성·회로 계산·진단), `preparation`(측정·표시 모델 준비), `render`(그 밖의 화면 준비·표시) 세 단계로 구분한다. `runScreenStage`는 동기 작업의 최초 실패 단계를 보존하며 계산값을 대신 만들지 않는다. React 렌더·효과에서 전파된 예외는 최상위 `ErrorBoundary`가 단계 안내와 새로고침, 오류 정보 복사를 제공한다. 복사 정보는 단계·허용된 예외 종류·버전·채널·빌드 식별자로 제한하며 원문·스택·회로·작성 글을 넣거나 자동 전송하지 않는다. 이벤트 핸들러·비동기 작업은 이 경계의 포착 대상이 아니며, 정상적인 회로 진단과 저장·한마디·3D의 기존 개별 실패 처리는 유지한다. 분류와 격리는 `tests/screen-failure.test.ts`에서 검증한다.

`app/operating-help`는 확정된 분석 결과·공개 질의에서 설명 후보를 고르는 순수 함수, 학생용 문구, 화면 충돌 배치, 공통 HTML UI를 분리한다. `CircuitCanvas`와 `Potential3D`의 선택적 `onComponentLabelLayout`은 `visualization.ComponentLabelLayout`(뷰포트 픽셀 기준 bounds·부품 라벨·장애물 사각형)만 전달한다. 3D는 기존 render 투영을 재사용하고 `onViewInteraction`으로 카메라 이동 시작을 알린다. app는 열림 상태를 소유하며 `FloatingPanel`의 선택적 controlled open과 기존 포털·키보드 처리를 재사용한다. 계산 모델·위험 판정·파손 효과 SVG와 설명 문구는 독립적으로 수정할 수 있다. [ADR-026](../../decisions/ADR-026-diode-boundary-analysis.md), [설명 계약](../ux/operating-help.md).

`rational/conversion`은 단위 없는 10진 토큰 해석과 화면용 binary64 변환을 소유하고, quantity는 이를 재사용해 분수·SI 단위 문법과 표시를 처리한다. domain에는 최소 타입과 저장 정규형 검증만 둔다. `visualization/potential`은 정확 전위와 표시 좌표·축 단위 변환을 함께 관리한다. 2D 범례와 3D 눈금은 같은 공개 변환 함수를 사용하고, 숫자 표시는 정확 전위를 사용한다. 3D 높이 맞춤과 장면 경계는 같은 눈금 계산을 재사용한다.

`domain`은 다이오드 종류와 프로필 ID·특성·경계의 대응을 제공한다. `editor.SetDiodeKind`는 프로필 교체와 이전 편차 제거를 한 번에 처리한다. app의 `DiodeKindField`를 인라인 초안 편집과 상세 즉시 편집에서 공유하며 입력 수치는 quantity로 표시한다. useCircuitSession이 모드·잠금·종류를 바꾸는 이력 복원을 검사한다. [ADR-028](../../decisions/ADR-028-diode-kinds.md).

`simulation/equilibrium`은 엔진 내부의 교육용 평형 선택이다. piecewise가 검증한 후보 아핀 가족과 다이오드 전압 가중치를 받아 정확 KKT와 기존 solution-space의 소거·실현 가능성 검증을 재사용한다. 최소 다이오드 전압 벡터를 만족하는 전체 가족을 보존하고 공개 결과·질의는 이를 공유한다. UI·측정은 보정하지 않는다. 다이오드 결과의 profileRevision 지문에는 diode-equilibrium-1 정책을 포함하여 기존 기록과 구별한다. [ADR-030](../../decisions/ADR-030-diode-equilibrium.md).
