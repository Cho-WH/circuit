// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { examples } from '../src/fixtures';
import { compileCircuit } from '../src/connectivity';
import { solveCircuit } from '../src/simulation';
import { createComponent } from '../src/component-library';
import { layoutExample } from '../src/app/examples';
import { MeasurementPanel } from '../src/app/MeasurementPanel';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import type { CircuitDocument } from '../src/domain';

const noop=()=>{};
const example=(id:string)=>layoutExample(examples.find(e=>e.id===id)!.document);
function props(document:CircuitDocument,red:string,black:string,kind:'voltage'|'resistance'='resistance') {
  const compilation=compileCircuit(document);
  return {document,compilation,result:solveCircuit(compilation.circuit),active:true,kind,enabled:true,isolated:kind==='resistance',onExit:noop,panel:null,onPanel:noop,red,black,activeProbe:'red' as const,onActiveProbe:noop,anchors:{red:null,black:null,current:null},currentReading:{ok:false as const,diagnostics:[]},onReset:noop,onSwap:noop,children:null};
}
const reading=(doc:CircuitDocument,a:string,b:string)=>renderToStaticMarkup(createElement(MeasurementPanel,props(doc,a,b))).match(/<output[^>]*>(.*?)<\/output>/)?.[1];
describe('resistance mode source disconnection',()=>{
  it('reads 3 Ω, 6 Ω and 9 Ω in series without changing the circuit or voltage readings',()=>{
    const doc=example('FIX-02'),before=JSON.stringify(doc);
    expect(reading(doc,'R1.a','R1.b')).toBe('3 Ω');
    expect(reading(doc,'R2.a','R2.b')).toBe('6 Ω');
    expect(reading(doc,'V1.p','V1.n')).toBe('9 Ω');
    expect(reading(doc,'R1.b','R1.a')).toBe('3 Ω');
    expect(JSON.stringify(doc)).toBe(before);
    expect(renderToStaticMarkup(createElement(MeasurementPanel,props(doc,'V1.p','V1.n','voltage')))).toMatch(/<output[^>]*>9 V<\/output>/);
  });
  it('retains parallel paths instead of reporting a component property',()=>{
    const doc=example('FIX-03');
    expect(reading(doc,'R1.a','R1.b')).toBe('2 Ω');
    expect(reading(doc,'R2.a','R2.b')).toBe('2 Ω');
    expect(reading(doc,'V1.p','V1.n')).toBe('2 Ω');
  });
  it('disconnects every source, including a source outside the probed port and a 0 V source',()=>{
    const doc=example('FIX-02'),extra=createComponent('dc-voltage-source','V2',{x:500,y:300});extra.properties.voltageV=0;
    doc.components.push(extra);
    doc.wires.push({id:'WX',start:{kind:'terminal',id:extra.terminals[0].id},end:{kind:'terminal',id:'R1.a'},waypoints:[]},{id:'WY',start:{kind:'terminal',id:extra.terminals[1].id},end:{kind:'terminal',id:'R1.b'},waypoints:[]});
    expect(reading(doc,'R1.a','R1.b')).toBe('3 Ω');
    expect(reading(doc,'V1.p','V1.n')).toBe('9 Ω');
  });
  it('keeps a real short at zero and a disconnected source alone open',()=>{
    const doc=example('FIX-02');expect(reading(doc,'R1.a','R1.a')).toBe('0 Ω');
    doc.components=doc.components.filter(c=>c.type==='dc-voltage-source');doc.wires=[];doc.junctions=[];
    expect(reading(doc,'V1.p','V1.n')).toBe('∞ Ω');
    expect(reading(doc,'V1.p','')).toBe('— Ω');
  });
  it('fades only sources and opens their leads only during resistance measurement',()=>{
    const doc=example('FIX-02');
    const canvas:CanvasProps={document:doc,selected:[],tool:'probe',placement:null,readOnly:true,onSelect:noop,onMove:noop,onPlace:noop,onEndpoint:noop,onWire:noop,onValue:noop,onSwitch:noop,onBackground:noop};
    const measurement={tool:'red' as const,anchors:{red:null,black:null,current:null},onPlace:noop,onActivate:noop};
    const host=globalThis.document.createElement('div');
    host.innerHTML=renderToStaticMarkup(createElement(CircuitCanvas,{...canvas,measurement:{...measurement,disconnectSources:true}}));
    expect(host.querySelectorAll('[data-source-isolated]')).toHaveLength(1);
    expect(host.querySelector('[data-source-isolated]')?.getAttribute('data-component-id')).toBe('V1');
    expect(host.querySelector('[data-source-isolated] .component-ink path')?.getAttribute('d')).toContain('M-32 0H-7 M7 0H32');
    host.innerHTML=renderToStaticMarkup(createElement(CircuitCanvas,{...canvas,measurement}));
    expect(host.querySelector('[data-source-isolated]')).toBeNull();
    expect(host.querySelector('[data-component-id="V1"] .component-ink path')?.getAttribute('d')).toContain('M-44 0H-7 M7 0H44');
  });
  it('shows the detached state and records the all-source condition',()=>{
    localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const host=globalThis.document.createElement('div');globalThis.document.body.append(host);const root=createRoot(host);
    try {
      act(()=>root.render(createElement(MeasurementPanel,props(example('FIX-02'),'R1.a','R1.b'))));
      expect(host.querySelector('.isolation-state')?.textContent).toBe('전지 분리 상태');
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="측정값 기록"]')!.click());
      expect(host.querySelector('tbody')?.textContent).toContain('모든 전원 분리');
      expect(host.querySelector('tbody')?.textContent).toContain('3 Ω');
    } finally {act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
});
