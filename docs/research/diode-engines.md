# 다이오드·경계 처리 참고 조사

조사 기준일: 2026-10-05. 이 문서는 [ADR-026](../../decisions/ADR-026-diode-boundary-analysis.md)의 근거를 보존한다. 외부 구현에서 확인한 사실과 이 앱에서 새로 정한 정책을 구별한다.

## 1. 참고한 구현과 채택 범위

### Modelica Standard Library — 구간선형 소자

- [IdealSemiconductor 문서, Modelica 4.0.0](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/Modelica/Modelica.Electrical.Analog.Interfaces.IdealSemiconductor.html)
- [동일 버전 원본](https://github.com/modelica/ModelicaStandardLibrary/blob/v4.0.0/Modelica/Electrical/Analog/Interfaces/IdealSemiconductor.mo)

`Vknee`, `Ron`, `Goff`로 문턱과 도통·차단 기울기를 분리한다. 열 포트를 연결할 수 있지만 이 소자 자체의 전기 특성에는 온도 의존성이 포함되지 않는다고 명시한다.

이 앱에는 문턱과 양의 도통 기울기를 구분하는 구간선형 구조를 참고한다. 교과서의 정확한 0.7 V 모델과 유한 부품 모델을 같은 stamping·제약 해석 경로에 둘 수 있다. 외부 모델의 기본 파라미터를 우리 앱의 전지·다이오드 정격으로 가져오지는 않는다.

### PhET Circuit Construction Kit — 유한 저항과 교육용 결과 표현

검토 기준 커밋: `94b429a68a279b2ad41e1031c809bb24b3ce5b4a`.

- [물리 모델 설명](https://github.com/phetsims/circuit-construction-kit-common/blob/94b429a68a279b2ad41e1031c809bb24b3ce5b4a/doc/model.md)
- [LTACircuit.ts](https://github.com/phetsims/circuit-construction-kit-common/blob/94b429a68a279b2ad41e1031c809bb24b3ce5b4a/js/model/analysis/LTACircuit.ts)
- [VoltageSource.ts](https://github.com/phetsims/circuit-construction-kit-common/blob/94b429a68a279b2ad41e1031c809bb24b3ce5b4a/js/model/VoltageSource.ts)

이 구현은 전원·배선에 유한 저항을 두며 해석에서 전원을 이상 전원과 직렬 저항으로 구성한다. 검토한 전원 코드에는 전류 크기와 내부저항 조건으로 불 표시를 정하는 로직이 있다. 해당 조건은 실시간 온도 적분 결과가 아니다.

여기서는 유한 전원 특성과 짧은 교육용 결과 표현을 참고한다. PhET의 매우 작은 기본 저항이나 전류 기준을 우리 부품의 실제 정격으로 해석하지 않는다. 우리 앱은 도선의 0 Ω를 유지하고, 프로필별 경계·만들기 예고·분석 확정 사건을 별도로 정의한다.

### CircuitJS1 — 전기 특성·수치 보조·LED 밝기의 분리

검토 기준 커밋: `dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf`.

- [DiodeElm.java](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/DiodeElm.java)
- [Diode.java](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/Diode.java)
- [LEDElm.java](https://github.com/sharpie7/circuitjs1/blob/dd47cf43a1baa91e2d6ae0f5884ccf0f589989bf/src/com/lushprojects/circuitjs1/client/LEDElm.java)

다이오드의 직렬 저항을 전기 모델에 두는 처리와 수치 계산을 돕는 `gmin`은 역할이 다르다. LED 코드에는 전류를 밝기로 변환하고 표시 범위를 제한하는 처리가 있다. 검토한 LED 파일의 밝기 상한만으로 소자의 실제 과부하·파손 경계가 정의되었다고 볼 수는 없다.

이 앱도 수치 안정화 값을 실제 내부저항으로 설명하지 않고, LED 밝기 포화와 전기적 위험을 분리한다. 지수식·반복 수렴을 포함한 범용 SPICE 수준의 엔진 전체를 지금 이식하지 않는다.

## 2. 경계 모델을 뒷받침하는 1차 자료

| 자료 | 확인한 내용 | 설계에 반영한 점 |
|---|---|---|
| [Energizer: Battery Internal Resistance](https://data.energizer.com/pdfs/batteryir.pdf) | 부하에 따른 단자전압 감소와 내부저항, 조건에 따른 저항 변화 | 전원 유효 내부저항을 명시적 프로필로 사용. 모든 전지를 동일한 보편 수치로 취급하지 않음 |
| [TI SLVA325: Ballast Resistor Calculation](https://e2echina.ti.com/cfs-file/__key/telligent-evolution-components-attachments/13-107-00-00-00-01-00-92/slva325.pdf) | 병렬 LED의 특성 차이와 가지 전류 분배, 안정 저항의 역할 | 동일 특성은 대칭, 저장된 편차는 반복 가능한 차이. 공통 저항과 가지 저항의 효과를 실제 계산 |
| [Vishay: LED Physics](https://www.vishay.com/docs/led_physics.pdf) | LED 전압·전류 특성과 전류 제한의 필요성 | 후속 LED의 전류·밝기·정격을 분리. 밝기가 더 커지지 않는다고 안전하다고 판단하지 않음 |
| [Rohde & Schwarz: Constant Voltage / Constant Current](https://www.rohde-schwarz.com/us/products/test-and-measurement/essentials-test-equipment/dc-power-supplies/understanding-constant-voltage-current_256008.html) | 정전압/정전류 운전과 과전류 보호 차단의 차이 | 일반 전지를 자동 전류 제한 전원으로 만들지 않음. 보호 전원은 향후 별도 모델 |
| [Aimtec: Configuring LEDs in Series or Parallel or Matrix](https://www.aimtec.com/site/Aimtec/files/documents/ApplicationNotes/configuring%20leds%20in%20series%20or%20parallel%20or%20matrix.pdf) | LED의 개방·단락 고장 가능성과 구성에 따른 영향 | 빨강 이후 모두 개방되었다고 가정하지 않음. 첫 버전은 파손 사건 후 분석을 멈춤 |

이 자료들은 내부저항·분배·정격·고장 형태의 방향을 뒷받침한다. 특정 교육용 `damageAt`이나 실제로 몇 초 뒤 망가지는지는 이 자료에서 자동 도출하지 않는다. 내장 프로필 수치와 적용 범위는 별도 설계 작업에서 고정한다.

## 3. 이 앱에서 정한 정책

### 공통 기호와 A/K 근거 (2026-10-05)

[EBSi 2009학년도 9월 모의평가 기초제도 해설](https://wdown.ebsi.co.kr/W61001/01exam/20080904/j_jic11_hsj.pdf)의 6쪽 17번은 고등학교 대상 공공 자료로 다이오드 기호와 A(애노드)→K(캐소드) 전류 방향을 함께 제시한다. 이 기호의 삼각형과 K쪽 막대를 공통 `symbolMarkup`에 사용하고, 기본 배치는 A 왼쪽·K 오른쪽이다. 전기 극성은 문서의 `anode`·`cathode` 역할로 결정한다. 회전·단자 배열이 달라져도 A/K는 유지하며 일반 다이오드에 LED 광선 표시를 붙이지 않는다.

다음은 외부 구현의 기능을 그대로 옮겼다는 주장이 아니라 사용자와 합의한 제품 정책이다.

1. 일반 수업은 정확한 0.7 V 교과서 모델을 유지한다. 필요한 경계와 연속 조절에서는 명시적 부품 특성으로 유한한 작동점을 계산한다.
2. 정상·노랑·빨강은 해의 유무가 아니라 검증된 전류·전력·역전압과 부품별 경계로 정한다.
3. 만들기에서는 현재값으로 분석할 경우의 느낌표만 제공한다. 분석 진입을 확정으로 간주하고 가변저항의 임계 통과도 사건으로 다룬다.
4. 노랑은 작동 중 과부하, 빨강은 짧은 국소 파열 후 파손 상태다. 원인은 한 문장으로, 수정은 기존 회로 만들기로 연결한다.
5. 열 축적·냉각·실제 온도·파손 시간을 계산하지 않는다. 연출 시간은 물리 시간과 관계없다.
6. 부품 프로필과 기록 조건을 보존한다. 같은 회로를 반복할 때 설명 없이 특성이나 위험이 바뀌지 않는다.

실제 코드 이식은 이번 문서 작업에 포함하지 않는다. 구현은 현재 저장소의 순수 계산 모듈·공통 기호·측정·명령 경계를 확장하며, 자세한 순서는 [다이오드 기획](../implementation/diode-mvp.md)을 따른다.
