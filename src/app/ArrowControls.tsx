import { useEffect, useState } from 'react';
import { RotateCw, FlipHorizontal2 } from 'lucide-react';
import type { Annotation, ArrowStyle, Point } from '../domain';
import { arrowStyle } from '../component-library';

function NumberControl({label,value,min,max,onCommit}:{label:string;value:number;min:number;max:number;onCommit:(value:number)=>void}) {
  const [text,setText]=useState(String(Math.round(value*100)/100));
  useEffect(()=>setText(String(Math.round(value*100)/100)),[value]);
  function commit(){const next=Number(text);if(text.trim()&&Number.isFinite(next)&&next>=min&&next<=max){if(next!==value)onCommit(next);}else setText(String(value));}
  return <input aria-label={label} title={label} type="number" min={min} max={max} value={text} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.preventDefault();setText(String(value));}}}/>;
}
export function ArrowControls({annotation,position,onChange}:{annotation:Annotation;position:Point;onChange:(arrow:ArrowStyle)=>void}) {
  const style=arrowStyle(annotation,position);
  const update=(change:Partial<ArrowStyle>)=>onChange({...style,...change});
  return <div className="arrow-controls" role="group" aria-label="화살표 조절">
    <label title="회전 각도"><NumberControl label="화살표 회전 각도" value={style.rotation} min={-360} max={360} onCommit={rotation=>update({rotation})}/><span>°</span></label>
    <button title="90° 회전" aria-label="화살표 90도 회전" onClick={()=>update({rotation:(style.rotation+90)%360})}><RotateCw size={17}/></button>
    <button title="방향 반전" aria-label="화살표 방향 반전" aria-pressed={style.reversed} onClick={()=>update({reversed:!style.reversed})}><FlipHorizontal2 size={17}/></button>
  </div>;
}
