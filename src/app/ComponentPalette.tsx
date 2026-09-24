import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from '../domain';
import { componentDefinitions, createComponent, symbolMarkup } from '../component-library';

export interface PaletteDrag { type:ComponentType; x:number; y:number; phase:'start'|'move'|'drop'|'cancel' }
export function ComponentPalette({placement,onChoose,onClear,onDrag,resetKey}:{placement:ComponentType|null;onChoose:(type:ComponentType)=>void;onClear:()=>void;onDrag:(event:PaletteDrag)=>void;resetKey:unknown}) {
  const session=useRef<{id:number;type:ComponentType;x:number;y:number;lastX:number;lastY:number;held:boolean;scrolled:boolean;button:HTMLButtonElement;panel:HTMLElement|null;timer:ReturnType<typeof setTimeout>}|null>(null);
  const [held,setHeld]=useState<ComponentType|null>(null);
  const suppress=useRef(false),lastInput=useRef('mouse'),latest=useRef(onDrag);latest.current=onDrag;
  const touches=useRef(new Set<number>()),blocked=useRef(false);
  function cancel(){const s=session.current;if(!s)return;clearTimeout(s.timer);session.current=null;suppress.current=true;setHeld(null);if(s.button.hasPointerCapture?.(s.id))s.button.releasePointerCapture(s.id);if(s.held)latest.current({type:s.type,x:s.lastX,y:s.lastY,phase:'cancel'});}
  useEffect(()=>{cancel();},[resetKey]);
  useEffect(()=>{
    const extra=(e:PointerEvent)=>{if(e.pointerType!=='touch')return;touches.current.add(e.pointerId);if(touches.current.size>1){blocked.current=true;suppress.current=true;cancel();}};
    const release=(e:PointerEvent)=>{touches.current.delete(e.pointerId);if(!touches.current.size)blocked.current=false;};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};
    const blur=()=>{cancel();touches.current.clear();blocked.current=false;};
    window.addEventListener('pointerdown',extra,true);window.addEventListener('pointerup',release,true);window.addEventListener('pointercancel',release,true);window.addEventListener('blur',blur);window.addEventListener('resize',cancel);window.addEventListener('keydown',escape);
    return()=>{cancel();window.removeEventListener('pointerdown',extra,true);window.removeEventListener('pointerup',release,true);window.removeEventListener('pointercancel',release,true);window.removeEventListener('blur',blur);window.removeEventListener('resize',cancel);window.removeEventListener('keydown',escape);};
  },[]);
  return <div className="component-grid">{(Object.keys(componentDefinitions) as ComponentType[]).map(type=><button key={type} className={`component-tile${placement===type?' chosen':''}${held===type?' is-held':''}`} aria-pressed={placement===type} draggable
    onDragStart={e=>{if(lastInput.current==='touch'){e.preventDefault();return;}e.dataTransfer.setData('component',type);onChoose(type);}} onDragEnd={onClear}
    onContextMenu={e=>{if(lastInput.current==='touch')e.preventDefault();}}
    onPointerDown={e=>{
      lastInput.current=e.pointerType;if(e.pointerType!=='touch'){suppress.current=false;return;}if(e.button!==0)return;
      if(blocked.current){suppress.current=true;return;}
      if(session.current){cancel();return;}suppress.current=false;
      const s={id:e.pointerId,type,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,held:false,scrolled:false,button:e.currentTarget,panel:e.currentTarget.closest<HTMLElement>('.library-panel'),timer:0 as unknown as ReturnType<typeof setTimeout>};
      s.timer=setTimeout(()=>{if(session.current!==s||s.scrolled)return;s.held=true;suppress.current=true;setHeld(type);onChoose(type);latest.current({type,x:s.x,y:s.y,phase:'start'});},450);
      session.current=s;e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e=>{
      const s=session.current;if(!s||s.id!==e.pointerId)return;
      if(!s.held&&Math.hypot(e.clientX-s.x,e.clientY-s.y)>10){clearTimeout(s.timer);s.scrolled=true;suppress.current=true;}
      if(s.held)latest.current({type,x:e.clientX,y:e.clientY,phase:'move'});
      else if(s.scrolled&&s.panel){s.panel.scrollLeft-=e.clientX-s.lastX;s.panel.scrollTop-=e.clientY-s.lastY;}
      s.lastX=e.clientX;s.lastY=e.clientY;
    }}
    onPointerUp={e=>{const s=session.current;if(!s||s.id!==e.pointerId)return;clearTimeout(s.timer);session.current=null;setHeld(null);if(s.held&&Math.hypot(e.clientX-s.x,e.clientY-s.y)>10)latest.current({type,x:e.clientX,y:e.clientY,phase:'drop'});if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')suppress.current=false;}}
    onClick={e=>{if(suppress.current){e.preventDefault();return;}onChoose(type);}}>
    <span className="tile-symbol"><svg width="62" height="32" viewBox="-50 -27 100 54" aria-hidden="true" stroke="currentColor" fill="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{__html:symbolMarkup(createComponent(type,'palette',{x:0,y:0}))}}/></span><span>{componentDefinitions[type].name}</span>
  </button>)}</div>;
}
