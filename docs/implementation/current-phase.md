# 현재 작업 현황

기준일: 2026-10-22. 앱 0.1.0, 작업 브랜치 dev. 저장은 회로 v7·측정 기록 v6다. 명시적 회로 v5/v6→v7 복원과 기록 v5→v6의 원본 보존 복사를 지원한다([ADR-042](../../decisions/ADR-042-rc-contracts-storage.md)). 읽지 못한 원본은 별도 보관한다([ADR-039](../../decisions/ADR-039-circuit-recovery.md)).

단계 0~5 MVP와 다이오드 확장 D0~D4는 구현했다. 단계 6 활동·공유와 단계 7 교실 알파는 미완료다. 후속 후보는 착수 승인이 아니다. [단계 계획](phases.md), [남은 작업](follow-up.md).

## 현재 지원 범위

| 영역 | 현재 동작과 설계 기준 |
|---|---|
| 계산 | 이상적 선형 직류·정확 유리수, 예산 초과 시 검증된 명시적 근사. 다이오드 0.7 V·구간선형 부품 모델, 고정 교육용 작동 경계. [ADR-024~026](../../decisions/README.md) |
| 축전기 관찰 | 여러 축전기의 선형 RC, C·초기 전압 지정, 재생·일시정지·배속·최종 평형 넘기기, 평형에서 단발 조절·다시 시작. 같은 프레임의 전위·전류·전하·계기·기록, 2D/3D 판별 전위 색. RC+다이오드·충격 재분배·과부하/파손은 제외. [UX](../ux/rc-transient.md), [지원 한계](../testing/rc-c5-results.md) |
| 다이오드 평형 | 차단 전류는 정확히 0 A. 스위치 개방으로 생기는 전압 자유도는 평형 선택으로 처리하며 누설전류를 추가하지 않는다. [ADR-030](../../decisions/ADR-030-diode-equilibrium.md) |
| 독립 회로·접지 | 독립 영역별 계산과 영역 간 전압 비교 차단. 자동 기준은 계산에만 사용하고 수동 접지만 표시·이동·삭제한다. [ADR-033](../../decisions/ADR-033-independent-references.md), [ADR-037](../../decisions/ADR-037-manual-ground-display.md) |
| 부품·편집 | 전지·직류 전원·저항·가변저항·축전기·다이오드·일반/전환 스위치·전류계·전압계. 공통 기호·이름 생성, 배선·직렬 삽입·교차 편집·국소 경로 보존·삭제·Undo/Redo. 빈 공간 배선과 열린 끝 확정 포함. [상호작용](../ux/interactions.md) |
| 선택·복사 | 영역 선택·그룹 이동, 새 ID/이름으로 복사, 마우스 미리보기·터치 확정, 단일 부품 삽입과 묶음 겹침 검사. [설계](../ux/selection-copy.md) |
| 전위·전류 | 2D 숫자·색·등전위, 3D 높이·전압 눈금·경로 그래프. 공통 전류 띠와 방향 무늬, 정확한 0 A와 미정 값 구분. [전위](../physics/potential-visualization.md), [전류](../physics/current-visualization.md) |
| 분석·측정 | 전압 탐침·비접촉 전류 센서·전원 분리 후 등가저항, 가변저항/직류 전원/스위치 조작, 계기별 표시창, 조건·출처를 보존한 측정표·CSV. 탐침 배치는 2D, 전압 관찰은 3D에서도 유지. [측정 규약](../physics/measurement-and-display.md) |
| 작동 경계 | 만들기의 사전 경고, 분석의 과부하·파손 사건과 관찰 잠금, H01~H07 도움말. 실물 정격·열 축적·파손 후 연쇄 고장은 범위 밖. [분석 UX](../ux/diode-analysis.md) |
| 출력·저장 | 문서·공통 기호에서 SVG/PNG 재생성, 표기·빈칸·주석·배율·그림 복사. 출력 부분 복수 선택·영역 선택·자동 맞춤·선택 정렬/같은 간격([ADR-040](../../decisions/ADR-040-output-alignment.md)). 자동 저장·보관·JSON과 측정 기록 별도 저장. [저장 설계](../architecture/persistence-and-sharing.md) |
| 터치·후기 | 탭/길게 누르기·다중 터치 취소·모바일 패널, 첫 안내. Firebase 후기와 관리자 보관함. [운영 설정](firebase-setup.md) |

## 검증과 배포

- 2026-10-22 사용자 승인으로 dev의 선형 RC C0~C4를 구현하고 검토했다. [C0 수치 시제품](../testing/rc-c0-results.md)·[C1 공개 계약과 저장](../testing/rc-c1-results.md)·[C2 제품 엔진](../testing/rc-c2-results.md)·[C3 재생 세션](../testing/rc-c3-results.md)에 이어 [C4 관찰·기호·기록·출력](../testing/rc-c4-results.md)을 연결했다. 축전기 충전·방전 예제로 실제 조작할 수 있다. [C5](../testing/rc-c5-results.md)에서 데스크톱 브라우저·키보드·390px 화면·자동 터치 및 계산 비용을 확인했다. 실제 터치 기기·스크린리더·수업 사용자 수용은 남아 있다. 2D 판 색상 개선을 포함해 2026-10-22 사용자가 dev 커밋·배포를 승인했다. 게시 커밋은 [개발판 release.json](https://cho-wh.github.io/circuit/dev/release.json), CI 검증·게시 결과는 아래 Pages 실행 기록으로 확인한다. 16단 준비 비용 약 0.4초, 32단 예산 초과를 지원 한계로 유지한다.

- 출력 정렬은 로컬 구현 상태이며 자동 맞춤·Alt 일시 해제·Shift 직선 이동·복수 선택 정렬을 제공한다. 2026-10-22 사용자 확인으로 Alt 해제 후 출발점으로 돌아가던 문제의 수정 동작을 확인했다. 이는 해당 조작의 확인이며 전체 브라우저·실기기 검증 완료를 뜻하지 않는다. 조작법은 [사용 설명서](../ux/quick-start.md#worksheet), 검증 근거는 [변경 기록](mvp-tracker.md)을 따른다.
- 2026-10-22 본체와 이름·값 사이의 같은 간격 스냅을 추가했다. 단일 표기·같은 종류/배치 방향/역할·화면상 같은 쪽에 한정하며 연결선을 제외한 기호 본체 외곽을 사용한다. 180° 반대 방향도 같은 배치 방향으로 취급한다. 두 쌍 간격 안내·Alt/Shift·저장/Undo를 기존 경로에 연결했고, 가까운 간격 후보 간 전환을 보완했다. 사용자에게서 수정 후 정상 동작을 확인했다. 개발판 게시 결과는 아래 Pages 실행 기록과 release.json을 따른다.

- 검증을 찾는 출발점은 [검증 범위](../testing/mvp-coverage.md), 계산 비용 근거는 [성능 보고서](../testing/exact-dc-performance.md)다. 실기기·사용자 검증은 [남은 작업](follow-up.md)과 구분한다.
- 안정판은 [main](https://cho-wh.github.io/circuit/), 개발판은 [dev](https://cho-wh.github.io/circuit/dev/)다. 브라우저 저장 공간을 분리한다. 로컬 구현 완료와 공개 배포 완료는 다르며 게시 상태는 [Pages 실행 기록](https://github.com/Cho-WH/circuit/actions/workflows/deploy-pages.yml)으로 확인한다.
- 개발·배포 절차는 [운영 문서](../operations/development-workflow.md), 결정 근거는 [ADR 색인](../../decisions/README.md)을 따른다.
