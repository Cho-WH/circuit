import { useEffect, useRef, useState } from 'react';
import type { CircuitDocument, Point } from '../../domain';
import { anchorPose, measurementHit, type MeasurementAnchor, type MeasurementTool } from './model';

export function ProbeGlyph({color='red'}:{color?:'red'|'black'}) {
  return <g stroke={color==='red'?'#bc4541':'#34413a'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M0 0L0 -15"/><path d="M-4 -15L-5 -40Q0 -45 5 -40L4 -15Z" fill={color==='red'?'#bc4541':'#34413a'}/><path d="M-7 -17H7"/><path d="M0 -26V-35 M-3 -30.5H3" stroke="white" strokeWidth="1.4"/>{color==='black'&&<path d="M0 -26V-35" stroke="#34413a" strokeWidth="2"/>}</g>;
}
export function CurrentGlyph() {
  return <g stroke="#53694b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 -8A12 12 0 1 0 8 8" fill="none"/><path d="M-7 -11L-7 -32Q0 -38 7 -32L7 -17" fill="#f4f6ef"/><text x="0" y="-22" fill="#53694b" stroke="none" textAnchor="middle" fontSize="12" fontFamily="Libertinus Math">A</text></g>;
}
export interface MeasurementLayerProps {
  document:CircuitDocument; tool:MeasurementTool;
  anchors:Record<MeasurementTool,MeasurementAnchor|null>;
  amperes?:number;
  disconnectSources?:boolean;
  onPlace:(tool:MeasurementTool,anchor:MeasurementAnchor|null)=>void;
  onActivate:(tool:MeasurementTool)=>void;
  scale:number; bounds:{x:number;y:number;width:number;height:number};
  point:(x:number,y:number)=>Point;
}
export function MeasurementLayer(props:MeasurementLayerProps) {
  const {document:doc,tool,anchors,scale,bounds}=props;
  const [hover,setHover]=useState<MeasurementAnchor|null>(null);
  const [drag,setDrag]=useState<{tool:MeasurementTool;pointerId:number;point:Point;start:Point;moved:boolean}|null>(null);
  const capture=useRef<SVGGElement|null>(null), suppressClick=useRef(false);
  function cancel() {setDrag(null);setHover(null);const el=capture.current;if(el&&drag&&el.hasPointerCapture?.(drag.pointerId))el.releasePointerCapture(drag.pointerId);capture.current=null;}
  useEffect(()=>{cancel();},[doc,tool==='current']);
  useEffect(()=>{setHover(null);suppressClick.current=false;},[tool]);
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('keydown',escape);window.addEventListener('blur',cancel);return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);};},[drag]);
  const tools:MeasurementTool[]=tool==='current'?['current']:['red','black'];
  const size=1/scale;
  const glyph=(which:MeasurementTool,anchor:MeasurementAnchor|null,ghost=false,floating?:Point)=>{
    const pose=floating?{point:floating,angle:0}:anchorPose(doc,anchor);if(!pose)return null;
    // Red and black lean to opposite sides so coincident probes remain distinct.
    const angle=which==='current'?pose.angle:which==='red'?-35:35;
    return <g key={which} data-measurement-handle={ghost?undefined:which} role={ghost?undefined:'button'} tabIndex={ghost?undefined:0} aria-label={ghost?undefined:which==='current'?'전류 센서 이동':`${which==='red'?'빨강':'검정'} 탐침 이동`} className={`measurement-handle${ghost?' is-preview':''}`} transform={`translate(${pose.point.x},${pose.point.y}) scale(${size})`} opacity={ghost ? .45 : 1} pointerEvents={ghost?'none':undefined}
      onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();props.onActivate(which);suppressClick.current=false;setDrag({tool:which,pointerId:e.pointerId,point:pose.point,start:props.point(e.clientX,e.clientY),moved:false});capture.current=e.currentTarget;e.currentTarget.setPointerCapture(e.pointerId);}}
      onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();props.onActivate(which);}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();props.onPlace(which,null);}}}>
      <g transform={`rotate(${angle})`}><rect x="-20" y="-48" width="40" height="65" fill="transparent"/><circle r="5" stroke={which==='red'?'#bc4541':which==='black'?'#34413a':'#53694b'} strokeWidth="1.5" fill="white"/>{which==='current'?<CurrentGlyph/>:<ProbeGlyph color={which}/>}</g>
      {which==='current'&&!ghost&&props.amperes!==undefined&&Math.abs(props.amperes)>1e-12&&<g transform={`rotate(${pose.angle+(props.amperes<0?180:0)})`} stroke="#53694b" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M-15 23H15 M9 18L15 23 9 28"/></g>}
    </g>;
  };
  const dragged=drag?measurementHit(doc,drag.point,scale,drag.tool):null;
  return <g data-measurement-layer="true"
    onPointerDown={e=>{if(!(e.target as Element).closest('[data-measurement-handle]'))suppressClick.current=false;}}
    onPointerMove={e=>{const p=props.point(e.clientX,e.clientY);if(drag){if(drag.pointerId===e.pointerId)setDrag({...drag,point:p,moved:drag.moved||Math.hypot(p.x-drag.start.x,p.y-drag.start.y)*scale>4});}else if(e.pointerType!=='touch')setHover((e.target as Element).closest('[data-measurement-handle]')?null:measurementHit(doc,p,scale,tool));}}
    onPointerLeave={()=>{if(!drag)setHover(null);}}
    onPointerUp={e=>{if(!drag||drag.pointerId!==e.pointerId)return;e.stopPropagation();const hit=measurementHit(doc,props.point(e.clientX,e.clientY),scale,drag.tool);if(drag.moved&&hit)props.onPlace(drag.tool,hit);suppressClick.current=true;cancel();}}
    onPointerCancel={()=>{suppressClick.current=true;cancel();}}
    onLostPointerCapture={()=>{if(drag)cancel();}}
    onClick={e=>{e.stopPropagation();if(suppressClick.current){suppressClick.current=false;return;}if((e.target as Element).closest('[data-measurement-handle]'))return;const hit=measurementHit(doc,props.point(e.clientX,e.clientY),scale,tool);if(hit)props.onPlace(tool,hit);}}>
    <rect {...bounds} fill="transparent" className="measurement-surface"/>
    {tools.map(which=>glyph(which,drag?.tool===which&&drag.moved?dragged:anchors[which],false,drag?.tool===which&&drag.moved&&!dragged?drag.point:undefined))}
    {!drag&&hover&&glyph(tool,hover,true)}
  </g>;
}
