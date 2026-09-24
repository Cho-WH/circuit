# 문서 색인

## 먼저 읽을 문서

- [현재 작업 현황](implementation/current-phase.md): 현재 구현·미완료 범위와 커밋·배포 상태
- [빠른 시작](ux/quick-start.md): 현재 앱 사용법
- [작업 추적](implementation/mvp-tracker.md): 변경별 구현·검증 이력
- [요구사항](../requirements/requirements.yaml) · [스키마](../schemas/) · [기술 결정 색인](../decisions/README.md): 규범과 계약

## 제품

- [`product/brief.md`](product/brief.md): 제품 정의, 사용자, 원칙, 성공 지표
- [`product/scope.md`](product/scope.md): MVP 포함 범위와 비목표

## 사용자 경험

- [터치 조작 코드 점검·모바일 UX 권장안](ux/2026-09-24-touch-interaction-audit.md): 결함과 지원 공백, 이벤트 재현 근거, 권장 제스처·피드백·탭 대안과 최소 지원 수용 기준
- [프론트엔드 디자인 검토·개선 제안](ux/2026-09-24-frontend-design-review.md): ‘한마디’를 기준으로 한 화면별 진단, 공식 디자인 사례, 문구·위계·모션·3D 개선안. 검토 당시 근거와 현재 구현 반영표 포함
- [`ux/quick-start.md`](ux/quick-start.md): 실행, 편집, 전위·측정, 저장과 단축키
- [`ux/overview.md`](ux/overview.md): 화면 모드와 반응형 구조
- [`ux/interactions.md`](ux/interactions.md): 부품 배치, 배선, 값 수정, 오류 피드백
- [`ux/workflows.md`](ux/workflows.md): 현재 교사·학생 흐름과 후속 활동 배포 구분
- [2026-09-23 UX 검토](archive/ux-review/2026-09-23-mvp-ux-review.md): 개선 전 관찰·제안과 화면 근거를 보존한 역사 기록

## 물리 규약

- [`physics/ideal-dc-model.md`](physics/ideal-dc-model.md): MVP의 이상적 직류 모델
- [`physics/potential-visualization.md`](physics/potential-visualization.md): 전위 숫자·색상·높이 규칙
- [`physics/measurement-and-display.md`](physics/measurement-and-display.md): 측정기와 수치 표시 규칙

## 기술 구조

- [`architecture/overview.md`](architecture/overview.md): 전체 계층과 의존 방향
- [`architecture/domain-model.md`](architecture/domain-model.md): 저장 상태, 계산 상태, 핵심 개체
- [`architecture/modules.md`](architecture/modules.md): 모듈 책임과 공개 인터페이스
- [`architecture/data-flow.md`](architecture/data-flow.md): 편집부터 계산·표시·저장까지의 흐름
- [`architecture/extension-points.md`](architecture/extension-points.md): 부품·엔진·출력 확장 경계
- [`architecture/persistence-and-sharing.md`](architecture/persistence-and-sharing.md): 자동 저장, 파일, 마이그레이션, 공유

- [`architecture/feedback.md`](architecture/feedback.md): Firebase 후기 게시판의 데이터·권한·운영 구조
- [ADR-012](../decisions/ADR-012-worksheet-presentation.md): 출력 표기 속성과 출력 계약
- [ADR-013](../decisions/ADR-013-wire-editing-ux.md): 삽입·분기·교차와 문맥 배선
- [ADR-014](../decisions/ADR-014-feedback-board.md): 후기 저장·공개·삭제 정책

## 구현·검증

- [`implementation/phases.md`](implementation/phases.md): 단계 0~7의 산출물과 종료 조건
- [`implementation/current-phase.md`](implementation/current-phase.md): 현재 구현 범위·게시 상태·남은 작업
- [`implementation/mvp-tracker.md`](implementation/mvp-tracker.md): 초기 MVP와 후속 작업의 검증 이력
- [`implementation/firebase-setup.md`](implementation/firebase-setup.md): Firebase와 공개 사이트 설정·검증 기록
- [`implementation/definition-of-done.md`](implementation/definition-of-done.md): 공통 완료 조건
- [`testing/mvp-coverage.md`](testing/mvp-coverage.md): 초기 요구사항별 근거·후속 검증 범위·남은 한계
- [`testing/strategy.md`](testing/strategy.md): 테스트 층과 물리 불변식
- [`testing/fixtures.md`](testing/fixtures.md): FIX-01~FIX-10의 목적
- [`testing/usability.md`](testing/usability.md): 교사·학생 사용성 과제

## 운영

- [`operations/development-workflow.md`](operations/development-workflow.md): Git, 이슈, PR, 문서 변경 규칙
- [`operations/risks.md`](operations/risks.md): 주요 위험과 완화책
- [`glossary.md`](glossary.md): 개발·물리 용어
