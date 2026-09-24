// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import source from '../fixtures/ux/wire-editing.json';
import { documentMigrator, emptyDocument, type CircuitDocument } from '../src/domain';
import { createHistory, executeCommands, undo, redo, type Command } from '../src/editor';
import { compactWirePoints, wirePoints, wireCrossings } from '../src/component-library';
import { compileCircuit } from '../src/connectivity';
import { branchHintEnd, connectionCommands, endpointTarget, useContextWiring, wiringTargets } from '../src/app/wiring';

const fixture = () => documentMigrator.migrate(source);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { if(root)act(()=>root!.unmount());host?.remove();root=undefined;vi.unstubAllGlobals(); });
function setup(doc=fixture()) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  host=window.document.createElement('div');window.document.body.append(host);root=createRoot(host);
  let history=createHistory(doc),selected:string[]=[],enabled=true,resetKey=0;
  let api!:ReturnType<typeof useContextWiring>;
  const commit=vi.fn((commands:readonly Command[])=>{const result=executeCommands(history,commands);if(!result.ok)return false;history=result.history;render();return true;});
  function Harness(){api=useContextWiring({document:history.present,enabled,tool:'select',selected,resetKey,commit,onSelect:id=>{selected=id?[id]:[];render();}});return null;}
  function render(){root!.render(createElement(Harness));}
  act(render);
  return {api:()=>api,history:()=>history,commit,run:(f:(state:typeof api)=>void)=>act(()=>f(api)),disable:()=>act(()=>{enabled=false;render();}),reset:()=>act(()=>{resetKey++;render();})};
}
describe('context wiring commands and state',()=>{
  it.each([false,true])('fixes legs in empty space, changes only the last preview and commits one undo step (touch=%s)',coarse=>{
    const doc=emptyDocument('waypoints');doc.junctions=[{id:'A',position:{x:0,y:0}},{id:'B',position:{x:400,y:0}}];
    const c=setup(doc);
    c.run(a=>a.tap({x:0,y:0},1,coarse));
    expect(c.api().start).toMatchObject({ref:{id:'A'}});
    c.run(a=>a.tap({x:100,y:100},1,coarse));
    c.run(a=>a.togglePosture());
    c.run(a=>a.tap({x:300,y:200},1,coarse));
    expect(c.api().corners).toEqual([{x:100,y:100},{x:300,y:200}]);
    expect(c.history().present).toEqual(doc);expect(c.history().past).toHaveLength(0);
    c.run(a=>a.back());expect(c.api().corners).toEqual([{x:100,y:100}]);
    c.run(a=>a.tap({x:300,y:200},1,coarse));
    c.run(a=>a.hover({x:400,y:0},1));const preview=c.api().previewPath;
    c.run(a=>a.tap({x:400,y:0},1,coarse));
    const next=c.history().present;
    expect(wirePoints(next,next.wires[0])).toEqual(preview);
    expect(preview).toEqual([{x:0,y:0},{x:0,y:100},{x:300,y:100},{x:300,y:200},{x:400,y:200},{x:400,y:0}]);
    expect(c.history().past).toHaveLength(1);expect(undo(c.history()).present).toEqual(doc);
    expect(redo(undo(c.history())).present).toEqual(next);expect(c.api().corners).toEqual([]);
  });
  it('preserves a custom route when both ends split an existing wire',()=>{
    const doc=emptyDocument('routed branch');doc.junctions=[{id:'A',position:{x:0,y:0}},{id:'B',position:{x:600,y:0}}];
    doc.wires=[{id:'W',start:{kind:'junction',id:'A'},end:{kind:'junction',id:'B'},waypoints:[]}];
    const route=[{x:100,y:200},{x:500,y:200}];
    const result=executeCommands(createHistory(doc),connectionCommands(doc,{kind:'wire',wireId:'W',point:{x:100,y:0}},{kind:'wire',wireId:'W',point:{x:500,y:0}},route));
    expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.history.present.wires.at(-1)!.waypoints).toEqual(route);
    expect(undo(result.history).present).toEqual(doc);
  });
  it('discards all draft legs on cancel or mode reset and never persists them',()=>{
    const c=setup();
    const begin=()=>{c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'terminal',id:'V1.a'})));c.run(a=>a.tap({x:40,y:40},1,false));};
    begin();expect(c.api().canBack).toBe(true);c.run(a=>a.cancel());expect(c.api().canBack).toBe(false);
    begin();c.reset();expect(c.api().previewPath).toEqual([]);expect(c.history().past).toHaveLength(0);expect(c.commit).not.toHaveBeenCalled();
  });
  it('commits a branch origin with its connection in one undo step, preserving every bend',()=>{
    const doc=fixture(),before=structuredClone(doc),history=createHistory(doc);
    const commands=connectionCommands(doc,{kind:'wire',wireId:'W2',point:{x:600,y:80}},endpointTarget(doc,{kind:'terminal',id:'V1.a'}));
    const result=executeCommands(history,commands);expect(result.ok).toBe(true);if(!result.ok)return;
    const next=result.history.present;
    expect(result.history.past).toHaveLength(1);
    const split=next.wires.filter(w=>w.id==='W2'||w.id===(commands[0] as {newWireId:string}).newWireId);
    const joined=[...wirePoints(next,split[0]),...wirePoints(next,split[1]).slice(1)];
    expect(compactWirePoints(joined)).toEqual(compactWirePoints(wirePoints(doc,doc.wires[1])));
    expect(undo(result.history).present).toEqual(doc);expect(redo(undo(result.history)).present).toEqual(next);
    expect(doc).toEqual(before);
  });
  it.each([100,500])('connects two points on either half of the same wire (end x=%s)',x=>{
    const doc=emptyDocument('same wire');doc.junctions=[{id:'A',position:{x:0,y:0}},{id:'B',position:{x:600,y:0}}];doc.wires=[{id:'W',start:{kind:'junction',id:'A'},end:{kind:'junction',id:'B'},waypoints:[]}];
    const result=executeCommands(createHistory(doc),connectionCommands(doc,{kind:'wire',wireId:'W',point:{x:300,y:0}},{kind:'wire',wireId:'W',point:{x,y:0}}));
    expect(result.ok).toBe(true);if(result.ok){expect(result.history.past).toHaveLength(1);expect(result.history.present.junctions).toHaveLength(4);}
  });
  it('rolls back the first split when the final connection is denied or invalid',()=>{
    const doc=fixture();doc.activity={allowedCommands:['AddJunction'],revealSteps:[]};
    const h=createHistory(doc),commands=connectionCommands(doc,{kind:'wire',wireId:'W2',point:{x:600,y:80}},endpointTarget(doc,{kind:'terminal',id:'V1.a'}));
    expect(executeCommands(h,commands)).toMatchObject({ok:false,diagnostics:[{code:'COMMAND_NOT_ALLOWED'}]});
    expect(h.present).toEqual(doc);expect(h.past).toHaveLength(0);
    doc.activity=null;const broken=[commands[0],{type:'ConnectWire',wire:{id:'bad',start:{kind:'terminal',id:'missing'},end:{kind:'terminal',id:'V1.a'},waypoints:[]}}] as Command[];
    expect(executeCommands(createHistory(doc),broken).ok).toBe(false);expect(doc.junctions).toHaveLength(0);
  });
  it('keeps the branch provisional and cancels without edits',()=>{
    const c=setup();c.run(a=>a.tap({x:600,y:80},1,true));expect(c.api().action?.label).toBe('여기서 가지 뻗기');
    c.run(a=>a.action!.run());expect(c.api().start?.kind).toBe('wire');expect(c.history().present.junctions).toHaveLength(0);
    c.run(a=>a.cancel());expect(c.commit).not.toHaveBeenCalled();expect(c.api().start).toBeNull();
  });
  it('requires selection then a later hover before mouse branching',()=>{
    const c=setup();c.run(a=>a.tap({x:600,y:80},1,false));expect(c.api().hint).toBeNull();expect(c.api().start).toBeNull();
    c.run(a=>a.hover({x:580,y:80},1));expect(c.api().action?.label).toBe('여기서 가지 뻗기');
    c.run(a=>a.tap({x:580,y:80},1,false));expect(c.api().start?.kind).toBe('wire');expect(c.commit).not.toHaveBeenCalled();
  });
  it('previews and explicitly confirms a touch destination on a wire',()=>{
    const c=setup();c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'terminal',id:'V1.a'}),true));
    c.run(a=>a.tap({x:600,y:80},1,true));expect(c.api().action?.label).toBe('여기에 연결');expect(c.commit).not.toHaveBeenCalled();
    c.run(a=>a.action!.run());expect(c.commit).toHaveBeenCalledTimes(1);expect(c.history().past).toHaveLength(1);
    const nets=compileCircuit(c.history().present).circuit.endpointToNet;expect(nets['V1.a']).toBe(nets['V1.b']);
  });
  it.each([false,true])('toggles a four-way crossing directly without selecting the node (touch=%s)',coarse=>{
    const c=setup();c.run(a=>a.hover({x:400,y:180},1));expect(c.api().crossingLabel).toBe('비연결');
    c.run(a=>a.tap({x:400,y:180},1,true));expect(wireCrossings(c.history().present)).toHaveLength(0);
    expect(c.api().crossingLabel).toBe('연결');expect(c.api().start).toBeNull();expect(c.api().action).toBeNull();
    const before=c.history().present,j=before.junctions[0];c.run(a=>a.tap(j.position,1,coarse));
    expect(c.api().start).toBeNull();expect(c.api().crossingLabel).toBe('비연결');
    expect(wireCrossings(c.history().present)).toHaveLength(1);expect(c.api().hint?.kind).toBe('crossing');
    expect(c.history().past).toHaveLength(2);
    c.run(a=>a.clearHint());expect(c.api().hint).toBeNull();
  });
  it('finishes active wiring at a connected crossing instead of disconnecting it',()=>{
    const c=setup();c.run(a=>a.tap({x:400,y:180},1,false));const j=c.history().present.junctions[0];
    c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'terminal',id:'V1.a'})));
    c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'junction',id:j.id})));
    expect(c.history().present.junctions.some(x=>x.id===j.id)).toBe(true);expect(wireCrossings(c.history().present)).toHaveLength(0);expect(c.api().start).toBeNull();
  });
  it('points the ghost branch perpendicular to the wire on the pointer side at a fixed screen length',()=>{
    const doc=fixture();
    const horizontal={kind:'wire' as const,wireId:'W1',point:{x:500,y:180}};
    expect(branchHintEnd(doc,horizontal,{x:505,y:170},.5)).toEqual({x:500,y:112});
    expect(branchHintEnd(doc,horizontal,{x:505,y:190},.5)).toEqual({x:500,y:248});
    const vertical={kind:'wire' as const,wireId:'W2',point:{x:800,y:220}};
    expect(branchHintEnd(doc,vertical,{x:790,y:225},1)).toEqual({x:766,y:220});
    expect(branchHintEnd(doc,vertical,{x:810,y:225},1)).toEqual({x:834,y:220});
  });
  it('does not offer disconnect on a T junction and cancels on mode changes',()=>{
    const c=setup();c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'terminal',id:'V1.a'}),true));c.run(a=>a.tap({x:600,y:80},1,true));c.run(a=>a.action!.run());
    const j=c.history().present.junctions[0];c.run(a=>a.activate(endpointTarget(c.history().present,{kind:'junction',id:j.id}),true));expect(c.api().action).toBeNull();
    c.disable();expect(c.api().start).toBeNull();expect(c.api().active).toBe(false);
  });
  it('uses screen-sized target margins and asks about overlapping touch endpoints',()=>{
    const doc=fixture();expect(wiringTargets(doc,{x:200+21/.5,y:296},.5,false)[0]).toMatchObject({kind:'endpoint',ref:{id:'V1.a'}});
    expect(wiringTargets(doc,{x:680,y:340},.4,false)).toEqual([]);
    expect(wiringTargets(doc,{x:636,y:340},.4,false)[0]).toMatchObject({kind:'endpoint',ref:{id:'R1.a'}});
    const doc2=emptyDocument('close');doc2.junctions=[{id:'A',position:{x:100,y:100}},{id:'B',position:{x:120,y:100}}];
    const c=setup(doc2);c.run(a=>a.tap({x:110,y:100},1,true));expect(c.api().choices).toHaveLength(2);expect(c.api().start).toBeNull();
    c.run(a=>a.selectChoice(a.choices[1]));expect(c.api().start).toMatchObject({ref:{id:'B'}});
  });
});
