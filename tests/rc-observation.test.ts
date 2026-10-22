import { expect, it } from 'vitest';
import { rcPolicy, cloneDocument, type RcResult, type RcTime } from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { observeRcFrame, rcEngine, rcCircuitRevision, rcInitialState } from '../src/simulation';
import { probeVoltage, probeCurrent, createMeasurementRecord } from '../src/measurement';
import { buildPotentialModel, buildCurrentModel, buildCurrentPaths } from '../src/visualization';
import { selectedVoltage } from '../src/potential-3d';
import { createComponent, componentSymbolBody, componentPresentation, symbolMarkup } from '../src/component-library';
import { meterReading } from '../src/app/MeterReadouts';
import { measurementConditions, measurementMoment, measurementTableRows, measurementTableText } from '../src/app/measurement-records';
import { parseDocument, serializeDocument, type MeasurementEntry } from '../src/persistence';
import { createHistory, executeCommand, undo } from '../src/editor';
import { createSvgExport } from '../src/export';
import { examples } from '../src/fixtures';
import { rcSessionDocument } from './rc-session-fixture';
import * as q from '../src/rational';

const ok = <T>(r: RcResult<T>): T => { if (!r.ok) throw new Error(JSON.stringify(r.diagnostics)); return r.value; };
function observation(doc = rcSessionDocument(), time: RcTime = { kind: 'finite', seconds: 1 }) {
  const compilation = compileCircuit(doc), circuit = compilation.circuit;
  const plan = ok(rcEngine.prepare({ circuit, initialState: rcInitialState(circuit), circuitRevision: rcCircuitRevision(circuit), operationIndex: 0, transition: 'initial', policy: rcPolicy }));
  const frame = ok(rcEngine.sample(plan, time));
  return { compilation, plan, frame, result: observeRcFrame(frame) };
}

it('shares one certified RC frame across voltage probes, wires, meters, potential and current displays', () => {
  const doc = rcSessionDocument();
  const meter = createComponent('voltmeter', 'M', { x: 0, y: 0 }); doc.components.push(meter);
  for (const [i, node] of ['a', 'g'].entries()) doc.wires.push({ id: `wm${i}`, start: { kind: 'terminal', id: meter.terminals[i].id }, end: { kind: 'junction', id: node }, waypoints: [] });
  const { compilation, frame, result } = observation(doc);
  const voltage = probeVoltage(compilation, result, { kind: 'terminal', id: 'C.a' }, { kind: 'terminal', id: 'C.b' });
  expect(voltage.ok).toBe(true);
  if (!voltage.ok) return;
  expect(q.toNumber(voltage.value.voltageV)).toBeCloseTo(10 * (1 - Math.exp(-1)), 10);
  expect(voltage.value.voltageV.approximation).toBeDefined();
  const direct = rcEngine.queryVoltage(frame, compilation.circuit.endpointToNet['C.a'], compilation.circuit.endpointToNet['C.b']);
  expect(direct.status === 'unique' && direct.value).toEqual(voltage.value.voltageV);
  const wire = probeCurrent(doc, compilation, result, { kind: 'wire', id: 'w20' });
  expect(wire.ok && q.toNumber(wire.value.amperes)).toBeCloseTo(-.001 * Math.exp(-1), 12);
  const model = buildCurrentModel(doc, compilation, result), potential = buildPotentialModel(doc, compilation.circuit, result);
  expect(model.frameId).toBe(frame.context.frameId);
  expect(potential.frameId).toBe(frame.context.frameId);
  expect(selectedVoltage(doc, potential, 'C')?.difference).toEqual(frame.componentVoltages.C);
  expect(meterReading(meter, { document: doc, compilation, result, suspended: false }).text).toMatch(/≈.*6.32/);
  expect(result.provenance).toBeUndefined();
  expect(result.componentPowers).toEqual({});
  expect(potential.endpoints['C.a']).toBe(potential.endpoints['R.b']);
  expect(buildCurrentPaths(doc, model).some(p => p.id === 'C')).toBe(false);
});

it.each([0, 90, 180, 270] as const)('keeps plate potentials separated at %i° and uses roles when terminal order changes', rotation => {
  const doc = rcSessionDocument(), c = doc.components.find(c => c.type === 'capacitor')!;
  c.rotation = rotation; c.terminals.reverse();
  const { compilation, frame, result } = observation(doc);
  const potential = buildPotentialModel(doc, compilation.circuit, result), segments = potential.segments.filter(s => s.id === c.id);
  expect(segments).toHaveLength(4);
  for (const segment of segments) expect(segment.points[0].z).toBe(segment.points[1].z);
  expect(new Set(segments.map(s => s.points[0].z)).size).toBe(2);
  expect(selectedVoltage(doc, potential, c.id)?.difference).toEqual(q.neg(frame.componentVoltages.C));
  const reading = probeCurrent(doc, compilation, result, { kind: 'component', id: c.id });
  expect(reading.ok && reading.value.from.id).toBe('C.a');
  const body = componentSymbolBody(c).bounds;
  expect(rotation % 180 ? body.height : body.width).toBe(16.5);
  expect(rotation % 180 ? body.width : body.height).toBe(46.5);
});

it('records finite versus equilibrium as different conditions and keeps unmodified machine source in CSV', () => {
  const doc = rcSessionDocument();
  const make = (time: RcTime, id: string): MeasurementEntry => {
    const { frame } = observation(doc, time);
    const record = createMeasurementRecord(doc, { condition: '정상 연결', source: 'simulation', quantity: 'voltage', unit: 'V', value: frame.componentVoltages.C, targetIds: ['C.a', 'C.b'], transient: frame.context });
    if (!record.ok) throw new Error('record failed');
    return { id, record: record.value, note: '=sum(1)', sourcesDisconnected: false, anchors: { red: { kind: 'endpoint', endpointKind: 'terminal', id: 'C.a' }, black: { kind: 'endpoint', endpointKind: 'terminal', id: 'C.b' }, current: null } };
  };
  const finite = make({ kind: 'finite', seconds: .125 }, 'one'), equilibrium = make({ kind: 'equilibrium' }, 'two');
  expect(measurementConditions([finite, equilibrium])).toHaveLength(2);
  expect(measurementMoment(finite)).toBe('최초 관찰 · 0.125 s');
  expect(measurementMoment(equilibrium)).toBe('최초 관찰 · 최종 평형');
  expect(finite.record.quality).toBe('approximate');
  expect(equilibrium.record.quality).toBe('exact');
  const rows = measurementTableRows([finite, equilibrium], true);
  expect(JSON.parse(rows[1][10])).toEqual(finite.record.transient);
  expect(JSON.parse(rows[1][12])).toEqual(doc);
  expect(JSON.parse(rows[1][11])).toEqual(finite.record.value!.approximation);
  expect(measurementTableText([finite, equilibrium], ',')).toContain("'=sum(1)");
});

it('exports only explicit initial conditions and preserves output position through save and undo', () => {
  const doc = rcSessionDocument(2), c = doc.components.find(c => c.type === 'capacitor')!;
  expect(componentPresentation(c).voltage).toBeNull();
  let history = createHistory(doc);
  const edited = executeCommand(history, { type: 'SetProperties', id: c.id, properties: { voltageVisible: true, voltageOffsetX: 14, voltageOffsetY: -8 } });
  expect(edited.ok).toBe(true); if (!edited.ok) return;
  history = edited.history;
  const exported = createSvgExport(history.present, {});
  expect(exported.svg).toContain('data-symbol="capacitor"');
  expect(exported.svg).toContain('초기 전압');
  expect(componentPresentation(history.present.components.find(c => c.type === 'capacitor')!).voltage).toContain('2 V');
  const fraction = {...c, properties: {...c.properties, voltageVisible:true, initialVoltageV:q.store(q.rational(-2n,3n)), initialVoltageVFraction:'-2/3'}};
  expect(componentPresentation(fraction).voltage).toBe('초기 전압 -2/3 V');
  expect(componentPresentation({...fraction, properties:{...fraction.properties, voltageBlank:true}}).voltage).toBe('초기 전압 □');
  expect(exported.svg).not.toContain('U = 초기 전압');
  expect(symbolMarkup(c)).not.toContain('reserved');
  const parsed = parseDocument(serializeDocument(history.present));
  expect(parsed.ok && parsed.document).toEqual(history.present);
  expect(undo(history).present).toEqual(doc);
});

it('the teaching example charges and discharges through the same resistor without impulse', () => {
  const doc = cloneDocument(examples.find(e => e.id === 'RC-01')!.document);
  const { plan } = observation(doc);
  expect(q.toNumber(plan.summary.equilibriumState[0].voltageV)).toBe(10);
  doc.components.find(c => c.id === 'S1')!.properties.state = 'b';
  const circuit = compileCircuit(doc).circuit;
  const discharge = ok(rcEngine.prepare({ circuit, initialState: plan.summary.equilibriumState, circuitRevision: rcCircuitRevision(circuit), operationIndex: 1, transition: 'operation', policy: rcPolicy }));
  expect(q.toNumber(ok(rcEngine.sample(discharge, { kind: 'finite', seconds: 1 })).componentVoltages.C1)).toBeCloseTo(10 * Math.exp(-1), 10);
  expect(q.equal(discharge.summary.equilibriumState[0].voltageV, 0)).toBe(true);
});
