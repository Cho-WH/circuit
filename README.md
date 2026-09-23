# 교육용 전기회로 웹앱 개발 명세 v0.2.0

회로를 한 번 그리면 표준 2D 회로도, 직류 시뮬레이션, 측정, 전위 색상·숫자·3D 높이, 문제지와 정답지를 같은 데이터에서 만드는 교육용 회로 작업대의 개발 기준이다.

## 현재 단계

현재 구현 단계는 **단계 0 — 기반 설계**다. 앱 코드를 확장하기 전에 문서 스키마, 모듈 경계, 기준 회로, 기술 결정 기록을 확정한다.

## 문서 지도

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

```bash
python -m pip install -r requirements.txt
python tools/validate_specs.py
```

검증 항목은 요구사항 구조, ID 중복, 문서 링크, JSON Schema, fixture 참조 무결성이다.

## 제품 한 문장 정의

> 교과서처럼 익숙하고, 프레젠테이션처럼 쉽고, 실험 장치처럼 즉각 반응하는 교육용 회로 작업대.
