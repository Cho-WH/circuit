# 기술 결정 기록

ADR은 기술 선택의 배경, 결정, 결과를 기록한다.

## 상태

- `proposed`: 검토 중
- `accepted`: 채택된 기준. 구현 완료 여부는 [현재 현황](../docs/implementation/current-phase.md)에서 별도로 관리한다.
- `superseded`: 다른 ADR로 대체
- `rejected`: 채택하지 않음

## 목록

| ADR | 제목 | 상태 | 결정 시점 |
|---|---|---|---|
| ADR-001 | SVG 기반 2D 편집기 | accepted | 기준안 |
| ADR-002 | 상태 관리 방식 | accepted | 단계 2 |
| ADR-003 | 0 Ω 요소 처리 | accepted | 단계 1 |
| ADR-004 | 행렬 풀이 구현 | accepted | 단계 1 |
| ADR-005 | 공유 링크 형식 | proposed | 단계 6 전 |
| ADR-006 | Three.js 연동 방식 | accepted | 단계 3 전 |
| ADR-007 | 로컬 우선 저장 | accepted | 기준안 |
| ADR-008 | 단일 저장소와 모듈 경계 | accepted | 기준안 |
| ADR-009 | 자체 MNA 직류 엔진 | accepted | 기준안 |
| ADR-010 | 런타임 계약과 검증 | accepted | 단계 0 |
| ADR-011 | 등가저항의 포트와 외부 시험 전원 | accepted | 단계 4 구현 전 |
| [ADR-012](ADR-012-worksheet-presentation.md) | 출력 공통 표기와 독립 출력 | accepted | 단계 5 구현 전 |
| [ADR-013](ADR-013-wire-editing-ux.md) | 도선 삽입과 교차 연결의 명시적 편집 | accepted | MVP UX 개선 |
| [ADR-014](ADR-014-feedback-board.md) | 익명 후기 게시판과 백엔드 교체 경계 | accepted | MVP 이후 피드백 |
| [ADR-015](ADR-015-non-contact-measurement.md) | 비접촉 측정과 도선 전류 | accepted | 측정 UX 개선 |
| [ADR-016](ADR-016-local-wire-routing.md) | 국소적인 직각 도선 편집 | accepted | 도선 UX 개선 |
| [ADR-017](ADR-017-delete-components-keep-wiring.md) | 부품 삭제 시 도선 연결 유지 | accepted | 도선 UX 개선 |
| [ADR-018](ADR-018-junction-lifecycle.md) | 분기점의 국소 정리와 배선 시작 | accepted | 도선 UX 개선 |
| [ADR-019](ADR-019-quantity-input-and-display.md) | 수치 입력과 표시의 공통 모듈 | accepted | 숫자 표시 UX 개선 |
| [ADR-020](ADR-020-current-visualization.md) | 전류의 물리량과 표시용 움직임 분리 | accepted | 전류 시각화 개선 |
| [ADR-021](ADR-021-analysis-workspace.md) | 시각화와 측정의 분석 화면 통합 | accepted | 분석 UX 1차 통합 |
| [ADR-022](ADR-022-measurement-notebook.md) | 비교를 위한 측정표와 별도 로컬 기록 | accepted | 측정 기록 UX 개선 |
| [ADR-023](ADR-023-live-parameters.md) | 가변저항 조절과 연속 갱신 | accepted | 가변저항 학습 조작 |
| [ADR-024](ADR-024-exact-dc-arithmetic.md) | 선형 직류 회로의 정확 유리수 연산 | accepted | 정확 연산·회로 v5·비용 검증 완료, 예산 초과 정책은 ADR-025 |
| [ADR-025](ADR-025-bounded-approximate-dc.md) | 계산 예산을 넘는 직류 회로의 명시적 근사 해석 | accepted | 계산 예산·근사·품질 전달·기록 v4 구현 |
| [ADR-027](ADR-027-release-channels.md) | 안정판·개발판 배포와 브라우저 저장 분리 | accepted | main/dev 상시 운영 |
