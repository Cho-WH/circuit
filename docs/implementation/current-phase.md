# 현재 작업 현황

기준일: 2026-10-08. 앱 0.1.0, 작업 브랜치 dev. 저장은 회로 v6·측정 기록 v5이며 명시적 복원에서 회로 v5→v6 변환을 지원한다. 읽지 못한 원본은 별도 보관한다([ADR-039](../../decisions/ADR-039-circuit-recovery.md)).

단계 0~5 MVP와 다이오드 확장 D0~D4는 구현했다. 단계 6 활동·공유와 단계 7 교실 알파는 미완료다. 후속 후보는 착수 승인이 아니다. [단계 계획](phases.md), [남은 작업](follow-up.md).

## 현재 지원 범위

| 영역 | 현재 동작과 설계 기준 |
|---|---|
| 계산 | 이상적 선형 직류·정확 유리수, 예산 초과 시 검증된 명시적 근사. 다이오드 0.7 V·구간선형 부품 모델, 고정 교육용 작동 경계. [ADR-024~026](../../decisions/README.md) |
| 다이오드 평형 | 차단 전류는 정확히 0 A. 스위치 개방으로 생기는 전압 자유도는 평형 선택으로 처리하며 누설전류를 추가하지 않는다. [ADR-030](../../decisions/ADR-030-diode-equilibrium.md) |
| 독립 회로·접지 | 독립 영역별 계산과 영역 간 전압 비교 차단. 자동 기준은 계산에만 사용하고 수동 접지만 표시·이동·삭제한다. [ADR-033](../../decisions/ADR-033-independent-references.md), [ADR-037](../../decisions/ADR-037-manual-ground-display.md) |
| 부품·편집 | 전지·직류 전원·저항·가변저항·다이오드·일반/전환 스위치·전류계·전압계. 공통 기호·이름 생성, 배선·직렬 삽입·교차 편집·국소 경로 보존·삭제·Undo/Redo. 빈 공간 배선과 열린 끝 확정 포함. [상호작용](../ux/interactions.md) |
| 선택·복사 | 영역 선택·그룹 이동, 새 ID/이름으로 복사, 마우스 미리보기·터치 확정, 단일 부품 삽입과 묶음 겹침 검사. [설계](../ux/selection-copy.md) |
| 전위·전류 | 2D 숫자·색·등전위, 3D 높이·전압 눈금·경로 그래프. 공통 전류 띠와 방향 무늬, 정확한 0 A와 미정 값 구분. [전위](../physics/potential-visualization.md), [전류](../physics/current-visualization.md) |
| 분석·측정 | 전압 탐침·비접촉 전류 센서·전원 분리 후 등가저항, 가변저항/직류 전원/스위치 조작, 계기별 표시창, 조건·출처를 보존한 측정표·CSV. 탐침 배치는 2D, 전압 관찰은 3D에서도 유지. [측정 규약](../physics/measurement-and-display.md) |
| 작동 경계 | 만들기의 사전 경고, 분석의 과부하·파손 사건과 관찰 잠금, H01~H07 도움말. 실물 정격·열 축적·파손 후 연쇄 고장은 범위 밖. [분석 UX](../ux/diode-analysis.md) |
| 출력·저장 | 문서·공통 기호에서 SVG/PNG 재생성, 표기·빈칸·주석·배율·그림 복사. 자동 저장·보관·JSON과 측정 기록 별도 저장. [저장 설계](../architecture/persistence-and-sharing.md) |
| 터치·후기 | 탭/길게 누르기·다중 터치 취소·모바일 패널, 첫 안내. Firebase 후기와 관리자 보관함. [운영 설정](firebase-setup.md) |

## 검증과 배포

- 검증을 찾는 출발점은 [검증 범위](../testing/mvp-coverage.md), 계산 비용 근거는 [성능 보고서](../testing/exact-dc-performance.md)다. 실기기·사용자 검증은 [남은 작업](follow-up.md)과 구분한다.
- 안정판은 [main](https://cho-wh.github.io/circuit/), 개발판은 [dev](https://cho-wh.github.io/circuit/dev/)다. 브라우저 저장 공간을 분리한다. 로컬 구현 완료와 공개 배포 완료는 다르며 게시 상태는 [Pages 실행 기록](https://github.com/Cho-WH/circuit/actions/workflows/deploy-pages.yml)으로 확인한다.
- 개발·배포 절차는 [운영 문서](../operations/development-workflow.md), 결정 근거는 [ADR 색인](../../decisions/README.md)을 따른다.
