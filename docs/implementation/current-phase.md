# 현재 단계: 단계 0 — 기반 설계

## 목표

단계 1의 직류 해석기를 구현하기 전에 저장 형식, 모듈 경계, 기준 회로, 미결정 기술 사항을 검증 가능한 형태로 확정한다.

## 필수 산출물

- [x] 제품·UX·물리·기술 문서
- [x] 기능 요구사항과 수용 기준
- [x] `CircuitDocument` v1 JSON Schema
- [x] 진단과 fixture JSON Schema
- [x] FIX-01~FIX-10 기준 회로
- [x] ADR 목록과 상태
- [ ] 실제 저장소의 TypeScript 타입 정의
- [ ] 스키마 검증 자동 테스트
- [ ] import 경계 자동 검사
- [ ] 빌드·테스트 명령
- [ ] 첫 세로 조각 작업 이슈

## 구현 순서

1. React + TypeScript + Vite 저장소를 만든다.
2. `src/domain`에 ID, 단위, `CircuitDocument` 타입을 정의한다.
3. JSON Schema와 TypeScript 타입의 필드가 일치하는지 테스트한다.
4. fixture 로더와 검증 테스트를 만든다.
5. 모듈 공개 `index.ts`와 import 제한 규칙을 설정한다.
6. `CircuitCompiler`, `SimulationEngine`, `DiagnosticEngine`의 최소 인터페이스를 정의한다.
7. ADR-003과 ADR-004의 실험 항목을 단계 1 작업으로 분리한다.

## 단계 종료 게이트

- 모든 fixture JSON이 스키마를 통과한다.
- 잘못된 fixture 예시는 기대한 오류로 거부된다.
- 저장→직렬화→읽기 왕복 후 의미가 보존된다.
- `domain`, `connectivity`, `simulation`, `diagnostics`에서 UI 라이브러리 import가 차단된다.
- 요구사항 ID, 물리 규칙 ID, fixture ID의 중복이 없다.
- 단계 1에서 구현할 행렬 풀이와 0 Ω 처리 실험 계획이 ADR에 기록된다.

## 현재 단계에서 하지 않을 일

- 완전한 회로 편집기
- 3D 장면 구현
- 학생 활동 공유
- 교사 출력 UI
- 고급 부품 추가
- 서버 계정과 클라우드 저장
