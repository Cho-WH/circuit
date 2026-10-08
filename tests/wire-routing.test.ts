import { describe, expect, it } from 'vitest';
import { emptyDocument, requireDocument, type Point, type CircuitDocument } from '../src/domain';
import { createComponent, terminalPosition, endpointPosition, wirePoints, compactWirePoints } from '../src/component-library';
import { orthogonalRoute, stretchWire, shiftWireSegment } from '../src/wire-geometry';
import { previewCommand, executeCommand, executeCommands, createHistory, undo, redo, type Command } from '../src/editor';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { serializeDocument, parseDocument } from '../src/persistence';
import source from '../fixtures/ux/wire-editing.json';

const points = (...pairs: number[][]): Point[] => pairs.map(([x, y]) => ({ x, y }));
function orthogonal(path: Point[]) {
  expect(path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  for (let i = 1; i < path.length; i++) expect(path[i].x === path[i-1].x || path[i].y === path[i-1].y).toBe(true);
}
const loop = points([0,0], [80,0], [80,120], [200,120], [200,0], [280,0]);

describe('local wire geometry rules', () => {
  it('draws only the unfinished leg using the chosen posture', () => {
    expect(orthogonalRoute({x:10,y:20}, {x:90,y:80}, 'HV')).toEqual(points([10,20],[90,20],[90,80]));
    expect(orthogonalRoute({x:10,y:20}, {x:90,y:80}, 'VH')).toEqual(points([10,20],[10,80],[90,80]));
    expect(orthogonalRoute({x:10,y:20}, {x:10,y:80}, 'HV')).toEqual(points([10,20],[10,80]));
  });
  it('preserves the middle and moves only the adjacent corner, with no mutation', () => {
    const before = structuredClone(loop);
    const next = stretchWire(loop, {x:20,y:40}, loop.at(-1)!);
    expect(next).toEqual(points([20,40],[80,40],[80,120],[200,120],[200,0],[280,0]));
    expect(loop).toEqual(before);
    expect(stretchWire(loop, loop[0], loop.at(-1)!)).toEqual(loop);
  });
  it('translates the whole route when both endpoints have the same displacement', () => {
    expect(stretchWire(loop, {x:40,y:-20}, {x:320,y:-20})).toEqual(loop.map(p => ({x:p.x+40,y:p.y-20})));
  });
  it('handles straight and L paths with fixed formulas', () => {
    expect(stretchWire([], {x:0,y:0}, {x:40,y:40})).toEqual(points([0,0],[0,40],[40,40]));
    expect(stretchWire(points([0,0]), {x:0,y:0}, {x:0,y:0})).toEqual(points([0,0]));
    expect(stretchWire(points([0,0],[200,0]), {x:0,y:40}, {x:200,y:0})).toEqual(points([0,40],[100,40],[100,0],[200,0]));
    expect(stretchWire(points([0,0],[100,0],[100,100]), {x:20,y:40}, {x:180,y:160})).toEqual(points([20,40],[180,40],[180,160]));
  });
  it('is orthogonal, endpoint-exact and direction-independent across crossed, collapsed and negative coordinates', () => {
    const paths = [points([0,0],[200,0]), points([0,0],[0,200]), points([0,0],[100,0],[100,100]), loop];
    for (const path of paths) for (const dx of [-300,0,80,200]) for (const dy of [-120,0,40,120]) {
      const a = {x:path[0].x+dx,y:path[0].y+dy}, b = {x:path.at(-1)!.x-dy,y:path.at(-1)!.y-dx};
      const next = stretchWire(path,a,b);
      orthogonal(next); expect(next[0]).toEqual(a); expect(next.at(-1)).toEqual(b);
      expect(compactWirePoints(stretchWire([...path].reverse(),b,a).reverse())).toEqual(compactWirePoints(next));
    }
  });
  it('offsets a segment locally and adds connectors only at electrical endpoints', () => {
    expect(shiftWireSegment(loop,2,40)).toEqual(points([0,0],[80,0],[80,160],[200,160],[200,0],[280,0]));
    expect(shiftWireSegment(points([0,0],[200,0]),0,40)).toEqual(points([0,0],[0,40],[200,40],[200,0]));
    for (let segment=0;segment<loop.length-1;segment++) for(const offset of [-200,-120,0,40,120]) {
      const next=shiftWireSegment(loop,segment,offset)!;
      orthogonal(next); expect(next[0]).toEqual(loop[0]); expect(next.at(-1)).toEqual(loop.at(-1));
    }
    expect(shiftWireSegment(loop,99,20)).toBeNull();
    expect(shiftWireSegment(loop,0,NaN)).toBeNull();
  });
});

describe('wire editing commands and invariants', () => {
  const fixture = () => requireDocument(source);
  it.each<Command>([
    {type:'MoveWireSegment',wireId:'W2',segment:2,offset:40},
    {type:'MoveComponents',positions:{R1:{x:740,y:380}}},
  ])('shares preview, commit, undo and JSON geometry without changing connectivity: $type', command => {
    const doc=fixture(),before=structuredClone(doc),history=createHistory(doc);
    const result=executeCommand(history,command);expect(result.ok).toBe(true);if(!result.ok)return;
    const next=result.history.present;
    expect(previewCommand(doc,command)).toEqual({ok:true,document:next});
    expect(compileCircuit(next)).toEqual(compileCircuit(doc));
    expect(solveCircuit(compileCircuit(next).circuit)).toEqual(solveCircuit(compileCircuit(doc).circuit));
    expect(next.wires.map(w=>({id:w.id,start:w.start,end:w.end}))).toEqual(doc.wires.map(w=>({id:w.id,start:w.start,end:w.end})));
    next.wires.forEach(w=>orthogonal(wirePoints(next,w)));
    expect(next.junctions).toEqual(doc.junctions);
    expect(parseDocument(serializeDocument(next))).toMatchObject({ok:true,document:next});
    expect(undo(result.history).present).toEqual(doc);
    expect(redo(undo(result.history)).present).toEqual(next);
    expect(doc).toEqual(before);
  });
  it('stops at a junction and leaves its other branches byte-for-byte unchanged', () => {
    const doc=emptyDocument('local');doc.components=[createComponent('resistor','R',{x:-44,y:0})];
    doc.junctions=[{id:'J',position:{x:100,y:100}},{id:'K',position:{x:200,y:100}}];
    doc.wires=[{id:'A',start:{kind:'terminal',id:'R.b'},end:{kind:'junction',id:'J'},waypoints:[{x:100,y:0}]},
      {id:'B',start:{kind:'junction',id:'J'},end:{kind:'junction',id:'K'},waypoints:[]}];
    const preview=previewCommand(doc,{type:'MoveComponents',positions:{R:{x:-24,y:40}}});
    expect(preview.ok).toBe(true);if(!preview.ok)return;
    expect(wirePoints(preview.document,preview.document.wires[0])).toEqual(points([20,40],[100,40],[100,100]));
    expect(preview.document.wires[1]).toEqual(doc.wires[1]);expect(preview.document.junctions).toEqual(doc.junctions);
  });
  it('keeps no-op segment edits out of history and enforces command permissions', () => {
    const doc=fixture(),history=createHistory(doc);
    const noop:Command={type:'MoveWireSegment',wireId:'W1',segment:0,offset:0};
    expect(executeCommand(history,noop)).toEqual({ok:true,history});
    expect(executeCommands(history,[noop])).toEqual({ok:true,history});
    doc.activity={allowedCommands:['MoveComponents'],revealSteps:[]};
    expect(previewCommand(doc,noop)).toMatchObject({ok:false,diagnostics:[{code:'COMMAND_NOT_ALLOWED'}]});
    expect(executeCommands(createHistory(doc),[noop])).toMatchObject({ok:false,diagnostics:[{code:'COMMAND_NOT_ALLOWED'}]});
  });
  it.each([
    {type:'MoveWireSegment',wireId:'missing',segment:0,offset:20},
    {type:'MoveWireSegment',wireId:'W1',segment:-1,offset:20},
    {type:'MoveWireSegment',wireId:'W1',segment:0,offset:Infinity},
  ] as Command[])('rejects invalid segment changes without partial edits', command => {
    const history=createHistory(fixture()),before=structuredClone(history);
    expect(executeCommand(history,command).ok).toBe(false);expect(history).toEqual(before);
  });
});


describe('rotation with stationary wiring', () => {
  function wired(kind: Parameters<typeof createComponent>[0] = 'diode', rotation: 0 | 90 | 180 | 270 = 0) {
    const doc = emptyDocument('rotation');
    const component = createComponent(kind, 'C', { x: 200, y: 200 });
    component.rotation = rotation;
    doc.components = [component];
    component.terminals.forEach((terminal, index) => {
      const point = terminalPosition(component, index);
      doc.junctions.push({ id: 'end' + index, position: { x: point.x + 200, y: point.y + 200 } });
      doc.wires.push({ id: 'wire' + index, start: { kind: 'terminal', id: terminal.id }, end: { kind: 'junction', id: 'end' + index }, waypoints: [{ x: point.x, y: point.y + 200 }] });
    });
    return doc;
  }
  const rotate: Command = { type: 'RotateComponents', ids: ['C'] };
  function turn(doc: CircuitDocument, command = rotate) {
    const result = executeCommand(createHistory(doc), command);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.history;
  }
  const paths = (doc: CircuitDocument) => doc.wires.map(w => wirePoints(doc, w));

  it.each(['resistor', 'resistive-load', 'switch', 'ammeter', 'voltmeter', 'dc-voltage-source', 'diode'] as const)(
    'leaves %s wires fixed and reverses their terminal connections at 180 degrees, including after reload', kind => {
      for (const rotation of [0, 90, 180, 270] as const) {
        const doc = wired(kind, rotation), before = structuredClone(doc);
        const first = turn(doc), detached = first.present;
        expect(paths(detached)).toEqual(paths(doc));
        expect(detached.wires.map(w => w.waypoints)).toEqual(doc.wires.map(w => w.waypoints));
        expect(detached.wires.every(w => w.start.kind === 'junction')).toBe(true);
        expect(previewCommand(doc, rotate)).toEqual({ ok: true, document: detached });
        expect(undo(first).present).toEqual(doc);
        expect(redo(undo(first)).present).toEqual(detached);
        const loaded = parseDocument(serializeDocument(detached));
        expect(loaded.ok).toBe(true); if (!loaded.ok) continue;
        const second = turn(loaded.document), reversed = second.present;
        expect(paths(reversed)).toEqual(paths(doc));
        expect(reversed.wires.map(w => w.start)).toEqual([...doc.wires].reverse().map(w => w.start));
        expect(reversed.junctions).toEqual(doc.junctions);
        const nets = compileCircuit(reversed).circuit.endpointToNet;
        expect(nets['C.a']).toBe(nets.end1);
        expect(nets['C.b']).toBe(nets.end0);
        expect(nets.end0).not.toBe(nets.end1);
        expect(undo(second).present).toEqual(detached);
        expect(turn(turn(reversed).present).present).toEqual(doc);
        expect(doc).toEqual(before);
      }
    },
  );

  it('preserves branches, ground and annotation positions through detach and reattach', () => {
    const doc = wired();
    doc.wires.push({ id: 'branch', start: { ...doc.wires[0].start }, end: { ...doc.wires[0].end }, waypoints: [{ x: 0, y: 200 }, { x: 0, y: 400 }] });
    doc.referenceNode = { ...doc.wires[0].start };
    doc.annotations = [{ id: 'note', kind: 'note', anchor: { ...doc.wires[1].start }, content: 'test', visibility: 'always' }];
    const first = turn(doc).present, second = turn(first).present;
    for (const next of [first, second]) {
      expect(paths(next)).toEqual(paths(doc));
      expect(next.wires[2].start).toEqual(next.wires[0].start);
      expect(endpointPosition(next, next.referenceNode!)).toEqual(endpointPosition(doc, doc.referenceNode));
      expect(endpointPosition(next, next.annotations[0].anchor!)).toEqual(endpointPosition(doc, doc.annotations[0].anchor!));
    }
    expect(second.referenceNode).toEqual({ kind: 'terminal', id: 'C.b' });
    expect(second.annotations[0].anchor).toEqual({ kind: 'terminal', id: 'C.a' });
  });

  it('reconnects only exact, unambiguous endpoints and never a crossed wire segment', () => {
    const first = turn(wired()).present;
    const ambiguous = structuredClone(first);
    const end = ambiguous.junctions.find(j => j.id === ambiguous.wires[0].start.id)!;
    ambiguous.junctions.push({ id: 'overlap', position: { ...end.position } });
    expect(turn(ambiguous).present.wires[0].start).toEqual(ambiguous.wires[0].start);
    const occupied = structuredClone(first);
    occupied.components.push(createComponent('resistor', 'other', { x: end.position.x + 44, y: end.position.y }));
    expect(turn(occupied).present.wires[0].start).toEqual(occupied.wires[0].start);
    const moved = executeCommand(createHistory(first), { type: 'MoveComponents', positions: { C: { x: 201, y: 200 } } });
    expect(moved.ok).toBe(true); if (!moved.ok) return;
    const next = turn(moved.history.present).present;
    expect(next.wires).toEqual(first.wires);
    expect(paths(next)).toEqual(paths(first));
    const crossing = emptyDocument('crossing');
    crossing.components = [createComponent('resistor', 'C', { x: 200, y: 200 })];
    crossing.junctions = [{ id: 'a', position: { x: 0, y: 156 } }, { id: 'b', position: { x: 400, y: 156 } }];
    crossing.wires = [{ id: 'w', start: { kind: 'junction', id: 'a' }, end: { kind: 'junction', id: 'b' }, waypoints: [] }];
    expect(turn(crossing).present.wires).toEqual(crossing.wires);
    expect(turn(crossing).present.junctions).toEqual(crossing.junctions);
  });

  it('keeps all SPDT wire paths and distinct contacts through a full turn', () => {
    const doc = wired('changeover-switch');
    let next = doc;
    for (let i = 0; i < 4; i++) {
      next = turn(next).present;
      expect(paths(next)).toEqual(paths(doc));
      const nets = compileCircuit(next).circuit.endpointToNet;
      expect(new Set(doc.junctions.map(j => nets[j.id])).size).toBe(3);
    }
    expect(next).toEqual(doc);
  });

  it('rotates a group in document order and preserves wires between rotated components', () => {
    const doc = wired();
    doc.components.push(createComponent('resistor', 'R', { x: 600, y: 200 }));
    doc.wires[0].end = { kind: 'terminal', id: 'R.a' };
    const command: Command = { type: 'RotateComponents', ids: ['R', 'C'] };
    const first = turn(doc, command).present;
    expect(first).toEqual(turn(doc, { ...command, ids: ['C', 'R'] }).present);
    const second = turn(first, command).present;
    expect(paths(first)).toEqual(paths(doc));
    expect(paths(second)).toEqual(paths(doc));
    expect(second.wires[0]).toMatchObject({ start: { id: 'C.b' }, end: { id: 'R.b' } });
  });

  it('uses rotation permission for the atomic edit and leaves no trace on rejection', () => {
    const doc = wired();
    doc.activity = { allowedCommands: ['RotateComponents'], revealSteps: [] };
    expect(turn(doc).past).toEqual([doc]);
    doc.activity.allowedCommands = ['MoveComponents'];
    const history = createHistory(doc), before = structuredClone(history);
    expect(executeCommand(history, rotate)).toMatchObject({ ok: false, diagnostics: [{ code: 'COMMAND_NOT_ALLOWED' }] });
    expect(history).toEqual(before);
  });
});
