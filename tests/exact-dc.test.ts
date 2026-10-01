import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { requireDocument, validateDocument } from '../src/domain';
import * as q from '../src/rational';
import { parseQuantity, formatQuantity } from '../src/quantity';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit, checkKcl, checkKvl, equivalentResistance } from '../src/simulation';
import type { CompiledCircuit } from '../src/domain';
import { buildPotentialModel, potentialAxisValue } from '../src/visualization';
import { fitPotentialHeight } from '../src/potential-3d';
import { probeCurrent, probeVoltage, createMeasurementRecord } from '../src/measurement';
import { serializeDocument, parseDocument } from '../src/persistence';
import { adjustableParameter, parameterValueAt } from '../src/component-library';

const fixture = (name: string) =>
  requireDocument(JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8')).document);
describe('exact DC contract', () => {
  it('distinguishes exactly matching decimal source loops from arbitrarily small conflicts', () => {
    const circuit: CompiledCircuit = {
      nets: ['a', 'b', 'c'].map((id) => ({ id, endpointIds: [], wireIds: [] })),
      endpointToNet: {},
      referenceNetId: 'c',
      elements: [
        { id: 'V1', type: 'dc-voltage-source', a: 'a', b: 'b', value: q.from(0.1), closed: true },
        { id: 'V2', type: 'dc-voltage-source', a: 'b', b: 'c', value: q.from(0.2), closed: true },
        { id: 'V3', type: 'dc-voltage-source', a: 'a', b: 'c', value: q.from(0.3), closed: true },
      ],
    };
    // Matching voltage constraints leave source currents undetermined.
    expect(solveCircuit(circuit).diagnostics.map((d) => d.code)).toEqual(['SINGULAR_SYSTEM']);
    circuit.elements[2].value = q.add(0.3, q.power10(-100));
    expect(solveCircuit(circuit).diagnostics.map((d) => d.code)).toEqual(['CONFLICTING_SOURCES']);
    circuit.elements[2] = {
      ...circuit.elements[2],
      id: 'R',
      type: 'resistor',
      value: q.rational(2n, 3n),
    };
    const result = solveCircuit(circuit);
    expect(result.branchCurrents.R).toEqual(q.rational(9n, 20n));
    expect(
      checkKvl(circuit, result, [
        { elementId: 'V1', from: 'a', to: 'b' },
        { elementId: 'V2', from: 'b', to: 'c' },
        { elementId: 'R', from: 'c', to: 'a' },
      ]).sum,
    ).toEqual(q.ZERO);
    const shifted = solveCircuit({ ...circuit, referenceNetId: 'a' });
    expect(shifted.branchCurrents).toEqual(result.branchCurrents);
    expect(shifted.componentVoltages).toEqual(result.componentVoltages);
    expect(shifted.componentPowers).toEqual(result.componentPowers);
    expect(q.sum(Object.values(result.componentPowers))).toEqual(q.ZERO);
  });
  it.each(['1e400', '1e-400'])('keeps %s V geometry finite and axis labels exact', (value) => {
    const doc = fixture('FIX-01-single-resistor');
    const voltage = parseQuantity(value, 'V')!.value;
    doc.components.find((c) => c.type === 'dc-voltage-source')!.properties.voltageV = voltage;
    const compiled = compileCircuit(doc),
      result = solveCircuit(compiled.circuit);
    const model = fitPotentialHeight(buildPotentialModel(doc, compiled.circuit, result), 200, 1);
    expect(Object.values(model.nets).every((n) => Number.isFinite(n.height))).toBe(true);
    expect(Math.max(...Object.values(model.nets).map((n) => n.height!))).toBeCloseTo(200);
    expect(potentialAxisValue(model, model.max)).toEqual(q.from(voltage));
  });
  it('balances the bridge in the resistor and both connecting wires, without suppressing real small currents', () => {
    const doc = fixture('FIX-09-balanced-bridge');
    const run = () => {
      const compilation = compileCircuit(doc);
      return { compilation, result: solveCircuit(compilation.circuit) };
    };
    let { compilation, result } = run();
    expect(result.status).toBe('solved');
    expect(result.branchCurrents.R5).toEqual(q.ZERO);
    for (const id of ['W10', 'W11']) {
      const reading = probeCurrent(doc, compilation, result, { kind: 'wire', id });
      expect(reading.ok && reading.value.amperes).toEqual(q.ZERO);
    }
    expect(result.nodeVoltages[compilation.circuit.endpointToNet.JL]).toEqual(q.from(8));
    for (const net of compilation.circuit.nets)
      expect(checkKcl(compilation.circuit, result, net.id).sum).toEqual(q.ZERO);
    expect(q.sum(Object.values(result.componentPowers))).toEqual(q.ZERO);
    const variable = doc.components.find((c) => c.id === 'R4')!;
    for (const [value, direction] of [
      ['399', 1],
      ['401', -1],
      ['400.000000000000000000000001', -1],
    ] as const) {
      variable.properties.resistanceOhm = parseQuantity(value, 'Ω')!.value;
      ({ compilation, result } = run());
      expect(q.sign(result.branchCurrents.R5)).toBe(direction);
    }
  });
  it('preserves a decimal ratio through input, storage, solving, probes and recording', () => {
    const doc = fixture('FIX-01-single-resistor');
    doc.components.find((c) => c.id === 'R1')!.properties.resistanceOhm = parseQuantity(
      '0.1/0.3',
      'Ω',
    )!.value;
    const source = doc.components.find((c) => c.type === 'dc-voltage-source')!;
    source.properties.voltageV = q.store(1);
    const restored = parseDocument(serializeDocument(doc));
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw Error('restore');
    const compilation = compileCircuit(restored.document),
      result = solveCircuit(compilation.circuit);
    expect(result.branchCurrents.R1).toEqual(q.from(3));
    const red = { kind: 'terminal' as const, id: 'R1.a' },
      black = { kind: 'terminal' as const, id: 'R1.b' };
    const voltage = probeVoltage(compilation, result, red, black);
    expect(voltage.ok && voltage.value.voltageV).toEqual(q.ONE);
    const resistance = equivalentResistance(
      compilation.circuit,
      compilation.circuit.endpointToNet[red.id],
      compilation.circuit.endpointToNet[black.id],
      { excludeSourceIds: [source.id] },
    );
    expect(resistance.ohms).toEqual(q.rational(1n, 3n));
    const record = createMeasurementRecord(doc, {
      condition: 'test',
      source: 'simulation',
      quantity: 'resistance',
      unit: 'Ω',
      value: resistance.ohms!,
      targetIds: [red.id, black.id],
    });
    expect(record.ok && record.value.value).toEqual({ numerator: '1', denominator: '3' });
    expect(() => JSON.stringify(record)).not.toThrow();
  });
  it('rejects noncanonical stored values and numeric physical properties', () => {
    const invalid = fixture('FIX-01-single-resistor');
    invalid.components[0].properties.voltageV = { numerator: '2', denominator: '2' };
    expect(validateDocument(invalid).ok).toBe(false);
    invalid.components[0].properties.voltageV = 1;
    expect(validateDocument(invalid).ok).toBe(false);
  });
  it('solves beyond binary64 bounds and formats nonzero results directly from the exact value', () => {
    const doc = fixture('FIX-01-single-resistor');
    doc.components.find((c) => c.type === 'dc-voltage-source')!.properties.voltageV = q.store(1);
    doc.components.find((c) => c.id === 'R1')!.properties.resistanceOhm = parseQuantity(
      '1e400',
      'Ω',
    )!.value;
    const result = solveCircuit(compileCircuit(doc).circuit);
    expect(result.status).toBe('solved');
    expect(result.branchCurrents.R1).toEqual(q.rational(1n, 10n ** 400n));
    expect(formatQuantity(result.branchCurrents.R1, 'A')).toBe('1.000 × 10⁻⁴⁰⁰ A');
  });
  it('generates slider endpoints and intermediate values exactly', () => {
    const doc = fixture('FIX-11-variable-divider'),
      component = doc.components.find((c) => c.type === 'resistive-load')!;
    component.properties.resistanceMinOhm = q.store(q.rational(1n, 3n));
    component.properties.resistanceMaxOhm = q.store(q.rational(2n, 3n));
    const parameter = adjustableParameter(component)!;
    expect(parameterValueAt(parameter, 0)).toEqual(parameter.min);
    expect(parameterValueAt(parameter, 1000)).toEqual(parameter.max);
    expect(parameterValueAt(parameter, 500)).toEqual(q.store(q.rational(1n, 2n)));
  });
});
