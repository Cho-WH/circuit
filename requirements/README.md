# 요구사항 관리

## 파일

- `requirements.yaml`: 기능·품질 요구사항과 수용 기준
- `product-principles.yaml`: 제품 원칙
- `physics-rules.yaml`: 전위 시각화 물리 규칙
- `requirements.schema.json`: `requirements.yaml`의 구조

## 필드

| 필드 | 의미 |
|---|---|
| `id` | 변경하지 않는 요구사항 식별자 |
| `state` | `accepted`, `proposed`, `deferred`, `superseded` |
| `priority` | `MUST`, `SHOULD`, `LATER` |
| `phase` | 최초 구현 목표 단계 또는 `all`, `later` |
| `statement` | 구현해야 하는 기능 또는 품질 |
| `acceptance` | 완료를 판단할 수 있는 조건 |
| `modules` | 주 책임 모듈 |
| `physics_rules` | 적용되는 물리 규칙 ID |
| `fixtures` | 대표 기준 회로 ID |
| `docs` | 상세 설명 문서 |

요구사항 설명은 다른 문서에서 복제하지 않고 ID로 참조한다. 요구사항의 의미를 바꾸면 수용 기준, fixture, 관련 ADR을 함께 검토한다.
