# 회로 실험실 · 1차 MVP 0.1

같은 회로 데이터에서 편집·직류 해석·전위 시각화·측정·문제 출력을 연결하는 한국어 교육용 웹앱이다. 이상적인 선형 직류 저항 회로를 지원한다.

## 실행

```bash
npm ci
npm run dev
```

Node.js 20.19 이상이 필요하다. 기본 주소는 http://localhost:5173 이다. 이 Windows 작업 환경에서는 `powershell -ExecutionPolicy Bypass -File tools/run-dev.ps1`로 번들 Node와 설치된 의존성을 사용해 실행할 수도 있다.

`npm run build`로 `dist/`를 생성한다. 회로 기능은 외부 서버·로그인·API 키 없이 동작한다.

## 사용 흐름

1. **회로 만들기**: 예제를 열거나 부품을 배치하고 단자에서 배선을 시작한다. 선택 도선의 분기 힌트와 교차점 클릭으로 연결을 편집한다. 이름·값을 함께 수정하며 분수와 아래첨자를 지원한다.
2. **전위 보기**: 숫자·색상·3D 높이와 경로 그래프를 비교한다.
3. **측정하기**: 탐침, 임시 전류계, 등가저항, KCL·KVL, 기록 CSV와 값 변화 실험을 사용한다.
4. **회로도 출력**: 이름·값의 표시·빈칸·위치를 조절하고 점·전류 화살표·글자를 배치한다. 수학 글꼴을 포함한 SVG·PNG를 저장하거나 그림을 복사한다.

자동 저장은 현재 브라우저에 남으며 JSON으로 별도 보관할 수 있다. 측정 기록은 메모리에 있으므로 페이지를 닫기 전에 CSV로 저장한다. 파일 형식은 `edu-circuit` v2이며 이전 v1 파일도 불러온다. ‘한마디’ 게시판은 로컬 미리보기이며 원격 교사 의견 수집 서비스는 연결하지 않았다.

## 현황과 문서

단계 0~5 기능 MVP를 완료했고 UX·문맥 배선·터치 조작 등의 후속 개선을 반영했다. 공유·활동 배포와 실제 교실 사용성 평가는 단계 6~7의 후속 범위다. 로컬 작업과 배포 상태는 현재 현황 문서에서 구분한다.

- [현재 작업 현황](docs/implementation/current-phase.md): 구현 범위, 커밋·배포 상태, 남은 작업
- [빠른 시작과 단축키](docs/ux/quick-start.md): 실행·편집·저장·출력
- [문서 색인](docs/index.md): 제품·UX·물리·구조·운영 문서
- [작업 및 검증 이력](docs/implementation/mvp-tracker.md) · [검증 범위와 제한](docs/testing/mvp-coverage.md)
- [요구사항](requirements/requirements.yaml) · [데이터 스키마](schemas/) · [기술 결정](decisions/README.md)

## 개발과 배포

변경에 맞는 검증 명령과 GitHub Pages 운영 절차는 [개발 운영](docs/operations/development-workflow.md)에 모았다. 게시 주소는 https://cho-wh.github.io/circuit/ 이며, `codex/mvp`에 푸시하면 Actions가 검증 후 정적 빌드를 게시한다. 작업 트리의 변경은 푸시·배포 전까지 공개 사이트에 반영되지 않는다.
