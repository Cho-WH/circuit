import * as q from '../src/rational';
import { describe, expect, it } from 'vitest';
import { cloneDocument, validateDocument } from '../src/domain';
import { adjustableParameter } from '../src/component-library';
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
  variable.properties = { resistanceOhm: q.store(3), resistanceMinOhm: q.store(3), resistanceMaxOhm: q.store(6) };
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
