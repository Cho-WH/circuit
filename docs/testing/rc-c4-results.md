# C4 RC 관찰·기호·기록·출력 검증

2026-10-22, dev. 사용자 승인에 따라 C4를 구현하고 검토한 뒤 C5로 넘어갔다. [설계](../architecture/rc-transient.md), [UX](../ux/rc-transient.md), accepted [ADR-045](../../decisions/ADR-045-rc-observation-output.md)를 따른다. 관련 요구사항은 SIM-009·VIS-008·MEA-006·DAT-006·TCH-001~003이다.

## 연결한 사용자 흐름

축전기 팔레트·공통 평행판 기호·C/초기 전압 편집과 **축전기 충전·방전** 예제를 제공한다. 분석에서는 C3 세션의 단일 프레임으로 전위 숫자·색·3D 높이·전류·계기·탐침·선택 판별 전하를 표시한다. 일시정지/평형 기록을 표·CSV·기록 저장에 연결했다. 출력은 현재 전하가 아니라 문서의 C와 선택적으로 켠 초기 전압을 그린다.

| 수용 사례 | 확인한 결과 |
|---|---|
| RC-01·08 | 실제 예제의 10 V·10 kΩ·100 µF 충전과 SPDT B 연결 방전. 해석식·최종 전압 일치, 충격 없는 연결 |
| RC-12·16 | 인증된 전압차·도선 전류 질의를 공유. 탐침·계기·2D/3D의 frame ID 일치, 정지 중 기록·재생 중 기록 금지 |
| RC-17 | 네 방향·뒤집힌 단자 배열에서 판별 전위·부호 유지. 판/리드별 독립 높이, 유전체를 통과하는 전류 무늬 없음. 본체 간격은 리드 제외 |
| RC-18 | finite/equilibrium 기록의 조건 분리, 시간·원본 수치·오차·문서 JSON 보존. 유한 시각은 근사, 평형은 정확 |
| RC-19 | C/부호 있는 초기 전압 입력, 비양수 C 거부. 출력 초기 조건 표시/이동·저장 왕복·Undo |
| RC-21 | 기존 측정·전위·전류·출력·저장 회귀. RC에 DC provenance·전력·작동 경계를 잘못 표시하지 않음 |

## 검토 후 수정

- 소유하지 않은 RC 프레임은 표시 맵도 비워 실패 처리한다.
- CSV의 원본 JSON·수치 열에 표시용 첨자 변환을 적용하지 않는다.
- RC 재생과 별도의 전류 무늬 정지 버튼을 하나의 제어로 맞춘다. 연속 프레임은 DC 조절용 전체 무늬 숨김을 사용하지 않는다.
- 초기/평형 축척을 기준으로 중간 최대값까지 확장하고 관찰 도중 축척을 줄이지 않는다.
- 초기 전압 출력은 명시적 이름과 분수를 유지하며 일반 `U =`를 중복하지 않는다. 후속 브라우저 검토에서 값 편집의 명시적 적용 경로와 모바일 배속 메뉴를 보완했다([C5](rc-c5-results.md)).

## 실행 근거

C4 검토 시 아래 13개 파일 **217개 검사**, 타입을 포함한 프로덕션 빌드, **173개 소스 파일 모듈 경계 검사**를 통과했다. 새 동작은 `rc-observation`과 `rc-session-ui`, 전류 무늬 회귀는 `current-overlay`에 둔다.

```powershell
$env:TEMP = Join-Path (Get-Location) '.tools/rc-c0-tmp'
$env:TMP = $env:TEMP
npx vitest run tests/rc-observation.test.ts tests/rc-session-ui.test.ts tests/rc-session.test.ts tests/rc-engine.test.ts tests/rc-contracts-storage.test.ts tests/measurement-workspace.test.ts tests/current-overlay.test.ts tests/example-layout.test.ts tests/worksheet-export.test.ts tests/potential-3d.test.ts tests/measurement-notebook.test.ts tests/current-visualization.test.ts tests/output-body-gap.test.ts
npm run build
npm run check:boundaries
```

C5에서 실제 조작으로 찾은 수정과 최종 재검사는 별도 보고서에 기록한다. 수치 엔진의 검증 한계는 C0/C2 그대로이며, C4 통과는 실제 기기·사용자 수용·배포 완료를 뜻하지 않는다. 회로 v7·기록 v6 형식은 변경하지 않았다.
