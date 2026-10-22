import { useEffect, useState } from 'react';
import type { CircuitDocument, ComponentInstance, ComponentProperties, RcFrame } from '../domain';
import { endpointName } from '../component-library';
import { formatQuantity, parseQuantity, quantityInput } from '../quantity';
import * as q from '../rational';

export function CapacitorProperties({ component, document, onApply }: {
  component: ComponentInstance; document: CircuitDocument; onApply: (values: ComponentProperties) => boolean;
}) {
  const [capacitance, setCapacitance] = useState('');
  const [initial, setInitial] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setCapacitance(quantityInput(component.properties.capacitanceF as q.StoredScalar));
    setInitial(quantityInput(component.properties.initialVoltageV as q.StoredScalar));
    setError('');
  }, [component.id, component.properties]);
  const a = component.terminals.find(t => t.role === 'a')!, b = component.terminals.find(t => t.role === 'b')!;
  return <form onSubmit={event => {
    event.preventDefault();
    const c = parseQuantity(capacitance, 'F'), v = parseQuantity(initial, 'V');
    if (!c || q.sign(c.value) <= 0) { setError('전기용량은 0보다 커야 합니다. 예: 100 µF'); return; }
    if (!v) { setError('초기 전압을 입력하세요. 음수도 사용할 수 있습니다.'); return; }
    const ok = onApply({ capacitanceF: c.value, initialVoltageV: v.value, capacitanceFFraction: c.fraction ?? '', initialVoltageVFraction: v.fraction ?? '' });
    setError(ok ? '' : '값을 적용하지 못했습니다.');
  }}>
    <label className="field-label">전기용량 C<div className="unit-input"><input aria-label={`${component.label} 전기용량`} value={capacitance} onChange={e => setCapacitance(e.target.value)} /><span>F</span></div></label>
    <label className="field-label">초기 전압<div className="unit-input"><input aria-label={`${component.label} 초기 전압`} value={initial} onChange={e => setInitial(e.target.value)} /><span>V</span></div></label>
    <p className="tiny-note">초기 전압 = {endpointName(document, a.id)} 전위 − {endpointName(document, b.id)} 전위. 회전해도 두 판의 기준은 유지됩니다.</p>
    <p className="tiny-note">전기용량: 100 µF, 1 mF, 100 nF처럼 입력할 수 있어요.</p>
    <button type="submit">초기 조건 적용</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function CapacitorReadout({ component, document, frame }: { component: ComponentInstance; document: CircuitDocument; frame: RcFrame | null }) {
  const a = component.terminals.find(t => t.role === 'a')!, b = component.terminals.find(t => t.role === 'b')!;
  const charge = frame?.capacitorCharges[component.id];
  return <div className="capacitor-reading" aria-live="off" data-rc-frame={frame?.context.frameId}>
    <p>전기용량 {formatQuantity(component.properties.capacitanceF as q.StoredScalar, 'F')}</p>
    <p>현재 양단 전압 {formatQuantity(frame?.componentVoltages[component.id], 'V')}</p>
    <p>{endpointName(document, a.id)} 쪽 판: {formatQuantity(charge, 'C')}</p>
    <p>{endpointName(document, b.id)} 쪽 판: {formatQuantity(charge ? q.neg(charge) : undefined, 'C')}</p>
    <small>두 판의 전하는 크기가 같고 부호가 반대입니다.</small>
  </div>;
}
