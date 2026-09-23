import { Check, X } from 'lucide-react';
import type { ContextWiring } from './useContextWiring';
import { targetKey } from './model';
import type { Point } from '../../domain';

export function WiringMarks({ wiring, scale, bounds }: { wiring: ContextWiring; scale: number; bounds: Point & {width:number;height:number} }) {
  if (!wiring.active) return null;
  const center = wiring.choices.length ? {x:wiring.choices.reduce((sum,t)=>sum+t.point.x,0)/wiring.choices.length,y:wiring.choices.reduce((sum,t)=>sum+t.point.y,0)/wiring.choices.length} : null;
  return <g pointerEvents="none">
    {wiring.start && <circle aria-hidden="true" cx={wiring.start.point.x} cy={wiring.start.point.y} r={9 / scale} fill="#e4edff" stroke="#174895" strokeWidth={2 / scale} />}
    {wiring.hint && <g aria-hidden="true">
      {wiring.branchEnd && <path className="branch-ghost" d={'M'+wiring.hint.point.x+' '+wiring.hint.point.y+'L'+wiring.branchEnd.x+' '+wiring.branchEnd.y} fill="none" stroke="#174895" strokeWidth={3/scale} strokeLinecap="round" opacity=".32"/>}
      <circle cx={wiring.hint.point.x} cy={wiring.hint.point.y} r={(wiring.hint.kind === 'endpoint' ? 10 : 14) / scale} fill="#dbeafe66" stroke="#174895" strokeWidth={2 / scale} strokeDasharray={wiring.hint.kind === 'endpoint' ? undefined : 4/scale+' '+3/scale} />
      {wiring.hint.kind === 'wire' && <circle cx={wiring.hint.point.x} cy={wiring.hint.point.y} r={4 / scale} fill="#17489599" />}
    </g>}
    {center && wiring.choices.map((t,i)=>{
      const x=Math.max(bounds.x+22/scale,Math.min(bounds.x+bounds.width-22/scale,center.x+(i-(wiring.choices.length-1)/2)*48/scale));
      const y=Math.max(bounds.y+22/scale,Math.min(bounds.y+bounds.height-22/scale,center.y-48/scale));
      return <g key={targetKey(t)} data-wiring-ui role="button" tabIndex={0} aria-label={wiring.choiceLabel(t)} pointerEvents="all" onClick={e=>{e.stopPropagation();wiring.selectChoice(t);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();wiring.selectChoice(t);}}}>
        <path d={'M'+t.point.x+' '+t.point.y+'L'+x+' '+y} stroke="#174895" strokeWidth={1/scale} strokeDasharray={3/scale+' '+3/scale} pointerEvents="none"/>
        <circle cx={x} cy={y} r={22/scale} fill="transparent"/><circle cx={x} cy={y} r={16/scale} fill="white" stroke="#174895" strokeWidth={2/scale}/><circle cx={x} cy={y} r={4/scale} fill="#174895"/>
      </g>;
    })}
  </g>;
}
export function WiringOverlay({ wiring, screenPoint, width, height, cancel }: { wiring: ContextWiring; screenPoint: (p: Point) => Point; width: number; height: number; cancel: () => void }) {
  if (!wiring.active) return null;
  const p = wiring.hint ? screenPoint(wiring.hint.point) : null;
  return <>
    {p && wiring.crossingLabel && <div className="crossing-state" role="status" style={{left:Math.max(8,Math.min(width-64,p.x-28)),top:Math.max(8,Math.min(height-32,p.y-40))}}>{wiring.crossingLabel}</div>}
    {(wiring.start || wiring.choices.length>0 || (wiring.touch && wiring.action)) && <div data-wiring-ui className="wiring-icons">
      {wiring.touch && wiring.action && <button className="primary" aria-label={wiring.action.label} onClick={wiring.action.run}><Check size={20}/></button>}
      <button aria-label="배선 취소" onClick={cancel}><X size={20}/></button>
    </div>}
    {wiring.error && <span className="wiring-sr-only" role="alert">{wiring.error}</span>}
  </>;
}
