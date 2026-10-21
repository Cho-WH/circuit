// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputCanvas } from '../src/app/OutputCanvas';
import { WorksheetPanel } from '../src/app/WorksheetPanel';
import { layoutExample } from '../src/app/examples';
import { examples } from '../src/fixtures';
import { createHistory, executeCommand, executeCommands, type Command } from '../src/editor';

let root: Root;
let host: HTMLDivElement;
let frame: FrameRequestCallback | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frame=null; vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback)=>{frame=fn;return 1;}); vi.stubGlobal('cancelAnimationFrame',()=>{frame=null;});
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


function setup(arrow=false,readOnly=false) {
  const onInspect = vi.fn();
  let history=createHistory(layoutExample(examples[1].document));
  if(arrow)history.present.annotations=[{id:'test-arrow',kind:'arrow',anchor:null,position:{x:100,y:100},content:'I',visibility:'always',arrow:{shape:'corner',length:80,legLength:60,rotation:90,reversed:true}}];
  const dispatch=vi.fn((command: Command | readonly Command[])=>{const result=Array.isArray(command)?executeCommands(history,command):executeCommand(history,command as Command);if(!result.ok)return false;history=result.history;render();return true;});
  function render(){root.render(createElement(OutputCanvas,{readOnly,document:history.present,result:{status:'solved',nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]},options:{monochrome:true},selectedParts:readOnly?[]:[{id:arrow?'test-arrow':'R1',part:arrow?'annotation':'label'}],onSelection:()=>{},snapEnabled:false,areaAdditive:false,tool:'select',onSelect:()=>{},onInspect,onTool:()=>{},dispatch,newId:()=> 'test-note'}));}
  act(render);
  const svg=host.querySelector('svg')!;
  Object.assign(svg,{getScreenCTM:()=>({a:1,inverse:()=>({})}),setPointerCapture:()=>{}});
  function pointer(target:Element,type:string,x:number,y:number,pointerType='mouse'){act(()=>{target.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType,button:0}));}); if(type==='pointermove'&&frame)act(()=>{const fn=frame;frame=null;fn?.(0);});}
  const label=()=>host.querySelector('[data-output-id="R1"][data-output-part="label"]')!;
  return {svg,label,pointer,dispatch,onInspect,history:()=>history};
}
describe('output canvas direct manipulation',()=>{
  it('pans a read-only output without editing labels or opening settings',()=>{
    const c=setup(false,true),before=c.label().innerHTML,view=c.svg.getAttribute('viewBox');
    c.pointer(c.label(),'pointerdown',400,200);c.pointer(c.svg,'pointermove',440,230);c.pointer(c.svg,'pointerup',440,230);
    act(()=>c.label().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
    expect(c.label().innerHTML).toBe(before);
    expect(c.svg.getAttribute('viewBox')).not.toBe(view);
    expect(c.dispatch).not.toHaveBeenCalled();expect(c.onInspect).not.toHaveBeenCalled();
    expect(host.querySelector('.output-canvas [role="button"]')).toBeNull();
  });
  it.each(['mouse','touch'])('previews and commits one independent label drag with %s',pointerType=>{
    const c=setup(),before=c.label().innerHTML;
    c.pointer(c.label(),'pointerdown',400,200,pointerType);
    c.pointer(c.svg,'pointermove',460,170,pointerType);
    expect(c.label().innerHTML).not.toBe(before);expect(c.dispatch).not.toHaveBeenCalled();
    c.pointer(c.svg,'pointerup',470,160,pointerType);
    expect(c.dispatch).toHaveBeenCalledExactlyOnceWith([{type:'SetProperties',id:'R1',properties:{labelOffsetX:70,labelOffsetY:-40}}]);
    expect(c.history().past).toHaveLength(1);
    expect(c.history().present.components.find(c=>c.id==='R1')!.properties.answerOffsetX).toBeUndefined();
    expect(c.onInspect).not.toHaveBeenCalled();
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

describe('arrow length handles',()=>{
  it.each(['mouse','touch'])('resizes a rotated, reversed corner with one commit using %s',pointerType=>{
    const c=setup(true),end=host.querySelector('[data-output-part="end"]')!;
    c.pointer(end,'pointerdown',40,180,pointerType);
    c.pointer(c.svg,'pointermove',10,200,pointerType);
    expect(c.dispatch).not.toHaveBeenCalled();
    c.pointer(c.svg,'pointerup',0,200,pointerType);
    expect(c.dispatch).toHaveBeenCalledTimes(1);
    expect(c.history().present.annotations[0]).toMatchObject({position:{x:100,y:100},arrow:{length:80,legLength:100,rotation:90,reversed:true}});
    expect(c.history().past).toHaveLength(1);
    expect(c.onInspect).not.toHaveBeenCalled();
  });
  it('cancels length preview and keeps the opposite corner fixed on a start drag',()=>{
    const c=setup(true),start=()=>host.querySelector('[data-output-part="start"]')!;
    c.pointer(start(),'pointerdown',100,100);c.pointer(c.svg,'pointermove',100,70);c.pointer(c.svg,'pointercancel',100,70);
    expect(c.dispatch).not.toHaveBeenCalled();
    c.pointer(start(),'pointerdown',100,100);c.pointer(c.svg,'pointerup',120,70);
    expect(c.history().present.annotations[0]).toMatchObject({position:{x:100,y:70},arrow:{length:110,legLength:60,rotation:90}});
  });
});

describe('contextual output settings',()=>{
  it('keeps independent arrow notation controls and groups picture options under the selected target',()=>{
    const doc=layoutExample(examples[1].document);
    doc.annotations=[{id:'arrow',kind:'arrow',anchor:null,position:{x:100,y:100},content:'I_1',visibility:'always',presentation:{answerText:'3/4 A',labelOffsetX:25,answerOffsetX:40}}];
    const dispatch=vi.fn(()=>true), onOptions=vi.fn();
    const toolbar=document.createElement('div');toolbar.id='worksheet-actions';document.body.append(toolbar);
    try {
      act(()=>root.render(createElement(WorksheetPanel,{active:true,document:doc,result:{status:'solved',nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]},selected:['arrow'],tool:'select',onTool:()=>{},options:{monochrome:true},onOptions,onFontPreview:()=>{},onSelect:()=>{},dispatch,onNotice:()=>{},undo:()=>{},redo:()=>{},canUndo:false,canRedo:false,toolbarEnd:createElement('button',null,'상세 설정')})));
      expect(host.querySelector('h3')?.textContent).toBe('화살표');
      expect(host.querySelector('h4')).toBeNull();
      expect(host.querySelector('fieldset legend')?.textContent).toBe('그림 설정');
      const polarity = [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find(input => input.parentElement?.textContent === '기호 +/− 표시')!;
      expect(polarity.checked).toBe(false);
      act(() => polarity.click());
      expect(onOptions).toHaveBeenLastCalledWith({ monochrome: true, showSymbolPolarity: true });
      expect(host.querySelector<HTMLInputElement>('[aria-label="값 출력 문자"]')?.value).toBe('3/4 A');
      act(()=>host.querySelector<HTMLInputElement>('[aria-label="기호·이름 표시"]')!.click());
      expect(dispatch).toHaveBeenLastCalledWith({type:'UpdateAnnotation',id:'arrow',changes:{presentation:{...doc.annotations[0].presentation,labelVisible:false}}});
      act(()=>host.querySelector<HTMLInputElement>('[aria-label="값 빈칸"]')!.click());
      expect(dispatch).toHaveBeenLastCalledWith({type:'UpdateAnnotation',id:'arrow',changes:{presentation:{...doc.annotations[0].presentation,answerBlank:true}}});
      act(()=>host.querySelector<HTMLButtonElement>('[aria-label="기호·이름 위치 초기화"]')!.click());
      expect(dispatch).toHaveBeenLastCalledWith({type:'UpdateAnnotation',id:'arrow',changes:{presentation:{...doc.annotations[0].presentation,labelOffsetX:0,labelOffsetY:0}}});
      expect(toolbar.querySelector('[aria-label="화살표 방향 반전"]')).not.toBeNull();
      expect(toolbar.textContent).toContain('그림 복사');
      expect(toolbar.textContent).toContain('상세 설정');
    } finally {toolbar.remove();}
  });
});
// Controlled harness: selection changes rerender without replacing document/options.
function alignmentCanvas(tool: import('../src/app/OutputCanvas').OutputTool = 'select') {
  const doc=layoutExample(examples[1].document);
  let history=createHistory(doc), selectedParts:import('../src/export').OutputRef[]=[];
  let activeTool=tool, snapEnabled=true;
  const options={monochrome:true},result={status:'solved' as const,nodeVoltages:{},branchCurrents:{},componentVoltages:{},componentPowers:{},diagnostics:[]};
  const onInspect=vi.fn(),dispatch=vi.fn((commands:Command|readonly Command[])=>{
    const applied=Array.isArray(commands)?executeCommands(history,commands):executeCommand(history,commands as Command);
    if(!applied.ok)return false;history=applied.history;render();return true;
  });
  function render(){root.render(createElement(OutputCanvas,{document:history.present,result,options,selectedParts,tool:activeTool,snapEnabled,areaAdditive:false,onSelection:refs=>{selectedParts=refs;render();},onSelect:()=>{},onInspect,onTool:tool=>{activeTool=tool;render();},dispatch,newId:()=> 'annotation'}));}
  act(render);const svg=host.querySelector('svg')!;
  Object.assign(svg,{getScreenCTM:()=>({a:1,b:0,c:0,d:1,e:0,f:0,inverse:()=>({})}),setPointerCapture:()=>{}});
  const part=(id:string,part:string)=>host.querySelector(`[data-output-id="${id}"][data-output-part="${part}"]`)!;
  function pointer(target:Element,type:string,x:number,y:number,extras:PointerEventInit={}) {
    act(()=>{target.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,...extras}));});
  }
  const tick=()=>act(()=>{const fn=frame;frame=null;fn?.(0);});
  return {svg,part,pointer,tick,onInspect,dispatch,selection:()=>selectedParts,history:()=>history,
    setTool:(tool:typeof activeTool)=>act(()=>{activeTool=tool;render();}),setSnap:(enabled:boolean)=>act(()=>{snapEnabled=enabled;render();}),
    changeDoc:(fn:(doc:typeof history.present)=>void)=>act(()=>{history={...history,present:structuredClone(history.present)};fn(history.present);render();}),
    key:(key:string,extra:KeyboardEventInit={})=>act(()=>svg.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...extra}))),
  };
}

describe('output multi-selection gestures',()=>{
  it('previews two local body-gap guides, releases with Alt, and saves the same snapped label position',async()=>{
    const {createComponent}=await import('../src/component-library');
    const {emptyDocument}=await import('../src/domain');
    const {createSvgExport}=await import('../src/export');
    const {undo,redo}=await import('../src/editor');
    const {parseDocument,serializeDocument}=await import('../src/persistence');
    const c=alignmentCanvas();
    c.changeDoc(doc=>{
      Object.assign(doc,emptyDocument('gap-gesture'));
      doc.components=[createComponent('resistor','R1',{x:100,y:200},'R_1'),createComponent('resistor','R2',{x:400,y:400},'R_2')];
      const items=createSvgExport(doc).layout.items;
      doc.components.forEach((component,index)=>{
        const text=items.find(i=>i.ref.id===component.id&&i.ref.part==='label')!;
        const body=items.find(i=>i.ref.id===component.id&&i.ref.part==='body')!.symbolBody!.bounds;
        component.properties.labelOffsetY=body.y-text.bounds.y-text.bounds.height-(index?40:10);
      });
    });
    const before=structuredClone(c.history().present);
    c.pointer(c.part('R2','label'),'pointerdown',400,200);
    c.pointer(c.svg,'pointermove',400,228);c.tick();
    const guides=host.querySelectorAll('[data-output-guide="body-gap"]');
    expect(guides).toHaveLength(2);
    for(const g of guides){
      const line=g.querySelector('line')!;
      expect(line.getAttribute('stroke-dasharray')).not.toBeNull();
      expect(Number(line.getAttribute('y2'))-Number(line.getAttribute('y1'))).toBeCloseTo(10);
      expect(g.querySelectorAll('line')).toHaveLength(3);
    }
    c.key('Alt');expect(host.querySelector('[data-output-guide="body-gap"]')).toBeNull();
    act(()=>window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true,cancelable:true})));
    expect(host.querySelectorAll('[data-output-guide="body-gap"]')).toHaveLength(2);
    const preview=c.part('R2','label').innerHTML;
    c.pointer(c.svg,'pointerup',400,228);
    expect(c.part('R2','label').innerHTML).toBe(preview);
    expect(c.history().present.components[1].properties.labelOffsetY).toBeCloseTo(Number(before.components[1].properties.labelOffsetY)+30);
    expect(c.history().present.components[0]).toEqual(before.components[0]);
    expect(c.history().present.components[1].position).toEqual(before.components[1].position);
    expect(c.history().past).toHaveLength(1);
    expect(undo(c.history()).present).toEqual(before);
    expect(redo(undo(c.history())).present).toEqual(c.history().present);
    expect(parseDocument(serializeDocument(c.history().present))).toEqual({ok:true,document:c.history().present});
    expect(createSvgExport(c.history().present).svg).not.toContain('body-gap');
  });
  it('consumes Alt during a drag and keeps the latest position when released before a frame',()=>{
    const c=alignmentCanvas();
    const alt=(type:string)=>{
      const event=new KeyboardEvent(type,{key:'Alt',bubbles:true,cancelable:true});
      act(()=>window.dispatchEvent(event));return event;
    };
    expect(alt('keydown').defaultPrevented).toBe(false);
    c.pointer(c.part('R1','label'),'pointerdown',400,200,{altKey:true});
    c.pointer(c.svg,'pointermove',470,240,{altKey:true});c.tick();
    expect(alt('keydown').defaultPrevented).toBe(true);
    // Release Alt before RAF catches up with the latest pointer coordinates.
    c.pointer(c.svg,'pointermove',490,270,{altKey:true});
    expect(alt('keyup').defaultPrevented).toBe(true);
    const preview=c.part('R1','label').innerHTML;
    c.tick();expect(c.part('R1','label').innerHTML).toBe(preview);
    c.pointer(c.svg,'pointerup',490,270);
    expect(c.part('R1','label').innerHTML).toBe(preview);
    expect(c.history().past).toHaveLength(1);
    const properties=c.history().present.components.find(i=>i.id==='R1')!.properties;
    expect(Number(properties.labelOffsetX)).toBeGreaterThan(80);
    expect(Number(properties.labelOffsetY)).toBeGreaterThan(60);
    expect(alt('keyup').defaultPrevented).toBe(false);
  });
  it('projects a live drag from its start, keeps the axis until Shift release, and commits the preview once',()=>{
    const c=alignmentCanvas();c.setSnap(false);
    c.pointer(c.part('R1','label'),'pointerdown',400,200);
    c.pointer(c.svg,'pointermove',430,220);c.tick();
    const free=c.part('R1','label').innerHTML;
    c.key('Shift');
    const constrained=c.part('R1','label').innerHTML;expect(constrained).not.toBe(free);
    act(()=>window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true})));
    expect(c.part('R1','label').innerHTML).toBe(free);
    c.key('Shift');expect(c.part('R1','label').innerHTML).toBe(constrained);
    // Crossing the diagonal while Shift is held must not flip the chosen axis.
    c.pointer(c.svg,'pointermove',440,290,{shiftKey:true});c.tick();
    const preview=c.part('R1','label').innerHTML;
    c.pointer(c.svg,'pointerup',440,290,{shiftKey:true});
    expect(c.part('R1','label').innerHTML).toBe(preview);
    expect(c.dispatch).toHaveBeenCalledExactlyOnceWith([{type:'SetProperties',id:'R1',properties:{labelOffsetX:40,labelOffsetY:0}}]);
    expect(c.history().past).toHaveLength(1);
  });
  it('keeps a selected group on Shift-drag, supports Alt simultaneously, and still toggles on Shift-click',()=>{
    const c=alignmentCanvas();
    c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointerup',400,200);
    c.pointer(c.part('R1','value'),'pointerdown',400,240,{shiftKey:true});c.pointer(c.svg,'pointerup',400,240,{shiftKey:true});
    c.pointer(c.part('R1','label'),'pointerdown',400,200,{shiftKey:true,altKey:true});
    // Even a release before the first animation frame uses the final modifier state.
    c.pointer(c.svg,'pointerup',420,260,{shiftKey:true,altKey:true});
    expect(c.selection()).toHaveLength(2);
    expect(c.dispatch).toHaveBeenCalledExactlyOnceWith([{type:'SetProperties',id:'R1',properties:{labelOffsetX:0,labelOffsetY:60,answerOffsetX:0,answerOffsetY:60}}]);
    c.pointer(c.part('R1','label'),'pointerdown',400,260,{shiftKey:true});c.pointer(c.svg,'pointerup',400,260,{shiftKey:true});
    expect(c.selection()).toEqual([{id:'R1',part:'value'}]);
  });
  it('constrains arrow bodies without resizing them or separating their notation',()=>{
    const c=alignmentCanvas();c.setSnap(false);
    c.changeDoc(doc=>{doc.annotations=[{id:'arrow',kind:'arrow',anchor:null,position:{x:100,y:100},content:'I',visibility:'always',presentation:{labelOffsetX:25,answerOffsetY:15},arrow:{shape:'straight',length:80,legLength:48,rotation:0,reversed:false}}];});
    const before=structuredClone(c.history().present);
    c.pointer(c.part('arrow','annotation'),'pointerdown',100,100);
    c.pointer(c.svg,'pointerup',140,115,{shiftKey:true});
    expect(c.history().present.annotations[0]).toMatchObject({...before.annotations[0],position:{x:140,y:100}});
    expect(c.history().present.components).toEqual(before.components);
    expect(c.history().present.wires).toEqual(before.wires);
  });
  it('keeps independent same-component selections, drags them in one batch and never opens settings on Shift-click',()=>{
    const c=alignmentCanvas();c.setSnap(false);
    c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointerup',400,200);
    c.onInspect.mockClear();
    c.pointer(c.part('R1','value'),'pointerdown',400,240,{shiftKey:true});c.pointer(c.svg,'pointerup',400,240,{shiftKey:true});
    expect(c.selection()).toHaveLength(2);expect(c.onInspect).not.toHaveBeenCalled();
    c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointermove',420,230);c.tick();
    c.pointer(c.svg,'pointerup',430,240);
    expect(c.dispatch).toHaveBeenCalledExactlyOnceWith([{type:'SetProperties',id:'R1',properties:{labelOffsetX:30,labelOffsetY:40,answerOffsetX:30,answerOffsetY:40}}]);
    expect(c.history().past).toHaveLength(1);
    c.key('ArrowRight');expect(c.history().present.components.find(i=>i.id==='R1')!.properties.labelOffsetX).toBe(32);
  });
  it('preserves selection on blank pan, clears it on click, and restores it on canceled area selection',()=>{
    const c=alignmentCanvas();c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointerup',400,200);
    c.pointer(c.svg,'pointerdown',10,10);c.pointer(c.svg,'pointermove',40,40);c.tick();c.pointer(c.svg,'pointerup',40,40);
    expect(c.selection()).toEqual([{id:'R1',part:'label'}]);expect(c.dispatch).not.toHaveBeenCalled();
    c.setTool('area');c.pointer(c.svg,'pointerdown',0,0);c.pointer(c.svg,'pointermove',900,600);c.tick();c.key('Escape');c.pointer(c.svg,'pointerup',900,600);
    expect(c.selection()).toEqual([{id:'R1',part:'label'}]);expect(c.dispatch).not.toHaveBeenCalled();
    c.pointer(c.svg,'pointerdown',10,10);c.pointer(c.svg,'pointerup',10,10);expect(c.selection()).toEqual([]);
  });
  it('commits area selection from the final pointerup before a scheduled frame and blocks residual pinch releases',()=>{
    const c=alignmentCanvas('area');
    c.pointer(c.svg,'pointerdown',-1000,-1000);c.pointer(c.svg,'pointermove',-900,-900);c.pointer(c.svg,'pointerup',2000,2000);
    expect(c.selection().length).toBeGreaterThan(2);expect(c.selection().some(r=>r.part==='body')).toBe(false);expect(c.dispatch).not.toHaveBeenCalled();
    const previous=c.selection();c.setTool('area');
    c.pointer(c.svg,'pointerdown',100,100,{pointerType:'touch'});c.pointer(c.svg,'pointermove',500,400,{pointerType:'touch'});c.tick();
    c.pointer(c.svg,'pointerdown',600,400,{pointerType:'touch',pointerId:2});
    c.pointer(c.svg,'pointerup',600,400,{pointerType:'touch',pointerId:2});c.pointer(c.svg,'pointerup',500,400,{pointerType:'touch'});
    expect(c.selection()).toEqual(previous);expect(c.dispatch).not.toHaveBeenCalled();
  });
  it('does not select on focus, supports Space and Shift+Space, and prunes hidden selections',()=>{
    const c=alignmentCanvas(),label=c.part('R1','label'),value=c.part('R1','value');
    act(()=>label.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));expect(c.selection()).toEqual([]);
    act(()=>label.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})));
    act(()=>value.dispatchEvent(new KeyboardEvent('keydown',{key:' ',shiftKey:true,bubbles:true})));
    expect(c.selection()).toHaveLength(2);expect(c.onInspect).not.toHaveBeenCalled();
    c.changeDoc(doc=>{doc.components.find(i=>i.id==='R1')!.properties.labelVisible=false;});
    expect(c.selection()).toEqual([{id:'R1',part:'value'}]);
  });
  it.each(['pointercancel','lostpointercapture','blur','document','tool'])('cancels preview on %s and rejects a late release',reason=>{
    const c=alignmentCanvas();c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointermove',470,230);c.tick();
    if(reason==='blur')act(()=>window.dispatchEvent(new Event('blur')));
    else if(reason==='document')c.changeDoc(doc=>{doc.title='changed';});
    else if(reason==='tool')c.setTool('area');
    else c.pointer(c.svg,reason,470,230);
    c.pointer(c.svg,'pointerup',480,240);expect(c.dispatch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-output-guide]')).toBeNull();
  });
  it('clears snap guides on Alt without pointer movement, restores them on release, and commits that same preview',async()=>{
    const {createSvgExport}=await import('../src/export');
    const c=alignmentCanvas(),doc=c.history().present;
    const label=createSvgExport(doc).layout.items.find(i=>i.ref.id==='R1'&&i.ref.part==='label')!,symbol=doc.components.find(i=>i.id==='R1')!;
    // Keep x within the host-centre snap radius while moving vertically.
    const dx=symbol.position.x-label.bounds.x-label.bounds.width/2-3;
    c.pointer(c.part('R1','label'),'pointerdown',400,200);c.pointer(c.svg,'pointermove',400+dx,240);c.tick();
    expect(host.querySelector('[data-output-guide]')).not.toBeNull();
    c.key('Alt');expect(host.querySelector('[data-output-guide]')).toBeNull();
    act(()=>window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true})));
    expect(host.querySelector('[data-output-guide]')).not.toBeNull();
    const preview=c.part('R1','label').innerHTML;c.pointer(c.svg,'pointerup',400+dx,240);
    expect(c.part('R1','label').innerHTML).toBe(preview);expect(c.history().past).toHaveLength(1);
  });
});

it('uses the nearest length handle when short-arrow touch targets overlap',()=>{
  const c=alignmentCanvas();c.changeDoc(doc=>{doc.annotations=[{id:'short',kind:'arrow',anchor:null,position:{x:100,y:100},content:'I',visibility:'always',arrow:{shape:'straight',length:16,legLength:48,rotation:0,reversed:false}}];});
  act(()=>c.part('short','annotation').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})));
  // The end handle is on top in SVG order, but the pointer is at the start.
  c.pointer(c.part('short','end'),'pointerdown',100,100,{pointerType:'touch'});
  c.pointer(c.svg,'pointerup',80,100,{pointerType:'touch'});
  expect(c.history().present.annotations[0]).toMatchObject({position:{x:80,y:100},arrow:{length:36}});
  expect(c.history().past).toHaveLength(1);
});
