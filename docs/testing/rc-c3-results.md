# C3 RC 재생·조작·초기화 검증

2026-10-22, dev. 사용자 승인 범위는 C3이며 [ADR-044](../../decisions/ADR-044-rc-playback-session.md), [설계](../architecture/rc-transient.md), [UX](../ux/rc-transient.md)를 구현했다. C2 계산 엔진과 회로 v7·기록 v6를 유지한다.

## 구현과 확인 범위

| 수용 사례 | 실행 경로와 확인한 동작 |
|---|---|
| RC-07·08 | 실제 prepare/sample에 연결. 평형에서 저항만 변경하면 불필요한 충전 연출 없음. 전원 변경은 이전 정확 평형 전압에서 시작 |
| RC-12·13 | 30/60fps, 일시정지·재개·배속, T=0/0.499/0.5/4.999/5/매우 긴 시간의 정책. 숨긴 탭과 숨긴 동안 준비 완료 모두 명시적 재개까지 정지 |
| RC-14 | 정상 종료와 정지 중 넘기기의 정확 평형 및 다음 조작 프레임 일치. 실제 응답의 tail 전환, equilibrium 시간 종류, 모션 감소 확인 |
| RC-15 | 요청 지연·중복 클릭·나가기·파일 교체·다시 시작·문서 변경의 오래된 결과 거부. 실패 후보/첫 프레임 검증 실패 시 원래 평형·문서·Undo 보존 |
| RC-15·20 | 명령 경로의 C/초기 전압/구조/기준점/고정 전원 변경 및 Undo/Redo 차단. 진입 스냅샷의 정확 복원, 한 번의 Undo, 반복 초기화 무이력 |
| RC-16·18의 C3 부분 | 세션 기록 권한은 일시정지/평형에서만 허용. 등가저항·자동 값 왕복 차단. RC 기록 UI는 C4 연결 전 계속 차단 |
| RC-19·20 | 자동 저장은 확정 문서만 보존. 나간 뒤 문서 Undo/Redo 가능. 재진입은 최근 확정 설정의 초기 전압에서 다시 시작 |
| RC-21 | 기존 DC 분석 화면·가변저항/전원 연속 조절·세션·저장 회귀 검사 |

`tests/rc-session.test.ts`는 실제 엔진의 해와 지연된 prepare 어댑터를 사용한다. 분석식 단일 RC 전압, 같은 평형/다음 프레임, 문서·History 동일성으로 검증하며 내부 상태 전이 코드를 기대값으로 복제하지 않는다. `tests/rc-session-ui.test.ts`는 hook과 실제 App을 happy-dom에서 실행해 입력 초안·적용·아이콘·잠금·초기화를 확인한다. `tests/rc-session-fixture.ts`는 시험용 v7 회로 구성 도우미다.

## 실행 명령

Windows의 Vitest 임시 파일은 저장소 내부 `.tools/rc-c0-tmp`를 TEMP/TMP로 지정했다.

```text
npx vitest run tests/rc-session.test.ts tests/rc-session-ui.test.ts tests/rc-engine.test.ts tests/circuit-session.test.ts tests/live-value.test.ts tests/analysis-workspace.test.ts tests/adjustable-parameter.test.ts tests/workspace-ui.test.ts tests/editor-persistence.test.ts tests/specifications.test.ts tests/document-links.test.ts
npm run build
npm run check:boundaries
git diff --check
```

관련 11개 파일 **247개 검사 통과**. 마지막으로 초기화 초안 제거·Undo로 RC 문서 복원 시 세션 시작 순서를 보강한 뒤 세션/React/문서 관련 5개 파일 **103개 검사를 재확인**했다. 타입 검사를 포함한 프로덕션 빌드와 **170개 소스의 모듈 경계 검사**, diff 공백 검사를 통과했다. 빌드에는 기존과 같은 500kB 초과 청크 안내가 남는다. 전체 테스트/전체 verify는 실행하지 않았다.

## 남은 경계

- C4: 동일 프레임의 전위·전류·2D/3D·계기·측정 기록 연결, 축전기 공통 기호·팔레트·C/초기 전압 편집·출력. 세션 검사 통과를 이 관찰 흐름 전체의 완료로 보지 않는다.
- C5: 실제 브라우저의 시각 배치·터치·키보드 수용, 큰 회로의 계산 지연/프레임 비용과 실기기 검증. 이번 UI 검사는 happy-dom 자동 검사이며 실제 브라우저 시각 검수가 아니다.
- 같은 스레드의 prepare는 계산 도중 중단하지 않는다. 취소는 결과 수용을 막으며 Worker 이관·전달 형식은 구현하지 않았다.
- 커밋·푸시·공개 배포는 수행하지 않았다.
