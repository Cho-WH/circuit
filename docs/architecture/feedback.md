# 사용 후기와 피드백

요구사항 DAT-005, 결정 [ADR-014](../../decisions/ADR-014-feedback-board.md).

## 구성

`app/FeedbackBoard` → `feedback` 공개 계약 ← `feedback-firebase`.

게시판은 회로 문서·계산과 독립적이다. 일반 UI는 `FeedbackGateway`만 사용하며 어댑터가 Firebase SDK, 익명 인증, 조회, 원자적 쓰기와 오류 변환을 담당한다. 공개 계약에 Firebase 타입을 노출하지 않는다. 로컬·GitHub Pages는 `circuit-cho-wh` 프로젝트의 `circuit-web` 설정을 공유한다. 실제 서비스 준비 상태는 [Firebase 설정 기록](../implementation/firebase-setup.md)을 참조한다.

이름·이메일·학교·회로 문서를 자동 수집하지 않는다. 일반 방문자는 게시판을 열 때 익명 Auth를 시작한다. Analytics, 광고 식별, 측정 이벤트는 추가하지 않는다. Google 계정 정보는 관리자 로그인에만 사용하고 게시판 문서로 복사하지 않는다. Firebase 자체 인증·네트워크 운영 처리가 없다는 의미는 아니다.

## 사용자 흐름

한마디 모달에서 세 줄 본문 미리보기·더 읽기·종류·닉네임·작성일을 표시한다. 공개 목록과 본인 목록을 구분한다. 본인 글은 닉네임·내용·종류·공개 범위의 수정 및 삭제가 가능하다. 비공개 작성·수정은 본인 목록으로 이동한다.

한 줄 브라우저 안내 뒤 물음표 툴팁은 클릭·터치·초점·호버로 열린다. 같은 기기·브라우저·사이트 주소를 사용해야 하며 사이트 데이터 초기화·시크릿 모드 종료 시 인증 정보가 사라질 수 있음을 설명한다. 삭제가 어려우면 비공개 글 등 별도 방법으로 관리자에게 다시 요청하도록 안내한다. 로컬 주소와 배포 주소는 같은 DB를 쓰지만 브라우저 origin이 달라 익명 UID가 다르다.

## 데이터와 권한

| 경로 | 내용 | 권한 |
|---|---|---|
| `feedbackPosts/{id}` | 닉네임·본문·종류·공개 범위·작성/수정/삭제 시각·작성자 UID·할당 날짜/슬롯 | 활성 본인 글 또는 허용된 관리자만 읽기. 작성자만 제한된 변경 |
| `feedbackPublic/{id}` | 공개 글의 표시 필드 6개. UID와 삭제 시각 없음 | 인증된 방문자 읽기. 원문과 일치하는 원자적 쓰기만 허용 |
| `feedbackQuotas/{uid}/days/{day}/slots/{1|2|3}` | 생성 글 ID·서버 시각 | 해당 UID의 단건 조회 및 새로운 슬롯 생성. 변경/삭제 금지 |
| `feedbackAdmins/{uid}` | `enabled: true` | 본인 단건 조회만 허용. 클라이언트 쓰기 금지. 신뢰된 콘솔에서 등록 |

규칙은 허용 필드·타입·길이·enum·서버 시각을 검증하고 소유권·최초 작성 시각·할당 정보를 고정한다. 원문의 물리 삭제를 금지한다. 소프트 삭제는 `deletedAt`만 설정하고 마지막 내용을 유지한다. 삭제 이후 작성자의 읽기·수정·복구를 허용하지 않는다.

생성·수정·공개 전환·삭제는 원문과 공개 사본을 트랜잭션에서 처리한다. `getAfter()`/`existsAfter()` 검증으로 비공개·삭제된 글의 공개 사본 잔존, 공개 내용 위조, 원문 없는 사본을 거부한다.

하루는 KST 00:00이다. `floor((epochMilliseconds + 9h) / 24h)`를 날짜 정수로 사용하며 서버 `request.time`으로 재검증한다. 각 UID·날짜에 슬롯은 3개다. 새 슬롯과 새 원문이 서로를 가리키고 동일 쓰기에서 생성되어야 하므로 한 슬롯에 여러 글을 끼워 넣거나 재사용할 수 없다. 삭제·수정은 슬롯을 환급하지 않는다. 충돌 시 immutable 슬롯이 먼저 거부되는 Firestore 동작을 고려하여 실제 다른 글의 선점이 확인된 경우에만 다시 시도한다. 인증을 초기화하면 새 UID를 만들 수 있어 사람당 제한은 아니다.

공개·본인 목록은 작성 시각과 문서 ID 내림차순 커서로 20개씩 읽는다. 공개 목록의 `canManage`는 같은 시간 구간의 본인 활성 공개 글 조회 결과와 대조한다. 다른 사람 원문을 ID로 직접 조회하지 않는다. 이 값은 UI 표시용이며 변경 권한은 규칙이 다시 검사한다. 복합 인덱스는 `firestore.indexes.json`으로 관리한다.

## 관리자

로컬 `/admin/feedback/`, GitHub Pages `/circuit/admin/feedback/`에서 Google 로그인을 제공한다. `feedback-admin`과 `feedback-browser`는 별도 Firebase App/Auth 인스턴스다. 관리자 UID 허용 목록과 Google 로그인 제공자 확인을 서버 규칙에서 함께 요구한다. 최초 허용 목록 등록 전에는 원문을 읽지 않는다. 계정 변경·로그아웃 시 보관함 UI를 제거한다. 전체·비공개·삭제 필터, 작성/삭제 시각을 제공한다. 운영 관리자 화면은 현재 조회 전용이다.

## 기존 로컬 자료

`feedback-local`은 v2 저장소·자동 로컬 ID와 v1→v2 이전을 유지한다. 새 v2 자료에서는 비밀번호 salt·해시를 제거하며 v1 키는 복구용으로만 보존한다. 손상·미지원 자료를 덮어쓰지 않는다. 기존 로컬 글·작성자 ID는 운영 Firebase로 자동 업로드하거나 소유권을 이전하지 않는다.

## 검증

- `feedback.test.ts`, `feedback-ui.test.ts`: 기존 계약·이전·페이지네이션·작성/수정/삭제·툴팁·보관함 흐름.
- `feedback-firestore.test.ts`: 실제 SDK와 Standard 에뮬레이터에서 원문/공개 동기화, 소유권·가짜 관리자·잘못된 필드·날짜 위조·슬롯 재사용·동시 작성·커서 검증.
- `npm run test:firestore`: Java 21이 필요하다. `demo-circuit-feedback` 에뮬레이터에만 연결하며 설정이 없으면 실패한다. 일반 `npm test`에서는 에뮬레이터가 없을 때 이 테스트만 건너뛴다. GitHub Pages CI는 별도로 에뮬레이터 검증을 실행한다.
- 에뮬레이터는 운영 인덱스 생성과 실제 Google 로그인을 검증하지 않으므로 운영 배포 후 확인이 필요하다.

참고: [익명 인증](https://firebase.google.com/docs/auth/web/anonymous-auth), [인증 상태 보존](https://firebase.google.com/docs/auth/web/auth-state-persistence), [보안 규칙 조건](https://firebase.google.com/docs/firestore/security/rules-conditions), [원자적 쓰기](https://firebase.google.com/docs/firestore/manage-data/transactions).
