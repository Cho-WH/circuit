# Firebase 연결 상태

기준: 2026-09-23. Spark 운영 프로젝트 한 개를 로컬과 GitHub Pages가 공유한다. Analytics는 사용하지 않는다.

## 확인된 원격 설정

- 프로젝트: `circuit-cho-wh`, 표시 이름 `circuit`. 사용자가 Firebase 콘솔에서 Analytics 없이 생성 완료.
- 웹 앱: `circuit-web`, 앱 ID `1:831786913737:web:f104cb36e0076c55fc2218`.
- 익명 Auth와 Google 로그인 활성화 완료.
- `(default)` Firestore 생성 완료: 서울 `asia-northeast3`, `STANDARD`, `freeTier: true`. 서버 조회로 확인했다.
- 보안 규칙 dry-run 컴파일 및 실제 규칙·인덱스 배포 완료. 복합 인덱스 두 개 모두 `READY` 상태를 확인했다.
- 허용 도메인: `localhost`, `127.0.0.1`, `cho-wh.github.io`, 기본 Firebase 도메인 두 개.
- 공개 SDK 설정은 `src/feedback-firebase/config.ts`. 서비스 계정 비밀키나 사용자 로그인 토큰이 아니다. Analytics 측정 ID 없음.
- 관리자 지원 이메일이 포함된 Auth 배포 설정은 `.firebase-local/auth.json`에만 두며 Git에서 제외.
- Firebase CLI 15.30.2의 `deploy --only auth`는 공급자는 설정하지만 `authorizedDomains`를 반영하지 않았다. 실제 로그인에서 이를 발견해 공식 CLI의 `getAuthDomains`/`updateAuthDomains`로 기존 도메인을 보존하며 세 주소를 추가했고 원격 목록을 재확인했다. 해당 보완 도구도 Git 제외 경로에 있다.

## GitHub Pages 배포

- 사용자 승인에 따라 기존 회로 개선 두 커밋과 Firebase 연결 `b77c0a5`를 함께 배포했다. [GitHub Actions 실행](https://github.com/Cho-WH/circuit/actions/runs/35870762335)의 검사·빌드·배포가 모두 성공했다.
- 실제 브라우저에서 [공개 앱](https://cho-wh.github.io/circuit/)의 Firebase 게시판 로딩과 [관리자 경로](https://cho-wh.github.io/circuit/admin/feedback/)의 로그인 화면을 확인했다. 관리자 계정은 로컬에서 등록·인증했으며 배포 주소에서는 같은 계정으로 로그인하면 된다.

## 관리자 등록

- 사용자가 선택해 로그인한 Google 계정을 Firebase Auth에서 확인하고, 신뢰된 관리 도구로 해당 `feedbackAdmins/{UID}`의 `enabled: true`를 등록했다. UID와 프로필은 공개 저장소에 기록하지 않는다.
- 실제 브라우저에서 관리자 보관함 접근과 운영 점검 글의 `비공개`·`삭제된 글` 표시 및 마지막 본문 보존을 확인했다.
- 관리자 주소: 로컬 `/admin/feedback/`, GitHub Pages `/circuit/admin/feedback/`. GitHub Pages에서는 같은 Google 계정으로 별도로 로그인한다.

## 로컬 검증

- Standard Firestore 에뮬레이터에서 실제 SDK·규칙 24개 테스트 통과.
- 전체 테스트 실행에서 408/409 통과. 기존 회로 v1 fixture와 마이그레이션 v2 결과를 잘못 비교하던 불변성 테스트 한 곳을 작업 전 문서의 복제본과 비교하도록 수정했고 해당 파일 12개가 재검사에서 모두 통과.
- 타입·모듈 경계·Vite 운영 빌드 통과. 기존 큰 청크 경고 존재.
- GitHub Pages 하위 경로 빌드 통과. 명세 검증 도구가 기존 v1 물리 fixture를 v2 전용 스키마로 검사하던 문제를 보존된 v1·v2 스키마 선택으로 수정했고 명세·링크 검증 통과. 물리 fixture·계산 코드는 변경하지 않았다.
- 실제 브라우저에서 Google 로그인·관리자 권한 등록·보관함 조회 확인 완료.
- 운영 DB에서도 실제 어댑터로 비공개 점검 글 한 개를 작성·수정·본인 조회·공개 제외·소프트 삭제하는 검증이 통과했다. 점검 글을 공개하지 않았으며 마지막 내용은 관리자용 삭제 기록으로 보존했다. 상세 결과는 Git 제외 `.firebase-local/production-smoke-result.json`에 있다.
- 허용 도메인 미설정·팝업 차단·사용자 창 닫기·네트워크 오류의 관리자 로그인 안내를 구분했다. 변경 후 타입 검사와 게시판 UI 12개 검증 통과.
- 인증 성공 뒤 이전 팝업 오류가 남는 경우와 성공 후 늦게 도착한 팝업 닫힘 오류를 수정했다. 회귀 검사 포함 UI 14개 및 타입 검사 통과.
- 브라우저에서 비공개 작성·수정, 페이지 새로고침 후 소유권 유지, 삭제 후 본인 목록 제외, 관리자 보관함의 수정 본문·삭제 표시를 확인했다. 일반 익명 세션과 관리자 세션이 같은 브라우저에서 동시에 유지된다. 점검 글 두 개는 모두 비공개 삭제 기록으로만 남겼다.

재실행: Java 21과 Node 환경에서 `npm run test:firestore`. 에뮬레이터 전용 demo 프로젝트를 사용하므로 운영 게시판에 테스트 자료를 쓰지 않는다.
