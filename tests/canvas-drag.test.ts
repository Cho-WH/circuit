// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createComponent } from '../src/component-library';
import { createHistory, executeCommand, executeCommands, type Command } from '../src/editor';
import type { Point } from '../src/domain';
import { emptyDocument } from '../src/domain';

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

function setup(overrides: Partial<CanvasProps> = {}) {
  const original = layoutExample(examples.find(e => e.document.documentId === 'fix-02')!.document);
  original.components.push(createComponent('resistor', 'R3', { x: 440, y: 400 }));
  let history = createHistory(overrides.document ?? original);
  const onMove = vi.fn((positions: Record<string, Point>) => {
    const result = executeCommand(history, { type: 'MoveComponents', positions });
    if (!result.ok) throw new Error('move failed');
    history = result.history;
    render({ document: history.present });
  });
  const commit = vi.fn((commands: readonly Command[]) => {
    const result = executeCommands(history, commands);
    if (!result.ok) return false;
    history = result.history; render({ document: history.present }); return true;
  });
  let props: CanvasProps = {
    document: history.present, selected: [], tool: 'select', placement: null,
    onSelect: () => {}, onMove, onPlace: vi.fn(), onEndpoint: () => {}, onWire: () => {},
    onValue: () => {}, onSwitch: () => {}, onBackground: () => {}, ...overrides,
  };
  function render(changes: Partial<CanvasProps> = {}) {
    props = { ...props, ...changes };
    root.render(createElement(CircuitCanvas, props));
  }
  act(() => render());
  const svg = host.querySelector('svg')!;
  const captured = new Set<number>();
  Object.assign(svg, {
    getScreenCTM: () => ({ inverse: () => ({}) }),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => {
      captured.delete(id);
      svg.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: id }));
    },
  });
  const component = (id: string) => host.querySelector(`[data-component-id="${id}"] .component`)!;
  const paths = () => [...host.querySelectorAll('polyline[aria-label^="도선 "]')].map(el => el.getAttribute('points'));
  function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, pointerType = 'mouse') {
    act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId, pointerType, button: 0 })); });
  }
  return { svg, component, paths, pointer, onMove, commit, original, history: () => history, render: (changes: Partial<CanvasProps>) => act(() => render(changes)) };
}

describe('live canvas drag geometry', () => {
  it.each(['mouse','touch'])('previews and commits a local wire segment drag from its original path (%s)',pointerType=>{
    const c=setup({selected:['W4']});c.render({onWiringCommit:c.commit});
    const handle=host.querySelector('[data-wire-handle]')!;
    expect(handle).not.toBeNull();const before=c.paths();
    c.pointer(handle,'pointerdown',860,300,1,pointerType);
    c.pointer(c.svg,'pointermove',900,340,1,pointerType);
    const preview=c.paths();expect(preview).not.toEqual(before);expect(c.commit).not.toHaveBeenCalled();
    c.pointer(c.svg,'pointermove',940,380,1,pointerType);
    c.pointer(c.svg,'pointermove',900,340,1,pointerType);expect(c.paths()).toEqual(preview);
    c.pointer(c.svg,'pointerup',900,340,1,pointerType);
    expect(c.paths()).toEqual(preview);expect(c.history().past).toHaveLength(1);
    expect(c.history().present.wires.map(w=>[w.start,w.end])).toEqual(c.original.wires.map(w=>[w.start,w.end]));
    act(()=>c.svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:900,clientY:340})));
    expect(host.querySelector('[data-wire-preview]')).toBeNull();
  });
  it.each(['Escape','blur','pointercancel','lostpointercapture','pinch','origin'])('cancels a wire segment preview without history: %s',reason=>{
    const c=setup({selected:['W4']});c.render({onWiringCommit:c.commit});
    const before=c.paths(),handle=host.querySelector('[data-wire-handle]')!;
    const type=reason==='pinch'?'touch':'mouse';
    c.pointer(handle,'pointerdown',860,300,1,type);c.pointer(c.svg,'pointermove',900,340,1,type);
    expect(c.paths()).not.toEqual(before);
    if(reason==='Escape')act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
    else if(reason==='blur')act(()=>window.dispatchEvent(new Event('blur')));
    else if(reason==='origin')c.pointer(c.svg,'pointermove',860,300,1,type);
    else if(reason==='pinch')c.pointer(c.svg,'pointerdown',500,300,2,'touch');
    else c.pointer(c.svg,reason,900,340,1,type);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg,'pointerup',reason==='origin'?860:900,reason==='origin'?300:340,1,type);
    expect(c.history().past).toHaveLength(0);expect(c.commit).not.toHaveBeenCalled();
  });
  it('edits a selected segment with keyboard arrows without starting a branch',()=>{
    const c=setup({selected:['W4']});c.render({onWiringCommit:c.commit});
    const handle=host.querySelector('[data-wire-handle]')!,before=c.paths();
    const key=handle.getAttribute('aria-label')!.includes('위아래')?'ArrowDown':'ArrowRight';
    act(()=>handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key})));
    expect(c.paths()).not.toEqual(before);expect(c.history().past).toHaveLength(1);
    expect(host.querySelector('[data-wire-preview]')).toBeNull();
  });
  it.each(['canvas','toolbar'])('creates and undoes draft waypoints from %s without leaking Backspace to document deletion',target=>{
    const doc=emptyDocument('keyboard');doc.junctions=[{id:'A',position:{x:100,y:100}},{id:'B',position:{x:400,y:100}}];
    const c=setup({document:doc});c.render({onWiringCommit:c.commit});
    const key=(target:Element,key:string)=>act(()=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})));
    const terminal=host.querySelector('[data-endpoint-id="A"]')!;
    key(terminal,'Enter');
    key(c.svg,'ArrowDown');key(c.svg,'ArrowDown');key(c.svg,'ArrowDown');key(c.svg,'Enter');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="마지막 경유점 되돌리기"]')!.disabled).toBe(false);
    const leaked=vi.fn();window.addEventListener('keydown',leaked);
    key(target==='canvas'?c.svg:host.querySelector('[aria-label^="배선 방향 전환"]')!,'Backspace');window.removeEventListener('keydown',leaked);expect(leaked).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="마지막 경유점 되돌리기"]')!.disabled).toBe(true);
    key(c.svg,'Enter');key(c.svg,'/');
    key(host.querySelector('[data-endpoint-id="B"]')!,'Enter');
    expect(c.history().present.wires).toHaveLength(1);expect(c.history().past).toHaveLength(1);
    expect(c.history().present.wires[0].waypoints.length).toBeGreaterThan(0);
  });
  it('previews and submits name and value together, and cancels both with Escape',()=>{
    const commit=vi.fn(()=>true);setup({onCommitComponent:commit});
    act(()=>host.querySelector('[aria-label="R_1 값 편집"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const name=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 이름"]')!,value=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 값"]')!;
    const change=(input:HTMLInputElement,text:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});
    change(name,'R_1');change(value,'3/4');
    expect(host.querySelector('.inline-name-preview sub')!.textContent).toBe('1');
    change(name,' ');act(()=>name.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(commit).not.toHaveBeenCalled();
    change(name,'R_1');act(()=>name.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(commit).toHaveBeenCalledExactlyOnceWith('R1',{label:'R_1',value:.75,fraction:'3/4'});
    act(()=>host.querySelector('[aria-label="R_1 값 편집"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const again=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 이름"]')!;change(again,'R_{eq}');
    act(()=>again.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(commit).toHaveBeenCalledTimes(1);expect(host.querySelector('.inline-value-editor')).toBeNull();
  });
  it('reopens an explicit fraction and rejects a zero denominator without changing it',()=>{
    const commit=vi.fn(()=>true),c=setup({onCommitComponent:commit});
    const doc=structuredClone(c.original),r=doc.components.find(c=>c.id==='R1')!;
    r.properties.resistanceOhm=.75;r.properties.resistanceOhmFraction='3/4';c.render({document:doc});
    act(()=>host.querySelector('[aria-label="R_1 값 편집"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const input=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 값"]')!;
    expect(input.value).toBe('3/4');
    const submit=(value:string)=>{act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});act(()=>input.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
    submit('3/0');expect(commit).not.toHaveBeenCalled();expect(input.getAttribute('aria-invalid')).toBe('true');
    submit('2/3');expect(commit).toHaveBeenCalledExactlyOnceWith('R1',{label:'R_1',value:2/3,fraction:'2/3'});
  });

  it('edits a value next to the circuit, keeps invalid input open and cancels with Escape',()=>{
    const commit=vi.fn(()=>true),c=setup({onCommitComponent:commit});
    const value=host.querySelector('[aria-label="R_1 값 편집"]')!;
    act(()=>value.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    let input=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 값"]')!;
    expect(input).not.toBeNull();expect(document.activeElement).toBe(input);
    const change=(text:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});
    change('wrong');act(()=>input.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(commit).not.toHaveBeenCalled();expect(input.getAttribute('aria-invalid')).toBe('true');
    change('1k');act(()=>input.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(commit).toHaveBeenCalledExactlyOnceWith('R1',{label:'R_1',value:1000});expect(host.querySelector('.inline-value-editor')).toBeNull();
    act(()=>value.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    input=host.querySelector<HTMLInputElement>('[aria-label="R_1 회로 위 값"]')!;
    act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(host.querySelector('.inline-value-editor')).toBeNull();expect(commit).toHaveBeenCalledTimes(1);
    expect(c.onMove).not.toHaveBeenCalled();
  });
  it('shows the actual source symbol and vertical terminals before placement',()=>{
    const c=setup({placement:'dc-voltage-source'});
    c.pointer(c.svg,'pointermove',500,400);
    const preview=host.querySelector('[aria-label="부품 배치 미리보기"]')!;
    expect(preview.innerHTML).toContain('rotate(90)');
    expect([...preview.querySelectorAll('circle')].map(x=>[x.getAttribute('cx'),x.getAttribute('cy')])).toEqual([['500','356'],['500','444']]);
    expect(preview.textContent).toContain('+');
  });
  it.each(['mouse', 'touch'])('keeps all existing routes throughout an unconnected R3 %s drag', pointerType => {
    const c = setup({ selected: ['R3'] });
    const before = c.paths();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400, 1, pointerType);
    for (const [x, y] of [[442, 403], [480, 420], [600, 500]]) {
      c.pointer(c.svg, 'pointermove', x, y, 1, pointerType);
      expect(c.paths()).toEqual(before);
      expect(c.onMove).not.toHaveBeenCalled();
    }
    c.pointer(c.svg, 'pointerup', 600, 500, 1, pointerType);
    expect(c.paths()).toEqual(before);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 600, y: 500 } });
    expect(c.history().past).toHaveLength(1);
  });

  it('uses the same connected-wire geometry before and after release', () => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    const preview = c.paths();
    expect(preview[0]).toEqual(before[0]);
    expect(preview[3]).not.toEqual(before[3]);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.paths()).toEqual(preview);
  });

  it('does not invalidate a route for a sub-grid move or a return to the start', () => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 662, 222);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointermove', 700, 260);
    expect(c.paths()).not.toEqual(before);
    c.pointer(c.svg, 'pointermove', 660, 220);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 660, 220);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'])('cancels the whole preview on %s without a late commit', cancellation => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    expect(c.paths()).not.toEqual(before);
    if (cancellation === 'Escape') act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    else if (cancellation === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
    else c.pointer(c.svg, cancellation, 700, 260);
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it('commits the release position even without a final pointermove', () => {
    const c = setup();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400);
    c.pointer(c.svg, 'pointermove', 480, 420);
    c.pointer(c.svg, 'pointerup', 520, 460);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 520, y: 460 } });
  });

  it('ignores another pointer while a drag owns capture', () => {
    const c = setup();
    c.pointer(c.component('R3'), 'pointerdown', 440, 400);
    c.pointer(c.svg, 'pointermove', 900, 700, 2, 'touch');
    c.pointer(c.svg, 'pointerup', 900, 700, 2, 'touch');
    expect(c.onMove).not.toHaveBeenCalled();
    c.pointer(c.svg, 'pointerup', 480, 440);
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({ R3: { x: 480, y: 440 } });
  });

  it('pans from an unselected component on touch without moving or selecting a wire', () => {
    const commit=vi.fn(()=>true), onWire=vi.fn();
    const c=setup({onWiringCommit:commit,onWire});
    const before=c.svg.getAttribute('viewBox');
    c.pointer(c.component('R3'),'pointerdown',440,400,1,'touch');
    c.pointer(c.svg,'pointermove',500,440,1,'touch');
    c.pointer(c.svg,'pointerup',500,440,1,'touch');
    act(()=>c.svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:500,clientY:440})));
    expect(c.svg.getAttribute('viewBox')).not.toBe(before);
    expect(c.onMove).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();expect(onWire).not.toHaveBeenCalled();
  });

  it('routes actual touch taps through start, wire preview, and explicit confirmation', () => {
    const doc=emptyDocument('touch');doc.components=[createComponent('resistor','A',{x:200,y:400}),createComponent('resistor','B',{x:800,y:400})];
    doc.wires=[{id:'W',start:{kind:'terminal',id:'A.b'},end:{kind:'terminal',id:'B.a'},waypoints:[]}];
    const commit=vi.fn(()=>true),c=setup({document:doc,onWiringCommit:commit});
    const tap=(x:number,y:number)=>{c.pointer(c.svg,'pointerdown',x,y,1,'touch');c.pointer(c.svg,'pointerup',x,y,1,'touch');act(()=>c.svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y})));};
    tap(156,400);expect(host.querySelector('[aria-label="배선 취소"]')).not.toBeNull();
    expect(host.querySelector('.wiring-status,.wiring-hint')).toBeNull();
    tap(500,400);expect(commit).not.toHaveBeenCalled();
    const confirm=host.querySelector<HTMLButtonElement>('[aria-label="여기에 연결"]')!;
    expect(confirm).toBeDefined();act(()=>confirm.click());expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps touch endpoint selection available in measurement mode', () => {
    const onEndpoint=vi.fn(),c=setup({readOnly:true,onEndpoint});
    const terminal=host.querySelector('[data-endpoint-id]')!;
    c.pointer(terminal,'pointerdown',100,100,1,'touch');c.pointer(c.svg,'pointerup',100,100,1,'touch');
    act(()=>terminal.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:100,clientY:100})));
    expect(onEndpoint).toHaveBeenCalledExactlyOnceWith({kind:'terminal',id:terminal.getAttribute('data-endpoint-id')});
  });

  it('forgets a canceled touch navigation session after window blur',()=>{
    const c=setup({selected:['R3'],onWiringCommit:vi.fn(()=>true)});
    c.pointer(c.svg,'pointerdown',50,50,1,'touch');
    act(()=>window.dispatchEvent(new Event('blur')));
    c.pointer(c.component('R3'),'pointerdown',440,400,2,'touch');
    c.pointer(c.svg,'pointermove',480,440,2,'touch');c.pointer(c.svg,'pointerup',480,440,2,'touch');
    expect(c.onMove).toHaveBeenCalledExactlyOnceWith({R3:{x:480,y:440}});
  });

  it('cancels a selected component drag when a second touch begins, with no edit after pinch release', () => {
    const commit=vi.fn(()=>true),c=setup({selected:['R3'],onWiringCommit:commit});
    Object.assign(c.svg,{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:620})});
    c.pointer(c.component('R3'),'pointerdown',440,400,1,'touch');
    c.pointer(c.svg,'pointermove',480,440,1,'touch');
    c.pointer(c.svg,'pointerdown',600,400,2,'touch');
    c.pointer(c.svg,'pointermove',700,400,2,'touch');
    c.pointer(c.svg,'pointerup',700,400,2,'touch');
    c.pointer(c.svg,'pointerup',480,440,1,'touch');
    act(()=>c.svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:480,clientY:440})));
    expect(c.onMove).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
    expect(c.svg.getAttribute('viewBox')).not.toContain('NaN');
  });

  it.each(['document', 'tool', 'readOnly'])('invalidates stale movement when %s changes', change => {
    const c = setup();
    const before = c.paths();
    c.pointer(c.component('R2'), 'pointerdown', 660, 220);
    c.pointer(c.svg, 'pointermove', 700, 260);
    c.render(change === 'document' ? { document: structuredClone(c.original) } : change === 'tool' ? { tool: 'wire' } : { readOnly: true });
    expect(c.paths()).toEqual(before);
    c.pointer(c.svg, 'pointerup', 700, 260);
    expect(c.onMove).not.toHaveBeenCalled();
  });
});
