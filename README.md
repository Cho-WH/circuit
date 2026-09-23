# 회로 실험실 · 1차 MVP 0.1

같은 회로 데이터에서 편집·직류 해석·전위 시각화·측정·문제 출력을 연결하는 한국어 교육용 웹앱이다. 이상적인 선형 직류 저항 회로를 지원한다.

## 실행

```bash
npm ci
npm run dev
```

Node.js 20.19 이상이 필요하다. 기본 주소는 http://localhost:5173 이다. 이 Windows 작업 환경에서는 `powershell -ExecutionPolicy Bypass -File tools/run-dev.ps1`로 번들 Node와 설치된 의존성을 사용해 실행할 수도 있다.

빌드: `npm run build` → `dist/`. 정적 웹앱이며 외부 서버·로그인·API 키가 필요 없다.

## 사용 흐름

1. **회로 만들기**: 예제를 열거나 전원·저항·스위치·계기를 배치하고 단자를 연결한다.
2. **전위 보기**: 숫자·색상·3D 높이와 경로 그래프를 비교한다.
3. **측정하기**: 탐침, 임시 전류계, 등가저항, KCL·KVL, 기록 CSV와 값 변화 실험을 사용한다.
4. **문제 만들기**: 문제/정답 표기, 주석과 숫자 형식을 정하고 SVG·PNG를 저장하거나 그림을 복사한다.

[빠른 시작과 단축키](docs/ux/quick-start.md) · [MVP 검증 추적](docs/implementation/mvp-tracker.md)

자동 저장은 현재 브라우저에 남으며 JSON으로 별도 보관할 수 있다. 측정 기록은 메모리에 있으므로 페이지를 닫기 전에 CSV로 저장한다. 파일 형식은 `edu-circuit` v1이다.

이번 1차 범위는 **단계 0~5**다. 공유 링크·학생 활동 배포와 실제 교실 사용성 평가는 단계 6~7의 후속 범위다. GitHub Pages 게시 설정을 추가했다. 실제 교사·학생 대상 연구는 수행하지 않았다.

## 현재 단계

**단계 0~5 기능 MVP 완료.** 최종 236개 테스트·타입·경계·명세·빌드를 통과했고 메인 에이전트가 데스크톱·모바일 시각 검증을 마쳤다. [검증 범위와 제한](docs/testing/mvp-coverage.md)을 함께 확인한다.

현재 진행은 [현재 단계](docs/implementation/current-phase.md)와 [MVP 작업 추적](docs/implementation/mvp-tracker.md)에서 확인한다. 각 단계의 검증 게이트를 통과한 뒤 다음 단계로 진행한다.

## 문서 지도

- MVP 작업 추적: [`docs/implementation/mvp-tracker.md`](docs/implementation/mvp-tracker.md)

- 제품 목표와 범위: [`docs/product/`](docs/product/)
- 사용자 경험: [`docs/ux/`](docs/ux/)
- 물리 규약: [`docs/physics/`](docs/physics/)
- 기술 구조: [`docs/architecture/`](docs/architecture/)
- 기능 요구사항: [`requirements/requirements.yaml`](requirements/requirements.yaml)
- 데이터 형식: [`schemas/`](schemas/)
- 구현 단계: [`docs/implementation/`](docs/implementation/)
- 테스트와 기준 회로: [`docs/testing/`](docs/testing/), [`fixtures/`](fixtures/)
- 기술 결정: [`decisions/`](decisions/)
- 개발 운영: [`docs/operations/`](docs/operations/)

## 명세 검증

개발 환경은 Node.js 20.19 이상에서 `npm install` 후 `npm run dev`로 시작한다.
코드 검증 명령은 `npm run typecheck`, `npm test`, `npm run check:boundaries`, `npm run build`다.
현재 협업에서는 검증 담당 에이전트가 이 명령을 실행하고 결과를 MVP 추적 문서에 기록한다.

```bash
python -m pip install -r requirements.txt
python tools/validate_specs.py
```

검증 항목은 요구사항 구조, ID 중복, 문서 링크, JSON Schema, fixture 참조 무결성이다.

## 제품 한 문장 정의

> 교과서처럼 익숙하고, 프레젠테이션처럼 쉽고, 실험 장치처럼 즉각 반응하는 교육용 회로 작업대.


## GitHub Pages 배포

게시 주소: https://cho-wh.github.io/circuit/

`codex/mvp`에 푸시하면 `.github/workflows/deploy-pages.yml`이 명세·경계·테스트·타입·빌드를 확인한 뒤 `dist`를 GitHub Pages에 게시한다. 저장소 Settings → Pages의 Source는 **GitHub Actions**다. 현재 배포 브랜치는 `codex/mvp` 하나이며, `main`으로 전환할 때 워크플로의 push 브랜치와 build 조건, github-pages 환경의 허용 브랜치를 함께 변경한다.

배포 빌드만 `GITHUB_PAGES=true`를 설정해 `/circuit/` 경로를 사용한다. 로컬 개발은 기존 `/` 경로다. 빌드 결과만 업로드하며 소스·테스트·로컬 저장 데이터는 배포 산출물에 포함하지 않는다. 다른 기기에서 회로를 이어서 쓰려면 JSON으로 옮겨야 한다.

배포 실패 시 Actions의 **Deploy GitHub Pages** 실행 로그를 확인한다. 재배포는 해당 실행의 Re-run jobs를 사용한다. 회귀 문제가 있으면 문제 커밋을 revert한 새 커밋을 배포 브랜치에 푸시한다.
