// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { MeasurementPanel } from '../src/app/MeasurementPanel';
import { MeasurementLayer, type MeasurementAnchor } from '../src/app/measurement-tools';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import type { CircuitDocument } from '../src/domain';
const document = JSON.parse(readFileSync('fixtures/FIX-02-series.json','utf8')).document as CircuitDocument;
const compilation = compileCircuit(document), result = solveCircuit(compilation.circuit);
const noop = () => {};
const canvasProps: CanvasProps = {document,selected:[],tool:'probe',placement:null,onSelect:noop,onMove:noop,onPlace:noop,onEndpoint:noop,onWire:noop,onValue:noop,onSwitch:noop,onBackground:noop};
function panel(red:string,black:string) {
  return renderToStaticMarkup(createElement(MeasurementPanel, {document,compilation,result,active:true,kind:'voltage',onKind:noop,branchId:'',onBranch:noop,red,black,activeProbe:'red',onActiveProbe:noop,anchors:{red:null,black:null,current:null},currentReading:{ok:false,diagnostics:[]},onReset:noop,onSwap:noop,children:null}));
}
describe('measurement workspace',()=>{
  it('places from a touch tap on the canvas and suppresses placement after panning',()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
    vi.stubGlobal('DOMPoint',class {constructor(public x:number,public y:number){} matrixTransform(){return this;}});
    const host=globalThis.document.createElement('div');globalThis.document.body.append(host);const root=createRoot(host),onPlace=vi.fn();
    const doc=layoutExample(examples.find(e=>e.id==='FIX-03')!.document);
    try {
      act(()=>root.render(createElement(CircuitCanvas,{...canvasProps,document:doc,readOnly:true,measurement:{tool:'current',anchors:{red:null,black:null,current:null},onPlace,onActivate:noop}})));
      const svg=host.querySelector<SVGSVGElement>('svg')!;
      svg.getScreenCTM=()=>({inverse:()=>({})}) as DOMMatrix;svg.setPointerCapture=vi.fn();svg.hasPointerCapture=()=>false;
      const pointer=(type:string,x:number,y:number)=>act(()=>svg.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2,pointerType:'touch',button:0,clientX:x,clientY:y})));
      pointer('pointerdown',400,200);pointer('pointerup',400,200);
      act(()=>svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:400,clientY:200})));
      expect(onPlace).toHaveBeenLastCalledWith('current',expect.objectContaining({id:'W2'}));onPlace.mockClear();
      pointer('pointerdown',400,200);pointer('pointermove',450,200);pointer('pointerup',450,200);
      act(()=>svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:450,clientY:200})));
      expect(onPlace).not.toHaveBeenCalled();
    } finally {act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
  it('moves a sensor with touch, cancels safely, and accepts the next ordinary tap',()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const host=globalThis.document.createElement('div');globalThis.document.body.append(host);const root=createRoot(host);
    const doc=layoutExample(examples.find(e=>e.id==='FIX-03')!.document),onPlace=vi.fn(),onActivate=vi.fn();
    const anchors={red:null,black:null,current:{kind:'component',id:'R1'} as MeasurementAnchor};
    const pointer=(el:Element,type:string,x:number,y:number)=>act(()=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'touch',button:0,clientX:x,clientY:y})));
    try {
      act(()=>root.render(createElement('svg',null,createElement(MeasurementLayer,{document:doc,tool:'current',anchors,onPlace,onActivate,scale:1,bounds:{x:0,y:0,width:1000,height:700},point:(x,y)=>({x,y})}))));
      const handle=host.querySelector<SVGGElement>('[data-measurement-handle]')!;
      handle.setPointerCapture=vi.fn();handle.hasPointerCapture=()=>false;
      pointer(handle,'pointerdown',525,180);pointer(handle,'pointermove',400,360);pointer(handle,'pointerup',400,360);
      expect(onPlace).toHaveBeenLastCalledWith('current',expect.objectContaining({kind:'wire',id:'W3'}));
      onPlace.mockClear();
      pointer(handle,'pointerdown',525,180);pointer(handle,'pointermove',400,200);pointer(handle,'pointercancel',400,200);
      expect(onPlace).not.toHaveBeenCalled();
      const surface=host.querySelector('.measurement-surface')!;
      pointer(surface,'pointerdown',400,200);act(()=>surface.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:400,clientY:200})));
      expect(onPlace).toHaveBeenLastCalledWith('current',expect.objectContaining({kind:'wire',id:'W2'}));
      onPlace.mockClear();pointer(handle,'pointerdown',525,180);pointer(handle,'pointerup',525,180);
      expect(onPlace).not.toHaveBeenCalled(); // Selecting an existing handle does not detach it.
    } finally {act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
  it('keeps probe targets accessible while removing value-edit actions from the measurement canvas',()=>{
    const measured=renderToStaticMarkup(createElement(CircuitCanvas,{...canvasProps,readOnly:true}));
    const edited=renderToStaticMarkup(createElement(CircuitCanvas,{...canvasProps,tool:'select'}));
    expect(measured).toContain('aria-label="측정 회로"');
    expect(measured).toContain('aria-label="단자 R1.a"');
    expect(measured).not.toContain('aria-label="R1 값 편집"');
    expect(edited).toContain('aria-label="R1 값 편집"');
  });
  it('points an empty measurement workspace back to editing without referring to a hidden library',()=>{
    const empty={...document,components:[],wires:[],junctions:[],annotations:[],referenceNode:null};
    const html=renderToStaticMarkup(createElement(CircuitCanvas,{...canvasProps,document:empty,readOnly:true}));
    expect(html).toContain('측정할 회로가 없습니다');
    expect(html).not.toContain('왼쪽에서 부품을 선택');
  });
  it('keeps recording disabled until both voltage probes are connected',()=>{
    const html=panel('R1.a','');
    expect(html).toMatch(/<output[^>]*>— V<\/output>/);
    expect(html).toMatch(/<button[^>]*aria-label="측정값 기록"[^>]*disabled/);
  });
  it('shows the signed physical reading in the prominent result for either probe order',()=>{
    expect(panel('R1.a','R1.b')).toMatch(/<output[^>]*>3 V<\/output>/);
    expect(panel('R1.b','R1.a')).toMatch(/<output[^>]*>-3 V<\/output>/);
  });
  it('opens records on first capture, preserves them across mode switches, without exposing setup forms',()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const host=globalThis.document.createElement('div');globalThis.document.body.append(host);
    const root=createRoot(host);
    const render=(active:boolean)=>root.render(createElement(MeasurementPanel,{document,compilation,result,active,kind:'voltage',onKind:noop,branchId:'',onBranch:noop,red:'R1.a',black:'R1.b',activeProbe:'red',onActiveProbe:noop,anchors:{red:null,black:null,current:null},currentReading:{ok:false,diagnostics:[]},onReset:noop,onSwap:noop,children:null,toolbarEnd:createElement('button',null,'상세 설정')}));
    try {
      act(()=>render(true));
      const notebook=host.querySelector<HTMLElement>('[aria-label="실험 기록"]')!;
      expect(notebook.hidden).toBe(true);
      expect(host.querySelector('button[aria-controls="measurement-notebook"]')?.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('.probe-location')).toBeNull();
      expect(host.querySelector('.record-retention')).toBeNull();
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      expect(notebook.hidden).toBe(false);
      expect(notebook.textContent).toContain('3 V');
      expect(notebook.textContent).toContain('기록 저장 (CSV)');
      expect(notebook.textContent).toContain('창을 닫기 전에 기록을 저장하세요');
      act(()=>render(false));act(()=>render(true));
      expect(notebook.querySelectorAll('tbody tr')).toHaveLength(1);
      act(()=>host.querySelector<HTMLButtonElement>('[aria-controls="measurement-notebook"]')!.click());
      expect(notebook.hidden).toBe(true);
      expect(host.querySelector('header')?.textContent).toContain('상세 설정');
    } finally {act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
});
