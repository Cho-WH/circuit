import { describe, expect, it } from 'vitest';
import { emptyDocument, documentMigrator, type Point } from '../src/domain';
import { createComponent, wirePoints, compactWirePoints } from '../src/component-library';
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
  const fixture = () => documentMigrator.migrate(source);
  it.each<Command>([
    {type:'MoveWireSegment',wireId:'W2',segment:2,offset:40},
    {type:'MoveComponents',positions:{R1:{x:740,y:380}}},
    {type:'RotateComponents',ids:['R1']},
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
