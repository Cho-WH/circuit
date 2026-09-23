import { useEffect, useState, type SVGAttributes } from 'react';
import { notationTokens, symbolGlyphs, parseQuantity, type QuantityUnit } from '../notation';
import { svgNotation, htmlNotation } from '../component-library';

export function Notation({text,symbol=false}:{text:string;symbol?:boolean}) {
  return <span className="notation" aria-label={text} dangerouslySetInnerHTML={{__html:htmlNotation(text,symbol)}}/>;
}

/** Shares vector fraction layout with SVG and PNG export, with no foreignObject dependency. */
export function SvgNotation({text,symbol=false,x,y,fontSize=14,textAnchor='start',fill='currentColor',fontWeight='400',...props}:SVGAttributes<SVGElement>&{text:string;x:number;y:number;fontSize?:number;textAnchor?:'start'|'middle';fill?:string;symbol?:boolean}) {
  if(notationTokens(text).every(t=>t.kind==='text'))return <text {...props} x={x} y={y} fontSize={fontSize} textAnchor={textAnchor} fill={fill} fontWeight={fontWeight} aria-label={props['aria-label']??text}>{symbol?symbolGlyphs(text):text}</text>;
  return <g {...props} aria-label={props['aria-label']??text} dangerouslySetInnerHTML={{__html:svgNotation(text,{x,y,fontSize,anchor:textAnchor,fill,weight:String(fontWeight),symbol})}}/>;
}

/** Range fields keep a draft while typing a slash and commit only a complete, valid number. */
export function QuantityInput({value,onChange,label,unit='',nonNegative=false}:{value:number;onChange:(value:number)=>void;label:string;unit?:QuantityUnit;nonNegative?:boolean}) {
  const [draft,setDraft]=useState(String(value)),[invalid,setInvalid]=useState(false);
  useEffect(()=>{setDraft(current=>parseQuantity(current,unit)?.value===value?current:String(value));setInvalid(false);},[value,unit]);
  function commit(){const parsed=parseQuantity(draft,unit);if(!parsed||(nonNegative&&parsed.value<0)){setInvalid(true);return;}onChange(parsed.value);setDraft(parsed.fraction??String(parsed.value));setInvalid(false);}
  return <div className="quantity-field"><input aria-label={label} aria-invalid={invalid||undefined} value={draft} onChange={e=>{setDraft(e.target.value);setInvalid(false);}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}else if(e.key==='Escape'){setDraft(String(value));setInvalid(false);}}}/>{!invalid&&draft.includes('/')&&<Notation text={draft}/>}</div>;
}
