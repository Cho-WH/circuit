# 개발자 안내

회로 실험실의 코드를 실행하고 수정하려는 분을 위한 안내입니다. 앱 사용법은 [사용 설명서](../ux/quick-start.md), 기능 소개는 [최상단 README](../../README.md)에서 볼 수 있습니다.

## 로컬에서 시작하기

**Node.js 22와 npm, Git**을 준비하세요. 저장소의 최소 Node.js 버전은 20.19이며, CI는 22를 사용합니다.

```sh
git clone https://github.com/Cho-WH/circuit.git
cd circuit
git switch dev
npm ci
npm run dev
```

터미널에 표시된 주소를 엽니다. 기본 주소는 `http://localhost:5173/`이며, 포트가 사용 중이면 다른 번호가 표시될 수 있습니다. 소스를 수정하면 개발 화면에 반영됩니다.

회로 편집·계산·측정·그림 출력은 브라우저에서 실행됩니다. 이 기능들을 개발하는 데 별도의 서버나 Firebase 계정 설정은 필요하지 않습니다. 생성되는 `node_modules/`와 `dist/`는 커밋하지 않습니다.

## 코드를 읽는 순서

먼저 예제 회로로 [앱의 세 화면](../ux/quick-start.md#first-circuit)을 살펴본 뒤, 수정할 기능의 모듈부터 읽는 것을 권합니다. React와 Three.js를 다루지 않는 계산 계층과 화면 계층이 분리되어 있습니다.

| 위치                                                                                                                                            | 역할                                      |
| :---------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- |
| [`src/domain`](../../src/domain/)                                                                                                               | 저장되는 회로 문서와 공통 타입            |
| [`src/connectivity`](../../src/connectivity/) · [`src/simulation`](../../src/simulation/) · [`src/diagnostics`](../../src/diagnostics/)         | 전기적 연결, 직류 해석, 구조화된 진단     |
| [`src/editor`](../../src/editor/)                                                                                                               | 편집 명령, 실행 취소·다시 실행, 조작 제한 |
| [`src/measurement`](../../src/measurement/)                                                                                                     | 탐침·센서·계기와 측정 기록                |
| [`src/component-library`](../../src/component-library/)                                                                                         | 부품 정의와 화면·출력에서 공유하는 기호   |
| [`src/app`](../../src/app/)                                                                                                                     | React 화면, 도구와 입력 처리              |
| [`src/visualization`](../../src/visualization/) · [`src/potential-3d`](../../src/potential-3d/) · [`src/current-view`](../../src/current-view/) | 전위·전류의 2D/3D 표현                    |
| [`src/export`](../../src/export/) · [`src/persistence`](../../src/persistence/)                                                                 | SVG·PNG 출력, 회로·측정 기록 저장         |
| [`src/fixtures`](../../src/fixtures/) · [`tests`](../../tests/)                                                                                 | 예제 회로와 회귀 검증                     |

데이터가 화면까지 이어지는 흐름은 [데이터 흐름](../architecture/data-flow.md), 모듈 간 공개 계약은 [모듈 구조](../architecture/modules.md)에 정리되어 있습니다. 새 부품을 추가할 때는 [확장 지점](../architecture/extension-points.md)을 함께 읽어 주세요.

## 수정 전에 확인할 기준

- **회로 구조의 원본은 `CircuitDocument`입니다.** 계산 결과나 일시적인 화면 상태를 저장 문서에 넣지 않습니다. 연결은 좌표가 아닌 단자·도선·분기점 ID로 기록합니다.
- **물리 범위는 교육용 직류 모델입니다.** 정확한 유리수 계산을 사용하는 저항 회로와 0.7 V 다이오드·구간선형 모델을 지원합니다. 계산 규칙은 [직류 모델](../physics/ideal-dc-model.md), [정확값 계산](../physics/exact-dc-arithmetic.md), [다이오드 모델](../physics/diode-dc-model.md)을 따릅니다.
- **저장 형식은 회로 v6·측정 기록 v5만 지원합니다.** 이전 형식은 변환 없이 거부합니다. 스키마를 바꾸면 지원 버전과 저장 왕복·거부 동작도 함께 확인합니다. [저장 계약](../architecture/persistence-and-sharing.md)
- **현재 구현과 후속 계획을 구분합니다.** [현재 현황](../implementation/current-phase.md)에서 구현 범위를, [남은 작업](../implementation/follow-up.md)에서 미완료 검증과 후보를 확인하세요.

상세 작업 규칙과 문서 우선순위는 [AGENTS.md](../../AGENTS.md)에 있습니다. 요구사항·물리 규약·공개 계약이 바뀌는 경우 관련 문서와 테스트를 같은 변경에 포함합니다. 모든 설계 문서는 [문서 색인](../index.md)에서 찾을 수 있습니다.

## 변경에 맞춰 검증하기

관련 검사를 먼저 실행합니다. 문구만 고친 변경에 전체 계산 테스트를 반복하거나, 이미 통과한 같은 코드 상태를 다시 검사할 필요는 없습니다.

| 확인할 내용             | 명령                                       |
| :---------------------- | :----------------------------------------- |
| 수정한 기능의 테스트    | `npm test -- tests/<관련 파일>.test.ts`    |
| TypeScript 타입         | `npm run typecheck`                        |
| 모듈 의존 경계          | `npm run check:boundaries`                 |
| 문서의 로컬 링크        | `npm test -- tests/document-links.test.ts` |
| 수정한 파일의 코드 형식 | `npm run format:check -- <파일 경로>`      |
| 배포용 빌드와 타입      | `npm run build`                            |
| CI와 같은 전체 검사     | `npm run verify`                           |

화면 변경은 실제 조작과 표시를, 계산·연결 변경은 관련 회로와 물리 불변식을 확인합니다. 링크 검사는 문서 안의 제목 앵커나 외부 사이트까지 확인하지 않으므로, 바꾼 목차와 외부 링크는 별도로 살펴보세요. 전체 검사는 변경 범위가 넓거나 릴리스 검증이 필요할 때 실행합니다.

검증 항목을 찾을 때는 [검증 범위](../testing/mvp-coverage.md), 완료 판단에는 [완료 기준](../implementation/definition-of-done.md)을 참고하세요.

## 후기 게시판을 개발할 때

후기 게시판은 Firebase를 사용하며 회로 기능과 별도로 운영합니다. 현재 저장소의 [Firebase 설정](../../src/feedback-firebase/config.ts)은 운영 프로젝트를 가리킵니다. 로컬에서 앱을 실행했다고 후기까지 로컬에 저장되는 것은 아니므로 운영 게시판에 테스트 글을 쓰지 마세요.

보안 규칙 검증에는 **Java 21**을 추가로 준비하고 다음 명령을 사용합니다. 에뮬레이터 전용 프로젝트에서 실행하므로 운영 자료와 분리됩니다.

```sh
npm run test:firestore
```

일반 `npm test`는 에뮬레이터가 없으면 해당 보안 규칙 검사를 건너뜁니다. 게시판 권한을 바꾸었다면 위 명령의 결과까지 확인해야 합니다. 별도 사이트를 운영할 때는 자체 Firebase 프로젝트의 인증·권한·설정을 준비하세요. 구성과 배포 기준은 [후기 구조](../architecture/feedback.md)와 [Firebase 설정](../implementation/firebase-setup.md)에 있습니다.

## 변경 제안과 PR

오류는 [GitHub 이슈](https://github.com/Cho-WH/circuit/issues)에 회로 구성, 재현 순서, 예상한 결과와 실제 결과를 적어 주세요. 화면 문제라면 사용 기기·브라우저와 화면 자료가 도움이 됩니다.

코드 기여는 `dev`를 기준으로 작은 기능 브랜치를 만들고 `dev` 대상 PR로 제안합니다. PR에는 해결한 문제와 바뀐 동작, 확인한 검증을 적습니다. 관련 요구사항이 있으면 ID를 연결하고, 저장 형식이나 공개 계약의 변화가 있으면 영향도 설명해 주세요. 세부 기준은 [개발 운영](../operations/development-workflow.md)을 따릅니다.

## 브랜치와 배포

| 브랜치 | 용도                        | 공개 주소                                        |
| :----- | :-------------------------- | :----------------------------------------------- |
| `main` | 수업용 안정판               | [회로 실험실](https://cho-wh.github.io/circuit/) |
| `dev`  | 다음 변경을 확인하는 개발판 | [개발판](https://cho-wh.github.io/circuit/dev/)  |

검증한 `dev` 변경을 PR로 `main`에 병합해 안정판에 반영합니다. 두 브랜치 중 하나에 push하면 [Pages 워크플로](../../.github/workflows/deploy-pages.yml)가 양쪽을 각각 검증·빌드한 뒤 함께 게시합니다. 두 버전의 브라우저 자동 저장 공간은 분리됩니다.

로컬 실행의 기본 채널은 `dev`입니다. Pages 경로, 채널별 빌드 환경 변수, 실패한 배포의 확인·복구는 [개발 운영](../operations/development-workflow.md)에 정리되어 있습니다.

## 라이선스 상태

현재 저장소에는 프로젝트 전체에 적용할 라이선스가 명시되어 있지 않습니다. 포함된 [폰트의 OFL](../../src/typography/OFL.txt)은 해당 폰트에 적용됩니다. 프로젝트 코드의 재사용·배포 조건을 뜻하지는 않습니다.

---

[프로젝트 소개](../../README.md) · [사용 설명서](../ux/quick-start.md) · [전체 문서](../index.md)
