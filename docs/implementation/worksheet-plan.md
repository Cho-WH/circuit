# 단계 5 구현 계약

관련 요구사항: TCH-001~003. 동일한 v1 문서를 문제·정답 모드로 표현하며 계산값은 문서에 저장하지 않는다.

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

## 검증

검증 Sol이 문제/정답 동일 문서·해석 불변성, 공통 표시 규칙, 텍스트 이스케이프, SVG 옵션과 독립성, PNG 크기·시각 출력, 복사/파일 대체 흐름을 확인한다. 실제 교사의 2분 수행 목표와 타 워드프로세서 붙여넣기는 관찰하지 않은 경우 미검증으로 남긴다.

## 공개 출력 계약

`exportSvg(document, options?, result?)`는 결정론적 문자열을 반환한다. `exportPng`는 같은 입력에서 고해상도 PNG Blob을, `copyPng`는 `{ copied, blob }`을 반환하며 복사 실패 시 UI가 그 Blob을 내려받게 한다. 옵션은 `mode`(기본 answer), `monochrome`, `background`(white/transparent), `margin`, `pngScale`, `numberFormat`이다. 숫자 형식은 significant/digits, fixed/digits, integer의 합집합이다.

공통 `componentPresentation(component, mode, result?, numberFormat?)`는 label/value/voltage/current의 string 또는 null을 반환한다. `annotationPresentation(annotation, mode)`가 가시성과 빈칸/질문 기본 문구를 일치시킨다. 현재 스키마에 방향 필드가 없으므로 화살표 주석은 anchor에서 오른쪽으로 향한다.

내보낸 PNG는 앱 안에서도 미리 볼 수 있게 하여 사용자가 붙여넣기 전에 실제 이미지의 표시 규칙과 잘림을 확인한다. 복사 실패는 다운로드로 대체했다는 문구를 명시한다. 미리보기 Blob URL은 교체·닫기·컴포넌트 제거 시 해제한다.
