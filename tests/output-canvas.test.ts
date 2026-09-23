// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputCanvas } from '../src/app/OutputCanvas';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createHistory, executeCommand } from '../src/editor';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Layout is covered in the real browser. Here client coordinates map 1:1 to document coordinates.
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform() { return this; }
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});


function setup() {
  let history=createHistory(layoutExample(examples[1].document));
  const dispatch=vi.fn((command: Parameters<typeof executeCommand>[1])=>{const result=executeCommand(history,command);if(!result.ok)return false;history=result.history;render();return true;});
  function render(){root.render(createElement(OutputCanvas,{document:history.present,result:{status:'solved',nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]},options:{monochrome:true},selected:['R1'],tool:'select',onSelect:()=>{},onTool:()=>{},dispatch,newId:()=> 'test-note'}));}
  act(render);
  const svg=host.querySelector('svg')!;
  Object.assign(svg,{getScreenCTM:()=>({a:1,inverse:()=>({})}),setPointerCapture:()=>{}});
  function pointer(target:Element,type:string,x:number,y:number,pointerType='mouse'){act(()=>{target.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType,button:0}));});}
  const label=()=>host.querySelector('[data-output-id="R1"][data-output-part="label"]')!;
  return {svg,label,pointer,dispatch,history:()=>history};
}
describe('output canvas direct manipulation',()=>{
  it.each(['mouse','touch'])('previews and commits one independent label drag with %s',pointerType=>{
    const c=setup(),before=c.label().innerHTML;
    c.pointer(c.label(),'pointerdown',400,200,pointerType);
    c.pointer(c.svg,'pointermove',460,170,pointerType);
    expect(c.label().innerHTML).not.toBe(before);expect(c.dispatch).not.toHaveBeenCalled();
    c.pointer(c.svg,'pointerup',470,160,pointerType);
    expect(c.dispatch).toHaveBeenCalledExactlyOnceWith({type:'SetProperties',id:'R1',properties:{labelOffsetX:70,labelOffsetY:-40}});
    expect(c.history().past).toHaveLength(1);
    expect(c.history().present.components.find(c=>c.id==='R1')!.properties.answerOffsetX).toBeUndefined();
  });
  it('discards canceled preview and does not commit on a late release',()=>{
    const c=setup(),before=c.label().innerHTML;
    c.pointer(c.label(),'pointerdown',400,200);
    c.pointer(c.svg,'pointermove',500,200);
    c.pointer(c.svg,'pointercancel',500,200);
    c.pointer(c.svg,'pointerup',500,200);
    expect(c.dispatch).not.toHaveBeenCalled();expect(c.label().innerHTML).toBe(before);
  });
  it('selects without moving the circuit or adding no-op history',()=>{
    const c=setup();c.pointer(c.label(),'pointerdown',400,200);c.pointer(c.svg,'pointerup',400,200);
    const body=host.querySelector('[data-output-id="R1"][data-output-part="body"]')!;
    c.pointer(body,'pointerdown',400,220);c.pointer(c.svg,'pointermove',500,300);c.pointer(c.svg,'pointerup',500,300);
    expect(c.dispatch).not.toHaveBeenCalled();
  });
});
