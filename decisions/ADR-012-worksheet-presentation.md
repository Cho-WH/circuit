# ADR-012: 회로도 출력 편집과 공통 렌더링

- 상태: accepted
- 결정일: 2026-09-23
- 관련 요구사항: TCH-001~003, DAT-001~002

## 결정

회로도 출력은 시험지·수업 자료용 그림 편집 화면이다. 출력 문구와 배치를 CircuitDocument에 저장하고 물리 속성과 계산 결과는 변경하지 않는다. 실제 회로 편집은 CircuitCanvas, 출력 편집은 OutputCanvas가 담당한다. OutputCanvas는 export의 createSvgExport가 생성한 SVG 내용을 사용하므로 편집 화면·SVG·PNG의 배치가 일치한다. 선택·드래그 손잡이·화면 배율은 출력에 포함하지 않는다.

## 표기와 배치

부품 properties의 labelText/answerText는 출력용 이름/값이다. 기존 labelDisplay/answerDisplay(value, hidden, ?, blank, custom)를 읽으며, 이름과 값의 Visible·Blank 불리언을 독립적으로 저장한다. Visible=false가 빈칸보다 우선한다. 빈칸은 밑줄 대신 사각형으로 그린다. 이름과 값의 OffsetX/OffsetY는 회전별 기본 표기 위치에 더하는 문서 좌표다. 부품과 도선 자체는 출력 화면에서 이동하지 않는다.

output.fontScale은 0.5~2의 문서 설정이다. 글자 및 사각 빈칸의 크기에 적용하고 출력 경계에도 반영한다. 드래그는 임시 문서로 미리 보며 놓을 때 한 명령으로 기록한다. Escape, 포인터 취소, 캡처 상실, 창 초점·문서·도구 변경은 미리보기를 취소한다. 화살표 양 끝은 따로 움직이며 본체 이동은 양 끝을 함께 옮긴다. 빈 공간 드래그와 확대·축소·전체 맞춤은 화면만 바꾼다.

## 주석과 저장 호환성

저장 형식 v2의 Annotation에 point 종류, 선택적 position/end 좌표, null anchor를 추가한다. anchor가 null이면 position이 필수다. 예전 anchor 주석은 처음 이동하기 전까지 기존 기준 위치를 따른다. 자유 배치한 주석은 회로 연결 ID에 의존하지 않는다. visibility는 always/hidden이며 주석은 출력 화면과 출력 이미지에만 보인다.

validateDocument는 v1 입력을 이전 스키마로 검증한 뒤 복제하여 v2로 순차 변환한다. 기존 주석의 problem/always는 always, answer/hidden은 hidden으로 옮겨 종전 문제 그림을 보존한다. 원본은 수정하지 않는다. 브라우저 저장 키는 유지하여 기존 자동·명시·백업 저장본을 찾을 수 있고, 다음 저장부터 v2를 기록한다. v1 fixture는 호환성 검증 자료로 유지한다.

## 출력 계약

exportSvg(document, options?, result?)와 createSvgExport는 동일한 문서 좌표를 사용한다. createSvgExport는 svg, 내부 content, bounds, 정규화 options를 반환한다. componentPresentation(component, result?)과 annotationPlacements(document)는 공통 표기를 제공한다. exportPng는 SVG를 래스터화하고 copyPng는 복사 여부와 PNG Blob을 반환한다.

사용자 옵션은 접지 표시·투명 배경·고해상도 출력 토글이다. 접지는 기본으로 숨기며 showGround=true이면 접지 기호만 그린다. 출력 접지에는 0 V 문자를 붙이지 않는다. 이 설정은 회로 연결과 기준 전위에 영향을 주지 않으며 3D 바닥 회로의 기준점 표시는 유지한다. 숫자는 기본 단위로 소수점 최대 두 자리까지 반올림하고 끝자리 0을 생략한다. 기본 출력은 검은색, 여백 16 문서 단위, PNG 1배다. highResolution=true이면 기본 PNG의 정수 픽셀 가로·세로를 정확히 두 배로 생성한다. 저수준 렌더러의 monochrome·margin은 3D 바닥 회로 등의 호출에만 사용한다. 3D 바닥 회로가 사용하는 circuitOnly=true는 출력 장식·문구·배율 없이 실제 회로 기호와 이름·값을 그린다. 기본 출력에서는 단자와 분기점 점을 생략하며 비연결 교차의 아치를 유지한다. 점 도구로 추가한 점만 별도로 그린다. 사용자 문구와 식별자는 XML escape한다.

회로 기호·이름·숫자·단위는 Libertinus Math를 사용한다. 부품 이름과 점·전류 화살표 기호는 수학 이탤릭 글리프로 표시하고 숫자·첨자 숫자·물리 단위는 정자로 둔다. I = 3/4 A 같은 표기는 등호 왼쪽 기호만 기울인다. 표기 변환은 렌더링에만 적용하여 저장 문자열과 입력값을 유지한다. 일반 앱 버튼·메뉴·설명은 기존 UI 글꼴을 유지한다. 공식 v7.051 WOFF2와 OFL 라이선스를 typography에 포함하며 독립 SVG에는 폰트 데이터를 내장하여 PNG·미리보기·외부 SVG에서도 같은 글꼴을 사용한다.

## 입력한 분수

notation의 parseQuantity는 분수·부호·SI 접두어를 파싱하여 계산용 value와 선택적 fraction 문자열을 반환한다. 부품 properties의 resistanceOhm/voltageV는 계속 숫자이며 resistanceOhmFraction/voltageVFraction에 명시적으로 입력한 비율을 저장한다. 기존 v2의 확장 속성이므로 스키마 변경이나 마이그레이션은 없다. 표기가 현재 수치와 일치할 때만 표시하고 숫자만 바꾸는 편집 명령은 이전 표기를 삭제한다. 저장·복사·실행 취소는 두 속성을 함께 보존한다.

이름·출력 값·주석의 숫자 비율은 공통 notationTokens와 svgNotation으로 분자·가로선·분모를 그리며 분자와 분모는 주변 숫자와 같은 폰트 크기를 사용한다. 이름·값 사이의 기본 간격과 출력 경계에 증가한 높이를 반영한다. 라이브 회로와 독립 SVG·PNG가 같은 벡터 배치를 사용하고 출력 경계는 분수 높이를 포함한다. 일반 소수와 자동 계산 결과는 소수 표기를 유지한다.

## 검증

이전 파일의 변환·저장 왕복, 자유 주석과 이름·값의 독립 이동, 실행 취소/다시 실행, 사각 빈칸·배율·회전 화살표의 출력 경계, 물리 계산 불변성 및 실제 PNG를 확인한다. 모바일 실기기와 외부 문서 붙여넣기는 별도 사용성 검증 범위다.

## 이름의 아래첨자

`R_1`, `R_{eq}`의 아래첨자는 notationTokens의 subscript 토큰으로 파싱한다. 문자·숫자 뒤의 밑줄과 영숫자 묶음 또는 중괄호 묶음을 지원하며 불완전한 표기는 원문으로 남긴다. SVG는 크기 70%·기준선 아래 0.28em에 배치하고 HTML은 sub 요소로 표시한다. 공통 표기와 폭 계산을 사용하며 저장 문자열은 바꾸지 않는다. 기존 유니코드 첨자도 그대로 읽으므로 스키마·마이그레이션 변경은 없다.

## 기본 글자 크기와 배치

기본 회로 표기는 기존 대비 1.5배(라이브 21, 출력 22.5 문서 단위)이며 출력 글자 배율은 이 기본값에 곱한다. componentNotationLayout이 회전·글자 크기·분수 높이를 고려해 라이브/출력의 이름·값 위치를 정한다. 가로 부품은 기호 높이에 따라 위아래 여백을 좁게 두고, 세로 부품은 옆에 두 줄을 정렬한다. 사용자 출력 위치 오프셋은 새 기본 위치에 그대로 더한다. 표기 크기는 회로 기하·연결을 바꾸지 않는다.
