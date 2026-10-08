# 개발 운영

처음 실행하는 방법과 코드 구조는 [개발자 안내](../development/README.md)에서 시작한다. 이 문서는 변경·검증·배포의 운영 기준을 다룬다.

## 이슈

이슈 제목에는 관련 요구사항 ID를 포함한다.

```text
[VIS-004] 2D 회로를 전위 높이 지도로 전환
```

이슈 본문에는 다음을 적는다.

- 수용 기준
- 관련 물리 규칙
- 관련 모듈
- 관련 fixture
- 필요한 ADR
- 데이터·마이그레이션 영향

## 브랜치와 PR

- `main`은 수업용 안정판, `dev`는 다음 변경을 확인하는 개발판이다. 두 브랜치를 상시 유지한다.
- 개발은 `dev`에서 하거나 `dev`에서 나눈 짧은 기능 브랜치를 사용한다. 안정판 반영은 검증된 변경을 `dev`에서 `main`으로 병합할 때만 한다.
- 큰 기능은 데이터→계산→표현→테스트의 작은 PR로 나눈다.
- PR 설명에 요구사항 ID, 화면 변화, 데이터 변화, 테스트, 마이그레이션 여부를 기록한다.
- 문서 스키마나 공개 인터페이스가 바뀌면 코드와 같은 PR에서 문서와 ADR을 갱신한다.

## ADR

다음 변경은 ADR이 필요하다.

- 모듈 의존 방향 변경
- 공개 인터페이스 변경
- 저장 스키마의 호환성 정책 변경
- 수치 해석 정책 변경
- 핵심 렌더링·상태 관리 기술 선택
- 공유와 권한 방식 변경

ADR 상태는 `proposed`, `accepted`, `superseded`, `rejected` 중 하나다.

## 로컬 검증

코드 형식은 저장소의 Prettier 설정을 사용한다. `npm run format -- <변경한 파일>`로 적용하고 `npm run format:check -- <변경한 파일>`로 확인한다. 기존 전체 파일을 일괄 재작성하지 않고 수정 범위에 적용한다. 형식 정리와 동작 변경은 가능한 한 별도 변경 단위로 검토한다.

변경 영향에 맞는 검사만 실행하고 결과를 [작업 추적](../implementation/mvp-tracker.md)에 기록한다. 동일한 코드 상태의 전체 테스트·빌드를 반복하지 않는다. 실패 수정이나 새 변경이 있으면 해당 범위를 다시 확인한다.

현재 동작은 해당 규약 문서에, 검증 대응표는 검증 문서에 한 번만 정리한다. 작업 추적에는 최종 결과·중요한 실패 원인·검증 범위만 남기고 중간 대화·역할 분담·반복 실행 로그를 쌓지 않는다. 완료된 검토 원문은 Git 이력으로 대체할 수 있지만 미완료 구현 후보와 수용 검사는 [남은 작업](../implementation/follow-up.md)과 [사용성 검증](../testing/usability.md)에 먼저 보존한다.

로컬과 GitHub Actions의 공통 검증 진입점은 `npm run verify`다. 모듈 경계 검사 → TypeScript 테스트(명세·문서 링크 포함) → 타입 검사와 빌드를 한 번씩 실행한다. 변경 범위를 확인할 때는 아래 개별 명령을 사용할 수 있다.

| 대상 | 명령·확인 |
|---|---|
| 기능 변경 | `npm test -- tests/<관련 파일>.test.ts`, 변경에 맞는 실제 조작 확인 |
| 타입 | `npm run typecheck`. 같은 상태에서 `npm run build`를 실행하면 타입 검사가 포함됨 |
| 모듈 의존 | `npm run check:boundaries` |
| 요구사항·스키마·fixture | `npm test -- tests/specifications.test.ts` |
| 문서 정리만 변경 | `npm test -- tests/document-links.test.ts`; 변경한 앵커는 별도 확인 |
| 배포 산출물 | `npm run build`; Pages 빌드는 `GITHUB_PAGES=true`, `VITE_RELEASE_CHANNEL=main` 또는 `dev` 지정 |

계산 변경은 관련 fixture·물리 불변식, 편집 변경은 실행 취소·다시 실행, 출력 변경은 실제 SVG·PNG를 확인한다. 실제 사용자·기기 검증과 자동화·브라우저 크기 검증을 구분해 기록한다. 새 요청 전까지 메인이 직접 구현·검증하며 예전 에이전트 분담은 이력에만 남긴다.

## 릴리스

| 릴리스 | 포함 단계 | 공개 기준 |
|---|---|---|
| 기술 시제품 | 0~1 | 계산 정확성과 전위 표현 가능성 |
| 인터랙션 시제품 | 2~3 | 편집과 핵심 시각화 사용성 |
| 1차 MVP | 0~5 | 회로 제작·탐구·문제 출력 완결 |
| 교실 알파 | 0~7 | 저장 안정성과 반복 수업 사용 |
| 공개 베타 | 알파 보완 후 | 호환성, 도움말, 오류 보고 체계 |
| 1.0 | 핵심 요구 안정 | MVP 범위의 공개 API·파일 형식 안정 |

## 배포와 장애 대응

- 정적 호스팅과 자동 빌드를 우선한다.
- 배포 CI는 아래 명세·경계·테스트·타입·빌드 게이트를 실행한다. 로컬에서는 변경에 필요한 사용자 흐름과 출력만 추가 확인한다.
- 앱 정보에 빌드 버전과 문서 스키마 버전을 함께 표시한다.
- 이전 안정 배포를 유지한다.
- 핵심 자산과 파일 입출력은 서버 API에 의존하지 않는다.


### 안정판과 개발판 게시

| 브랜치 | 주소 | 빌드 채널 |
|---|---|---|
| `main` | https://cho-wh.github.io/circuit/ | `VITE_RELEASE_CHANNEL=main` |
| `dev` | https://cho-wh.github.io/circuit/dev/ | `VITE_RELEASE_CHANNEL=dev` |

같은 소스를 main으로 승격하면 빌드 채널만 바뀌어 안정판 주소와 저장 공간을 사용한다. 현재 기능 범위는 [현재 현황](../implementation/current-phase.md), 실제 게시 커밋은 각 주소의 release.json으로 확인한다. 기능별 브랜치 이름이나 URL 탐색 결과로 채널을 추측하지 않는다.

어느 브랜치든 push하면 [배포 워크플로](../../.github/workflows/deploy-pages.yml)가 **main과 dev 양쪽 최신 커밋**을 각각 checkout한다. 각 빌드는 `npm run verify` → Java 21 준비 → `npm run test:firestore`를 실행한다. 검증된 main의 dist를 사이트 루트에, dev의 dist를 그 안의 dev/에 합쳐 **하나의 Pages 산출물**로 게시한다. Pages는 사이트 전체를 교체하므로 한쪽만 게시하지 않는다. 한쪽 검사라도 실패하면 기존 사이트 전체를 유지한다. 실행은 github-pages 동시성 그룹에서 직렬 처리한다.

Verify 워크플로는 다른 브랜치 push와 모든 PR에서 동작한다. main/dev push는 Pages 워크플로에서 검증한다. 저장소 Settings → Pages의 Source는 **GitHub Actions**, github-pages 환경의 허용 브랜치는 **main과 dev만**으로 설정한다. deploy job에만 pages: write와 id-token: write를 부여한다. 이전 codex/mvp 브랜치는 배포 대상으로 쓰지 않는다.

평소 개발·검증 후 `git push origin dev`로 개발판을 갱신한다. 안정판 승격은 dev→main PR로 변경 범위와 지원 파일 형식을 확인한 뒤 병합한다. 급한 안정판 수정은 main에서 먼저 반영하고 dev에도 병합해 양쪽 운영 설정을 유지한다. 브랜치를 강제 초기화하거나 과거 커밋으로 force push하지 않는다. 회귀 복구는 해당 브랜치에 revert 커밋을 추가한다.

로컬 `npm run dev`와 일반 build의 기본 채널은 dev이고 기본 경로는 /다. 안정판을 로컬에서 확인할 때만 환경 변수 VITE_RELEASE_CHANNEL=main을 지정한다. Pages 경로는 GITHUB_PAGES=true일 때 main=/circuit/, dev=/circuit/dev/다. 예를 들어 PowerShell에서:

```powershell
$env:GITHUB_PAGES = 'true'
$env:VITE_RELEASE_CHANNEL = 'dev' # 안정판 빌드는 main
npm run build
Remove-Item Env:GITHUB_PAGES, Env:VITE_RELEASE_CHANNEL
```

자동 저장·보관·측정 기록·백업·첫 안내와 로컬 후기 미리보기는 main:/dev: 키로 분리한다. 브라우저는 경로가 달라도 같은 저장소를 공유하므로 이 접두사가 필수다. 기존 접두사 없는 데이터는 해당 버전의 검증을 통과할 때만 비어 있는 채널 키에 복사하며 원본은 보존한다. 지원하지 않는 형식은 옮기거나 변환하지 않는다. JSON 내보내기는 기존 형식 그대로다. Firebase 운영 후기·인증은 같은 프로젝트를 계속 사용한다. [저장 계약](../architecture/persistence-and-sharing.md), [ADR-027](../../decisions/ADR-027-release-channels.md).

빌드 결과만 게시한다. 각 주소의 release.json은 channel과 실제 빌드 commit을 담으므로 Actions 성공 뒤 양쪽 게시 커밋과 자산 경로를 확인한다. 소스·테스트·브라우저 저장 데이터는 배포하지 않는다. 장애는 **Deploy GitHub Pages** 로그에서 확인하고 수동 실행 또는 Re-run jobs로 재검증·배포한다. 로컬 구현·푸시·Actions 성공·공개 사이트 확인을 구분해 기록한다.
