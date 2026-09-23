import { diagnostic, type CircuitDocument, type ComponentInstance, type Diagnostic, type Point, type Wire } from '../domain';
import { compactWirePoints, terminalPosition, wireCrossings, wirePoints } from '../component-library';

export interface InsertionCandidate { wireId: string; segment: number; position: Point; rotation: ComponentInstance['rotation']; reason?: 'space' | 'crossing' }
export function insertionCandidates(document: CircuitDocument, point: Point, wireId?: string): InsertionCandidate[] {
  const crossings=wireCrossings(document);
  return document.wires.filter(w=>!wireId||w.id===wireId).flatMap(w=>{
    const points=compactWirePoints(wirePoints(document,w));
    return points.slice(1).flatMap((b,i)=>{
      const a=points[i], horizontal=a.y===b.y, vertical=a.x===b.x;
      if(!horizontal&&!vertical)return [];
      const position=horizontal?{x:Math.max(Math.min(a.x,b.x),Math.min(Math.max(a.x,b.x),point.x)),y:a.y}:{x:a.x,y:Math.max(Math.min(a.y,b.y),Math.min(Math.max(a.y,b.y),point.y))};
      if(Math.hypot(position.x-point.x,position.y-point.y)>18)return [];
      const space=Math.min(Math.hypot(position.x-a.x,position.y-a.y),Math.hypot(position.x-b.x,position.y-b.y));
      const crossing=crossings.some(c=>(c.horizontalId===w.id||c.verticalId===w.id)&&Math.hypot(c.point.x-position.x,c.point.y-position.y)<56);
      return [{wireId:w.id,segment:i,position,rotation:horizontal?0 as const:90 as const,...(space<56?{reason:'space' as const}:crossing?{reason:'crossing' as const}:{})}];
    });
  });
}
const failure=(ids:string[],reason:string):Diagnostic[]=>[diagnostic('WIRE_EDIT_UNAVAILABLE',ids,'error',{reason})];
export function insertComponent(document:CircuitDocument, component:ComponentInstance, wireId:string, segment:number, newWireId:string):Diagnostic[]|null {
  if(component.type==='voltmeter'||component.terminals.length!==2||component.terminals.some(t=>t.localPosition))return failure([component.id],'component');
  const candidate=insertionCandidates(document,component.position,wireId).find(c=>c.segment===segment);
  if(!candidate||candidate.reason)return failure([wireId],candidate?.reason??'target');
  if(Math.hypot(candidate.position.x-component.position.x,candidate.position.y-component.position.y)>18)return failure([wireId],'target');
  component.position=candidate.position; component.rotation=candidate.rotation;
  const wire=document.wires.find(w=>w.id===wireId)!;
  const points=compactWirePoints(wirePoints(document,wire)), a=points[segment], b=points[segment+1];
  const p0=terminalPosition(component,0),p1=terminalPosition(component,1);
  const first=Math.hypot(p0.x-a.x,p0.y-a.y)<Math.hypot(p1.x-a.x,p1.y-a.y)?0:1, second=1-first;
  const originalEnd=wire.end;
  wire.end={kind:'terminal',id:component.terminals[first].id};
  wire.waypoints=[...points.slice(1,segment+1)];
  document.wires.push({id:newWireId,start:{kind:'terminal',id:component.terminals[second].id},end:originalEnd,waypoints:points.slice(segment+1,-1)});
  document.components.push(component);
  if(!document.referenceNode&&component.type==='dc-voltage-source')document.referenceNode={kind:'terminal',id:(component.terminals.find(t=>t.role==='negative')??component.terminals[1]).id};
  return null;
}
export function splitWire(document:CircuitDocument, wire:Wire, point:Point, junctionId:string, newWireId:string):boolean {
  const points=compactWirePoints(wirePoints(document,wire));
  const segment=points.slice(1).findIndex((b,i)=>{const a=points[i];return (a.x===b.x&&point.x===a.x&&point.y>Math.min(a.y,b.y)&&point.y<Math.max(a.y,b.y))||(a.y===b.y&&point.y===a.y&&point.x>Math.min(a.x,b.x)&&point.x<Math.max(a.x,b.x));});
  if(segment<0)return false;
  const end=wire.end;
  wire.end={kind:'junction',id:junctionId};wire.waypoints=points.slice(1,segment+1);
  document.wires.push({id:newWireId,start:{kind:'junction',id:junctionId},end,waypoints:points.slice(segment+1,-1)});
  return true;
}
export function connectCrossing(document:CircuitDocument, point:Point, wireIds:[string,string], junctionId:string, newWireIds:[string,string]):Diagnostic[]|null {
  const hits=wireCrossings(document).filter(c=>c.point.x===point.x&&c.point.y===point.y);
  if(hits.length!==1||!wireIds.includes(hits[0].horizontalId)||!wireIds.includes(hits[0].verticalId)||document.junctions.some(j=>j.position.x===point.x&&j.position.y===point.y))return failure(wireIds,'ambiguous');
  for(let i=0;i<2;i++)if(!splitWire(document,document.wires.find(w=>w.id===wireIds[i])!,point,junctionId,newWireIds[i]))return failure(wireIds,'target');
  document.junctions.push({id:junctionId,position:point});return null;
}
export function disconnectCrossing(document:CircuitDocument,junctionId:string):Diagnostic[]|null {
  const junction=document.junctions.find(j=>j.id===junctionId);
  if(!junction)return failure([junctionId],'target');
  if(document.referenceNode?.id===junctionId||document.annotations.some(a=>a.anchor.id===junctionId))return failure([junctionId],'anchored');
  const attached=document.wires.filter(w=>w.start.id===junctionId||w.end.id===junctionId);
  if(attached.length!==4||attached.some(w=>w.start.id===w.end.id))return failure([junctionId],'ambiguous');
  const routes=attached.map(w=>{
    const points=compactWirePoints(wirePoints(document,w));
    if(w.end.id===junctionId)points.reverse();
    const p=points[1], a=junction.position;
    const direction=p.x===a.x?(p.y<a.y?'up':'down'):p.y===a.y?(p.x<a.x?'left':'right'):'invalid';
    return {wire:w,points,direction,outer:w.start.id===junctionId?w.end:w.start};
  });
  if(new Set(routes.map(r=>r.direction)).size!==4||routes.some(r=>r.direction==='invalid'))return failure([junctionId],'ambiguous');
  for(const [d1,d2] of [['left','right'],['up','down']]){
    const a=routes.find(r=>r.direction===d1)!,b=routes.find(r=>r.direction===d2)!;
    const points=compactWirePoints([...a.points].reverse().concat(b.points.slice(1)));
    a.wire.start=a.outer;a.wire.end=b.outer;a.wire.waypoints=points.slice(1,-1);
    document.wires=document.wires.filter(w=>w.id!==b.wire.id);
  }
  document.junctions=document.junctions.filter(j=>j.id!==junctionId);return null;
}
