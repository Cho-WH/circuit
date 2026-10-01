import { describe, expect, it } from 'vitest';
import { cloneDocument, validateDocument } from '../src/domain';
import { adjustableParameter, createComponent } from '../src/component-library';
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
  variable.properties = { resistanceOhm: 3, resistanceMinOhm: 3, resistanceMaxOhm: 6 };
  doc.components.find((c) => c.id === 'R2')!.properties.resistanceOhm = 3;
  return doc;
}
describe('adjustable resistance contract', () => {
  it('gives new variable resistors explicit subscript labels while retaining electrical IDs', () => {
    const component = createComponent('resistive-load', 'VR12', { x: 0, y: 0 });
    expect(component.label).toBe('VR_12');
    expect(component.id).toBe('VR12');
    expect(component.terminals.map(t => t.id)).toEqual(['VR12.a', 'VR12.b']);
  });
  it('preserves bounded values on save/load and rejects invalid ranges and out-of-range commands', () => {
    const doc = circuit();
    expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, document: doc });
    const invalid: Record<string, number>[] = [
      { resistanceMinOhm: 0 },
      { resistanceMaxOhm: 2 },
      { resistanceOhm: 7 },
    ];
    for (const properties of invalid) {
      expect(
        executeCommand(createHistory(doc), { type: 'SetProperties', id: 'R1', properties }).ok,
      ).toBe(false);
    }
    const old = cloneDocument(doc);
    old.components.find((c) => c.id === 'R1')!.properties = { resistanceOhm: 0 };
    expect(validateDocument(old)).toEqual({ ok: true, document: old });
    expect(parseDocument(serializeDocument(old))).toEqual({ ok: true, document: old });
  });
  it('uses endpoint bounds and keeps volts-to-height fixed while exact readings change', () => {
    const doc = circuit(),
      variable = doc.components.find((c) => c.id === 'R1')!;
    const parameter = adjustableParameter(variable)!;
    const scales = parameterScales(doc, variable.id, parameter);
    expect(scales).toEqual({
      voltage: { min: 0, max: 9 },
      height: { min: 0, max: 9 },
      current: 1.5,
    });
    const beforeKey = parameterContext(doc, variable.id, parameter);
    const first = analyze(doc);
    const a = fitPotentialHeight(
      buildPotentialModel(doc, first.compilation.circuit, first.result),
      200,
      1,
      scales.height,
    );
    expect(first.result.componentVoltages.R1).toBeCloseTo(4.5);
    variable.properties.resistanceOhm = 6;
    const second = analyze(doc);
    const b = fitPotentialHeight(
      buildPotentialModel(doc, second.compilation.circuit, second.result),
      200,
      1,
      scales.height,
    );
    expect(parameterContext(doc, variable.id, adjustableParameter(variable)!)).toBe(beforeKey);
    expect(second.result.componentVoltages.R1).toBeCloseTo(6);
    expect(Math.abs(second.result.branchCurrents.R1)).toBeCloseTo(1);
    expect(a.scale).toBe(b.scale);
  });
});
