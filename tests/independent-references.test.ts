import { describe, expect, it } from 'vitest';
import { emptyDocument, type CircuitDocument } from '../src/domain';
import { createComponent } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit, queryVoltage, queryCurrent, checkKcl } from '../src/simulation';
import { probeVoltage, probeCurrent } from '../src/measurement';
import { buildPotentialModel, buildCurrentModel, pathVoltages } from '../src/visualization';
import { selectedVoltage, fitPotentialHeight } from '../src/potential-3d';
import { createHistory, executeCommand, undo, redo } from '../src/editor';
import { parseDocument, serializeDocument } from '../src/persistence';
import { analyze } from '../src/app/analyze';
import { examples } from '../src/fixtures';
import * as q from '../src/rational';

function loops() {
  const doc = emptyDocument('two-independent-loops');
  for (const n of [1, 2]) {
    const source = createComponent('dc-voltage-source', `V${n}`, { x: n * 400, y: 100 });
    source.properties.voltageV = q.store(n === 1 ? 5 : 9);
    const resistor = createComponent('resistor', `R${n}`, { x: n * 400, y: 300 });
    resistor.properties.resistanceOhm = q.store(1000);
    doc.components.push(source, resistor);
    for (const [k, role] of ['a', 'b'].entries()) doc.wires.push({
      id: `W${n}${k}`, start: { kind: 'terminal', id: `V${n}.${role}` }, end: { kind: 'terminal', id: `R${n}.${role}` }, waypoints: [],
    });
  }
  doc.referenceNode = { kind: 'terminal', id: 'V1.b' };
  return doc;
}
const solve = (doc: CircuitDocument, physicalModel: 'textbook' | 'component' = 'textbook') => {
  const compilation = compileCircuit(doc);
  return { compilation, result: solveCircuit(compilation.circuit, { physicalModel, referencePolicy: 'independent' }) };
};
const voltage = (doc: CircuitDocument, red: string, black: string) => {
  const { compilation, result } = solve(doc);
  return probeVoltage(compilation, result, { kind: 'terminal', id: red }, { kind: 'terminal', id: black });
};

describe('independent voltage references', () => {
  it('supplies local references without a document ground and rejects unknown policies', () => {
    const doc = loops(); doc.referenceNode = null;
    const result = solve(doc).result;
    expect(result.status).toBe('solved');
    expect(result.referenceGroups).toHaveLength(2);
    expect(doc.referenceNode).toBeNull();
    expect(solveCircuit(compileCircuit(doc).circuit, { referencePolicy: 'typo' } as never).diagnostics[0].code).toBe('INVALID_SOLVE_OPTIONS');
    const passive = emptyDocument('passive');
    passive.components.push(createComponent('resistor', 'R', { x: 100, y: 100 }));
    expect(solve(passive).result.branchCurrents.R).toEqual(q.ZERO);
    expect(solve(passive).result.componentVoltages.R).toEqual(q.ZERO);
  });
  it.each(['textbook', 'component'] as const)('calculates two loops without changing physical quantities (%s)', physicalModel => {
    const doc = loops(), { compilation, result } = solve(doc, physicalModel);
    const explicit = solveCircuit(compilation.circuit, { physicalModel });
    expect(result.status).toBe('solved');
    expect(result.solution).toBe('unique');
    expect(result.referenceGroups).toHaveLength(2);
    expect(result.branchCurrents).toEqual(explicit.branchCurrents);
    expect(result.componentVoltages).toEqual(explicit.componentVoltages);
    expect(result.componentPowers).toEqual(explicit.componentPowers);
    for (const group of result.referenceGroups!) expect(result.nodeVoltages[group.referenceNetId]).toEqual(q.ZERO);
    for (const net of compilation.circuit.nets) expect(checkKcl(compilation.circuit, result, net.id)).toMatchObject({ passes: true, sum: q.ZERO });
    expect(Object.keys(result.nodeVoltages)).toHaveLength(compilation.circuit.nets.length);
    expect(result.diagnostics).toEqual([]);
  });
  it('rejects cross-reference measurements even after private query context is lost', () => {
    const doc = loops(), { compilation, result } = solve(doc);
    const ids = compilation.circuit.endpointToNet;
    for (const output of [result, { ...result }, structuredClone(result)]) {
      expect(queryVoltage(output, ids['V1.a'], ids['V2.a']).status).toBe('nonunique');
      expect(queryVoltage(output, ids['V1.b'], ids['V2.b']).status).toBe('nonunique');
      expect(queryVoltage(output, ids['V2.a'], ids['V2.b'])).toEqual({ status: 'unique', value: q.from(9) });
      expect(queryVoltage(output, ids['V2.b'], ids['V2.a'])).toEqual({ status: 'unique', value: q.from(-9) });
      expect(queryVoltage(output, ids['V2.a'], ids['V2.a'])).toEqual({ status: 'unique', value: q.ZERO });
      const reading = probeVoltage(compilation, output, { kind: 'terminal', id: 'V1.a' }, { kind: 'terminal', id: 'V2.a' });
      expect(reading.ok).toBe(false);
      expect(reading.diagnostics[0].code).toBe('INDEPENDENT_VOLTAGE_REFERENCES');
    }
    expect(queryCurrent(result, [{ componentId: 'R1', coefficient: 1 }, { componentId: 'R2', coefficient: 1 }])).toEqual({ status: 'unique', value: q.rational(14n, 1000n) });
    expect(probeCurrent(doc, compilation, result, { kind: 'wire', id: 'W20' }).ok).toBe(true);
  });
  it('merges and splits through a switch with a deterministic reference and no current changes', () => {
    const doc = loops();
    const switchComponent = createComponent('switch', 'S1', { x: 600, y: 300 });
    switchComponent.properties.state = 'open'; doc.components.push(switchComponent);
    for (const [id, role] of [['V1.b', 'a'], ['V2.b', 'b']]) doc.wires.push({ id: `link-${role}`, start: { kind: 'terminal', id }, end: { kind: 'terminal', id: `S1.${role}` }, waypoints: [] });
    const initial = solve(doc).result;
    expect(initial.referenceGroups).toHaveLength(2);
    expect(initial.branchCurrents.S1).toEqual(q.ZERO);
    expect(initial.componentVoltages.S1).toBeUndefined();
    expect(voltage(doc, 'S1.a', 'S1.b').ok).toBe(false);
    const history = createHistory(doc), edit = executeCommand(history, { type: 'SetProperties', id: 'S1', properties: { state: 'closed' } });
    if (!edit.ok) throw new Error('switch edit failed');
    const joined = solve(edit.history.present).result;
    expect(joined.referenceGroups).toHaveLength(1);
    expect(joined.branchCurrents).toEqual(initial.branchCurrents);
    expect(joined.componentVoltages.S1).toEqual(q.ZERO);
    expect(voltage(edit.history.present, 'V1.a', 'V2.a')).toMatchObject({ ok: true, value: { voltageV: q.from(-4) } });
    const restored = solve(undo(edit.history).present).result;
    expect(restored).toEqual(initial);
    expect(solve(redo(undo(edit.history)).present).result).toEqual(joined);
  });
  it('uses the explicit anchor on merge and preserves results through persistence and ordering changes', () => {
    const doc = loops(); doc.referenceNode = { kind: 'terminal', id: 'V2.a' };
    const before = solve(doc).result;
    const reversed = { ...doc, components: [...doc.components].reverse(), wires: [...doc.wires].reverse() };
    expect(solve(reversed).result).toEqual(before);
    const saved = parseDocument(serializeDocument(doc));
    expect(saved.ok && solve(saved.document).result).toEqual(before);
    doc.wires.push({ id: 'join', start: { kind: 'terminal', id: 'V1.b' }, end: { kind: 'terminal', id: 'V2.b' }, waypoints: [] });
    const { compilation, result } = solve(doc);
    expect(result.referenceGroups).toHaveLength(1);
    expect(result.nodeVoltages[compilation.circuit.endpointToNet['V2.a']]).toEqual(q.ZERO);
    expect(result.branchCurrents).toEqual(before.branchCurrents);
    expect(result.componentVoltages).toEqual(before.componentVoltages);
  });
  it('does not invent voltmeter readings or 3D differences across independent reference frames', () => {
    const doc = loops(), meter = createComponent('voltmeter', 'M1', { x: 600, y: 300 });
    doc.components.push(meter);
    for (const [id, role] of [['V1.a', 'a'], ['V2.a', 'b']]) doc.wires.push({ id: `meter-${role}`, start: { kind: 'terminal', id }, end: { kind: 'terminal', id: `M1.${role}` }, waypoints: [] });
    const { compilation, result } = solve(doc);
    expect(result.referenceGroups).toHaveLength(2);
    expect(result.componentVoltages.M1).toBeUndefined();
    expect(result.branchCurrents.M1).toEqual(q.ZERO);
    const model = buildPotentialModel(doc, compilation.circuit, result);
    expect(model.undefinedCount).toBe(0);
    expect(model.references?.map(ref => ref.label)).toEqual(['A', 'B']);
    expect(selectedVoltage(doc, model, 'M1')).toBeNull();
    expect(selectedVoltage(doc, model, 'R2')?.difference).toEqual(q.from(9));
    const fitted = fitPotentialHeight(model, 120, 1);
    expect(fitted.references).toEqual(model.references);
    expect(selectedVoltage(doc, fitted, 'M1')).toBeNull();
    expect(model.segments.filter(s => s.kind === 'wire')).toHaveLength(doc.wires.length);
    const current = buildCurrentModel(doc, compilation, result);
    expect(current.samples.find(s => s.id === 'R2')).toBeDefined();
    const ids = compilation.circuit.endpointToNet;
    expect(pathVoltages({ id: 'cross', label: '', steps: [{ elementId: 'M1', from: ids['V1.a'], to: ids['V2.a'] }] }, result)[0].fromVoltage).toBeUndefined();
  });
  it('does not remove true nonuniqueness or contradictory source constraints', () => {
    const doc = loops(), extra = createComponent('dc-voltage-source', 'V3', { x: 1000, y: 100 });
    extra.properties.voltageV = q.store(9); doc.components.push(extra);
    for (const role of ['a', 'b']) doc.wires.push({ id: `parallel-${role}`, start: { kind: 'terminal', id: `V2.${role}` }, end: { kind: 'terminal', id: `V3.${role}` }, waypoints: [] });
    const result = solve(doc).result;
    expect(result.solution).toBe('nonunique');
    expect(result.branchCurrents.V2).toBeUndefined();
    expect(result.branchCurrents.R2).toEqual(q.rational(9n, 1000n));
    extra.properties.voltageV = q.store(10);
    expect(solve(doc).result.diagnostics.some(d => ['CONFLICTING_SOURCES', 'INFEASIBLE_OPERATING_POINT'].includes(d.code))).toBe(true);
  });
  it.each(['a', 'b'])('preserves diode equilibrium and bridge current under switch state %s', state => {
    const doc = structuredClone(examples.find(e => e.id === 'FIX-14')!.document);
    doc.components.find(c => c.type === 'switch')!.properties.state = state;
    const simple = loops();
    // Disjoint IDs and geometry; neither copy adds a hidden wire or leakage path.
    for (const component of simple.components) {
      component.id = `extra-${component.id}`;
      for (const terminal of component.terminals) terminal.id = `extra-${terminal.id}`;
    }
    for (const wire of simple.wires) { wire.id = `extra-${wire.id}`; wire.start.id = `extra-${wire.start.id}`; wire.end.id = `extra-${wire.end.id}`; }
    const baseline = analyze(doc).result;
    doc.components.push(...simple.components); doc.wires.push(...simple.wires);
    const { compilation, result } = analyze(doc);
    expect(result.referenceGroups).toHaveLength(3);
    expect(result.status).toBe('solved');
    for (const [id, current] of Object.entries(baseline.branchCurrents)) expect(result.branchCurrents[id]).toEqual(current);
    expect(result.componentVoltages.R1).toEqual(q.rational(36n, 10n));
    expect(buildPotentialModel(doc, compilation.circuit, result).undefinedCount).toBe(0);
  });
});
