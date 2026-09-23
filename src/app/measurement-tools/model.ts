import type { CircuitDocument, EndpointRef, Point } from '../../domain';
import { endpointPosition, terminalPosition, wirePoints, endpointName } from '../../component-library';

export type MeasurementTool = 'red' | 'black' | 'current';
export type MeasurementAnchor = {kind:'endpoint';id:string;endpointKind:EndpointRef['kind']} | {kind:'wire';id:string;segment:number;t:number} | {kind:'component';id:string};
export interface MeasurementPose { point:Point; angle:number }
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export function anchorEndpoint(doc:CircuitDocument,anchor:MeasurementAnchor|null):EndpointRef|null {
  if (!anchor) return null;
  if (anchor.kind==='wire') return doc.wires.find(w=>w.id===anchor.id)?.start ?? null;
  if (anchor.kind==='endpoint' && (doc.junctions.some(j=>j.id===anchor.id)||doc.components.some(c=>c.terminals.some(t=>t.id===anchor.id)))) return {kind:anchor.endpointKind,id:anchor.id};
  return null;
}
export function anchorPose(doc:CircuitDocument,anchor:MeasurementAnchor|null):MeasurementPose|null {
  if (!anchor) return null;
  if (anchor.kind==='component') {
    const c=doc.components.find(c=>c.id===anchor.id); if(!c)return null;
    const i=c.type==='dc-voltage-source'?Math.max(0,c.terminals.findIndex(t=>t.role==='positive')):0;
    const a=terminalPosition(c,i),b=terminalPosition(c,i===0?1:0);
    return {point:{x:a.x+(b.x-a.x)*.1,y:a.y+(b.y-a.y)*.1},angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
  }
  if (anchor.kind==='endpoint') { const endpoint=anchorEndpoint(doc,anchor); return endpoint?{point:endpointPosition(doc,endpoint),angle:0}:null; }
  const wire=doc.wires.find(w=>w.id===anchor.id); if(!wire)return null;
  const points=wirePoints(doc,wire),a=points[anchor.segment],b=points[anchor.segment+1];
  if(!a||!b)return null;
  return {point:{x:a.x+(b.x-a.x)*anchor.t,y:a.y+(b.y-a.y)*anchor.t},angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
}
export function anchorName(doc:CircuitDocument,anchor:MeasurementAnchor|null):string {
  if(!anchor)return '';
  if(anchor.kind==='component')return doc.components.find(c=>c.id===anchor.id)?.label??'';
  if(anchor.kind==='endpoint')return endpointName(doc,anchor.id);
  const wire=doc.wires.find(w=>w.id===anchor.id);
  return wire?`${endpointName(doc,wire.start.id)} ↔ ${endpointName(doc,wire.end.id)}`:'';
}
export function defaultWireAnchor(doc:CircuitDocument,id:string):MeasurementAnchor|null {
  const wire=doc.wires.find(w=>w.id===id);if(!wire)return null;
  const p=wirePoints(doc,wire);let segment=0;
  for(let i=1;i<p.length-1;i++)if(distance(p[i],p[i+1])>distance(p[segment],p[segment+1]))segment=i;
  return {kind:'wire',id,segment,t:.5};
}
/** Wide screen-space hit regions, but ambiguous crossings never pick an arbitrary wire. */
export function measurementHit(doc:CircuitDocument,p:Point,scale:number,tool:MeasurementTool):MeasurementAnchor|null {
  const tolerance=18/scale;
  const endpoints=[...doc.junctions.map(j=>({kind:'junction' as const,id:j.id,point:j.position})),...doc.components.flatMap(c=>c.terminals.map((t,i)=>({kind:'terminal' as const,id:t.id,point:terminalPosition(c,i)})))];
  if(tool!=='current') {
    const nearest=endpoints.map(e=>({...e,d:distance(e.point,p)})).sort((a,b)=>a.d-b.d)[0];
    if(nearest&&nearest.d<12/scale)return {kind:'endpoint',id:nearest.id,endpointKind:nearest.kind};
  } else if(doc.junctions.some(j=>distance(j.position,p)<12/scale)) return null;
  for(const c of doc.components) {
    const r=-c.rotation*Math.PI/180,dx=p.x-c.position.x,dy=p.y-c.position.y,x=dx*Math.cos(r)-dy*Math.sin(r),y=dx*Math.sin(r)+dy*Math.cos(r);
    if(Math.abs(x)<40&&Math.abs(y)<24+8/scale) {
      if(tool==='current')return {kind:'component',id:c.id};
      const terminal=c.terminals.map((t,i)=>({t,d:distance(terminalPosition(c,i),p)})).sort((a,b)=>a.d-b.d)[0];
      return {kind:'endpoint',id:terminal.t.id,endpointKind:'terminal'};
    }
  }
  const hits=doc.wires.flatMap(w=>{
    const points=wirePoints(doc,w);return points.slice(1).flatMap((b,i)=>{
      const a=points[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;if(!len)return [];
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)),d=distance(p,{x:a.x+t*dx,y:a.y+t*dy});
      return d<=tolerance?[{anchor:{kind:'wire' as const,id:w.id,segment:i,t},d}]:[];
    });
  }).sort((a,b)=>a.d-b.d);
  const best=hits[0];if(!best)return null;
  if(hits.some(h=>h.anchor.id!==best.anchor.id&&Math.abs(h.d-best.d)<4/scale))return null;
  return best.anchor;
}
