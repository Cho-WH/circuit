// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PotentialPalettePicker } from '../src/app/PotentialPalettePicker';
import { App } from '../src/app/App';
import { potentialColor, type PotentialPaletteId } from '../src/visualization';
import type { Potential3DProps } from '../src/potential-3d';

const observed = vi.hoisted(()=>({scene:null as Potential3DProps|null}));
vi.mock('../src/potential-3d',()=>({Potential3D:(props:Potential3DProps)=>{observed.scene=props;return createElement('div',null,'3D');}}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);observed.scene=null;});
afterEach(()=>{act(()=>root.unmount());host.remove();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
const trigger=()=>host.querySelector<HTMLButtonElement>('.potential-palette-trigger')!;
const menu=()=>document.querySelector<HTMLElement>('[role="menu"][aria-label="전위 색상표"]');
const options=()=>Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
const click=(node:HTMLElement)=>act(()=>node.click());
const key=(node:HTMLElement,k:string)=>act(()=>node.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})));
function Harness({single=false}:{single?:boolean}){
  const [value,setValue]=useState<PotentialPaletteId>('spectrum');
  return createElement(PotentialPalettePicker,{value,onChange:setValue,min:0,max:single?0:12});
}
it('opens three actual swatches, focuses the current choice and closes with focus restored after selection',()=>{
  act(()=>root.render(createElement(Harness)));
  expect(trigger().getAttribute('aria-label')).toContain('전체 스펙트럼');
  click(trigger());expect(options()).toHaveLength(3);
  expect(document.activeElement).toBe(options()[1]);
  expect(options()[1].getAttribute('aria-checked')).toBe('true');
  expect(options().every(el=>el.querySelector<HTMLElement>('.potential-palette-ramp')!.style.background.includes('gradient'))).toBe(true);
  click(options()[0]);expect(menu()).toBeNull();expect(document.activeElement).toBe(trigger());
  expect(trigger().getAttribute('aria-label')).toContain('파랑 → 노랑');
  click(trigger());expect(options()[0].getAttribute('aria-checked')).toBe('true');
});
it('handles keyboard navigation without leaking circuit shortcuts, and dismisses on Escape/Tab/outside touch',()=>{
  act(()=>root.render(createElement(Harness)));
  const external=vi.fn();window.addEventListener('keydown',external);
  try{
    key(trigger(),'ArrowDown');key(document.activeElement as HTMLElement,'ArrowDown');expect(document.activeElement).toBe(options()[2]);
    key(document.activeElement as HTMLElement,'Home');expect(document.activeElement).toBe(options()[0]);
    key(document.activeElement as HTMLElement,'End');expect(document.activeElement).toBe(options()[2]);
    key(document.activeElement as HTMLElement,'Delete');expect(external).not.toHaveBeenCalled();
    key(document.activeElement as HTMLElement,'Escape');expect(menu()).toBeNull();expect(document.activeElement).toBe(trigger());
    click(trigger());key(document.activeElement as HTMLElement,'Tab');expect(menu()).toBeNull();
    click(trigger());act(()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})));expect(menu()).toBeNull();
  }finally{window.removeEventListener('keydown',external);}
});
it('shows a single-potential legend as a solid color while alternatives remain full gradients',()=>{
  act(()=>root.render(createElement(Harness,{single:true})));
  expect(trigger().querySelector<HTMLElement>('.potential-palette-ramp')!.style.background.replaceAll(' ','')).toBe(potentialColor(0,0,0));
  click(trigger());click(options()[2]);
  expect(trigger().querySelector<HTMLElement>('.potential-palette-ramp')!.style.background.replaceAll(' ','')).toBe(potentialColor(0,0,0,'red-yellow'));
});
it('keeps the menu inside a narrow viewport and dismisses it when the viewport changes',()=>{
  vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',500);
  act(()=>root.render(createElement(Harness)));
  vi.spyOn(trigger(),'getBoundingClientRect').mockReturnValue({left:12,right:124,top:450,bottom:482,width:112,height:32,x:12,y:450,toJSON(){}});
  click(trigger());expect(parseFloat(menu()!.style.left)).toBeGreaterThanOrEqual(8);
  expect(parseFloat(menu()!.style.left)+parseFloat(menu()!.style.width)).toBeLessThanOrEqual(382);
  act(()=>window.dispatchEvent(new Event('resize')));expect(menu()).toBeNull();
});
it('applies palette selection to the real 2D canvas and 3D input while preserving the circuit and heights',async()=>{
  await act(async()=>root.render(createElement(App)));
  const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===text)!;
  click(button('전위 보기'));
  const before=host.querySelector('.circuit-canvas')!.outerHTML;
  click(trigger());click(options()[0]);
  expect(host.querySelector('.circuit-canvas')!.outerHTML).not.toBe(before);
  await act(async()=>button('3D').click());
  const first=observed.scene!;expect(first).not.toBeNull();
  const doc=first.document,heights=Object.values(first.potential.nets).map(n=>n.height);
  for(const n of Object.values(first.potential.nets))expect(n.color).toBe(potentialColor(n.voltage,first.potential.min,first.potential.max,'blue-yellow'));
  click(trigger());click(options()[2]);
  const second=observed.scene!;
  expect(second.document).toBe(doc);
  expect(Object.values(second.potential.nets).map(n=>n.height)).toEqual(heights);
  for(const n of Object.values(second.potential.nets))expect(n.color).toBe(potentialColor(n.voltage,second.potential.min,second.potential.max,'red-yellow'));
  click(button('2D'));click(button('회로 만들기'));click(button('전위 보기'));
  expect(trigger().getAttribute('aria-label')).toContain('검붉은색 → 노랑');
});
