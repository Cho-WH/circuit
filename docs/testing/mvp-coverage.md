# 검증 범위와 실행 위치

현재 테스트 소스가 실행 가능한 기준이다. 과거 통과 횟수·브라우저 캡처는 현재 버전의 검증을 대신하지 않는다. 변경과 관련된 검사부터 실행하며 전체 verify는 광범위한 변경이나 명시적 요청에 사용한다.

| 범위 | 주요 테스트 | 보호하는 동작 |
|---|---|---|
| 계약·저장 | specifications, editor-persistence, circuit-session, release-storage | 현재 형식 왕복·지원 밖 입력 거부, 참조 무결성, 백업·저장 실패·채널 분리 |
| 계산 | simulation, exact-dc, rational, bounded-dc | 물리 fixture, 정확한 0·KCL/KVL·전력, 결정론, 계산 예산·근사 오차·실패 |
| 다이오드·독립 회로 | diode-engine, diode-domain, diode-kinds, diode-session, independent-references | 평형·차단 전류, 작동 경계, 프로필·분석 잠금, 다른 기준 사이의 측정 차단 |
| 연결·편집 | wire-editing, wire-routing, junction-editing, component-deletion, changeover-switch | ID 기반 연결, 국소 경로 보존, 원자적 명령·권한·Undo/Redo |
| 입력·복사·접지 | context-wiring, canvas-drag, touch-interactions, copy-placement, selection-copy-ui, reference-editing, component-names | 실제 포인터/키 입력, 취소·후속 클릭 억제, 복사 ID/이름, 수동 접지와 열린 배선 끝 |
| 측정·조절 | measurement, non-contact-measurement, resistance-mode, measurement-notebook, meter-readouts, live-value, adjustable-parameter | 부호·미정·전원 분리, 조건별 기록·CSV, 계기 동시 표시·실시간 갱신 |
| 화면·수명 | analysis-workspace, workspace-ui, potential-3d-lifecycle, potential-workspace, current-overlay | 모드 전환·선택·측정 상태, 비동기 준비·GPU/DOM 정리·카메라 유지 |
| 시각화·출력 | visualization, potential-3d, current-visualization, quantity-graphs, worksheet-export, output-canvas, example-layout | 같은 net의 동일 표시, 작은 값·정확한 0, 문서 기반 출력·배선/표기 충돌 |
| 입력 형식·접근성 | quantity, notation, quick-start, potential-palette-picker | 입력/표시 분리, 잘못된 값 거부, 키보드·초점·모달 조작 |
| 후기 | feedback, feedback-ui, feedback-admin-auth, feedback-firestore | 권한·작성/수정/삭제·검증·보안 규칙. Firestore는 에뮬레이터에서 별도 실행 |
| 문서·모듈 | document-links, boundaries, specifications | 로컬 링크, import 경계, 요구사항/fixture 참조 |

검사 파일은 tests/ 아래에 있다. 명령은 package.json과 [개발 운영](../operations/development-workflow.md)을 따른다. npm run verify는 모듈 경계·Vitest·타입/빌드를 묶는다. Firestore 검사는 npm run test:firestore로 분리한다.

성능 수치는 CI 합격 조건으로 고정하지 않는다. [부하 보고서](exact-dc-performance.md)는 계산 예산의 근거와 재현 방법을 남긴다. 실제 사용자·기기·인쇄·장시간 검증은 [남은 작업](../implementation/follow-up.md)과 [사용성 기준](usability.md)에서 관리한다.
