import * as q from '../src/rational';
import { describe, expect, it } from 'vitest';
import { cloneDocument, validateDocument } from '../src/domain';
import {
  adjustableParameter,
  createComponent,
  componentDefinition,
  symbolMarkup,
  parameterValueAt,
} from '../src/component-library';
import { exportSvg } from '../src/export';
import { parseParameterRange, parameterRangeProperties } from '../src/app/parameters';
import { parseDocument, serializeDocument } from '../src/persistence';
import { executeCommand, createHistory } from '../src/editor';
import { examples } from '../src/fixtures';
import { analyze } from '../src/app/analyze';
import { parameterContext, parameterScales } from '../src/app/parameters';
import { buildPotentialModel } from '../src/visualization';
import { fitPotentialHeight } from '../src/potential-3d';

function circuit() {
  const doc = cloneDocument(examples.find((e) => e.id === 'FIX-02')!.document);
  const variable = doc.components.find((c) => c.id === 'R1')!;
  variable.type = 'resistive-load';
  variable.properties = {
    resistanceOhm: q.store(3),
    resistanceMinOhm: q.store(3),
    resistanceMaxOhm: q.store(6),
  };
  doc.components.find((c) => c.id === 'R2')!.properties.resistanceOhm = q.store(3);
  return doc;
}
describe('adjustable resistance contract', () => {
  it('preserves bounded values on save/load and rejects invalid ranges and out-of-range commands', () => {
    const doc = circuit();
    expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, document: doc });
    const invalid: import('../src/domain').ComponentProperties[] = [
      { resistanceMinOhm: q.store(0) },
      { resistanceMaxOhm: q.store(2) },
      { resistanceOhm: q.store(7) },
    ];
    for (const properties of invalid) {
      expect(
        executeCommand(createHistory(doc), { type: 'SetProperties', id: 'R1', properties }).ok,
      ).toBe(false);
    }
    const old = cloneDocument(doc);
    old.components.find((c) => c.id === 'R1')!.properties = { resistanceOhm: q.store(0) };
    expect(validateDocument(old)).toEqual({ ok: true, document: old });
    expect(parseDocument(serializeDocument(old))).toEqual({ ok: true, document: old });
  });
  it('uses endpoint bounds and keeps volts-to-height fixed while exact readings change', () => {
    const doc = circuit(),
      variable = doc.components.find((c) => c.id === 'R1')!;
    const parameter = adjustableParameter(variable)!;
    const scales = parameterScales(doc, variable.id, parameter);
    expect(scales).toEqual({
      voltage: { min: q.ZERO, max: q.from(9) },
      height: { min: q.ZERO, max: q.from(9) },
      current: q.from(1.5),
    });
    const beforeKey = parameterContext(doc, variable.id, parameter);
    const first = analyze(doc);
    const a = fitPotentialHeight(
      buildPotentialModel(doc, first.compilation.circuit, first.result),
      200,
      1,
      scales.height,
    );
    expect(q.toNumber(first.result.componentVoltages.R1)).toBeCloseTo(4.5);
    variable.properties.resistanceOhm = q.store(6);
    const second = analyze(doc);
    const b = fitPotentialHeight(
      buildPotentialModel(doc, second.compilation.circuit, second.result),
      200,
      1,
      scales.height,
    );
    expect(parameterContext(doc, variable.id, adjustableParameter(variable)!)).toBe(beforeKey);
    expect(q.toNumber(second.result.componentVoltages.R1)).toBeCloseTo(6);
    expect(Math.abs(q.toNumber(second.result.branchCurrents.R1))).toBeCloseTo(1);
    expect(a.scale).toBe(b.scale);
  });
});

describe('adjustable voltage source', () => {
  function supplyCircuit() {
    const doc = circuit();
    const source = doc.components.find((c) => c.type === 'dc-voltage-source')!;
    source.properties = createComponent(
      'adjustable-voltage-source',
      source.id,
      source.position,
    ).properties;
    return { doc, source };
  }

  it('shares the source model, round trips exact bounds, and validates them at the command boundary', () => {
    const { doc, source } = supplyCircuit();
    expect(componentDefinition(source).name).toBe('직류 전원');
    expect(
      componentDefinition(createComponent('dc-voltage-source', 'battery', { x: 0, y: 0 })).name,
    ).toBe('전지');
    expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, document: doc });
    const parameter = adjustableParameter(source)!;
    expect(parameterValueAt(parameter, 0)).toEqual(q.store(0));
    expect(parameterValueAt(parameter, 1000)).toEqual(q.store(12));
    expect(parseParameterRange({ min: '0', max: '3/2' }, parameter)).toEqual({
      min: q.store(0),
      max: q.store(q.rational(3n, 2n)),
    });
    const narrowed = parameterRangeProperties(parameter, { min: q.store(0), max: q.store(6) });
    expect(narrowed.voltageV).toEqual(q.store(6));
    expect(
      executeCommand(createHistory(doc), {
        type: 'SetProperties',
        id: source.id,
        properties: narrowed,
      }).ok,
    ).toBe(true);
    const invalid: import('../src/domain').ComponentProperties[] = [
      { voltageMinV: q.store(-1) },
      { voltageMaxV: q.store(0) },
      { voltageV: q.store(13) },
      { voltageV: q.store(-1) },
      { sourceKind: 'unknown' },
      { voltageMinV: 0 },
    ];
    for (const properties of invalid)
      expect(
        executeCommand(createHistory(doc), { type: 'SetProperties', id: source.id, properties }).ok,
      ).toBe(false);
    const missing = cloneDocument(doc);
    delete missing.components.find((c) => c.id === source.id)!.properties.voltageMaxV;
    expect(validateDocument(missing).ok).toBe(false);
    doc.activity = { allowedCommands: [], revealSteps: [] };
    expect(
      executeCommand(createHistory(doc), {
        type: 'SetProperties',
        id: source.id,
        properties: { voltageV: q.store(3) },
      }).ok,
    ).toBe(false);
  });

  it('keeps comparison scales and source polarity while voltage varies, including exactly zero', () => {
    const { doc, source } = supplyCircuit();
    const parameter = adjustableParameter(source)!;
    const context = parameterContext(doc, source.id, parameter);
    const scales = parameterScales(doc, source.id, parameter);
    expect(scales.voltage).toEqual({ min: q.ZERO, max: q.from(12) });
    for (const voltage of [0, 6, 12]) {
      source.properties.voltageV = q.store(voltage);
      const { result } = analyze(doc);
      expect(result.status).not.toBe('error');
      expect(q.equal(result.componentVoltages.R1, q.from(voltage / 2))).toBe(true);
      expect(parameterContext(doc, source.id, adjustableParameter(source)!)).toBe(context);
      for (const rotation of [0, 90, 180, 270] as const) {
        source.rotation = rotation;
        expect(exportSvg(doc)).toContain(symbolMarkup(source));
        expect(symbolMarkup(source)).toContain('data-symbol="dc-supply"');
        expect(symbolMarkup(source, { disconnectedSource: true })).toContain('M-32 0H-23');
        expect(analyze(doc).result.componentVoltages[source.id]).toEqual(
          result.componentVoltages[source.id],
        );
      }
      source.rotation = 0;
    }
  });
});
