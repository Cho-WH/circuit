// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CircuitCanvas, type CanvasProps } from '../src/app/CircuitCanvas';
import { ComponentPalette, type PaletteDrag } from '../src/app/ComponentPalette';
import { OutputCanvas } from '../src/app/OutputCanvas';
import { emptyDocument } from '../src/domain';
import { createComponent } from '../src/component-library';
import { createHistory, executeCommand, undo, redo } from '../src/editor';

let host:HTMLDivElement,root:Root,resize:ResizeObserverCallback;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class {constructor(callback:ResizeObserverCallback){resize=callback;}observe(){}disconnect(){}});
  vi.stubGlobal('DOMPoint',class {constructor(public x:number,public y:number){}matrixTransform(){return this;}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();delete (document as unknown as Record<string,unknown>).elementFromPoint;});
function fixture(){const doc=emptyDocument('touch');doc.components=[createComponent('resistor','A',{x:200,y:400}),createComponent('resistor','B',{x:800,y:400})];doc.wires=[{id:'W',start:{kind:'terminal',id:'A.b'},end:{kind:'terminal',id:'B.a'},waypoints:[]}];return doc;}
function pointer(el:Element,type:string,x:number,y:number,id=1,kind='touch'){act(()=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:id,pointerType:kind,button:0})));}
function capture(el:Element){Object.assign(el,{setPointerCapture:vi.fn(),hasPointerCapture:()=>false});}
function mockSvg(){const svg=host.querySelector('svg')!;capture(svg);Object.assign(svg,{getScreenCTM:()=>({a:1,inverse:()=>({})}),getBoundingClientRect:()=>({left:0,top:0,right:1000,bottom:620,width:1000,height:620})});return svg;}
function canvas(overrides:Partial<CanvasProps>={}){
  const noop=()=>{};
  let props:CanvasProps={document:fixture(),selected:[],tool:'select',placement:null,initialView:{x:0,y:0,width:1000,height:620},onSelect:vi.fn(),onMove:vi.fn(),onPlace:vi.fn(),onEndpoint:vi.fn(),onWire:vi.fn(),onValue:noop,onSwitch:noop,onBackground:noop,...overrides};
  function render(next:Partial<CanvasProps>={}){props={...props,...next};root.render(createElement(CircuitCanvas,props));}
  act(()=>render());return {svg:mockSvg(),props,render:(p:Partial<CanvasProps>)=>act(()=>render(p))};
}
function click(el:Element,x=500,y=400){act(()=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y})));}
function tap(svg:SVGSVGElement,el:Element,x:number,y:number){Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>el});pointer(el,'pointerdown',x,y);pointer(svg,'pointerup',x,y);click(svg,x,y);}

it('previews a touch insertion without editing, confirms once, and leaves mouse insertion immediate',()=>{
  const c=canvas({placement:'resistor'}),wire=host.querySelector('[data-wire-id="W"]')!;
  tap(c.svg,wire,500,400);expect(c.props.onPlace).not.toHaveBeenCalled();expect(c.props.onWire).not.toHaveBeenCalled();
  expect(host.textContent).toContain('양쪽 연결을 확인');
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='삽입')!);
  expect(c.props.onPlace).toHaveBeenCalledExactlyOnceWith('resistor',{x:500,y:400},{wireId:'W',segment:0});
  vi.mocked(c.props.onPlace).mockClear();pointer(wire,'pointerdown',500,400,2,'mouse');expect(c.props.onPlace).toHaveBeenCalledOnce();
});
it('places on empty-space release with no extra confirmation, but never after a pan',()=>{
  const c=canvas({placement:'resistor'});tap(c.svg,c.svg,600,100);
  expect(c.props.onPlace).toHaveBeenCalledExactlyOnceWith('resistor',{x:600,y:100});vi.mocked(c.props.onPlace).mockClear();
  pointer(c.svg,'pointerdown',600,100);pointer(c.svg,'pointermove',700,150);pointer(c.svg,'pointerup',700,150);click(c.svg,700,150);
  expect(c.props.onPlace).not.toHaveBeenCalled();
});
it('holds an unselected body to move it; a short swipe pans instead',()=>{
  vi.useFakeTimers();const c=canvas(),body=host.querySelector('[data-component-id="A"] .component')!;
  pointer(body,'pointerdown',200,400);act(()=>vi.advanceTimersByTime(450));
  expect(host.querySelector('[data-component-id="A"]')?.getAttribute('data-dragging')).toBe('true');
  pointer(c.svg,'pointermove',260,440);pointer(c.svg,'pointerup',260,440);
  expect(c.props.onMove).toHaveBeenCalledExactlyOnceWith({A:{x:260,y:440}});vi.mocked(c.props.onMove).mockClear();
  const before=c.svg.getAttribute('viewBox');pointer(body,'pointerdown',200,400);pointer(c.svg,'pointermove',260,440);act(()=>vi.advanceTimersByTime(800));pointer(c.svg,'pointerup',260,440);
  expect(c.props.onMove).not.toHaveBeenCalled();expect(c.svg.getAttribute('viewBox')).not.toBe(before);
});
it.each(['pointercancel','lostpointercapture','escape','blur','document','resize'])('discards a pending hold on %s',reason=>{
  vi.useFakeTimers();const c=canvas(),body=host.querySelector('[data-component-id="A"] .component')!;
  if(reason==='resize')act(()=>resize([{contentRect:{width:1000,height:620}}] as ResizeObserverEntry[],{} as ResizeObserver));
  pointer(body,'pointerdown',200,400);
  if(reason==='pointercancel')pointer(c.svg,'pointercancel',200,400);
  if(reason==='lostpointercapture')pointer(c.svg,'lostpointercapture',200,400);
  if(reason==='escape')act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  if(reason==='blur')act(()=>window.dispatchEvent(new Event('blur')));
  if(reason==='document')c.render({document:fixture()});
  if(reason==='resize')act(()=>resize([{contentRect:{width:620,height:400}}] as ResizeObserverEntry[],{} as ResizeObserver));
  act(()=>vi.advanceTimersByTime(800));pointer(c.svg,'pointerup',300,440);
  expect(c.props.onMove).not.toHaveBeenCalled();expect(host.querySelector('[data-component-id="A"]')?.getAttribute('data-dragging')).toBe('false');
});
it('returns from touch navigation to normal mouse clicks',()=>{
  const c=canvas({onCommitComponent:()=>true});pointer(c.svg,'pointerdown',500,100);pointer(c.svg,'pointermove',600,100);pointer(c.svg,'pointerup',600,100);
  const value=host.querySelector('[data-value-id="A"]')!;pointer(value,'pointerdown',200,400,2,'mouse');click(value,200,400);
  expect(host.querySelector('#inline-component-value')).not.toBeNull();
});
it('suppresses a release click after a small screen movement that changes document position at low zoom',()=>{
  const c=canvas({selected:['A']}),body=host.querySelector('[data-component-id="A"] .component')!,wire=host.querySelector('[data-wire-id="W"]')!;
  vi.stubGlobal('DOMPoint',class {constructor(public x:number,public y:number){}matrixTransform(){return {x:this.x*10,y:this.y*10};}});
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>wire});
  pointer(body,'pointerdown',20,40);pointer(c.svg,'pointerup',22,40);click(c.svg,22,40);
  expect(c.props.onMove).toHaveBeenCalledExactlyOnceWith({A:{x:220,y:400}});expect(c.props.onWire).not.toHaveBeenCalled();
});
it.each([false,true])('restores an automatic edit shift only if the user has not navigated: userPan=%s',pan=>{
  const doc=fixture();doc.components[0].position.y=560;
  const c=canvas({document:doc,selected:['A'],onCommitComponent:()=>true});
  const size=(height:number)=>act(()=>resize([{contentRect:{width:1000,height}}] as ResizeObserverEntry[],{} as ResizeObserver));
  size(620);click(host.querySelector('[data-value-id="A"]')!);size(300);
  if(pan){pointer(c.svg,'pointerdown',600,100);pointer(c.svg,'pointermove',700,100);pointer(c.svg,'pointerup',700,100);}
  const before=c.svg.getAttribute('viewBox')!.split(' ').map(Number);size(620);
  const after=c.svg.getAttribute('viewBox')!.split(' ').map(Number);
  if(pan){expect(after[0]).toBe(before[0]);expect(after[1]+after[3]/2).toBe(before[1]+before[3]/2);}else expect(after).toEqual([0,0,1000,620]);
});
it('keeps a stationary palette hold in tap-placement mode and accepts following keyboard and mouse choices',()=>{
  vi.useFakeTimers();const choose=vi.fn(),drag=vi.fn();
  act(()=>root.render(createElement(ComponentPalette,{placement:null,onChoose:choose,onClear:()=>{},onDrag:drag,resetKey:'stable'})));
  const button=host.querySelector('button')!;capture(button);pointer(button,'pointerdown',100,50);act(()=>vi.advanceTimersByTime(450));pointer(button,'pointerup',100,50);click(button);
  expect(drag.mock.calls.map(([e])=>e.phase)).toEqual(['start']);expect(choose).toHaveBeenCalledOnce();
  act(()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));click(button);expect(choose).toHaveBeenCalledTimes(2);
  pointer(button,'pointerdown',100,50,2,'mouse');click(button);expect(choose).toHaveBeenCalledTimes(3);
});
it('records a touch insertion once and restores topology with undo/redo',()=>{
  let history=createHistory(fixture());
  const c=canvas({document:history.present,placement:'resistor',onPlace:(type,position,target)=>{
    const component=createComponent(type,'inserted',position);
    const result=executeCommand(history,target?{type:'InsertComponentOnWire',component,...target,newWireId:'inserted-wire'}:{type:'AddComponent',component});
    expect(result.ok).toBe(true);if(result.ok)history=result.history;
  }});
  const original=JSON.stringify(history.present);tap(c.svg,c.svg,500,400);expect(history.past).toHaveLength(0);
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='삽입')!);
  expect(history.past).toHaveLength(1);expect(history.present.wires).toHaveLength(2);const inserted=JSON.stringify(history.present);
  history=undo(history);expect(JSON.stringify(history.present)).toBe(original);history=redo(history);expect(JSON.stringify(history.present)).toBe(inserted);
});
it('offers every screen-near wire at low zoom and inserts on the chosen segment',()=>{
  const doc=fixture();doc.junctions=[{id:'J1',position:{x:244,y:440}},{id:'J2',position:{x:756,y:440}}];doc.wires.push({id:'W2',start:{kind:'junction',id:'J1'},end:{kind:'junction',id:'J2'},waypoints:[]});
  const c=canvas({document:doc,placement:'resistor',initialView:{x:0,y:0,width:5000,height:3100}});tap(c.svg,c.svg,500,400);
  expect(c.props.onPlace).not.toHaveBeenCalled();click([...host.querySelectorAll('button')].find(b=>b.textContent==='W2 · 구간 1')!);
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='삽입')!);
  expect(c.props.onPlace).toHaveBeenCalledExactlyOnceWith('resistor',{x:500,y:440},{wireId:'W2',segment:0});
});
it('requires an explicit choice for overlapping component bodies',()=>{
  const c=canvas();for(const body of host.querySelectorAll('.component-hit'))Object.assign(body,{getBoundingClientRect:()=>({left:450,right:550,top:350,bottom:450,width:100,height:100})});
  tap(c.svg,c.svg,500,400);expect(c.props.onSelect).not.toHaveBeenCalled();
  const buttons=host.querySelector('[aria-label="겹친 부품 선택"]')!.querySelectorAll('button');click(buttons[1]);
  expect(c.props.onSelect).toHaveBeenCalledExactlyOnceWith('B');expect(c.props.onMove).not.toHaveBeenCalled();
});
it('cancels a held palette drag on a second finger without starting another held tile',()=>{
  vi.useFakeTimers();const choose=vi.fn(),drag=vi.fn();
  act(()=>root.render(createElement(ComponentPalette,{placement:null,onChoose:choose,onClear:()=>{},onDrag:drag,resetKey:'stable'})));
  const [a,b]=host.querySelectorAll('button');capture(a);capture(b);
  pointer(a,'pointerdown',100,50,1);act(()=>vi.advanceTimersByTime(450));pointer(b,'pointerdown',200,50,2);act(()=>vi.advanceTimersByTime(800));pointer(b,'pointerup',200,50,2);pointer(a,'pointerup',100,50,1);click(b);click(a);
  expect(choose).toHaveBeenCalledOnce();expect(drag.mock.calls.map(([e])=>e.phase)).toEqual(['start','cancel']);
  pointer(b,'pointerdown',200,50,3);pointer(b,'pointerup',200,50,3);click(b);expect(choose).toHaveBeenCalledTimes(2);
});
it('moves the explicitly chosen output label even when another label overlaps it',()=>{
  const dispatch=vi.fn(()=>true),doc=fixture();let selected:string[]=[];
  function render(){root.render(createElement(OutputCanvas,{document:doc,result:{status:'solved',nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]},options:{monochrome:true},selected,tool:'select',onSelect:id=>{selected=id?[id]:[];render();},onTool:()=>{},dispatch,newId:()=> 'note'}));}
  act(render);const svg=mockSvg(),labels=host.querySelectorAll('[data-output-part="label"]');
  for(const label of labels)Object.assign(label,{getBoundingClientRect:()=>({left:480,right:520,top:380,bottom:420,width:40,height:40})});
  tap(svg,labels[0],500,400);const list=host.querySelector('[aria-label="겹친 출력 대상 선택"]')!;expect(list).not.toBeNull();click(list.querySelectorAll('button')[1]);
  pointer(labels[0],'pointerdown',500,400);pointer(svg,'pointermove',550,420);pointer(svg,'pointerup',550,420);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({type:'SetProperties',id:'B',properties:{labelOffsetX:50,labelOffsetY:20}});
});
it.each([true,false])('cancels a sensor drag when the second touch starts on handle=%s',onHandle=>{
  const onPlace=vi.fn(),c=canvas({readOnly:true,tool:'probe',measurement:{tool:'current',anchors:{red:null,black:null,current:{kind:'component',id:'A'}},onPlace,onActivate:()=>{}}});
  const handle=host.querySelector<SVGGElement>('[data-measurement-handle]')!;capture(handle);
  pointer(handle,'pointerdown',165,400,1);pointer(handle,'pointermove',450,400,1);pointer(onHandle?handle:c.svg,'pointerdown',650,100,2);pointer(c.svg,'pointermove',750,100,2);
  pointer(handle,'pointerup',500,400,1);pointer(c.svg,'pointerup',750,100,2);click(c.svg,500,400);click(c.svg,500,400);
  expect(onPlace).not.toHaveBeenCalled();tap(c.svg,c.svg,500,400);expect(onPlace).toHaveBeenCalledOnce();
});
it('supports tap-based component movement with a preview and explicit commit',()=>{
  const c=canvas({selected:['A'],onAction:()=>{}});
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='이동')!);tap(c.svg,c.svg,300,300);
  expect(c.props.onMove).not.toHaveBeenCalled();expect(host.querySelector('[data-component-id="A"] .component-hit')?.getAttribute('transform')).toContain('translate(300,300)');
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='놓기')!);expect(c.props.onMove).toHaveBeenCalledExactlyOnceWith({A:{x:300,y:300}});
});
it('receives palette preview coordinates and requires insertion confirmation after a drop',()=>{
  const c=canvas({placement:'resistor'});
  c.render({paletteDrag:{type:'resistor',phase:'move',x:500,y:400}});
  expect(host.querySelector('[aria-label="부품 배치 미리보기"]')?.innerHTML).toContain('translate(500,400)');
  c.render({paletteDrag:{type:'resistor',phase:'drop',x:500,y:400}});expect(c.props.onPlace).not.toHaveBeenCalled();
  click([...host.querySelectorAll('button')].find(b=>b.textContent==='삽입')!);expect(c.props.onPlace).toHaveBeenCalledOnce();
});
it('keeps scale, edit draft and selection when canvas size changes',()=>{
  const c=canvas({selected:['A'],onCommitComponent:()=>true});act(()=>resize([{contentRect:{width:1000,height:620}}] as ResizeObserverEntry[],{} as ResizeObserver));
  click(host.querySelector('[data-value-id="A"]')!);
  const input=host.querySelector<HTMLInputElement>('#inline-component-value')!;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'3/4');input.dispatchEvent(new Event('input',{bubbles:true}));});
  act(()=>resize([{contentRect:{width:500,height:310}}] as ResizeObserverEntry[],{} as ResizeObserver));
  const box=c.svg.getAttribute('viewBox')!.split(' ').map(Number);expect(box[2]).toBe(500);expect(box[3]).toBe(310);expect(input.value).toBe('3/4');expect(host.querySelector('[data-component-id="A"]')?.getAttribute('data-selected')).toBe('true');
});
it('offers named choices for close wiring terminals',()=>{
  const doc=emptyDocument('close');doc.junctions=[{id:'J1',position:{x:100,y:100}},{id:'J2',position:{x:120,y:100}}];
  const c=canvas({document:doc,onWiringCommit:vi.fn(()=>true)});tap(c.svg,c.svg,110,100);
  const list=host.querySelector('[aria-label="겹친 연결 대상 선택"]')!;expect(list).not.toBeNull();expect(list.querySelectorAll('button')).toHaveLength(3);expect(c.props.onWiringCommit).not.toHaveBeenCalled();
});
it('palette scroll cancels holding, while long press produces drag and suppresses the trailing click',()=>{
  vi.useFakeTimers();const choose=vi.fn(),drag=vi.fn<(e:PaletteDrag)=>void>();
  act(()=>root.render(createElement('aside',{className:'library-panel'},createElement(ComponentPalette,{placement:null,onChoose:choose,onClear:()=>{},onDrag:drag,resetKey:'stable'}))));
  const button=host.querySelector<HTMLButtonElement>('button')!;capture(button);
  pointer(button,'pointerdown',100,50);pointer(button,'pointermove',60,50);act(()=>vi.advanceTimersByTime(800));pointer(button,'pointerup',60,50);click(button);
  expect(choose).not.toHaveBeenCalled();expect(drag).not.toHaveBeenCalled();expect(host.querySelector('aside')!.scrollLeft).toBe(40);
  pointer(button,'pointerdown',100,50);act(()=>vi.advanceTimersByTime(450));pointer(button,'pointermove',500,400);pointer(button,'pointerup',500,400);click(button);
  expect(choose).toHaveBeenCalledTimes(1);expect(drag.mock.calls.map(([e])=>e.phase)).toEqual(['start','move','drop']);
});
it('output pinch cancels label movement and does not create edits from residual touches',()=>{
  const dispatch=vi.fn(()=>true);
  act(()=>root.render(createElement(OutputCanvas,{document:fixture(),result:{status:'solved',nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]},options:{monochrome:true},selected:['A'],tool:'select',onSelect:()=>{},onTool:()=>{},dispatch,newId:()=> 'note'})));
  const svg=mockSvg(),label=host.querySelector('[data-output-id="A"][data-output-part="label"]')!,view=svg.getAttribute('viewBox');
  pointer(label,'pointerdown',400,200,1);pointer(svg,'pointermove',450,200,1);pointer(svg,'pointerdown',600,200,2);pointer(svg,'pointermove',700,200,2);
  pointer(svg,'pointerup',700,200,2);pointer(svg,'pointerup',450,200,1);click(svg);expect(svg.getAttribute('viewBox')).not.toBe(view);expect(dispatch).not.toHaveBeenCalled();
});
