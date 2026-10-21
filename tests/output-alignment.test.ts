import { describe, expect, it } from 'vitest';
import { emptyDocument, type Point } from '../src/domain';
import { createComponent, arrowGeometry } from '../src/component-library';
import { createSvgExport, type OutputLayout, type OutputLayoutItem } from '../src/export';
import { createHistory, executeCommands, undo, redo } from '../src/editor';
import { parseDocument, serializeDocument } from '../src/persistence';
import { compileCircuit } from '../src/connectivity';
import {
  alignmentMoves,
  marqueeSelection,
  movementCommands,
  normalizeSelection,
  prepareSnap,
  previewMovement,
  selectionUnits,
  snapMovement,
} from '../src/app/output-layout';

const item = (id: string, x: number, y: number, width = 20, height = 10): OutputLayoutItem => ({
  ref: { id, part: 'label' },
  kind: 'text',
  movable: true,
  bounds: { x, y, width, height },
  baselineY: y + 8,
});
const layout = (...items: OutputLayoutItem[]): OutputLayout => ({ items, wireSegments: [] });
const view = { x: -1000, y: -1000, width: 3000, height: 3000 };
it('snaps only along the permitted drag axis and drops perpendicular locks and guides', () => {
  const source=item('source',0,0), target=item('target',100,3);
  const session=prepareSnap(layout(source,target),[source.ref],{x:1,y:1},view);
  const free=snapMovement(session,{x:98,y:0});
  expect(free.delta).toEqual({x:100,y:3});
  const horizontal=snapMovement(session,{x:98,y:0},true,free.locks,'x');
  expect(horizontal.delta).toEqual({x:100,y:0});
  expect(horizontal.locks.y).toBeUndefined();
  expect(horizontal.guides.length).toBeGreaterThan(0);
  expect(horizontal.guides.every(g=>g.start.x===g.end.x)).toBe(true);
  const vertical=snapMovement(session,{x:0,y:0},true,free.locks,'y');
  expect(vertical.delta).toEqual({x:0,y:3});
  expect(vertical.guides.every(g=>g.start.y===g.end.y)).toBe(true);
});
function fixture() {
  const doc = emptyDocument('output-alignment');
  doc.components = [
    createComponent('resistor', 'R1', { x: 100, y: 200 }),
    createComponent('resistor', 'R2', { x: 300, y: 240 }),
    createComponent('resistor', 'R3', { x: 550, y: 200 }),
  ];
  doc.components[0].properties.answerBlank = true;
  doc.annotations = [
    {
      id: 'arrow',
      kind: 'arrow',
      anchor: null,
      position: { x: 100, y: 100 },
      content: 'I_1',
      visibility: 'always',
      presentation: {
        answerVisible: true,
        answerDisplay: 'custom',
        answerText: '3/4 A',
        labelOffsetX: 150,
      },
      arrow: { shape: 'corner', length: 90, legLength: 50, rotation: 0, reversed: false },
    },
  ];
  return doc;
}

describe('output geometry and normalized selection', () => {
  it('shares blank, fraction and subscript baseline geometry with export and excludes hidden parts', () => {
    const doc = fixture(),
      scene = createSvgExport(doc);
    const blank = scene.layout.items.find((i) => i.ref.id === 'R1' && i.ref.part === 'value')!;
    expect(blank.kind).toBe('blank');
    expect(blank.bounds.width).toBe(84);
    expect(blank.bounds.y).toBe(blank.baselineY! - 27);
    const fraction = scene.layout.items.find(
      (i) => i.ref.id === 'arrow' && i.ref.part === 'value',
    )!;
    expect(fraction.bounds.height).toBeCloseTo(24 * 2.45);
    expect(scene.svg).toContain(`y="${fraction.baselineY! - 0.65 * 24}"`);
    expect(
      scene.layout.items.find((i) => i.ref.id === 'R1' && i.ref.part === 'body'),
    ).toMatchObject({
      movable: false,
      referencePoint: { x: 100, y: 200 },
      bounds: { width: 0, height: 0 },
    });
    doc.components[0].properties.answerVisible = false;
    doc.annotations[0].visibility = 'hidden';
    const hidden = createSvgExport(doc).layout;
    expect(
      hidden.items.some(
        (i) => i.ref.id === 'arrow' || (i.ref.id === 'R1' && i.ref.part === 'value'),
      ),
    ).toBe(false);
    expect(normalizeSelection(hidden, [blank.ref, fraction.ref])).toEqual([]);
    expect(createSvgExport(doc, { circuitOnly: true }).layout.items.every((i) => !i.movable)).toBe(
      true,
    );
  });
  it('selects the entire arrow unit when its body is enclosed, even with outside labels', () => {
    const doc = fixture(),
      data = createSvgExport(doc).layout;
    const body = data.items.find((i) => i.kind === 'arrow')!,
      children = data.items.filter((i) => i.movesWith);
    const refs = marqueeSelection(data, body.bounds);
    expect(refs).toContainEqual(body.ref);
    expect(refs.some((i) => i.id === 'arrow' && i.part !== 'annotation')).toBe(false);
    expect(
      selectionUnits(data, refs).find((i) => i.kind === 'arrow')!.bounds.width,
    ).toBeGreaterThan(body.bounds.width);
    expect(normalizeSelection(data, [body.ref, ...children.map((i) => i.ref), body.ref])).toEqual([
      body.ref,
    ]);
    expect(
      normalizeSelection(
        data,
        children.map((i) => i.ref),
      ),
    ).toHaveLength(2);
    const g = arrowGeometry(doc.annotations[0], doc.annotations[0].position!);
    for (const p of g.headPoints) expect(p.x).toBeGreaterThanOrEqual(body.bounds.x);
  });
});

describe('selected bounds alignment and fixed-end gaps', () => {
  const units = [item('a', 10, 10, 20), item('b', 60, 30, 40), item('c', 170, 50, 30)];
  it('uses the whole selected bounds and midpoint of min/max baselines', () => {
    expect(alignmentMoves(units, 'left')!.map((t) => t.delta.x)).toEqual([0, -50, -160]);
    expect(alignmentMoves(units, 'centerX')!.map((t) => t.delta.x)).toEqual([85, 25, -80]);
    expect(alignmentMoves(units, 'baseline')!.map((t) => t.delta.y)).toEqual([20, 0, -20]);
    expect(alignmentMoves([{ ...units[0], kind: 'arrow' }, units[1]], 'baseline')).toBeNull();
  });
  it('distributes empty gaps without moving endpoints and rejects insufficient space', () => {
    expect(alignmentMoves(units, 'gapX')!.map((t) => t.delta)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(alignmentMoves(units.slice(0, 2), 'gapX')).toBeNull();
    expect(
      alignmentMoves([item('a', 0, 0, 50), item('b', 20, 0, 50), item('c', 40, 0, 50)], 'gapX'),
    ).toBeNull();
  });
});

describe('screen-distance snapping', () => {
  it.each([0.5, 1, 2])('has the same entry and exit distances at scale %s', (scale) => {
    const a = item('moving', 0, 0),
      b = item('fixed', 100, 50);
    const session = prepareSnap(layout(a, b), [a.ref], { x: scale, y: scale }, view);
    const entering = snapMovement(session, { x: 100 - 5 / scale, y: 0 });
    expect(entering.delta.x).toBe(100);
    expect(entering.guides.length).toBeGreaterThan(0);
    expect(snapMovement(session, { x: 100 - 9 / scale, y: 0 }, true, entering.locks).delta.x).toBe(
      100,
    );
    const released = snapMovement(session, { x: 100 - 11 / scale, y: 0 }, true, entering.locks);
    expect(released.locks.x).not.toBe(entering.locks.x);
    expect(snapMovement(session, { x: 98, y: 0 }, false, entering.locks)).toEqual({
      delta: { x: 98, y: 0 },
      guides: [],
      locks: {},
    });
  });
  it('resolves ties independently of input order, favours the host centre and excludes moving children', () => {
    const a = item('a', 0, 0),
      host = {
        ...item('a', 100, 700, 0, 0),
        ref: { id: 'a', part: 'body' as const },
        kind: 'symbol' as const,
        movable: false,
        referencePoint: { x: 100, y: 700 },
      };
    const b = item('b', 90.2, 20),
      items = [a, b, host];
    const snap = (items: OutputLayoutItem[]) =>
      snapMovement(prepareSnap(layout(...items), [a.ref], { x: 1, y: 1 }, view), { x: 86, y: 0 });
    expect(snap(items).delta.x).toBe(90);
    expect(snap(items)).toEqual(snap([...items].reverse()));
    const doc = fixture(),
      data = createSvgExport(doc).layout,
      body = data.items.find((i) => i.kind === 'arrow')!;
    const session = prepareSnap(data, [body.ref], { x: 1, y: 2 }, view);
    expect(session.fixed.some((i) => i.ref.id === 'arrow')).toBe(false);
    const far = item('far', 100, 500);
    expect(
      snapMovement(prepareSnap(layout(a, far), [a.ref], { x: 1, y: 1 }, view), { x: 98, y: 0 })
        .locks,
    ).toEqual({});
  });
  it('uses only visible references and creates two equal gap guides for both axes', () => {
    for (const axis of ['x', 'y'] as const) {
      const a = item('a', 0, 0, 20, 20),
        b = item('b', axis === 'x' ? 100 : 0, axis === 'y' ? 100 : 0, 20, 20);
      const moving = item('m', axis === 'x' ? -200 : 0, axis === 'y' ? -200 : 0, 20, 20);
      const session = prepareSnap(layout(a, b, moving), [moving.ref], { x: 1, y: 1 }, view);
      const raw: Point = { x: 0, y: 0, [axis]: 248 };
      const result = snapMovement(session, raw);
      expect(result.delta[axis]).toBe(250);
      expect(result.guides.filter((g) => g.kind === 'gap')).toHaveLength(2);
      const lengths = result.guides
        .filter((g) => g.kind === 'gap')
        .map((g) => g.end[axis] - g.start[axis]);
      expect(lengths).toEqual([30, 30]);
      const outside = prepareSnap(
        layout(a, b, moving),
        [moving.ref],
        { x: 1, y: 1 },
        { x: -400, y: -400, width: 100, height: 100 },
      );
      expect(snapMovement(outside, raw).guides).toEqual([]);
    }
  });
  it('aligns an arrow along a parallel wire without attracting it onto the wire', () => {
    const arrow: OutputLayoutItem = {
      ref: { id: 'a', part: 'annotation' },
      kind: 'arrow',
      movable: true,
      bounds: { x: 0, y: 30, width: 50, height: 8 },
      path: [
        { x: 0, y: 30 },
        { x: 50, y: 30 },
      ],
    };
    const data: OutputLayout = {
      items: [arrow],
      wireSegments: [
        { wireId: 'w', segmentIndex: 0, start: { x: 100, y: 0 }, end: { x: 200, y: 0 } },
      ],
    };
    const result = snapMovement(prepareSnap(data, [arrow.ref], { x: 1, y: 1 }, view), {
      x: 48,
      y: -28,
    });
    expect(result.delta).toEqual({ x: 50, y: -28 });
    expect(result.locks.y).toBeUndefined();
  });
});

describe('atomic output commands and persistence', () => {
  it('merges independent offsets, moves arrow children once, saves and undoes in one step', () => {
    const doc = fixture(),
      before = compileCircuit(doc);
    const commands = movementCommands(doc, [
      { ref: { id: 'R1', part: 'label' }, delta: { x: 10, y: 20 } },
      { ref: { id: 'R1', part: 'value' }, delta: { x: -5, y: 30 } },
      { ref: { id: 'arrow', part: 'label' }, delta: { x: 10, y: 0 } },
      { ref: { id: 'arrow', part: 'value' }, delta: { x: 0, y: 10 } },
    ]);
    expect(commands).toHaveLength(2);
    const applied = executeCommands(createHistory(doc), commands);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.history.past).toHaveLength(1);
    const next = applied.history.present;
    expect(next.components[0].properties).toMatchObject({ labelOffsetX: 10, answerOffsetX: -5 });
    expect(next.annotations[0].presentation).toMatchObject({
      labelOffsetX: 160,
      answerOffsetY: 10,
      answerText: '3/4 A',
    });
    expect(undo(applied.history).present).toEqual(doc);
    expect(redo(undo(applied.history)).present).toEqual(next);
    expect(parseDocument(serializeDocument(next))).toEqual({ ok: true, document: next });
    expect(compileCircuit(next)).toEqual(before);
    expect(createSvgExport(next).svg).not.toMatch(/output-guide|selection-overlay|snapEnabled/);
    const group = movementCommands(doc, [
      { ref: { id: 'arrow', part: 'annotation' }, delta: { x: 10, y: 20 } },
      { ref: { id: 'arrow', part: 'label' }, delta: { x: 10, y: 20 } },
    ]);
    expect(group).toHaveLength(1);
    expect(previewMovement(doc, group)!.annotations[0]).toMatchObject({
      position: { x: 110, y: 120 },
      presentation: doc.annotations[0].presentation,
    });
  });
  it('rejects an entire mixed batch when one command is forbidden and leaves no-op history empty', () => {
    const doc = fixture();
    doc.activity = { allowedCommands: ['SetProperties'], revealSteps: [] };
    const commands = movementCommands(doc, [
      { ref: { id: 'R1', part: 'label' }, delta: { x: 10, y: 0 } },
      { ref: { id: 'arrow', part: 'annotation' }, delta: { x: 10, y: 0 } },
    ]);
    const original = JSON.stringify(doc),
      history = createHistory(doc);
    expect(previewMovement(doc, commands)).toBeNull();
    expect(executeCommands(history, commands).ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(original);
    expect(history.past).toEqual([]);
    const zero = movementCommands(doc, [
      { ref: { id: 'R1', part: 'label' }, delta: { x: 0, y: 0 } },
    ]);
    expect(zero).toEqual([]);
    expect(executeCommands(history, zero)).toEqual({ ok: true, history });
  });
});
