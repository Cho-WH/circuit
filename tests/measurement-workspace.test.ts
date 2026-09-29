// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { MeasurementPanel } from '../src/app/MeasurementPanel';
import { MeasurementLayer, type MeasurementAnchor } from '../src/app/measurement-tools';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { loadMeasurementNotebook } from '../src/persistence';
import { probeCurrent } from '../src/measurement';
import { anchorPose } from '../src/app/measurement-tools';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import type { CircuitDocument } from '../src/domain';
const document = JSON.parse(readFileSync('fixtures/FIX-02-series.json','utf8')).document as CircuitDocument;
const compilation = compileCircuit(document), result = solveCircuit(compilation.circuit);
const noop = () => {};
const canvasProps: CanvasProps = {document,selected:[],tool:'probe',placement:null,onSelect:noop,onMove:noop,onPlace:noop,onEndpoint:noop,onWire:noop,onValue:noop,onSwitch:noop,onBackground:noop};
function panel(red:string,black:string) {
  return renderToStaticMarkup(createElement(MeasurementPanel, {document,compilation,result,active:true,kind:'voltage',enabled:true,isolated:false,onExit:noop,panel:null,onPanel:noop,red,black,activeProbe:'red',onActiveProbe:noop,anchors:{red:{kind:'endpoint',id:'R1.a',endpointKind:'terminal'},black:{kind:'endpoint',id:'R1.b',endpointKind:'terminal'},current:null},currentReading:{ok:false,diagnostics:[]},onReset:noop,onSwap:noop,children:null}));
}
describe('measurement workspace',()=>{
  beforeEach(()=>localStorage.clear());
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
    expect(measured).toContain('aria-label="R1 · 왼쪽 단자"');
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
  it.each(['voltage', 'resistance', 'current'] as const)('restores exact %s wire positions after recording and remount', (kind) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = globalThis.document.createElement('div');
    globalThis.document.body.append(host);
    let root = createRoot(host);
    const doc = structuredClone(document);
    doc.wires[0].waypoints = [{x: -50, y: 80}, {x: 90, y: 80}];
    const anchors = {
      red: {kind:'wire',id:'W1',segment:1,t:0.23} as MeasurementAnchor,
      black: {kind:'wire',id:'W2',segment:0,t:0.81} as MeasurementAnchor,
      current: {kind:'wire',id:'W1',segment:1,t:0.68} as MeasurementAnchor,
    };
    const expected = kind === 'current' ? {red:null,black:null,current:anchors.current} : {red:anchors.red,black:anchors.black,current:null};
    const positions = Object.entries(expected).filter(([, anchor]) => anchor).map(([tool, anchor]) => [tool, anchorPose(doc, anchor)!.point] as const);
    const render = () => root.render(createElement(MeasurementPanel, {document:doc,compilation,result,active:true,kind,enabled:true,isolated:kind==='resistance',onExit:noop,panel:'records',onPanel:noop,red:'V1.p',black:'R1.b',activeProbe:'red',onActiveProbe:noop,anchors,currentReading:probeCurrent(doc,compilation,result,{kind:'wire',id:'W1'}),onReset:noop,onSwap:noop,children:null}));
    try {
      act(render);
      act(() => host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      expect(loadMeasurementNotebook().entries[0].anchors).toEqual(expected);
      // Moving the live probe or circuit after recording must not move the saved position.
      if (anchors.red.kind === 'wire') anchors.red.t = 0.9;
      if (anchors.current.kind === 'wire') anchors.current.t = 0.1;
      doc.wires[0].waypoints[0].y += 100;
      act(() => root.unmount()); root = createRoot(host); act(render);
      act(() => host.querySelector<HTMLButtonElement>('.record-location')!.click());
      const preview = globalThis.document.querySelector('[aria-label="기록 당시 회로"][role="dialog"]')!;
      expect(preview).not.toBeNull();
      for (const [tool, point] of positions)
        expect(preview.querySelector(`[data-measurement-handle="${tool}"]`)?.getAttribute('transform')).toContain(`translate(${point.x},${point.y})`);
    } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });
  it('captures without opening the table and restores edited notes after remount',()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const host=globalThis.document.createElement('div');globalThis.document.body.append(host);
    let root=createRoot(host);
    let panelState: import('../src/app/AnalysisTools').AnalysisPanel = null;
    const onPanel=(next: typeof panelState)=>{panelState=next;render(true);};
    const render=(active:boolean)=>root.render(createElement(MeasurementPanel,{document,compilation,result,active,kind:'voltage',enabled:true,isolated:false,onExit:noop,panel:panelState,onPanel,red:'R1.a',black:'R1.b',activeProbe:'red',onActiveProbe:noop,anchors:{red:{kind:'endpoint',id:'R1.a',endpointKind:'terminal'},black:{kind:'endpoint',id:'R1.b',endpointKind:'terminal'},current:null},currentReading:{ok:false,diagnostics:[]},onReset:noop,onSwap:noop,children:null}));
    try {
      act(()=>render(true));
      const notebook=host.querySelector<HTMLElement>('[aria-label="측정표"]')!;
      expect(notebook.hidden).toBe(true);
      expect(host.querySelector('.notebook-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('.probe-location')).toBeNull();
      expect(host.querySelector('.record-retention')).toBeNull();
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      expect(notebook.hidden).toBe(true);
      act(()=>host.querySelector<HTMLButtonElement>('.notebook-toggle')!.click());
      expect(notebook.hidden).toBe(false);
      expect(notebook.textContent).toContain('3 V');
      expect(notebook.textContent).toContain('표 복사');
      expect(notebook.querySelector('[aria-label="예상한 측정값"]')).toBeNull();
      const input=notebook.querySelector<HTMLInputElement>('[aria-label="기록 1 메모"]')!;
      act(()=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'전압 비교');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      act(()=>render(false));act(()=>render(true));
      expect(notebook.querySelectorAll('.measurement-record')).toHaveLength(1);
      act(()=>host.querySelector<HTMLButtonElement>('.notebook-toggle')!.click());
      expect(notebook.hidden).toBe(true);
      act(()=>root.unmount()); root=createRoot(host); act(()=>render(true));
      act(()=>host.querySelector<HTMLButtonElement>('.notebook-toggle')!.click());
      expect(host.querySelector<HTMLInputElement>('[aria-label="기록 1 메모"]')?.value).toBe('전압 비교');
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="기록 1 삭제"]')!.click());
      expect(host.querySelector('.measurement-record')).toBeNull();
      const reset = () => [...host.querySelectorAll<HTMLButtonElement>('.record-actions button')].find(b => b.textContent === '기록 초기화')!;
      expect(reset().disabled).toBe(true);
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      expect(host.querySelectorAll('.measurement-record')).toHaveLength(2);
      act(()=>reset().click());
      expect(host.querySelectorAll('.measurement-record')).toHaveLength(0);
      expect(reset().disabled).toBe(true);
      expect(host.querySelector('output[aria-label="측정값"]')?.textContent).toBe('3 V');
      expect(loadMeasurementNotebook().entries).toEqual([]);
      act(()=>root.unmount()); root=createRoot(host); act(()=>render(true));
      expect(host.querySelector('.measurement-record')).toBeNull();
    } finally {act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
});
