import { describe, expect, it } from 'vitest';
import { createComponent, componentSymbolBody, symbolMarkup } from '../src/component-library';
import { emptyDocument } from '../src/domain';
import { createSvgExport, type OutputLayout, type OutputLayoutItem } from '../src/export';
import { prepareSnap, snapMovement } from '../src/app/output-layout';

const view = { x: -1000, y: -1000, width: 3000, height: 3000 };
type Side = 'top' | 'bottom' | 'left' | 'right';
function pair(id: string, x: number, y: number, side: Side, gap: number): OutputLayoutItem[] {
  const body = { x, y, width: 60, height: 20 };
  const text = { x: x + 20, y: y - gap - 10, width: 20, height: 10 };
  if (side === 'bottom') text.y = y + 20 + gap;
  if (side === 'left' || side === 'right') {
    text.x = side === 'left' ? x - gap - 20 : x + 60 + gap;
    text.y = y + 5;
  }
  return [
    {
      ref: { id, part: 'body' },
      kind: 'symbol',
      movable: false,
      bounds: { x: x + 30, y: y + 10, width: 0, height: 0 },
      referencePoint: { x: x + 30, y: y + 10 },
      symbolBody: { kind: 'resistor', rotation: 0, bounds: body },
    },
    {
      ref: { id, part: 'label' },
      kind: 'text',
      movable: true,
      bounds: text,
      baselineY: text.y + 8,
    },
  ];
}
const layout = (...items: OutputLayoutItem[]): OutputLayout => ({ items, wireSegments: [] });

describe('output component body geometry', () => {
  it('excludes leads and includes stroke, rotated bodies and variable-resistor decoration', () => {
    const r = createComponent('resistor', 'R1', { x: 100, y: 200 });
    expect(componentSymbolBody(r).bounds).toEqual({
      x: 68.75,
      y: 188.75,
      width: 62.5,
      height: 22.5,
    });
    for (const rotation of [0, 90, 180, 270] as const) {
      r.rotation = rotation;
      const bounds = componentSymbolBody(r).bounds;
      expect(bounds.width).toBe(rotation % 180 ? 22.5 : 62.5);
      expect(bounds.height).toBe(rotation % 180 ? 62.5 : 22.5);
      expect(bounds.x + bounds.width / 2).toBe(100);
      expect(bounds.y + bounds.height / 2).toBe(200);
    }
    const variable = createComponent('resistive-load', 'VR1', { x: 0, y: 0 });
    expect(componentSymbolBody(variable).bounds.height).toBe(42.5);
    expect(symbolMarkup(variable)).toContain('M-18 20L18 -20');
    const meter = createComponent('ammeter', 'A1', { x: 0, y: 0 });
    expect(componentSymbolBody(meter).bounds).toEqual({
      x: -24.25,
      y: -24.25,
      width: 48.5,
      height: 48.5,
    });
    const diode = createComponent('diode', 'D1', { x: 0, y: 0 });
    expect(componentSymbolBody(diode).bounds.width).toBe(34.5);
  });
  it('distinguishes source and switch variants and follows their actual body state', () => {
    const battery = createComponent('dc-voltage-source', 'V1', { x: 0, y: 0 });
    battery.rotation = 0;
    expect(componentSymbolBody(battery)).toMatchObject({
      kind: 'dc-voltage-source',
      bounds: { x: -8.25, y: -23.25, width: 17.75, height: 46.5 },
    });
    expect(
      componentSymbolBody(createComponent('adjustable-voltage-source', 'V2', { x: 0, y: 0 })).kind,
    ).toBe('adjustable-voltage-source');
    const s = createComponent('switch', 'S1', { x: 0, y: 0 });
    expect(componentSymbolBody(s).bounds.y).toBe(-21.25);
    s.properties.state = 'closed';
    expect(componentSymbolBody(s).bounds.y).toBe(-4.25);
    const spdt = createComponent('changeover-switch', 'S2', { x: 0, y: 0 });
    expect(componentSymbolBody(spdt)).toMatchObject({
      kind: 'changeover-switch',
      bounds: { x: -28.25, y: -28.25, width: 56.5, height: 56.5 },
    });
    spdt.terminals[0].localPosition = { x: -60, y: 12 };
    expect(componentSymbolBody(spdt).bounds.x).toBe(-64.25);
  });
  it('exports body metadata without changing symbol markup or exposing hidden reference text', () => {
    const doc = emptyDocument('body-gap');
    doc.components = [createComponent('resistor', 'R1', { x: 100, y: 200 })];
    doc.components[0].properties.labelVisible = false;
    const scene = createSvgExport(doc),
      withPolarity = createSvgExport(doc, { showSymbolPolarity: true });
    expect(scene.content).toContain(symbolMarkup(doc.components[0]));
    const body = scene.layout.items.find((i) => i.ref.part === 'body')!;
    expect(body.symbolBody).toEqual(componentSymbolBody(doc.components[0]));
    expect(body.symbolBody).toEqual(
      withPolarity.layout.items.find((i) => i.ref.part === 'body')!.symbolBody,
    );
    expect(scene.layout.items.some((i) => i.ref.part === 'label')).toBe(false);
    expect(scene.svg).not.toContain('body-gap');
  });
});

describe('paired component-notation gap snapping', () => {
  it.each(['top', 'bottom', 'left', 'right'] as const)(
    'matches independent %s gaps and draws each measurement at its own pair',
    (side) => {
      const reference = pair('R1', 100, 100, side, 10),
        moving = pair('R2', 400, 350, side, 40);
      const axis = side === 'top' || side === 'bottom' ? 'y' : 'x';
      const before = side === 'top' || side === 'left';
      const session = prepareSnap(
        layout(...reference, ...moving),
        [moving[1].ref],
        { x: 1, y: 1 },
        view,
      );
      const result = snapMovement(session, { x: 0, y: 0, [axis]: before ? 28 : -28 });
      expect(result.delta[axis]).toBe(before ? 30 : -30);
      const guides = result.guides.filter((g) => g.kind === 'body-gap');
      expect(guides).toHaveLength(2);
      expect(guides.map((g) => g.end[axis] - g.start[axis])).toEqual([10, 10]);
      const other = axis === 'x' ? 'y' : 'x';
      expect(guides[0].start[other]).not.toBe(guides[1].start[other]);
    },
  );
  it.each([0.5, 1, 2])(
    'uses CSS distance at zoom %s and keeps the same reference until exit',
    (scale) => {
      const a = pair('R1', 100, 100, 'top', 10),
        b = pair('R2', 400, 350, 'top', 40);
      const session = prepareSnap(layout(...a, ...b), [b[1].ref], { x: scale, y: scale }, view);
      const snap = snapMovement(session, { x: 0, y: 30 - 5 / scale });
      expect(snap.delta.y).toBe(30);
      expect(snapMovement(session, { x: 0, y: 30 - 9 / scale }, true, snap.locks).locks.y).toBe(
        snap.locks.y,
      );
      expect(
        snapMovement(session, { x: 0, y: 30 - 11 / scale }, true, snap.locks).locks.y,
      ).not.toBe(snap.locks.y);
      expect(snapMovement(session, { x: 0, y: 28 }, false, snap.locks).guides).toEqual([]);
      expect(
        snapMovement(session, { x: 0, y: 28 }, true, snap.locks, 'x').guides.some(
          (g) => g.kind === 'body-gap',
        ),
      ).toBe(false);
      expect(snapMovement(session, { x: 0, y: 28 }, true, {}, 'y').delta.y).toBe(30);
    },
  );
  it.each([
    'kind',
    'rotation',
    'role',
    'hidden',
    'offscreen',
    'multi',
    'diagonal',
    'overlap',
    'opposite',
    'far',
  ] as const)('rejects an unrelated %s reference or gesture', (reason) => {
    const a = pair(
        'R1',
        100,
        100,
        reason === 'opposite' ? 'bottom' : 'top',
        reason === 'far' ? 200 : 10,
      ),
      b = pair('R2', 400, 350, 'top', 40);
    if (reason === 'kind') a[0].symbolBody!.kind = 'resistive-load';
    if (reason === 'rotation') a[0].symbolBody!.rotation = 90;
    if (reason === 'role') a[1].ref = { id: 'R1', part: 'value' };
    if (reason === 'diagonal') b[1].bounds = { ...b[1].bounds, x: 600 };
    if (reason === 'overlap') a[1].bounds = { ...a[1].bounds, y: 95 };
    const scene = layout(...(reason === 'hidden' ? [a[0]] : a), ...b);
    const session = prepareSnap(
      scene,
      reason === 'multi' ? [a[1].ref, b[1].ref] : [b[1].ref],
      { x: 1, y: 1 },
      reason === 'offscreen' ? { x: 300, y: 250, width: 300, height: 300 } : view,
    );
    expect(snapMovement(session, { x: 0, y: 28 }).guides.some((g) => g.kind === 'body-gap')).toBe(
      false,
    );
  });
  it('supports blank values and resolves competing pairs independently of document order', () => {
    const a = pair('R1', 100, 100, 'top', 10),
      b = pair('R2', 400, 350, 'top', 40),
      c = pair('R3', 700, 100, 'top', 12);
    for (const p of [a, b, c]) {
      p[1].ref = { ...p[1].ref, part: 'value' };
      p[1].kind = 'blank';
    }
    const items = [...a, ...b, ...c];
    const run = (items: OutputLayoutItem[]) =>
      snapMovement(prepareSnap(layout(...items), [b[1].ref], { x: 1, y: 1 }, view), {
        x: 0,
        y: 29,
      });
    const result = run(items);
    expect(result).toEqual(run([...items].reverse()));
    expect(result.guides.filter((g) => g.kind === 'body-gap')).toHaveLength(2);
    const session = prepareSnap(layout(...items), [b[1].ref], { x: 1, y: 1 }, view);
    expect(snapMovement(session, { x: 0, y: 28 }, true, result.locks)).toEqual(
      snapMovement(session, { x: 0, y: 28 }),
    );
  });
  it('drops a gap guide if simultaneous horizontal snapping removes the facing overlap', () => {
    const a = pair('R1', 100, 100, 'top', 10),
      b = pair('R2', 400, 350, 'top', 40);
    const outside: OutputLayoutItem = {
      ref: { id: 'note', part: 'annotation' },
      kind: 'note',
      movable: true,
      bounds: { x: 462, y: 270, width: 20, height: 10 },
    };
    const session = prepareSnap(layout(...a, ...b, outside), [b[1].ref], { x: 1, y: 1 }, view);
    const result = snapMovement(session, { x: 39, y: 28 });
    expect(result.delta.x).toBe(42);
    expect(result.delta.y).toBe(28);
    expect(result.guides.some((g) => g.kind === 'body-gap')).toBe(false);
  });
});
