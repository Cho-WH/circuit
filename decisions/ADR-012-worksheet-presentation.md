# ADR-012: 같은 문서에서 문제·정답과 인쇄 출력

- 상태: accepted
- 결정일: 2026-09-23
- 관련 요구사항: TCH-001~003

## 결정

v1의 `ComponentInstance.properties`에 교사 표시 규칙을 저장한다. 물리 컴파일러는 자신이 담당하는 전기 속성만 읽으므로 표기 변경은 연결망과 계산 결과를 바꾸지 않는다. 기존 `Annotation`으로 지점 이름·화살표·빈칸·질문·설명을 표현한다. 새 저장 형식이나 마이그레이션은 필요하지 않다.

`component-library`가 문제/정답 텍스트와 숫자 형식을 생성하는 공통 함수를 제공한다. 편집 SVG와 독립 출력 SVG는 같은 함수를 사용한다. 원시 계산값은 `SimulationResult`로 전달하며 표시값을 `CircuitDocument`에 저장하지 않는다. 상세 표시 속성과 출력 API는 아래 계약을 따른다.

내보내기는 문서 좌표에서 기호와 텍스트를 다시 생성한다. SVG는 벡터와 `<text>`를 유지하며 팬·줌·선택 상태와 독립적이다. PNG와 클립보드는 이 SVG를 바탕으로 생성한다. PNG의 배율·여백·배경·흑백 및 숫자 형식은 출력 옵션이며 문서 구조를 바꾸지 않는다.

## 표시 규칙

부품의 `properties`에 값(`answerDisplay`/`answerText`), 이름(`labelDisplay`/`labelText`), 전압(`voltageDisplay`/`voltageText`), 전류(`currentDisplay`/`currentText`) 규칙을 기록한다. 허용 규칙은 `value`, `hidden`, `?`, `blank`, `custom`이다. 문제 모드에서는 선택 규칙을, 정답 모드에서는 실제 이름·값을 표시한다. 전압·전류의 표시 여부는 `showVoltage`, `showCurrent`로 별도 저장한다. 기본값은 측정값 숨김이다.

공통 `componentPresentation` 함수가 라이브 SVG와 출력 SVG의 텍스트를 생성한다. 숫자는 기본 3자리 유효숫자와 SI 접두어를 사용한다. 출력/교사 보기 옵션으로 정수·소수 자리수·유효숫자를 고를 수 있으며, 정수·소수 모드는 기본 단위(V/A/Ω)를 사용한다. 계산은 원시값을 유지한다.

## 주석과 출력

- 점 이름·전류 화살표·미지수·설명은 기존 `Annotation`과 명시적 endpoint anchor를 사용한다.
- 주석의 always/problem/answer/hidden 가시성을 동일하게 적용한다.
- SVG는 문서와 공통 기호에서 독립 생성하며 편집 테두리·팬·줌을 포함하지 않는다.
- 흑백, 투명 배경, 여백, PNG 배율을 적용한다. 사용자 텍스트는 XML escape한다.
- PNG는 해당 SVG를 래스터화하며, 클립보드를 사용할 수 없으면 같은 PNG 파일로 저장한다.
- 빈 회로, 긴 이름, 회전한 부품과 모든 주석의 출력 경계를 고려한다.

## 공개 출력 계약

`exportSvg(document, options?, result?)`는 결정론적 문자열을 반환한다. `exportPng`는 같은 입력에서 고해상도 PNG Blob을, `copyPng`는 `{ copied, blob }`을 반환하며 복사 실패 시 UI가 그 Blob을 내려받게 한다. 옵션은 `mode`(기본 answer), `monochrome`, `background`(white/transparent), `margin`, `pngScale`, `numberFormat`이다. 숫자 형식은 significant/digits, fixed/digits, integer의 합집합이다.

공통 `componentPresentation(component, mode, result?, numberFormat?)`는 label/value/voltage/current의 string 또는 null을 반환한다. `annotationPresentation(annotation, mode)`가 가시성과 빈칸/질문 기본 문구를 일치시킨다. 현재 스키마에 방향 필드가 없으므로 화살표 주석은 anchor에서 오른쪽으로 향한다.

내보낸 PNG는 앱 안에서도 미리 볼 수 있게 하여 사용자가 붙여넣기 전에 실제 이미지의 표시 규칙과 잘림을 확인한다. 복사 실패는 다운로드로 대체했다는 문구를 명시한다. 미리보기 Blob URL은 교체·닫기·컴포넌트 제거 시 해제한다.

## 검증

문제/정답 전환과 주석·표기 편집 전후의 물리 결과 불변성, 텍스트 이스케이프, 공통 표기 일치, PNG 크기와 시각 결과를 확인한다. 실제 워드프로세서 붙여넣기와 교사 시간 목표는 실행 여부를 별도로 기록한다.
