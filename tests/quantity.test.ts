import { serializeDocument, parseDocument } from '../src/persistence';
import { describe, expect, it } from 'vitest';
import {
  parseQuantity,
  formatQuantity,
  createQuantityScale,
  plainNumber,
  storedFraction,
  type QuantityMode,
} from '../src/quantity';
import {
  createComponent,
  componentValueFontSize,
  notationWidth,
  componentValue,
  componentValueInput,
  componentPresentation,
  htmlNotation,
  svgNotation,
} from '../src/component-library';
import { emptyDocument } from '../src/domain';
import { createHistory, executeCommand, executeCommands, undo } from '../src/editor';
import { exportSvg } from '../src/export';

describe('shared physical quantities', () => {
  it('preserves component preferences across save and atomic undo without changing physical values',()=>{
    const document=emptyDocument('display');document.components=[createComponent('resistor','R1',{x:0,y:0}),createComponent('resistor','R2',{x:240,y:0})];
    document.components[0].properties.resistanceOhm=90000;
    const history=createHistory(document);
    const changed=executeCommand(history,{type:'SetProperties',id:'R1',properties:{quantityMode:'scientific'}});if(!changed.ok)throw Error('edit');
    expect(componentValue(changed.history.present.components[0])).toBe('9.000 × 10⁴ Ω');
    expect(componentValue(changed.history.present.components[1])).toBe('10 Ω');
    const restored=parseDocument(serializeDocument(changed.history.present));expect(restored.ok&&restored.document).toEqual(changed.history.present);
    const all=executeCommands(changed.history,document.components.map(c=>({type:'SetProperties' as const,id:c.id,properties:{quantityMode:'plain'}})));if(!all.ok)throw Error('all');
    expect(undo(all.history).present).toEqual(changed.history.present);
    expect(all.history.present.components[0].properties.resistanceOhm).toBe(90000);
    expect(executeCommand(history,{type:'SetProperties',id:'R1',properties:{quantityMode:'unknown'}}).ok).toBe(false);
    const restricted=structuredClone(document);restricted.activity={allowedCommands:['SetLabel'],revealSteps:[]};
    expect(executeCommands(createHistory(restricted),document.components.map(c=>({type:'SetProperties' as const,id:c.id,properties:{quantityMode:'plain'}}))).ok).toBe(false);
  });
  it('fits long quantity labels between neighbouring horizontal components', () => {
    const a = createComponent('resistor', 'R1', { x: 0, y: 0 }),
      b = createComponent('resistor', 'R2', { x: 240, y: 0 });
    const text = '9.000 × 10⁴ Ω',
      font = componentValueFontSize([a, b], a, text, 50);
    expect(notationWidth(text, font)).toBeLessThanOrEqual(228.00001);
    expect(componentValueFontSize([a], a, text, 50)).toBe(50);
  });
  it.each([
    ['10u', 0.00001],
    ['10μΩ', 0.00001],
    ['10µohm', 0.00001],
    ['10n', 1e-8],
    ['10p', 1e-11],
    ['0.1/0.3', 1 / 3],
    ['1/3 u', Number('0.000000333333333333333333333333333333')],
    ['3/4 kΩ', 750],
    ['-3/-4 nΩ', 7.5e-10],
    ['1e300/1e300', 1],
    ['9007199254740993', 9007199254740992],
    ['9007199254740995', 9007199254740996],
    ['5e-324', Number.MIN_VALUE],
    ['1.7976931348623157e308', Number.MAX_VALUE],
    ['.1m', 0.0001],
    ['+0', 0],
    ['0/3 n', 0],
  ])('converts %s with one binary rounding', (input, value) =>
    expect(parseQuantity(String(input), 'Ω')?.value).toBe(value),
  );
  it.each([
    '1e309',
    '1e-324',
    '1e-99999',
    '1/0',
    '1/-0',
    '1/2/3',
    'NaN',
    'Infinity',
    '-1p',
    '2 V',
    '3.2.1',
    'u',
    '1/',
    '1'.repeat(257),
  ])('rejects unrepresentable or invalid input %s', (input) =>
    expect(parseQuantity(input, 'Ω')).toBeNull(),
  );
  it('supports negative voltage and current without negative resistance', () => {
    expect(parseQuantity('-3/4 nV', 'V')?.value).toBe(-7.5e-10);
    expect(parseQuantity('-10pA', 'A')?.value).toBe(-1e-11);
    expect(parseQuantity('2mV', 'A')).toBeNull();
  });
  it('round trips exact written fractions without repeatedly rounding the displayed value', () => {
    const component = createComponent('resistor', 'R1', { x: 0, y: 0 });
    const first = parseQuantity('0.1/0.3 u', 'Ω')!;
    component.properties = { resistanceOhm: first.value, resistanceOhmFraction: first.fraction! };
    for (let i = 0; i < 100; i++) {
      for (const mode of ['auto', 'scientific', 'plain'] as const)
        componentValue(component, { mode });
      const parsed = parseQuantity(componentValueInput(component), 'Ω')!;
      expect(parsed).toEqual(first);
      component.properties = {
        resistanceOhm: parsed.value,
        resistanceOhmFraction: parsed.fraction!,
      };
    }
    expect(
      storedFraction({ ...component.properties, resistanceOhm: 1 }, 'resistanceOhm', 'Ω'),
    ).toBeUndefined();
  });
  it.each([
    [90000, 'auto', '90 kΩ'],
    [0.00001, 'auto', '10 μΩ'],
    [1e-8, 'auto', '10 nΩ'],
    [1e-11, 'auto', '10 pΩ'],
    [999.999, 'auto', '1 kΩ'],
    [0.999999, 'auto', '1 Ω'],
    [1e-15, 'auto', '1.000 × 10⁻¹⁵ Ω'],
    [12345, 'scientific', '1.235 × 10⁴ Ω'],
    [-0.00001, 'scientific', '-1.000 × 10⁻⁵ Ω'],
    [9.9999, 'scientific', '1.000 × 10¹ Ω'],
    [0, 'scientific', '0 Ω'],
    [90000, 'plain', '90000 Ω'],
    [1e-8, 'plain', '0.00000001 Ω'],
    [-0, 'plain', '0 Ω'],
  ])('formats %s using %s', (value, mode, expected) =>
    expect(formatQuantity(Number(value), 'Ω', { mode: mode as QuantityMode })).toBe(expected),
  );
  it('keeps undefined distinct from zero and uses a common scale for axes and tables', () => {
    expect(formatQuantity(undefined, 'V')).toBe('— V');
    expect(formatQuantity(NaN, 'V')).toBe('— V');
    const axis = createQuantityScale([0.001, 0.003, 0], 'A');
    expect(axis.unit).toBe('mA');
    expect(createQuantityScale([1e8, Number.MIN_VALUE], 'A').format(Number.MIN_VALUE)).toBe('4.941 × 10⁻³³⁰');
    expect([0.001, 0.003, 0].map((v) => axis.format(v))).toEqual(['1', '3', '0']);
    expect(createQuantityScale([1, 1e-8], 'A').format(1e-8)).toBe('1.000 × 10⁻⁸');
    for (const v of [Number.MIN_VALUE, Number.MAX_VALUE, 1e-30, -1e21, Math.PI])
      expect(Number(plainNumber(v))).toBe(v);
  });
  it('uses identical values in the editor, output preview and standalone SVG', () => {
    const doc = emptyDocument('quantity-output');
    const component = createComponent('resistor', 'R1', { x: 100, y: 100 });
    component.properties.resistanceOhm = 90000;
    doc.components = [component];
    for (const mode of ['auto', 'scientific', 'plain'] as const) {
      const expected = componentValue(component, { mode });
      expect(componentPresentation(component, undefined, { mode }).value).toBe(expected);
      expect(exportSvg(doc, { quantityFormat: { mode } })).toContain(expected);
    }
    expect(component.properties.resistanceOhm).toBe(90000);
  });
  it('normalizes names in commands, rejects empty names, and undoes one committed edit', () => {
    const doc = emptyDocument('names');
    doc.components = [createComponent('resistor', 'R1', { x: 0, y: 0 })];
    const history = createHistory(doc);
    expect(executeCommand(history, { type: 'SetLabel', id: 'R1', label: '  ' }).ok).toBe(false);
    const result = executeCommand(history, { type: 'SetLabel', id: 'R1', label: '  R_load  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.history.present.components[0].label).toBe('R_load');
    expect(undo(result.history).present).toEqual(doc);
  });
  it('shares equation italics across HTML and exported SVG, leaving units upright', () => {
    expect(htmlNotation('I = 2 A')).toBe('𝐼 = 2 A');
    expect(htmlNotation('I_1 = 3/4 A')).toContain('𝐼<sub>1</sub> = ');
    const svg = svgNotation('I_1 = 3/4 A', { x: 0, y: 0, fontSize: 16 });
    expect(svg).toContain('𝐼');
    expect(svg).toContain(' A</text>');
    expect(svg).not.toContain('𝐴');
  });
});
