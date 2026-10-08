import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/FIX-13-forward-diode.json';
import { requireDocument, type CircuitDocument } from '../src/domain';
import { failedResult, type OperatingCause } from '../src/simulation';
import * as q from '../src/rational';
import { analyze } from '../src/app/analyze';
import { resolveOperatingHelp, measuredHelpComponents } from '../src/app/operating-help/resolve';
import { helpText } from '../src/app/operating-help/topics';
import { placeOperatingHelp } from '../src/app/operating-help/layout';

function document(resistance = 10) {
  const doc = requireDocument(fixture.document);
  doc.components[1].properties.resistanceOhm = q.store(resistance);
  return doc;
}
function input(doc: CircuitDocument, componentModel = false) {
  const evaluated = analyze(doc, componentModel);
  return {
    document: doc,
    circuit: evaluated.compilation.circuit,
    ...evaluated,
    active: true,
    selectedIds: [] as string[],
    phase: evaluated.assessment.status === 'overload' ? ('overload' as const) : ('normal' as const),
  };
}
const topics = (items: ReturnType<typeof resolveOperatingHelp>, id: string) =>
  items.find((i) => i.componentId === id)?.questions.map((q) => q.topic) ?? [];

describe('physical explanations use confirmed observations', () => {
  it('uses the adjustable source name with the existing physical explanations', () => {
    const doc=document(20);
    Object.assign(doc.components[0].properties,{sourceKind:'adjustable',voltageMinV:q.store(0),voltageMaxV:q.store(12)});
    const items=resolveOperatingHelp({...input(doc),selectedIds:['V1']});
    const source=items.find(item=>item.componentId==='V1')!;
    expect(source.questions.length).toBeGreaterThan(0);
    for(const question of source.questions) {
      expect(JSON.stringify(helpText(question))).toContain('전원');
      expect(JSON.stringify(helpText(question))).not.toContain('전지');
    }
  });
  it('does not infer a direction from an approximate current whose uncertainty crosses zero', () => {
    const value = input(document(1000), true);
    const uncertain = {
      ...q.from(-0.01),
      approximation: {
        reason: 'integer-limit' as const,
        policy: 'dc-budget-1' as const,
        absoluteError: 0.1,
      },
    };
    const result = {
      ...value.result,
      branchCurrents: { ...value.result.branchCurrents, V1: uncertain, D1: uncertain },
    };
    expect(resolveOperatingHelp({ ...value, result, selectedIds: ['V1', 'D1'] })).toEqual([]);
  });
  it('keeps build and textbook analysis quiet, and normal component traits opt-in', () => {
    const normal = input(document(1000));
    expect(resolveOperatingHelp(normal)).toEqual([]);
    expect(resolveOperatingHelp({ ...normal, selectedIds: ['V1', 'D1'] })).toEqual([]);
    const component = input(document(1000), true);
    expect(resolveOperatingHelp(component)).toEqual([]);
    expect(topics(resolveOperatingHelp({ ...component, selectedIds: ['V1'] }), 'V1')).toContain(
      'source-terminal-drop',
    );
    expect(resolveOperatingHelp({ ...component, selectedIds: ['V1'], active: false })).toEqual([]);
  });
  it('explains source sag even when only its diode is overloaded, without claiming source damage', () => {
    const value = input(document());
    expect(value.phase).toBe('overload');
    const items = resolveOperatingHelp(value);
    expect(items.map((i) => i.componentId)).toEqual(['D1', 'V1']);
    expect(topics(items, 'D1')[0]).toBe('diode-current');
    expect(topics(items, 'D1')).toContain('diode-forward-voltage');
    expect(topics(items, 'V1')).toEqual(['source-terminal-drop', 'source-not-broken']);
    expect(helpText(items[1].questions[0]).paragraphs[0]).toBe(
      "전지 안에도 '내부저항'이 있어요. 전류가 작을 때는 그 영향을 무시할 수 있지만, 전류가 많이 흐르면 전지 양끝에서 측정하는 전압이 낮아지고 내부에서 열도 더 많이 발생해요.",
    );
  });
  it('uses only damage causes after the effect, never stale live voltages or an undamaged source', () => {
    const value = input(document(1));
    expect(resolveOperatingHelp({ ...value, phase: 'breaking' })).toEqual([]);
    const items = resolveOperatingHelp({ ...value, phase: 'broken', result: failedResult([]) });
    expect(items.length).toBeGreaterThan(0);
    expect(topics(items, 'V1')).toEqual([]);
    expect(items.flatMap((i) => i.questions).every((q) => q.damaged)).toBe(true);
    expect(topics(items, 'D1')).not.toContain('diode-forward-voltage');
  });
  it('explains reverse-voltage danger at zero current without forward heating', () => {
    const doc = document(1000);
    doc.components[0].properties.voltageV = q.store(-80);
    const items = resolveOperatingHelp(input(doc));
    expect(topics(items, 'D1')).toEqual(['diode-reverse', 'diode-reverse-current']);
    expect(helpText(items.find((i) => i.componentId === 'D1')!.questions[0]).title).toBe(
      '전류가 안 흐르는데 왜 위험한가요?',
    );
    expect(topics(items, 'V1')).toEqual([]);
  });
  it('distinguishes an absorbing source from a supplying source', () => {
    const doc = document();
    const other = doc.components[1];
    other.type = 'dc-voltage-source';
    other.properties = { voltageV: q.store(10) };
    other.operatingProfile = { id: 'edu-source', revision: 1 };
    other.terminals[0].role = 'positive';
    other.terminals[1].role = 'negative';
    const load = doc.components[2];
    load.type = 'resistor';
    load.properties = { resistanceOhm: q.store(100) };
    load.operatingProfile = { id: 'edu-resistor', revision: 1 };
    load.terminals[0].role = 'a';
    load.terminals[1].role = 'b';
    const value = input(doc, true);
    const items = resolveOperatingHelp({ ...value, selectedIds: ['V1', 'R1'] });
    expect(topics(items, 'V1')).toEqual(['source-terminal-rise']);
    expect(topics(items, 'R1')).toContain('source-terminal-drop');
  });
  it('does not assert voltage sag for zero or unavailable current; custom diode thresholds avoid 0.7 V', () => {
    const doc = document(1000);
    doc.components[0].properties.voltageV = q.store(0);
    const zero = input(doc, true);
    expect(topics(resolveOperatingHelp({ ...zero, selectedIds: ['V1', 'D1'] }), 'V1')).toEqual([
      'source-terminal-general',
    ]);
    expect(topics(resolveOperatingHelp({ ...zero, selectedIds: ['D1'] }), 'D1')).toEqual([]);
    const custom = document(1000);
    custom.components[2].properties.diodeThresholdV = q.store(2);
    const value = input(custom, true);
    const items = resolveOperatingHelp({ ...value, selectedIds: ['D1'] });
    expect(helpText(items[0].questions[0]).title).not.toContain('0.7');
    expect(
      resolveOperatingHelp({ ...value, selectedIds: ['V1', 'D1'], result: failedResult([]) }),
    ).toEqual([]);
  });
  it('uses a neutral title when numbers are hidden or round to the same value', () => {
    const value = input(document(1e9), true);
    const item = resolveOperatingHelp({ ...value, selectedIds: ['V1'] })[0];
    expect(item.questions[0].general).toBe(true);
    const visibleDrop = input(document());
    expect(
      resolveOperatingHelp({ ...visibleDrop, showNumbers: false }).find(
        (i) => i.componentId === 'V1',
      )!.questions[0].general,
    ).toBe(true);
  });
  it('does not automatically spread explanations to a disconnected healthy circuit', () => {
    const doc = document(),
      separate = document(1000);
    for (const c of separate.components) {
      c.id += 'x';
      c.label += 'x';
      for (const t of c.terminals) t.id += 'x';
    }
    for (const w of separate.wires) {
      w.id += 'x';
      w.start.id += 'x';
      w.end.id += 'x';
    }
    separate.junctions.forEach((j) => (j.id += 'x'));
    doc.components.push(...separate.components);
    doc.wires.push(...separate.wires);
    doc.junctions.push(...separate.junctions);
    const value = input(doc),
      items = resolveOperatingHelp(value);
    expect(items.find((i) => i.componentId === 'V1x')?.automatic).toBe(false);
    const selected = resolveOperatingHelp({ ...value, selectedIds: ['V1x'] });
    expect(selected[0].componentId).toBe('V1x');
    expect(selected[0].automatic).toBe(true);
  });
  it('matches voltage probes by endpoint nets, independently of probe order and visual orientation', () => {
    const value = input(document());
    expect(measuredHelpComponents(value.circuit, 'R1.b', 'V1.n')).toContain('D1');
    expect(measuredHelpComponents(value.circuit, 'V1.n', 'R1.b')).toContain('D1');
    expect(measuredHelpComponents(value.circuit, 'V1.n', 'V1.n')).toEqual([]);
    expect(measuredHelpComponents(value.circuit, '', '', 'D1')).toEqual(['D1']);
  });
  it('preserves the assessed cause order and differentiates power-only source, diode, and resistor stress', () => {
    const value = input(document());
    const cause = (componentId: string, reason: OperatingCause['reason']): OperatingCause => ({
      componentId,
      reason,
      level: 'overload',
      value: q.from(2),
      continuousMax: q.from(1),
      damageAt: q.from(3),
    });
    const components = [
      cause('V1', 'internalPower'),
      cause('V1', 'sourceCurrent'),
      cause('D1', 'power'),
      cause('D1', 'forwardCurrent'),
      cause('R1', 'power'),
    ];
    const items = resolveOperatingHelp({
      ...value,
      assessment: { status: 'overload', components, representative: components[0] },
    });
    expect(topics(items, 'V1')).toEqual([
      'source-power',
      'source-terminal-drop',
      'source-not-broken',
    ]);
    expect(topics(items, 'D1')).toEqual(['diode-power', 'diode-forward-voltage']);
    expect(topics(items, 'R1')).toEqual(['resistor-power']);
    expect(
      helpText(items.find((i) => i.componentId === 'V1')!.questions[0]).paragraphs[0],
    ).not.toContain('감당하기 어려울 만큼 많은 전류');
  });
});

it('reserves the full touch target, avoids labels and tools, and hides offscreen or crowded markers', () => {
  const layout = {
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    labels: [{ componentId: 'a', x: 100, y: 100, width: 30, height: 20 }],
    obstacles: [],
  };
  const placed = placeOperatingHelp(layout, ['a']).get('a')!;
  expect(placed).toMatchObject({ width: 44, height: 44 });
  expect(placed.x + placed.iconX - 130).toBe(4);
  expect(placed.y + placed.iconY + 10).toBe(110);
  const nearDamage = placeOperatingHelp({ ...layout, obstacles: [{ x: 90, y: 119, width: 90, height: 50 }] }, ['a']).get('a')!;
  expect(nearDamage.x + nearDamage.iconX - 130).toBe(4);
  expect(Math.abs(nearDamage.y + nearDamage.iconY + 10 - 110)).toBeLessThanOrEqual(8);
  const alternative = placeOperatingHelp(layout, ['a'], [placed]).get('a')!;
  expect(alternative).not.toEqual(placed);
  expect(placeOperatingHelp(layout, ['a'], [layout.bounds]).size).toBe(0);
  expect(
    placeOperatingHelp({ ...layout, labels: [{ ...layout.labels[0], x: -1 }] }, ['a']).size,
  ).toBe(0);
});
