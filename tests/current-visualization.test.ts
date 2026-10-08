import { requireDocument } from '../src/domain';
import * as q from '../src/rational';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import type { CircuitDocument, ComponentInstance, Point } from '../src/domain';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { wireCrossings, wireDisplayPoints } from '../src/component-library';
import {
  buildCurrentModel,
  buildCurrentPaths,
  buildCurrentTracks,
  buildPotentialModel,
  currentBand,
  currentSpacing,
  flowMarks,
  flowSpeed,
  flowJunctionOpacity,
  hasCurrentBridge,
} from '../src/visualization';
import { projectCurrentPaths } from '../src/potential-3d';

function fixture(name: string) {
  return requireDocument(JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8')).document) as CircuitDocument;
}
function solve(doc: CircuitDocument) {
  const compilation = compileCircuit(doc),
    result = solveCircuit(compilation.circuit);
  return { compilation, result, model: buildCurrentModel(doc, compilation, result) };
}
describe('current display physical invariants (VIS-006)', () => {
  it('preserves the 3 A split into 1 A and 2 A, and the source reference direction', () => {
    const doc = fixture('FIX-03-parallel'),
      snapshot = JSON.stringify(doc),
      { model } = solve(doc);
    const values = Object.fromEntries(model.samples.map((s) => [s.id, s.value]));
    for (const [id, amperes] of Object.entries({
      W1: 3,
      W2: 1,
      W3: 2,
      W4: 1,
      W5: 2,
      W6: 3,
      V1: -3,
    }))
      expect(values[id]).toMatchObject({ status: 'known', amperes: q.from(amperes) });
    expect(values.V1).toMatchObject({ from: { id: 'V1.p' }, to: { id: 'V1.n' } });
    expect(model.maxMagnitude).toEqual(q.from(3));
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(solve(doc).model).toEqual(model);
  });
  it('keeps current unchanged across layout, polarity storage order, and 3D height changes', () => {
    const doc = fixture('FIX-02-series'),
      before = solve(doc);
    doc.components.forEach((c) => {
      c.position.x += 137;
      c.rotation = 90;
    });
    doc.components[0].terminals.reverse();
    doc.wires[0].waypoints = [{ x: -750, y: 1900 }];
    const after = solve(doc);
    expect(after.model).toEqual(before.model);
    const flat = buildCurrentPaths(doc, after.model);
    for (const scale of [4, 18, 40]) {
      const model = buildPotentialModel(doc, after.compilation.circuit, after.result, { scale });
      const raised = buildCurrentPaths(doc, after.model, model);
      expect(raised.map((p) => p.sample)).toEqual(flat.map((p) => p.sample));
      for (const path of raised.filter((p) => p.sample.kind === 'wire'))
        expect(new Set(path.points.map((p) => p.z)).size).toBe(1);
    }
  });
  it('separates an indeterminate wire loop, failed analysis, zero, and tiny nonzero current', () => {
    const loop = fixture('FIX-03-parallel');
    loop.wires.push({ ...structuredClone(loop.wires[0]), id: 'duplicate' });
    expect(solve(loop).model.samples.find((s) => s.id === 'W1')?.value.status).toBe('undefined');
    expect(
      solve(fixture('FIX-08-conflicting-sources')).model.samples.every(
        (s) => s.value.status === 'unavailable',
      ),
    ).toBe(true);
    expect(solve(fixture('FIX-07-floating-network')).model.samples.every(s => s.value.status === 'known' && q.sign(s.value.amperes) === 0)).toBe(true);
    const open = fixture('FIX-05-open-switch'),
      a = solve(open);
    expect(a.model.samples.every((s) => s.value.status === 'known' && q.sign(s.value.amperes) === 0)).toBe(
      true,
    );
    expect(buildCurrentPaths(open, a.model).some((p) => p.id === 'S1')).toBe(false);
    const doc = fixture('FIX-03-parallel'),
      compiled = compileCircuit(doc),
      result = solveCircuit(compiled.circuit);
    result.branchCurrents.R1 = q.from(1e-18);
    expect(
      buildCurrentModel(doc, compiled, result).samples.find((s) => s.id === 'R1')?.value,
    ).toMatchObject({ status: 'known', amperes:q.from(1e-18) });
    delete result.branchCurrents.R1;
    expect(
      buildCurrentModel(doc, compiled, result).samples.find((s) => s.id === 'R1')?.value.status,
    ).toBe('unavailable');
  });
  it('requires an explicit bridge policy for every new device and never bridges voltmeters', () => {
    const component = fixture('FIX-02-series').components[1];
    expect(hasCurrentBridge({ ...component, type: 'voltmeter' })).toBe(false);
    expect(hasCurrentBridge({ ...component, type: 'diode' })).toBe(true);
    for (const type of ['capacitor'])
      expect(hasCurrentBridge({ ...component, type } as ComponentInstance)).toBe(false);
    expect(hasCurrentBridge({ ...component, type: 'switch', properties: { state: 'open' } })).toBe(
      false,
    );
  });
  it('shows linear width without inflating small values or hiding scale overflow', () => {
    expect(currentBand(2, 3).width).toBe(2 * currentBand(1, 3).width);
    expect(currentBand(-2, 3)).toEqual(currentBand(2, 3));
    expect(currentBand(0, 3)).toEqual({ state: 'zero', width: 0 });
    expect(currentBand(1e-18, 3)).toMatchObject({ state: 'subpixel' });
    expect(currentBand(1e-18, 3).width).toBeLessThan(1e-16);
    expect(currentBand(4, 3)).toEqual({ state: 'overflow', width: 0 });
    expect(currentBand(1, 3, 2).width).toBe(2 * currentBand(1, 3).width);
  });
});
describe('projected flow geometry', () => {
  const viewport = { width: 1000, height: 700 };
  it('shares potential colors between flat and raised current bands', () => {
    const doc = fixture('FIX-03-parallel'),
      { model, compilation, result } = solve(doc);
    for (const palette of ['spectrum', 'blue-yellow', 'red-yellow'] as const) {
      const potential = buildPotentialModel(doc, compilation.circuit, result, { palette });
      const colors = Object.fromEntries(
        Object.entries(potential.endpoints).map(([id, value]) => [id, value.color]),
      );
      const flat = buildCurrentPaths(doc, model, undefined, colors),
        raised = buildCurrentPaths(doc, model, potential, colors);
      for (const wire of doc.wires) {
        expect(flat.find((p) => p.id === wire.id)?.color).toBe(colors[wire.start.id]);
        expect(raised.find((p) => p.id === wire.id)?.color).toBe(colors[wire.start.id]);
      }
    }
  });
  it('joins a whole series circuit across wires, resistors and the reverse-signed source', () => {
    const doc = fixture('FIX-02-series'),
      { model } = solve(doc);
    const paths = buildCurrentPaths(doc, model).map((path) => ({ path, points: path.points }));
    const tracks = buildCurrentTracks(paths);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].closed).toBe(true);
    expect(tracks[0].startJunction).toBeUndefined();
    expect(tracks[0].endJunction).toBeUndefined();
    expect(new Set(tracks[0].ids)).toEqual(new Set(paths.map((p) => p.path.id)));
    expect(tracks[0].points[0]).toEqual(tracks[0].points.at(-1));
    expect(buildCurrentTracks([...paths].reverse())).toEqual(tracks);
  });
  it('keeps junction branches distinct with inverse-current spacing', () => {
    const doc = fixture('FIX-03-parallel'),
      { model } = solve(doc);
    const tracks = buildCurrentTracks(
      buildCurrentPaths(doc, model).map((path) => ({ path, points: path.points })),
    );
    expect(tracks).toHaveLength(3);
    expect(tracks.every((track) => !track.closed)).toBe(true);
    const a = tracks.find((t) => t.ids.includes('R1'))!,
      b = tracks.find((t) => t.ids.includes('R2'))!;
    expect(a.ids).toEqual(expect.arrayContaining(['W2', 'R1', 'W4']));
    expect(b.ids).toEqual(expect.arrayContaining(['W3', 'R2', 'W5']));
    expect(a).toMatchObject({ startJunction: 'JT', endJunction: 'JB' });
    expect(b).toMatchObject({ startJunction: 'JT', endJunction: 'JB' });
    expect(tracks.find((t) => t.ids.includes('V1'))).toMatchObject({
      startJunction: 'JB',
      endJunction: 'JT',
    });
    expect(currentSpacing(a.amperes, 3)).toBe(2 * currentSpacing(b.amperes, 3));
  });
  it('crosses component boundaries continuously without joining unrelated overlapping endpoints', () => {
    const path = (id: string, from: string, to: string, x: number, y: number) => ({
      path: {
        id,
        points: [],
        sample: {
          id,
          kind: 'wire' as const,
          value: {
            status: 'known' as const,
            amperes:q.from(1),
            from: { kind: 'terminal' as const, id: from },
            to: { kind: 'terminal' as const, id: to },
          },
        },
      },
      points: [
        { x, y: 0 },
        { x: y, y: 0 },
      ],
    });
    const joined = buildCurrentTracks([
      path('wire', 'a', 'R.a', 0, 100),
      path('resistor', 'R.a', 'R.b', 100, 180),
      path('wire2', 'R.b', 'b', 180, 300),
    ]);
    expect(joined).toHaveLength(1);
    expect(flowMarks(joined[0].points, 99, viewport, 1000)[0].x).toBe(99);
    expect(flowMarks(joined[0].points, 101, viewport, 1000)[0].x).toBe(101);
    const disconnected = buildCurrentTracks([
      path('one', 'a', 'b', 0, 100),
      path('two', 'different', 'c', 100, 200),
    ]);
    expect(disconnected).toHaveLength(2);
    expect(disconnected.every((t) => !t.startJunction && !t.endJunction)).toBe(true);
  });
  // Normal fade-in/out is covered through the renderer; retain the short-track edge case here.
  it('keeps overlapping junction fades bounded on short tracks', () => {
    expect(flowJunctionOpacity(5, 10, true, true)).toBeGreaterThan(0);
    expect(flowJunctionOpacity(5, 10, true, true)).toBeLessThan(1);
  });
  it('maintains speed across current densities on actual 2D and 3D resistor paths', () => {
    const doc = fixture('FIX-02-series'),
      { model, compilation, result } = solve(doc);
    const camera = new OrthographicCamera(-500, 500, 350, -350, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(500, -1000, 800);
    camera.lookAt(new Vector3(200, -200, 70));
    camera.updateMatrixWorld(true);
    const paths: Point[][] = [buildCurrentPaths(doc, model).find((p) => p.id === 'R1')!.points];
    for (const scale of [4, 18, 40]) {
      const potential = buildPotentialModel(doc, compilation.circuit, result, { scale });
      const raised = projectCurrentPaths(
        buildCurrentPaths(doc, model, potential),
        camera,
        viewport,
      );
      paths.push(raised.find((p) => p.path.id === 'R1')!.points);
    }
    for (const points of paths)
      for (const amperes of [1, 3]) {
        const spacing = currentSpacing(amperes, 3);
        const a = flowMarks(points, 0, viewport, spacing)[0],
          b = flowMarks(points, flowSpeed * 0.1, viewport, spacing)[0];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(3, 10);
      }
  });
  it('clips huge offscreen paths without spending work on invisible markers', () => {
    const marks = flowMarks(
      [
        { x: -1e9, y: 50 },
        { x: 1e9, y: 50 },
      ],
      0,
      viewport,
    );
    expect(marks.length).toBeLessThan(35);
    expect(marks.every((p) => p.x >= -8 && p.x <= 1008)).toBe(true);
    expect(
      flowMarks(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        0,
        viewport,
      ),
    ).toEqual([]);
  });
  it('follows the shared nonconnecting wire bridge instead of filling its gap', () => {
    const doc = fixture('FIX-03-parallel');
    doc.junctions = [
      { id: 'a', position: { x: 0, y: 50 } },
      { id: 'b', position: { x: 100, y: 50 } },
      { id: 'c', position: { x: 50, y: 0 } },
      { id: 'd', position: { x: 50, y: 100 } },
    ];
    doc.wires = [
      {
        id: 'h',
        start: { kind: 'junction', id: 'a' },
        end: { kind: 'junction', id: 'b' },
        waypoints: [],
      },
      {
        id: 'v',
        start: { kind: 'junction', id: 'c' },
        end: { kind: 'junction', id: 'd' },
        waypoints: [],
      },
    ];
    const points = wireDisplayPoints(doc, doc.wires[0], wireCrossings(doc));
    expect(points.find((p) => Math.abs(p.x - 50) < 1e-6)?.y).toBe(43);
    expect(doc.wires[0].waypoints).toEqual([]);
  });
});
