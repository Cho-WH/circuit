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
| `activity` | 허용 명령, 예측, 공개 단계, 초기화 정책 | UI 숨김만으로 권한 보장 |
| `export` | 공통 기호 자원에서 인쇄용 SVG·PNG 생성 | 화면 캡처에 의존 |
| `persistence` | 자동 저장, 파일 입출력, 버전 변환 | 계산 결과를 정답으로 저장 |

## 핵심 공개 인터페이스

```ts
interface CircuitCompiler {
  compile(document: CircuitDocument): CompileResult;
}

interface SimulationEngine {
  solve(
    circuit: CompiledCircuit,
    options: SolveOptions
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

초기 구현은 Union-Find 같은 집합 병합 구조를 사용할 수 있다.

## 명령과 실행 취소

문서 변경은 UI 컴포넌트가 직접 상태를 수정하지 않고 `Command`를 통해 수행한다.

| 명령 | 권한 검사 | 실행 취소 정보 |
|---|---|---|
| `AddComponent` | 구조 편집 허용 여부 | 추가된 ID |
| `MoveComponent` | 이동 허용 여부 | 이전 좌표 |
| `ConnectWire` | 배선 편집 허용 여부 | 생성 도선·분기점 |
| `SetComponentValue` | 값 변경 허용 여부 | 이전 값 |
| `SetAnswerVisibility` | 교사 편집 권한 | 이전 표시 규칙 |
| `ResetActivity` | 학생 초기화 허용 여부 | 현재 작업 사본 |

명령 실행 전 `ActivityPolicy`를 검사한다.

## 의존성 규칙

- `domain`은 다른 기능 모듈을 import하지 않는다.
- `connectivity`와 `simulation`은 UI 모듈을 import하지 않는다.
- `visualization`은 결과 타입을 읽되 `simulation` 내부 구현을 호출하지 않는다.
- `app`만 여러 모듈을 조합한다.
- 모듈 내부 파일이 아니라 공개 `index`를 사용한다.
- 순환 의존성이 생기면 책임을 다시 나누고 공통 타입을 최소 범위로 이동한다.
